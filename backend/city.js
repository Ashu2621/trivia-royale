/*
 * City Mission mode — a small open-world city, server-authoritative.
 *
 * Everyone (humans and computer players) walks the same streets, populated by
 * wandering pedestrians and traffic. Every player gets the same list of missions.
 * A mission's target is a building on the map: reach its door and a QUIZ gate
 * opens — only a correct answer unlocks the reward (a blaster that stuns rivals
 * for a few seconds, a turbo car, cash, a shield…). The last mission is the
 * airport; the first player through it wins.
 *
 * Positions are simulated here at 20 Hz; clients get snapshots at 10 Hz and
 * predict their own movement locally.
 */
const EVENTS = require('./events');
const { getQuestions } = require('./questions');
const { serializePlayers } = require('./rooms');
const bots = require('./bots');
const { pickLine } = require('./botLines');
const db = require('./db');

const W = 2020;
const H = 1180;
const CELL = 20;
const COLS = Math.ceil(W / CELL);
const ROWS = Math.ceil(H / CELL);
const PLAYER_R = 11;
const TICK_MS = 50;
const SNAPSHOT_EVERY = 2; // ticks
const BASE_SPEED = 170;
const BOOST_SPEED_MUL = 1.75;
const STUN_MS = 3000;
const ZAP_RANGE = 160;
const ZAP_COOLDOWN_MS = 1200;
const QUIZ_MS = 15000;
const LOCKOUT_MS = 4000;
const MATCH_MS = 8 * 60 * 1000;
const FINISH_GRACE_MS = 40000;
// Computer players walk a bit slower than a human, more so at lower levels, so a person can keep up.
const BOT_SPEED_MUL = { rookie: 0.6, veteran: 0.74, elite: 0.85, legend: 0.93 };
const START_COUNTDOWN_MS = 3400;
const DOOR_RADIUS = 46;
const NPC_COUNT = 26;
const CAR_COUNT = 8;
const FINISH_BONUS = [1000, 600, 300];

/* ------------------------------------------------------------------ map */

// 4 columns x 3 rows of city blocks separated by 100px roads.
const LAYOUT = [
  [{ kind: 'gun', name: 'Gun Store' }, { kind: 'bank', name: 'Bank' }, { kind: 'park', name: 'City Park' }, { kind: 'hospital', name: 'Hospital' }],
  [{ kind: 'garage', name: 'Garage' }, { kind: 'arcade', name: 'Arcade' }, { kind: 'museum', name: 'Museum' }, { kind: 'radio', name: 'Radio Station' }],
  [{ kind: 'police', name: 'Police Dept' }, { kind: 'diner', name: 'Diner' }, { kind: 'park', name: 'Riverside Park' }, { kind: 'airport', name: 'Airport' }],
];

const KINDS = {
  gun: { icon: '🔫', color: '#c0392b', reward: 'blaster', label: 'a Blaster', line: 'Pick up a blaster that stuns rivals' },
  garage: { icon: '🚗', color: '#2980b9', reward: 'car', label: 'a Turbo Car', line: 'Grab a turbo car — double speed' },
  bank: { icon: '💰', color: '#d4a017', reward: 'cash', label: '+500 cash', line: 'Collect the cash', cash: 500 },
  hospital: { icon: '🛡️', color: '#16a085', reward: 'shield', label: 'a Shield', line: 'Get a shield against the next stun' },
  arcade: { icon: '🎮', color: '#8e44ad', reward: 'cash', label: '+300 tokens', line: 'Win arcade tokens', cash: 300 },
  museum: { icon: '🏛️', color: '#7f8c8d', reward: 'cash', label: '+300 knowledge', line: 'Earn a knowledge bonus', cash: 300 },
  radio: { icon: '📻', color: '#e67e22', reward: 'cash', label: '+300 fame', line: 'Go on air for a fame bonus', cash: 300 },
  police: { icon: '🚓', color: '#2c3e50', reward: 'shield', label: 'a Shield', line: 'Get a police shield' },
  diner: { icon: '🍔', color: '#e74c3c', reward: 'car', label: 'a Turbo Scooter', line: 'Refuel — turbo scooter' },
  airport: { icon: '✈️', color: '#f1c40f', reward: 'finish', label: 'the win', line: 'Reach the airport to win', cash: 0 },
};

