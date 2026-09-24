/*
 * We Gotta Go — a co-op haunted-maze mode (server-authoritative).
 *
 * The whole team is stuck in haunted halls and the shared BLADDER meter is filling up.
 * Reach the toilet before it hits 100%. Doors (A, B, C) block the way; the matching
 * keys (a, b, c) lie somewhere in the maze and each one is guarded by a QUIZ — a correct
 * answer wins the key for the whole team and opens the door for everyone. Ghosts chase
 * the players: a ghost that catches you freezes you for a moment and adds to the bladder.
 * Wave your flashlight (Space) to scare nearby ghosts away.
 *
 * The maze is generated per match, then checked so that every door really is a chokepoint
 * and every key can be reached before its own door.
 */
const EVENTS = require('./events');
const { getQuestions } = require('./questions');
const { serializePlayers } = require('./rooms');
const bots = require('./bots');
const { pickLine } = require('./botLines');
const db = require('./db');

const COLS = 14;
const ROWS = 10;
const CELL = 100;
const WALL_T = 10;
const W = COLS * CELL;
const H = ROWS * CELL;
const PLAYER_R = 13;
const TICK_MS = 50;
const SNAPSHOT_EVERY = 2;
const BASE_SPEED = 165;
const BLADDER_MS = 210000; // a full bladder, if nothing else goes wrong
const CATCH_BLADDER = 5;
const WRONG_BLADDER = 4;
const RIGHT_RELIEF = 3;
const QUIZ_MS = 15000;
const LOCKOUT_MS = 3500;
const KEY_RADIUS = 34;
const TOILET_RADIUS = 38;
const STUN_MS = 2500;
const CATCH_COOLDOWN_MS = 7000;
const FLASH_RANGE = 210;
const FLASH_COOLDOWN_MS = 7000;
const GHOST_STUN_MS = 3500;
const START_COUNTDOWN_MS = 3400;
const FINISH_BONUS = [900, 600, 400, 250];
const BOT_SPEED_MUL = { rookie: 0.5, veteran: 0.58, elite: 0.66, legend: 0.74 };

const START_CELL = { r: 5, c: 12 };
const TOILET_CELL = { r: 1, c: 1 };

/* ------------------------------------------------------------- generation */

function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idxOf = (r, c) => r * COLS + c;
const cellCenter = (r, c) => ({ x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 });
const cellAt = (x, y) => ({ r: Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL))), c: Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL))) });

