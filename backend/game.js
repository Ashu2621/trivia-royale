const EVENTS = require('./events');
const { getQuestions, getCategoryLabel, QUESTION_DURATION_MS, getPowerRoundType } = require('./questions');
const { getLevelLabel } = require('./levels');
const { calculateScore } = require('./scoring');
const rooms = require('./rooms');
const { serializePlayers, clearRoomTimers, LIFELINES_PER_GAME, POLLS_PER_GAME } = rooms;
const bots = require('./bots');
const { pickLine } = require('./botLines');
const city = require('./city');
const db = require('./db');

const START_COUNTDOWN_MS = 3400;
const TRANSITION_MS = 7800; // the between-levels walk: eliminations, then the survivors run to the next room
const STAGE_NAMES = {
  2: ['Qualifier', 'Grand Final'],
  3: ['Qualifier', 'Semi-final', 'Grand Final'],
  4: ['Qualifier', 'Quarter-final', 'Semi-final', 'Grand Final'],
};
const TEAM_NAMES = ['Red', 'Blue', 'Green', 'Gold'];
const REVEAL_TO_NEXT_MS = 5000;
const POWER_DECISION_MS = 10000;
const POWER_RESULT_TO_NEXT_MS = 4000;
const STEAL_POINTS = 150;
const LIFELINE_SCORE_FACTOR = { fifty: 0.6, poll: 0.8 }; // points kept when an answer used a booster
const STREAK_BONUS_STEP = 50; // each consecutive correct answer beyond the first adds this much...
const STREAK_BONUS_CAP = 200; // ...up to this cap

