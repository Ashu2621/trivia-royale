const EVENTS = require('./events');
const rooms = require('./rooms');
const game = require('./game');
const city = require('./city');

// socket.id -> { roomCode, playerId }, so a disconnect knows which room/player it belonged to
const socketMeta = new Map();

function buildRoomState(room) {
  const state = {
    state: room.state,
    players: rooms.serializePlayers(room),
    startsAt: room.state === 'city' ? room.startsAt : null,
    serverNow: Date.now(),
    city: room.state === 'city' && room.city ? city.initPayload(room) : null,
    final: null,
  };
  if (room.state === 'final') {
    const board = rooms.serializePlayers(room);
    state.final = { leaderboard: board, podium: board.slice(0, 3), awards: room.awards || [] };
  }
  return state;
}

function sendError(socket, code, message) {
  socket.emit(EVENTS.ROOM_ERROR, { code, message });
}

function getContext(socket) {
  const meta = socketMeta.get(socket.id);
  if (!meta) return null;
  const room = rooms.getRoom(meta.roomCode);
  if (!room) return null;
  const player = room.players.get(meta.playerId);
  if (!player) return null;
  return { room, player };
}

function register(io, socket) {
  socket.on(EVENTS.ROOM_CREATE, ({ name, avatar } = {}) => {
    const result = rooms.createRoom(name, avatar, socket.id);
    if (result.error) return sendError(socket, result.error.code, result.error.message);
    const { room, player } = result;
    socket.join(room.code);
    socketMeta.set(socket.id, { roomCode: room.code, playerId: player.playerId });
    socket.emit(EVENTS.ROOM_JOINED, {
      playerId: player.playerId,
      roomCode: room.code,
      isCreator: true,
      roomState: buildRoomState(room),
    });
  });

  socket.on(EVENTS.ROOM_JOIN, ({ roomCode, name, avatar, playerId } = {}) => {
    const result = rooms.joinRoom({ roomCode, name, avatar, socketId: socket.id, playerId });
    if (result.error) return sendError(socket, result.error.code, result.error.message);
    const { room, player } = result;
    socket.join(room.code);
    socketMeta.set(socket.id, { roomCode: room.code, playerId: player.playerId });
    socket.emit(EVENTS.ROOM_JOINED, {
      playerId: player.playerId,
      roomCode: room.code,
      isCreator: player.isCreator,
      roomState: buildRoomState(room),
    });
    io.to(room.code).emit(EVENTS.PLAYER_LIST_UPDATE, { players: rooms.serializePlayers(room) });
  });

  socket.on(EVENTS.GAME_START, () => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.isCreator) return sendError(socket, 'NOT_HOST', 'Only the room host can start the game.');
    if (room.state !== 'lobby') return;
    if (rooms.countConnected(room) < 2) return sendError(socket, 'NOT_ENOUGH_PLAYERS', 'Need at least 2 players (add a computer player!) to start.');
    game.startGame(io, room);
  });

  socket.on(EVENTS.ROOM_LEAVE, () => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    socket.leave(room.code);
    socketMeta.delete(socket.id);
    game.handleLeave(io, room, player);
  });

  // ---- in-match controls ----
  socket.on(EVENTS.CITY_INPUT, ({ dx, dy } = {}) => {
    const ctx = getContext(socket);
    if (ctx) city.setInput(ctx.room, ctx.player.playerId, dx, dy);
  });
  socket.on(EVENTS.CITY_ATTACK, ({ ang } = {}) => {
    const ctx = getContext(socket);
    if (ctx) city.attack(io, ctx.room, ctx.player.playerId, ang);
  });
  socket.on(EVENTS.CITY_USE, () => {
    const ctx = getContext(socket);
    if (ctx) city.use(io, ctx.room, ctx.player.playerId);
  });
  socket.on(EVENTS.CITY_WEAPON, ({ code } = {}) => {
    const ctx = getContext(socket);
    if (ctx) city.selectWeapon(ctx.room, ctx.player.playerId, code);
  });
  // a loud shout into the microphone (the client measures the volume)
  socket.on(EVENTS.CITY_SHOUT, () => {
    const ctx = getContext(socket);
    if (ctx) city.shout(io, ctx.room, ctx.player.playerId);
  });

  // ---- live voice chat: the server only relays WebRTC signalling between the players ----
  function voiceSet(room) {
    if (!room.voice) room.voice = new Set();
    return room.voice;
  }
  function dropVoice(room, playerId) {
    const set = voiceSet(room);
    if (!set.delete(playerId)) return;
    io.to(room.code).emit(EVENTS.VOICE_LEFT, { playerId });
  }
  socket.on(EVENTS.VOICE_JOIN, () => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    const set = voiceSet(room);
    const others = [...set].filter((id) => id !== player.playerId);
    set.add(player.playerId);
    socket.emit(EVENTS.VOICE_PEERS, { peers: others });
    socket.to(room.code).emit(EVENTS.VOICE_JOINED, { playerId: player.playerId });
  });
  socket.on(EVENTS.VOICE_LEAVE, () => {
    const ctx = getContext(socket);
    if (ctx) dropVoice(ctx.room, ctx.player.playerId);
  });
  socket.on(EVENTS.VOICE_SIGNAL, ({ to, data } = {}) => {
    const ctx = getContext(socket);
    if (!ctx || typeof to !== 'string' || !data) return;
    const target = ctx.room.players.get(to);
    if (!target || !target.socketId || !target.connected) return;
    if (JSON.stringify(data).length > 20000) return;
    io.to(target.socketId).emit(EVENTS.VOICE_SIGNAL_IN, { from: ctx.player.playerId, data });
  });

  // ---- lobby ----
  socket.on(EVENTS.BOT_ADD, ({ difficulty } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.isCreator) return sendError(socket, 'NOT_HOST', 'Only the room host can add computer players.');
    const result = rooms.addBot(room, difficulty);
    if (result.error) return sendError(socket, result.error.code, result.error.message);
    io.to(room.code).emit(EVENTS.PLAYER_LIST_UPDATE, { players: rooms.serializePlayers(room) });
  });

  socket.on(EVENTS.BOT_REMOVE, ({ playerId } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.isCreator) return sendError(socket, 'NOT_HOST', 'Only the room host can remove computer players.');
    const result = rooms.removeBot(room, playerId);
    if (result.error) return sendError(socket, result.error.code, result.error.message);
    io.to(room.code).emit(EVENTS.PLAYER_LIST_UPDATE, { players: rooms.serializePlayers(room) });
  });

  socket.on(EVENTS.GAME_PLAY_AGAIN, () => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.isCreator) return sendError(socket, 'NOT_HOST', 'Only the room host can restart.');
    game.resetToLobby(io, room);
  });

  socket.on('disconnect', () => {
    const meta = socketMeta.get(socket.id);
    socketMeta.delete(socket.id);
    if (!meta) return;
    const room = rooms.getRoom(meta.roomCode);
    if (!room) return;
    rooms.markDisconnected(room, meta.playerId);
    rooms.promoteNextHostIfNeeded(room, meta.playerId);
    io.to(room.code).emit(EVENTS.PLAYER_LIST_UPDATE, { players: rooms.serializePlayers(room) });
    if (room.voice && room.voice.delete(meta.playerId)) io.to(room.code).emit(EVENTS.VOICE_LEFT, { playerId: meta.playerId });
  });
}

module.exports = { register };