function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor((rng || Math.random)() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// hW[r][c] = wall on the TOP edge of cell (r,c) (r = 0..ROWS); vW[r][c] = wall on its LEFT edge (c = 0..COLS)
function neighborsOf(m, r, c) {
  const out = [];
  if (r > 0 && !m.hW[r][c]) out.push([r - 1, c]);
  if (r < ROWS - 1 && !m.hW[r + 1][c]) out.push([r + 1, c]);
  if (c > 0 && !m.vW[r][c]) out.push([r, c - 1]);
  if (c < COLS - 1 && !m.vW[r][c + 1]) out.push([r, c + 1]);
  return out;
}

function bfs(m, from, blockedSet) {
  const dist = new Int16Array(COLS * ROWS).fill(-1);
  const parent = new Int16Array(COLS * ROWS).fill(-1);
  const q = [idxOf(from.r, from.c)];
  dist[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    const r = Math.floor(cur / COLS);
    const c = cur % COLS;
    for (const [nr, nc] of neighborsOf(m, r, c)) {
      const ni = idxOf(nr, nc);
      if (dist[ni] !== -1 || (blockedSet && blockedSet.has(ni))) continue;
      dist[ni] = dist[cur] + 1;
      parent[ni] = cur;
      q.push(ni);
    }
  }
  return { dist, parent };
}

function generateLayout() {
  const rng = seededRng((Math.random() * 4294967296) >>> 0);
  for (let attempt = 0; attempt < 30; attempt++) {
    const m = {
      hW: Array.from({ length: ROWS + 1 }, () => new Uint8Array(COLS).fill(1)),
      vW: Array.from({ length: ROWS }, () => new Uint8Array(COLS + 1).fill(1)),
    };
    // depth-first carve → a perfect maze
    const seen = new Uint8Array(COLS * ROWS);
    const stack = [[Math.floor(rng() * ROWS), Math.floor(rng() * COLS)]];
    seen[idxOf(stack[0][0], stack[0][1])] = 1;
    while (stack.length) {
      const [r, c] = stack[stack.length - 1];
      const options = shuffled([[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]], rng).filter(([nr, nc]) => nr >= 0 && nc >= 0 && nr < ROWS && nc < COLS && !seen[idxOf(nr, nc)]);
      if (!options.length) {
        stack.pop();
        continue;
      }
      const [nr, nc] = options[0];
      if (nr === r - 1) m.hW[r][c] = 0;
      else if (nr === r + 1) m.hW[r + 1][c] = 0;
      else if (nc === c - 1) m.vW[r][c] = 0;
      else m.vW[r][c + 1] = 0;
      seen[idxOf(nr, nc)] = 1;
      stack.push([nr, nc]);
    }

    // the unique route from the start to the toilet
    const { parent } = bfs(m, START_CELL);
    const path = [];
    for (let n = idxOf(TOILET_CELL.r, TOILET_CELL.c); n !== -1; n = parent[n]) path.push(n);
    path.reverse();
    if (path.length < 24) continue; // too short to be interesting
    const L = path.length;
    const picks = [Math.round(L * 0.28), Math.round(L * 0.55), Math.round(L * 0.8)].map((v, i) => Math.max(3 + i, Math.min(L - 3, v + Math.floor(rng() * 3) - 1)));
    if (picks[0] >= picks[1] || picks[1] >= picks[2]) continue;
    const letters = shuffled(['A', 'B', 'C'], rng);
    const doors = picks.map((p, i) => ({ letter: letters[i], r: Math.floor(path[p] / COLS), c: path[p] % COLS, idx: path[p] }));

    // a few loops make the maze less of a dead-end trap, as long as no door can be bypassed
    const doorOk = () => {
      const T = idxOf(TOILET_CELL.r, TOILET_CELL.c);
      for (let j = 0; j < doors.length; j++) {
        const { dist } = bfs(m, START_CELL, new Set([doors[j].idx]));
        if (dist[T] !== -1) return false;
        for (let k = j + 1; k < doors.length; k++) if (dist[doors[k].idx] !== -1) return false;
      }
      return true;
    };
    for (let i = 0, added = 0; i < 80 && added < 16; i++) {
      const horizontal = rng() < 0.5;
      const r = 1 + Math.floor(rng() * (ROWS - 2));
      const c = 1 + Math.floor(rng() * (COLS - 2));
      const arr = horizontal ? m.hW[r] : m.vW[r];
      if (!arr[c]) continue;
      arr[c] = 0;
      if (doorOk()) added++;
      else arr[c] = 1;
    }
    if (!doorOk()) continue;

    // keys: each is reachable before its own door, and far enough from the start to make you explore
    const startBfs = bfs(m, START_CELL);
    const special = new Set([idxOf(START_CELL.r, START_CELL.c), idxOf(TOILET_CELL.r, TOILET_CELL.c), ...doors.map((d) => d.idx)]);
    const keys = [];
    let ok = true;
    for (const d of doors) {
      const { dist } = bfs(m, START_CELL, new Set([d.idx]));
      const cands = [];
      for (let i = 0; i < COLS * ROWS; i++) {
        if (dist[i] < 6 || special.has(i) || keys.some((k) => k.idx === i)) continue;
        const r = Math.floor(i / COLS);
        const c = i % COLS;
        const dead = neighborsOf(m, r, c).length === 1;
        cands.push({ i, score: dist[i] + (dead ? 8 : 0) + rng() * 7 });
      }
      if (!cands.length) {
        ok = false;
        break;
      }
      cands.sort((a, b) => b.score - a.score);
      const pick = cands[Math.floor(rng() * Math.min(5, cands.length))].i;
      keys.push({ letter: d.letter.toLowerCase(), r: Math.floor(pick / COLS), c: pick % COLS, idx: pick });
    }
    if (!ok) continue;

    const spawns = [];
    for (let i = 0; i < COLS * ROWS; i++) if (startBfs.dist[i] >= 9 && !special.has(i) && !keys.some((k) => k.idx === i)) spawns.push(i);
    m.start = { ...START_CELL };
    m.toilet = { ...TOILET_CELL };
    m.doors = doors;
    m.keys = keys;
    m.ghostSpawns = shuffled(spawns, rng);
    m.pathLen = L;
    return m;
  }
  throw new Error('maze generation failed');
}

/* -------------------------------------------------------------- collision */

function buildCollision(m) {
  const rects = [];
  const t = WALL_T / 2;
  for (let r = 0; r <= ROWS; r++) for (let c = 0; c < COLS; c++) if (m.hW[r][c]) rects.push({ key: `h${r}_${c}`, x0: c * CELL - t, x1: (c + 1) * CELL + t, y0: r * CELL - t, y1: r * CELL + t });
  for (let r = 0; r < ROWS; r++) for (let c = 0; c <= COLS; c++) if (m.vW[r][c]) rects.push({ key: `v${r}_${c}`, x0: c * CELL - t, x1: c * CELL + t, y0: r * CELL - t, y1: (r + 1) * CELL + t });
  const byCell = Array.from({ length: COLS * ROWS }, () => []);
  for (const rect of rects) {
    const c0 = Math.max(0, Math.floor((rect.x0 - PLAYER_R) / CELL));
    const c1 = Math.min(COLS - 1, Math.floor((rect.x1 + PLAYER_R) / CELL));
    const r0 = Math.max(0, Math.floor((rect.y0 - PLAYER_R) / CELL));
    const r1 = Math.min(ROWS - 1, Math.floor((rect.y1 + PLAYER_R) / CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) byCell[idxOf(r, c)].push(rect);
  }
  return byCell;
}

function circleHitsRect(x, y, r, rc) {
  const nx = Math.max(rc.x0, Math.min(x, rc.x1));
  const ny = Math.max(rc.y0, Math.min(y, rc.y1));
  return (x - nx) * (x - nx) + (y - ny) * (y - ny) < r * r;
}

function collides(sim, x, y, r) {
  if (x < r || y < r || x > W - r || y > H - r) return true;
  const c = cellAt(x, y);
  for (const rc of sim.collision[idxOf(c.r, c.c)]) if (circleHitsRect(x, y, r, rc)) return true;
  for (const d of sim.layout.doors) {
    if (sim.opened.has(d.letter)) continue;
    const cx = d.c * CELL;
    const cy = d.r * CELL;
    if (circleHitsRect(x, y, r, { x0: cx + 2, x1: cx + CELL - 2, y0: cy + 2, y1: cy + CELL - 2 })) return true;
  }
  return false;
}

/* ------------------------------------------------------------------- sim */

function startMaze(io, room) {
  const layout = generateLayout();
  const now = Date.now();
  const order = [...room.players.values()].map((p) => p.playerId);
  const sim = {
    layout,
    collision: buildCollision(layout),
    questionPool: shuffled(getQuestions('haunted')),
    startsAt: now + START_COUNTDOWN_MS,
    bladder: 0,
    bladderBase: 100 / (BLADDER_MS / 1000), // percent per second
    endsAt: now + START_COUNTDOWN_MS + BLADDER_MS, // if nothing else happens
    order,
    players: new Map(),
    ghosts: [],
    opened: new Set(),
    keyTaken: new Map(), // key letter -> playerId
    finishedCount: 0,
    tick: 0,
    noHumansSince: null,
    over: false,
    lastTickAt: now,
  };
  const s = cellCenter(layout.start.r, layout.start.c);
  order.forEach((id, i) => {
    const p = room.players.get(id);
    p.score = 0;
    p.streak = 0;
    p.eliminated = false;
    p.left = false;
    p.place = null;
    p.team = null;
    const ang = (i / Math.max(1, order.length)) * Math.PI * 2;
    sim.players.set(id, {
      idx: i,
      x: s.x + Math.cos(ang) * 22,
      y: s.y + Math.sin(ang) * 22,
      face: -1,
      input: { dx: 0, dy: 0 },
      stunUntil: 0,
      lockoutUntil: 0,
      lastCaughtAt: 0,
      nextFlashAt: 0,
      flashUntil: 0,
      quiz: null,
      qCursor: i * 5,
      points: 0,
      keysWon: 0,
      caught: 0,
      scared: 0,
      finishedAt: null,
      finishRank: null,
      goal: null,
      botNextThink: 0,
      botNextFlash: 0,
      speedMul: p.isBot ? BOT_SPEED_MUL[p.botTier] || 0.8 : 1,
    });
  });
  const ghostCount = Math.max(3, Math.min(5, 3 + Math.floor(order.length / 4)));
  for (let g = 0; g < ghostCount; g++) {
    const cell = layout.ghostSpawns[g % layout.ghostSpawns.length];
    const at = cellCenter(Math.floor(cell / COLS), cell % COLS);
    sim.ghosts.push({ x: at.x, y: at.y, cell, next: cell, goal: cell, mode: 'patrol', stunUntil: 0, coolUntil: 0, speed: 104 + g * 6, target: null, retarget: 0 });
  }
  room.maze = sim;
  room.state = 'maze';
  room.startsAt = sim.startsAt;
  io.to(room.code).emit(EVENTS.MAZE_START, initPayload(room));
  room.timers.mazeTick = setInterval(() => tick(io, room), TICK_MS);
}

function compactWalls(layout) {
  return {
    hW: layout.hW.map((row) => Array.from(row).join('')),
    vW: layout.vW.map((row) => Array.from(row).join('')),
  };
}

function initPayload(room) {
  const sim = room.maze;
  const L = sim.layout;
  const walls = compactWalls(L);
  return {
    cols: COLS,
    rows: ROWS,
    cell: CELL,
    wallT: WALL_T,
    playerR: PLAYER_R,
    hW: walls.hW,
    vW: walls.vW,
    start: cellCenter(L.start.r, L.start.c),
    toilet: cellCenter(L.toilet.r, L.toilet.c),
    keys: L.keys.map((k) => ({ letter: k.letter, ...cellCenter(k.r, k.c) })),
    doors: L.doors.map((d) => ({ letter: d.letter, ...cellCenter(d.r, d.c) })),
    players: sim.order.map((id) => {
      const p = room.players.get(id);
      return { playerId: id, name: p.name, avatar: p.avatar, isBot: !!p.isBot, botTier: p.botTier || null };
    }),
    ghostCount: sim.ghosts.length,
    bladderMs: BLADDER_MS,
    startsAt: sim.startsAt,
    serverNow: Date.now(),
    snapshot: snapshot(room),
  };
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

const feed = (io, room, text) => io.to(room.code).emit(EVENTS.MAZE_FEED, { text });

function speedOf(ps, now) {
  if (ps.stunUntil > now || ps.quiz) return 0;
  return BASE_SPEED * (ps.speedMul || 1);
}

function movePlayer(sim, ps, dt, now) {
  const sp = speedOf(ps, now);
  const { dx, dy } = ps.input;
  if (!sp || (!dx && !dy)) return;
  const len = Math.hypot(dx, dy) || 1;
  const vx = (dx / len) * sp * dt;
  const vy = (dy / len) * sp * dt;
  if (!collides(sim, ps.x + vx, ps.y, PLAYER_R)) ps.x += vx;
  if (!collides(sim, ps.x, ps.y + vy, PLAYER_R)) ps.y += vy;
  if (Math.abs(dx) > 0.15) ps.face = dx > 0 ? 1 : -1;
}

/* ------------------------------------------------------------------ quiz */

function nextQuestion(sim, ps) {
  const q = sim.questionPool[ps.qCursor % sim.questionPool.length];
  ps.qCursor += 1;
  return q;
}

function addBladder(sim, amount) {
  sim.bladder = Math.max(0, Math.min(100, sim.bladder + amount));
}

function openQuiz(io, room, id, ps, key, now) {
  const sim = room.maze;
  const p = room.players.get(id);
  const q = nextQuestion(sim, ps);
  ps.quiz = { q, key: key.letter, startedAt: now, endsAt: now + QUIZ_MS };
  ps.input = { dx: 0, dy: 0 };
  if (p && p.socketId) {
    io.to(p.socketId).emit(EVENTS.MAZE_QUIZ, { text: q.text, choices: q.choices, endsAt: ps.quiz.endsAt, serverNow: now, key: key.letter });
  }
  if (p && p.isBot) {
    const plan = bots.planAnswer(p.botTier, q, QUIZ_MS, { streak: 0 });
    const delay = Math.min(QUIZ_MS - 1200, plan.delay * 0.8);
    const ref = ps.quiz;
    setTimeout(() => {
      if (room.state !== 'maze' || ps.quiz !== ref) return;
      resolveAnswer(io, room, id, plan.choiceIndex);
    }, delay);
  }
}

function resolveAnswer(io, room, id, choiceIndex) {
  const sim = room.maze;
  if (!sim || room.state !== 'maze') return;
  const ps = sim.players.get(id);
  const p = room.players.get(id);
  if (!ps || !p || !ps.quiz) return;
  const now = Date.now();
  const quiz = ps.quiz;
  ps.quiz = null;
  const correct = Number.isInteger(choiceIndex) && choiceIndex === quiz.q.correctIndex;
  let gained = 0;
  let already = false;
  if (correct) {
    if (sim.keyTaken.has(quiz.key)) {
      already = true; // a teammate got there first — a small consolation
      gained = 120;
    } else {
      const speedBonus = Math.round(300 * Math.max(0, 1 - (now - quiz.startedAt) / QUIZ_MS));
      gained = 400 + speedBonus;
      sim.keyTaken.set(quiz.key, id);
      sim.opened.add(quiz.key.toUpperCase());
      ps.keysWon += 1;
      addBladder(sim, -RIGHT_RELIEF);
      io.to(room.code).emit(EVENTS.MAZE_FX, { type: 'key', letter: quiz.key, playerId: id });
      feed(io, room, `🔑 ${p.avatar} ${p.name} won key ${quiz.key.toUpperCase()} — door ${quiz.key.toUpperCase()} is open!`);
    }
    ps.points += gained;
    p.score = ps.points;
    say(io, room, id, 'right', 0.5);
  } else {
    ps.lockoutUntil = now + LOCKOUT_MS;
    addBladder(sim, WRONG_BLADDER);
    say(io, room, id, 'wrong', 0.5);
  }
  if (p.socketId) {
    io.to(p.socketId).emit(EVENTS.MAZE_RESULT, {
      correct,
      already,
      correctIndex: quiz.q.correctIndex,
      key: quiz.key,
      gained,
      points: ps.points,
      lockoutMs: correct ? 0 : LOCKOUT_MS,
      bladderDelta: correct && !already ? -RIGHT_RELIEF : correct ? 0 : WRONG_BLADDER,
    });
  }
}

/* ---------------------------------------------------------------- ghosts */

function distMap(m, blocked, to) {
  return bfs(m, to, blocked).dist;
}

function stepGhosts(io, room, dt, now) {
  const sim = room.maze;
  const L = sim.layout;
  const live = [...sim.players.entries()].filter(([id, ps]) => {
    const p = room.players.get(id);
    return p && !p.left && !ps.finishedAt;
  });
  const speedBoost = 1 + (sim.bladder / 100) * 0.35; // things get worse as the bladder fills
  for (const g of sim.ghosts) {
    const stunned = g.stunUntil > now;
    g.mode = stunned ? 'stunned' : g.coolUntil > now ? 'flee' : g.mode === 'chase' ? 'chase' : 'patrol';
    if (stunned) continue;

    // pick a target every so often
    if (now >= g.retarget) {
      g.retarget = now + 450;
      let best = null;
      let bestD = 1e9;
      for (const [id, ps] of live) {
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
        const c = cellAt(ps.x, ps.y);
        g.goal = idxOf(c.r, c.c);
        g.target = best;
      } else {
        g.mode = 'patrol';
        if (g.goal === g.cell || Math.random() < 0.05) g.goal = Math.floor(Math.random() * COLS * ROWS);
      }
    }

    // walk along the corridors (ghosts drift through closed doors)
    const nextCenter = cellCenter(Math.floor(g.next / COLS), g.next % COLS);
    const dx = nextCenter.x - g.x;
    const dy = nextCenter.y - g.y;
    const dist = Math.hypot(dx, dy);
    const sp = g.speed * speedBoost * (g.mode === 'flee' ? 0.8 : g.mode === 'chase' ? 1.08 : 0.85);
    const step = sp * dt;
    if (dist <= step) {
      g.x = nextCenter.x;
      g.y = nextCenter.y;
      g.cell = g.next;
      if (g.cell !== g.goal) {
        const dm = distMap(L, null, { r: Math.floor(g.goal / COLS), c: g.goal % COLS });
        let bestN = g.cell;
        let bestV = dm[g.cell];
        for (const [nr, nc] of neighborsOf(L, Math.floor(g.cell / COLS), g.cell % COLS)) {
          const ni = idxOf(nr, nc);
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

    // touching a player
    if (g.mode !== 'flee') {
      for (const [id, ps] of live) {
        if (now - ps.lastCaughtAt < CATCH_COOLDOWN_MS || ps.stunUntil > now) continue;
        if (Math.hypot(ps.x - g.x, ps.y - g.y) < 34) {
          const p = room.players.get(id);
          ps.lastCaughtAt = now;
          ps.stunUntil = now + STUN_MS;
          ps.input = { dx: 0, dy: 0 };
          ps.caught += 1;
          addBladder(sim, CATCH_BLADDER);
          g.coolUntil = now + 4500;
          g.mode = 'flee';
          io.to(room.code).emit(EVENTS.MAZE_FX, { type: 'caught', playerId: id });
          feed(io, room, `👻 A ghost scared ${p.avatar} ${p.name}! Bladder +${CATCH_BLADDER}%`);
          say(io, room, id, 'wrong', 0.5);
          break;
        }
      }
    }
  }
}

function tryFlash(io, room, id, now) {
  const sim = room.maze;
  const ps = sim.players.get(id);
  if (!ps || ps.finishedAt || ps.quiz || ps.stunUntil > now || now < ps.nextFlashAt) return false;
  ps.nextFlashAt = now + FLASH_COOLDOWN_MS;
  ps.flashUntil = now + 600;
  let hit = 0;
  for (const g of sim.ghosts) {
    if (Math.hypot(g.x - ps.x, g.y - ps.y) < FLASH_RANGE) {
      g.stunUntil = now + GHOST_STUN_MS;
      g.coolUntil = now + GHOST_STUN_MS + 2500;
      g.mode = 'stunned';
      hit += 1;
    }
  }
  ps.scared += hit;
  io.to(room.code).emit(EVENTS.MAZE_FX, { type: 'flash', playerId: id, hit });
  if (hit) {
    const p = room.players.get(id);
    feed(io, room, `🔦 ${p.avatar} ${p.name} scared off ${hit === 1 ? 'a ghost' : `${hit} ghosts`}!`);
  }
  return true;
}

/* ------------------------------------------------------------------ bots */

function botThink(io, room, id, ps, p, now) {
  const sim = room.maze;
  const L = sim.layout;
  if (ps.finishedAt || ps.quiz || ps.stunUntil > now) {
    ps.input = { dx: 0, dy: 0 };
    return;
  }
  // use the flashlight when a ghost gets close
  if (now > ps.botNextFlash && now >= ps.nextFlashAt) {
    ps.botNextFlash = now + 600;
    const near = sim.ghosts.some((g) => g.stunUntil <= now && Math.hypot(g.x - ps.x, g.y - ps.y) < 120);
    const eager = p.botTier === 'legend' ? 0.95 : p.botTier === 'elite' ? 0.8 : p.botTier === 'veteran' ? 0.55 : 0.3;
    if (near && Math.random() < eager) tryFlash(io, room, id, now);
  }
  const here = cellAt(ps.x, ps.y);
  const hereIdx = idxOf(here.r, here.c);
  if (now >= ps.botNextThink || ps.goal === null) {
    ps.botNextThink = now + 500;
    const closed = new Set(L.doors.filter((d) => !sim.opened.has(d.letter)).map((d) => d.idx));
    const reach = bfs(L, here, closed).dist;
    const pending = L.keys.filter((k) => !sim.keyTaken.has(k.letter) && reach[k.idx] !== -1).sort((a, b) => reach[a.idx] - reach[b.idx]);
    if (pending.length) ps.goal = pending[ps.idx % pending.length].idx;
    else if (reach[idxOf(L.toilet.r, L.toilet.c)] !== -1) ps.goal = idxOf(L.toilet.r, L.toilet.c);
    else ps.goal = hereIdx;
  }
  const closed = new Set(L.doors.filter((d) => !sim.opened.has(d.letter)).map((d) => d.idx));
  const goalCell = { r: Math.floor(ps.goal / COLS), c: ps.goal % COLS };
  const dm = bfs(L, goalCell, closed).dist;
  let target = cellCenter(goalCell.r, goalCell.c);
  if (hereIdx !== ps.goal && dm[hereIdx] !== -1) {
    let bestN = hereIdx;
    let bestV = dm[hereIdx];
    for (const [nr, nc] of neighborsOf(L, here.r, here.c)) {
      const ni = idxOf(nr, nc);
      if (closed.has(ni) || dm[ni] === -1) continue;
      if (dm[ni] < bestV) {
        bestV = dm[ni];
        bestN = ni;
      }
    }
    target = cellCenter(Math.floor(bestN / COLS), bestN % COLS);
  }
  ps.input = { dx: target.x - ps.x, dy: target.y - ps.y };
  if (Math.hypot(ps.input.dx, ps.input.dy) < 6) ps.input = { dx: 0, dy: 0 };
}

/* ------------------------------------------------------------------ tick */

function snapshot(room) {
  const sim = room.maze;
  const now = Date.now();
  return {
    t: now,
    p: sim.order.map((id) => {
      const ps = sim.players.get(id);
      let flags = 0;
      if (ps.stunUntil > now) flags |= 1;
      if (ps.flashUntil > now) flags |= 4;
      if (ps.quiz) flags |= 8;
      if (ps.finishedAt) flags |= 32;
      const pl = room.players.get(id);
      if (pl && pl.left) flags |= 64;
      return [ps.idx, Math.round(ps.x), Math.round(ps.y), ps.face, flags, ps.keysWon, ps.points, ps.caught];
    }),
    g: sim.ghosts.map((g) => [Math.round(g.x), Math.round(g.y), g.mode === 'chase' ? 1 : g.mode === 'stunned' ? 2 : g.mode === 'flee' ? 3 : 0]),
    b: Math.round(sim.bladder * 10) / 10,
    rate: Math.round(sim.bladderBase * 1000) / 1000,
    open: Array.from(sim.opened),
    done: sim.finishedCount,
  };
}

function tick(io, room) {
  const sim = room.maze;
  if (!sim || room.state !== 'maze' || sim.over) return;
  const now = Date.now();
  const dt = Math.min(0.1, (now - sim.lastTickAt) / 1000);
  sim.lastTickAt = now;
  sim.tick += 1;

  if (now >= sim.startsAt) {
    sim.bladder = Math.min(100, sim.bladder + sim.bladderBase * dt);
    for (const [id, ps] of sim.players) {
      const p = room.players.get(id);
      if (!p || p.left) continue;
      if (!p.isBot && !p.connected) ps.input = { dx: 0, dy: 0 };
      if (p.isBot) botThink(io, room, id, ps, p, now);
      if (ps.quiz && now > ps.quiz.endsAt) resolveAnswer(io, room, id, -1);
      if (!ps.finishedAt) movePlayer(sim, ps, dt, now);

      if (!ps.finishedAt && !ps.quiz && ps.stunUntil <= now && now >= ps.lockoutUntil) {
        for (const k of sim.layout.keys) {
          if (sim.keyTaken.has(k.letter)) continue;
          const c = cellCenter(k.r, k.c);
          if (Math.hypot(c.x - ps.x, c.y - ps.y) < KEY_RADIUS) {
            openQuiz(io, room, id, ps, k, now);
            break;
          }
        }
      }
      // the toilet!
      if (!ps.finishedAt && !ps.quiz) {
        const t = cellCenter(sim.layout.toilet.r, sim.layout.toilet.c);
        if (Math.hypot(t.x - ps.x, t.y - ps.y) < TOILET_RADIUS) {
          ps.finishedAt = now;
          ps.finishRank = sim.finishedCount;
          sim.finishedCount += 1;
          const bonus = FINISH_BONUS[ps.finishRank] || 150;
          ps.points += bonus;
          p.score = ps.points;
          io.to(room.code).emit(EVENTS.MAZE_FX, { type: 'toilet', playerId: id, rank: ps.finishRank });
          feed(io, room, `🚽 ${p.avatar} ${p.name} made it to the toilet${ps.finishRank === 0 ? ' first' : ''}! +${bonus}`);
          say(io, room, id, 'right', 0.8);
        }
      }
    }
    stepGhosts(io, room, dt, now);

    const humans = [...sim.players.entries()].filter(([id]) => {
      const p = room.players.get(id);
      return p && !p.isBot && !p.left && p.connected;
    });
    if (humans.length === 0) {
      if (!sim.noHumansSince) sim.noHumansSince = now;
    } else sim.noHumansSince = null;
    const allDone = humans.length > 0 && humans.every(([, ps]) => ps.finishedAt);
    if (sim.bladder >= 100) return finishMaze(io, room, 'bladder');
    if (allDone) return finishMaze(io, room, 'won');
    if (sim.noHumansSince && now - sim.noHumansSince > 30000) return finishMaze(io, room, 'abandoned');
  }
  if (sim.tick % SNAPSHOT_EVERY === 0) io.to(room.code).emit(EVENTS.MAZE_STATE, snapshot(room));
}

function finishMaze(io, room, outcome) {
  const sim = room.maze;
  if (!sim || sim.over) return;
  sim.over = true;
  clearInterval(room.timers.mazeTick);
  room.timers.mazeTick = null;
  const won = outcome === 'won';
  if (won) {
    const bonus = Math.round((100 - sim.bladder) * 8);
    for (const [, ps] of sim.players) if (ps.finishedAt) ps.points += bonus;
  }
  for (const [id, ps] of sim.players) {
    const p = room.players.get(id);
    if (p) p.score = ps.points;
  }
  room.state = 'final';
  const board = serializePlayers(room);
  const entries = [...sim.players.entries()];
  const nameOf = (id) => room.players.get(id).name;
  const awards = [];
  const keyMaster = entries.slice().sort((a, b) => b[1].keysWon - a[1].keysWon || b[1].points - a[1].points)[0];
  if (keyMaster && keyMaster[1].keysWon > 0) awards.push({ key: 'keys', icon: '🔑', title: 'Key Master', playerId: keyMaster[0], name: nameOf(keyMaster[0]), detail: `${keyMaster[1].keysWon} key${keyMaster[1].keysWon > 1 ? 's' : ''} won` });
  const first = entries.find(([, ps]) => ps.finishRank === 0);
  if (first) awards.push({ key: 'loo', icon: '🚽', title: 'First to the Loo', playerId: first[0], name: nameOf(first[0]), detail: 'no time to waste' });
  const magnet = entries.slice().sort((a, b) => b[1].caught - a[1].caught)[0];
  if (magnet && magnet[1].caught > 0) awards.push({ key: 'magnet', icon: '👻', title: 'Ghost Magnet', playerId: magnet[0], name: nameOf(magnet[0]), detail: `scared ${magnet[1].caught}×` });
  const buster = entries.slice().sort((a, b) => b[1].scared - a[1].scared)[0];
  if (buster && buster[1].scared > 0 && awards.length < 3) awards.push({ key: 'buster', icon: '🔦', title: 'Ghostbuster', playerId: buster[0], name: nameOf(buster[0]), detail: `${buster[1].scared} ghost scares` });
  io.to(room.code).emit(EVENTS.GAME_FINAL, {
    leaderboard: board,
    podium: board.slice(0, 3),
    awards,
    teams: null,
    teamMode: 0,
    maze: { outcome, won, bladder: Math.round(sim.bladder), keys: sim.keyTaken.size, totalKeys: sim.layout.keys.length, finished: sim.finishedCount },
  });
  db.saveGameResult({
    roomCode: room.code,
    category: 'haunted',
    categoryLabel: '🚽 We Gotta Go',
    levelKey: null,
    levelLabel: null,
    subject: null,
    players: board,
  });
}

/* ------------------------------------------------------- inputs from clients */

function setInput(room, playerId, dx, dy) {
  const sim = room.maze;
  if (!sim || room.state !== 'maze') return;
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

function flash(io, room, playerId) {
  const sim = room.maze;
  if (!sim || room.state !== 'maze' || Date.now() < sim.startsAt) return;
  tryFlash(io, room, playerId, Date.now());
}

function stopMaze(room) {
  if (room.timers && room.timers.mazeTick) {
    clearInterval(room.timers.mazeTick);
    room.timers.mazeTick = null;
  }
  room.maze = null;
}

module.exports = { startMaze, initPayload, setInput, answer, flash, finishMaze, stopMaze, generateLayout, COLS, ROWS, CELL };