function streakBonus(streak) {
  return Math.min(STREAK_BONUS_CAP, Math.max(0, streak - 1) * STREAK_BONUS_STEP);
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

// ---- Levels (stages) and elimination ----
const isAlive = (p) => !p.eliminated && !p.left;

function countAliveConnected(room) {
  let n = 0;
  for (const p of room.players.values()) if (isAlive(p) && p.connected) n += 1;
  return n;
}

// Anyone still watching or playing. An eliminated human stays to spectate the rest
// of the tournament; the match only ends early once every human has walked away.
function humansAlive(room) {
  for (const p of room.players.values()) if (!p.isBot && !p.left && p.connected) return true;
  return false;
}

// Split a match into 2-4 levels; each level ends with a cut.
function planStages(total) {
  const wanted = Math.min(4, Math.max(2, Math.floor(total / 3)));
  const per = Math.ceil(total / wanted);
  const count = Math.ceil(total / per);
  return { count, per, total, names: STAGE_NAMES[count] || STAGE_NAMES[2] };
}

function stageIndexOf(room, questionIndex) {
  const plan = room.stagePlan;
  return Math.min(plan.count - 1, Math.floor(questionIndex / plan.per));
}

function stageInfo(room) {
  const plan = room.stagePlan;
  const index = stageIndexOf(room, Math.max(0, room.questionIndex));
  const start = index * plan.per;
  const end = Math.min(room.activeQuestions.length, start + plan.per);
  return {
    index,
    count: plan.count,
    per: plan.per,
    names: plan.names,
    name: plan.names[index],
    sub: Math.max(0, room.questionIndex - start),
    subCount: end - start,
    alive: [...room.players.values()].filter(isAlive).length,
  };
}

function isStageBoundary(room, questionIndex) {
  const next = questionIndex + 1;
  return next < room.activeQuestions.length && stageIndexOf(room, next) > stageIndexOf(room, questionIndex);
}

// ---- Teams ----
function teamScores(room) {
  const totals = TEAM_NAMES.slice(0, room.teamMode).map((name, team) => ({ team, name, score: 0, members: [], alive: 0 }));
  for (const p of room.players.values()) {
    if (p.team === null || p.team === undefined || !totals[p.team]) continue;
    totals[p.team].score += p.score;
    totals[p.team].members.push(p.playerId);
    if (isAlive(p)) totals[p.team].alive += 1;
  }
  return totals;
}

// Survivors first (by team score), then eliminated teams by how long they lasted.
function teamStandings(room) {
  if (!room.teamMode) return null;
  const place = room.teamPlace || {};
  return teamScores(room)
    .map((t) => ({ ...t, eliminated: t.alive === 0, place: place[t.team] || null }))
    .sort((a, b) => (a.eliminated ? 1 : 0) - (b.eliminated ? 1 : 0) || (a.eliminated ? (a.place || 99) - (b.place || 99) : 0) || b.score - a.score || a.team - b.team);
}

function assignTeams(room) {
  const list = [...room.players.values()].sort((a, b) => (a.isBot ? 1 : 0) - (b.isBot ? 1 : 0));
  const count = Math.max(2, Math.min(room.teamMode, list.length));
  room.teamMode = count;
  list.forEach((p, i) => { p.team = i % count; });
}

function setTeamMode(room, count) {
  if (room.state !== 'lobby') return { error: 'GAME_IN_PROGRESS' };
  const n = Number(count);
  room.teamMode = n >= 2 && n <= 4 ? n : 0;
  return { ok: true };
}

// ---- Match stats and awards ----
function statsOf(room, id) {
  let st = room.stats.get(id);
  if (!st) {
    st = { answers: 0, correct: 0, correctMs: 0, bestStreak: 0, stolen: 0, worstRank: 1 };
    room.stats.set(id, st);
  }
  return st;
}

function computeAwards(room, board) {
  const awards = [];
  const name = (id) => (room.players.get(id) ? room.players.get(id).name : '?');
  const entries = [...room.stats.entries()].filter(([id]) => room.players.has(id));

  const fast = entries.filter(([, st]) => st.correct >= 3).map(([id, st]) => ({ id, avg: st.correctMs / st.correct })).sort((a, b) => a.avg - b.avg)[0];
  if (fast) awards.push({ key: 'fastest', icon: '⚡', title: 'Fastest Finger', playerId: fast.id, detail: `${(fast.avg / 1000).toFixed(1)}s average` });

  const streak = entries.filter(([, st]) => st.bestStreak >= 3).sort((a, b) => b[1].bestStreak - a[1].bestStreak)[0];
  if (streak) awards.push({ key: 'streak', icon: '🔥', title: 'Streak King', playerId: streak[0], detail: `${streak[1].bestStreak} in a row` });

  const sharp = entries
    .filter(([, st]) => st.answers >= 5 && st.correct >= 4)
    .map(([id, st]) => ({ id, acc: st.correct / st.answers, correct: st.correct, answers: st.answers }))
    .sort((a, b) => b.acc - a.acc || b.correct - a.correct)[0];
  if (sharp) awards.push({ key: 'sharp', icon: '🎯', title: 'Sharpshooter', playerId: sharp.id, detail: `${Math.round(sharp.acc * 100)}% correct` });

  const thief = entries.filter(([, st]) => st.stolen > 0).sort((a, b) => b[1].stolen - a[1].stolen)[0];
  if (thief) awards.push({ key: 'thief', icon: '🕵️', title: 'Point Thief', playerId: thief[0], detail: `+${thief[1].stolen} stolen` });

  const rankOf = new Map(board.map((p, i) => [p.playerId, i + 1]));
  const climb = entries
    .map(([id, st]) => ({ id, climb: st.worstRank - (rankOf.get(id) || st.worstRank) }))
    .filter((c) => c.climb >= 2 && room.players.get(c.id) && !room.players.get(c.id).eliminated)
    .sort((a, b) => b.climb - a.climb)[0];
  if (climb) awards.push({ key: 'comeback', icon: '🧗', title: 'Comeback Kid', playerId: climb.id, detail: `climbed ${climb.climb} places` });

  return awards.map((a) => ({ ...a, name: name(a.playerId) }));
}

// ---- Bot banter ----
function botSay(io, room, bot, kind, chance) {
  if (!bot || !bot.isBot || Math.random() > chance) return;
  const now = Date.now();
  if (now - (bot.lastSayAt || 0) < 5000) return;
  const text = pickLine(bot.botTier, kind);
  if (!text) return;
  bot.lastSayAt = now;
  io.to(room.code).emit(EVENTS.BOT_SAY, { playerId: bot.playerId, text });
}

function getActiveQuestions(room) {
  return room.activeQuestions;
}

function emitToRoom(io, room, event, payload) {
  io.to(room.code).emit(event, payload);
}

function startGame(io, room) {
  if (room.state !== 'lobby') return;
  if (room.category === 'city') {
    clearRoomTimers(room);
    room.stats = new Map();
    room.fans = new Map();
    room.teamPlace = {};
    room.awards = null;
    room.teamMode = 0;
    city.startCity(io, room);
    return;
  }
  for (const p of room.players.values()) {
    p.score = 0;
    p.streak = 0;
    p.lifelines = LIFELINES_PER_GAME;
    p.polls = POLLS_PER_GAME;
    p.eliminated = false;
    p.place = null;
    p.left = false;
    p.team = null;
  }
  room.stats = new Map();
  room.fans = new Map();
  room.teamPlace = {};
  if (room.teamMode) assignTeams(room);
  room.questionIndex = -1;
  room.frozenPlayerId = null;
  // Freshly shuffled per room so the same category never plays in the same
  // order twice in a row — a room replayed with Play Again reshuffles again too.
  room.activeQuestions = room.category === 'custom'
    ? room.customQuestions.slice()
    : room.category === 'daily'
      ? getQuestions('daily').slice() // the same questions, in the same order, for everyone today
      : shuffled(getQuestions(room.category));

  // A short "get ready" beat so every device is on the question screen together.
  room.stagePlan = planStages(room.activeQuestions.length);
  room.state = 'starting';
  const startsAt = Date.now() + START_COUNTDOWN_MS;
  room.startsAt = startsAt;
  emitToRoom(io, room, EVENTS.GAME_STARTING, {
    startsAt,
    serverNow: Date.now(),
    totalQuestions: room.activeQuestions.length,
    stagePlan: room.stagePlan,
    teamMode: room.teamMode,
    players: serializePlayers(room),
  });
  room.timers.revealTimeout = setTimeout(() => {
    if (room.state !== 'starting') return;
    goToNextQuestionOrFinish(io, room);
  }, START_COUNTDOWN_MS);
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
  room.assisted = new Map(); // playerId -> 'fifty' | 'poll'
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
  if (frozenId && room.players.has(frozenId) && isAlive(room.players.get(frozenId))) {
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
    stage: stageInfo(room),
    players: serializePlayers(room),
  });

  scheduleBotAnswers(io, room);
  maybeEndQuestionEarly(io, room);
}

