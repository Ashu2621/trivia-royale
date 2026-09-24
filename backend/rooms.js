const crypto = require('crypto');
const { resolveCategory } = require('./questions');
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
const LIFELINES_PER_GAME = 2;
const POLLS_PER_GAME = 1;
const MAX_CUSTOM_QUESTIONS = 40;
const MAX_QUESTION_LENGTH = 300;
const MAX_OPTION_LENGTH = 120;

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
    streak: 0,
    lifelines: 0,
    polls: 0,
    eliminated: false,
    left: false,
    place: null,
    team: null,
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
    streak: 0,
    lifelines: 0,
    polls: 0,
    eliminated: false,
    left: false,
    place: null,
    team: null,
    lastSayAt: 0,
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
    timers: { questionTimeout: null, revealTimeout: null, stealTimeout: null, cityTick: null, botTimeouts: [] },
    city: null, // live simulation state while a City Mission match is running
    voice: null, // player ids currently in the voice chat
    allDisconnectedSince: null,
    customQuestions: [], // { text, choices[4], correctIndex } — live pool for category === 'custom'
    teamMode: 0, // 0 = everyone for themselves, 2-4 = that many teams
    fans: new Map(), // spectator playerId -> the contender they are cheering for
    stats: new Map(), // playerId -> per-match numbers used for the end-of-match awards
    stagePlan: null, // { count, per, names } — levels of the match, set when a game starts
    startsAt: null,
    activeQuestions: [], // the actual per-game order — shuffled static bank, or a copy of customQuestions
    levelKey: null, // last level used for AI generation in this room, for display/reuse
    subject: null, // last subject used for AI generation in this room, for display/reuse
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

function sanitizeQuestionText(s) {
  return String(s || '').trim().slice(0, MAX_QUESTION_LENGTH);
}
function sanitizeOptionText(s) {
  return String(s || '').trim().slice(0, MAX_OPTION_LENGTH);
}

function addCustomQuestion(room, { text, choices, correctIndex }) {
  if (room.state !== 'lobby') return { error: { code: 'GAME_IN_PROGRESS', message: 'Can only edit questions in the lobby.' } };
  if (room.category !== 'custom') return { error: { code: 'WRONG_MODE', message: 'Switch the room category to Custom / Study Mode first.' } };
  const cleanText = sanitizeQuestionText(text);
  if (!cleanText) return { error: { code: 'INVALID_QUESTION', message: 'Question text is required.' } };
  const cleanChoices = Array.isArray(choices) ? choices.map(sanitizeOptionText) : [];
  if (cleanChoices.length !== 4 || cleanChoices.some((c) => !c)) {
    return { error: { code: 'INVALID_QUESTION', message: 'Exactly 4 non-empty options are required.' } };
  }
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    return { error: { code: 'INVALID_QUESTION', message: 'Pick which option is correct.' } };
  }
  if (room.customQuestions.length >= MAX_CUSTOM_QUESTIONS) {
    return { error: { code: 'POOL_FULL', message: `Rooms cap out at ${MAX_CUSTOM_QUESTIONS} questions.` } };
  }
  room.customQuestions.push({ text: cleanText, choices: cleanChoices, correctIndex });
  return { ok: true };
}

function addCustomQuestions(room, list) {
  const space = Math.max(0, MAX_CUSTOM_QUESTIONS - room.customQuestions.length);
  const accepted = (list || []).slice(0, space);
  room.customQuestions.push(...accepted);
  return accepted.length;
}

function removeCustomQuestion(room, index) {
  if (room.state !== 'lobby') return { error: { code: 'GAME_IN_PROGRESS', message: 'Can only edit questions in the lobby.' } };
  if (!Number.isInteger(index) || index < 0 || index >= room.customQuestions.length) {
    return { error: { code: 'INVALID_INDEX', message: 'That question no longer exists.' } };
  }
  room.customQuestions.splice(index, 1);
  return { ok: true };
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
      streak: p.streak || 0,
      lifelines: p.lifelines || 0,
      polls: p.polls || 0,
      eliminated: !!p.eliminated,
      left: !!p.left,
      place: p.place || null,
      team: p.team === null || p.team === undefined ? null : p.team,
      score: p.score,
    }))
    // survivors first (by score), then the eliminated by how long they lasted
    .sort((a, b) => (a.eliminated ? 1 : 0) - (b.eliminated ? 1 : 0) || (a.eliminated ? (a.place || 99) - (b.place || 99) : 0) || b.score - a.score || a.name.localeCompare(b.name));
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
  addCustomQuestion,
  addCustomQuestions,
  removeCustomQuestion,
  MAX_CUSTOM_QUESTIONS,
  LIFELINES_PER_GAME,
  POLLS_PER_GAME,
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
