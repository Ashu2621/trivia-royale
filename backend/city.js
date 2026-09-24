/*
 * City Mission: We Gotta Go — the open-world race with a haunted mansion and a full bladder.
 * Server-authoritative.
 *
 * Everyone (humans and computer players) runs the same list of missions through a small city
 * full of wandering pedestrians and traffic. Every mission target is a building; reaching its
 * door opens a QUIZ gate — only a correct answer unlocks the reward (a blaster that stuns rivals,
 * a turbo car, a shield, cash…). One target is the HAUNTED MANSION: answer its gate and you step
 * into a spooky maze where three doors (A, B, C) block the way, each key is guarded by a quiz,
 * and ghosts chase you; the way out is the toilet at the far end. The last target is the Royal
 * Restroom — the first player through it wins.
 *
 * And the whole time your own BLADDER is filling. Around town there are public toilet stalls
 * (quiz-locked too) for relief; at high pressure you clench, fart and hop, and at 100% you have
 * an accident that costs you time and points. It is a pure race: everybody's bladder is their own.
 *
 * Positions are simulated at 20 Hz; clients get snapshots at 10 Hz and predict their own movement.
 */
const EVENTS = require('./events');
const { getQuestions } = require('./questions');
const { serializePlayers } = require('./rooms');
const bots = require('./bots');
const { pickLine } = require('./botLines');
const db = require('./db');
const mz = require('./maze');

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

// ---- bladder, farts and accidents ----
const BLADDER_FILL_S = Number(process.env.BLADDER_FILL_S) || 150; // 0 -> 100% in this many seconds if nothing else happens
const CLENCH_MS = 650;
const CLENCH_SPEED_MUL = 0.35;
const ACCIDENT_MS = 5500;
const ACCIDENT_PENALTY = 250;
const ACCIDENT_RESET = 35;
const WRONG_BLADDER = 4;
const CATCH_BLADDER = 7;
const WC_RADIUS = 34;
const WC_COOLDOWN_MS = 25000;
const WC_MIN_BLADDER = 18;
const WC_POINTS = 150;
const FART_KINDS = 8; // the client maps a kind number to a sound recipe

// ---- haunted mansion ----
const MANSION_BONUS = 600;
const FLASH_RANGE = 210;
const FLASH_COOLDOWN_MS = 7000;
const GHOST_STUN_MS = 3500;
const GHOST_SCARE_STUN_MS = 2500;
const GHOST_CATCH_COOLDOWN_MS = 7000;
const SHOUT_RANGE = 170;
const SHOUT_COOLDOWN_MS = 6000;

/* ------------------------------------------------------------------ map */

// 4 columns x 3 rows of city blocks separated by 100px roads.
const LAYOUT = [
  [{ kind: 'gun', name: 'Gun Store' }, { kind: 'bank', name: 'Bank' }, { kind: 'park', name: 'City Park' }, { kind: 'hospital', name: 'Hospital' }],
  [{ kind: 'garage', name: 'Garage' }, { kind: 'arcade', name: 'Arcade' }, { kind: 'mansion', name: 'Haunted Mansion' }, { kind: 'radio', name: 'Radio Station' }],
  [{ kind: 'police', name: 'Police Dept' }, { kind: 'diner', name: 'Diner' }, { kind: 'park', name: 'Riverside Park' }, { kind: 'restroom', name: 'Royal Restroom' }],
];

const KINDS = {
  gun: { icon: '🔫', color: '#c0392b', reward: 'blaster', label: 'a Blaster', line: 'Pick up a blaster that stuns rivals' },
  garage: { icon: '🚗', color: '#2980b9', reward: 'car', label: 'a Turbo Car', line: 'Grab a turbo car — double speed' },
  bank: { icon: '💰', color: '#d4a017', reward: 'cash', label: '+500 cash', line: 'Collect the cash', cash: 500 },
  hospital: { icon: '🛡️', color: '#16a085', reward: 'shield', label: 'a Shield', line: 'Get a shield against the next stun' },
  arcade: { icon: '🎮', color: '#8e44ad', reward: 'cash', label: '+300 tokens', line: 'Win arcade tokens', cash: 300 },
  radio: { icon: '📻', color: '#e67e22', reward: 'cash', label: '+300 fame', line: 'Go on air for a fame bonus', cash: 300 },
  police: { icon: '🚓', color: '#2c3e50', reward: 'shield', label: 'a Shield', line: 'Get a police shield' },
  diner: { icon: '🍔', color: '#e74c3c', reward: 'car', label: 'a Turbo Scooter', line: 'Refuel — turbo scooter' },
  mansion: { icon: '🏚️', color: '#5b3fd6', reward: 'mansion', label: 'the Haunted Mansion', line: 'Enter the haunted mansion — win 3 keys, dodge the ghosts, reach the toilet', cash: 0 },
  restroom: { icon: '🚽', color: '#f1c40f', reward: 'finish', label: 'the win', line: 'Reach the Royal Restroom to win', cash: 0 },
};