function scheduleBotAnswers(io, room) {
  const expectedIndex = room.questionIndex;
  for (const bot of room.players.values()) {
    if (!bot.isBot || !bot.connected || !isAlive(bot)) continue;
    if (room.answers.has(bot.playerId)) continue; // frozen this round
    const plan = bots.planAnswer(bot.botTier, room.currentQuestion, QUESTION_DURATION_MS, bot);
    const timer = setTimeout(() => {
      if (room.questionIndex !== expectedIndex || room.state !== 'question') return;
      handleAnswerSubmit(io, room, bot.playerId, plan.choiceIndex);
      botSay(io, room, bot, 'lock', 0.1);
    }, plan.delay);
    room.timers.botTimeouts.push(timer);
  }
}

// Called after a question's reveal: either straight on to the next question,
// or through the between-levels walk when a level has just ended.
function advance(io, room) {
  if (!humansAlive(room)) {
    finalizeGame(io, room);
    return;
  }
  if (isStageBoundary(room, room.questionIndex)) {
    beginTransition(io, room);
    return;
  }
  goToNextQuestionOrFinish(io, room);
}

function beginTransition(io, room) {
  clearRoomTimers(room);
  const completed = stageIndexOf(room, room.questionIndex);
  let survivors;
  let out;
  if (room.teamMode) {
    // Team mode: whole teams are cut. With only two teams left nobody is cut.
    const alive = teamScores(room).filter((t) => t.alive > 0).sort((a, b) => b.score - a.score || a.team - b.team);
    const cut = alive.length <= 2 ? 0 : Math.max(1, Math.floor(alive.length / 3));
    const keep = alive.slice(0, alive.length - cut);
    const gone = alive.slice(alive.length - cut);
    gone.forEach((t, i) => { room.teamPlace[t.team] = keep.length + 1 + i; });
    const goneTeams = new Set(gone.map((t) => t.team));
    const players = [...room.players.values()].filter(isAlive);
    survivors = players.filter((p) => !goneTeams.has(p.team));
    out = players.filter((p) => goneTeams.has(p.team)).sort((a, b) => a.team - b.team || b.score - a.score);
    out.forEach((p) => {
      p.eliminated = true;
      p.place = room.teamPlace[p.team];
      p.streak = 0;
    });
  } else {
    const alive = [...room.players.values()].filter(isAlive).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    // Cut the bottom third (never below two survivors), like a battle-royale zone closing in.
    const cut = alive.length <= 2 ? 0 : Math.max(1, Math.floor(alive.length / 3));
    survivors = alive.slice(0, alive.length - cut);
    out = alive.slice(alive.length - cut);
    out.forEach((p, i) => {
      p.eliminated = true;
      p.place = survivors.length + 1 + i;
      p.streak = 0;
    });
  }
  out.forEach((p) => { if (p.isBot) botSay(io, room, p, 'out', 1); });
  room.fans = new Map(); // supporters of anyone who just fell need a new favourite
  if (room.frozenPlayerId && !isAlive(room.players.get(room.frozenPlayerId) || {})) room.frozenPlayerId = null;

  room.state = 'transition';
  emitToRoom(io, room, EVENTS.STAGE_TRANSITION, {
    completedStage: completed,
    nextStage: completed + 1,
    stagePlan: room.stagePlan,
    advancing: survivors.map((p) => p.playerId),
    eliminated: out.map((p) => ({ playerId: p.playerId, place: p.place })),
    leaderboard: leaderboard(room),
    teams: teamStandings(room),
    durationMs: TRANSITION_MS,
    serverNow: Date.now(),
  });
  room.timers.revealTimeout = setTimeout(() => {
    if (room.state !== 'transition') return;
    if (!humansAlive(room)) finalizeGame(io, room);
    else goToNextQuestionOrFinish(io, room);
  }, TRANSITION_MS);
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
  if (!player || !player.connected || !isAlive(player)) return;
  if (room.answers.has(playerId)) return; // already answered (or frozen this round), ignore
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex > 3) return;

  room.answers.set(playerId, { choiceIndex, answeredAt: Date.now() });
  if (player.socketId) io.to(player.socketId).emit(EVENTS.ANSWER_ACK, { choiceIndex });
  // Tell everyone who has locked in (never which answer) so the room can feel the race.
  emitToRoom(io, room, EVENTS.ANSWER_PROGRESS, {
    playerId,
    answered: room.answers.size,
    total: countAliveConnected(room),
    elapsedMs: Math.max(0, Date.now() - room.currentQuestion.questionStartedAt),
  });

  maybeEndQuestionEarly(io, room);
}

