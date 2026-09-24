const EVENTS = require('./events');
const rooms = require('./rooms');
const game = require('./game');
const ai = require('./ai');
const bots = require('./bots');
const city = require('./city');
const maze = require('./maze');
const questionHistory = require('./questionHistory');
const { getQuestions, getCategoryList } = require('./questions');
const { getLevelList, getLevelLabel } = require('./levels');

const MIN_QUESTIONS_TO_START = 4;
const REACTIONS = ['👏', '😮', '🔥', '😂', '💀', '❤️', '🎉', '😎'];
const REACTION_GAP_MS = 600;
const MAX_NOTES_CHARS = 20000;
const MAX_PDF_BASE64 = 4_500_000; // ~3.3 MB of PDF
const LANGUAGES = new Set(['English', 'Hindi', 'Hinglish']);

function fanCounts(room) {
  const counts = {};
  for (const target of room.fans.values()) counts[target] = (counts[target] || 0) + 1;
  return counts;
}

// socket.id -> { roomCode, playerId }, so a disconnect knows which room/player it belonged to
const socketMeta = new Map();

function activeQuestionCount(room) {
  if (room.activeQuestions && room.activeQuestions.length) return room.activeQuestions.length;
  return room.category === 'custom' ? room.customQuestions.length : getQuestions(room.category).length;
}

function poolSummary(room) {
  return { questions: room.customQuestions.map((q) => ({ text: q.text })), count: room.customQuestions.length };
}

