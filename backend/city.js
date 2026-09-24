/*
 * City Chaos: We Gotta Go — a GTA-style multiplayer free-roam brawl. Server-authoritative.
 *
 * Everyone (humans and computer players) is dropped into a small 3D city full of pedestrians,
 * traffic, armed guards and — when you misbehave — the police. Fists, a baseball bat, a pistol,
 * an SMG and a shotgun; steal any car and run people over; rob the bank and watch the wanted
 * stars climb. Missions are stops on the map (Gun Store → Haunted Mansion → Bank heist → the
 * Royal Restroom) that pay out cash; the richest player when time runs out wins, and the first
 * one through the Royal Restroom doors ends the match early.
 *
 * The Haunted Mansion is a maze of moonlit halls: three locked rooms (A, B, C), a key for each
 * lying somewhere in the dark, ghosts on patrol (shoot them, blind them with the flashlight or
 * shout at them) and a toilet exit at the far end.
 *
 * And the whole time your own BLADDER is filling. Blue public toilet stalls give relief; at high
 * pressure you clench, fart and hop, and at 100% you have an accident that costs you cash and
 * freezes you in shame for a few seconds.
 *
 * Positions are simulated at 20 Hz; clients get snapshots at 10 Hz and predict their own movement.
 */
const EVENTS = require('./events');
const { serializePlayers } = require('./rooms');
const { getTier } = require('./bots');
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
const MATCH_MS = 8 * 60 * 1000;
const FINISH_GRACE_MS = 40000;
const START_COUNTDOWN_MS = 3400;
const DOOR_RADIUS = 46;
const NPC_COUNT = 26;
const CAR_COUNT = 8;
const FINISH_BONUS = [2000, 1200, 600];

const RESPAWN_MS = 4000;
const INVULN_MS = 2500;
const START_HP = 100;

// ---- vehicles ----
const CAR_R = 20;
const CAR_MAX_SPEED = 310;
const CAR_TURN = 3.4;
const CAR_HP = 220;
const ROADKILL_DMG = 34;
const ENTER_CAR_RANGE = 64;
const PARKED_TTL_MS = 25000;
const WRECK_RESPAWN_MS = 12000;

// ---- bladder, farts and accidents ----
const BLADDER_FILL_S = Number(process.env.BLADDER_FILL_S) || 150; // 0 -> 100% in this many seconds if nothing else happens
const STARTER_ARSENAL = process.env.STARTER_ARSENAL === '1'; // test knob: everyone starts with every weapon
const CLENCH_MS = 650;
const CLENCH_SPEED_MUL = 0.35;
const ACCIDENT_MS = 5500;
const ACCIDENT_PENALTY = 250;
const ACCIDENT_RESET = 35;
const CATCH_BLADDER = 7;
const WC_RADIUS = 34;
const WC_HOLD_MS = 1500;
const WC_COOLDOWN_MS = 25000;
const WC_MIN_BLADDER = 18;
const FART_KINDS = 8; // the client maps a kind number to a sound recipe

// ---- haunted mansion ----
const MANSION_BONUS = 1000;
const KEY_CASH = 300;
const FLASH_RANGE = 210;
const FLASH_COOLDOWN_MS = 7000;
const GHOST_STUN_MS = 3500;
const GHOST_SCARE_STUN_MS = 2500;
const GHOST_CATCH_COOLDOWN_MS = 7000;
const SHOUT_RANGE = 170;
const SHOUT_COOLDOWN_MS = 6000;

// ---- law and order ----
const MAX_STARS = 5;
const WANTED_DECAY_MS = 22000;
const COP_HP = 70;
const GUARD_HP = 60;
const NPC_HP = 30;

const { WEAPONS, WEAPON_BY_CODE, AMMO_CAP, emptyAmmo, emptyWeapons, gunGate, startReload, spreadFor, afterShot } = require('./weapons');

/* ------------------------------------------------------------------ map */

// 4 columns x 3 rows of city blocks separated by 100px roads.
const LAYOUT = [
  [{ kind: 'gun', name: 'Gun Store' }, { kind: 'bank', name: 'Bank' }, { kind: 'park', name: 'City Park' }, { kind: 'hospital', name: 'Hospital' }],
  [{ kind: 'garage', name: 'Garage' }, { kind: 'arcade', name: 'Arcade' }, { kind: 'mansion', name: 'Haunted Mansion' }, { kind: 'radio', name: 'Radio Station' }],
  [{ kind: 'police', name: 'Police Dept' }, { kind: 'diner', name: 'Diner' }, { kind: 'park', name: 'Riverside Park' }, { kind: 'restroom', name: 'Royal Restroom' }],
];