function buildMap() {
  const buildings = [];
  const parks = [];
  const obstacles = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const spec = LAYOUT[r][c];
      const x0 = c * 480 + 100;
      const y0 = r * 360 + 100;
      if (spec.kind === 'park') {
        parks.push({ x: x0 + 20, y: y0 + 20, w: 340, h: 220, name: spec.name });
        obstacles.push({ x: x0 + 190 - 30, y: y0 + 130 - 30, w: 60, h: 60 }); // fountain
        continue;
      }
      const b = {
        id: `${r}${c}`,
        kind: spec.kind,
        name: spec.name,
        icon: KINDS[spec.kind].icon,
        color: KINDS[spec.kind].color,
        x: x0 + 40,
        y: y0 + 40,
        w: 300,
        h: 180,
      };
      b.door = { x: b.x + b.w / 2, y: b.y + b.h + 24 };
      buildings.push(b);
      obstacles.push({ x: b.x, y: b.y, w: b.w, h: b.h });
    }
  }
  const rng = seeded(4242);
  const trees = [];
  for (const p of parks) {
    for (let i = 0; i < 9; i++) {
      const tx = p.x + 24 + rng() * (p.w - 48);
      const ty = p.y + 24 + rng() * (p.h - 48);
      if (Math.abs(tx - (p.x + p.w / 2)) < 50 && Math.abs(ty - (p.y + p.h / 2)) < 50) continue;
      trees.push([Math.round(tx), Math.round(ty)]);
    }
  }
  return { w: W, h: H, roadW: 100, colStep: 480, rowStep: 360, cols: 5, rows: 4, buildings, parks, obstacles, trees };
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAP = buildMap();

function collides(x, y, r) {
  if (x < r || y < r || x > W - r || y > H - r) return true;
  for (const o of MAP.obstacles) {
    if (x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r) return true;
  }
  return false;
}

// Walkable navigation grid (cells where a player's body fits).
const blocked = new Uint8Array(COLS * ROWS);
for (let cy = 0; cy < ROWS; cy++) {
  for (let cx = 0; cx < COLS; cx++) {
    blocked[cy * COLS + cx] = collides(cx * CELL + CELL / 2, cy * CELL + CELL / 2, PLAYER_R + 2) ? 1 : 0;
  }
}
const cellOf = (x, y) => [Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL))), Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL)))];

function nearestWalkable(x, y) {
  const [cx, cy] = cellOf(x, y);
  for (let rad = 0; rad < 8; rad++) {
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        if (!blocked[ny * COLS + nx]) return [nx, ny];
      }
    }
  }
  return [cx, cy];
}

// A* over the grid (8-way, no corner cutting). Returns world-space waypoints.
function findPath(fromX, fromY, toX, toY) {
  const [sx, sy] = nearestWalkable(fromX, fromY);
  const [gx, gy] = nearestWalkable(toX, toY);
  const start = sy * COLS + sx;
  const goal = gy * COLS + gx;
  if (start === goal) return [{ x: toX, y: toY }];
  const g = new Float32Array(COLS * ROWS).fill(Infinity);
  const came = new Int32Array(COLS * ROWS).fill(-1);
  const closed = new Uint8Array(COLS * ROWS);
  const open = [[0, start]];
  g[start] = 0;
  const h = (i) => Math.hypot((i % COLS) - gx, Math.floor(i / COLS) - gy);
  const heapPush = (item) => {
    open.push(item);
    let i = open.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (open[p][0] <= open[i][0]) break;
      [open[p], open[i]] = [open[i], open[p]];
      i = p;
    }
  };
  const heapPop = () => {
    const top = open[0];
    const last = open.pop();
    if (open.length) {
      open[0] = last;
      let i = 0;
      for (;;) {
        let l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < open.length && open[l][0] < open[m][0]) m = l;
        if (r < open.length && open[r][0] < open[m][0]) m = r;
        if (m === i) break;
        [open[m], open[i]] = [open[i], open[m]];
        i = m;
      }
    }
    return top;
  };
  open.length = 0;
  heapPush([h(start), start]);
  let guard = 0;
  while (open.length && guard++ < 20000) {
    const [, cur] = heapPop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % COLS;
    const cy = Math.floor(cur / COLS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const ni = ny * COLS + nx;
        if (blocked[ni] || closed[ni]) continue;
        if (dx && dy && (blocked[cy * COLS + nx] || blocked[ny * COLS + cx])) continue;
        const ng = g[cur] + (dx && dy ? 1.414 : 1);
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          heapPush([ng + h(ni), ni]);
        }
      }
    }
  }
  if (came[goal] === -1) return [{ x: toX, y: toY }];
  const path = [];
  for (let n = goal; n !== -1 && n !== start; n = came[n]) path.push({ x: (n % COLS) * CELL + CELL / 2, y: Math.floor(n / COLS) * CELL + CELL / 2 });
  path.reverse();
  path.push({ x: toX, y: toY });
  return path;
}