function buildMap() {
  const buildings = [];
  const parks = [];
  const obstacles = [];
  const wcs = [];
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
      // a public toilet stall on the sidewalk corner of every other block
      if ((r + c) % 2 === 0) {
        obstacles.push({ x: x0 + 8, y: y0 + 8, w: 26, h: 26 });
        wcs.push({ id: wcs.length, x: x0 + 21, y: y0 + 21, door: { x: x0 + 21, y: y0 + 49 } });
      }
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
  return { w: W, h: H, roadW: 100, colStep: 480, rowStep: 360, cols: 5, rows: 4, buildings, parks, obstacles, trees, wcs };
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
        const l = i * 2 + 1;
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

// shop, haunted mansion, shop, Royal Restroom (the finish)
function pickMissions() {
  const shops = shuffled(['gun', 'garage', 'bank', 'hospital', 'arcade', 'radio', 'police', 'diner']);
  const two = shops.slice(0, 2);
  if (!two.includes('gun')) two[Math.floor(Math.random() * 2)] = 'gun';
  const kinds = [two[0], 'mansion', two[1], 'restroom'];
  return kinds.map((kind) => {
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

function makeMansion(playerCount) {
  const layout = mz.generateLayout();
  const ghostCount = Math.max(3, Math.min(5, 3 + Math.floor(playerCount / 5)));
  const ghosts = [];
  for (let g = 0; g < ghostCount; g++) {
    const cell = layout.ghostSpawns[g % layout.ghostSpawns.length];
    const at = mz.cellCenter(Math.floor(cell / mz.COLS), cell % mz.COLS);
    ghosts.push({ x: at.x, y: at.y, cell, next: cell, goal: cell, mode: 'patrol', stunUntil: 0, coolUntil: 0, speed: 104 + g * 6, retarget: 0 });
  }
  return { layout, collision: mz.buildCollision(layout), ghosts };
}

function startCity(io, room) {
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
    mansion: makeMansion(order.length),
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
    lastTickAt: now,
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
      pathFor: '',
      botNextZap: 0,
      speedMul: p.isBot ? BOT_SPEED_MUL[p.botTier] || 0.74 : 1,
      // bladder and body
      bladder: Math.random() * 12,
      clenchUntil: 0,
      accidentUntil: 0,
      accidents: 0,
      farts: 0,
      nextFartAt: now + START_COUNTDOWN_MS + 6000 + Math.random() * 8000,
      wcCd: {},
      relieved: 0,
      // mansion
      world: 0,
      opened: new Set(),
      keysWon: 0,
      caught: 0,
      scared: 0,
      exitAt: null,
      nextFlashAt: 0,
      flashUntil: 0,
      nextShoutAt: 0,
      shoutUntil: 0,
      lastCaughtAt: 0,
      botNextThink: 0,
      botGoal: null,
      botNextFlash: 0,
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
  const L = sim.mansion.layout;
  const walls = mz.compactWalls(L);
  return {
    map: sim.map,
    missions: sim.missions.map((m) => ({ kind: m.kind, name: m.name, icon: m.icon, label: m.label, line: m.line, door: m.door })),
    players: sim.order.map((id) => {
      const p = room.players.get(id);
      return { playerId: id, name: p.name, avatar: p.avatar, isBot: !!p.isBot, botTier: p.botTier || null };
    }),
    npcLooks: sim.npcs.map((n) => n.look),
    mansion: {
      cols: mz.COLS,
      rows: mz.ROWS,
      cell: mz.CELL,
      wallT: mz.WALL_T,
      playerR: mz.PLAYER_R,
      hW: walls.hW,
      vW: walls.vW,
      start: mz.cellCenter(L.start.r, L.start.c),
      toilet: mz.cellCenter(L.toilet.r, L.toilet.c),
      keys: L.keys.map((k) => ({ letter: k.letter, ...mz.cellCenter(k.r, k.c) })),
      doors: L.doors.map((d) => ({ letter: d.letter, ...mz.cellCenter(d.r, d.c) })),
      ghostCount: sim.mansion.ghosts.length,
    },
    startsAt: sim.startsAt,
    endsAt: sim.endsAt,
    serverNow: Date.now(),
    snapshot: snapshot(room),
  };
}

/* ------------------------------------------------------------------ tick */

function speedOf(ps, now) {
  if (ps.stunUntil > now || ps.quiz) return 0;
  let sp = BASE_SPEED * (ps.speedMul || 1) * (ps.boostUntil > now ? BOOST_SPEED_MUL : 1);
  if (ps.clenchUntil > now) sp *= CLENCH_SPEED_MUL;
  return sp;
}

function collidesFor(sim, ps, x, y) {
  if (ps.world === 1) return mz.collidesWith(sim.mansion.collision, sim.mansion.layout, ps.opened, x, y, mz.PLAYER_R);
  return collides(x, y, PLAYER_R);
}

function movePlayer(sim, ps, dx, dy, dt, now) {
  const sp = speedOf(ps, now);
  if (!sp || (!dx && !dy)) return;
  const len = Math.hypot(dx, dy) || 1;
  const vx = (dx / len) * sp * dt;
  const vy = (dy / len) * sp * dt;
  if (!collidesFor(sim, ps, ps.x + vx, ps.y)) ps.x += vx;
  if (!collidesFor(sim, ps, ps.x, ps.y + vy)) ps.y += vy;
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

function addBladder(ps, amount) {
  ps.bladder = Math.max(0, Math.min(100, ps.bladder + amount));
}

/* ------------------------------------------------------------------ quiz gates */

// ctx: { kind: 'gate' | 'key' | 'wc', ... }
function openQuiz(io, room, id, ps, now, ctx) {
  const sim = room.city;
  const p = room.players.get(id);
  const q = nextQuestion(sim, ps);
  ps.quiz = { q, startedAt: now, endsAt: now + QUIZ_MS, ctx };
  ps.input = { dx: 0, dy: 0 };
  let head = '';
  let mission = null;
  if (ctx.kind === 'gate') {
    const m = sim.missions[ps.mission];
    mission = { name: m.name, icon: m.icon, label: m.label };
    head = `${m.icon} ${m.name} — answer to unlock ${m.label}`;
  } else if (ctx.kind === 'key') {
    head = `🔑 Key ${ctx.letter.toUpperCase()} is locked — answer to win it`;
    mission = { name: `Key ${ctx.letter.toUpperCase()}`, icon: '🔑', label: `door ${ctx.letter.toUpperCase()}` };
  } else {
    head = '🚽 The stall is locked — answer to get relief!';
    mission = { name: 'Public toilet', icon: '🚽', label: 'relief' };
  }
  if (p && p.socketId) {
    io.to(p.socketId).emit(EVENTS.CITY_QUIZ, { text: q.text, choices: q.choices, endsAt: ps.quiz.endsAt, serverNow: now, kind: ctx.kind, head, mission });
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

function enterMansion(io, room, id, ps) {
  const sim = room.city;
  const L = sim.mansion.layout;
  const p = room.players.get(id);
  const s = mz.cellCenter(L.start.r, L.start.c);
  const m = sim.missions[ps.mission];
  ps.exitAt = { x: m.door.x, y: m.door.y };
  ps.world = 1;
  ps.opened = new Set();
  ps.keysWon = 0;
  const a = Math.random() * Math.PI * 2;
  ps.x = s.x + Math.cos(a) * 20;
  ps.y = s.y + Math.sin(a) * 20;
  ps.face = -1;
  ps.path = [];
  ps.botGoal = null;
  ps.lastCaughtAt = 0;
  feed(io, room, `🏚️ ${p.avatar} ${p.name} entered the Haunted Mansion…`);
}

function completeMansion(io, room, id, ps, now) {
  const sim = room.city;
  const p = room.players.get(id);
  ps.world = 0;
  const m = sim.missions[ps.mission];
  ps.x = m.door.x;
  ps.y = m.door.y + 6;
  ps.path = [];
  ps.pathFor = '';
  ps.points += MANSION_BONUS;
  ps.missionsDone += 1;
  ps.mission += 1;
  ps.bladder = 0; // sweet relief
  ps.relieved += 1;
  p.score = ps.points;
  io.to(room.code).emit(EVENTS.CITY_FX, { type: 'relief', playerId: id });
  feed(io, room, `🚽 ${p.avatar} ${p.name} made it out of the mansion — what a relief! +${MANSION_BONUS}`);
  say(io, room, id, 'right', 0.8);
  if (p.socketId) io.to(p.socketId).emit(EVENTS.CITY_RESULT, { kind: 'exit', correct: true, gained: MANSION_BONUS, points: ps.points, nextMission: ps.mission, lockoutMs: 0, reward: { kind: 'relief', label: 'sweet relief' } });
  void now;
}

function grantReward(io, room, id, ps, now, quizStartedAt) {
  const sim = room.city;
  const p = room.players.get(id);
  const mission = sim.missions[ps.mission];
  const kind = KINDS[mission.kind];
  const speedBonus = Math.round(300 * Math.max(0, 1 - (now - quizStartedAt) / QUIZ_MS));
  let gained = 400 + speedBonus + (kind.cash || 0);
  let text = '';
  if (kind.reward === 'mansion') {
    // the gate opens — the mission itself completes when you come back out through the toilet
    ps.points += gained;
    enterMansion(io, room, id, ps);
    p.score = ps.points;
    return { gained, finished: false, reward: { kind: 'mansion', label: mission.label }, speedBonus, entered: true };
  }
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
  }
  ps.points += gained;
  ps.missionsDone += 1;
  ps.mission += 1;
  ps.path = [];
  ps.pathFor = '';
  let finished = false;
  if (ps.mission >= sim.missions.length) {
    finished = true;
    ps.finishedAt = now;
    ps.finishRank = sim.finishedCount;
    sim.finishedCount += 1;
    const bonus = FINISH_BONUS[ps.finishRank] || 0;
    ps.points += bonus;
    gained += bonus;
    io.to(room.code).emit(EVENTS.CITY_FX, { type: 'relief', playerId: id });
    if (!sim.firstFinishAt) {
      sim.firstFinishAt = now;
      sim.endsAt = Math.min(sim.endsAt, now + FINISH_GRACE_MS);
      feed(io, room, `🏁 ${p.avatar} ${p.name} made it to the Royal Restroom first! ${Math.round(FINISH_GRACE_MS / 1000)}s left for everyone else.`);
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
  const ctx = quiz.ctx || { kind: 'gate' };
  const correct = Number.isInteger(choiceIndex) && choiceIndex === quiz.q.correctIndex;
  let result = null;
  let gained = 0;
  let already = false;
  if (correct) {
    if (ctx.kind === 'gate') {
      result = grantReward(io, room, id, ps, now, quiz.startedAt);
      gained = result.gained;
    } else if (ctx.kind === 'key') {
      const letter = ctx.letter.toUpperCase();
      const speedBonus = Math.round(300 * Math.max(0, 1 - (now - quiz.startedAt) / QUIZ_MS));
      gained = 400 + speedBonus;
      ps.opened.add(letter);
      ps.keysWon += 1;
      ps.points += gained;
      addBladder(ps, -3);
      p.score = ps.points;
      io.to(room.code).emit(EVENTS.CITY_FX, { type: 'key', playerId: id, letter: ctx.letter });
      feed(io, room, `🔑 ${p.avatar} ${p.name} won key ${letter} in the mansion`);
      result = { gained, finished: false, reward: { kind: 'key', label: `key ${letter}` } };
    } else {
      // public toilet: relief!
      gained = WC_POINTS;
      ps.bladder = 0;
      ps.relieved += 1;
      ps.wcCd[ctx.wc] = now + WC_COOLDOWN_MS;
      ps.points += gained;
      p.score = ps.points;
      io.to(room.code).emit(EVENTS.CITY_FX, { type: 'relief', playerId: id });
      feed(io, room, `🚽 ${p.avatar} ${p.name} found a public toilet just in time`);
      result = { gained, finished: false, reward: { kind: 'relief', label: 'relief' } };
    }
    say(io, room, id, 'right', 0.5);
  } else {
    ps.lockoutUntil = now + LOCKOUT_MS;
    addBladder(ps, WRONG_BLADDER);
    if (ctx.kind === 'wc') ps.wcCd[ctx.wc] = now + 8000;
    say(io, room, id, 'wrong', 0.5);
  }
  if (p.socketId) {
    io.to(p.socketId).emit(EVENTS.CITY_RESULT, {
      kind: ctx.kind,
      correct,
      already,
      correctIndex: quiz.q.correctIndex,
      gained: correct ? gained : 0,
      reward: result ? result.reward : null,
      finished: result ? result.finished : false,
      nextMission: ps.mission,
      points: ps.points,
      lockoutMs: correct ? 0 : LOCKOUT_MS,
      entered: !!(result && result.entered),
    });
  }
}

/* ------------------------------------------------------------ blaster + flashlight */

function tryZap(io, room, id, now) {
  const sim = room.city;
  const ps = sim.players.get(id);
  if (!ps || ps.blaster <= 0 || ps.quiz || ps.stunUntil > now || now < ps.nextZapAt || ps.world !== 0) return false;
  let best = null;
  let bestD = ZAP_RANGE;
  for (const [otherId, other] of sim.players) {
    if (otherId === id || other.quiz || other.finishedAt || other.world !== 0) continue;
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

// the flashlight scares nearby ghosts (only works inside the mansion)
function tryFlash(io, room, id, now) {
  const sim = room.city;
  const ps = sim.players.get(id);
  if (!ps || ps.world !== 1 || ps.finishedAt || ps.quiz || ps.stunUntil > now || now < ps.nextFlashAt) return false;
  ps.nextFlashAt = now + FLASH_COOLDOWN_MS;
  ps.flashUntil = now + 600;
  let hit = 0;
  for (const g of sim.mansion.ghosts) {
    if (Math.hypot(g.x - ps.x, g.y - ps.y) < FLASH_RANGE) {
      g.stunUntil = now + GHOST_STUN_MS;
      g.coolUntil = now + GHOST_STUN_MS + 2500;
      g.mode = 'stunned';
      hit += 1;
    }
  }
  ps.scared += hit;
  io.to(room.code).emit(EVENTS.CITY_FX, { type: 'flash', playerId: id, hit });
  if (hit) {
    const p = room.players.get(id);
    feed(io, room, `🔦 ${p.avatar} ${p.name} scared off ${hit === 1 ? 'a ghost' : `${hit} ghosts`}!`);
  }
  return true;
}

// a real shout into the microphone: ghosts nearby get a fright
function tryShout(io, room, id, now) {
  const sim = room.city;
  const ps = sim.players.get(id);
  if (!ps || ps.finishedAt || ps.quiz || now < ps.nextShoutAt) return false;
  ps.nextShoutAt = now + SHOUT_COOLDOWN_MS;
  ps.shoutUntil = now + 900;
  let hit = 0;
  if (ps.world === 1) {
    for (const g of sim.mansion.ghosts) {
      if (Math.hypot(g.x - ps.x, g.y - ps.y) < SHOUT_RANGE) {
        g.stunUntil = now + GHOST_SCARE_STUN_MS;
        g.coolUntil = now + GHOST_SCARE_STUN_MS + 2000;
        g.mode = 'stunned';
        hit += 1;
      }
    }
    ps.scared += hit;
  }
  io.to(room.code).emit(EVENTS.CITY_FX, { type: 'shout', playerId: id, hit });
  if (hit) {
    const p = room.players.get(id);
    feed(io, room, `📢 ${p.avatar} ${p.name} screamed and ${hit === 1 ? 'a ghost' : `${hit} ghosts`} ran away!`);
  }
  return true;
}

/* -------------------------------------------------------------- mansion ghosts */

function stepGhosts(io, room, dt, now) {
  const sim = room.city;
  const M = sim.mansion;
  const L = M.layout;
  const inside = [...sim.players.entries()].filter(([id, ps]) => {
    const p = room.players.get(id);
    return p && !p.left && ps.world === 1 && !ps.finishedAt;
  });
  if (!inside.length) return;
  for (const g of M.ghosts) {
    const stunned = g.stunUntil > now;
    g.mode = stunned ? 'stunned' : g.coolUntil > now ? 'flee' : g.mode === 'chase' ? 'chase' : 'patrol';
    if (stunned) continue;
    if (now >= g.retarget) {
      g.retarget = now + 450;
      let best = null;
      let bestD = 1e9;
      for (const [id, ps] of inside) {
        const d = Math.hypot(ps.x - g.x, ps.y - g.y);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (g.coolUntil > now) {
        g.mode = 'flee';
        if (g.goal === g.cell || Math.random() < 0.2) g.goal = L.ghostSpawns[Math.floor(Math.random() * L.ghostSpawns.length)];
      } else if (best && bestD < 620) {
        g.mode = 'chase';
        const ps = sim.players.get(best);
        const c = mz.cellAt(ps.x, ps.y);
        g.goal = mz.idxOf(c.r, c.c);
      } else {
        g.mode = 'patrol';
        if (g.goal === g.cell || Math.random() < 0.05) g.goal = Math.floor(Math.random() * mz.COLS * mz.ROWS);
      }
    }
    const nextCenter = mz.cellCenter(Math.floor(g.next / mz.COLS), g.next % mz.COLS);
    const dx = nextCenter.x - g.x;
    const dy = nextCenter.y - g.y;
    const dist = Math.hypot(dx, dy);
    const sp = g.speed * (g.mode === 'flee' ? 0.8 : g.mode === 'chase' ? 1.08 : 0.85);
    const step = sp * dt;
    if (dist <= step) {
      g.x = nextCenter.x;
      g.y = nextCenter.y;
      g.cell = g.next;
      if (g.cell !== g.goal) {
        const dm = mz.bfs(L, { r: Math.floor(g.goal / mz.COLS), c: g.goal % mz.COLS }, null).dist;
        let bestN = g.cell;
        let bestV = dm[g.cell];
        for (const [nr, nc] of mz.neighborsOf(L, Math.floor(g.cell / mz.COLS), g.cell % mz.COLS)) {
          const ni = mz.idxOf(nr, nc);
          if (dm[ni] !== -1 && dm[ni] < bestV) {
            bestV = dm[ni];
            bestN = ni;
          }
        }
        g.next = bestN;
      }
    } else {
      g.x += (dx / dist) * step;
      g.y += (dy / dist) * step;
    }
    if (g.mode !== 'flee') {
      for (const [id, ps] of inside) {
        if (now - ps.lastCaughtAt < GHOST_CATCH_COOLDOWN_MS || ps.stunUntil > now) continue;
        if (Math.hypot(ps.x - g.x, ps.y - g.y) < 34) {
          const p = room.players.get(id);
          ps.lastCaughtAt = now;
          ps.stunUntil = now + GHOST_SCARE_STUN_MS;
          ps.input = { dx: 0, dy: 0 };
          ps.caught += 1;
          addBladder(ps, CATCH_BLADDER);
          g.coolUntil = now + 4500;
          g.mode = 'flee';
          io.to(room.code).emit(EVENTS.CITY_FX, { type: 'caught', playerId: id });
          feed(io, room, `👻 A ghost scared ${p.avatar} ${p.name}! Bladder +${CATCH_BLADDER}%`);
          say(io, room, id, 'wrong', 0.5);
          break;
        }
      }
    }
  }
}

/* --------------------------------------------------------------------- bots */

function botMansionThink(io, room, id, ps, p, now) {
  const sim = room.city;
  const L = sim.mansion.layout;
  if (ps.finishedAt || ps.quiz || ps.stunUntil > now) {
    ps.input = { dx: 0, dy: 0 };
    return;
  }
  if (now > ps.botNextFlash && now >= ps.nextFlashAt) {
    ps.botNextFlash = now + 600;
    const near = sim.mansion.ghosts.some((g) => g.stunUntil <= now && Math.hypot(g.x - ps.x, g.y - ps.y) < 120);
    const eager = p.botTier === 'legend' ? 0.95 : p.botTier === 'elite' ? 0.8 : p.botTier === 'veteran' ? 0.55 : 0.3;
    if (near && Math.random() < eager) tryFlash(io, room, id, now);
  }
  const here = mz.cellAt(ps.x, ps.y);
  const hereIdx = mz.idxOf(here.r, here.c);
  const closed = new Set(L.doors.filter((d) => !ps.opened.has(d.letter)).map((d) => d.idx));
  if (now >= ps.botNextThink || ps.botGoal === null) {
    ps.botNextThink = now + 500;
    const reach = mz.bfs(L, here, closed).dist;
    const pending = L.keys.filter((k) => !ps.opened.has(k.letter.toUpperCase()) && reach[k.idx] !== -1).sort((a, b) => reach[a.idx] - reach[b.idx]);
    const T = mz.idxOf(L.toilet.r, L.toilet.c);
    if (pending.length) ps.botGoal = pending[0].idx;
    else if (reach[T] !== -1) ps.botGoal = T;
    else ps.botGoal = hereIdx;
  }
  const goalCell = { r: Math.floor(ps.botGoal / mz.COLS), c: ps.botGoal % mz.COLS };
  const dm = mz.bfs(L, goalCell, closed).dist;
  let target = mz.cellCenter(goalCell.r, goalCell.c);
  if (hereIdx !== ps.botGoal && dm[hereIdx] !== -1) {
    let bestN = hereIdx;
    let bestV = dm[hereIdx];
    for (const [nr, nc] of mz.neighborsOf(L, here.r, here.c)) {
      const ni = mz.idxOf(nr, nc);
      if (closed.has(ni) || dm[ni] === -1) continue;
      if (dm[ni] < bestV) {
        bestV = dm[ni];
        bestN = ni;
      }
    }
    target = mz.cellCenter(Math.floor(bestN / mz.COLS), bestN % mz.COLS);
  }
  ps.input = { dx: target.x - ps.x, dy: target.y - ps.y };
  if (Math.hypot(ps.input.dx, ps.input.dy) < 6) ps.input = { dx: 0, dy: 0 };
}

function nearestWc(ps, now) {
  let best = null;
  let bestD = 1e9;
  for (const w of MAP.wcs) {
    if ((ps.wcCd[w.id] || 0) > now) continue;
    const d = Math.hypot(w.door.x - ps.x, w.door.y - ps.y);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

function botThink(io, room, id, ps, p, now) {
  const sim = room.city;
  if (ps.world === 1) return botMansionThink(io, room, id, ps, p, now);
  if (ps.finishedAt || ps.quiz || ps.stunUntil > now) {
    ps.input = { dx: 0, dy: 0 };
    return;
  }
  const mission = sim.missions[ps.mission];
  if (!mission) return;
  // desperate? head for the nearest public toilet first
  let dest = mission.door;
  let destKey = `m${ps.mission}`;
  let radius = DOOR_RADIUS - 8;
  if (ps.bladder > 72) {
    const wc = nearestWc(ps, now);
    if (wc) {
      dest = wc.door;
      destKey = `w${wc.id}`;
      radius = WC_RADIUS - 10;
    }
  }
  const toDoor = Math.hypot(dest.x - ps.x, dest.y - ps.y);
  if (toDoor < radius) {
    ps.input = { dx: 0, dy: 0 };
    return;
  }
  if (ps.pathFor !== destKey || !ps.path.length) {
    ps.path = findPath(ps.x, ps.y, dest.x, dest.y);
    ps.pathFor = destKey;
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

/* ------------------------------------------------------------------ snapshot */

// flag bits: 1 stunned, 2 shield, 4 boost, 8 in quiz, 32 finished, 64 left, 128 accident, 256 clenching,
//            512 flashlight, 1024 shouting
function snapshot(room) {
  const sim = room.city;
  const now = Date.now();
  const anyInside = [...sim.players.values()].some((ps) => ps.world === 1);
  return {
    t: now,
    p: sim.order.map((id) => {
      const ps = sim.players.get(id);
      let flags = 0;
      if (ps.stunUntil > now && ps.accidentUntil <= now) flags |= 1;
      if (ps.shield) flags |= 2;
      if (ps.boostUntil > now) flags |= 4;
      if (ps.quiz) flags |= 8;
      if (ps.finishedAt) flags |= 32;
      const pl = room.players.get(id);
      if (pl && pl.left) flags |= 64;
      if (ps.accidentUntil > now) flags |= 128;
      if (ps.clenchUntil > now) flags |= 256;
      if (ps.flashUntil > now) flags |= 512;
      if (ps.shoutUntil > now) flags |= 1024;
      let keys = 0;
      if (ps.opened.has('A')) keys |= 1;
      if (ps.opened.has('B')) keys |= 2;
      if (ps.opened.has('C')) keys |= 4;
      return [ps.idx, Math.round(ps.x), Math.round(ps.y), ps.face, flags, ps.mission, ps.points, ps.blaster, Math.round(ps.bladder * 10) / 10, ps.world, keys];
    }),
    n: sim.npcs.map((n) => [Math.round(n.x), Math.round(n.y), n.d, n.path.length ? 1 : 0]),
    c: sim.cars.map((c) => [Math.round(c.horizontal ? c.pos : c.fixed), Math.round(c.horizontal ? c.fixed : c.pos), c.horizontal ? 0 : 1, c.dir, c.color]),
    g: anyInside ? sim.mansion.ghosts.map((g) => [Math.round(g.x), Math.round(g.y), g.mode === 'chase' ? 1 : g.mode === 'stunned' ? 2 : g.mode === 'flee' ? 3 : 0]) : [],
    endsAt: sim.endsAt,
  };
}

function bodyTick(io, room, id, ps, p, now, dt) {
  if (ps.finishedAt) return;
  // the bladder fills; a desperate one leaks farts and finally gives up
  ps.bladder = Math.min(100, ps.bladder + (100 / BLADDER_FILL_S) * dt);
  if (ps.bladder > 48 && now >= ps.nextFartAt && ps.accidentUntil <= now) {
    const pressure = (ps.bladder - 48) / 52;
    ps.farts += 1;
    ps.clenchUntil = now + CLENCH_MS;
    ps.nextFartAt = now + (9000 - 6400 * pressure) * (0.7 + Math.random() * 0.6);
    io.to(room.code).emit(EVENTS.CITY_FX, { type: 'fart', playerId: id, kind: Math.floor(Math.random() * FART_KINDS), big: pressure > 0.7 && Math.random() < 0.5 });
  }
  if (ps.bladder >= 100 && ps.accidentUntil <= now) {
    ps.accidentUntil = now + ACCIDENT_MS;
    ps.stunUntil = Math.max(ps.stunUntil, ps.accidentUntil);
    ps.input = { dx: 0, dy: 0 };
    ps.points = Math.max(0, ps.points - ACCIDENT_PENALTY);
    p.score = ps.points;
    ps.bladder = ACCIDENT_RESET;
    ps.accidents += 1;
    io.to(room.code).emit(EVENTS.CITY_FX, { type: 'accident', playerId: id });
    feed(io, room, `💩 ${p.avatar} ${p.name} couldn't hold it any longer! −${ACCIDENT_PENALTY}`);
    say(io, room, id, 'wrong', 0.9);
  }
}

function tick(io, room) {
  const sim = room.city;
  if (!sim || room.state !== 'city' || sim.over) return;
  const now = Date.now();
  const dt = Math.min(0.1, (now - sim.lastTickAt) / 1000);
  sim.lastTickAt = now;
  sim.tick += 1;

  const started = now >= sim.startsAt;
  if (started) {
    for (const [id, ps] of sim.players) {
      const p = room.players.get(id);
      if (!p || p.left) continue;
      if (!p.isBot && !p.connected) ps.input = { dx: 0, dy: 0 }; // a dropped connection stops walking
      if (p.isBot) botThink(io, room, id, ps, p, now);
      if (ps.quiz && now > ps.quiz.endsAt) resolveAnswer(io, room, id, -1);
      if (!ps.finishedAt) movePlayer(sim, ps, ps.input.dx, ps.input.dy, dt, now);
      bodyTick(io, room, id, ps, p, now, dt);

      const free = !ps.finishedAt && !ps.quiz && now >= ps.lockoutUntil && ps.stunUntil <= now;
      if (free && ps.world === 0) {
        // reaching the door of the current mission opens the quiz gate
        const m = sim.missions[ps.mission];
        if (m && Math.hypot(m.door.x - ps.x, m.door.y - ps.y) < DOOR_RADIUS) openQuiz(io, room, id, ps, now, { kind: 'gate' });
        else if (ps.bladder >= WC_MIN_BLADDER) {
          // a public toilet stall
          for (const w of MAP.wcs) {
            if ((ps.wcCd[w.id] || 0) > now) continue;
            if (Math.hypot(w.door.x - ps.x, w.door.y - ps.y) < WC_RADIUS) {
              openQuiz(io, room, id, ps, now, { kind: 'wc', wc: w.id });
              break;
            }
          }
        }
      } else if (free && ps.world === 1) {
        const L = sim.mansion.layout;
        for (const k of L.keys) {
          if (ps.opened.has(k.letter.toUpperCase())) continue;
          const c = mz.cellCenter(k.r, k.c);
          if (Math.hypot(c.x - ps.x, c.y - ps.y) < mz.KEY_RADIUS) {
            openQuiz(io, room, id, ps, now, { kind: 'key', letter: k.letter });
            break;
          }
        }
        const t = mz.cellCenter(L.toilet.r, L.toilet.c);
        if (!ps.quiz && Math.hypot(t.x - ps.x, t.y - ps.y) < mz.TOILET_RADIUS) completeMansion(io, room, id, ps, now);
      }
    }
    stepGhosts(io, room, dt, now);
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
  for (const [id, ps] of sim.players) missionsById[id] = { done: ps.missionsDone, finished: !!ps.finishedAt, rank: ps.finishRank, accidents: ps.accidents };
  const entries = [...sim.players.entries()];
  const nameOf = (id) => room.players.get(id).name;
  const awards = [];
  const best = entries.slice().sort((a, b) => b[1].missionsDone - a[1].missionsDone || b[1].points - a[1].points)[0];
  if (best) awards.push({ key: 'mission', icon: '🎯', title: 'Mission Master', playerId: best[0], name: nameOf(best[0]), detail: `${best[1].missionsDone}/${sim.missions.length} missions` });
  const leaky = entries.slice().sort((a, b) => b[1].accidents - a[1].accidents || b[1].farts - a[1].farts)[0];
  if (leaky && leaky[1].accidents > 0) awards.push({ key: 'leaky', icon: '💩', title: 'Leaky Pants', playerId: leaky[0], name: nameOf(leaky[0]), detail: `${leaky[1].accidents} accident${leaky[1].accidents > 1 ? 's' : ''}` });
  else {
    const iron = entries.filter(([, ps]) => ps.finishedAt && ps.accidents === 0).sort((a, b) => a[1].finishRank - b[1].finishRank)[0];
    if (iron) awards.push({ key: 'iron', icon: '🧊', title: 'Iron Bladder', playerId: iron[0], name: nameOf(iron[0]), detail: 'not a single accident' });
  }
  const tooter = entries.slice().sort((a, b) => b[1].farts - a[1].farts)[0];
  if (tooter && tooter[1].farts > 0 && awards.length < 3) awards.push({ key: 'toot', icon: '💨', title: 'Loudest Cheeks', playerId: tooter[0], name: nameOf(tooter[0]), detail: `${tooter[1].farts} toot${tooter[1].farts > 1 ? 's' : ''}` });
  const magnet = entries.slice().sort((a, b) => b[1].caught - a[1].caught)[0];
  if (magnet && magnet[1].caught > 0 && awards.length < 3) awards.push({ key: 'magnet', icon: '👻', title: 'Ghost Magnet', playerId: magnet[0], name: nameOf(magnet[0]), detail: `scared ${magnet[1].caught}×` });
  io.to(room.code).emit(EVENTS.GAME_FINAL, { leaderboard: board, podium: board.slice(0, 3), awards, teams: null, teamMode: 0, city: { missions: missionsById, total: sim.missions.length } });
  db.saveGameResult({
    roomCode: room.code,
    category: 'city',
    categoryLabel: '🌆 City Mission: We Gotta Go',
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

// Space / the action button: the flashlight inside the mansion, the blaster out in the city
function zap(io, room, playerId) {
  const sim = room.city;
  if (!sim || room.state !== 'city' || Date.now() < sim.startsAt) return;
  const ps = sim.players.get(playerId);
  if (!ps) return;
  if (ps.world === 1) tryFlash(io, room, playerId, Date.now());
  else tryZap(io, room, playerId, Date.now());
}

function shout(io, room, playerId) {
  const sim = room.city;
  if (!sim || room.state !== 'city' || Date.now() < sim.startsAt) return;
  tryShout(io, room, playerId, Date.now());
}

function stopCity(room) {
  if (room.timers && room.timers.cityTick) {
    clearInterval(room.timers.cityTick);
    room.timers.cityTick = null;
  }
  room.city = null;
}

module.exports = { startCity, initPayload, setInput, answer, zap, shout, finishCity, stopCity, MAP, KINDS, findPath };
