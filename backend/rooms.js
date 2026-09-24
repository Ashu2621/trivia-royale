const crypto = require('crypto');
const { getTier, DEFAULT_TIER } = require('./bots');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, avoids look-alike confusion
const CODE_LENGTH = 4;
const IDLE_ROOM_TTL_MS = 10 * 60 * 1000; // 10 minutes with everyone disconnected -> reap
const NAME_RECONNECT_GRACE_MS = 2 * 60 * 1000; // window for a lost-playerId reconnect to claim a seat by name
const MAX_NAME_LENGTH = 20;

const AVATARS = ['🦊', '🐼', '🐸', '🐵', '🦄', '🐯', '🐨', '🐙', '🦉', '🐢', '🐷', '🦁'];
const DEFAULT_AVATAR = AVATARS[0];
const BOT_NAMES = ['Ada', 'Turing', 'Byte', 'Nova', 'Cipher', 'Echo', 'Volt', 'Pixel', 'Newton', 'Ranger'];
const MAX_PLAYERS = 10;

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
    isBot: false,
    botTier: null,
    left: false,
  };
}

function createBot(existingNames, tierKey) {
  const taken = new Set(existingNames);
  const pool = BOT_NAMES.filter((n) => !taken.has(`Bot ${n}`));
  const pick = (pool.length ? pool : BOT_NAMES)[Math.floor(Math.random() * (pool.length ? pool.length : BOT_NAMES.length))];
  const tier = getTier(tierKey);
  return {
    playerId: crypto.randomUUID(),
    name: `Bot ${pick}`,
    avatar: tier.emoji,
    socketId: null,
    connected: true,
    score: 0,
    isCreator: false,
    disconnectedAt: null,
    isBot: true,
    botTier: tier.key,
    left: false,
    lastSayAt: 0,
  };
}

function newRoom(code, hostPlayer) {
  return {
    code,
    createdAt: Date.now(),
    hostPlayerId: hostPlayer.playerId,
    state: 'lobby', // lobby | city | final
    players: new Map([[hostPlayer.playerId, hostPlayer]]),
    timers: { cityTick: null, botTimeouts: [] },
    city: null, // live simulation state while a match is running
    voice: null, // player ids currently in the voice chat
    allDisconnectedSince: null,
    startsAt: null,
  };
}

function createRoom(rawName, rawAvatar, socketId) {
  const name = sanitizeName(rawName);
  if (!name) return { error: { code: 'INVALID_NAME', message: 'Enter a name to create a room.' } };
  const code = generateRoomCode();
  const player = createPlayer(name, rawAvatar, socketId, true);
  const room = newRoom(code, player);
  rooms.set(code, room);
  return { room, player };
}

function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase());
}

function findExistingPlayerByIdentity(room, playerId, name) {
  if (playerId && room.players.has(playerId)) return room.players.get(playerId);
  // Fallback: same name, currently disconnected, and disconnected recently enough
  // that this is almost certainly the same client reconnecting after losing its
  // stored playerId (e.g. a refresh) — not a stranger claiming someone else's
  // seat/score by guessing their name once they've been gone a while.
  const lowerName = name.toLowerCase();
  const now = Date.now();
  for (const p of room.players.values()) {
    if (
      !p.connected &&
      !p.isBot &&
      p.name.toLowerCase() === lowerName &&
      p.disconnectedAt &&
      now - p.disconnectedAt < NAME_RECONNECT_GRACE_MS
    ) {
      return p;
    }
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

function addBot(room, tierKey) {
  if (room.state !== 'lobby') return { error: { code: 'GAME_IN_PROGRESS', message: 'Can only add a computer player in the lobby.' } };
  if (room.players.size >= MAX_PLAYERS) return { error: { code: 'ROOM_FULL', message: `Rooms cap out at ${MAX_PLAYERS} players.` } };
  const bot = createBot([...room.players.values()].map((p) => p.name), tierKey || DEFAULT_TIER);
  room.players.set(bot.playerId, bot);
  return { bot };
}

function removeBot(room, playerId) {
  if (room.state !== 'lobby') return { error: { code: 'GAME_IN_PROGRESS', message: 'Can only remove a computer player in the lobby.' } };
  const bot = room.players.get(playerId);
  if (!bot || !bot.isBot) return { error: { code: 'NOT_A_BOT', message: 'That player is not a computer player.' } };
  room.players.delete(playerId);
  return { removed: true };
}

function serializePlayers(room) {
  return [...room.players.values()]
    .map((p) => ({
      playerId: p.playerId,
      name: p.name,
      avatar: p.avatar,
      connected: p.connected,
      isCreator: p.isCreator,
      isBot: p.isBot,
      botTier: p.botTier ? getTier(p.botTier).label : null,
      left: !!p.left,
      score: p.score,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function countConnected(room) {
  let n = 0;
  for (const p of room.players.values()) if (p.connected) n += 1;
  return n;
}

// Bots are always "connected" (they have no socket to drop), so counting them
// here would mean a room with only a bot left in it never looks idle and the
// cleanup sweep would never reap it — a permanent per-room memory leak on a
// long-running server. Idle detection should only care about humans.
function countConnectedHumans(room) {
  let n = 0;
  for (const p of room.players.values()) if (p.connected && !p.isBot) n += 1;
  return n;
}

function markDisconnected(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) return;
  player.connected = false;
  player.socketId = null;
  player.disconnectedAt = Date.now();
  if (countConnectedHumans(room) === 0) room.allDisconnectedSince = Date.now();
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
    if (p.connected && !p.isBot) {
      p.isCreator = true;
      room.hostPlayerId = p.playerId;
      return p;
    }
  }
  return null;
}

// Someone pressing Back in the lobby or on the results screen: remove them
// entirely, hand over the host crown, and delete the room if no humans remain.
function leaveIdleRoom(room, playerId) {
  const p = room.players.get(playerId);
  if (!p) return;
  markDisconnected(room, playerId);
  promoteNextHostIfNeeded(room, playerId);
  room.players.delete(playerId);
  const humansLeft = [...room.players.values()].some((x) => !x.isBot);
  if (!humansLeft) deleteRoom(room.code);
}

function findPlayerBySocketId(room, socketId) {
  for (const p of room.players.values()) if (p.socketId === socketId) return p;
  return null;
}

function clearRoomTimers(room) {
  for (const key of Object.keys(room.timers)) {
    const value = room.timers[key];
    if (Array.isArray(value)) {
      value.forEach((t) => clearTimeout(t));
      room.timers[key] = [];
    } else if (value) {
      clearTimeout(value);
      room.timers[key] = null;
    }
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
  addBot,
  removeBot,
  serializePlayers,
  countConnected,
  markDisconnected,
  promoteNextHostIfNeeded,
  leaveIdleRoom,
  findPlayerBySocketId,
  clearRoomTimers,
  deleteRoom,
  startCleanupSweep,
};