// Audience poll: a fake-but-plausible studio audience vote. Usually leans toward the
// right answer, but (like the real thing) is sometimes confidently wrong.
function buildPoll(correctIndex) {
  const misleading = Math.random() < 0.14;
  const leader = misleading ? [0, 1, 2, 3].filter((i) => i !== correctIndex)[Math.floor(Math.random() * 3)] : correctIndex;
  const leaderShare = misleading ? 38 + Math.random() * 14 : 48 + Math.random() * 34;
  const weights = [0, 1, 2, 3].map((i) => (i === leader ? 0 : 0.2 + Math.random()));
  const rest = weights.reduce((n, w) => n + w, 0);
  const poll = weights.map((w, i) => (i === leader ? Math.round(leaderShare) : Math.floor(((100 - leaderShare) * w) / rest)));
  poll[leader] += 100 - poll.reduce((n, v) => n + v, 0);
  return poll;
}

// Boosters: 'fifty' removes two wrong answers, 'poll' shows the audience vote.
// One booster per question, each at a points discount.
function useLifeline(io, room, playerId, type) {
  if (room.state !== 'question' || !room.currentQuestion) return;
  const kind = type === 'poll' ? 'poll' : 'fifty';
  const player = room.players.get(playerId);
  if (!player || !player.connected || player.isBot || !isAlive(player)) return;
  if (room.answers.has(playerId)) return; // already answered or frozen
  if (room.assisted.has(playerId)) return; // once per question
  if ((kind === 'poll' ? player.polls : player.lifelines) <= 0) return;

  const payload = { type: kind };
  if (kind === 'poll') {
    player.polls -= 1;
    payload.poll = buildPoll(room.currentQuestion.correctIndex);
  } else {
    const wrong = [0, 1, 2, 3].filter((i) => i !== room.currentQuestion.correctIndex);
    payload.removed = shuffled(wrong).slice(0, 2);
    player.lifelines -= 1;
  }
  room.assisted.set(playerId, kind);
  payload.lifelines = player.lifelines;
  payload.polls = player.polls;
  if (player.socketId) io.to(player.socketId).emit(EVENTS.LIFELINE_RESULT, payload);
}

