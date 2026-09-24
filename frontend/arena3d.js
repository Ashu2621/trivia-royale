/*
 * Arena3D — the Hot Seat studio in real 3D (Three.js).
 *
 * Same job and same public API as the 2D Arena (arena2d.js): every level is a room laid out
 * along a route, every contestant stands at their own game-show desk. When a level ends the
 * storm closes on the room — the weakest collapse, the survivors run down the corridor to the
 * next room — and now it all happens in a lit 3D studio with a rigged soldier avatar per player,
 * glossy floors, truss spotlights, a big LED wall screen and a closing-zone finale.
 * Falls back to the 2D renderer when WebGL isn't available.
 */
const Arena3D = (function () {
  'use strict';

  const T = THREE;
  if (T.ColorManagement) T.ColorManagement.legacyMode = false;

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  const angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const mobile = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || Math.min(screen.width, screen.height) < 700;

  // ---- world geometry (same numbers as the 2D map; x = along the route, y = depth, y=90 is the back wall) ----
  const RW = 560;
  const RH = 340;
  const CORR = 170;
  const PAD = 40;
  const DOOR_Y = 302;
  const WALL_Y = 90;
  const roomX = (i) => PAD + i * (RW + CORR);
  const SOLDIER_SCALE = 35; // ~64 units tall

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
  let overlay = null;
  let octx = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let dprMax = mobile ? 1.5 : 2;
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
  let storm = null;
  let zone = null;
  let rooms = [];
  const chars = new Map();
  const floaters = [];
  const timeouts = [];
  const cam = { x: 0, y: RH / 2, s: 1, tx: 0, ty: RH / 2, ts: 1 };
  let nowT = 0;
  let curSub = 0;
  let fans = {};
  let quality = null;

  // 3D objects
  let world = null;
  let roomObjs = [];
  let corrObjs = [];
  const tableObjs = new Map();
  const charObjs = new Map();
  let particles = [];
  let soldierGLTF = null;
  let modelWait = Promise.resolve();
  let shadowTex = null;
  let glowTex = null;
  let coneTex = null;
  const matCache = new Map();
  let lightning = 0;
  let camPitch = 0.62;

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
    return { skin: SKIN[h % SKIN.length], hair: HAIR[(h >> 3) % HAIR.length], style: (h >> 6) % 4, shirt: SHIRT[(h >> 9) % SHIRT.length] };
  }

  function later(ms, fn) {
    const id = setTimeout(fn, ms);
    timeouts.push(id);
    return id;
  }
  function clearLater() {
    while (timeouts.length) clearTimeout(timeouts.pop());
  }

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
      state: 'sit',
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

  /* -------------------------------------------------------------- public */

  function setPlan(p) {
    if (p && p.count) plan = p;
    rooms = Array.from({ length: plan.count }, () => ({ tables: [], built: false }));
    stageProgress = new Array(plan.count).fill(0);
    rebuildStudio();
  }

  function startMatch(players, p, opts) {
    const o = opts || {};
    clearLater();
    setPlan(p);
    chars.clear();
    clearCharObjs();
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
      ch.deadAt = -10;
    });

    alive.forEach((pl, i) => {
      const ch = chars.get(pl.playerId);
      seatChar(ch);
      if (o.drop && !reduceMotion) {
        ch.state = 'drop';
        ch.dropStart = nowT + 0.15 + i * 0.13;
        ch.dropDelay = ch.dropStart;
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
        floaters.push({ x: ch.x, z: ch.y, h: 84, text: '✓', color: '#3ee08f', born: nowT, life: 1.6 });
        burst(ch.x, ch.y, 60, '#3ee08f', 14, 60);
      } else {
        ch.verdict = 'wrong';
        ch.slump = true;
        floaters.push({ x: ch.x, z: ch.y, h: 84, text: '✗', color: '#ff5470', born: nowT, life: 1.6 });
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
          burst(ch.x, ch.y, 46, '#ff3d3d', 30, 130);
          floaters.push({ x: ch.x, z: ch.y, h: 96, text: `#${e.place} OUT`, color: '#ff5470', born: nowT, life: 2.6, big: true });
          lightning = nowT + 0.25;
          if (hooks.eliminated) hooks.eliminated(e.playerId, e.place);
        });
      });
    });

    buildRoom(next, advancing, false, nowT + 1.4);
    reachedStage = next;

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
      burst(seat.x, seat.y, 20, '#ffe08a', 14, 90);
      if (hooks.arrive) hooks.arrive(ch.id);
      if (![...chars.values()].some((c) => c.state === 'run')) {
        focus(to);
        if (hooks.arrivedAll) hooks.arrivedAll(to);
      }
    };
    ch.locked = false;
    ch.verdict = null;
    ch.choice = null;
  }

  const raycaster = new T.Raycaster();
  function tableAt(clientX, clientY) {
    if (!canvas || !camera) return null;
    const rect = canvas.getBoundingClientRect();
    const ndc = new T.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const o = raycaster.ray.origin;
    const d = raycaster.ray.direction;
    if (d.y >= -1e-4) return null;
    const t = (28 - o.y) / d.y; // chest height
    const wx = o.x + d.x * t;
    const wz = o.z + d.z * t;
    for (const room of rooms) {
      for (const tb of room.tables) {
        const owner = tb.owner ? chars.get(tb.owner) : null;
        if (owner && !owner.dead && Math.abs(wx - tb.x) < 50 && wz > tb.y - 46 && wz < tb.y + 26) return owner.id;
      }
    }
    return null;
  }

  function setMe(id) {
    meId = id;
  }

  function react(id, emoji) {
    const ch = chars.get(id);
    if (!ch || reduceMotion) return;
    floaters.push({ x: ch.x + rand(-14, 14), z: ch.y, h: 92, text: emoji, born: nowT, life: 1.9, emoji: true });
  }

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
    chars.forEach((c) => {
      if (c.alive) n += 1;
    });
    return n;
  }

  /* -------------------------------------------------------- 3D: helpers */

  const cv = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.round(w);
    c.height = Math.round(h);
    return c;
  };
  const tex = (c, opts) => {
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = quality ? quality.aniso : 1;
    if (opts && opts.repeat) {
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.repeat.set(opts.repeat[0], opts.repeat[1]);
    }
    return t;
  };
  function radialTex(stops, size) {
    const c = cv(size || 64, size || 64);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, c.width / 2);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr;
    g.fillRect(0, 0, c.width, c.height);
    return tex(c);
  }
  function std(color, rough, metal, extra) {
    const key = extra ? null : `${color}|${rough}|${metal}`;
    if (key && matCache.has(key)) return matCache.get(key);
    const m = new T.MeshStandardMaterial(Object.assign({ color, roughness: rough == null ? 0.7 : rough, metalness: metal || 0 }, extra));
    if (key) matCache.set(key, m);
    return m;
  }

  /* --------------------------------------------------- 3D: studio build */

  function ensureScene() {
    if (scene) return;
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(36, 1, 10, 6000);
    shadowTex = radialTex([[0, 'rgba(0,0,0,0.55)'], [0.6, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']]);
    glowTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
    {
      const c = cv(64, 256);
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 256);
      coneTex = tex(c);
    }
    scene.background = new T.Color('#02061c');
    scene.fog = new T.Fog(0x02061c, 1400, 4200);
    // studio reflections: a few bright light panels in a dark box
    try {
      const es = new T.Scene();
      es.background = new T.Color('#050a26');
      const panel = new T.MeshBasicMaterial({ color: 0xbfd4ff });
      [[0, 14, -12, 16, 3], [-14, 10, 4, 8, 3], [14, 10, 4, 8, 3], [0, 16, 10, 20, 2]].forEach(([x, y, z, w, d]) => {
        const m = new T.Mesh(new T.BoxGeometry(w, 0.6, d), panel);
        m.position.set(x, y, z);
        es.add(m);
      });
      const pm = new T.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(es, 0.03, 1, 80).texture;
      pm.dispose();
    } catch (e) {
      scene.environment = null;
    }
    const hemi = new T.HemisphereLight(0xaec6ff, 0x101838, 0.75);
    scene.add(hemi);
    const key = new T.DirectionalLight(0xdfe8ff, 1.6);
    key.position.set(200, 700, 700);
    key.castShadow = true;
    key.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    const sc = key.shadow.camera;
    sc.left = -420;
    sc.right = 420;
    sc.top = 320;
    sc.bottom = -320;
    sc.near = 100;
    sc.far = 2200;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 1.2;
    scene.add(key, key.target);
    const rim = new T.PointLight(0xffe4a0, 0.0, 700, 1.5);
    scene.add(rim);
    world = { hemi, key, rim, root: new T.Group() };
    scene.add(world.root);
    for (let i = 0; i < 140; i++) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0, blending: T.AdditiveBlending }));
      sp.visible = false;
      scene.add(sp);
      particles.push({ sp, v: new T.Vector3(), life: 0, max: 1, size: 8, grav: 0 });
    }
  }

  function floorCanvas(look) {
    const c = cv(1120, 500);
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 500);
    gr.addColorStop(0, look.floorA);
    gr.addColorStop(1, look.floorB);
    g.fillStyle = gr;
    g.fillRect(0, 0, 1120, 500);
    g.strokeStyle = 'rgba(255,255,255,0.09)';
    g.lineWidth = 2;
    for (let x = 0; x <= 1120; x += 70) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 500);
      g.stroke();
    }
    for (let y = 0; y <= 500; y += 62) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(1120, y);
      g.stroke();
    }
    // a big glowing emblem ring in the middle of the studio
    g.strokeStyle = look.accent;
    g.globalAlpha = 0.5;
    g.lineWidth = 6;
    g.beginPath();
    g.ellipse(560, 250, 350, 170, 0, 0, TAU);
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(560, 250, 300, 140, 0, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
    const rg = g.createRadialGradient(560, 250, 20, 560, 250, 420);
    rg.addColorStop(0, 'rgba(255,255,255,0.16)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 1120, 500);
    return c;
  }

  function wallCanvas(look) {
    const c = cv(1120, 240);
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 240);
    gr.addColorStop(0, look.wall);
    gr.addColorStop(1, '#040824');
    g.fillStyle = gr;
    g.fillRect(0, 0, 1120, 240);
    // hex panels
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 2;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 22; col++) {
        const x = col * 56 + (row % 2) * 28;
        const y = row * 34;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU;
          const px = x + Math.cos(a) * 18;
          const py = y + Math.sin(a) * 18;
          if (k) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.closePath();
        g.stroke();
      }
    }
    g.fillStyle = look.accent;
    g.globalAlpha = 0.85;
    g.fillRect(0, 228, 1120, 8);
    g.globalAlpha = 1;
    return c;
  }

  function buildStudio() {
    const root = world.root;
    roomObjs = [];
    corrObjs = [];
    for (let i = 0; i < plan.count; i++) {
      const look = STAGE_LOOK[clamp(i, 0, 3)];
      const rx = roomX(i);
      const grp = new T.Group();
      root.add(grp);
      // glossy floor
      const floorMat = new T.MeshStandardMaterial({ map: tex(floorCanvas(look)), roughness: 0.32, metalness: 0.45, envMapIntensity: 1.1 });
      const floor = new T.Mesh(new T.PlaneGeometry(RW, RH - WALL_Y), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(rx + RW / 2, 0, (WALL_Y + RH) / 2);
      floor.receiveShadow = true;
      grp.add(floor);
      // back wall
      const wallMat = new T.MeshStandardMaterial({ map: tex(wallCanvas(look)), roughness: 0.6, metalness: 0.15 });
      const wall = new T.Mesh(new T.BoxGeometry(RW, 120, 8), wallMat);
      wall.position.set(rx + RW / 2, 60, WALL_Y - 4);
      wall.receiveShadow = true;
      grp.add(wall);
      // LED wall screen (canvas redrawn when the progress changes)
      const sc = cv(600, 140);
      const stex = new T.CanvasTexture(sc);
      stex.encoding = T.sRGBEncoding;
      const screen = new T.Mesh(new T.PlaneGeometry(300, 70), new T.MeshBasicMaterial({ map: stex, toneMapped: false }));
      screen.position.set(rx + RW / 2, 66, WALL_Y + 0.5);
      grp.add(screen);
      const frame = new T.Mesh(new T.BoxGeometry(312, 82, 4), new T.MeshStandardMaterial({ color: 0x0a1030, emissive: new T.Color(look.accent), emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.5 }));
      frame.position.set(rx + RW / 2, 66, WALL_Y - 2.5);
      grp.add(frame);
      // side walls with the doorway gap, low front rail
      const sideMat = new T.MeshStandardMaterial({ color: 0x0c1440, roughness: 0.5, metalness: 0.3, emissive: new T.Color(look.accent), emissiveIntensity: 0.06 });
      const edge = new T.MeshBasicMaterial({ color: new T.Color(look.accent), transparent: true, opacity: 0.85, toneMapped: false });
      const piece = (x, z0, z1) => {
        const b = new T.Mesh(new T.BoxGeometry(6, 70, z1 - z0), sideMat);
        b.position.set(x, 35, (z0 + z1) / 2);
        b.castShadow = b.receiveShadow = true;
        grp.add(b);
        const e = new T.Mesh(new T.BoxGeometry(6.4, 2, z1 - z0), edge);
        e.position.set(x, 70.5, (z0 + z1) / 2);
        grp.add(e);
      };
      for (const x of [rx, rx + RW]) {
        piece(x, WALL_Y, DOOR_Y - 36);
        piece(x, DOOR_Y + 36, RH);
      }
      const rail = new T.Mesh(new T.BoxGeometry(RW, 10, 5), sideMat);
      rail.position.set(rx + RW / 2, 5, RH);
      grp.add(rail);
      const railGlow = new T.Mesh(new T.BoxGeometry(RW, 1.6, 5.4), edge);
      railGlow.position.set(rx + RW / 2, 10.5, RH);
      grp.add(railGlow);
      // truss with spotlight cones
      const truss = new T.Mesh(new T.BoxGeometry(RW - 40, 5, 5), std(0x1a2352, 0.4, 0.7));
      truss.position.set(rx + RW / 2, 190, 150);
      grp.add(truss);
      const cones = [];
      for (let s = 0; s < 4; s++) {
        const x = rx + RW * (0.14 + s * 0.24);
        const fix = new T.Mesh(new T.CylinderGeometry(5, 8, 12, 10), std(0x10163a, 0.4, 0.7));
        fix.position.set(x, 186, 150);
        grp.add(fix);
        const cone = new T.Mesh(new T.ConeGeometry(70, 190, 24, 1, true), new T.MeshBasicMaterial({ map: coneTex, color: new T.Color(look.accent).lerp(new T.Color('#ffffff'), 0.5), transparent: true, opacity: 0.22, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false }));
        cone.geometry.translate(0, -95, 0);
        cone.position.set(x, 184, 150);
        cone.rotation.x = 0.25;
        grp.add(cone);
        cones.push({ cone, ph: s * 1.3 });
      }
      // veil for locked / storm / finished rooms
      const veil = new T.Mesh(new T.BoxGeometry(RW, 130, RH - WALL_Y), new T.MeshBasicMaterial({ color: 0x03051a, transparent: true, opacity: 0, depthWrite: false }));
      veil.position.set(rx + RW / 2, 65, (WALL_Y + RH) / 2);
      veil.visible = false;
      veil.renderOrder = 5;
      grp.add(veil);
      roomObjs.push({ grp, screen, stex, sc, sig: '', veil, cones, look, accent: new T.Color(look.accent) });
    }
    for (let i = 0; i < plan.count - 1; i++) {
      const x0 = roomX(i) + RW;
      const x1 = roomX(i + 1);
      const grp = new T.Group();
      root.add(grp);
      const cf = new T.Mesh(new T.PlaneGeometry(x1 - x0, 72), new T.MeshStandardMaterial({ color: 0x0f1540, roughness: 0.35, metalness: 0.5 }));
      cf.rotation.x = -Math.PI / 2;
      cf.position.set((x0 + x1) / 2, 0.2, DOOR_Y);
      cf.receiveShadow = true;
      grp.add(cf);
      const wallM = new T.MeshStandardMaterial({ color: 0x0c1440, roughness: 0.5, metalness: 0.3 });
      for (const z of [DOOR_Y - 36, DOOR_Y + 36]) {
        const w = new T.Mesh(new T.BoxGeometry(x1 - x0, 60, 5), wallM);
        w.position.set((x0 + x1) / 2, 30, z);
        w.castShadow = true;
        grp.add(w);
        const glow = new T.Mesh(new T.BoxGeometry(x1 - x0, 1.8, 5.4), new T.MeshBasicMaterial({ color: 0x9db8ff, toneMapped: false }));
        glow.position.set((x0 + x1) / 2, 60.5, z);
        grp.add(glow);
      }
      // running-route chevrons (animated)
      const cvs = cv(256, 64);
      const g = cvs.getContext('2d');
      g.strokeStyle = '#ffffff';
      g.lineWidth = 8;
      g.lineCap = 'round';
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.moveTo(20 + k * 64, 12);
        g.lineTo(40 + k * 64, 32);
        g.lineTo(20 + k * 64, 52);
        g.stroke();
      }
      const ct = tex(cvs, { repeat: [(x1 - x0) / 60, 1] });
      const chev = new T.Mesh(new T.PlaneGeometry(x1 - x0 - 20, 24), new T.MeshBasicMaterial({ map: ct, transparent: true, opacity: 0.5, depthWrite: false, color: 0x8899cc, toneMapped: false }));
      chev.rotation.x = -Math.PI / 2;
      chev.position.set((x0 + x1) / 2, 0.6, DOOR_Y);
      grp.add(chev);
      corrObjs.push({ grp, chev, ct });
    }
  }

  function rebuildStudio() {
    if (!scene) return;
    tableObjs.forEach((t) => t.grp.parent && t.grp.parent.remove(t.grp));
    tableObjs.clear();
    const old = world.root;
    scene.remove(old);
    old.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    world.root = new T.Group();
    scene.add(world.root);
    buildStudio();
  }

  function screenCanvas(i, t) {
    const look = STAGE_LOOK[clamp(i, 0, 3)];
    const o = roomObjs[i];
    const done = i < activeStage ? dotsFor(i) : stageProgress[i] || 0;
    const dots = dotsFor(i);
    const isNowStage = i === activeStage && phase !== 'transition';
    const pulse = isNowStage ? Math.round(Math.sin(t * 6) * 10) : 0;
    const sig = `${i}|${plan.count}|${plan.names[i]}|${done}|${dots}|${isNowStage}|${pulse}`;
    if (sig === o.sig) return;
    o.sig = sig;
    const g = o.sc.getContext('2d');
    g.clearRect(0, 0, 600, 140);
    g.fillStyle = '#04081c';
    g.fillRect(0, 0, 600, 140);
    g.strokeStyle = look.accent;
    g.lineWidth = 6;
    g.strokeRect(6, 6, 588, 128);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = look.accent;
    g.font = '700 26px system-ui, sans-serif';
    g.fillText(`LEVEL ${i + 1} OF ${plan.count}`, 300, 34);
    g.fillStyle = '#ffffff';
    g.font = '800 50px system-ui, sans-serif';
    g.fillText(String(plan.names[i] || `Level ${i + 1}`).toUpperCase(), 300, 80);
    for (let d = 0; d < dots; d++) {
      const dx = 300 + (d - (dots - 1) / 2) * 44;
      const isDone = d < done;
      const isNow = isNowStage && d === done;
      g.fillStyle = isDone ? '#3ee08f' : isNow ? '#ffd23f' : 'rgba(255,255,255,0.2)';
      g.beginPath();
      g.arc(dx, 116, isNow ? 10 + pulse * 0.1 : 8, 0, TAU);
      g.fill();
    }
    o.stex.needsUpdate = true;
  }

  /* -------------------------------------------------------- 3D: tables */

  function makeTableObj(tb, stage) {
    const look = STAGE_LOOK[clamp(stage, 0, 3)];
    const grp = new T.Group();
    grp.position.set(tb.x, 0, tb.y);
    const wood = new T.MeshStandardMaterial({ color: 0x9b6b3f, roughness: 0.45, metalness: 0.05 });
    const top = new T.Mesh(new T.BoxGeometry(88, 4, 34), wood);
    top.position.set(0, 22, 0);
    top.castShadow = top.receiveShadow = true;
    grp.add(top);
    const panelMat = new T.MeshStandardMaterial({ color: 0x141c4a, roughness: 0.35, metalness: 0.5, emissive: new T.Color(look.accent), emissiveIntensity: 0.12 });
    const panel = new T.Mesh(new T.BoxGeometry(88, 21, 4), panelMat);
    panel.position.set(0, 10.5, 15);
    panel.castShadow = true;
    grp.add(panel);
    for (const sx of [-1, 1]) {
      const leg = new T.Mesh(new T.BoxGeometry(4, 21, 32), panelMat);
      leg.position.set(sx * 42, 10.5, 0);
      grp.add(leg);
    }
    const trim = new T.Mesh(new T.BoxGeometry(88.4, 1.6, 4.4), new T.MeshBasicMaterial({ color: new T.Color(look.accent), toneMapped: false }));
    trim.position.set(0, 20.5, 15);
    grp.add(trim);
    // laptop
    const lapMat = new T.MeshStandardMaterial({ color: 0x0b0d1a, roughness: 0.4, metalness: 0.6 });
    const lap = new T.Mesh(new T.BoxGeometry(20, 1.4, 13), lapMat);
    lap.position.set(-27, 25.4, 3);
    grp.add(lap);
    const screenMat = new T.MeshBasicMaterial({ color: new T.Color(look.accent), toneMapped: false });
    const scr = new T.Mesh(new T.PlaneGeometry(18, 11), screenMat);
    scr.position.set(-27, 32, -3.2);
    scr.rotation.x = -0.25;
    const back = new T.Mesh(new T.BoxGeometry(20, 12, 1.2), lapMat);
    back.position.set(-27, 31.6, -4);
    back.rotation.x = -0.25;
    grp.add(back, scr);
    // lock lamp
    const lampMat = new T.MeshStandardMaterial({ color: 0x3a405e, emissive: 0x000000, roughness: 0.3 });
    const lamp = new T.Mesh(new T.SphereGeometry(4, 12, 10), lampMat);
    lamp.position.set(34, 27.5, 4);
    grp.add(lamp);
    const lampGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffd23f, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
    lampGlow.scale.set(30, 30, 1);
    lampGlow.position.set(34, 28, 4);
    grp.add(lampGlow);
    const stripe = new T.Mesh(new T.BoxGeometry(7, 20, 4.6), new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    stripe.position.set(-40, 10.5, 15);
    stripe.visible = false;
    grp.add(stripe);
    const pool = new T.Mesh(new T.PlaneGeometry(150, 110), new T.MeshBasicMaterial({ map: radialTex([[0, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']], 64), transparent: true, depthWrite: false, blending: T.AdditiveBlending, color: 0x8ab0ff }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.9, 6);
    grp.add(pool);
    const ring = new T.Mesh(new T.RingGeometry(50, 54, 40), new T.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.7, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.scale.set(1, 0.55, 1);
    ring.position.set(0, 1.2, 6);
    ring.visible = false;
    grp.add(ring);
    world.root.add(grp);
    return { grp, screenMat, lampMat, lampGlow, stripe, pool, ring, look, born: tb.born };
  }

  /* -------------------------------------------------------- 3D: avatars */

  function loadModels() {
    if (!T.GLTFLoader || !T.SkeletonUtils) return;
    modelWait = new Promise((resolve) => {
      new T.GLTFLoader().load(
        'models/Soldier.glb',
        (g) => {
          soldierGLTF = g;
          resolve();
        },
        undefined,
        () => resolve()
      );
    });
  }

  function makeCharObj(ch) {
    const root = new T.Group();
    const tint = new T.Color(ch.look.shirt).lerp(new T.Color('#ffffff'), 0.5);
    const mats = [];
    let inner;
    let mixer = null;
    const acts = {};
    if (soldierGLTF) {
      inner = T.SkeletonUtils.clone(soldierGLTF.scene);
      inner.scale.setScalar(SOLDIER_SCALE);
      inner.rotation.y = Math.PI; // the model's front faces -Z; turn it toward the camera (+Z)
      root.add(inner);
      inner.traverse((m) => {
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        m.material = m.material.clone();
        if (/body/i.test(m.material.name)) {
          m.material.color.copy(tint);
          mats.push(m.material);
        }
      });
      mixer = new T.AnimationMixer(inner);
      for (const name of ['Idle', 'Walk', 'Run']) {
        const a = mixer.clipAction(T.AnimationClip.findByName(soldierGLTF.animations, name));
        a.play();
        a.setEffectiveWeight(name === 'Idle' ? 1 : 0);
        acts[name] = a;
      }
      mixer.update(rand(0, 2));
    } else {
      inner = new T.Group();
      root.add(inner);
      const b = new T.Mesh(new T.CapsuleGeometry(9, 26, 4, 10), new T.MeshStandardMaterial({ color: tint }));
      b.position.y = 24;
      b.castShadow = true;
      inner.add(b);
    }
    const blob = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.scale.set(34, 34, 1);
    blob.position.y = 0.9;
    root.add(blob);
    // parachute
    const chute = new T.Group();
    const canopy = new T.Mesh(new T.SphereGeometry(30, 20, 10, 0, TAU, 0, Math.PI / 2), new T.MeshStandardMaterial({ color: new T.Color(ch.look.shirt), roughness: 0.7, side: T.DoubleSide, emissive: new T.Color(ch.look.shirt), emissiveIntensity: 0.15 }));
    canopy.position.y = 96;
    chute.add(canopy);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      const pts = [new T.Vector3(Math.cos(a) * 28, 98, Math.sin(a) * 28), new T.Vector3(0, 56, 0)];
      chute.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0xdddddd })));
    }
    chute.visible = false;
    root.add(chute);
    root.visible = false;
    world.root.add(root);
    return { root, inner, mixer, acts, w: { Idle: 1, Walk: 0, Run: 0 }, mats, blob, chute, h: 0, tint, wasDead: false, prevState: '', px: 0, py: 0 };
  }

  function clearCharObjs() {
    charObjs.forEach((o) => o.root.parent && o.root.parent.remove(o.root));
    charObjs.clear();
  }

  /* -------------------------------------------------------------- effects */

  function burst(x, z, h, color, n, speed) {
    if (reduceMotion || !scene) return;
    let made = 0;
    for (const p of particles) {
      if (p.life > 0) continue;
      p.sp.position.set(x, h, z);
      p.sp.material.color.set(color);
      const a = rand(0, TAU);
      const u = rand(-1, 1);
      const s = (speed || 80) * rand(0.4, 1.2);
      p.v.set(Math.cos(a) * Math.sqrt(1 - u * u) * s, Math.abs(u) * s + 30, Math.sin(a) * Math.sqrt(1 - u * u) * s);
      p.max = p.life = rand(0.5, 1.1);
      p.size = rand(5, 11);
      p.grav = 200;
      p.sp.visible = true;
      if (++made >= n) break;
    }
  }

  function stepParticles(dt) {
    for (const p of particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sp.visible = false;
        continue;
      }
      p.v.y -= p.grav * dt;
      p.sp.position.addScaledVector(p.v, dt);
      const k = p.life / p.max;
      p.sp.material.opacity = Math.min(1, k * 1.6);
      p.sp.scale.setScalar(p.size * (0.6 + 0.6 * k));
    }
  }

  /* ------------------------------------------------------------ per frame */

  function update(dt) {
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
        burst(ch.x, ch.y, 6, '#d9d2c2', 16, 90);
        if (hooks.land) hooks.land(ch.id);
      }
      if (ch.state === 'run' && ch.path && ch.path.length) {
        const wp = ch.path[0];
        const dx = wp.x - ch.x;
        const dy = wp.y - ch.y;
        const dist = Math.hypot(dx, dy);
        const step = ch.speed * dt;
        if (Math.abs(dx) > 4) ch.dir = dx > 0 ? 1 : -1;
        ch.moveDx = dx;
        ch.moveDy = dy;
        ch.dustT -= dt;
        if (ch.dustT <= 0) {
          ch.dustT = 0.09;
          burst(ch.x - ch.dir * 8, ch.y, 3, '#d9d2c2', 1, 26);
        }
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

  function syncTables(t) {
    const seen = new Set();
    rooms.forEach((room, ri) => {
      room.tables.forEach((tb) => {
        seen.add(tb);
        let o = tableObjs.get(tb);
        if (!o) {
          o = makeTableObj(tb, ri);
          tableObjs.set(tb, o);
        }
        const rise = clamp((t - tb.born) / 0.5, 0, 1);
        o.grp.visible = rise > 0;
        o.grp.position.y = -(1 - easeOut(rise)) * 30;
        const owner = tb.owner ? chars.get(tb.owner) : null;
        const dead = !!(owner && owner.dead);
        const accent = o.look.accent;
        let col = new T.Color(accent);
        if (owner && !dead) {
          if (owner.verdict === 'right') col = new T.Color('#3ee08f');
          else if (owner.verdict === 'wrong') col = new T.Color('#ff5470');
          else if (owner.locked) col = new T.Color('#ffe08a');
        }
        o.screenMat.color.copy(dead ? new T.Color('#111426') : col).multiplyScalar(dead ? 1 : 0.7 + 0.25 * Math.sin(t * 4 + tb.x));
        const locked = !!(owner && owner.locked && !dead);
        o.lampMat.emissive.set(dead ? 0x7a1f2a : locked ? 0xffd23f : 0x000000);
        o.lampMat.emissiveIntensity = locked ? 1.6 : dead ? 0.8 : 0;
        o.lampGlow.material.opacity = locked ? 0.7 + 0.2 * Math.sin(t * 8) : 0;
        o.pool.material.color.set(dead ? 0xff3a3a : locked ? 0xffe08a : 0x8ab0ff);
        o.pool.material.opacity = dead ? 0.5 : 0.8;
        const team = owner && owner.team !== null && owner.team !== undefined;
        o.stripe.visible = !!team;
        if (team) o.stripe.material.color.set(TEAM_COLORS[owner.team % TEAM_COLORS.length]);
        o.ring.visible = !!(owner && owner.id === meId && !dead);
        if (o.ring.visible) o.ring.material.opacity = 0.55 + 0.3 * Math.sin(t * 4);
      });
    });
    tableObjs.forEach((o, tb) => {
      if (!seen.has(tb)) {
        o.grp.parent && o.grp.parent.remove(o.grp);
        tableObjs.delete(tb);
      }
    });
  }

  function syncChars(t, dt) {
    charObjs.forEach((o, id) => {
      if (!chars.has(id)) {
        o.root.parent && o.root.parent.remove(o.root);
        charObjs.delete(id);
      }
    });
    chars.forEach((ch) => {
      let o = charObjs.get(ch.id);
      if (!o) {
        o = makeCharObj(ch);
        charObjs.set(ch.id, o);
      }
      const running = ch.state === 'run';
      const dropping = ch.state === 'drop';
      let visible = true;
      let y = 0;
      let px = ch.x;
      let pz = running ? ch.y : ch.y - 18; // people stand just behind their desk
      let scale = 1;
      if (dropping) {
        const k = (t - ch.dropStart) / 2.2;
        if (k < 0) visible = false;
        else {
          y = 330 * Math.pow(1 - clamp(k, 0, 1), 1.4);
          px += Math.sin(k * 7 + ch.ph) * 14 * (1 - k);
          o.chute.visible = k < 0.93;
        }
      } else o.chute.visible = false;
      if (ch.pop && !running) {
        const k = clamp((t - ch.pop) / 0.35, 0, 1);
        scale = 0.85 + 0.15 * easeOut(k);
      }
      o.root.visible = visible;
      o.root.position.set(px, y, pz);
      o.root.scale.setScalar(scale);
      // heading
      let target = 0;
      if (running && (ch.moveDx || ch.moveDy)) target = Math.atan2(ch.moveDx, ch.moveDy);
      o.h += angDiff(o.h, target) * Math.min(1, dt * 10);
      o.root.rotation.y = o.h;

      const dead = ch.dead;
      const cheering = ch.cheerUntil > t;
      const moving = running;
      const dazed = ch.slump && !dead;
      if (o.mixer) {
        const goRun = moving;
        const tw = { Idle: goRun ? 0 : 1, Walk: 0, Run: goRun ? 1 : 0 };
        const kk = Math.min(1, dt * 10);
        for (const n of ['Idle', 'Walk', 'Run']) {
          o.w[n] += (tw[n] - o.w[n]) * kk;
          o.acts[n].setEffectiveWeight(Math.max(0.0001, o.w[n]));
        }
        o.acts.Run.setEffectiveTimeScale(clamp(ch.speed / 260, 0.8, 1.6));
        o.acts.Idle.setEffectiveTimeScale(dead ? 0.0001 : dazed ? 0.5 : 1);
        o.mixer.update(dead && o.wasDead ? 0 : dt);
      }
      // poses: cheering hop, wrong-answer slump, knocked out
      let lean = 0;
      let hop = 0;
      let roll = 0;
      let sink = 0;
      if (cheering) {
        hop = Math.abs(Math.sin(t * 10)) * 7;
        roll = Math.sin(t * 12) * 0.12;
      }
      if (dazed) lean = 0.3;
      if (dead) {
        const k = clamp((t - (ch.deadAt || -10)) / 0.6, 0, 1);
        lean = -1.4 * easeOut(k);
        sink = 8 * easeOut(k);
        o.wasDead = true;
      } else o.wasDead = false;
      o.inner.rotation.x = lerp(o.inner.rotation.x, lean, Math.min(1, dt * 8));
      o.inner.rotation.z = roll;
      o.inner.position.y = hop - sink;
      o.mats.forEach((m) => {
        const grey = dead ? new T.Color('#6a6d7c') : o.tint;
        m.color.lerp(grey, Math.min(1, dt * 6));
      });
      o.blob.visible = !dropping;
      o.px = px;
    });
  }

  function syncRooms(t) {
    roomObjs.forEach((o, i) => {
      screenCanvas(i, t);
      // room veils: locked rooms are dark, finished rooms dim, the storm room glows red
      let op = 0;
      let color = 0x03051a;
      if (i > reachedStage) op = 0.62;
      else if (i < activeStage || (phase === 'transition' && storm && storm.stage === i)) {
        const stormy = storm && storm.stage === i;
        op = stormy ? 0.3 : 0.42;
        if (stormy) color = 0xa0141e;
      }
      const stormy = storm && storm.stage === i && phase === 'transition';
      if (stormy) op += 0.12 * Math.sin(t * 8);
      o.veil.visible = op > 0.01;
      o.veil.material.opacity = Math.max(0, op);
      o.veil.material.color.setHex(color);
      o.cones.forEach((c) => {
        c.cone.rotation.z = Math.sin(t * 0.6 + c.ph) * 0.18;
        c.cone.material.opacity = (i > reachedStage ? 0.05 : 0.22) + 0.04 * Math.sin(t * 1.5 + c.ph);
      });
    });
    corrObjs.forEach((c, i) => {
      const lit = i < reachedStage;
      c.chev.material.color.set(lit ? 0xffe08a : 0x8899cc);
      c.chev.material.opacity = lit ? 0.85 : 0.35;
      c.ct.offset.x = -((t * 0.8) % 1);
    });
  }

  function updateCamera() {
    // same "pixels per world unit" idea as the 2D map: the camera distance follows cam.s
    const aspect = W / Math.max(1, H);
    camera.aspect = aspect;
    const tanY = Math.tan((camera.fov * Math.PI) / 360);
    const d = H / (2 * Math.max(cam.s, 0.05) * tanY);
    const crowd = rooms[activeStage] ? rooms[activeStage].tables.length : 0;
    const targetPitch = 0.62 + 0.22 * clamp((crowd - 4) / 4, 0, 1); // two rows need a higher view
    camPitch += (targetPitch - camPitch) * 0.06;
    const pitch = camPitch;
    const ty = 30;
    camera.position.set(cam.x, ty + d * Math.sin(pitch), cam.y + 30 + d * Math.cos(pitch));
    camera.lookAt(cam.x, ty, cam.y + 30);
    camera.updateProjectionMatrix();
    world.key.target.position.set(cam.x, 0, cam.y);
    world.key.position.set(cam.x + 160, 720, cam.y + 520);
    world.key.target.updateMatrixWorld();
    const flash = lightning > nowT ? Math.max(0, (lightning - nowT) / 0.25) : 0;
    world.hemi.intensity = 0.75 + flash * 2;
  }

  /* --------------------------------------------------------------- overlay */

  const _v = new T.Vector3();
  function project(x, y, z) {
    _v.set(x, y, z).project(camera);
    return { x: (_v.x * 0.5 + 0.5) * W, y: (-_v.y * 0.5 + 0.5) * H, behind: _v.z > 1 };
  }
  function unit() {
    // screen pixels per world unit at the focus (for font scaling)
    return clamp(cam.s / 0.95, 0.5, 1.5);
  }

  function rrect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function drawOverlay(t) {
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, W, H);
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    const u = clamp(cam.s * 1.05, 0.55, 1.6);
    // zone: everything outside the next room is storm
    if (zone) {
      const k = clamp((t - zone.start) / zone.dur, 0, 1);
      const c = project(roomX(zone.stage) + RW / 2, 0, RH / 2);
      const e = project(roomX(zone.stage) + RW / 2 + RW * 0.62, 0, RH / 2);
      const small = Math.max(Math.abs(e.x - c.x), 60);
      const big = Math.hypot(W, H) * 1.3;
      const r = big + (small - big) * easeOut(k);
      octx.save();
      octx.fillStyle = 'rgba(40,90,255,0.26)';
      octx.beginPath();
      octx.rect(0, 0, W, H);
      octx.arc(c.x, c.y, r, 0, TAU, true);
      octx.fill('evenodd');
      octx.strokeStyle = `rgba(255,255,255,${0.55 + 0.3 * Math.sin(t * 6)})`;
      octx.lineWidth = 2.5;
      octx.shadowColor = '#6aa8ff';
      octx.shadowBlur = 14;
      octx.beginPath();
      octx.arc(c.x, c.y, r, 0, TAU);
      octx.stroke();
      octx.restore();
    }
    // locked rooms
    for (let i = reachedStage + 1; i < plan.count; i++) {
      const p = project(roomX(i) + RW / 2, 30, 200);
      if (p.behind) continue;
      octx.fillStyle = 'rgba(255,255,255,0.8)';
      octx.font = `800 ${Math.round(46 * u)}px system-ui, "Apple Color Emoji", sans-serif`;
      octx.fillText('🔒', p.x, p.y - 8 * u);
      octx.font = `700 ${Math.round(14 * u)}px system-ui, sans-serif`;
      octx.fillText('LOCKED', p.x, p.y + 32 * u);
    }
    // people and desks
    chars.forEach((ch) => {
      if (ch.state === 'drop' && (t < ch.dropStart)) return;
      const running = ch.state === 'run';
      const dropping = ch.state === 'drop';
      const o = charObjs.get(ch.id);
      const headH = 74 + (ch.cheerUntil > t ? 8 : 0) + (dropping && o ? o.root.position.y : 0);
      const hz = running ? ch.y : ch.y - 18;
      const head = project(ch.x, headH, hz);
      if (head.behind) return;
      const rise = ch.dead ? 0.55 : 1;
      octx.globalAlpha = rise;
      octx.font = `${Math.round(19 * u)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      octx.fillText(ch.emoji, head.x, head.y - 4 * u);
      octx.globalAlpha = 1;
      if (ch.id === meId && !dropping) {
        octx.font = `800 ${Math.round(10 * u)}px system-ui, sans-serif`;
        octx.fillStyle = '#ffe08a';
        octx.fillText('YOU', head.x, head.y - 22 * u);
      }
      // desk nameplate
      if (!running && !dropping) {
        const np = project(ch.x, 11, ch.y + 18);
        const dead = ch.dead;
        octx.font = `700 ${Math.round(12.5 * u)}px system-ui, sans-serif`;
        octx.fillStyle = dead ? '#9a9dab' : ch.id === meId ? '#ffe08a' : '#ffffff';
        octx.strokeStyle = 'rgba(0,0,20,0.75)';
        octx.lineWidth = 3;
        const label = ch.name.length > 8 ? ch.name.slice(0, 7) + '…' : ch.name;
        octx.strokeText(label, np.x, np.y - 6 * u);
        octx.fillText(label, np.x, np.y - 6 * u);
        let sub = '';
        if (dead) sub = ch.place ? `OUT · #${ch.place}` : 'OUT';
        else if (ch.choice) sub = `${ch.choice} ${ch.verdict === 'right' ? '✓' : '✗'}`;
        else if (ch.locked) sub = `${(ch.ms / 1000).toFixed(1)}s`;
        else if (ch.sleeping) sub = 'zzz';
        if (sub) {
          octx.font = `700 ${Math.round(10.5 * u)}px system-ui, sans-serif`;
          octx.fillStyle = dead ? '#ff5470' : ch.verdict === 'wrong' ? '#ff8095' : ch.verdict === 'right' ? '#3ee08f' : '#ffe08a';
          octx.strokeText(sub, np.x, np.y + 8 * u);
          octx.fillText(sub, np.x, np.y + 8 * u);
        }
        if (ch.locked && ch.order && !dead) {
          const cp = project(ch.x - 40, 26, ch.y + 12);
          octx.fillStyle = ch.order === 1 ? '#ffd23f' : '#c9d3ff';
          octx.beginPath();
          octx.arc(cp.x, cp.y, 8 * u, 0, TAU);
          octx.fill();
          octx.fillStyle = '#2a1b00';
          octx.font = `800 ${Math.round(11 * u)}px system-ui, sans-serif`;
          octx.fillText(String(ch.order), cp.x, cp.y + 1);
        }
        if (fans[ch.id] > 0 && !dead) {
          const fp = project(ch.x + 34, 40, ch.y + 4);
          octx.fillStyle = '#ff5c8a';
          rrect(octx, fp.x - 15 * u, fp.y - 8 * u, 30 * u, 15 * u, 7 * u);
          octx.fill();
          octx.fillStyle = '#fff';
          octx.font = `800 ${Math.round(10 * u)}px system-ui, sans-serif`;
          octx.fillText(`❤ ${fans[ch.id]}`, fp.x, fp.y);
        }
      }
      // speech bubble
      if (ch.say && ch.say.until > t && !dropping) {
        const fs = 11.5 * u;
        octx.font = `700 ${fs}px system-ui, "Apple Color Emoji", sans-serif`;
        const w = Math.min(200, octx.measureText(ch.say.text).width + 18);
        const pop = clamp((t - (ch.say.until - 3.4)) / 0.2, 0, 1);
        const a = ch.say.until - t < 0.4 ? (ch.say.until - t) / 0.4 : 1;
        const bx = head.x;
        const by = head.y - 38 * u;
        octx.save();
        octx.globalAlpha = a;
        octx.translate(bx, by);
        octx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
        octx.fillStyle = '#fff';
        rrect(octx, -w / 2, -fs - 6, w, fs + 14, 9);
        octx.fill();
        octx.beginPath();
        octx.moveTo(-5, 6);
        octx.lineTo(0, 13);
        octx.lineTo(5, 6);
        octx.fill();
        octx.fillStyle = '#12163a';
        octx.fillText(ch.say.text, 0, -fs / 2 + 2);
        octx.restore();
      }
    });
    // floaters (✓ ✗ OUT, reactions)
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      const k = (t - f.born) / f.life;
      if (k >= 1) {
        floaters.splice(i, 1);
        continue;
      }
      const p = project(f.x, f.h + k * 36, f.z);
      if (p.behind) continue;
      octx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      if (f.emoji) {
        octx.font = `${Math.round(26 * u * (1 + 0.25 * Math.sin(k * 9)))}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        octx.fillText(f.text, p.x + Math.sin(k * 8) * 6, p.y);
        continue;
      }
      octx.font = `800 ${Math.round((f.big ? 20 : 18) * u)}px system-ui, sans-serif`;
      octx.strokeStyle = 'rgba(0,0,0,0.65)';
      octx.lineWidth = 3;
      octx.strokeText(f.text, p.x, p.y);
      octx.fillStyle = f.color;
      octx.fillText(f.text, p.x, p.y);
    }
    octx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ loop */

  function draw(t, dt) {
    if (!renderer || !world) return;
    nowT = t;
    update(dt);
    syncTables(t);
    syncChars(t, dt);
    syncRooms(t);
    stepParticles(dt);
    updateCamera();
    renderer.render(scene, camera);
    drawOverlay(t);
  }

  function loop(now) {
    if (!running) return;
    const t = now / 1000;
    const dt = Math.min(0.05, Math.max(0, t - last));
    last = t;
    try {
      draw(t, dt);
    } catch (err) {
      if (!loop.warned) {
        loop.warned = true;
        console.error('arena frame failed', err);
      }
    }
    requestAnimationFrame(loop);
  }

  function resize() {
    if (!canvas || !renderer) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, dprMax);
    W = rect.width;
    H = rect.height;
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    overlay.width = Math.round(W * dpr);
    overlay.height = Math.round(H * dpr);
    if (camera) camera.aspect = W / H;
    if (overview) showOverview();
    else focus(activeStage, true);
    if (world) draw(performance.now() / 1000, 0);
  }

  function start() {
    if (!canvas || running) return;
    resize();
    if (document.hidden) return;
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
    if (!T.GLTFLoader) console.warn('GLTFLoader missing — arena avatars fall back to simple figures');
    renderer = new T.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setClearColor(0x02061c, 1);
    const cap = renderer.capabilities;
    quality = mobile ? { shadowSize: 1024, aniso: Math.min(2, cap.getMaxAnisotropy()) } : { shadowSize: 2048, aniso: Math.min(8, cap.getMaxAnisotropy()) };
    loadModels();
    overlay = document.createElement('canvas');
    overlay.className = 'arena-overlay';
    octx = overlay.getContext('2d');
    canvas.parentNode.insertBefore(overlay, canvas.nextSibling);
    ensureScene();
    setPlan(plan);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);
    canvas.addEventListener('click', (e) => {
      const id = tableAt(e.clientX, e.clientY);
      if (id && hooks.tableTap && hooks.tableTap(id)) return;
      toggleOverview();
    });
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) running = false;
      else if (canvas.offsetParent !== null) start();
    });
  }

  return { mount, start, stop, resize, startMatch, startQuestion, lock, reveal, transition, setMe, react, say, setFans, tableAt, aliveCount, toggleOverview };
})();