function randomWalkable() {
  for (let i = 0; i < 200; i++) {
    const cx = Math.floor(Math.random() * COLS);
    const cy = Math.floor(Math.random() * ROWS);
    if (!blocked[cy * COLS + cx]) return { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 };
  }
  return { x: 50, y: 50 };
}

/* --------------------------------------------------------------- world sim */

function shuffled(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickMissions() {
  const pool = shuffled(['gun', 'garage', 'bank', 'hospital', 'arcade', 'museum', 'radio', 'police', 'diner']);
  // the weapon first is fun, but keep variety: always include the gun store somewhere
  const list = pool.slice(0, 4);
  if (!list.includes('gun')) list[Math.floor(Math.random() * 4)] = 'gun';
  list.push('airport');
  return list.map((kind) => {
    const b = MAP.buildings.find((x) => x.kind === kind);
    const k = KINDS[kind];
    return { kind, name: b.name, icon: k.icon, label: k.label, line: k.line, door: b.door, buildingId: b.id };
  });
}

function makeNpcs() {
  return Array.from({ length: NPC_COUNT }, () => {
    const at = randomWalkable();
    return { x: at.x, y: at.y, d: 1, path: [], wait: Math.random() * 3, speed: 46 + Math.random() * 30, look: [Math.floor(Math.random() * 6), Math.floor(Math.random() * 10)] };
  });
}

function makeCars() {
  const cars = [];
  for (let i = 0; i < CAR_COUNT; i++) {
    const horizontal = i % 2 === 0;
    const laneIdx = horizontal ? Math.floor(Math.random() * 4) : Math.floor(Math.random() * 5);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const center = horizontal ? laneIdx * MAP.rowStep + 50 : laneIdx * MAP.colStep + 50;
    cars.push({
      horizontal,
      fixed: center + dir * 20,
      pos: Math.random() * (horizontal ? W : H),
      dir,
      speed: 120 + Math.random() * 60,
      color: Math.floor(Math.random() * 6),
    });
  }
  return cars;
}

function startCity(io, room, deps) {
  const questionPool = shuffled(getQuestions('city'));
  const missions = pickMissions();
  const now = Date.now();
  const spawnPoints = shuffled(
    Array.from({ length: 20 }, (_, k) => ({ x: (k % 5) * MAP.colStep + 50, y: Math.floor(k / 5) * MAP.rowStep + 50 }))
  );
  const order = [...room.players.values()].map((p) => p.playerId);
  const sim = {
    map: MAP,
    missions,
    startsAt: now + START_COUNTDOWN_MS,
    endsAt: now + START_COUNTDOWN_MS + MATCH_MS,
    firstFinishAt: null,
    finishedCount: 0,
    order,
    npcs: makeNpcs(),
    cars: makeCars(),
    players: new Map(),
    questionPool,
    tick: 0,
    noHumansSince: null,
    over: false,
  };
  order.forEach((id, i) => {
    const p = room.players.get(id);
    p.score = 0;
    p.streak = 0;
    p.eliminated = false;
    p.left = false;
    p.place = null;
    p.team = null;
    const sp = spawnPoints[i % spawnPoints.length];
    sim.players.set(id, {
      idx: i,
      x: sp.x,
      y: sp.y,
      face: 1,
      input: { dx: 0, dy: 0 },
      stunUntil: 0,
      shield: false,
      boostUntil: 0,
      blaster: 0,
      mission: 0,
      missionsDone: 0,
      points: 0,
      finishedAt: null,
      finishRank: null,
      quiz: null,
      qCursor: i * 7,
      lockoutUntil: 0,
      nextZapAt: 0,
      path: [],
      pathFor: -1,
      botNextZap: 0,
      speedMul: room.players.get(id).isBot ? BOT_SPEED_MUL[room.players.get(id).botTier] || 0.74 : 1,
    });
  });
  room.city = sim;
  room.state = 'city';
  room.startsAt = sim.startsAt;

  io.to(room.code).emit(EVENTS.CITY_START, initPayload(room));
  room.timers.cityTick = setInterval(() => tick(io, room), TICK_MS);
}

function initPayload(room) {
  const sim = room.city;
  return {
    map: sim.map,
    missions: sim.missions.map((m) => ({ kind: m.kind, name: m.name, icon: m.icon, label: m.label, line: m.line, door: m.door })),
    players: sim.order.map((id) => {
      const p = room.players.get(id);
      return { playerId: id, name: p.name, avatar: p.avatar, isBot: !!p.isBot, botTier: p.botTier || null };
    }),
    npcLooks: sim.npcs.map((n) => n.look),
    startsAt: sim.startsAt,
    endsAt: sim.endsAt,
    serverNow: Date.now(),
    snapshot: snapshot(room),
  };
}

/* ------------------------------------------------------------------ tick */

function speedOf(ps, now) {
  if (ps.stunUntil > now || ps.quiz) return 0;
  return BASE_SPEED * (ps.speedMul || 1) * (ps.boostUntil > now ? BOOST_SPEED_MUL : 1);
}

function movePlayer(ps, dx, dy, dt, now) {
  const sp = speedOf(ps, now);
  if (!sp || (!dx && !dy)) return;
  const len = Math.hypot(dx, dy) || 1;
  const vx = (dx / len) * sp * dt;
  const vy = (dy / len) * sp * dt;
  if (!collides(ps.x + vx, ps.y, PLAYER_R)) ps.x += vx;
  if (!collides(ps.x, ps.y + vy, PLAYER_R)) ps.y += vy;
  if (Math.abs(dx) > 0.15) ps.face = dx > 0 ? 1 : -1;
}

function nextQuestion(sim, ps) {
  const q = sim.questionPool[ps.qCursor % sim.questionPool.length];
  ps.qCursor += 1;
  return q;
}

function say(io, room, id, kind, chance) {
  const p = room.players.get(id);
  if (!p || !p.isBot || Math.random() > chance) return;
  const now = Date.now();
  if (now - (p.lastSayAt || 0) < 6000) return;
  const text = pickLine(p.botTier, kind);
  if (!text) return;
  p.lastSayAt = now;
  io.to(room.code).emit(EVENTS.BOT_SAY, { playerId: id, text });
}

function feed(io, room, text) {
  io.to(room.code).emit(EVENTS.CITY_FEED, { text });
}

function openQuiz(io, room, id, ps, now) {
  const sim = room.city;
  const p = room.players.get(id);
  const q = nextQuestion(sim, ps);
  ps.quiz = { q, startedAt: now, endsAt: now + QUIZ_MS };
  ps.input = { dx: 0, dy: 0 };
  if (p && p.socketId) {
    io.to(p.socketId).emit(EVENTS.CITY_QUIZ, {
      text: q.text,
      choices: q.choices,
      endsAt: ps.quiz.endsAt,
      serverNow: now,
      mission: { name: sim.missions[ps.mission].name, icon: sim.missions[ps.mission].icon, label: sim.missions[ps.mission].label },
    });
  }
  if (p && p.isBot) {
    const plan = bots.planAnswer(p.botTier, q, QUIZ_MS, { streak: 0 });
    const delay = Math.min(QUIZ_MS - 1200, plan.delay * 0.8);
    const questionRef = ps.quiz;
    setTimeout(() => {
      if (room.state !== 'city' || ps.quiz !== questionRef) return;
      resolveAnswer(io, room, id, plan.choiceIndex);
    }, delay);
  }
}

function grantReward(io, room, id, ps, now, quizStartedAt) {
  const sim = room.city;
  const p = room.players.get(id);
  const mission = sim.missions[ps.mission];
  const kind = KINDS[mission.kind];
  const speedBonus = Math.round(300 * Math.max(0, 1 - (now - quizStartedAt) / QUIZ_MS));
  let gained = 400 + speedBonus + (kind.cash || 0);
  let text = '';
  if (kind.reward === 'blaster') {
    ps.blaster = 3;
    text = `${p.avatar} ${p.name} picked up a Blaster 🔫`;
  } else if (kind.reward === 'car') {
    ps.boostUntil = now + 25000;
    text = `${p.avatar} ${p.name} grabbed a Turbo ${mission.kind === 'diner' ? 'Scooter' : 'Car'} 🚗`;
  } else if (kind.reward === 'shield') {
    ps.shield = true;
    text = `${p.avatar} ${p.name} got a Shield 🛡️`;
  } else if (kind.reward === 'cash') {
    text = `${p.avatar} ${p.name} completed ${mission.name} ${mission.icon}`;
  } else {
    text = `${p.avatar} ${p.name} reached the Airport ✈️`;
  }
  ps.points += gained;
  ps.missionsDone += 1;
  ps.mission += 1;
  ps.path = [];
  ps.pathFor = -1;
  let finished = false;
  if (ps.mission >= sim.missions.length) {
    finished = true;
    ps.finishedAt = now;
    ps.finishRank = sim.finishedCount;
    sim.finishedCount += 1;
    const bonus = FINISH_BONUS[ps.finishRank] || 0;
    ps.points += bonus;
    gained += bonus;
    if (!sim.firstFinishAt) {
      sim.firstFinishAt = now;
      sim.endsAt = Math.min(sim.endsAt, now + FINISH_GRACE_MS);
      feed(io, room, `🏁 ${p.avatar} ${p.name} reached the airport first! ${Math.round(FINISH_GRACE_MS / 1000)}s left for everyone else.`);
    } else {
      feed(io, room, `🏁 ${p.avatar} ${p.name} finished #${ps.finishRank + 1}`);
    }
  } else {
    feed(io, room, text);
  }
  p.score = ps.points;
  return { gained, finished, reward: { kind: kind.reward, label: mission.label }, speedBonus };
}

function resolveAnswer(io, room, id, choiceIndex) {
  const sim = room.city;
  if (!sim || room.state !== 'city') return;
  const ps = sim.players.get(id);
  const p = room.players.get(id);
  if (!ps || !p || !ps.quiz) return;
  const now = Date.now();
  const quiz = ps.quiz;
  ps.quiz = null;
  const correct = Number.isInteger(choiceIndex) && choiceIndex === quiz.q.correctIndex;
  let result;
  if (correct) {
    result = grantReward(io, room, id, ps, now, quiz.startedAt);
    say(io, room, id, 'right', 0.5);
  } else {
    ps.lockoutUntil = now + LOCKOUT_MS;
    say(io, room, id, 'wrong', 0.5);
  }
  if (p.socketId) {
    io.to(p.socketId).emit(EVENTS.CITY_RESULT, {
      correct,
      correctIndex: quiz.q.correctIndex,
      gained: result ? result.gained : 0,
      reward: result ? result.reward : null,
      finished: result ? result.finished : false,
      nextMission: ps.mission,
      points: ps.points,
      lockoutMs: correct ? 0 : LOCKOUT_MS,
    });
  }
}

function tryZap(io, room, id, now) {
  const sim = room.city;
  const ps = sim.players.get(id);
  if (!ps || ps.blaster <= 0 || ps.quiz || ps.stunUntil > now || now < ps.nextZapAt) return false;
  let best = null;
  let bestD = ZAP_RANGE;
  for (const [otherId, other] of sim.players) {
    if (otherId === id || other.quiz || other.finishedAt) continue;
    const p2 = room.players.get(otherId);
    if (!p2 || p2.left) continue;
    const d = Math.hypot(other.x - ps.x, other.y - ps.y);
    if (d < bestD) {
      best = otherId;
      bestD = d;
    }
  }
  if (!best) return false;
  const target = sim.players.get(best);
  ps.blaster -= 1;
  ps.nextZapAt = now + ZAP_COOLDOWN_MS;
  let blockedByShield = false;
  if (target.shield) {
    target.shield = false;
    blockedByShield = true;
  } else {
    target.stunUntil = now + STUN_MS;
    target.input = { dx: 0, dy: 0 };
  }
  io.to(room.code).emit(EVENTS.CITY_FX, { type: 'zap', from: id, to: best, blocked: blockedByShield });
  const from = room.players.get(id);
  const to = room.players.get(best);
  feed(io, room, blockedByShield ? `🛡️ ${to.name}'s shield blocked ${from.name}'s zap` : `⚡ ${from.avatar} ${from.name} stunned ${to.avatar} ${to.name}`);
  say(io, room, id, 'steal', 0.7);
  return true;
}

function botThink(io, room, id, ps, p, now) {
  const sim = room.city;
  if (ps.finishedAt || ps.quiz || ps.stunUntil > now) {
    ps.input = { dx: 0, dy: 0 };
    return;
  }
  const mission = sim.missions[ps.mission];
  if (!mission) return;
  const toDoor = Math.hypot(mission.door.x - ps.x, mission.door.y - ps.y);
  if (toDoor < DOOR_RADIUS - 8) {
    ps.input = { dx: 0, dy: 0 };
    return;
  }
  if (ps.pathFor !== ps.mission || !ps.path.length) {
    ps.path = findPath(ps.x, ps.y, mission.door.x, mission.door.y);
    ps.pathFor = ps.mission;
  }
  const wp = ps.path[0];
  if (!wp) return;
  const dx = wp.x - ps.x;
  const dy = wp.y - ps.y;
  if (Math.hypot(dx, dy) < 10) {
    ps.path.shift();
    return;
  }
  ps.input = { dx, dy };

  // opportunistic zaps at nearby rivals, tougher tiers more eagerly
  if (ps.blaster > 0 && now > ps.botNextZap) {
    ps.botNextZap = now + 2500 + Math.random() * 2500;
    if (Math.random() < (p.botTier === 'legend' ? 0.9 : p.botTier === 'elite' ? 0.7 : 0.4)) tryZap(io, room, id, now);
  }
}

function stepNpcs(npcs, dt) {
  for (const n of npcs) {
    if (n.wait > 0) {
      n.wait -= dt;
      continue;
    }
    if (!n.path.length) {
      const target = randomWalkable();
      if (Math.hypot(target.x - n.x, target.y - n.y) > 500) {
        n.wait = 0.5;
        continue;
      }
      n.path = findPath(n.x, n.y, target.x, target.y).slice(0, 40);
      if (!n.path.length) n.wait = 1;
      continue;
    }
    const wp = n.path[0];
    const dx = wp.x - n.x;
    const dy = wp.y - n.y;
    const dist = Math.hypot(dx, dy);
    const step = n.speed * dt;
    if (dist <= step) {
      n.x = wp.x;
      n.y = wp.y;
      n.path.shift();
      if (!n.path.length) n.wait = 1 + Math.random() * 4;
    } else {
      n.x += (dx / dist) * step;
      n.y += (dy / dist) * step;
      if (Math.abs(dx) > 1) n.d = dx > 0 ? 1 : -1;
    }
  }
}
function stepCars(cars, dt) {
  for (const c of cars) {
    c.pos += c.dir * c.speed * dt;
    const limit = c.horizontal ? W : H;
    if (c.pos > limit + 60) c.pos = -60;
    if (c.pos < -60) c.pos = limit + 60;
  }
}

function snapshot(room) {
  const sim = room.city;
  const now = Date.now();
  return {
    t: now,
    p: sim.order.map((id) => {
      const ps = sim.players.get(id);
      let flags = 0;
      if (ps.stunUntil > now) flags |= 1;
      if (ps.shield) flags |= 2;
      if (ps.boostUntil > now) flags |= 4;
      if (ps.quiz) flags |= 8;
      if (ps.finishedAt) flags |= 32;
      const pl = room.players.get(id);
      if (pl && pl.left) flags |= 64;
      return [ps.idx, Math.round(ps.x), Math.round(ps.y), ps.face, flags, ps.mission, ps.points, ps.blaster];
    }),
    n: sim.npcs.map((n) => [Math.round(n.x), Math.round(n.y), n.d, n.path.length ? 1 : 0]),
    c: sim.cars.map((c) => [Math.round(c.horizontal ? c.pos : c.fixed), Math.round(c.horizontal ? c.fixed : c.pos), c.horizontal ? 0 : 1, c.dir, c.color]),
    endsAt: sim.endsAt,
  };
}

function tick(io, room) {
  const sim = room.city;
  if (!sim || room.state !== 'city' || sim.over) return;
  const now = Date.now();
  const dt = TICK_MS / 1000;
  sim.tick += 1;

  const started = now >= sim.startsAt;
  if (started) {
    for (const [id, ps] of sim.players) {
      const p = room.players.get(id);
      if (!p || p.left) continue;
      if (!p.isBot && !p.connected) ps.input = { dx: 0, dy: 0 }; // a dropped connection stops walking
      if (p.isBot) botThink(io, room, id, ps, p, now);
      if (ps.quiz && now > ps.quiz.endsAt) resolveAnswer(io, room, id, -1);
      if (!ps.finishedAt) movePlayer(ps, ps.input.dx, ps.input.dy, dt, now);

      // reaching the door of the current mission opens the quiz gate
      if (!ps.finishedAt && !ps.quiz && now >= ps.lockoutUntil && ps.stunUntil <= now) {
        const m = sim.missions[ps.mission];
        if (m && Math.hypot(m.door.x - ps.x, m.door.y - ps.y) < DOOR_RADIUS) openQuiz(io, room, id, ps, now);
      }
    }
    stepNpcs(sim.npcs, dt);
    stepCars(sim.cars, dt);

    // end of match
    const humans = [...sim.players.entries()].filter(([id]) => {
      const p = room.players.get(id);
      return p && !p.isBot && !p.left && p.connected;
    });
    if (humans.length === 0) {
      if (!sim.noHumansSince) sim.noHumansSince = now;
    } else {
      sim.noHumansSince = null;
    }
    const allHumansDone = humans.length > 0 && humans.every(([, ps]) => ps.finishedAt);
    if (now >= sim.endsAt || allHumansDone || (sim.noHumansSince && now - sim.noHumansSince > 30000)) {
      finishCity(io, room);
      return;
    }
  }

  if (sim.tick % SNAPSHOT_EVERY === 0) io.to(room.code).emit(EVENTS.CITY_STATE, snapshot(room));
}

function finishCity(io, room) {
  const sim = room.city;
  if (!sim || sim.over) return;
  sim.over = true;
  clearInterval(room.timers.cityTick);
  room.timers.cityTick = null;
  for (const [id, ps] of sim.players) {
    const p = room.players.get(id);
    if (p) p.score = ps.points;
  }
  room.state = 'final';
  const board = serializePlayers(room);
  const missionsById = {};
  for (const [id, ps] of sim.players) missionsById[id] = { done: ps.missionsDone, finished: !!ps.finishedAt, rank: ps.finishRank };
  const awards = [];
  const best = [...sim.players.entries()].sort((a, b) => b[1].missionsDone - a[1].missionsDone || b[1].points - a[1].points)[0];
  if (best) awards.push({ key: 'mission', icon: '🎯', title: 'Mission Master', playerId: best[0], name: room.players.get(best[0]).name, detail: `${best[1].missionsDone}/${sim.missions.length} missions` });
  io.to(room.code).emit(EVENTS.GAME_FINAL, { leaderboard: board, podium: board.slice(0, 3), awards, teams: null, teamMode: 0, city: { missions: missionsById, total: sim.missions.length } });
  db.saveGameResult({
    roomCode: room.code,
    category: 'city',
    categoryLabel: '🌆 City Mission',
    levelKey: null,
    levelLabel: null,
    subject: null,
    players: board,
  });
}

/* ------------------------------------------------------- inputs from clients */

function setInput(room, playerId, dx, dy) {
  const sim = room.city;
  if (!sim || room.state !== 'city') return;
  const ps = sim.players.get(playerId);
  if (!ps) return;
  const x = Number(dx);
  const y = Number(dy);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const len = Math.hypot(x, y);
  ps.input = len > 1 ? { dx: x / len, dy: y / len } : { dx: x, dy: y };
}

function answer(io, room, playerId, choiceIndex) {
  resolveAnswer(io, room, playerId, choiceIndex);
}

function zap(io, room, playerId) {
  const sim = room.city;
  if (!sim || room.state !== 'city' || Date.now() < sim.startsAt) return;
  tryZap(io, room, playerId, Date.now());
}

function stopCity(room) {
  if (room.timers && room.timers.cityTick) {
    clearInterval(room.timers.cityTick);
    room.timers.cityTick = null;
  }
  room.city = null;
}

module.exports = { startCity, initPayload, setInput, answer, zap, finishCity, stopCity, MAP, KINDS, findPath };