function maybeEndQuestionEarly(io, room) {
  if (room.state !== 'question') return;
  const expected = countAliveConnected(room);
  if (room.answers.size >= expected && expected > 0) {
    endQuestion(io, room);
  }
}

function endQuestion(io, room) {
  if (room.state !== 'question') return;
  clearRoomTimers(room);
  const { correctIndex, questionStartedAt, powerRoundType } = room.currentQuestion;
  const deltas = {};
  const bonuses = {};
  const assisted = {};

  for (const [playerId, player] of room.players.entries()) {
    if (!isAlive(player)) {
      deltas[playerId] = 0;
      bonuses[playerId] = 0;
      continue;
    }
    const answer = room.answers.get(playerId);
    const frozen = !!answer && answer.choiceIndex === -1;
    let delta = 0;
    let bonus = 0;
    if (answer && !frozen) {
      const isCorrect = answer.choiceIndex === correctIndex;
      if (isCorrect) {
        let base = calculateScore(answer.answeredAt, questionStartedAt, QUESTION_DURATION_MS, true);
        if (room.assisted && room.assisted.has(playerId)) {
          const kind = room.assisted.get(playerId);
          base = Math.round(base * LIFELINE_SCORE_FACTOR[kind]);
          assisted[playerId] = kind;
        }
        player.streak = (player.streak || 0) + 1;
        bonus = streakBonus(player.streak);
        delta = base + bonus;
        const st = statsOf(room, playerId);
        st.answers += 1;
        st.correct += 1;
        st.correctMs += Math.max(0, answer.answeredAt - questionStartedAt);
        st.bestStreak = Math.max(st.bestStreak, player.streak);
        if (player.isBot && Math.random() < 0.6) botSay(io, room, player, player.streak >= 2 ? 'right' : 'lock', 0.3);
      } else {
        player.streak = 0;
        statsOf(room, playerId).answers += 1;
        if (player.isBot) botSay(io, room, player, 'wrong', 0.3);
      }
    } else if (!frozen) {
      player.streak = 0; // no answer at all breaks the streak; being frozen does not
    }
    if (delta) player.score += delta;
    deltas[playerId] = delta;
    bonuses[playerId] = bonus;
  }

  room.state = 'reveal';

  // Track how far each contender has fallen, for the "comeback" award.
  [...room.players.values()].filter(isAlive).sort((a, b) => b.score - a.score).forEach((p, i) => {
    const st = statsOf(room, p.playerId);
    st.worstRank = Math.max(st.worstRank, i + 1);
  });

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
    bonuses,
    assisted,
    choices: Object.fromEntries([...room.answers.entries()].filter(([, a]) => a.choiceIndex >= 0).map(([id, a]) => [id, a.choiceIndex])),
    times: Object.fromEntries([...room.answers.entries()].filter(([, a]) => a.choiceIndex >= 0).map(([id, a]) => [id, a.answeredAt - questionStartedAt])),
    streaks: Object.fromEntries([...room.players.entries()].map(([id, p]) => [id, p.streak || 0])),
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
    advance(io, room);
  }, delayMs);
}