function buildRoomState(room) {
  const state = {
    state: room.state,
    players: rooms.serializePlayers(room),
    category: room.category,
    questionIndex: room.questionIndex,
    totalQuestions: activeQuestionCount(room),
    question: null,
    final: null,
    customPool: room.category === 'custom' ? poolSummary(room) : null,
    startsAt: room.state === 'starting' ? room.startsAt : null,
    serverNow: Date.now(),
    stagePlan: room.stagePlan,
    stage: room.stagePlan && room.activeQuestions.length ? game.stageInfo(room) : null,
    teamMode: room.teamMode,
    fans: fanCounts(room),
    city: room.state === 'city' && room.city ? city.initPayload(room) : null,
    maze: room.state === 'maze' && room.maze ? maze.initPayload(room) : null,
  };
  if (room.state === 'question' && room.currentQuestion) {
    const q = room.currentQuestion;
    state.question = {
      text: q.text,
      choices: q.choices,
      questionEndsAt: q.questionEndsAt,
      powerRoundType: q.powerRoundType,
      serverNow: Date.now(),
    };
  }
  if (room.state === 'final') {
    const board = rooms.serializePlayers(room);
    state.final = { leaderboard: board, podium: board.slice(0, 3), awards: room.awards || [], teams: game.teamStandings(room), teamMode: room.teamMode };
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
  socket.on(EVENTS.ROOM_CREATE, ({ name, avatar, category } = {}) => {
    const result = rooms.createRoom(name, avatar, socket.id, category);
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
    if (rooms.countConnected(room) < 2) return sendError(socket, 'NOT_ENOUGH_PLAYERS', 'Need at least 2 players to start.');
    if (room.category === 'custom' && room.customQuestions.length < MIN_QUESTIONS_TO_START) {
      return sendError(socket, 'NOT_ENOUGH_QUESTIONS', `Add at least ${MIN_QUESTIONS_TO_START} questions before starting.`);
    }
    game.startGame(io, room);
  });

  socket.on(EVENTS.ANSWER_SUBMIT, ({ choiceIndex } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    game.handleAnswerSubmit(io, ctx.room, ctx.player.playerId, choiceIndex);
  });

  socket.on(EVENTS.ROOM_LEAVE, () => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    socket.leave(room.code);
    socketMeta.delete(socket.id);
    game.handleLeave(io, room, player);
  });

  socket.on(EVENTS.CITY_INPUT, ({ dx, dy } = {}) => {
    const ctx = getContext(socket);
    if (ctx) city.setInput(ctx.room, ctx.player.playerId, dx, dy);
  });
  socket.on(EVENTS.CITY_ANSWER, ({ choiceIndex } = {}) => {
    const ctx = getContext(socket);
    if (ctx) city.answer(io, ctx.room, ctx.player.playerId, choiceIndex);
  });
  socket.on(EVENTS.CITY_ZAP, () => {
    const ctx = getContext(socket);
    if (ctx) city.zap(io, ctx.room, ctx.player.playerId);
  });

  socket.on(EVENTS.MAZE_INPUT, ({ dx, dy } = {}) => {
    const ctx = getContext(socket);
    if (ctx) maze.setInput(ctx.room, ctx.player.playerId, dx, dy);
  });
  socket.on(EVENTS.MAZE_ANSWER, ({ choiceIndex } = {}) => {
    const ctx = getContext(socket);
    if (ctx) maze.answer(io, ctx.room, ctx.player.playerId, choiceIndex);
  });
  socket.on(EVENTS.MAZE_FLASH, () => {
    const ctx = getContext(socket);
    if (ctx) maze.flash(io, ctx.room, ctx.player.playerId);
  });

  socket.on(EVENTS.TEAM_SET, ({ teams } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.isCreator) return sendError(socket, 'NOT_HOST', 'Only the room host can change team mode.');
    const result = game.setTeamMode(room, teams);
    if (result.error) return sendError(socket, 'GAME_IN_PROGRESS', 'Team mode can only be changed in the lobby.');
    io.to(room.code).emit(EVENTS.TEAM_UPDATE, { teamMode: room.teamMode });
  });

  // Quick emoji reactions, shown above the sender's table for everyone. Rate limited per player.
  socket.on(EVENTS.REACTION_SEND, ({ emoji } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!REACTIONS.includes(emoji) || room.state === 'lobby') return;
    const now = Date.now();
    if (now - (player.lastReactionAt || 0) < REACTION_GAP_MS) return;
    player.lastReactionAt = now;
    io.to(room.code).emit(EVENTS.REACTION_SHOW, { playerId: player.playerId, emoji });
  });

  // Eliminated spectators pick a contender to cheer for; it changes nothing about scoring.
  socket.on(EVENTS.FAN_SET, ({ targetId } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.eliminated || player.isBot) return;
    const target = room.players.get(targetId);
    if (!target || target.eliminated || target.left) return;
    room.fans.set(player.playerId, target.playerId);
    io.to(room.code).emit(EVENTS.FANS_UPDATE, { fans: fanCounts(room) });
  });

  socket.on(EVENTS.LIFELINE_USE, ({ type } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    game.useLifeline(io, ctx.room, ctx.player.playerId, type);
  });

  socket.on(EVENTS.STEAL_CHOOSE, ({ targetPlayerId } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.state !== 'steal_prompt' || !room.stealState || room.stealState.chooserId !== player.playerId) return;
    game.resolvePowerChoice(io, room, targetPlayerId || null);
  });

  socket.on(EVENTS.FREEZE_CHOOSE, ({ targetPlayerId } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.state !== 'freeze_prompt' || !room.stealState || room.stealState.chooserId !== player.playerId) return;
    game.resolvePowerChoice(io, room, targetPlayerId || null);
  });

  socket.on(EVENTS.BOT_ADD, ({ difficulty } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.isCreator) return sendError(socket, 'NOT_HOST', 'Only the room host can add a computer player.');
    const result = rooms.addBot(room, bots.BOT_TIERS[difficulty] ? difficulty : bots.DEFAULT_TIER);
    if (result.error) return sendError(socket, result.error.code, result.error.message);
    io.to(room.code).emit(EVENTS.PLAYER_LIST_UPDATE, { players: rooms.serializePlayers(room) });
  });

  socket.on(EVENTS.BOT_REMOVE, ({ playerId: botId } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.isCreator) return sendError(socket, 'NOT_HOST', 'Only the room host can remove a computer player.');
    const result = rooms.removeBot(room, botId);
    if (result.error) return sendError(socket, result.error.code, result.error.message);
    io.to(room.code).emit(EVENTS.PLAYER_LIST_UPDATE, { players: rooms.serializePlayers(room) });
  });

  socket.on(EVENTS.QUESTIONS_GENERATE, async ({ levelKey, subject, count, language, notes } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.isCreator) return sendError(socket, 'NOT_HOST', 'Only the room host can generate questions.');
    if (room.state !== 'lobby') return;
    if (room.category !== 'custom') return sendError(socket, 'WRONG_MODE', 'Switch the room category to Custom / Study Mode first.');
    if (!ai.isEnabled()) return sendError(socket, 'AI_DISABLED', 'AI question generation is not set up on this server.');
    // Optional study notes: pasted/plain text, or a small PDF the model reads directly.
    const cleanNotes = {};
    if (notes && typeof notes === 'object') {
      if (typeof notes.text === 'string' && notes.text.trim()) cleanNotes.text = notes.text.trim().slice(0, MAX_NOTES_CHARS);
      if (typeof notes.pdf === 'string' && notes.pdf) {
        if (notes.pdf.length > MAX_PDF_BASE64) return sendError(socket, 'NOTES_TOO_BIG', 'That PDF is too large — use one under about 3 MB.');
        if (!/^[A-Za-z0-9+/=]+$/.test(notes.pdf)) return sendError(socket, 'NOTES_INVALID', 'That PDF could not be read.');
        cleanNotes.pdf = notes.pdf;
      }
      if (typeof notes.name === 'string') cleanNotes.name = notes.name.slice(0, 80);
    }
    const hasNotes = !!(cleanNotes.text || cleanNotes.pdf);
    let cleanSubject = String(subject || '').trim().slice(0, 80);
    if (!cleanSubject && hasNotes) cleanSubject = cleanNotes.name || 'My notes';
    if (!cleanSubject) return sendError(socket, 'INVALID_SUBJECT', 'Enter a subject or topic first.');
    const cleanLanguage = LANGUAGES.has(language) ? language : 'English';
    const levelLabel = getLevelLabel(levelKey);

    io.to(room.code).emit(EVENTS.QUESTIONS_GENERATING, { level: levelLabel, subject: cleanSubject });
    try {
      const avoid = hasNotes ? [] : questionHistory.getRecent(levelKey, cleanSubject);
      const generated = await ai.generateQuestions({ levelLabel, subject: cleanSubject, count, avoid, language: cleanLanguage, notes: hasNotes ? cleanNotes : null });
      // Only commit the room's level/subject once generation actually succeeds —
      // otherwise a failed regenerate attempt would mislabel the existing pool
      // (from an earlier, successful subject) with the new, unused one.
      room.levelKey = levelKey;
      room.subject = cleanSubject;
      const added = rooms.addCustomQuestions(room, generated);
      if (!hasNotes) questionHistory.recordUsed(levelKey, cleanSubject, generated.map((q) => q.text));
      io.to(room.code).emit(EVENTS.QUESTION_POOL_UPDATE, poolSummary(room));
      if (added < generated.length) {
        sendError(socket, 'POOL_FULL', `Only added ${added} — the room hit its ${rooms.MAX_CUSTOM_QUESTIONS}-question cap.`);
      }
    } catch (err) {
      sendError(socket, 'AI_ERROR', err.message || 'Failed to generate questions.');
      io.to(room.code).emit(EVENTS.QUESTION_POOL_UPDATE, poolSummary(room));
    }
  });

  socket.on(EVENTS.QUESTION_ADD, ({ text, choices, correctIndex } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.isCreator) return sendError(socket, 'NOT_HOST', 'Only the room host can add questions.');
    const result = rooms.addCustomQuestion(room, { text, choices, correctIndex });
    if (result.error) return sendError(socket, result.error.code, result.error.message);
    io.to(room.code).emit(EVENTS.QUESTION_POOL_UPDATE, poolSummary(room));
  });

  socket.on(EVENTS.QUESTION_REMOVE, ({ index } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.isCreator) return sendError(socket, 'NOT_HOST', 'Only the room host can remove questions.');
    const result = rooms.removeCustomQuestion(room, index);
    if (result.error) return sendError(socket, result.error.code, result.error.message);
    io.to(room.code).emit(EVENTS.QUESTION_POOL_UPDATE, poolSummary(room));
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

    if (room.state === 'question') {
      game.maybeEndQuestionEarly(io, room);
    } else if (
      (room.state === 'steal_prompt' || room.state === 'freeze_prompt') &&
      room.stealState &&
      room.stealState.chooserId === meta.playerId
    ) {
      game.resolvePowerChoice(io, room, null);
    }
  });
}

module.exports = { register, getCategoryList, getLevelList };
