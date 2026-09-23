const EVENTS = require('./events');
const { QUESTIONS, QUESTION_DURATION_MS, isStealRound } = require('./questions');
const { calculateScore } = require('./scoring');
const { serializePlayers, countConnected, clearRoomTimers } = require('./rooms');

const REVEAL_TO_NEXT_MS = 5000;
const STEAL_DECISION_MS = 10000;
const STEAL_RESULT_TO_NEXT_MS = 4000;
const STEAL_POINTS = 150;

function leaderboard(room) {
  return serializePlayers(room);
}

function emitToRoom(io, room, event, payload) {
  io.to(room.code).emit(event, payload);
}

function startGame(io, room) {
  if (room.state !== 'lobby') return;
  for (const p of room.players.values()) p.score = 0;
  room.questionIndex = -1;
  goToNextQuestionOrFinish(io, room);
}

function beginQuestion(io, room) {
  clearRoomTimers(room);
  const q = QUESTIONS[room.questionIndex];
  const stealRound = isStealRound(room.questionIndex);
  const questionStartedAt = Date.now();
  const questionEndsAt = questionStartedAt + QUESTION_DURATION_MS;

  room.state = 'question';
  room.answers = new Map();
  room.stealState = null;
  room.currentQuestion = {
    text: q.text,
    choices: q.choices,
    correctIndex: q.correctIndex,
    isStealRound: stealRound,
    questionStartedAt,
    questionEndsAt,
  };

  const expectedIndex = room.questionIndex;
  room.timers.questionTimeout = setTimeout(() => {
    if (room.state !== 'question' || room.questionIndex !== expectedIndex) return;
    endQuestion(io, room);
  }, QUESTION_DURATION_MS);

  emitToRoom(io, room, EVENTS.QUESTION_START, {
    questionIndex: room.questionIndex,
    totalQuestions: QUESTIONS.length,
    text: q.text,
    choices: q.choices,
    questionEndsAt,
    isStealRound: stealRound,
    serverNow: Date.now(),
  });
}

function goToNextQuestionOrFinish(io, room) {
  const nextIndex = room.questionIndex + 1;
  if (nextIndex >= QUESTIONS.length) {
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
  if (room.answers.has(playerId)) return; // already answered, ignore repeats
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
  const { correctIndex, questionStartedAt, isStealRound: stealRound } = room.currentQuestion;
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
  let stealEligiblePlayerId = null;
  if (stealRound) {
    for (const [playerId, answer] of room.answers.entries()) {
      if (answer.choiceIndex === correctIndex) {
        const player = room.players.get(playerId);
        if (player && player.connected) stealEligiblePlayerId = playerId;
        break;
      }
    }
  }

  emitToRoom(io, room, EVENTS.QUESTION_REVEAL, {
    correctIndex,
    deltas,
    leaderboard: leaderboard(room),
    isStealRound: stealRound,
    stealEligiblePlayerId,
  });

  if (stealRound && stealEligiblePlayerId) {
    beginSteal(io, room, stealEligiblePlayerId);
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

function beginSteal(io, room, stealerId) {
  room.state = 'steal_prompt';
  const decisionEndsAt = Date.now() + STEAL_DECISION_MS;
  room.stealState = { stealerId, decisionEndsAt, resolved: false };

  const stealer = room.players.get(stealerId);
  const opponents = [...room.players.values()]
    .filter((p) => p.playerId !== stealerId)
    .map((p) => ({ playerId: p.playerId, name: p.name, score: p.score }));

  if (stealer && stealer.socketId) {
    io.to(stealer.socketId).emit(EVENTS.STEAL_PROMPT, { opponents, decisionEndsAt });
  }
  for (const p of room.players.values()) {
    if (p.playerId === stealerId || !p.socketId) continue;
    io.to(p.socketId).emit(EVENTS.STEAL_WAITING, { stealerName: stealer ? stealer.name : '', decisionEndsAt });
  }

  const expectedIndex = room.questionIndex;
  room.timers.stealTimeout = setTimeout(() => {
    if (room.questionIndex !== expectedIndex) return;
    if (room.state !== 'steal_prompt') return;
    resolveSteal(io, room, null);
  }, STEAL_DECISION_MS);
}

function resolveSteal(io, room, targetPlayerId) {
  if (room.state !== 'steal_prompt' || !room.stealState || room.stealState.resolved) return;
  clearRoomTimers(room);
  room.stealState.resolved = true;

  const stealer = room.players.get(room.stealState.stealerId);
  const target = targetPlayerId ? room.players.get(targetPlayerId) : null;
  let pointsMoved = 0;

  if (stealer && target && target.playerId !== stealer.playerId) {
    pointsMoved = Math.min(STEAL_POINTS, target.score);
    target.score -= pointsMoved;
    stealer.score += pointsMoved;
  }

  room.state = 'reveal';
  emitToRoom(io, room, EVENTS.STEAL_RESULT, {
    stealerId: stealer ? stealer.playerId : null,
    targetId: pointsMoved > 0 ? target.playerId : null,
    pointsMoved,
    leaderboard: leaderboard(room),
  });

  scheduleAdvance(io, room, STEAL_RESULT_TO_NEXT_MS);
}

function finalizeGame(io, room) {
  clearRoomTimers(room);
  room.state = 'final';
  room.currentQuestion = null;
  room.stealState = null;
  const board = leaderboard(room);
  emitToRoom(io, room, EVENTS.GAME_FINAL, { leaderboard: board, podium: board.slice(0, 3) });
}

function resetToLobby(io, room) {
  if (room.state !== 'final') return;
  clearRoomTimers(room);
  for (const p of room.players.values()) p.score = 0;
  room.questionIndex = -1;
  room.answers = new Map();
  room.currentQuestion = null;
  room.stealState = null;
  room.state = 'lobby';
  emitToRoom(io, room, EVENTS.GAME_RESET_TO_LOBBY, { players: serializePlayers(room) });
}

module.exports = {
  startGame,
  handleAnswerSubmit,
  maybeEndQuestionEarly,
  resolveSteal,
  resetToLobby,
  leaderboard,
};
