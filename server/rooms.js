const crypto = require('crypto');
const { resolveCategory } = require('./questions');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, avoids look-alike confusion
const CODE_LENGTH = 4;
const IDLE_ROOM_TTL_MS = 10 * 60 * 1000; // 10 minutes with everyone disconnected -> reap
const MAX_NAME_LENGTH = 20;

const AVATARS = ['🦊', '🐼', '🐸', '🐵', '🦄', '🐯', '🐨', '🐙', '🦉', '🐢', '🐷', '🦁'];
const DEFAULT_AVATAR = AVATARS[0];

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

function sanitizeAvatar(rawAvatar) {
  return AVATARS.includes(rawAvatar) ? rawAvatar : DEFAULT_AVATAR;
}

function createPlayer(name, avatar, socketId, isCreator) {
  return {
    playerId: crypto.randomUUID(),
    name,
    avatar: sanitizeAvatar(avatar),
    socketId,
    connected: true,
    score: 0,
    isCreator,
    disconnectedAt: null,
  };
}

function newRoom(code, hostPlayer, categoryKey) {
  return {
    code,
    createdAt: Date.now(),
    hostPlayerId: hostPlayer.playerId,
    category: resolveCategory(categoryKey),
    state: 'lobby', // lobby | question | reveal | steal_prompt | freeze_prompt | final
    questionIndex: -1,
    players: new Map([[hostPlayer.playerId, hostPlayer]]),
    answers: new Map(), // playerId -> { choiceIndex, answeredAt }
    currentQuestion: null,
    stealState: null, // { type: 'steal'|'freeze', chooserId, decisionEndsAt, resolved }
    frozenPlayerId: null, // set by a Freeze Round choice, consumed by the next question
    timers: { questionTimeout: null, revealTimeout: null, stealTimeout: null },
    allDisconnectedSince: null,
  };
}

function createRoom(rawName, rawAvatar, socketId, categoryKey) {
  const name = sanitizeName(rawName);
  if (!name) return { error: { code: 'INVALID_NAME', message: 'Enter a name to create a room.' } };
  const code = generateRoomCode();
  const player = createPlayer(name, rawAvatar, socketId, true);
  const room = newRoom(code, player, categoryKey);
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

function joinRoom({ roomCode, name: rawName, avatar: rawAvatar, socketId, playerId }) {
  const room = getRoom(roomCode);
  if (!room) return { error: { code: 'ROOM_NOT_FOUND', message: 'No room with that code.' } };

  const name = sanitizeName(rawName);
  if (!name) return { error: { code: 'INVALID_NAME', message: 'Enter a name to join.' } };

  const existing = findExistingPlayerByIdentity(room, playerId, name);
  if (existing) {
    existing.socketId = socketId;
    existing.connected = true;
    existing.disconnectedAt = null;
    if (rawAvatar) existing.avatar = sanitizeAvatar(rawAvatar);
    room.allDisconnectedSince = null;
    return { room, player: existing, reconnected: true };
  }

  if (room.state !== 'lobby' && room.state !== 'final') {
    return { error: { code: 'GAME_IN_PROGRESS', message: 'This room already started a game — wait for it to finish.' } };
  }

  const nameTaken = [...room.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
  if (nameTaken) return { error: { code: 'NAME_TAKEN', message: 'That name is already in use in this room.' } };

  const player = createPlayer(name, rawAvatar, socketId, false);
  room.players.set(player.playerId, player);
  return { room, player, reconnected: false };
}

function serializePlayers(room) {
  return [...room.players.values()]
    .map((p) => ({ playerId: p.playerId, name: p.name, avatar: p.avatar, connected: p.connected, isCreator: p.isCreator, score: p.score }))
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

/**
 * If the room's host just disconnected, hand the crown to the next connected
 * player (insertion order). Returns the newly promoted player, or null if
 * no one else is connected (or the given player wasn't the host).
 */
function promoteNextHostIfNeeded(room, disconnectedPlayerId) {
  if (room.hostPlayerId !== disconnectedPlayerId) return null;
  const oldHost = room.players.get(disconnectedPlayerId);
  if (oldHost) oldHost.isCreator = false;
  for (const p of room.players.values()) {
    if (p.connected) {
      p.isCreator = true;
      room.hostPlayerId = p.playerId;
      return p;
    }
  }
  return null;
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
  AVATARS,
  createRoom,
  getRoom,
  joinRoom,
  serializePlayers,
  countConnected,
  markDisconnected,
  promoteNextHostIfNeeded,
  findPlayerBySocketId,
  clearRoomTimers,
  deleteRoom,
  startCleanupSweep,
};
