/*
 * The haunted mansion's maze: a generated layout (14x10 cells) with three locked rooms (A, B, C),
 * a key for each, a start and the toilet exit, checked so every door is a real chokepoint and every
 * key can be reached before its own door. Also the wall collision and grid helpers used by the
 * City simulation (backend/city.js).
 */

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

function compactWalls(layout) {
  return {
    hW: layout.hW.map((row) => Array.from(row).join('')),
    vW: layout.vW.map((row) => Array.from(row).join('')),
  };
}

// collision against a maze for someone who has opened a personal set of doors (used by the merged City mode)
function collidesWith(collision, layout, opened, x, y, r) {
  if (x < r || y < r || x > W - r || y > H - r) return true;
  const c = cellAt(x, y);
  for (const rc of collision[idxOf(c.r, c.c)]) if (circleHitsRect(x, y, r, rc)) return true;
  for (const d of layout.doors) {
    if (opened.has(d.letter)) continue;
    const cx = d.c * CELL;
    const cy = d.r * CELL;
    if (circleHitsRect(x, y, r, { x0: cx + 2, x1: cx + CELL - 2, y0: cy + 2, y1: cy + CELL - 2 })) return true;
  }
  return false;
}

module.exports = {
  generateLayout,
  buildCollision,
  collidesWith,
  compactWalls,
  bfs,
  neighborsOf,
  cellAt,
  cellCenter,
  idxOf,
  COLS,
  ROWS,
  CELL,
  WALL_T,
  PLAYER_R,
  KEY_RADIUS,
  TOILET_RADIUS,
};