// act: what standing at the door for `hold` ms does. Side stops work any time (with a cooldown).
const KINDS = {
  gun: { icon: '🔫', color: '#c0392b', act: 'weapons', hold: 1500, side: true, guards: 2, label: 'a full arsenal', line: 'Grab guns at the Gun Store' },
  garage: { icon: '🚗', color: '#2980b9', act: 'car', hold: 1500, side: true, guards: 1, label: 'a free car', line: 'A free car is waiting at the Garage' },
  bank: { icon: '💰', color: '#d4a017', act: 'heist', hold: 4200, side: true, guards: 3, label: '$1500 (and 3 wanted stars!)', line: 'Rob the bank — the cops will come' },
  hospital: { icon: '🏥', color: '#16a085', act: 'heal', hold: 1500, side: true, guards: 0, label: 'full health and armor', line: 'Patch yourself up at the Hospital' },
  arcade: { icon: '🎮', color: '#8e44ad', act: 'cash', hold: 1500, side: true, guards: 1, cash: 400, label: '+$400', line: 'Win arcade tokens' },
  radio: { icon: '📻', color: '#e67e22', act: 'cash', hold: 1500, side: true, guards: 1, cash: 400, label: '+$400', line: 'Go on air for a fame bonus' },
  police: { icon: '🚓', color: '#2c3e50', act: 'bribe', hold: 1500, side: true, guards: 0, label: 'a clean record', line: 'Bribe the police ($300) to lose your stars' },
  diner: { icon: '🍔', color: '#e74c3c', act: 'food', hold: 1500, side: true, guards: 1, cash: 250, label: 'a hot meal', line: 'Grab a burger for health' },
  mansion: { icon: '🏚️', color: '#5b3fd6', act: 'mansion', hold: 1500, side: false, guards: 2, label: 'the Haunted Mansion', line: 'Enter the haunted mansion — win 3 keys, dodge the ghosts, find the toilet' },
  restroom: { icon: '🚽', color: '#f1c40f', act: 'finish', hold: 2000, side: false, guards: 3, label: 'the win', line: 'Reach the Royal Restroom to win' },
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
const BUILDING_BY_KIND = Object.fromEntries(MAP.buildings.map((b) => [b.kind, b]));
const CITY_RECTS = MAP.obstacles.map((o) => ({ x0: o.x, x1: o.x + o.w, y0: o.y, y1: o.y + o.h }));

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

/* --------------------------------------------------------------- helpers */

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const TAU = Math.PI * 2;
const angDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

function shuffled(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// distance along a ray to the first wall (or `max`)
function rayRect(ox, oy, dx, dy, rc) {
  let t0 = 0;
  let t1 = Infinity;
  for (const [o, d, lo, hi] of [[ox, dx, rc.x0, rc.x1], [oy, dy, rc.y0, rc.y1]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let a = (lo - o) / d;
      let b = (hi - o) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

function wallDistance(sim, world, ox, oy, ang, max) {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  let best = max;
  const rects = world === 1 ? sim.mansion.rects : CITY_RECTS;
  for (const rc of rects) {
    const t = rayRect(ox, oy, dx, dy, rc);
    if (t < best) best = t;
  }
  return best;
}

function segmentClear(sim, world, x1, y1, x2, y2) {
  const d = Math.hypot(x2 - x1, y2 - y1);
  if (d < 1) return true;
  return wallDistance(sim, world, x1, y1, Math.atan2(y2 - y1, x2 - x1), d) >= d - 0.5;
}

/* --------------------------------------------------------------- world sim */

function pickMissions() {
  const kinds = ['gun', 'mansion', 'bank', 'restroom'];
  return kinds.map((kind) => {
    const b = BUILDING_BY_KIND[kind];
    const k = KINDS[kind];
    return { kind, name: b.name, icon: k.icon, label: k.label, line: k.line, door: b.door, buildingId: b.id, hold: k.hold };
  });
}

function makeNpcs() {
  return Array.from({ length: NPC_COUNT }, () => {
    const at = randomWalkable();
    return { x: at.x, y: at.y, d: 1, path: [], wait: Math.random() * 3, speed: 46 + Math.random() * 30, look: [Math.floor(Math.random() * 6), Math.floor(Math.random() * 10)], hp: NPC_HP, state: 0, respawnAt: 0, fleeUntil: 0 };
  });
}

function laneCar(id) {
  const horizontal = id % 2 === 0;
  const laneIdx = horizontal ? Math.floor(Math.random() * 4) : Math.floor(Math.random() * 5);
  const dir = Math.random() < 0.5 ? 1 : -1;
  const center = horizontal ? laneIdx * MAP.rowStep + 50 : laneIdx * MAP.colStep + 50;
  return { horizontal, fixed: center + dir * 20, pos: Math.random() * (horizontal ? W : H), dir, laneSpeed: 120 + Math.random() * 60 };
}

function placeLaneCar(c) {
  if (c.horizontal) {
    c.x = c.pos;
    c.y = c.fixed;
    c.ang = c.dir > 0 ? 0 : Math.PI;
  } else {
    c.x = c.fixed;
    c.y = c.pos;
    c.ang = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
}

function makeCars(sim) {
  const cars = [];
  for (let i = 0; i < CAR_COUNT; i++) {
    const c = { id: sim.nextId++, mode: 'lane', driver: null, hp: CAR_HP, speed: 0, color: Math.floor(Math.random() * 6), parkedAt: 0, respawnAt: 0, lastDriver: null, ...laneCar(i) };
    placeLaneCar(c);
    cars.push(c);
  }
  return cars;
}

function makeGuards(sim) {
  const guards = [];
  for (const b of MAP.buildings) {
    const n = KINDS[b.kind].guards || 0;
    for (let i = 0; i < n; i++) {
      const off = [[-72, -6], [72, -6], [0, 46], [-40, 40]][i % 4];
      const [cx, cy] = nearestWalkable(b.door.x + off[0], b.door.y + off[1]);
      const hx = cx * CELL + CELL / 2;
      const hy = cy * CELL + CELL / 2;
      guards.push({ id: sim.nextId++, bId: b.id, homeX: hx, homeY: hy, x: hx, y: hy, ang: Math.PI / 2, hp: GUARD_HP, alive: true, respawnAt: 0, nextShotAt: 0, shootUntil: 0 });
    }
  }
  return guards;
}

function makeSpawners() {
  const spots = [];
  for (const p of MAP.parks) {
    spots.push({ x: p.x + p.w / 2 - 70, y: p.y + p.h - 30, type: 'health', value: 40 });
    spots.push({ x: p.x + p.w / 2 + 70, y: p.y + p.h - 30, type: 'armor', value: 40 });
  }
  const diner = BUILDING_BY_KIND.diner;
  spots.push({ x: diner.door.x + 60, y: diner.door.y, type: 'bat', value: 1 });
  const garage = BUILDING_BY_KIND.garage;
  spots.push({ x: garage.door.x - 60, y: garage.door.y, type: 'pistol', value: 30 });
  return spots.map((s) => ({ ...s, pk: null, respawnAt: 0 }));
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
  const collision = mz.buildCollision(layout);
  const rects = Array.from(new Set(collision.flat()));
  return { layout, collision, rects, ghosts };
}

function startCity(io, room) {
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
    nextId: 1,
    npcs: makeNpcs(),
    cars: [],
    guards: [],
    cops: [],
    pickups: [],
    spawners: makeSpawners(),
    players: new Map(),
    tick: 0,
    noHumansSince: null,
    over: false,
    lastTickAt: now,
    nextCopAt: 0,
  };
  sim.cars = makeCars(sim);
  sim.guards = makeGuards(sim);
  order.forEach((id, i) => {
    const p = room.players.get(id);
    p.score = 0;
    p.left = false;
    const sp = spawnPoints[i % spawnPoints.length];
    sim.players.set(id, {
      idx: i,
      x: sp.x,
      y: sp.y,
      ang: 0,
      input: { dx: 0, dy: 0 },
      stunUntil: 0,
      // combat
      hp: START_HP,
      armor: 0,
      cash: 0,
      weapon: STARTER_ARSENAL ? 'pistol' : 'fists',
      weapons: STARTER_ARSENAL ? { fists: true, bat: true, pistol: true, smg: true, shotgun: true, ar: true, sniper: true } : emptyWeapons(),
      ammo: STARTER_ARSENAL ? { pistol: 120, smg: 300, shotgun: 48, ar: 240, sniper: 30 } : emptyAmmo(),
      mag: {},
      reloadUntil: 0,
      reloadKey: '',
      heat: 0,
      heatAt: 0,
      nextAttackAt: 0,
      attackUntil: 0,
      hurtUntil: 0,
      deadUntil: 0,
      invulnUntil: now + START_COUNTDOWN_MS + INVULN_MS,
      kills: 0,
      deaths: 0,
      lastHurtBy: null,
      lastHurtAt: 0,
      wanted: 0,
      lastCrimeAt: 0,
      veh: null,
      // progress
      mission: 0,
      missionsDone: 0,
      finishedAt: null,
      finishRank: null,
      holdKey: '',
      holdMs: 0,
      holdNeed: 0,
      sideCd: {},
      path: [],
      pathFor: '',
      speedMul: p.isBot ? getTier(p.botTier).speed : 1,
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
      // bots
      botNextThink: 0,
      botGoal: null,
      botNextFlash: 0,
      botTarget: null,
      botStrafeAt: 0,
      botStrafeDir: 1,
      botReactAt: 0,
      botKind: '',
    });
  });
  room.city = sim;
  room.state = 'city';
  room.startsAt = sim.startsAt;

  if (process.env.TEST_START_MANSION === '1') {
    // test knob: humans begin inside the haunted mansion
    for (const [id, ps] of sim.players) {
      const p = room.players.get(id);
      if (p && !p.isBot) {
        ps.mission = 1;
        enterMansion(io, room, sim, id, ps, BUILDING_BY_KIND.mansion);
      }
    }
  }
  io.to(room.code).emit(EVENTS.CITY_START, initPayload(room));
  room.timers.cityTick = setInterval(() => tick(io, room), TICK_MS);
}

function initPayload(room) {
  const sim = room.city;
  const L = sim.mansion.layout;
  const walls = mz.compactWalls(L);
  return {
    map: sim.map,
    missions: sim.missions.map((m) => ({ kind: m.kind, name: m.name, icon: m.icon, label: m.label, line: m.line, door: m.door, hold: m.hold })),
    kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { icon: v.icon, act: v.act, side: v.side, hold: v.hold, line: v.line }])),
    weapons: WEAPON_BY_CODE.map((k) => ({ key: k, label: WEAPONS[k].label, melee: !!WEAPONS[k].melee })),
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
    guardCount: sim.guards.length,
    startsAt: sim.startsAt,
    endsAt: sim.endsAt,
    serverNow: Date.now(),
    snapshot: snapshot(room),
  };
}

/* ------------------------------------------------------------- tiny utilities */

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

const feed = (io, room, text) => io.to(room.code).emit(EVENTS.CITY_FEED, { text });
const fx = (io, room, payload) => io.to(room.code).emit(EVENTS.CITY_FX, payload);

function setCash(room, id, ps, delta) {
  ps.cash = Math.max(0, ps.cash + delta);
  const p = room.players.get(id);
  if (p) p.score = ps.cash;
}

function nameOf(room, id) {
  const p = room.players.get(id);
  return p ? `${p.avatar} ${p.name}` : 'Someone';
}

function idOfPs(sim, ps) {
  for (const [id, x] of sim.players) if (x === ps) return id;
  return null;
}

function addBladder(ps, amount) {
  ps.bladder = Math.max(0, Math.min(100, ps.bladder + amount));
}

/* ------------------------------------------------------------------ pickups */

const PICKUP_CODE = { cash: 0, pistol: 1, smg: 2, shotgun: 3, health: 4, armor: 5, bat: 6, ar: 7, sniper: 8, ammo: 9 };

function dropPickup(sim, type, x, y, value, ttl) {
  if (sim.pickups.length > 70) sim.pickups.shift();
  const pk = { id: sim.nextId++, type, x, y, value, expires: ttl ? Date.now() + ttl : 0 };
  sim.pickups.push(pk);
  return pk;
}

function givePickup(io, room, id, ps, pk, now) {
  if (pk.type === 'cash') setCash(room, id, ps, pk.value);
  else if (pk.type === 'health') {
    if (ps.hp >= START_HP && pk.value) ps.hp = START_HP;
    ps.hp = Math.min(START_HP, ps.hp + pk.value);
  } else if (pk.type === 'armor') ps.armor = Math.min(100, ps.armor + pk.value);
  else if (pk.type === 'bat') {
    ps.weapons.bat = true;
    if (ps.weapon === 'fists') ps.weapon = 'bat';
  } else {
    ps.weapons[pk.type] = true;
    ps.ammo[pk.type] = Math.min(AMMO_CAP[pk.type], ps.ammo[pk.type] + pk.value);
    if (ps.weapon === 'fists' || ps.weapon === 'bat') ps.weapon = pk.type;
  }
  fx(io, room, { type: 'pickup', playerId: id, what: pk.type, x: pk.x, y: pk.y });
  void now;
}

/* -------------------------------------------------------------------- combat */

function gatherTargets(sim, room, attId, world, now) {
  const out = [];
  for (const [id, ps] of sim.players) {
    if (id === attId) continue;
    const p = room.players.get(id);
    if (!p || p.left || ps.world !== world || ps.deadUntil > now || ps.finishedAt) continue;
    out.push({ kind: 'player', id, ref: ps, x: ps.x, y: ps.y, r: ps.veh ? 19 : 13 });
  }
  if (world === 0) {
    for (const n of sim.npcs) if (n.state !== 2) out.push({ kind: 'npc', ref: n, x: n.x, y: n.y, r: 12 });
    for (const g of sim.guards) if (g.alive) out.push({ kind: 'guard', ref: g, x: g.x, y: g.y, r: 13 });
    for (const c of sim.cops) if (c.hp > 0) out.push({ kind: 'cop', ref: c, x: c.x, y: c.y, r: 13 });
  } else {
    for (const g of sim.mansion.ghosts) out.push({ kind: 'ghost', ref: g, x: g.x, y: g.y, r: 26 });
  }
  return out;
}

function addWanted(io, room, sim, ps, n, now, cap) {
  if (!ps) return;
  const before = ps.wanted;
  ps.wanted = Math.max(ps.wanted, Math.min(cap || MAX_STARS, Math.max(ps.wanted, 0) + n)); // street crimes alone can't max you out
  ps.lastCrimeAt = now;
  if (ps.wanted > before) {
    const id = idOfPs(sim, ps);
    fx(io, room, { type: 'wanted', playerId: id, level: ps.wanted });
    if (before === 0) feed(io, room, `🚨 ${nameOf(room, id)} is WANTED!`);
  }
}

function killNpcLike(io, room, sim, tgt, attPs, now) {
  const { kind, ref } = tgt;
  if (kind === 'npc') {
    ref.state = 2;
    ref.respawnAt = now + 10000;
    dropPickup(sim, 'cash', ref.x, ref.y, Math.round(rnd(40, 140)), 25000);
    if (attPs) addWanted(io, room, sim, attPs, 1, now, 2);
  } else if (kind === 'guard') {
    ref.alive = false;
    ref.respawnAt = now + 30000;
    dropPickup(sim, 'cash', ref.x, ref.y, 180, 25000);
    if (Math.random() < 0.6) dropPickup(sim, Math.random() < 0.5 ? 'pistol' : 'smg', ref.x + 14, ref.y + 6, 24, 25000);
  } else if (kind === 'cop') {
    ref.hp = 0;
    dropPickup(sim, 'cash', ref.x, ref.y, 120, 25000);
    dropPickup(sim, 'armor', ref.x + 14, ref.y, 30, 25000);
    if (attPs) addWanted(io, room, sim, attPs, 2, now, 3);
  }
  fx(io, room, { type: 'down', kind, x: Math.round(ref.x), y: Math.round(ref.y) });
  if (attPs) {
    attPs.kills += 1;
    const aid = idOfPs(sim, attPs);
    say(io, room, aid, 'kill', 0.18);
  }
}

function respawnPlayer(io, room, sim, id, ps, now) {
  const h = BUILDING_BY_KIND.hospital;
  const [cx, cy] = nearestWalkable(h.door.x + rnd(-60, 60), h.door.y + rnd(0, 30));
  ps.world = 0;
  ps.x = cx * CELL + CELL / 2;
  ps.y = cy * CELL + CELL / 2;
  ps.hp = START_HP;
  ps.armor = 0;
  ps.deadUntil = 0;
  ps.veh = null;
  ps.input = { dx: 0, dy: 0 };
  ps.weapon = ps.weapons.pistol && ps.ammo.pistol > 0 ? 'pistol' : 'fists';
  for (const k of Object.keys(ps.ammo)) ps.ammo[k] = Math.floor(ps.ammo[k] * 0.5);
  ps.invulnUntil = now + INVULN_MS;
  ps.path = [];
  ps.botTarget = null;
  fx(io, room, { type: 'respawn', playerId: id });
}

function killPlayer(io, room, sim, id, ps, killer, cause, now) {
  ps.hp = 0;
  ps.deadUntil = now + RESPAWN_MS;
  ps.deaths += 1;
  ps.wanted = 0;
  ps.input = { dx: 0, dy: 0 };
  ps.holdMs = 0;
  ps.holdKey = '';
  if (ps.veh) exitCar(io, room, sim, ps, now, true);
  const drop = Math.round(ps.cash * 0.2);
  if (drop > 0) {
    setCash(room, id, ps, -drop);
    dropPickup(sim, 'cash', ps.x, ps.y, drop, 30000);
  }
  const kid = killer ? idOfPs(sim, killer) : null;
  if (killer && killer !== ps) {
    killer.kills += 1;
    setCash(room, kid, killer, 250);
    say(io, room, kid, 'kill', 0.5);
  }
  say(io, room, id, 'die', 0.5);
  fx(io, room, { type: 'kill', killer: kid, victim: id, weapon: cause });
  feed(io, room, kid && kid !== id ? `💀 ${nameOf(room, kid)} ${cause === 'car' ? 'ran over' : cause === 'boom' ? 'blew up' : 'took out'} ${nameOf(room, id)}` : `💀 ${nameOf(room, id)} died${cause ? ` (${cause})` : ''}`);
}

function damagePlayer(io, room, sim, id, ps, dmg, killer, cause, now) {
  if (ps.deadUntil > now || ps.invulnUntil > now || ps.finishedAt) return false;
  let d = dmg;
  if (ps.veh) d *= 0.55;
  if (ps.armor > 0) {
    const a = Math.min(ps.armor, d * 0.6);
    ps.armor -= a;
    d -= a;
  }
  ps.hp -= d;
  ps.hurtUntil = now + 220;
  if (killer) {
    ps.lastHurtBy = idOfPs(sim, killer);
    ps.lastHurtAt = now;
  }
  fx(io, room, { type: 'hit', x: Math.round(ps.x), y: Math.round(ps.y), dmg: Math.round(dmg), k: 0, playerId: id, by: killer ? idOfPs(sim, killer) : null, from: killer ? [Math.round(killer.x), Math.round(killer.y)] : null });
  if (ps.hp <= 0) {
    killPlayer(io, room, sim, id, ps, killer, cause, now);
    return true;
  }
  say(io, room, id, 'hurt', 0.06);
  return false;
}

function hitTarget(io, room, sim, att, tgt, dmg, cause, now) {
  const attId = att ? idOfPs(sim, att) : null;
  if (tgt.kind === 'player') {
    damagePlayer(io, room, sim, tgt.id, tgt.ref, dmg, att, cause, now);
    return;
  }
  if (tgt.kind === 'ghost') {
    const g = tgt.ref;
    g.stunUntil = now + GHOST_SCARE_STUN_MS;
    g.coolUntil = now + GHOST_SCARE_STUN_MS + 2000;
    g.mode = 'stunned';
    if (att) att.scared += 1;
    fx(io, room, { type: 'hit', x: Math.round(g.x), y: Math.round(g.y), dmg: 0, k: 4 });
    return;
  }
  const ref = tgt.ref;
  const before = tgt.kind === 'npc' ? ref.hp : ref.hp;
  ref.hp = before - dmg;
  fx(io, room, { type: 'hit', x: Math.round(ref.x), y: Math.round(ref.y), dmg: Math.round(dmg), k: tgt.kind === 'npc' ? 1 : tgt.kind === 'guard' ? 2 : 3, by: attId });
  if (tgt.kind === 'npc' && ref.state !== 2 && ref.hp > 0) {
    ref.state = 1;
    ref.fleeUntil = now + 6000;
    ref.path = [];
    if (att) att.lastCrimeAt = now;
  }
  if (ref.hp <= 0) killNpcLike(io, room, sim, tgt, att, now);
  else if (tgt.kind === 'cop' && att) addWanted(io, room, sim, att, 2, now);
  void attId;
}

// One attack: melee cone or a hitscan volley. Returns true if it went off.
function attackNow(io, room, id, ps, now, opt) {
  const sim = room.city;
  if (!sim || ps.deadUntil > now || ps.finishedAt || ps.veh || ps.stunUntil > now || now < sim.startsAt || now < ps.nextAttackAt) return false;
  let key = ps.weapon;
  let w = WEAPONS[key];
  if (!w) return false;
  if (!w.melee && ps.ammo[w.ammoKey] <= 0) {
    key = ps.weapons.bat ? 'bat' : 'fists';
    ps.weapon = key;
    w = WEAPONS[key];
  }
  if (!w.melee && !gunGate(ps, key, now)) return false;
  const world = ps.world;
  const targets = gatherTargets(sim, room, id, world, now);
  let aim = ps.ang;
  let picked = null;
  if (opt && opt.target) {
    picked = opt.target;
    aim = Math.atan2(picked.y - ps.y, picked.x - ps.x) + (opt.err || 0);
  } else {
    // auto-aim: the closest thing roughly in front of you
    let bestScore = Infinity;
    for (const t of targets) {
      const d = Math.hypot(t.x - ps.x, t.y - ps.y);
      if (d > w.range + t.r) continue;
      const a = angDiff(ps.ang, Math.atan2(t.y - ps.y, t.x - ps.x));
      if (Math.abs(a) > (w.melee ? 1.1 : 0.8)) continue;
      const score = d + Math.abs(a) * 140;
      if (score < bestScore) {
        bestScore = score;
        picked = t;
      }
    }
    if (picked) aim = Math.atan2(picked.y - ps.y, picked.x - ps.x);
  }
  ps.ang = aim;
  ps.nextAttackAt = now + w.cd;
  ps.attackUntil = now + 280;

  if (w.melee) {
    const hits = [];
    for (const t of targets) {
      const d = Math.hypot(t.x - ps.x, t.y - ps.y);
      if (d > w.range + t.r) continue;
      if (Math.abs(angDiff(aim, Math.atan2(t.y - ps.y, t.x - ps.x))) > w.cone / 2 && d > t.r + 8) continue;
      hits.push({ t, d });
    }
    hits.sort((a, b) => a.d - b.d);
    fx(io, room, { type: 'melee', playerId: id, w: w.code, hit: hits.length > 0 });
    for (const h of hits.slice(0, 2)) hitTarget(io, room, sim, ps, h.t, w.dmg, w.label.toLowerCase(), now);
    return true;
  }

  const moving = !!(ps.input && (ps.input.dx || ps.input.dy));
  const spr = spreadFor(ps, w, now, moving);
  afterShot(ps, key, now);
  const pellets = w.pellets || 1;
  const ends = [];
  const ox = ps.x + Math.cos(aim) * 14;
  const oy = ps.y + Math.sin(aim) * 14;
  for (let i = 0; i < pellets; i++) {
    const a = aim + (Math.random() - 0.5) * 2 * spr;
    const wall = wallDistance(sim, world, ox, oy, a, w.range);
    let best = wall;
    let hit = null;
    for (const t of targets) {
      const dx = t.x - ox;
      const dy = t.y - oy;
      const along = dx * Math.cos(a) + dy * Math.sin(a);
      if (along < 0 || along > best) continue;
      const perp = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
      if (perp > t.r) continue;
      const tt = Math.max(0, along - Math.sqrt(Math.max(0, t.r * t.r - perp * perp)));
      if (tt < best) {
        best = tt;
        hit = t;
      }
    }
    ends.push([Math.round(ox + Math.cos(a) * best), Math.round(oy + Math.sin(a) * best)]);
    if (hit) hitTarget(io, room, sim, ps, hit, w.dmg, w.label.toLowerCase(), now);
  }
  fx(io, room, { type: 'shot', playerId: id, w: w.code, x: Math.round(ox), y: Math.round(oy), ends });
  if (ps.world === 0 && ps.wanted === 0 && Math.random() < 0.02) addWanted(io, room, sim, ps, 0, now);
  return true;
}

// guards and cops fire at players
function enemyShoot(io, room, sim, shooter, tgt, dmg, acc, now) {
  const ang = Math.atan2(tgt.y - shooter.y, tgt.x - shooter.x);
  shooter.ang = ang;
  const ox = shooter.x + Math.cos(ang) * 14;
  const oy = shooter.y + Math.sin(ang) * 14;
  const hit = Math.random() < acc;
  const a = ang + (hit ? 0 : (Math.random() < 0.5 ? -1 : 1) * rnd(0.08, 0.25));
  const d = Math.hypot(tgt.x - ox, tgt.y - oy);
  const wall = wallDistance(sim, 0, ox, oy, a, 560);
  const end = Math.min(wall, hit ? d : d + 60);
  fx(io, room, { type: 'shot', playerId: null, w: 2, x: Math.round(ox), y: Math.round(oy), ends: [[Math.round(ox + Math.cos(a) * end), Math.round(oy + Math.sin(a) * end)]] });
  if (hit && wall >= d - 4) {
    const id = idOfPs(sim, tgt);
    damagePlayer(io, room, sim, id, tgt, dmg, null, 'gunfire', now);
  }
}

/* ------------------------------------------------------------------- vehicles */

function nearestCar(sim, x, y) {
  let best = null;
  let bd = ENTER_CAR_RANGE;
  for (const c of sim.cars) {
    if (c.mode !== 'lane' && c.mode !== 'parked') continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

function enterCar(io, room, sim, id, ps, car, now) {
  car.mode = 'player';
  car.driver = id;
  car.lastDriver = id;
  car.speed = 0;
  ps.veh = car;
  ps.holdMs = 0;
  ps.holdKey = '';
  addWanted(io, room, sim, ps, 1, now); // grand theft auto!
  fx(io, room, { type: 'carjack', playerId: id });
}

function exitCar(io, room, sim, ps, now, silent) {
  const car = ps.veh;
  if (!car) return;
  ps.veh = null;
  car.driver = null;
  car.mode = 'parked';
  car.speed = 0;
  car.parkedAt = now;
  const side = car.ang + Math.PI / 2;
  for (const s of [1, -1]) {
    const x = car.x + Math.cos(side) * 34 * s;
    const y = car.y + Math.sin(side) * 34 * s;
    if (!collides(x, y, PLAYER_R)) {
      ps.x = x;
      ps.y = y;
      return;
    }
  }
  const [cx, cy] = nearestWalkable(car.x, car.y);
  ps.x = cx * CELL + CELL / 2;
  ps.y = cy * CELL + CELL / 2;
  void io;
  void room;
  void silent;
}

function explodeCar(io, room, sim, car, now) {
  const credit = car.lastDriver && sim.players.get(car.lastDriver) ? sim.players.get(car.lastDriver) : null;
  fx(io, room, { type: 'boom', x: Math.round(car.x), y: Math.round(car.y) });
  const driver = car.driver ? sim.players.get(car.driver) : null;
  if (driver) {
    driver.veh = null;
    driver.x = car.x;
    driver.y = car.y;
  }
  car.mode = 'wreck';
  car.driver = null;
  car.speed = 0;
  car.hp = 0;
  car.respawnAt = now + WRECK_RESPAWN_MS;
  const near = gatherTargets(sim, room, null, 0, now);
  // the driver is thrown clear but hurt; everyone close takes blast damage
  if (driver) damagePlayer(io, room, sim, car.lastDriver, driver, 40, null, 'boom', now);
  for (const t of near) {
    const d = Math.hypot(t.x - car.x, t.y - car.y);
    if (d > 95) continue;
    if (t.kind === 'player' && t.ref === driver) continue;
    const dmg = 55 * (1 - d / 120);
    hitTarget(io, room, sim, credit && credit !== t.ref ? credit : null, t, dmg, 'boom', now);
  }
}

function stepDriver(io, room, sim, id, ps, dt, now) {
  const car = ps.veh;
  const { dx, dy } = ps.input;
  const mag = Math.hypot(dx, dy);
  if (mag > 0.1) {
    const target = Math.atan2(dy, dx);
    const turn = clamp(angDiff(car.ang, target), -CAR_TURN * dt, CAR_TURN * dt);
    car.ang += turn * (0.4 + 0.6 * Math.min(1, Math.abs(car.speed) / 120 + 0.3));
    car.speed += (CAR_MAX_SPEED * Math.min(1, mag) - car.speed) * Math.min(1, dt * 1.6);
  } else {
    car.speed = Math.max(0, car.speed - 240 * dt);
  }
  if (ps.stunUntil > now) car.speed = 0;
  const vx = Math.cos(car.ang) * car.speed * dt;
  const vy = Math.sin(car.ang) * car.speed * dt;
  let crashed = false;
  if (!collides(car.x + vx, car.y + vy, CAR_R)) {
    car.x += vx;
    car.y += vy;
  } else if (!collides(car.x + vx, car.y, CAR_R)) {
    car.x += vx;
    crashed = true;
  } else if (!collides(car.x, car.y + vy, CAR_R)) {
    car.y += vy;
    crashed = true;
  } else crashed = true;
  if (crashed && car.speed > 90) {
    car.hp -= car.speed * 0.09;
    car.speed *= -0.25;
    fx(io, room, { type: 'crash', x: Math.round(car.x), y: Math.round(car.y) });
  }
  ps.x = car.x;
  ps.y = car.y;
  ps.ang = car.ang;
  // roadkill
  if (Math.abs(car.speed) > 120) {
    for (const t of gatherTargets(sim, room, id, 0, now)) {
      if (Math.hypot(t.x - car.x, t.y - car.y) > CAR_R + t.r) continue;
      const key = `rk${t.kind}${t.kind === 'player' ? t.id : t.ref.id || sim.npcs.indexOf(t.ref)}`;
      if ((car[key] || 0) > now) continue;
      car[key] = now + 600;
      hitTarget(io, room, sim, ps, t, ROADKILL_DMG, 'car', now);
    }
  }
  if (car.hp <= 0) explodeCar(io, room, sim, car, now);
}

function stepCars(io, room, sim, dt, now) {
  for (const c of sim.cars) {
    if (c.mode === 'lane') {
      c.pos += c.dir * c.laneSpeed * dt;
      const limit = c.horizontal ? W : H;
      if (c.pos > limit + 60) c.pos = -60;
      if (c.pos < -60) c.pos = limit + 60;
      placeLaneCar(c);
    } else if (c.mode === 'parked' && now - c.parkedAt > PARKED_TTL_MS) {
      Object.assign(c, laneCar(sim.cars.indexOf(c)), { mode: 'lane', hp: CAR_HP, speed: 0 });
      placeLaneCar(c);
    } else if (c.mode === 'wreck' && now >= c.respawnAt) {
      Object.assign(c, laneCar(sim.cars.indexOf(c)), { mode: 'lane', hp: CAR_HP, speed: 0, color: Math.floor(Math.random() * 6) });
      placeLaneCar(c);
    }
  }
}

/* ------------------------------------------------------------ missions + stops */

function completeAct(io, room, sim, id, ps, b, isMission, now) {
  const k = KINDS[b.kind];
  const who = nameOf(room, id);
  if (k.act === 'weapons') {
    for (const wk of ['pistol', 'smg', 'shotgun', 'ar', 'sniper']) {
      ps.weapons[wk] = true;
      ps.ammo[wk] = Math.min(AMMO_CAP[wk], ps.ammo[wk] + { pistol: 60, smg: 150, shotgun: 20, ar: 90, sniper: 10 }[wk]);
    }
    ps.weapons.bat = true;
    ps.armor = Math.min(100, ps.armor + 30);
    if (ps.weapon === 'fists' || ps.weapon === 'bat') ps.weapon = 'pistol';
    feed(io, room, `🔫 ${who} stocked up at the Gun Store`);
    if (isMission) setCash(room, id, ps, 200);
  } else if (k.act === 'car') {
    const car = sim.cars.find((c) => c.mode === 'wreck') || sim.cars[Math.floor(Math.random() * sim.cars.length)];
    if (car.driver) return false;
    Object.assign(car, { mode: 'parked', x: b.door.x + rnd(-30, 30), y: b.door.y + 66, ang: 0, speed: 0, hp: CAR_HP, parkedAt: now, color: 2 });
    feed(io, room, `🚗 ${who} got a free car from the Garage`);
    if (isMission) setCash(room, id, ps, 200);
  } else if (k.act === 'heist') {
    setCash(room, id, ps, 1500);
    addWanted(io, room, sim, ps, 3, now);
    fx(io, room, { type: 'heist', playerId: id });
    feed(io, room, `💰 ${who} robbed the bank! +$1500 — the cops are coming!`);
  } else if (k.act === 'heal') {
    ps.hp = START_HP;
    ps.armor = 100;
    feed(io, room, `🏥 ${who} got patched up`);
  } else if (k.act === 'cash') {
    setCash(room, id, ps, k.cash);
    feed(io, room, `${b.icon} ${who} earned $${k.cash} at the ${b.name}`);
  } else if (k.act === 'bribe') {
    if (ps.wanted === 0 || ps.cash < 300) return false;
    setCash(room, id, ps, -300);
    ps.wanted = 0;
    feed(io, room, `🚓 ${who} bribed the police`);
  } else if (k.act === 'food') {
    ps.hp = Math.min(START_HP, ps.hp + 35);
    setCash(room, id, ps, k.cash);
    feed(io, room, `🍔 ${who} grabbed a burger`);
  } else if (k.act === 'mansion') {
    enterMansion(io, room, sim, id, ps, b);
    return true;
  } else if (k.act === 'finish') {
    ps.finishedAt = now;
    ps.finishRank = sim.finishedCount;
    sim.finishedCount += 1;
    const bonus = FINISH_BONUS[ps.finishRank] || 0;
    setCash(room, id, ps, bonus);
    ps.missionsDone += 1;
    ps.mission += 1;
    fx(io, room, { type: 'relief', playerId: id });
    if (!sim.firstFinishAt) {
      sim.firstFinishAt = now;
      sim.endsAt = Math.min(sim.endsAt, now + FINISH_GRACE_MS);
      feed(io, room, `🏁 ${who} made it to the Royal Restroom first! ${Math.round(FINISH_GRACE_MS / 1000)}s left for everyone else.`);
    } else feed(io, room, `🏁 ${who} finished #${ps.finishRank + 1}`);
    say(io, room, id, 'win', 0.8);
    return true;
  }
  fx(io, room, { type: 'reward', playerId: id, kind: b.kind });
  if (isMission) {
    ps.missionsDone += 1;
    ps.mission += 1;
    ps.path = [];
    ps.pathFor = '';
  }
  return true;
}

function enterMansion(io, room, sim, id, ps, b) {
  const L = sim.mansion.layout;
  const s = mz.cellCenter(L.start.r, L.start.c);
  if (ps.veh) exitCar(io, room, sim, ps, Date.now(), true);
  ps.exitAt = { x: b.door.x, y: b.door.y };
  ps.world = 1;
  ps.opened = new Set();
  ps.keysWon = 0;
  const a = Math.random() * TAU;
  ps.x = s.x + Math.cos(a) * 20;
  ps.y = s.y + Math.sin(a) * 20;
  ps.path = [];
  ps.botGoal = null;
  ps.lastCaughtAt = 0;
  ps.wanted = 0;
  feed(io, room, `🏚️ ${nameOf(room, id)} entered the Haunted Mansion…`);
}

function completeMansion(io, room, sim, id, ps) {
  const m = sim.missions[ps.mission];
  ps.world = 0;
  ps.x = m.door.x;
  ps.y = m.door.y + 6;
  ps.path = [];
  ps.pathFor = '';
  setCash(room, id, ps, MANSION_BONUS);
  ps.missionsDone += 1;
  ps.mission += 1;
  ps.bladder = 0; // sweet relief
  ps.relieved += 1;
  fx(io, room, { type: 'relief', playerId: id });
  feed(io, room, `🚽 ${nameOf(room, id)} made it out of the mansion — what a relief! +$${MANSION_BONUS}`);
  say(io, room, id, 'relief', 0.8);
}

// what is the player standing at? returns { key, need, act }
function stopAt(sim, ps, now) {
  let best = null;
  let bd = DOOR_RADIUS;
  for (const b of MAP.buildings) {
    const d = Math.hypot(b.door.x - ps.x, b.door.y - ps.y);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  if (best) {
    const m = sim.missions[ps.mission];
    if (m && m.buildingId === best.id) return { key: `m${ps.mission}`, need: m.hold, b: best, mission: true };
    const k = KINDS[best.kind];
    if (k.side && (ps.sideCd[best.id] || 0) <= now) {
      if (k.act === 'bribe' && (ps.wanted === 0 || ps.cash < 300)) return null;
      return { key: `s${best.id}`, need: k.hold, b: best, mission: false };
    }
  }
  if (ps.bladder >= WC_MIN_BLADDER) {
    for (const w of MAP.wcs) {
      if ((ps.wcCd[w.id] || 0) > now) continue;
      if (Math.hypot(w.door.x - ps.x, w.door.y - ps.y) < WC_RADIUS) return { key: `w${w.id}`, need: WC_HOLD_MS, wc: w };
    }
  }
  return null;
}

/* ------------------------------------------------------------ pedestrians, guards, cops */

function stepNpcs(io, room, sim, dt, now) {
  for (const n of sim.npcs) {
    if (n.state === 2) {
      if (now >= n.respawnAt) {
        const at = randomWalkable();
        n.x = at.x;
        n.y = at.y;
        n.hp = NPC_HP;
        n.state = 0;
        n.path = [];
        n.wait = 1;
      }
      continue;
    }
    if (n.state === 1 && now > n.fleeUntil) n.state = 0;
    if (n.wait > 0 && n.state === 0) {
      n.wait -= dt;
      continue;
    }
    if (!n.path.length) {
      const target = randomWalkable();
      if (n.state === 0 && Math.hypot(target.x - n.x, target.y - n.y) > 500) {
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
    const step = (n.state === 1 ? 125 : n.speed) * dt;
    if (dist <= step) {
      n.x = wp.x;
      n.y = wp.y;
      n.path.shift();
      if (!n.path.length && n.state === 0) n.wait = 1 + Math.random() * 4;
    } else {
      n.x += (dx / dist) * step;
      n.y += (dy / dist) * step;
      if (Math.abs(dx) > 1) n.d = dx > 0 ? 1 : -1;
    }
  }
}

function humanTargets(sim, room, now, from, range) {
  // living players in the city that a guard or cop would shoot at
  const out = [];
  for (const [id, ps] of sim.players) {
    const p = room.players.get(id);
    if (!p || p.left || ps.world !== 0 || ps.deadUntil > now || ps.finishedAt || ps.invulnUntil > now) continue;
    const d = Math.hypot(ps.x - from.x, ps.y - from.y);
    if (d < range) out.push({ id, ps, d });
  }
  return out.sort((a, b) => a.d - b.d);
}

function moveTowards(ent, tx, ty, speed, dt, r) {
  const dx = tx - ent.x;
  const dy = ty - ent.y;
  const d = Math.hypot(dx, dy);
  if (d < 2) return;
  const step = Math.min(d, speed * dt);
  const nx = ent.x + (dx / d) * step;
  const ny = ent.y + (dy / d) * step;
  if (!collides(nx, ent.y, r)) ent.x = nx;
  if (!collides(ent.x, ny, r)) ent.y = ny;
}

function stepGuards(io, room, sim, dt, now) {
  for (const g of sim.guards) {
    if (!g.alive) {
      if (now >= g.respawnAt) {
        g.alive = true;
        g.hp = GUARD_HP;
        g.x = g.homeX;
        g.y = g.homeY;
      }
      continue;
    }
    const targets = humanTargets(sim, room, now, g, 300);
    const t = targets.find((x) => segmentClear(sim, 0, g.x, g.y, x.ps.x, x.ps.y));
    if (t) {
      g.ang = Math.atan2(t.ps.y - g.y, t.ps.x - g.x);
      if (t.d > 170) moveTowards(g, t.ps.x, t.ps.y, 85, dt, PLAYER_R);
      if (t.d < 260 && now >= g.nextShotAt) {
        g.nextShotAt = now + 950 + Math.random() * 400;
        g.shootUntil = now + 250;
        enemyShoot(io, room, sim, g, t.ps, 7, 0.5, now);
      }
    } else if (Math.hypot(g.homeX - g.x, g.homeY - g.y) > 8) moveTowards(g, g.homeX, g.homeY, 70, dt, PLAYER_R);
  }
}

function stepCops(io, room, sim, dt, now) {
  // decay stars, then make sure every wanted player has cops on their tail
  for (const [id, ps] of sim.players) {
    if (ps.wanted > 0 && now - ps.lastCrimeAt > WANTED_DECAY_MS) {
      ps.wanted -= 1;
      ps.lastCrimeAt = now - WANTED_DECAY_MS + 8000;
      if (ps.wanted === 0) feed(io, room, `✅ ${nameOf(room, id)} lost the cops`);
    }
  }
  if (now >= sim.nextCopAt) {
    sim.nextCopAt = now + 2500;
    for (const [id, ps] of sim.players) {
      if (ps.wanted <= 0 || ps.world !== 0 || ps.deadUntil > now) continue;
      const want = Math.min(5, ps.wanted + 1);
      const have = sim.cops.filter((c) => c.hp > 0 && c.target === id).length;
      if (have >= want) continue;
      for (let tries = 0; tries < 10; tries++) {
        const at = randomWalkable();
        const d = Math.hypot(at.x - ps.x, at.y - ps.y);
        if (d < 380 || d > 620) continue;
        sim.cops.push({ id: sim.nextId++, x: at.x, y: at.y, ang: 0, hp: COP_HP, target: id, path: [], pathAt: 0, nextShotAt: now + 1200, shootUntil: 0, gone: 0 });
        break;
      }
    }
  }
  for (const c of sim.cops) {
    if (c.hp <= 0) continue;
    const ps = sim.players.get(c.target);
    const valid = ps && ps.wanted > 0 && ps.world === 0 && ps.deadUntil <= now;
    if (!valid) {
      c.gone = c.gone || now + 6000;
      if (now > c.gone) c.hp = -1; // clocked off
      continue;
    }
    c.gone = 0;
    const d = Math.hypot(ps.x - c.x, ps.y - c.y);
    c.ang = Math.atan2(ps.y - c.y, ps.x - c.x);
    const clear = d < 300 && segmentClear(sim, 0, c.x, c.y, ps.x, ps.y);
    if (!clear || d > 200) {
      if (now >= c.pathAt || !c.path.length) {
        c.path = findPath(c.x, c.y, ps.x, ps.y);
        c.pathAt = now + 900;
      }
      const wp = c.path[0];
      if (wp) {
        if (Math.hypot(wp.x - c.x, wp.y - c.y) < 8) c.path.shift();
        else moveTowards(c, wp.x, wp.y, 150, dt, PLAYER_R);
      }
    }
    if (clear && d < 280 && now >= c.nextShotAt) {
      c.nextShotAt = now + 800 + Math.random() * 300;
      c.shootUntil = now + 250;
      enemyShoot(io, room, sim, c, ps, 9, 0.55, now);
    }
  }
  sim.cops = sim.cops.filter((c) => c.hp > 0);
}

/* -------------------------------------------------------------- mansion ghosts */

function stepGhosts(io, room, sim, dt, now) {
  const M = sim.mansion;
  const L = M.layout;
  const inside = [...sim.players.entries()].filter(([id, ps]) => {
    const p = room.players.get(id);
    return p && !p.left && ps.world === 1 && !ps.finishedAt && ps.deadUntil <= now;
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
        if (now - ps.lastCaughtAt < GHOST_CATCH_COOLDOWN_MS || ps.stunUntil > now || ps.invulnUntil > now) continue;
        if (Math.hypot(ps.x - g.x, ps.y - g.y) < 34) {
          ps.lastCaughtAt = now;
          ps.stunUntil = now + GHOST_SCARE_STUN_MS;
          ps.input = { dx: 0, dy: 0 };
          ps.caught += 1;
          addBladder(ps, CATCH_BLADDER);
          g.coolUntil = now + 4500;
          g.mode = 'flee';
          fx(io, room, { type: 'caught', playerId: id });
          feed(io, room, `👻 A ghost scared ${nameOf(room, id)}! Bladder +${CATCH_BLADDER}%`);
          say(io, room, id, 'hurt', 0.5);
          break;
        }
      }
    }
  }
}

function tryFlash(io, room, id, now) {
  const sim = room.city;
  const ps = sim.players.get(id);
  if (!ps || ps.world !== 1 || ps.finishedAt || ps.deadUntil > now || ps.stunUntil > now || now < ps.nextFlashAt) return false;
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
  fx(io, room, { type: 'flash', playerId: id, hit });
  if (hit) feed(io, room, `🔦 ${nameOf(room, id)} scared off ${hit === 1 ? 'a ghost' : `${hit} ghosts`}!`);
  return true;
}

function tryShout(io, room, id, now) {
  const sim = room.city;
  const ps = sim.players.get(id);
  if (!ps || ps.finishedAt || ps.deadUntil > now || now < ps.nextShoutAt) return false;
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
  fx(io, room, { type: 'shout', playerId: id, hit });
  if (hit) feed(io, room, `📢 ${nameOf(room, id)} screamed and ${hit === 1 ? 'a ghost' : `${hit} ghosts`} ran away!`);
  return true;
}

/* --------------------------------------------------------------------- bots */

function botMansionThink(io, room, sim, id, ps, p, now) {
  const L = sim.mansion.layout;
  if (ps.finishedAt || ps.stunUntil > now) {
    ps.input = { dx: 0, dy: 0 };
    return;
  }
  const tier = getTier(p.botTier);
  // scare or shoot ghosts that get close
  const ghost = sim.mansion.ghosts.find((g) => g.stunUntil <= now && Math.hypot(g.x - ps.x, g.y - ps.y) < 130);
  if (ghost) {
    if (now > ps.botNextFlash && now >= ps.nextFlashAt) {
      ps.botNextFlash = now + 600;
      if (Math.random() < tier.aggression) tryFlash(io, room, id, now);
    }
    const w = WEAPONS[ps.weapon];
    if (w && !w.melee && ps.ammo[w.ammoKey] > 0 && now >= ps.botReactAt) {
      ps.botReactAt = now + tier.reaction;
      attackNow(io, room, id, ps, now, { target: { x: ghost.x, y: ghost.y }, err: (Math.random() - 0.5) * (1 - tier.accuracy) * 0.4 });
    }
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
  else ps.ang = Math.atan2(ps.input.dy, ps.input.dx);
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

function bestWeaponFor(ps, dist) {
  const has = (k) => ps.weapons[k] && ps.ammo[k] > 0;
  if (dist < 130 && has('shotgun')) return 'shotgun';
  if (dist < 300 && has('smg')) return 'smg';
  if (has('pistol')) return 'pistol';
  if (has('smg')) return 'smg';
  if (has('shotgun') && dist < 220) return 'shotgun';
  return ps.weapons.bat ? 'bat' : 'fists';
}

function botThink(io, room, sim, id, ps, p, now) {
  if (ps.deadUntil > now || ps.finishedAt) {
    ps.input = { dx: 0, dy: 0 };
    return;
  }
  if (ps.world === 1) return botMansionThink(io, room, sim, id, ps, p, now);
  if (ps.stunUntil > now) {
    ps.input = { dx: 0, dy: 0 };
    return;
  }
  const tier = getTier(p.botTier);

  // ---- fight? someone who hurt us, or anyone who wanders too close ----
  let foe = null;
  let foeD = Infinity;
  const sight = tier.sight;
  for (const [oid, ops] of sim.players) {
    if (oid === id || ops.world !== 0 || ops.deadUntil > now || ops.finishedAt || ops.invulnUntil > now) continue;
    const d = Math.hypot(ops.x - ps.x, ops.y - ps.y);
    const revenge = ps.lastHurtBy === oid && now - ps.lastHurtAt < 7000;
    if (d < foeD && (revenge ? d < sight * 1.3 : d < sight * 0.32 * tier.aggression + 30) && segmentClear(sim, 0, ps.x, ps.y, ops.x, ops.y)) {
      foe = { x: ops.x, y: ops.y, kind: 'player', ref: ops };
      foeD = d;
    }
  }
  for (const g of sim.guards) {
    if (!g.alive) continue;
    const d = Math.hypot(g.x - ps.x, g.y - ps.y);
    if (d < foeD && d < 210 && segmentClear(sim, 0, ps.x, ps.y, g.x, g.y)) {
      foe = { x: g.x, y: g.y, kind: 'guard', ref: g };
      foeD = d;
    }
  }
  for (const c of sim.cops) {
    if (c.hp <= 0 || c.target !== id) continue;
    const d = Math.hypot(c.x - ps.x, c.y - ps.y);
    if (d < foeD && d < 300 && segmentClear(sim, 0, ps.x, ps.y, c.x, c.y)) {
      foe = { x: c.x, y: c.y, kind: 'cop', ref: c };
      foeD = d;
    }
  }
  if (foe && ps.hp > 22) {
    const key = bestWeaponFor(ps, foeD);
    ps.weapon = key;
    const w = WEAPONS[key];
    const aim = Math.atan2(foe.y - ps.y, foe.x - ps.x);
    ps.ang = aim;
    if (w.melee) {
      if (foeD > w.range - 8) ps.input = { dx: Math.cos(aim), dy: Math.sin(aim) };
      else ps.input = { dx: 0, dy: 0 };
    } else {
      // keep a fighting distance and strafe a little
      if (now > ps.botStrafeAt) {
        ps.botStrafeAt = now + 900 + Math.random() * 900;
        ps.botStrafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      const ideal = key === 'shotgun' ? 90 : 170;
      let mx = 0;
      let my = 0;
      if (foeD > ideal + 40) {
        mx = Math.cos(aim);
        my = Math.sin(aim);
      } else if (foeD < ideal - 50) {
        mx = -Math.cos(aim);
        my = -Math.sin(aim);
      }
      mx += -Math.sin(aim) * ps.botStrafeDir * 0.7;
      my += Math.cos(aim) * ps.botStrafeDir * 0.7;
      ps.input = { dx: mx, dy: my };
    }
    if (now >= ps.botReactAt) {
      const range = w.melee ? w.range : w.range * 0.9;
      if (foeD < range) {
        ps.botReactAt = now + tier.reaction * (0.6 + Math.random() * 0.8);
        attackNow(io, room, id, ps, now, { target: foe, err: (Math.random() - 0.5) * 2 * (1 - tier.accuracy) * 0.35 });
      }
    }
    return;
  }

  // ---- otherwise: heal, relieve, loot, or follow the missions ----
  const mission = sim.missions[ps.mission];
  let dest = mission ? mission.door : null;
  let destKey = `m${ps.mission}`;
  let radius = DOOR_RADIUS - 10;
  if (ps.hp < 40 && (ps.sideCd[BUILDING_BY_KIND.hospital.id] || 0) <= now) {
    dest = BUILDING_BY_KIND.hospital.door;
    destKey = 'hosp';
  } else if (ps.bladder > 72) {
    const wc = nearestWc(ps, now);
    if (wc) {
      dest = wc.door;
      destKey = `w${wc.id}`;
      radius = WC_RADIUS - 12;
    }
  } else {
    // pick up loot lying close by
    let loot = null;
    let ld = 170;
    for (const pk of sim.pickups) {
      if (pk.type === 'health' && ps.hp > 80) continue;
      const d = Math.hypot(pk.x - ps.x, pk.y - ps.y);
      if (d < ld) {
        ld = d;
        loot = pk;
      }
    }
    if (loot) {
      dest = { x: loot.x, y: loot.y };
      destKey = `l${loot.id}`;
      radius = 10;
    } else if (ps.wanted >= 3 && ps.cash >= 300 && (ps.sideCd[BUILDING_BY_KIND.police.id] || 0) <= now) {
      dest = BUILDING_BY_KIND.police.door;
      destKey = 'police';
    } else if (ps.mission >= 1 && ps.weapons.pistol && ps.ammo.pistol + ps.ammo.smg < 40 && (ps.sideCd[BUILDING_BY_KIND.gun.id] || 0) <= now) {
      dest = BUILDING_BY_KIND.gun.door;
      destKey = 'gun';
    }
  }
  if (!dest) {
    ps.input = { dx: 0, dy: 0 };
    return;
  }
  const toDest = Math.hypot(dest.x - ps.x, dest.y - ps.y);
  if (toDest < radius) {
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
  ps.ang = Math.atan2(dy, dx);
}

/* ------------------------------------------------------------------ snapshot */

// flag bits: 1 stunned, 4 in a vehicle, 32 finished, 64 hidden, 128 accident (shame), 256 clenching,
//            512 flashlight, 1024 shouting, 2048 dead, 4096 attacking, 8192 just hurt, 16384 spawn shield
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
      if (ps.veh) flags |= 4;
      if (ps.finishedAt) flags |= 32;
      const pl = room.players.get(id);
      if (pl && pl.left) flags |= 64;
      if (ps.accidentUntil > now) flags |= 128;
      if (ps.clenchUntil > now) flags |= 256;
      if (ps.flashUntil > now) flags |= 512;
      if (ps.shoutUntil > now) flags |= 1024;
      if (ps.deadUntil > now) flags |= 2048;
      if (ps.attackUntil > now) flags |= 4096;
      if (ps.hurtUntil > now) flags |= 8192;
      if (ps.reloadUntil > now) flags |= 32768;
      if (ps.invulnUntil > now) flags |= 16384;
      let keys = 0;
      if (ps.opened.has('A')) keys |= 1;
      if (ps.opened.has('B')) keys |= 2;
      if (ps.opened.has('C')) keys |= 4;
      const w = WEAPONS[ps.weapon];
      const ammo = w && !w.melee ? ps.ammo[w.ammoKey] : -1;
      const hold = ps.holdNeed ? Math.min(100, Math.round((ps.holdMs / ps.holdNeed) * 100)) : 0;
      let owned = 0;
      const magNow = w && !w.melee ? Math.min(ps.mag[ps.weapon] === undefined ? Math.min(w.mag, ps.ammo[w.ammoKey]) : ps.mag[ps.weapon], ps.ammo[w.ammoKey]) : -1;
      WEAPON_BY_CODE.forEach((k, code) => {
        const wk = WEAPONS[k];
        if (ps.weapons[k] && (wk.melee || ps.ammo[wk.ammoKey] > 0)) owned |= 1 << code;
      });
      // 0 idx 1 x 2 y 3 angle*100 4 flags 5 mission 6 cash 7 weapon 8 hp 9 armor 10 bladder 11 world 12 keys 13 wanted 14 ammo(total) 15 kills 16 hold% 17 owned-weapons mask 18 magazine
      return [ps.idx, Math.round(ps.x), Math.round(ps.y), Math.round(ps.ang * 100), flags, ps.mission, ps.cash, w ? w.code : 0, Math.max(0, Math.round(ps.hp)), Math.round(ps.armor), Math.round(ps.bladder * 10) / 10, ps.world, keys, ps.wanted, ammo, ps.kills, hold, owned, magNow];
    }),
    n: sim.npcs.map((n) => [Math.round(n.x), Math.round(n.y), n.d, n.path.length ? 1 : 0, n.state]),
    c: sim.cars.map((c) => [Math.round(c.x), Math.round(c.y), Math.round(c.ang * 100), c.color, c.driver ? sim.players.get(c.driver).idx : -1, Math.round((Math.max(0, c.hp) / CAR_HP) * 100), c.mode === 'wreck' ? 3 : c.mode === 'player' ? 1 : c.mode === 'parked' ? 2 : 0]),
    gd: sim.guards.map((g) => [Math.round(g.x), Math.round(g.y), Math.round(g.ang * 100), Math.round(g.hp), g.alive ? 1 : 0, g.shootUntil > now ? 1 : 0]),
    cp: sim.cops.map((c) => [Math.round(c.x), Math.round(c.y), Math.round(c.ang * 100), Math.round(c.hp), c.shootUntil > now ? 1 : 0]),
    pk: sim.pickups.map((k) => [k.id, Math.round(k.x), Math.round(k.y), PICKUP_CODE[k.type], k.value]),
    g: anyInside ? sim.mansion.ghosts.map((g) => [Math.round(g.x), Math.round(g.y), g.mode === 'chase' ? 1 : g.mode === 'stunned' ? 2 : g.mode === 'flee' ? 3 : 0]) : [],
    endsAt: sim.endsAt,
  };
}

/* ---------------------------------------------------------------------- tick */

function bodyTick(io, room, sim, id, ps, p, now, dt) {
  if (ps.finishedAt || ps.deadUntil > now) return;
  // the bladder fills; a desperate one leaks farts and finally gives up
  ps.bladder = Math.min(100, ps.bladder + (100 / BLADDER_FILL_S) * dt);
  if (ps.bladder > 48 && now >= ps.nextFartAt && ps.accidentUntil <= now) {
    const pressure = (ps.bladder - 48) / 52;
    ps.farts += 1;
    ps.clenchUntil = now + CLENCH_MS;
    ps.nextFartAt = now + (9000 - 6400 * pressure) * (0.7 + Math.random() * 0.6);
    fx(io, room, { type: 'fart', playerId: id, kind: Math.floor(Math.random() * FART_KINDS), big: pressure > 0.7 && Math.random() < 0.5 });
  }
  if (ps.bladder >= 100 && ps.accidentUntil <= now) {
    ps.accidentUntil = now + ACCIDENT_MS;
    ps.stunUntil = Math.max(ps.stunUntil, ps.accidentUntil);
    ps.input = { dx: 0, dy: 0 };
    setCash(room, id, ps, -ACCIDENT_PENALTY);
    ps.bladder = ACCIDENT_RESET;
    ps.accidents += 1;
    fx(io, room, { type: 'accident', playerId: id });
    feed(io, room, `💩 ${nameOf(room, id)} couldn't hold it any longer! −$${ACCIDENT_PENALTY}`);
    say(io, room, id, 'accident', 0.9);
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

      // dead? wait, then respawn at the hospital
      if (ps.deadUntil > 0) {
        if (now >= ps.deadUntil) respawnPlayer(io, room, sim, id, ps, now);
        else continue;
      }
      if (p.isBot) botThink(io, room, sim, id, ps, p, now);

      if (ps.veh) stepDriver(io, room, sim, id, ps, dt, now);
      else if (!ps.finishedAt) {
        // walking (or clenching, or frozen in shame)
        let sp = ps.stunUntil > now ? 0 : BASE_SPEED * (ps.speedMul || 1);
        if (ps.clenchUntil > now) sp *= CLENCH_SPEED_MUL;
        const { dx, dy } = ps.input;
        if (sp && (dx || dy)) {
          const len = Math.hypot(dx, dy) || 1;
          const vx = (dx / len) * sp * dt;
          const vy = (dy / len) * sp * dt;
          if (!collidesFor(sim, ps, ps.x + vx, ps.y)) ps.x += vx;
          if (!collidesFor(sim, ps, ps.x, ps.y + vy)) ps.y += vy;
          if (!p.isBot && Math.hypot(dx, dy) > 0.15 && ps.attackUntil < now) ps.ang = Math.atan2(dy, dx);
        }
      }
      bodyTick(io, room, sim, id, ps, p, now, dt);

      // loot on the ground
      if (!ps.veh && ps.world === 0 && !ps.finishedAt) {
        for (let i = sim.pickups.length - 1; i >= 0; i--) {
          const pk = sim.pickups[i];
          if (Math.hypot(pk.x - ps.x, pk.y - ps.y) < 24) {
            givePickup(io, room, id, ps, pk, now);
            sim.pickups.splice(i, 1);
            for (const s of sim.spawners) if (s.pk === pk) s.respawnAt = now + 25000;
          }
        }
      }

      const free = !ps.finishedAt && ps.stunUntil <= now && !ps.veh;
      if (free && ps.world === 0) {
        const stop = stopAt(sim, ps, now);
        if (stop) {
          if (ps.holdKey !== stop.key) {
            ps.holdKey = stop.key;
            ps.holdMs = 0;
          }
          ps.holdNeed = stop.need;
          ps.holdMs += dt * 1000;
          if (ps.holdMs >= stop.need) {
            ps.holdMs = 0;
            if (stop.wc) {
              ps.bladder = 0;
              ps.relieved += 1;
              ps.wcCd[stop.wc.id] = now + WC_COOLDOWN_MS;
              setCash(room, id, ps, 100);
              fx(io, room, { type: 'relief', playerId: id });
              feed(io, room, `🚽 ${nameOf(room, id)} found a public toilet just in time`);
              say(io, room, id, 'relief', 0.6);
            } else {
              const done = completeAct(io, room, sim, id, ps, stop.b, stop.mission, now);
              if (done && !stop.mission) ps.sideCd[stop.b.id] = now + 45000;
            }
          }
        } else {
          ps.holdMs = 0;
          ps.holdKey = '';
          ps.holdNeed = 0;
        }
      } else if (free && ps.world === 1) {
        const L = sim.mansion.layout;
        ps.holdNeed = 0;
        for (const k of L.keys) {
          if (ps.opened.has(k.letter.toUpperCase())) continue;
          const c = mz.cellCenter(k.r, k.c);
          if (Math.hypot(c.x - ps.x, c.y - ps.y) < mz.KEY_RADIUS) {
            ps.opened.add(k.letter.toUpperCase());
            ps.keysWon += 1;
            setCash(room, id, ps, KEY_CASH);
            addBladder(ps, -3);
            fx(io, room, { type: 'key', playerId: id, letter: k.letter });
            feed(io, room, `🔑 ${nameOf(room, id)} grabbed key ${k.letter.toUpperCase()} in the mansion`);
            break;
          }
        }
        const t = mz.cellCenter(L.toilet.r, L.toilet.c);
        if (Math.hypot(t.x - ps.x, t.y - ps.y) < mz.TOILET_RADIUS) completeMansion(io, room, sim, id, ps);
      } else {
        ps.holdMs = 0;
      }
    }
    stepCars(io, room, sim, dt, now);
    stepGhosts(io, room, sim, dt, now);
    stepNpcs(io, room, sim, dt, now);
    stepGuards(io, room, sim, dt, now);
    stepCops(io, room, sim, dt, now);

    // static pickups respawn; loose ones time out
    for (const s of sim.spawners) {
      if (!s.pk || !sim.pickups.includes(s.pk)) {
        if (s.pk === null || (s.respawnAt && now >= s.respawnAt)) {
          s.pk = dropPickup(sim, s.type, s.x, s.y, s.value, 0);
          s.respawnAt = 0;
        }
      }
    }
    sim.pickups = sim.pickups.filter((k) => !k.expires || k.expires > now);

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

function collidesFor(sim, ps, x, y) {
  if (ps.world === 1) return mz.collidesWith(sim.mansion.collision, sim.mansion.layout, ps.opened, x, y, mz.PLAYER_R);
  return collides(x, y, PLAYER_R);
}

function finishCity(io, room) {
  const sim = room.city;
  if (!sim || sim.over) return;
  sim.over = true;
  clearInterval(room.timers.cityTick);
  room.timers.cityTick = null;
  for (const [id, ps] of sim.players) {
    const p = room.players.get(id);
    if (p) p.score = ps.cash;
  }
  room.state = 'final';
  const board = serializePlayers(room);
  const entries = [...sim.players.entries()];
  const nameOfId = (id) => room.players.get(id).name;
  const awards = [];
  const gunner = entries.slice().sort((a, b) => b[1].kills - a[1].kills || b[1].cash - a[1].cash)[0];
  if (gunner && gunner[1].kills > 0) awards.push({ key: 'kills', icon: '🔫', title: 'Top Gun', playerId: gunner[0], name: nameOfId(gunner[0]), detail: `${gunner[1].kills} takedown${gunner[1].kills > 1 ? 's' : ''}` });
  const boss = entries.slice().sort((a, b) => b[1].missionsDone - a[1].missionsDone || b[1].cash - a[1].cash)[0];
  if (boss) awards.push({ key: 'mission', icon: '🎯', title: 'Mission Master', playerId: boss[0], name: nameOfId(boss[0]), detail: `${boss[1].missionsDone}/${sim.missions.length} missions` });
  const bag = entries.slice().sort((a, b) => b[1].deaths - a[1].deaths)[0];
  if (bag && bag[1].deaths > 1) awards.push({ key: 'bag', icon: '🥊', title: 'Punching Bag', playerId: bag[0], name: nameOfId(bag[0]), detail: `${bag[1].deaths} deaths` });
  const leaky = entries.slice().sort((a, b) => b[1].accidents - a[1].accidents || b[1].farts - a[1].farts)[0];
  if (leaky && leaky[1].accidents > 0) awards.push({ key: 'leaky', icon: '💩', title: 'Leaky Pants', playerId: leaky[0], name: nameOfId(leaky[0]), detail: `${leaky[1].accidents} accident${leaky[1].accidents > 1 ? 's' : ''}` });
  else {
    const iron = entries.filter(([, ps]) => ps.finishedAt && ps.accidents === 0).sort((a, b) => a[1].finishRank - b[1].finishRank)[0];
    if (iron) awards.push({ key: 'iron', icon: '🧊', title: 'Iron Bladder', playerId: iron[0], name: nameOfId(iron[0]), detail: 'not a single accident' });
  }
  const tooter = entries.slice().sort((a, b) => b[1].farts - a[1].farts)[0];
  if (tooter && tooter[1].farts > 0) awards.push({ key: 'toot', icon: '💨', title: 'Loudest Cheeks', playerId: tooter[0], name: nameOfId(tooter[0]), detail: `${tooter[1].farts} toot${tooter[1].farts > 1 ? 's' : ''}` });
  room.awards = awards.slice(0, 4);
  const stats = {};
  for (const [id, ps] of entries) stats[id] = { kills: ps.kills, deaths: ps.deaths, missions: ps.missionsDone, accidents: ps.accidents, finished: !!ps.finishedAt };
  io.to(room.code).emit(EVENTS.GAME_FINAL, { leaderboard: board, podium: board.slice(0, 3), awards: room.awards, stats, total: sim.missions.length });
  db.saveGameResult({
    roomCode: room.code,
    category: 'city',
    categoryLabel: '🌆 City Chaos',
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

// the fire / punch / flashlight button: the mansion's flashlight when nothing to shoot, otherwise a strike
function attack(io, room, playerId, ang) {
  const sim = room.city;
  if (!sim || room.state !== 'city') return;
  const ps = sim.players.get(playerId);
  if (!ps) return;
  const now = Date.now();
  if (typeof ang === 'number' && Number.isFinite(ang) && !ps.veh) ps.ang = ang;
  attackNow(io, room, playerId, ps, now, null);
}

// F: get into / out of a car
function use(io, room, playerId) {
  const sim = room.city;
  if (!sim || room.state !== 'city') return;
  const ps = sim.players.get(playerId);
  const now = Date.now();
  if (!ps || ps.deadUntil > now || ps.finishedAt || ps.stunUntil > now || now < sim.startsAt) return;
  if (ps.world === 1) {
    tryFlash(io, room, playerId, now);
    return;
  }
  if (ps.veh) {
    if (Math.abs(ps.veh.speed) > 80) return;
    exitCar(io, room, sim, ps, now, false);
    return;
  }
  const car = nearestCar(sim, ps.x, ps.y);
  if (car) enterCar(io, room, sim, playerId, ps, car, now);
}

function selectWeapon(room, playerId, code) {
  const sim = room.city;
  if (!sim || room.state !== 'city') return;
  const ps = sim.players.get(playerId);
  if (!ps) return;
  const key = WEAPON_BY_CODE[Number(code)];
  if (!key || !ps.weapons[key]) return;
  if (WEAPONS[key].ammoKey && ps.ammo[WEAPONS[key].ammoKey] <= 0) return;
  if (ps.reloadKey && ps.reloadKey !== key) {
    ps.reloadUntil = 0;
    ps.reloadKey = '';
  }
  ps.weapon = key;
}

// R: reload the gun in your hands
function reload(room, playerId) {
  const sim = room.city;
  if (!sim || room.state !== 'city') return;
  const ps = sim.players.get(playerId);
  if (!ps || ps.deadUntil > Date.now() || ps.veh) return;
  startReload(ps, ps.weapon, Date.now());
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

module.exports = { startCity, initPayload, setInput, attack, use, selectWeapon, reload, shout, finishCity, stopCity, MAP, KINDS, WEAPONS, findPath, collides, nearestWalkable, randomWalkable, wallDistance, segmentClear, CELL, PLAYER_R, BASE_SPEED };
