const EVENTS = require('./events');
const { getQuestions, getCategoryLabel, QUESTION_DURATION_MS, getPowerRoundType } = require('./questions');
const { getLevelLabel } = require('./levels');
const { calculateScore } = require('./scoring');
const { serializePlayers, countConnected, clearRoomTimers } = require('./rooms');
const db = require('./db');

const REVEAL_TO_NEXT_MS = 5000;
const POWER_DECISION_MS = 10000;
const POWER_RESULT_TO_NEXT_MS = 4000;
const STEAL_POINTS = 150;
const BOT_ACCURACY = 0.65; // chance a bot answers correctly
const BOT_ANSWER_MIN_DELAY_MS = 1500;
const BOT_POWER_DECISION_DELAY_MS = [1200, 3200]; // [min, max]
const BOT_POWER_ACT_CHANCE = 0.85; // chance a bot uses its steal/freeze rather than skipping

function randomWrongIndex(correctIndex) {
  let i;
  do {
    i = Math.floor(Math.random() * 4);
  } while (i === correctIndex);
  return i;
}

function leaderboard(room) {
  return serializePlayers(room);
}

function shuffled(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getActiveQuestions(room) {
  return room.activeQuestions;
}

function emitToRoom(io, room, event, payload) {
  io.to(room.code).emit(event, payload);
}

function startGame(io, room) {
  if (room.state !== 'lobby') return;
  for (const p of room.players.values()) p.score = 0;
  room.questionIndex = -1;
  room.frozenPlayerId = null;
  // Freshly shuffled per room so the same category never plays in the same
  // order twice in a row — a room replayed with Play Again reshuffles again too.
  room.activeQuestions = room.category === 'custom' ? room.customQuestions.slice() : shuffled(getQuestions(room.category));
  goToNextQuestionOrFinish(io, room);
}

function beginQuestion(io, room) {
  clearRoomTimers(room);
  const questions = getActiveQuestions(room);
  const q = questions[room.questionIndex];
  const powerRoundType = getPowerRoundType(room.questionIndex);
  const questionStartedAt = Date.now();
  const questionEndsAt = questionStartedAt + QUESTION_DURATION_MS;

  room.state = 'question';
  room.answers = new Map();
  room.stealState = null;
  room.currentQuestion = {
    text: q.text,
    choices: q.choices,
    correctIndex: q.correctIndex,
    powerRoundType,
    questionStartedAt,
    questionEndsAt,
  };

  // A Freeze Round choice from the previous question locks this one player
  // out of answering — pre-seed a losing "answer" so they can't submit one.
  const frozenId = room.frozenPlayerId;
  room.frozenPlayerId = null;
  if (frozenId && room.players.has(frozenId)) {
    room.answers.set(frozenId, { choiceIndex: -1, answeredAt: questionStartedAt });
  }

  const expectedIndex = room.questionIndex;
  room.timers.questionTimeout = setTimeout(() => {
    if (room.state !== 'question' || room.questionIndex !== expectedIndex) return;
    endQuestion(io, room);
  }, QUESTION_DURATION_MS);

  emitToRoom(io, room, EVENTS.QUESTION_START, {
    questionIndex: room.questionIndex,
    totalQuestions: questions.length,
    text: q.text,
    choices: q.choices,
    questionEndsAt,
    powerRoundType,
    frozenPlayerId: frozenId || null,
    serverNow: Date.now(),
  });

  scheduleBotAnswers(io, room);
  maybeEndQuestionEarly(io, room);
}

function scheduleBotAnswers(io, room) {
  const { correctIndex } = room.currentQuestion;
  const expectedIndex = room.questionIndex;
  for (const bot of room.players.values()) {
    if (!bot.isBot || !bot.connected) continue;
    if (room.answers.has(bot.playerId)) continue; // frozen this round
    const window = Math.max(2000, QUESTION_DURATION_MS - BOT_ANSWER_MIN_DELAY_MS * 2);
    const delay = BOT_ANSWER_MIN_DELAY_MS + Math.random() * window;
    const choice = Math.random() < BOT_ACCURACY ? correctIndex : randomWrongIndex(correctIndex);
    const timer = setTimeout(() => {
      if (room.questionIndex !== expectedIndex || room.state !== 'question') return;
      handleAnswerSubmit(io, room, bot.playerId, choice);
    }, delay);
    room.timers.botTimeouts.push(timer);
  }
}

function goToNextQuestionOrFinish(io, room) {
  const nextIndex = room.questionIndex + 1;
  const questions = getActiveQuestions(room);
  if (nextIndex >= questions.length) {
    finalizeGame(io, room);
    return;
  }
  room.questionIndex = nextIndex;
  beginQuestion(io, room);
}

function handleAnswerSubmit(io, room, playerId, choiceIndex) {
  if (room.state !== 'question') return;
  const player = room.players.get(playerId);
  if (!player || !player.connected) return;
  if (room.answers.has(playerId)) return; // already answered (or frozen this round), ignore
  if (typeof choiceIndex !== 'number' || choiceIndex < 0 || choiceIndex > 3) return;

  room.answers.set(playerId, { choiceIndex, answeredAt: Date.now() });
  if (player.socketId) io.to(player.socketId).emit(EVENTS.ANSWER_ACK, { choiceIndex });

  maybeEndQuestionEarly(io, room);
}

function maybeEndQuestionEarly(io, room) {
  if (room.state !== 'question') return;
  if (room.answers.size >= countConnected(room) && countConnected(room) > 0) {
    endQuestion(io, room);
  }
}

function endQuestion(io, room) {
  if (room.state !== 'question') return;
  clearRoomTimers(room);
  const { correctIndex, questionStartedAt, powerRoundType } = room.currentQuestion;
  const deltas = {};

  for (const [playerId, player] of room.players.entries()) {
    const answer = room.answers.get(playerId);
    let delta = 0;
    if (answer) {
      const isCorrect = answer.choiceIndex === correctIndex;
      delta = calculateScore(answer.answeredAt, questionStartedAt, QUESTION_DURATION_MS, isCorrect);
    }
    if (delta) player.score += delta;
    deltas[playerId] = delta;
  }

  room.state = 'reveal';

  // Fastest correct answer = first matching entry in the answers Map (insertion order = arrival order)
  let powerEligiblePlayerId = null;
  if (powerRoundType) {
    for (const [playerId, answer] of room.answers.entries()) {
      if (answer.choiceIndex === correctIndex) {
        const player = room.players.get(playerId);
        if (player && player.connected) powerEligiblePlayerId = playerId;
        break;
      }
    }
  }

  emitToRoom(io, room, EVENTS.QUESTION_REVEAL, {
    correctIndex,
    deltas,
    leaderboard: leaderboard(room),
    powerRoundType,
    powerEligiblePlayerId,
  });

  if (powerRoundType && powerEligiblePlayerId) {
    beginPowerPrompt(io, room, powerRoundType, powerEligiblePlayerId);
  } else {
    scheduleAdvance(io, room, REVEAL_TO_NEXT_MS);
  }
}

function scheduleAdvance(io, room, delayMs) {
  const expectedIndex = room.questionIndex;
  room.timers.revealTimeout = setTimeout(() => {
    if (room.questionIndex !== expectedIndex) return;
    if (room.state !== 'reveal') return;
    goToNextQuestionOrFinish(io, room);
  }, delayMs);
}

function beginPowerPrompt(io, room, type, chooserId) {
  room.state = type === 'steal' ? 'steal_prompt' : 'freeze_prompt';
  const decisionEndsAt = Date.now() + POWER_DECISION_MS;
  room.stealState = { type, chooserId, decisionEndsAt, resolved: false };

  const chooser = room.players.get(chooserId);
  const opponents = [...room.players.values()]
    .filter((p) => p.playerId !== chooserId)
    .map((p) => ({ playerId: p.playerId, name: p.name, avatar: p.avatar, score: p.score }));

  const promptEvent = type === 'steal' ? EVENTS.STEAL_PROMPT : EVENTS.FREEZE_PROMPT;
  const waitingEvent = type === 'steal' ? EVENTS.STEAL_WAITING : EVENTS.FREEZE_WAITING;

  if (chooser && chooser.socketId) {
    io.to(chooser.socketId).emit(promptEvent, { opponents, decisionEndsAt });
  }
  for (const p of room.players.values()) {
    if (p.playerId === chooserId || !p.socketId) continue;
    io.to(p.socketId).emit(waitingEvent, { chooserName: chooser ? chooser.name : '', decisionEndsAt });
  }

  const expectedIndex = room.questionIndex;
  room.timers.stealTimeout = setTimeout(() => {
    if (room.questionIndex !== expectedIndex) return;
    if (room.state !== 'steal_prompt' && room.state !== 'freeze_prompt') return;
    resolvePowerChoice(io, room, null);
  }, POWER_DECISION_MS);

  if (chooser && chooser.isBot) {
    const [minDelay, maxDelay] = BOT_POWER_DECISION_DELAY_MS;
    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    const botTimer = setTimeout(() => {
      if (room.questionIndex !== expectedIndex) return;
      if (room.state !== 'steal_prompt' && room.state !== 'freeze_prompt') return;
      const willAct = Math.random() < BOT_POWER_ACT_CHANCE;
      const best = willAct ? opponents.slice().sort((a, b) => b.score - a.score)[0] : null;
      resolvePowerChoice(io, room, best ? best.playerId : null);
    }, delay);
    room.timers.botTimeouts.push(botTimer);
  }
}

function resolvePowerChoice(io, room, targetPlayerId) {
  if ((room.state !== 'steal_prompt' && room.state !== 'freeze_prompt') || !room.stealState || room.stealState.resolved) return;
  clearRoomTimers(room);
  room.stealState.resolved = true;

  const { type, chooserId } = room.stealState;
  const chooser = room.players.get(chooserId);
  const target = targetPlayerId ? room.players.get(targetPlayerId) : null;
  const validTarget = chooser && target && target.playerId !== chooser.playerId;

  room.state = 'reveal';

  if (type === 'steal') {
    let pointsMoved = 0;
    if (validTarget) {
      pointsMoved = Math.min(STEAL_POINTS, target.score);
      target.score -= pointsMoved;
      chooser.score += pointsMoved;
    }
    emitToRoom(io, room, EVENTS.STEAL_RESULT, {
      stealerId: chooser ? chooser.playerId : null,
      targetId: pointsMoved > 0 ? target.playerId : null,
      pointsMoved,
      leaderboard: leaderboard(room),
    });
  } else {
    let frozenTargetId = null;
    if (validTarget) {
      room.frozenPlayerId = target.playerId;
      frozenTargetId = target.playerId;
    }
    emitToRoom(io, room, EVENTS.FREEZE_RESULT, {
      freezerId: chooser ? chooser.playerId : null,
      targetId: frozenTargetId,
      targetName: frozenTargetId ? target.name : null,
      leaderboard: leaderboard(room),
    });
  }

  scheduleAdvance(io, room, POWER_RESULT_TO_NEXT_MS);
}

function finalizeGame(io, room) {
  clearRoomTimers(room);
  room.state = 'final';
  room.currentQuestion = null;
  room.stealState = null;
  room.frozenPlayerId = null;
  const board = leaderboard(room);
  emitToRoom(io, room, EVENTS.GAME_FINAL, { leaderboard: board, podium: board.slice(0, 3) });

  db.saveGameResult({
    roomCode: room.code,
    category: room.category,
    categoryLabel: getCategoryLabel(room.category),
    levelKey: room.category === 'custom' ? room.levelKey : null,
    levelLabel: room.category === 'custom' && room.levelKey ? getLevelLabel(room.levelKey) : null,
    subject: room.category === 'custom' ? room.subject : null,
    players: board,
  });
}

function resetToLobby(io, room) {
  if (room.state !== 'final') return;
  clearRoomTimers(room);
  for (const p of room.players.values()) p.score = 0;
  room.questionIndex = -1;
  room.answers = new Map();
  room.currentQuestion = null;
  room.stealState = null;
  room.frozenPlayerId = null;
  room.state = 'lobby';
  emitToRoom(io, room, EVENTS.GAME_RESET_TO_LOBBY, { players: serializePlayers(room) });
}

module.exports = {
  startGame,
  handleAnswerSubmit,
  maybeEndQuestionEarly,
  resolvePowerChoice,
  resetToLobby,
  leaderboard,
};