function beginPowerPrompt(io, room, type, chooserId) {
  room.state = type === 'steal' ? 'steal_prompt' : 'freeze_prompt';
  const decisionEndsAt = Date.now() + POWER_DECISION_MS;
  room.stealState = { type, chooserId, decisionEndsAt, resolved: false };

  const chooser = room.players.get(chooserId);
  const opponents = [...room.players.values()]
    .filter((p) => p.playerId !== chooserId && isAlive(p) && !(room.teamMode && chooser && p.team === chooser.team))
    .map((p) => ({ playerId: p.playerId, name: p.name, avatar: p.avatar, score: p.score }));

  const promptEvent = type === 'steal' ? EVENTS.STEAL_PROMPT : EVENTS.FREEZE_PROMPT;
  const waitingEvent = type === 'steal' ? EVENTS.STEAL_WAITING : EVENTS.FREEZE_WAITING;

  if (chooser && chooser.socketId) {
    io.to(chooser.socketId).emit(promptEvent, { opponents, decisionEndsAt, serverNow: Date.now() });
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
    const botTimer = setTimeout(() => {
      if (room.questionIndex !== expectedIndex) return;
      if (room.state !== 'steal_prompt' && room.state !== 'freeze_prompt') return;
      resolvePowerChoice(io, room, bots.chooseTarget(chooser.botTier, type, opponents));
    }, bots.decisionDelay(chooser.botTier));
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
  const validTarget = chooser && target && target.playerId !== chooser.playerId && isAlive(target) && !(room.teamMode && target.team === chooser.team);

  room.state = 'reveal';

  if (type === 'steal') {
    let pointsMoved = 0;
    if (validTarget) {
      pointsMoved = Math.min(STEAL_POINTS, target.score);
      target.score -= pointsMoved;
      chooser.score += pointsMoved;
      if (pointsMoved > 0) {
        statsOf(room, chooser.playerId).stolen += pointsMoved;
        botSay(io, room, chooser, 'steal', 0.8);
      }
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
  const teams = teamStandings(room);
  let board = leaderboard(room);
  if (teams) {
    // team mode: order players by their team's result, then by their own score
    const rank = new Map(teams.map((t, i) => [t.team, i]));
    board = board.slice().sort((a, b) => rank.get(a.team) - rank.get(b.team) || b.score - a.score);
  }
  const awards = computeAwards(room, board);
  room.awards = awards;
  const winner = board[0];
  if (winner && winner.isBot) botSay(io, room, room.players.get(winner.playerId), 'win', 1);
  emitToRoom(io, room, EVENTS.GAME_FINAL, { leaderboard: board, podium: board.slice(0, 3), awards, teams, teamMode: room.teamMode });

  db.saveGameResult({
    top: teams && teams[0]
      ? {
          name: `Team ${teams[0].name}`,
          avatar: (board.find((p) => p.team === teams[0].team) || {}).avatar,
          score: teams[0].score,
        }
      : null,
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
  for (const [id, p] of [...room.players.entries()]) {
    if (p.left) {
      room.players.delete(id); // someone who walked out mid-match doesn't come back
      continue;
    }
    p.score = 0;
    p.streak = 0;
    p.lifelines = 0;
    p.polls = 0;
    p.eliminated = false;
    p.place = null;
    p.team = null;
  }
  room.fans = new Map();
  room.teamPlace = {};
  room.awards = null;
  city.stopCity(room);
  room.stagePlan = null;
  room.questionIndex = -1;
  room.answers = new Map();
  room.currentQuestion = null;
  room.stealState = null;
  room.frozenPlayerId = null;
  room.state = 'lobby';
  emitToRoom(io, room, EVENTS.GAME_RESET_TO_LOBBY, { players: serializePlayers(room) });
}

// The Back button. In the lobby or on the results screen the player simply leaves;
// mid-match they drop out (their seat is eliminated) and the game carries on.
function handleLeave(io, room, player) {
  if (room.state === 'lobby' || room.state === 'final') {
    rooms.leaveIdleRoom(room, player.playerId);
    if (rooms.getRoom(room.code)) emitToRoom(io, room, EVENTS.PLAYER_LIST_UPDATE, { players: serializePlayers(room) });
    return;
  }
  player.left = true;
  player.eliminated = true;
  player.place = null;
  rooms.markDisconnected(room, player.playerId);
  rooms.promoteNextHostIfNeeded(room, player.playerId);
  emitToRoom(io, room, EVENTS.PLAYER_LIST_UPDATE, { players: serializePlayers(room) });
  if (room.state === 'city') return; // the city simulation notices the player has left
  if (room.state === 'question') maybeEndQuestionEarly(io, room);
  else if ((room.state === 'steal_prompt' || room.state === 'freeze_prompt') && room.stealState && room.stealState.chooserId === player.playerId) {
    resolvePowerChoice(io, room, null);
  }
}

module.exports = {
  startGame,
  setTeamMode,
  teamStandings,
  handleLeave,
  stageInfo,
  handleAnswerSubmit,
  useLifeline,
  maybeEndQuestionEarly,
  resolvePowerChoice,
  resetToLobby,
  leaderboard,
};
