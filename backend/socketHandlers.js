const EVENTS = require('./events');
const rooms = require('./rooms');
const game = require('./game');
const ai = require('./ai');
const bots = require('./bots');
const questionHistory = require('./questionHistory');
const { getQuestions, getCategoryList } = require('./questions');
const { getLevelList, getLevelLabel } = require('./levels');

const MIN_QUESTIONS_TO_START = 4;

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

  socket.on(EVENTS.QUESTIONS_GENERATE, async ({ levelKey, subject, count } = {}) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.isCreator) return sendError(socket, 'NOT_HOST', 'Only the room host can generate questions.');
    if (room.state !== 'lobby') return;
    if (room.category !== 'custom') return sendError(socket, 'WRONG_MODE', 'Switch the room category to Custom / Study Mode first.');
    if (!ai.isEnabled()) return sendError(socket, 'AI_DISABLED', 'AI question generation is not set up on this server.');
    const cleanSubject = String(subject || '').trim().slice(0, 80);
    if (!cleanSubject) return sendError(socket, 'INVALID_SUBJECT', 'Enter a subject or topic first.');
    const levelLabel = getLevelLabel(levelKey);

    io.to(room.code).emit(EVENTS.QUESTIONS_GENERATING, { level: levelLabel, subject: cleanSubject });
    try {
      const avoid = questionHistory.getRecent(levelKey, cleanSubject);
      const generated = await ai.generateQuestions({ levelLabel, subject: cleanSubject, count, avoid });
      // Only commit the room's level/subject once generation actually succeeds —
      // otherwise a failed regenerate attempt would mislabel the existing pool
      // (from an earlier, successful subject) with the new, unused one.
      room.levelKey = levelKey;
      room.subject = cleanSubject;
      const added = rooms.addCustomQuestions(room, generated);
      questionHistory.recordUsed(levelKey, cleanSubject, generated.map((q) => q.text));
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
