const crypto = require('crypto');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, avoids look-alike confusion
const CODE_LENGTH = 4;
const IDLE_ROOM_TTL_MS = 10 * 60 * 1000; // 10 minutes with everyone disconnected -> reap
const MAX_NAME_LENGTH = 20;

const rooms = new Map(); // roomCode -> Room

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function sanitizeName(rawName) {
  const name = String(rawName || '').trim().slice(0, MAX_NAME_LENGTH);
  return name;
}

function createPlayer(name, socketId, isCreator) {
  return {
    playerId: crypto.randomUUID(),
    name,
    socketId,
    connected: true,
    score: 0,
    isCreator,
    disconnectedAt: null,
  };
}

function newRoom(code, hostPlayer) {
  return {
    code,
    createdAt: Date.now(),
    hostPlayerId: hostPlayer.playerId,
    state: 'lobby', // lobby | question | reveal | steal_prompt | final
    questionIndex: -1,
    players: new Map([[hostPlayer.playerId, hostPlayer]]),
    answers: new Map(), // playerId -> { choiceIndex, answeredAt }
    currentQuestion: null,
    stealState: null, // { stealerId, decisionEndsAt, resolved }
    timers: { questionTimeout: null, revealTimeout: null, stealTimeout: null },
    allDisconnectedSince: null,
  };
}

function createRoom(rawName, socketId) {
  const name = sanitizeName(rawName);
  if (!name) return { error: { code: 'INVALID_NAME', message: 'Enter a name to create a room.' } };
  const code = generateRoomCode();
  const player = createPlayer(name, socketId, true);
  const room = newRoom(code, player);
  rooms.set(code, room);
  return { room, player };
}

function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase());
}

function findExistingPlayerByIdentity(room, playerId, name) {
  if (playerId && room.players.has(playerId)) return room.players.get(playerId);
  // Fallback: same name, currently disconnected (covers a client that lost its localStorage playerId)
  const lowerName = name.toLowerCase();
  for (const p of room.players.values()) {
    if (!p.connected && p.name.toLowerCase() === lowerName) return p;
  }
  return null;
}

function joinRoom({ roomCode, name: rawName, socketId, playerId }) {
  const room = getRoom(roomCode);
  if (!room) return { error: { code: 'ROOM_NOT_FOUND', message: 'No room with that code.' } };

  const name = sanitizeName(rawName);
  if (!name) return { error: { code: 'INVALID_NAME', message: 'Enter a name to join.' } };

  const existing = findExistingPlayerByIdentity(room, playerId, name);
  if (existing) {
    existing.socketId = socketId;
    existing.connected = true;
    existing.disconnectedAt = null;
    room.allDisconnectedSince = null;
    return { room, player: existing, reconnected: true };
  }

  if (room.state !== 'lobby' && room.state !== 'final') {
    return { error: { code: 'GAME_IN_PROGRESS', message: 'This room already started a game — wait for it to finish.' } };
  }

  const nameTaken = [...room.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
  if (nameTaken) return { error: { code: 'NAME_TAKEN', message: 'That name is already in use in this room.' } };

  const player = createPlayer(name, socketId, false);
  room.players.set(player.playerId, player);
  return { room, player, reconnected: false };
}

function serializePlayers(room) {
  return [...room.players.values()]
    .map((p) => ({ playerId: p.playerId, name: p.name, connected: p.connected, isCreator: p.isCreator, score: p.score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function countConnected(room) {
  let n = 0;
  for (const p of room.players.values()) if (p.connected) n += 1;
  return n;
}

function markDisconnected(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) return;
  player.connected = false;
  player.socketId = null;
  player.disconnectedAt = Date.now();
  if (countConnected(room) === 0) room.allDisconnectedSince = Date.now();
}

function findPlayerBySocketId(room, socketId) {
  for (const p of room.players.values()) if (p.socketId === socketId) return p;
  return null;
}

function clearRoomTimers(room) {
  for (const key of Object.keys(room.timers)) {
    if (room.timers[key]) clearTimeout(room.timers[key]);
    room.timers[key] = null;
  }
}

function deleteRoom(code) {
  const room = rooms.get(code);
  if (room) clearRoomTimers(room);
  rooms.delete(code);
}

function startCleanupSweep(intervalMs = 60 * 1000) {
  return setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms.entries()) {
      if (room.allDisconnectedSince && now - room.allDisconnectedSince > IDLE_ROOM_TTL_MS) {
        deleteRoom(code);
      }
    }
  }, intervalMs);
}

module.exports = {
  rooms,
  createRoom,
  getRoom,
  joinRoom,
  serializePlayers,
  countConnected,
  markDisconnected,
  findPlayerBySocketId,
  clearRoomTimers,
  deleteRoom,
  startCleanupSweep,
};
