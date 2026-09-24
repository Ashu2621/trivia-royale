/*
 * Arena — the map of the whole match, drawn on one canvas.
 *
 * Every level (stage) is a room laid out along a route: Qualifier → … → Grand
 * Final. Each contestant is an animated human sitting at their own table. When a
 * level ends the storm closes on the room: the weakest candidates collapse and
 * are out, while the survivors stand up, run down the corridor to the next room
 * and sit at a new table — like a squad rotating into the next safe zone.
 *
 * Everything (rooms, tables, people, parachutes, the closing zone) is vector
 * drawing on a 2D canvas, so it stays sharp on phones, tablets and laptops.
 */
const Arena = (function () {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---- world geometry (units are arbitrary "world px"; the camera scales them) ----
  const RW = 560;
  const RH = 340;
  const CORR = 170;
  const PAD = 40;
  const DOOR_Y = 302;
  const roomX = (i) => PAD + i * (RW + CORR);

  const STAGE_LOOK = [
    { floorA: '#274fb8', floorB: '#132a72', wall: '#0b1a55', accent: '#6aa8ff' },
    { floorA: '#5a2fb8', floorB: '#2c1673', wall: '#1d0e55', accent: '#b58cff' },
    { floorA: '#b85a24', floorB: '#6d2c12', wall: '#4a1c0a', accent: '#ffb066' },
    { floorA: '#b8902a', floorB: '#6d5210', wall: '#4a3608', accent: '#ffe08a' },
  ];

  const TEAM_COLORS = ['#e63946', '#3a7bd5', '#2ecc71', '#f5c542'];
  const SKIN = ['#f5d0b0', '#e6b48a', '#c98f62', '#a86b42', '#7c4a2d', '#f9dcc4'];
  const HAIR = ['#141013', '#2b1d14', '#4a2f1c', '#7a5230', '#9a9a9a', '#0e0e12', '#8a3b1c', '#d8b25a'];
  const SHIRT = ['#e63946', '#f4a261', '#2a9d8f', '#4361ee', '#9b5de5', '#f15bb5', '#00bbf9', '#8ac926', '#ff7b00', '#7209b7'];

  let canvas = null;
  let ctx = null;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let running = false;
  let last = 0;
  let plan = { count: 4, per: 3, names: ['Qualifier', 'Quarter-final', 'Semi-final', 'Grand Final'] };
  let hooks = {};
  let meId = null;
  let phase = 'idle';
  let activeStage = 0;
  let reachedStage = 0;
  let overview = false;
  let stageProgress = [];
  let storm = null; // { stage, start }
  let zone = null; // { stage, start, dur }
  let rooms = [];
  const chars = new Map();
  const dust = [];
  const floaters = [];
  const timeouts = [];
  const cam = { x: 0, y: RH / 2, s: 1, tx: 0, ty: RH / 2, ts: 1 };
  let nowT = 0;
  let curSub = 0;
  let fans = {};

  const dotsFor = (i) => (plan.total ? Math.max(1, Math.min(plan.per, plan.total - i * plan.per)) : plan.per);
  const worldW = () => PAD * 2 + plan.count * RW + (plan.count - 1) * CORR;

  /* ------------------------------------------------------------ helpers */

  function hash(str) {
    let h = 7;
    for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return Math.abs(h);
  }

  function lookFor(id) {
    const h = hash(id);
    return {
      skin: SKIN[h % SKIN.length],
      hair: HAIR[(h >> 3) % HAIR.length],
      style: (h >> 6) % 4,
      shirt: SHIRT[(h >> 9) % SHIRT.length],
    };
  }

  function mix(hex, other, k) {
    const a = parseInt(hex.slice(1), 16);
    const b = parseInt(other.slice(1), 16);
    const r = Math.round(((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k);
    const g = Math.round(((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k);
    const bl = Math.round((a & 255) * (1 - k) + (b & 255) * k);
    return `rgb(${r},${g},${bl})`;
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function later(ms, fn) {
    const id = setTimeout(fn, ms);
    timeouts.push(id);
    return id;
  }
  function clearLater() {
    while (timeouts.length) clearTimeout(timeouts.pop());
  }

  const fontSize = (base) => clamp(base / Math.max(cam.s, 0.2), base * 0.9, base * 1.55);

  /* ------------------------------------------------------- rooms & tables */

  function seatLayout(stage, n) {
    const rx = roomX(stage);
    const spots = [];
    if (n <= 5) {
      const pitch = Math.min(108, (RW - 90) / Math.max(n, 1));
      for (let i = 0; i < n; i++) spots.push({ x: rx + RW / 2 + (i - (n - 1) / 2) * pitch, y: 248 });
    } else {
      const back = Math.ceil(n / 2);
      const front = n - back;
      const pitchB = Math.min(108, (RW - 90) / back);
      const pitchF = Math.min(108, (RW - 90) / Math.max(front, 1));
      for (let i = 0; i < back; i++) spots.push({ x: rx + RW / 2 + (i - (back - 1) / 2) * pitchB, y: 176 });
      for (let i = 0; i < front; i++) spots.push({ x: rx + RW / 2 + (i - (front - 1) / 2) * pitchF, y: 282 });
    }
    return spots;
  }

  // Lay out a room's tables. immediate=true seats people at once; otherwise the
  // tables stand empty and each person claims theirs when they arrive.
  function buildRoom(stage, ids, immediate, bornAt) {
    const spots = seatLayout(stage, ids.length);
    const room = rooms[stage];
    room.tables = spots.map((s, i) => ({ x: s.x, y: s.y, owner: immediate ? ids[i] : null, born: bornAt !== undefined ? bornAt + i * 0.06 : nowT + i * 0.06 }));
    room.built = true;
    ids.forEach((id, i) => {
      const ch = chars.get(id);
      if (!ch) return;
      if (immediate) {
        ch.stage = stage;
        ch.seat = i;
      } else {
        ch.dest = { stage, seat: i };
      }
    });
  }

  function tableOf(ch) {
    const room = rooms[ch.stage];
    return room && room.tables[ch.seat];
  }

  function seatChar(ch) {
    const t = tableOf(ch);
    if (!t) return;
    ch.x = t.x;
    ch.y = t.y;
    ch.state = 'sit';
    ch.path = null;
  }

  /* ----------------------------------------------------------- characters */

  function makeChar(p, teamMode) {
    const look = lookFor(p.playerId);
    const team = teamMode && p.team !== null && p.team !== undefined ? p.team : null;
    if (team !== null) look.shirt = TEAM_COLORS[team % TEAM_COLORS.length];
    return {
      team,
      say: null,
      id: p.playerId,
      name: p.name || '?',
      emoji: p.avatar || '🙂',
      look,
      x: 0,
      y: 0,
      dir: 1,
      state: 'sit', // sit | run | drop | dead
      stage: 0,
      seat: 0,
      path: null,
      speed: 300,
      ph: rand(0, TAU),
      walkT: rand(0, TAU),
      alive: true,
      dead: false,
      place: null,
      locked: false,
      order: 0,
      ms: 0,
      choice: null,
      verdict: null,
      cheerUntil: 0,
      slump: false,
      pressUntil: 0,
      sleeping: false,
      dropStart: 0,
      dropDelay: 0,
      dustT: 0,
    };
  }

  function resetRound() {
    chars.forEach((ch) => {
      ch.locked = false;
      ch.order = 0;
      ch.ms = 0;
      ch.choice = null;
      ch.verdict = null;
      ch.cheerUntil = 0;
      ch.slump = false;
      ch.pressUntil = 0;
      ch.sleeping = false;
    });
  }

  /* --------------------------------------------------------------- camera */

  function fitScale() {
    return Math.min(W / (RW + 24), H / (RH + 16));
  }

  function focus(stage, immediate, zoom) {
    cam.tx = roomX(stage) + RW / 2;
    cam.ty = RH / 2 + 4;
    cam.ts = fitScale() * (zoom || 1);
    if (immediate) {
      cam.x = cam.tx;
      cam.y = cam.ty;
      cam.s = cam.ts;
    }
  }

  function showOverview() {
    cam.tx = worldW() / 2;
    cam.ty = RH / 2;
    cam.ts = Math.min(W / worldW(), H / (RH + 30));
  }

  function toggleOverview() {
    overview = !overview;
    if (overview) showOverview();
    else focus(activeStage);
  }

  /* -------------------------------------------------------------- public: */

  function setPlan(p) {
    if (p && p.count) plan = p;
    rooms = Array.from({ length: plan.count }, () => ({ tables: [], built: false }));
    stageProgress = new Array(plan.count).fill(0);
  }

  // Start (or restore) a match: everyone alive is placed at the tables of `stage`.
  // With drop=true they parachute in from above, like the start of a battle.
  function startMatch(players, p, opts) {
    const o = opts || {};
    clearLater();
    setPlan(p);
    chars.clear();
    dust.length = 0;
    floaters.length = 0;
    storm = null;
    zone = null;
    phase = 'idle';
    overview = false;
    const stage = o.stage || 0;
    activeStage = stage;
    reachedStage = stage;
    fans = {};
    players.forEach((pl) => chars.set(pl.playerId, makeChar(pl, o.teamMode)));
    const alive = players.filter((pl) => !pl.eliminated);
    buildRoom(stage, alive.map((pl) => pl.playerId), true, -1);
    for (let i = 0; i < stage; i++) stageProgress[i] = dotsFor(i);

    // the already-eliminated (on a reconnect) sit slumped in the previous room
    players.filter((pl) => pl.eliminated).forEach((pl, i) => {
      const ch = chars.get(pl.playerId);
      const room = Math.max(0, stage - 1);
      if (!rooms[room].built) buildRoom(room, [], true, -1);
      const spot = seatLayout(room, players.filter((x) => x.eliminated).length)[i];
      rooms[room].tables.push({ x: spot.x, y: spot.y, owner: ch.id, born: 0 });
      ch.stage = room;
      ch.seat = rooms[room].tables.length - 1;
      ch.dead = true;
      ch.alive = false;
      ch.place = pl.place;
      seatChar(ch);
      ch.state = 'dead';
    });

    alive.forEach((pl, i) => {
      const ch = chars.get(pl.playerId);
      seatChar(ch);
      if (o.drop && !reduceMotion) {
        ch.state = 'drop';
        ch.dropStart = nowT + 0.15 + i * 0.13;
        ch.dropDelay = ch.dropStart;
        ch.dropFrom = -320;
      }
    });
    focus(stage, true);
    start();
  }

  function startQuestion(info) {
    const stage = info.index;
    resetRound();
    phase = 'question';
    if (stage !== activeStage || !rooms[stage].built) {
      // joined late / missed a transition: place survivors directly
      const ids = [...chars.values()].filter((c) => c.alive).map((c) => c.id);
      activeStage = stage;
      reachedStage = Math.max(reachedStage, stage);
      buildRoom(stage, ids, true, -1);
      ids.forEach((id) => seatChar(chars.get(id)));
    }
    activeStage = stage;
    curSub = info.sub;
    stageProgress[stage] = info.sub;
    for (let i = 0; i < stage; i++) stageProgress[i] = dotsFor(i);
    if (!overview) focus(stage);
    storm = null;
    zone = null;
  }

  function lock(id, order, ms) {
    const ch = chars.get(id);
    if (!ch || ch.dead) return;
    ch.locked = true;
    ch.order = order;
    ch.ms = ms;
    ch.pressUntil = nowT + 0.35;
  }

  function reveal(choices, correctIndex) {
    phase = 'reveal';
    const letters = ['A', 'B', 'C', 'D'];
    chars.forEach((ch) => {
      if (ch.dead || !ch.alive) return;
      const c = choices[ch.id];
      if (c === undefined) {
        ch.sleeping = true;
        return;
      }
      ch.choice = letters[c];
      if (c === correctIndex) {
        ch.verdict = 'right';
        ch.cheerUntil = nowT + 1.8;
        floaters.push({ x: ch.x, y: ch.y - 96, text: '✓', color: '#3ee08f', born: nowT, life: 1.6 });
      } else {
        ch.verdict = 'wrong';
        ch.slump = true;
        floaters.push({ x: ch.x, y: ch.y - 96, text: '✗', color: '#ff5470', born: nowT, life: 1.6 });
      }
    });
    stageProgress[activeStage] = curSub + 1;
  }

  function transition(data) {
    const { completedStage: old, nextStage: next, advancing, eliminated, durationMs } = data;
    clearLater();
    phase = 'transition';
    overview = false;
    stageProgress[old] = dotsFor(old);
    if (next >= plan.count) return;
    storm = { stage: old, start: nowT };
    zone = { stage: next, start: nowT + 0.6, dur: 3.2 };
    if (hooks.siren) hooks.siren();
    focus(old, false, 0.86);

    // 1) the cut: the weakest collapse where they sit
    later(900, () => {
      eliminated.forEach((e, i) => {
        later(i * 320, () => {
          const ch = chars.get(e.playerId);
          if (!ch) return;
          ch.alive = false;
          ch.dead = true;
          ch.place = e.place;
          ch.state = 'dead';
          ch.deadAt = nowT;
          burst(ch.x, ch.y - 40, '#ff3d3d', 26);
          floaters.push({ x: ch.x, y: ch.y - 110, text: `#${e.place} OUT`, color: '#ff5470', born: nowT, life: 2.6, big: true });
          if (hooks.eliminated) hooks.eliminated(e.playerId, e.place);
        });
      });
    });

    // 2) the next room is prepared for the survivors
    buildRoom(next, advancing, false, nowT + 1.4);
    reachedStage = next;

    // 3) the survivors stand up and run through the corridor
    const runStart = 2600 + eliminated.length * 320;
    advancing.forEach((id, i) => {
      later(runStart + i * 170, () => sendToNext(id, old, next));
    });

    later(Math.max(1000, durationMs - 700), () => {
      focus(next);
      phase = 'idle';
    });
  }

  function sendToNext(id, from, to) {
    const ch = chars.get(id);
    if (!ch || !ch.alive) return;
    const oldTable = tableOf(ch);
    if (oldTable) oldTable.owner = null;
    const lane = DOOR_Y + rand(-22, 22);
    const rx = roomX(from);
    const nx = roomX(to);
    const seatIdx = ch.dest ? ch.dest.seat : ch.seat;
    const seat = rooms[to].tables[seatIdx];
    ch.state = 'run';
    ch.path = [
      { x: ch.x + (ch.x < rx + RW / 2 ? -50 : 50), y: ch.y + 46 },
      { x: rx + RW - 30, y: lane },
      { x: nx - 30, y: lane },
      { x: nx + 40, y: lane },
      { x: seat.x, y: seat.y + 46 },
    ];
    ch.speed = rand(300, 360);
    ch.arrive = () => {
      ch.x = seat.x;
      ch.y = seat.y;
      ch.stage = to;
      ch.seat = seatIdx;
      seat.owner = ch.id;
      ch.state = 'sit';
      ch.path = null;
      ch.pop = nowT;
      burst(seat.x, seat.y - 30, '#ffe08a', 10);
      if (hooks.arrive) hooks.arrive(ch.id);
      if (![...chars.values()].some((c) => c.state === 'run')) {
        focus(to);
        if (hooks.arrivedAll) hooks.arrivedAll(to);
      }
    };
    ch.locked = false;
    ch.verdict = null;
  }

  // Which contender's table is under this screen point (or null)?
  function tableAt(clientX, clientY) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const wx = (clientX - rect.left - W / 2) / cam.s + cam.x;
    const wy = (clientY - rect.top - H / 2) / cam.s + cam.y;
    for (const room of rooms) {
      for (const tb of room.tables) {
        const owner = tb.owner ? chars.get(tb.owner) : null;
        if (owner && !owner.dead && Math.abs(wx - tb.x) < 48 && wy > tb.y - 76 && wy < tb.y + 38) return owner.id;
      }
    }
    return null;
  }

  function setMe(id) {
    meId = id;
  }

  // An emoji pops up over someone's table (or over them, if they are on the move).
  function react(id, emoji) {
    const ch = chars.get(id);
    if (!ch || reduceMotion) return;
    floaters.push({ x: ch.x + rand(-14, 14), y: ch.y - (ch.state === 'run' ? 96 : 104), text: emoji, born: nowT, life: 1.9, emoji: true });
  }

  // A speech bubble, used for the computer players' banter.
  function say(id, text) {
    const ch = chars.get(id);
    if (!ch) return;
    ch.say = { text: String(text).slice(0, 34), until: nowT + 3.4 };
  }

  function setFans(counts) {
    fans = counts || {};
  }

  function aliveCount() {
    let n = 0;
    chars.forEach((c) => { if (c.alive) n += 1; });
    return n;
  }

  /* ------------------------------------------------------------- effects */

  function burst(x, y, color, n) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(40, 200);
      dust.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0, max: rand(0.5, 1.1), r: rand(1.5, 3.5), color, g: 260 });
    }
  }

  function stepDust(ch, dt) {
    ch.dustT -= dt;
    if (ch.dustT <= 0) {
      ch.dustT = 0.07;
      dust.push({ x: ch.x - ch.dir * 8, y: ch.y - 2, vx: -ch.dir * rand(10, 40), vy: rand(-30, -8), life: 0, max: rand(0.35, 0.6), r: rand(2, 4), color: '#d9d2c2', g: 0 });
    }
  }

  /* ------------------------------------------------------------- drawing */

  function drawHair(ch, hx, hy, r, col, front) {
    ctx.fillStyle = col;
    const s = ch.look.style;
    if (s === 1 && !front) {
      rr(hx - r - 2, hy - 2, r * 2 + 4, r * 2.2, r * 0.8);
      ctx.fill();
      return;
    }
    if (!front) return;
    ctx.beginPath();
    ctx.arc(hx, hy - 1, r + 1, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    if (s === 2) {
      ctx.beginPath();
      ctx.arc(hx, hy - r - 3, r * 0.42, 0, TAU);
      ctx.fill();
    } else if (s === 3) {
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(hx + i * 4 - 2.5, hy - r + 1);
        ctx.lineTo(hx + i * 4, hy - r - 6);
        ctx.lineTo(hx + i * 4 + 2.5, hy - r + 1);
        ctx.fill();
      }
    }
  }

  function faceFront(ch, hx, hy, r, mood, t) {
    const dark = ch.dead ? '#3a3d4a' : '#1b1414';
    const blink = ((t + ch.ph) % 4.2) < 0.12;
    ctx.strokeStyle = dark;
    ctx.fillStyle = dark;
    ctx.lineWidth = 1.6;
    if (ch.dead) {
      for (const dx of [-4, 4]) {
        ctx.beginPath();
        ctx.moveTo(hx + dx - 2, hy - 3);
        ctx.lineTo(hx + dx + 2, hy + 1);
        ctx.moveTo(hx + dx + 2, hy - 3);
        ctx.lineTo(hx + dx - 2, hy + 1);
        ctx.stroke();
      }
    } else if (blink) {
      ctx.beginPath();
      ctx.moveTo(hx - 6, hy - 1);
      ctx.lineTo(hx - 2, hy - 1);
      ctx.moveTo(hx + 2, hy - 1);
      ctx.lineTo(hx + 6, hy - 1);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(hx - 4, hy - 1, 1.5, 0, TAU);
      ctx.arc(hx + 4, hy - 1, 1.5, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    if (mood === 'happy') ctx.arc(hx, hy + 2, 4, 0.1 * Math.PI, 0.9 * Math.PI);
    else if (mood === 'sad' || ch.dead) ctx.arc(hx, hy + 8, 3.5, 1.15 * Math.PI, 1.85 * Math.PI);
    else {
      ctx.moveTo(hx - 3, hy + 5);
      ctx.lineTo(hx + 3, hy + 5);
    }
    ctx.stroke();
  }

  function badge(ch, x, y) {
    const fs = fontSize(17);
    ctx.font = `${fs}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = ch.dead ? 0.55 : 1;
    ctx.fillText(ch.emoji, x, y);
    ctx.globalAlpha = 1;
  }

  function drawSeated(ch, t) {
    const x = ch.x;
    const y = ch.y;
    const dead = ch.dead;
    const c = (hex) => (dead ? mix(hex, '#8a8d9c', 0.8) : hex);
    const popK = ch.pop ? clamp((nowT - ch.pop) / 0.35, 0, 1) : 1;
    const cheering = ch.cheerUntil > nowT;
    let bob = dead ? 0 : Math.sin(t * 1.7 + ch.ph) * 1.2;
    if (cheering) bob = -Math.abs(Math.sin(t * 10)) * 6;
    const slump = ch.slump || dead;
    const headDy = slump ? 9 : 0;
    const lean = slump ? (dead ? -3 : 2) : 0;

    ctx.save();
    ctx.translate(x, y);
    if (popK < 1) ctx.scale(1, 0.85 + 0.15 * popK);

    // chair back
    ctx.fillStyle = c('#171c3a');
    rr(-21, -62, 42, 54, 9);
    ctx.fill();
    ctx.fillStyle = c(STAGE_LOOK[clamp(ch.stage, 0, 3)].accent);
    ctx.globalAlpha = 0.5;
    rr(-21, -62, 42, 5, 3);
    ctx.fill();
    ctx.globalAlpha = 1;

    // arms behind the torso for cheering
    const shirt = c(ch.look.shirt);
    if (cheering) {
      ctx.strokeStyle = shirt;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      const sw = Math.sin(t * 12) * 4;
      ctx.beginPath();
      ctx.moveTo(-14, -38 + bob);
      ctx.lineTo(-24 + sw, -82 + bob);
      ctx.moveTo(14, -38 + bob);
      ctx.lineTo(24 - sw, -82 + bob);
      ctx.stroke();
      ctx.fillStyle = c(ch.look.skin);
      ctx.beginPath();
      ctx.arc(-24 + sw, -84 + bob, 4.2, 0, TAU);
      ctx.arc(24 - sw, -84 + bob, 4.2, 0, TAU);
      ctx.fill();
    }

    // torso
    const tg = ctx.createLinearGradient(0, -46, 0, -4);
    tg.addColorStop(0, shirt);
    tg.addColorStop(1, mix(ch.look.shirt, '#000000', dead ? 0.45 : 0.28));
    ctx.fillStyle = tg;
    rr(-15 + lean, -46 + bob + headDy * 0.35, 30, 42, 11);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    rr(-15 + lean, -46 + bob + headDy * 0.35, 30, 6, 4);
    ctx.fill();

    // hair (back), neck, head
    const hx = lean * 0.6;
    const hy = -57 + bob + headDy;
    drawHair(ch, hx, hy, 11, c(ch.look.hair), false);
    ctx.fillStyle = c(ch.look.skin);
    ctx.fillRect(hx - 3, hy + 8, 6, 8);
    ctx.beginPath();
    ctx.arc(hx, hy, 11, 0, TAU);
    ctx.fill();
    drawHair(ch, hx, hy, 11, c(ch.look.hair), true);
    faceFront(ch, hx, hy, 11, cheering || ch.verdict === 'right' ? 'happy' : slump ? 'sad' : 'flat', t);

    // arms on the table
    if (!cheering) {
      ctx.strokeStyle = shirt;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      const typing = !dead && !ch.locked && phase === 'question';
      const press = ch.pressUntil > nowT;
      const wl = typing ? Math.sin(t * 14 + ch.ph) * 2.5 : 0;
      const wr = typing ? Math.cos(t * 13 + ch.ph) * 2.5 : press ? 5 : 0;
      ctx.beginPath();
      ctx.moveTo(-14 + lean, -36 + bob);
      ctx.quadraticCurveTo(-24, -14, -17, 2 + wl);
      ctx.moveTo(14 + lean, -36 + bob);
      ctx.quadraticCurveTo(24, -14, 17, 2 + wr);
      ctx.stroke();
      ctx.fillStyle = c(ch.look.skin);
      ctx.beginPath();
      ctx.arc(-17, 3 + wl, 3.8, 0, TAU);
      ctx.arc(17, 3 + wr, 3.8, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTable(t, ch, tm, stage) {
    const x = t.x;
    const y = t.y;
    const accent = STAGE_LOOK[clamp(stage, 0, 3)].accent;
    const dead = ch && ch.dead;
    const rise = clamp((nowT - t.born) / 0.5, 0, 1);
    if (rise <= 0) return;
    ctx.save();
    ctx.translate(x, y + (1 - easeOut(rise)) * 30);
    ctx.globalAlpha = rise;

    // floor light pool
    const lg = ctx.createRadialGradient(0, 30, 4, 0, 30, 70);
    lg.addColorStop(0, dead ? 'rgba(255,60,60,0.22)' : ch && ch.locked ? 'rgba(255,224,138,0.3)' : 'rgba(255,255,255,0.14)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(-80, -10, 160, 90);

    // top surface
    const top = ctx.createLinearGradient(0, -4, 0, 12);
    top.addColorStop(0, dead ? '#5a5d6b' : '#9b6b3f');
    top.addColorStop(1, dead ? '#3b3e4a' : '#6b431f');
    ctx.fillStyle = top;
    rr(-44, -4, 88, 16, 5);
    ctx.fill();
    // front panel
    const fg = ctx.createLinearGradient(0, 10, 0, 34);
    fg.addColorStop(0, dead ? '#2a2c38' : '#16204d');
    fg.addColorStop(1, dead ? '#1a1b24' : '#0a1030');
    ctx.fillStyle = fg;
    rr(-44, 10, 88, 25, 6);
    ctx.fill();
    ctx.strokeStyle = dead ? '#7a1f2a' : accent;
    ctx.lineWidth = 1.6;
    rr(-44, 10, 88, 25, 6);
    ctx.stroke();

    // laptop
    ctx.fillStyle = '#0b0d1a';
    rr(-14, -18, 28, 17, 3);
    ctx.fill();
    if (!dead) {
      ctx.fillStyle = ch && ch.verdict === 'right' ? '#3ee08f' : ch && ch.verdict === 'wrong' ? '#ff5470' : ch && ch.locked ? '#ffe08a' : accent;
      ctx.globalAlpha = rise * (0.55 + 0.25 * Math.sin(tm * 4 + x));
      rr(-12, -16, 24, 13, 2);
      ctx.fill();
      ctx.globalAlpha = rise;
    }

    // team colour stripe + supporters
    if (ch && ch.team !== null && ch.team !== undefined) {
      ctx.fillStyle = TEAM_COLORS[ch.team % TEAM_COLORS.length];
      rr(-44, 10, 7, 25, 3);
      ctx.fill();
    }
    if (ch && fans[ch.id] > 0 && !dead) {
      ctx.fillStyle = '#ff5c8a';
      rr(20, -30, 30, 15, 7);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${fontSize(10)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`❤ ${fans[ch.id]}`, 35, -22);
    }

    // lock lamp
    ctx.fillStyle = dead ? '#7a1f2a' : ch && ch.locked ? '#ffd23f' : '#3a405e';
    ctx.beginPath();
    ctx.arc(34, 4, 4.5, 0, TAU);
    ctx.fill();
    if (ch && ch.locked && !dead) {
      ctx.fillStyle = 'rgba(255,210,63,0.35)';
      ctx.beginPath();
      ctx.arc(34, 4, 9 + Math.sin(tm * 8) * 2, 0, TAU);
      ctx.fill();
    }

    // nameplate
    if (ch) {
      const fs = fontSize(12);
      ctx.font = `700 ${fs}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = dead ? '#9a9dab' : ch.id === meId ? '#ffe08a' : '#ffffff';
      let label = ch.name.length > 8 ? ch.name.slice(0, 7) + '…' : ch.name;
      ctx.fillText(label, 0, 18);
      let sub = '';
      if (dead) sub = ch.place ? `OUT · #${ch.place}` : 'OUT';
      else if (ch.choice) sub = `${ch.choice} ${ch.verdict === 'right' ? '✓' : '✗'}`;
      else if (ch.locked) sub = `${(ch.ms / 1000).toFixed(1)}s`;
      else if (ch.sleeping) sub = 'zzz';
      if (sub) {
        ctx.font = `700 ${fontSize(10)}px system-ui, sans-serif`;
        ctx.fillStyle = dead ? '#ff5470' : ch.verdict === 'wrong' ? '#ff8095' : ch.verdict === 'right' ? '#3ee08f' : '#ffe08a';
        ctx.fillText(sub, 0, 30);
      }
      // fastest-finger rank chip
      if (ch.locked && ch.order && !dead) {
        ctx.fillStyle = ch.order === 1 ? '#ffd23f' : '#c9d3ff';
        ctx.beginPath();
        ctx.arc(-34, 3, 8, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#2a1b00';
        ctx.font = `800 ${fontSize(11)}px system-ui, sans-serif`;
        ctx.fillText(String(ch.order), -34, 4);
      }
    }
    ctx.restore();
  }

  function drawWalker(ch, t) {
    const x = ch.x;
    const y = ch.y;
    const d = ch.dir || 1;
    const sw = Math.sin(ch.walkT);
    const shirt = ch.look.shirt;
    ctx.save();
    ctx.translate(x, y);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 15, 4, 0, 0, TAU);
    ctx.fill();
    const bob = Math.abs(Math.cos(ch.walkT)) * 2.5;
    ctx.lineCap = 'round';
    // back leg + arm
    ctx.strokeStyle = '#1b2140';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(0, -26 - bob);
    ctx.lineTo(-sw * 13 * d, -3);
    ctx.stroke();
    ctx.strokeStyle = mix(shirt, '#000000', 0.25);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, -50 - bob);
    ctx.lineTo(sw * 14 * d, -30 - bob);
    ctx.stroke();
    // torso
    const tg = ctx.createLinearGradient(0, -56, 0, -24);
    tg.addColorStop(0, shirt);
    tg.addColorStop(1, mix(shirt, '#000000', 0.3));
    ctx.fillStyle = tg;
    ctx.save();
    ctx.translate(d * 3, 0);
    rr(-9, -56 - bob, 18, 32, 8);
    ctx.fill();
    ctx.restore();
    // front leg
    ctx.strokeStyle = '#242b57';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(0, -26 - bob);
    ctx.lineTo(sw * 13 * d, -3);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sw * 13 * d - 4 + (d > 0 ? 1 : -3), -5, 7, 5);
    // front arm
    ctx.strokeStyle = shirt;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(d * 3, -50 - bob);
    ctx.lineTo(-sw * 14 * d + d * 3, -30 - bob);
    ctx.stroke();
    // head
    const hx = d * 4;
    const hy = -66 - bob;
    ctx.fillStyle = ch.look.hair;
    if (ch.look.style === 1) {
      rr(hx - (d > 0 ? 13 : 4), hy - 2, 17, 22, 7);
      ctx.fill();
    }
    ctx.fillStyle = ch.look.skin;
    ctx.beginPath();
    ctx.arc(hx, hy, 10, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ch.look.hair;
    ctx.beginPath();
    ctx.arc(hx, hy - 1, 10.6, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1414';
    ctx.beginPath();
    ctx.arc(hx + d * 5, hy, 1.5, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#fff';
    badge(ch, x, y - 92 - bob);
    ctx.restore();
  }

  function drawDropper(ch, t) {
    const k = clamp((nowT - ch.dropStart) / 2.2, 0, 1);
    if (nowT < ch.dropStart) return;
    const seatY = ch.y;
    const e = easeOut(k);
    const y = seatY + (ch.dropFrom || -320) * (1 - e);
    const sway = Math.sin(t * 2.2 + ch.ph) * 8 * (1 - k);
    const x = ch.x + sway;
    ctx.save();
    ctx.translate(x, y);
    const open = 1 - clamp((k - 0.82) / 0.18, 0, 1);
    if (open > 0.02) {
      const pw = 46 * open;
      const py = -104;
      ctx.globalAlpha = open;
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 ? '#f1ece0' : ch.look.shirt;
        ctx.beginPath();
        ctx.moveTo(-pw + (2 * pw * i) / 5, py);
        ctx.quadraticCurveTo(-pw + (2 * pw * (i + 0.5)) / 5, py - 42 * open, -pw + (2 * pw * (i + 1)) / 5, py);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(240,240,220,0.7)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        ctx.beginPath();
        ctx.moveTo(-pw + (2 * pw * i) / 5, py);
        ctx.lineTo(i < 3 ? -8 : 8, -40);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // dangling figure
    ctx.strokeStyle = ch.look.shirt;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-8, -38);
    ctx.lineTo(-10, -66);
    ctx.moveTo(8, -38);
    ctx.lineTo(10, -66);
    ctx.stroke();
    ctx.fillStyle = ch.look.shirt;
    rr(-10, -46, 20, 30, 8);
    ctx.fill();
    ctx.strokeStyle = '#242b57';
    ctx.beginPath();
    ctx.moveTo(-4, -18);
    ctx.lineTo(-6 + Math.sin(t * 5 + ch.ph) * 3, 4);
    ctx.moveTo(4, -18);
    ctx.lineTo(6 - Math.sin(t * 5 + ch.ph) * 3, 4);
    ctx.stroke();
    ctx.fillStyle = ch.look.skin;
    ctx.beginPath();
    ctx.arc(0, -56, 10, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ------------------------------------------------------------ the world */

  function drawRoom(i, t) {
    const rx = roomX(i);
    const look = STAGE_LOOK[clamp(i, 0, 3)];
    // floor
    const fg = ctx.createLinearGradient(0, 90, 0, RH);
    fg.addColorStop(0, look.floorA);
    fg.addColorStop(1, look.floorB);
    ctx.fillStyle = fg;
    ctx.fillRect(rx, 90, RW, RH - 90);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let py = 108; py < RH; py += 26) {
      ctx.moveTo(rx, py);
      ctx.lineTo(rx + RW, py);
    }
    ctx.stroke();
    // back wall
    const wg = ctx.createLinearGradient(0, 0, 0, 92);
    wg.addColorStop(0, look.wall);
    wg.addColorStop(1, mix(look.wall, '#000000', 0.25));
    ctx.fillStyle = wg;
    ctx.fillRect(rx, 0, RW, 92);
    ctx.fillStyle = look.accent;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(rx, 88, RW, 4);
    ctx.globalAlpha = 1;

    // the big wall screen: level name + sub-level progress
    const sx = rx + RW / 2 - 150;
    ctx.fillStyle = '#04081c';
    rr(sx, 12, 300, 66, 8);
    ctx.fill();
    ctx.strokeStyle = look.accent;
    ctx.lineWidth = 2.4;
    rr(sx, 12, 300, 66, 8);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = look.accent;
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillText(`LEVEL ${i + 1} OF ${plan.count}`, rx + RW / 2, 27);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.fillText(String(plan.names[i] || `Level ${i + 1}`).toUpperCase(), rx + RW / 2, 50);
    const done = i < activeStage ? dotsFor(i) : stageProgress[i] || 0;
    const dots = dotsFor(i);
    for (let d = 0; d < dots; d++) {
      const dx = rx + RW / 2 + (d - (dots - 1) / 2) * 22;
      const isDone = d < done;
      const isNow = i === activeStage && d === done && phase !== 'transition';
      ctx.fillStyle = isDone ? '#3ee08f' : isNow ? '#ffd23f' : 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(dx, 68, isNow ? 5 + Math.sin(t * 6) : 4, 0, TAU);
      ctx.fill();
    }

    // ceiling spotlights on the floor
    ctx.globalCompositeOperation = 'lighter';
    for (let s = 0; s < 3; s++) {
      const cx = rx + RW * (0.2 + s * 0.3) + Math.sin(t * 0.6 + s * 2) * 20;
      const g = ctx.createRadialGradient(cx, 180, 0, cx, 180, 150);
      g.addColorStop(0, 'rgba(255,255,255,0.10)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 150, 90, 300, 250);
    }
    ctx.globalCompositeOperation = 'source-over';

    // walls & doorway openings
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(rx, 92);
    ctx.lineTo(rx, DOOR_Y - 36);
    ctx.moveTo(rx, DOOR_Y + 36);
    ctx.lineTo(rx, RH);
    ctx.moveTo(rx + RW, 92);
    ctx.lineTo(rx + RW, DOOR_Y - 36);
    ctx.moveTo(rx + RW, DOOR_Y + 36);
    ctx.lineTo(rx + RW, RH);
    ctx.moveTo(rx, RH);
    ctx.lineTo(rx + RW, RH);
    ctx.stroke();
  }

  function drawCorridor(i, t) {
    const x0 = roomX(i) + RW;
    const x1 = roomX(i + 1);
    const g = ctx.createLinearGradient(0, DOOR_Y - 36, 0, DOOR_Y + 36);
    g.addColorStop(0, '#1a2050');
    g.addColorStop(1, '#0d1130');
    ctx.fillStyle = g;
    ctx.fillRect(x0, DOOR_Y - 36, x1 - x0, 72);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x0, DOOR_Y - 36);
    ctx.lineTo(x1, DOOR_Y - 36);
    ctx.moveTo(x0, DOOR_Y + 36);
    ctx.lineTo(x1, DOOR_Y + 36);
    ctx.stroke();
    // running-route chevrons, like a marked path on a map
    const lit = i < reachedStage;
    ctx.strokeStyle = lit ? '#ffe08a' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 3;
    const off = (t * 40) % 30;
    for (let cx = x0 + 10 + off; cx < x1 - 16; cx += 30) {
      ctx.beginPath();
      ctx.moveTo(cx, DOOR_Y - 10);
      ctx.lineTo(cx + 9, DOOR_Y);
      ctx.lineTo(cx, DOOR_Y + 10);
      ctx.stroke();
    }
  }

  function drawRoomOverlay(i, t) {
    const rx = roomX(i);
    if (i > reachedStage) {
      ctx.fillStyle = 'rgba(4,6,20,0.62)';
      ctx.fillRect(rx, 0, RW, RH);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '800 54px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔒', rx + RW / 2, 190);
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillText('LOCKED', rx + RW / 2, 240);
    } else if (i < activeStage || (phase === 'transition' && i === (storm && storm.stage))) {
      const stormy = storm && storm.stage === i;
      ctx.fillStyle = stormy ? 'rgba(160,20,30,0.30)' : 'rgba(4,6,20,0.42)';
      ctx.fillRect(rx, 0, RW, RH);
      if (stormy) {
        ctx.strokeStyle = `rgba(255,70,70,${0.4 + 0.3 * Math.sin(t * 8)})`;
        ctx.lineWidth = 8;
        ctx.strokeRect(rx + 4, 4, RW - 8, RH - 8);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 2;
        for (let s = -RH; s < RW; s += 26) {
          ctx.beginPath();
          ctx.moveTo(rx + s + ((t * 60) % 26), 0);
          ctx.lineTo(rx + s + RH + ((t * 60) % 26), RH);
          ctx.stroke();
        }
        if (Math.random() < 0.05) {
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.fillRect(rx, 0, RW, RH);
        }
      }
    }
  }

  function drawWorld(t, dt) {
    for (let i = 0; i < plan.count - 1; i++) drawCorridor(i, t);
    for (let i = 0; i < plan.count; i++) drawRoom(i, t);

    // entities sorted by depth: seated people + their tables, and runners
    const ents = [];
    rooms.forEach((room, ri) => {
      room.tables.forEach((tb) => {
        const owner = tb.owner ? chars.get(tb.owner) : null;
        const sitting = owner && (owner.state === 'sit' || owner.state === 'dead' || owner.state === 'drop');
        ents.push({ y: tb.y, kind: 'table', tb, owner: sitting ? owner : null, ri });
      });
    });
    chars.forEach((ch) => {
      if (ch.state === 'run') ents.push({ y: ch.y, kind: 'walker', ch });
    });
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) {
      if (e.kind === 'walker') drawWalker(e.ch, t);
      else {
        const o = e.owner;
        if (o && o.state !== 'drop') drawSeated(o, t);
        drawTable(e.tb, o || (e.tb.owner ? chars.get(e.tb.owner) : null), t, e.ri);
        if (o) {
          ctx.save();
          if (o.id === meId && !o.dead) {
            ctx.strokeStyle = '#ffe08a';
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 4);
            ctx.beginPath();
            ctx.ellipse(e.tb.x, e.tb.y + 40, 52, 10, 0, 0, TAU);
            ctx.stroke();
          }
          ctx.restore();
          if (o.state !== 'drop') {
            ctx.fillStyle = '#fff';
            badge(o, o.x, o.y - 80 + (o.cheerUntil > nowT ? -8 : 0));
            if (o.id === meId) {
              ctx.font = `800 ${fontSize(9)}px system-ui, sans-serif`;
              ctx.fillStyle = '#ffe08a';
              ctx.fillText('YOU', o.x, o.y - 98);
            }
          }
        }
      }
    }
    chars.forEach((ch) => {
      if (ch.state === 'drop') drawDropper(ch, t);
    });

    for (let i = 0; i < plan.count; i++) drawRoomOverlay(i, t);

    // speech bubbles (bot banter)
    chars.forEach((ch) => {
      if (!ch.say || ch.say.until < nowT || ch.state === 'drop') return;
      const bx = ch.x;
      const by = ch.y - (ch.state === 'run' ? 112 : 122);
      const fs = fontSize(11);
      ctx.font = `700 ${fs}px system-ui, "Apple Color Emoji", sans-serif`;
      const w = Math.min(190, ctx.measureText(ch.say.text).width + 18);
      const pop = clamp((nowT - (ch.say.until - 3.4)) / 0.2, 0, 1);
      const a = ch.say.until - nowT < 0.4 ? (ch.say.until - nowT) / 0.4 : 1;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(bx, by);
      ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
      ctx.fillStyle = '#ffffff';
      rr(-w / 2, -fs - 8, w, fs + 14, 9);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-5, 5);
      ctx.lineTo(0, 12);
      ctx.lineTo(5, 5);
      ctx.fill();
      ctx.fillStyle = '#12163a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch.say.text, 0, -fs / 2 - 1);
      ctx.restore();
    });

    // effects
    for (let i = dust.length - 1; i >= 0; i--) {
      const p = dust[i];
      p.life += dt;
      if (p.life >= p.max) {
        dust.splice(i, 1);
        continue;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      const k = (nowT - f.born) / f.life;
      if (k >= 1) {
        floaters.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.textAlign = 'center';
      if (f.emoji) {
        ctx.font = `${fontSize(26) * (1 + 0.25 * Math.sin(k * 9))}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.fillText(f.text, f.x + Math.sin(k * 8) * 6, f.y - k * 46);
        continue;
      }
      ctx.fillStyle = f.color;
      ctx.font = `800 ${fontSize(f.big ? 20 : 18)}px system-ui, sans-serif`;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.strokeText(f.text, f.x, f.y - k * 34);
      ctx.fillText(f.text, f.x, f.y - k * 34);
    }
    ctx.globalAlpha = 1;
  }

  // The closing safe zone: everything outside the next room is storm.
  function drawZone(t) {
    if (!zone) return;
    const k = clamp((nowT - zone.start) / zone.dur, 0, 1);
    const wx = roomX(zone.stage) + RW / 2;
    const wy = RH / 2;
    const sx = (wx - cam.x) * cam.s + W / 2;
    const sy = (wy - cam.y) * cam.s + H / 2;
    const big = Math.hypot(W, H) * 1.3;
    const small = Math.max(RW * cam.s * 0.62, 60);
    const r = big + (small - big) * easeOut(k);
    ctx.save();
    ctx.fillStyle = 'rgba(40,90,255,0.26)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.arc(sx, sy, r, 0, TAU, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.3 * Math.sin(t * 6)})`;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#6aa8ff';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function update(dt) {
    // camera
    if (phase === 'transition') {
      const runners = [...chars.values()].filter((c) => c.state === 'run');
      if (runners.length) {
        const ax = runners.reduce((n, c) => n + c.x, 0) / runners.length;
        cam.tx = ax;
        cam.ty = RH / 2 + 30;
        cam.ts = Math.min(W / 640, fitScale() * 0.95);
      }
    }
    const k = Math.min(1, dt * 3.2);
    cam.x += (cam.tx - cam.x) * k;
    cam.y += (cam.ty - cam.y) * k;
    cam.s += (cam.ts - cam.s) * k;

    chars.forEach((ch) => {
      if (ch.state === 'drop' && nowT >= ch.dropStart + 2.2) {
        ch.state = 'sit';
        ch.pop = nowT;
        burst(ch.x, ch.y - 10, '#d9d2c2', 12);
        if (hooks.land) hooks.land(ch.id);
      }
      if (ch.state === 'run' && ch.path && ch.path.length) {
        const wp = ch.path[0];
        const dx = wp.x - ch.x;
        const dy = wp.y - ch.y;
        const dist = Math.hypot(dx, dy);
        const step = ch.speed * dt;
        if (Math.abs(dx) > 4) ch.dir = dx > 0 ? 1 : -1;
        ch.walkT += dt * 15;
        stepDust(ch, dt);
        if (dist <= step) {
          ch.x = wp.x;
          ch.y = wp.y;
          ch.path.shift();
          if (!ch.path.length && ch.arrive) ch.arrive();
        } else {
          ch.x += (dx / dist) * step;
          ch.y += (dy / dist) * step;
        }
      }
    });
  }

  function draw(t, dt) {
    if (!ctx) return;
    nowT = t;
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#050b2e');
    bg.addColorStop(1, '#02061c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // faint map grid behind the world
    ctx.strokeStyle = 'rgba(120,170,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 0; gx < W; gx += 32) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
    for (let gy = 0; gy < H; gy += 32) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
    ctx.stroke();

    update(dt);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.s, cam.s);
    ctx.translate(-cam.x, -cam.y);
    drawWorld(t, dt);
    ctx.restore();
    drawZone(t);

    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------------------------------------------------------------- loop */

  function loop(now) {
    if (!running) return;
    const t = now / 1000;
    const dt = Math.min(0.05, Math.max(0, t - last));
    last = t;
    draw(t, dt);
    requestAnimationFrame(loop);
  }

  function resize() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (overview) showOverview();
    else focus(activeStage, true);
    draw(performance.now() / 1000, 0);
  }

  function start() {
    if (!canvas || running) return;
    resize();
    if (reduceMotion || document.hidden) return;
    running = true;
    last = performance.now() / 1000;
    requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
  }

  function mount(el, h) {
    canvas = el;
    hooks = h || {};
    ctx = canvas.getContext('2d');
    setPlan(plan);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);
    canvas.addEventListener('click', (e) => {
      // tapping a contender's table (for a spectator) cheers for them; anything else toggles the full-map view
      const id = tableAt(e.clientX, e.clientY);
      if (id && hooks.tableTap && hooks.tableTap(id)) return;
      toggleOverview();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) running = false;
      else if (canvas.offsetParent !== null) start();
    });
  }

  return { mount, start, stop, resize, startMatch, startQuestion, lock, reveal, transition, setMe, react, say, setFans, tableAt, aliveCount, toggleOverview };
})();
