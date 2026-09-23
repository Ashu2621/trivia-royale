const EVENTS = require('./events');
const rooms = require('./rooms');
const game = require('./game');
const { QUESTIONS } = require('./questions');

// socket.id -> { roomCode, playerId }, so a disconnect knows which room/player it belonged to
const socketMeta = new Map();

function buildRoomState(room) {
  const state = {
    state: room.state,
    players: rooms.serializePlayers(room),
    questionIndex: room.questionIndex,
    totalQuestions: QUESTIONS.length,
    question: null,
    final: null,
  };
  if (room.state === 'question' && room.currentQuestion) {
    const q = room.currentQuestion;
    state.question = {
      text: q.text,
      choices: q.choices,
      questionEndsAt: q.questionEndsAt,
      isStealRound: q.isStealRound,
      serverNow: Date.now(),
    };
  }
  if (room.state === 'final') {
    const board = rooms.serializePlayers(room);
    state.final = { leaderboard: board, podium: board.slice(0, 3) };
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
  socket.on(EVENTS.ROOM_CREATE, ({ name } = {}) => {
    const result = rooms.createRoom(name, socket.id);
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

  socket.on(EVENTS.ROOM_JOIN, ({ roomCode, name, playerId } = {}) => {
    const result = rooms.joinRoom({ roomCode, name, socketId: socket.id, playerId });
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
    if (!player.isCreator) return sendError(socket, 'NOT_HOST', 'Only the room creator can start the game.');
    if (room.state !== 'lobby') return;
    if (rooms.countConnected(room) < 2) return sendError(socket, 'NOT_ENOUGH_PLAYERS', 'Need at least 2 players to start.');
    game.startGame(io, room);
  });

  socket.on(EVENTS.ANSWER_SUBMIT, ({ choiceIndex } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    game.handleAnswerSubmit(io, ctx.room, ctx.player.playerId, choiceIndex);
  });

  socket.on(EVENTS.STEAL_CHOOSE, ({ targetPlayerId } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.state !== 'steal_prompt' || !room.stealState || room.stealState.stealerId !== player.playerId) return;
    game.resolveSteal(io, room, targetPlayerId || null);
  });

  socket.on(EVENTS.GAME_PLAY_AGAIN, () => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.isCreator) return sendError(socket, 'NOT_HOST', 'Only the room creator can restart.');
    game.resetToLobby(io, room);
  });

  socket.on('disconnect', () => {
    const meta = socketMeta.get(socket.id);
    socketMeta.delete(socket.id);
    if (!meta) return;
    const room = rooms.getRoom(meta.roomCode);
    if (!room) return;
    rooms.markDisconnected(room, meta.playerId);
    io.to(room.code).emit(EVENTS.PLAYER_LIST_UPDATE, { players: rooms.serializePlayers(room) });

    if (room.state === 'question') {
      game.maybeEndQuestionEarly(io, room);
    } else if (room.state === 'steal_prompt' && room.stealState && room.stealState.stealerId === meta.playerId) {
      game.resolveSteal(io, room, null);
    }
  });
}

module.exports = { register };
