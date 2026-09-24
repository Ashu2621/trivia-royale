/*
 * Maze3D — the 3D renderer and controls for "We Gotta Go" (the haunted-maze co-op mode).
 *
 * Draws the server's simulation with Three.js: a moonlit haunted maze with torches, gates,
 * glowing keys, floating ghosts and a very welcome toilet. Everyone is interpolated between
 * snapshots; your own soldier is predicted locally with the same wall collision the server uses.
 * Third-person camera: drag to orbit, wheel/pinch to zoom, WASD/joystick to move (relative to the
 * camera), tap the floor to walk there, Space / 🔦 to scare nearby ghosts.
 */
const Maze3D = (function () {
  'use strict';

  const T = THREE;
  if (T.ColorManagement) T.ColorManagement.legacyMode = false;

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };
  const SPEED = 165;
  const WALL_H = 78;
  const mobile = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || Math.min(screen.width, screen.height) < 700;
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const KEY_COL = { a: '#ff5a5a', b: '#5aa8ff', c: '#5aff9a' };
  const TINTS = ['#e63946', '#4361ee', '#2a9d8f', '#f4a261', '#9b5de5', '#f15bb5', '#00bbf9', '#8ac926', '#ff7b00', '#7209b7'];

  let canvas = null;
  let overlay = null;
  let octx = null;
  let mini = null;
  let mctx = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let dprMax = mobile ? 1.5 : 2;
  let hooks = {};
  let running = false;
  let last = 0;
  let nowT = 0;
  let quality = null;

  // layout
  let P = null; // payload
  let cols = 14;
  let rows = 10;
  let cell = 100;
  let hw = [];
  let vw = [];
  let rectsByCell = [];
  let opened = new Set();
  let doorCells = [];
  let players = [];
  let indexById = new Map();
  let meIdx = -1;
  let snaps = [];
  let offset = 0;
  let startsAt = 0;
  let me = { x: 0, y: 0, face: -1, init: false, flags: 0 };
  const keys = { up: false, down: false, left: false, right: false, rotL: false, rotR: false };
  let joy = { x: 0, y: 0 };
  let goPath = null;
  let lastSent = { dx: 0, dy: 0, t: 0 };
  const fx = [];
  const bubbles = new Map();
  let bladder = 0;
  let lightning = { at: 0, until: 0, next: 0 };
  let danger = 0;

  const cam = { yaw: 0, yawT: 0, pitch: 1.15, pitchT: 1.15, dist: 380, distT: 380, x: 0, z: 0, shake: 0 };
  const camPos = new T.Vector3();
  const focus = { x: 0, z: 0 };

  // scene objects
  let world = null;
  let entityGroup = null;
  let playerObjs = [];
  let ghostObjs = [];
  let keyObjs = new Map();
  let doorObjs = new Map();
  let toilet = null;
  let particles = [];
  let shadowTex = null;
  let glowTex = null;
  let coneTex = null;
  const labels = [];
  const matCache = new Map();

  /* ---------------------------------------------------------- layout */

  function parseLayout(p) {
    cols = p.cols;
    rows = p.rows;
    cell = p.cell;
    hw = p.hW.map((s) => Array.from(s, (ch) => +ch));
    vw = p.vW.map((s) => Array.from(s, (ch) => +ch));
    const t = p.wallT / 2;
    const rects = [];
    for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) if (hw[r][c]) rects.push({ x0: c * cell - t, x1: (c + 1) * cell + t, y0: r * cell - t, y1: r * cell + t });
    for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) if (vw[r][c]) rects.push({ x0: c * cell - t, x1: c * cell + t, y0: r * cell - t, y1: (r + 1) * cell + t });
    rectsByCell = Array.from({ length: cols * rows }, () => []);
    const R = p.playerR;
    for (const rc of rects) {
      const c0 = Math.max(0, Math.floor((rc.x0 - R) / cell));
      const c1 = Math.min(cols - 1, Math.floor((rc.x1 + R) / cell));
      const r0 = Math.max(0, Math.floor((rc.y0 - R) / cell));
      const r1 = Math.min(rows - 1, Math.floor((rc.y1 + R) / cell));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) rectsByCell[r * cols + c].push(rc);
    }
    doorCells = p.doors.map((d) => ({ letter: d.letter, r: Math.floor(d.y / cell), c: Math.floor(d.x / cell) }));
  }

  const hitRect = (x, y, r, rc) => {
    const nx = Math.max(rc.x0, Math.min(x, rc.x1));
    const ny = Math.max(rc.y0, Math.min(y, rc.y1));
    return (x - nx) * (x - nx) + (y - ny) * (y - ny) < r * r;
  };

  function collides(x, y, r) {
    if (x < r || y < r || x > cols * cell - r || y > rows * cell - r) return true;
    const c = clamp(Math.floor(x / cell), 0, cols - 1);
    const rr = clamp(Math.floor(y / cell), 0, rows - 1);
    for (const rc of rectsByCell[rr * cols + c]) if (hitRect(x, y, r, rc)) return true;
    for (const d of doorCells) {
      if (opened.has(d.letter)) continue;
      if (hitRect(x, y, r, { x0: d.c * cell + 2, x1: (d.c + 1) * cell - 2, y0: d.r * cell + 2, y1: (d.r + 1) * cell - 2 })) return true;
    }
    return false;
  }

  function neighbors(r, c) {
    const out = [];
    if (r > 0 && !hw[r][c]) out.push([r - 1, c]);
    if (r < rows - 1 && !hw[r + 1][c]) out.push([r + 1, c]);
    if (c > 0 && !vw[r][c]) out.push([r, c - 1]);
    if (c < cols - 1 && !vw[r][c + 1]) out.push([r, c + 1]);
    return out;
  }

  // cell route for tap-to-walk (respects closed gates)
  function routeTo(x, y, tx, ty) {
    const sr = clamp(Math.floor(y / cell), 0, rows - 1);
    const sc = clamp(Math.floor(x / cell), 0, cols - 1);
    const gr = clamp(Math.floor(ty / cell), 0, rows - 1);
    const gc = clamp(Math.floor(tx / cell), 0, cols - 1);
    const closed = new Set(doorCells.filter((d) => !opened.has(d.letter)).map((d) => d.r * cols + d.c));
    const prev = new Int16Array(cols * rows).fill(-2);
    const q = [sr * cols + sc];
    prev[q[0]] = -1;
    for (let h = 0; h < q.length && prev[gr * cols + gc] === -2; h++) {
      const cur = q[h];
      for (const [nr, nc] of neighbors(Math.floor(cur / cols), cur % cols)) {
        const ni = nr * cols + nc;
        if (prev[ni] !== -2 || closed.has(ni)) continue;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    const goal = gr * cols + gc;
    if (prev[goal] === -2) return null;
    const path = [];
    for (let n = goal; n !== -1; n = prev[n]) path.push({ x: (n % cols) * cell + cell / 2, y: Math.floor(n / cols) * cell + cell / 2 });
    path.reverse();
    path.shift();
    path.push({ x: tx, y: ty });
    return path;
  }

  /* ---------------------------------------------------------- input */

  function inputVector() {
    let ix = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let iy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (!ix && !iy && (joy.x || joy.y)) {
      ix = joy.x;
      iy = joy.y;
    }
    let dx = 0;
    let dy = 0;
    if (ix || iy) {
      const c = Math.cos(cam.yaw);
      const s = Math.sin(cam.yaw);
      dx = c * ix - s * iy;
      dy = s * ix + c * iy;
    } else if (goPath && goPath.length) {
      const wp = goPath[0];
      const ex = wp.x - me.x;
      const ey = wp.y - me.y;
      const d = Math.hypot(ex, ey);
      if (d < 9) goPath.shift();
      else {
        dx = ex / d;
        dy = ey / d;
      }
    }
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    return { dx, dy };
  }

  const nowServer = () => Date.now() + offset;

  function stepMe(dt, v) {
    if (me.flags & (1 | 8 | 32)) return;
    if ((!v.dx && !v.dy) || nowServer() < startsAt) return;
    const px = me.x;
    const py = me.y;
    const vx = v.dx * SPEED * dt;
    const vy = v.dy * SPEED * dt;
    if (!collides(me.x + vx, me.y, P.playerR)) me.x += vx;
    if (!collides(me.x, me.y + vy, P.playerR)) me.y += vy;
    if (Math.abs(v.dx) > 0.15) me.face = v.dx > 0 ? 1 : -1;
    if (goPath && Math.abs(me.x - px) + Math.abs(me.y - py) < 0.01) goPath = null;
  }

  /* --------------------------------------------------------- textures */

  const cv = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.round(w);
    c.height = Math.round(h);
    return c;
  };
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const tex = (c, opts) => {
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = quality.aniso;
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
    const m = new T.MeshStandardMaterial(Object.assign({ color, roughness: rough == null ? 0.85 : rough, metalness: metal || 0 }, extra));
    if (key) matCache.set(key, m);
    return m;
  }

  function floorCanvas(k, layoutSeed) {
    const w = cols * cell;
    const h = rows * cell;
    const c = cv(w * k, h * k);
    const g = c.getContext('2d');
    const r = rng(layoutSeed);
    g.scale(k, k);
    g.fillStyle = '#25232c';
    g.fillRect(0, 0, w, h);
    // flagstones
    const S = 50;
    for (let y = 0; y < h; y += S) {
      for (let x = 0; x < w; x += S) {
        const v = 44 + Math.floor(r() * 26);
        g.fillStyle = `rgb(${v},${v - 2},${v + 8})`;
        g.fillRect(x + 1.5, y + 1.5, S - 3, S - 3);
        if (r() < 0.25) {
          g.fillStyle = 'rgba(0,0,0,0.18)';
          g.fillRect(x + 1.5, y + 1.5, S - 3, S - 3);
        }
      }
    }
    for (let i = 0; i < 14000; i++) {
      g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${r() * 0.07})` : `rgba(0,0,0,${r() * 0.16})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
    // moss, stains, puddles
    for (let i = 0; i < 160; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 8 + r() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(${40 + r() * 20},${90 + r() * 40},${50},0.32)`);
      gr.addColorStop(1, 'rgba(40,90,50,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 40; i++) {
      const x = r() * w;
      const y = r() * h;
      g.fillStyle = 'rgba(70,110,170,0.28)';
      g.beginPath();
      g.ellipse(x, y, 10 + r() * 18, 6 + r() * 10, r() * 3, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(200,225,255,0.18)';
      g.beginPath();
      g.ellipse(x - 3, y - 2, 4 + r() * 5, 2 + r() * 3, r() * 3, 0, TAU);
      g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1;
    for (let i = 0; i < 90; i++) {
      let x = r() * w;
      let y = r() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 5; s++) {
        x += (r() - 0.5) * 22;
        y += (r() - 0.5) * 22;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    return c;
  }

  function wallCanvas() {
    const c = cv(256, 128);
    const g = c.getContext('2d');
    const r = rng(77);
    g.fillStyle = '#2b2c38';
    g.fillRect(0, 0, 256, 128);
    const bh = 21;
    for (let y = 0, row = 0; y < 128; y += bh, row++) {
      const bw = 46;
      for (let x = -(row % 2) * (bw / 2); x < 256; x += bw) {
        const v = 52 + Math.floor(r() * 30);
        g.fillStyle = `rgb(${v},${v + 1},${v + 12})`;
        g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
        if (r() < 0.3) {
          g.fillStyle = 'rgba(0,0,0,0.2)';
          g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
        }
      }
    }
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${r() * 0.06})` : `rgba(0,0,0,${r() * 0.18})`;
      g.fillRect(r() * 256, r() * 128, 1 + r() * 3, 1 + r() * 2);
    }
    // moss creeping up from the bottom, slime drips from the top
    for (let i = 0; i < 46; i++) {
      const x = r() * 256;
      const gr = g.createLinearGradient(0, 128, 0, 128 - 20 - r() * 34);
      gr.addColorStop(0, 'rgba(60,120,60,0.55)');
      gr.addColorStop(1, 'rgba(60,120,60,0)');
      g.fillStyle = gr;
      g.fillRect(x, 60, 8 + r() * 12, 68);
    }
    g.fillStyle = 'rgba(90,160,110,0.22)';
    for (let i = 0; i < 9; i++) {
      const x = r() * 256;
      g.fillRect(x, 0, 2.5, 14 + r() * 30);
      g.beginPath();
      g.arc(x + 1.2, 14 + r() * 30, 2.4, 0, TAU);
      g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    for (let i = 0; i < 6; i++) {
      let x = r() * 256;
      let y = r() * 128;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 4; s++) {
        x += (r() - 0.5) * 16;
        y += r() * 14;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    return c;
  }

  function gateCanvas(letter, color) {
    const c = cv(256, 256);
    const g = c.getContext('2d');
    const r = rng(letter.charCodeAt(0));
    g.fillStyle = '#4b3220';
    g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 32) {
      g.fillStyle = `rgb(${72 + r() * 24},${48 + r() * 16},${30 + r() * 12})`;
      g.fillRect(x + 1.5, 0, 29, 256);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < 6; i++) g.fillRect(x + 4 + r() * 20, r() * 256, 1.5, 14 + r() * 30);
    }
    g.fillStyle = '#20232b';
    g.fillRect(0, 44, 256, 16);
    g.fillRect(0, 196, 256, 16);
    g.fillStyle = '#8b93a1';
    for (let x = 12; x < 256; x += 36) {
      g.beginPath();
      g.arc(x, 52, 3.4, 0, TAU);
      g.arc(x, 204, 3.4, 0, TAU);
      g.fill();
    }
    g.fillStyle = 'rgba(8,8,16,0.82)';
    g.beginPath();
    g.arc(128, 128, 68, 0, TAU);
    g.fill();
    g.lineWidth = 9;
    g.strokeStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 22;
    g.stroke();
    g.fillStyle = '#fff';
    g.font = '900 100px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 128, 138);
    return c;
  }

  function labelCanvas(text, color, size) {
    const c = cv(128, 128);
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(10,10,24,0.85)';
    g.beginPath();
    g.arc(64, 64, 52, 0, TAU);
    g.fill();
    g.lineWidth = 7;
    g.strokeStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = '#fff';
    g.font = `900 ${size || 64}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 70);
    return c;
  }

  /* ------------------------------------------------------- world build */

  function buildWorld() {
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(48, 1, 6, 9000);
    const R = rng(hashLayout());
    const root = new T.Group();
    scene.add(root);
    const mesh = (geo, mat, x, y, z, parent, shadow) => {
      const m = new T.Mesh(geo, mat);
      m.position.set(x || 0, y || 0, z || 0);
      if (shadow !== false) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
      (parent || root).add(m);
      return m;
    };
    const boxGeo = new T.BoxGeometry(1, 1, 1);
    const totalW = cols * cell;
    const totalH = rows * cell;

    shadowTex = radialTex([[0, 'rgba(0,0,0,0.6)'], [0.6, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']]);
    glowTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
    {
      const c = cv(64, 128);
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, 'rgba(255,245,200,0.95)');
      gr.addColorStop(1, 'rgba(255,245,200,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 128);
      coneTex = tex(c);
    }

    /* atmosphere */
    const fogColor = new T.Color('#0a0d1e');
    scene.background = fogColor;
    scene.fog = new T.FogExp2(fogColor, 0.00135);
    const skyU = { top: { value: new T.Color('#050818') }, mid: { value: new T.Color('#1b2450') }, moon: { value: new T.Vector3(0.5, 0.6, -0.6).normalize() } };
    const skyVS = 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
    const skyFS = `uniform vec3 top; uniform vec3 mid; uniform vec3 moon; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(mid, top, pow(max(h, 0.0), 0.5)); if (h < 0.0) col = mix(mid, vec3(0.03,0.04,0.09), clamp(-h*5.0,0.0,1.0));
        float s = max(dot(d, normalize(moon)), 0.0); col += vec3(0.7,0.8,1.0) * (pow(s, 1200.0) * 3.0 + pow(s, 30.0) * 0.16);
        gl_FragColor = linearToOutputTexel(vec4(col, 1.0)); }`;
    const sky = new T.Mesh(new T.SphereGeometry(4200, 24, 16), new T.ShaderMaterial({ uniforms: skyU, vertexShader: skyVS, fragmentShader: skyFS, side: T.BackSide, depthWrite: false, fog: false }));
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);
    // stars
    {
      const N = 500;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const a = R() * TAU;
        const e = 0.15 + R() * 1.3;
        const rad = 4000;
        pos[i * 3] = Math.cos(a) * Math.cos(e) * rad;
        pos[i * 3 + 1] = Math.sin(e) * rad;
        pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * rad;
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      const stars = new T.Points(g, new T.PointsMaterial({ color: 0xdbe6ff, size: 9, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false, depthWrite: false }));
      stars.frustumCulled = false;
      sky.add(stars);
      stars.scale.setScalar(1);
    }
    try {
      const envScene = new T.Scene();
      envScene.add(new T.Mesh(new T.SphereGeometry(20, 16, 12), new T.ShaderMaterial({ uniforms: skyU, vertexShader: skyVS, fragmentShader: skyFS, side: T.BackSide, depthWrite: false, fog: false })));
      const pm = new T.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(envScene, 0.02, 1, 60).texture;
      pm.dispose();
    } catch (e) {
      scene.environment = null;
    }

    const hemi = new T.HemisphereLight(0x8a9ce0, 0x1c1626, 0.6);
    scene.add(hemi);
    const moon = new T.DirectionalLight(0xa9bcff, 1.25);
    moon.castShadow = true;
    moon.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    const sc = moon.shadow.camera;
    sc.left = -520;
    sc.right = 520;
    sc.top = 520;
    sc.bottom = -520;
    sc.near = 10;
    sc.far = 2200;
    moon.shadow.bias = -0.0005;
    moon.shadow.normalBias = 1.2;
    scene.add(moon, moon.target);
    const lamp = new T.PointLight(0xffd6a0, 1.5, 330, 1.4);
    scene.add(lamp);

    /* ground */
    const floorTex = tex(floorCanvas(quality.texScale, hashLayout()));
    const floor = new T.Mesh(new T.PlaneGeometry(totalW, totalH), std(0xffffff, 0.92, 0, { map: floorTex }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(totalW / 2, 0, totalH / 2);
    floor.receiveShadow = true;
    root.add(floor);
    const outer = new T.Mesh(new T.PlaneGeometry(9000, 9000), std(0x0f1a14, 1));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(totalW / 2, -1, totalH / 2);
    outer.receiveShadow = true;
    root.add(outer);

    /* walls: two instanced meshes, thick stone with capstones */
    const segs = [];
    for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) if (hw[r][c]) segs.push({ x: c * cell + cell / 2, z: r * cell, sx: cell + P.wallT, sz: P.wallT });
    for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) if (vw[r][c]) segs.push({ x: c * cell, z: r * cell + cell / 2, sx: P.wallT, sz: cell + P.wallT });
    const wallMat = std(0xffffff, 0.88, 0, { map: tex(wallCanvas()) });
    const wallI = new T.InstancedMesh(boxGeo, wallMat, segs.length);
    const capI = new T.InstancedMesh(boxGeo, std(0x4a4d5e, 0.7), segs.length);
    const m4 = new T.Matrix4();
    const q4 = new T.Quaternion();
    const col = new T.Color();
    segs.forEach((s, i) => {
      m4.compose(new T.Vector3(s.x, WALL_H / 2, s.z), q4, new T.Vector3(s.sx, WALL_H, s.sz));
      wallI.setMatrixAt(i, m4);
      const v = 0.72 + R() * 0.4;
      col.setRGB(v, v, v * 1.04);
      wallI.setColorAt(i, col);
      m4.compose(new T.Vector3(s.x, WALL_H + 2.5, s.z), q4, new T.Vector3(s.sx + 3, 5, s.sz + 4));
      capI.setMatrixAt(i, m4);
    });
    wallI.castShadow = wallI.receiveShadow = true;
    capI.castShadow = capI.receiveShadow = true;
    root.add(wallI, capI);

    // corner pillars + torches
    const corners = [];
    const touches = (r, c) => (r > 0 && vw[r - 1] && vw[r - 1][c]) || (r < rows && vw[r] && vw[r][c]) || (c > 0 && hw[r][c - 1]) || (c < cols && hw[r][c]);
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) if (touches(r, c)) corners.push({ x: c * cell, z: r * cell, r, c });
    const pillarI = new T.InstancedMesh(new T.CylinderGeometry(8.5, 9.5, WALL_H + 12, 8), std(0x3d4052, 0.8), corners.length);
    corners.forEach((p, i) => {
      m4.compose(new T.Vector3(p.x, (WALL_H + 12) / 2, p.z), q4, new T.Vector3(1, 1, 1));
      pillarI.setMatrixAt(i, m4);
    });
    pillarI.castShadow = pillarI.receiveShadow = true;
    root.add(pillarI);

    const torchSpots = corners.filter((p) => p.r > 0 && p.r < rows && p.c > 0 && p.c < cols && R() < 0.2);
    const torches = [];
    const flameMat = () => new T.SpriteMaterial({ map: glowTex, color: 0xff9a3c, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.9 });
    const poolTex = radialTex([[0, 'rgba(255,170,80,0.55)'], [0.5, 'rgba(255,140,60,0.16)'], [1, 'rgba(255,120,40,0)']], 96);
    for (const p of torchSpots) {
      const holder = mesh(new T.CylinderGeometry(1.6, 2.4, 14, 6), std(0x1f1a17, 0.9), p.x, WALL_H - 4, p.z, root);
      holder.castShadow = false;
      const flame = new T.Sprite(flameMat());
      flame.position.set(p.x, WALL_H + 9, p.z);
      flame.scale.set(26, 34, 1);
      root.add(flame);
      const pool = new T.Mesh(new T.PlaneGeometry(190, 190), new T.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(p.x, 1.3, p.z);
      root.add(pool);
      torches.push({ flame, pool, ph: R() * TAU });
    }

    /* props on the side of some cells (purely decorative) */
    const special = new Set([P.start, P.toilet, ...P.keys, ...P.doors].map((o) => Math.floor(o.y / cell) * cols + Math.floor(o.x / cell)));
    const propMat = { wood: std(0x5a3d22, 0.9), iron: std(0x22252c, 0.5, 0.6), stone: std(0x4b4e5c, 0.85), bone: std(0xd9d2bd, 0.8), pumpkin: std(0xe0721c, 0.7), wax: std(0xe8dcc0, 0.8) };
    const candleSpots = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (special.has(r * cols + c) || R() > 0.3) continue;
        const cx = c * cell + cell / 2 + (R() < 0.5 ? -1 : 1) * (28 + R() * 8);
        const cz = r * cell + cell / 2 + (R() < 0.5 ? -1 : 1) * (28 + R() * 8);
        const kind = Math.floor(R() * 5);
        const g = new T.Group();
        g.position.set(cx, 0, cz);
        g.rotation.y = R() * TAU;
        root.add(g);
        if (kind === 0) {
          mesh(boxGeo, propMat.wood, 0, 9, 0, g).scale.set(18, 18, 18);
          mesh(boxGeo, propMat.iron, 0, 9, 0, g).scale.set(19, 3, 19);
        } else if (kind === 1) {
          mesh(new T.CylinderGeometry(8, 9, 20, 10), propMat.wood, 0, 10, 0, g);
          mesh(new T.CylinderGeometry(9.2, 9.2, 2, 10), propMat.iron, 0, 6, 0, g);
          mesh(new T.CylinderGeometry(9.2, 9.2, 2, 10), propMat.iron, 0, 15, 0, g);
        } else if (kind === 2) {
          mesh(boxGeo, propMat.stone, 0, 11, 0, g).scale.set(14, 22, 5);
          mesh(new T.CylinderGeometry(7, 7, 5, 12), propMat.stone, 0, 22, 0, g).rotation.x = Math.PI / 2;
        } else if (kind === 3) {
          for (let k = 0; k < 4; k++) mesh(new T.SphereGeometry(4.6, 8, 6), propMat.bone, (R() - 0.5) * 12, 4.4 + (k > 2 ? 6 : 0), (R() - 0.5) * 12, g);
        } else {
          const pk = mesh(new T.SphereGeometry(9, 12, 9), propMat.pumpkin, 0, 8, 0, g);
          pk.scale.set(1.15, 0.85, 1.15);
          mesh(new T.CylinderGeometry(1.4, 2, 5, 6), std(0x2c5a2a, 0.9), 0, 16, 0, g);
          candleSpots.push({ x: cx, z: cz, y: 10 });
        }
        if (kind === 4 || R() < 0.15) {
          mesh(new T.CylinderGeometry(2.2, 2.4, 9, 8), propMat.wax, 8, 4.5, 6, g);
          candleSpots.push({ x: cx + 8, z: cz + 6, y: 12 });
        }
      }
    }
    const candleFlames = candleSpots.map((s) => {
      const f = new T.Sprite(flameMat());
      f.position.set(s.x, s.y, s.z);
      f.scale.set(11, 15, 1);
      root.add(f);
      return { f, ph: R() * TAU };
    });

    /* dust motes floating in the air */
    const dustN = mobile ? 90 : 180;
    const dustPos = new Float32Array(dustN * 3);
    const dustSeed = [];
    for (let i = 0; i < dustN; i++) dustSeed.push({ x: R() * 700 - 350, y: R() * 90 + 6, z: R() * 700 - 350, s: 0.3 + R() });
    const dustGeo = new T.BufferGeometry();
    dustGeo.setAttribute('position', new T.BufferAttribute(dustPos, 3));
    const dust = new T.Points(dustGeo, new T.PointsMaterial({ color: 0xb8c8ff, size: 3.2, transparent: true, opacity: 0.5, depthWrite: false, blending: T.AdditiveBlending }));
    dust.frustumCulled = false;
    scene.add(dust);

    /* start pad */
    {
      const c = cv(256, 256);
      const g = c.getContext('2d');
      g.strokeStyle = 'rgba(80,255,150,0.9)';
      g.lineWidth = 10;
      g.beginPath();
      g.arc(128, 128, 112, 0, TAU);
      g.stroke();
      g.fillStyle = 'rgba(80,255,150,0.16)';
      g.fill();
      g.fillStyle = 'rgba(160,255,200,0.95)';
      g.font = '900 54px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('START', 128, 132);
      const pad = new T.Mesh(new T.PlaneGeometry(90, 90), new T.MeshBasicMaterial({ map: tex(c), transparent: true, depthWrite: false, fog: false }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(P.start.x, 1.4, P.start.y);
      root.add(pad);
    }

    world = { root, hemi, moon, lamp, sky, skyU, torches, candleFlames, dust, dustSeed, dustPos, fogColor, R, mesh, boxGeo };
    buildDoorsKeysToilet();
  }

  function hashLayout() {
    let h = 2166136261;
    const s = P.hW.join('') + P.vW.join('');
    for (let i = 0; i < s.length; i += 3) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function buildDoorsKeysToilet() {
    const { root, mesh } = world;
    keyObjs = new Map();
    doorObjs = new Map();

    // locked rooms: a heavy wooden gate block that sinks into the floor when its key is won
    for (const d of P.doors) {
      const color = KEY_COL[d.letter.toLowerCase()];
      const gtex = tex(gateCanvas(d.letter, color));
      const side = new T.MeshStandardMaterial({ map: gtex, roughness: 0.7, metalness: 0.1, emissive: new T.Color(color), emissiveMap: gtex, emissiveIntensity: 0.06 });
      const top = std(0x3a2a1c, 0.9);
      const grp = new T.Group();
      grp.position.set(d.x, 0, d.y);
      root.add(grp);
      const block = new T.Mesh(new T.BoxGeometry(cell - 6, WALL_H + 6, cell - 6), [side, side, top, top, side, side]);
      block.position.y = (WALL_H + 6) / 2;
      block.castShadow = block.receiveShadow = true;
      grp.add(block);
      const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: new T.Color(color), transparent: true, opacity: 0.7, depthWrite: false, blending: T.AdditiveBlending }));
      halo.scale.set(150, 150, 1);
      halo.position.y = 60;
      grp.add(halo);
      const lbl = new T.Sprite(new T.SpriteMaterial({ map: tex(labelCanvas(d.letter, color, 70)), transparent: true, depthWrite: false }));
      lbl.scale.set(46, 46, 1);
      lbl.position.y = WALL_H + 40;
      grp.add(lbl);
      doorObjs.set(d.letter, { grp, halo, lbl, open: 0, was: false, mats: [side] });
    }

    // keys
    for (const k of P.keys) {
      const color = KEY_COL[k.letter];
      const grp = new T.Group();
      grp.position.set(k.x, 0, k.y);
      root.add(grp);
      const gold = new T.MeshStandardMaterial({ color: new T.Color(color), emissive: new T.Color(color), emissiveIntensity: 0.55, metalness: 0.85, roughness: 0.25 });
      const body = new T.Group();
      body.position.y = 30;
      body.rotation.z = Math.PI / 2 - 0.5;
      grp.add(body);
      const ring = new T.Mesh(new T.TorusGeometry(7, 2.6, 8, 20), gold);
      ring.position.set(0, 13, 0);
      body.add(ring);
      const shaft = new T.Mesh(new T.CylinderGeometry(1.9, 1.9, 26, 8), gold);
      body.add(shaft);
      for (const [y, l] of [[-9, 8], [-13, 6], [-4, 5]]) {
        const t = new T.Mesh(new T.BoxGeometry(l, 2.6, 2.6), gold);
        t.position.set(l / 2 + 1, y, 0);
        body.add(t);
      }
      const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: new T.Color(color), transparent: true, opacity: 0.85, depthWrite: false, blending: T.AdditiveBlending }));
      halo.scale.set(100, 100, 1);
      halo.position.y = 30;
      grp.add(halo);
      const lbl = new T.Sprite(new T.SpriteMaterial({ map: tex(labelCanvas(k.letter, color, 66)), transparent: true, depthWrite: false }));
      lbl.scale.set(32, 32, 1);
      lbl.position.y = 68;
      grp.add(lbl);
      const ringFloor = new T.Mesh(new T.RingGeometry(20, 24, 32), new T.MeshBasicMaterial({ color: new T.Color(color), transparent: true, opacity: 0.6, depthWrite: false, side: T.DoubleSide, fog: false }));
      ringFloor.rotation.x = -Math.PI / 2;
      ringFloor.position.y = 1.6;
      grp.add(ringFloor);
      keyObjs.set(k.letter, { grp, body, halo, lbl, ringFloor, taken: false, gone: 0 });
    }

    // the toilet
    const tg = new T.Group();
    tg.position.set(P.toilet.x, 0, P.toilet.y);
    // face the open corridor
    const tr = Math.floor(P.toilet.y / cell);
    const tc = Math.floor(P.toilet.x / cell);
    let face = 0;
    const open = [];
    if (tr > 0 && !hw[tr][tc]) open.push(-Math.PI / 2);
    if (tr < rows - 1 && !hw[tr + 1][tc]) open.push(Math.PI / 2);
    if (tc > 0 && !vw[tr][tc]) open.push(Math.PI);
    if (tc < cols - 1 && !vw[tr][tc + 1]) open.push(0);
    face = open.length ? open[0] : 0;
    tg.rotation.y = face;
    root.add(tg);
    const porcelain = new T.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.18, metalness: 0.05, emissive: 0x334455, emissiveIntensity: 0.25 });
    const bowlProfile = [[0, 0], [9, 0], [12, 3], [16, 12], [18, 20], [17, 25], [15, 26.5], [13.5, 25], [14.5, 20], [12, 10], [7, 5], [0, 4]].map(([x, y]) => new T.Vector2(x, y));
    const bowl = new T.Mesh(new T.LatheGeometry(bowlProfile, 24), porcelain);
    bowl.scale.set(1.15, 1, 0.9);
    bowl.position.x = 3;
    bowl.castShadow = bowl.receiveShadow = true;
    tg.add(bowl);
    const seat = new T.Mesh(new T.TorusGeometry(15, 2.3, 8, 28), std(0xe8edf5, 0.3));
    seat.scale.set(1.12, 0.9, 1);
    seat.rotation.x = Math.PI / 2;
    seat.position.set(3, 27, 0);
    seat.castShadow = true;
    tg.add(seat);
    const tank = mesh(world.boxGeo, porcelain, -13, 22, 0, tg);
    tank.scale.set(10, 32, 30);
    mesh(world.boxGeo, std(0xdde3ea, 0.3), -13, 39.5, 0, tg).scale.set(12, 3, 32);
    mesh(new T.CylinderGeometry(1.2, 1.2, 9, 6), std(0xc8ced6, 0.3, 0.9), -7, 34, 8, tg).rotation.z = Math.PI / 2;
    const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffd35a, transparent: true, opacity: 0.9, depthWrite: false, blending: T.AdditiveBlending }));
    glow.scale.set(210, 210, 1);
    glow.position.set(P.toilet.x, 30, P.toilet.y);
    root.add(glow);
    const beam = new T.Mesh(
      new T.CylinderGeometry(20, 20, 420, 20, 1, true),
      new T.MeshBasicMaterial({ map: (() => { const c = cv(4, 128); const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,214,90,0)'); gr.addColorStop(1, 'rgba(255,230,140,0.9)'); g.fillStyle = gr; g.fillRect(0, 0, 4, 128); return tex(c); })(), transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false })
    );
    beam.position.set(P.toilet.x, 210, P.toilet.y);
    root.add(beam);
    const goldLight = new T.PointLight(0xffd070, 1.4, 280, 1.5);
    goldLight.position.set(P.toilet.x, 60, P.toilet.y);
    root.add(goldLight);
    const wc = new T.Sprite(new T.SpriteMaterial({ map: tex(labelCanvas('🚽', '#ffd35a', 62)), transparent: true, depthWrite: false }));
    wc.scale.set(46, 46, 1);
    wc.position.set(P.toilet.x, 88, P.toilet.y);
    root.add(wc);
    toilet = { grp: tg, glow, beam, wc, goldLight };

    entityGroup = new T.Group();
    scene.add(entityGroup);
    for (let i = 0; i < 90; i++) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0, blending: T.AdditiveBlending }));
      sp.visible = false;
      scene.add(sp);
      particles.push({ sp, v: new T.Vector3(), life: 0, max: 1, size: 8, grav: 0 });
    }
  }

  /* -------------------------------------------------------- characters */

  const SOLDIER_SCALE = 40;

  function buildSoldier(idx) {
    let s0;
    if (Soldier.ready()) {
      s0 = Soldier.create({ scale: SOLDIER_SCALE, tint: TINTS[idx % TINTS.length], tintMix: 0.5 });
    } else {
      // fallback figure if the model failed to load
      const root = new T.Group();
      const inner = new T.Group();
      root.add(inner);
      const b0 = new T.Mesh(new T.CapsuleGeometry(10, 34, 4, 10), new T.MeshStandardMaterial({ color: TINTS[idx % TINTS.length] }));
      b0.position.y = 32;
      b0.castShadow = true;
      inner.add(b0);
      s0 = { root, inner, scale: 40 };
    }
    const k = s0.scale / 27;
    const blob = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.scale.set(32 * k, 32 * k, 1);
    blob.position.y = 0.9;
    s0.root.add(blob);
    // torch beam
    const cone = new T.Mesh(new T.ConeGeometry(34, 140, 18, 1, true), new T.MeshBasicMaterial({ map: coneTex, transparent: true, opacity: 0.16, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false }));
    cone.rotation.z = -Math.PI / 2; // apex at the origin pointing +X (forward)
    cone.geometry.translate(0, -70, 0);
    cone.position.set(14, 40, 10);
    s0.root.add(cone);
    return Object.assign(s0, { blob, cone, h: 0, seen: false, px: 0, py: 0, phase: Math.random() * TAU });
  }

  function animateSoldier(p, dt, moving, speed, st) {
    if (p.mixer) Soldier.update(p, dt, Object.assign({ moving, speed, time: nowT }, st));
    const flashing = !!(st && st.flashing);
    p.cone.material.opacity = flashing ? 0.7 : p.isMe ? 0.07 : 0.035;
    p.cone.scale.set(flashing ? 1.8 : 1, flashing ? 1.6 : 1, flashing ? 1.8 : 1);
  }

  const smoothstep = (a0, a1, x) => {
    const k = clamp((x - a0) / (a1 - a0), 0, 1);
    return k * k * (3 - 2 * k);
  };
  // body language from the bladder level and the server's state flags
  function poseOf(b, flags) {
    const clench = flags & 256 ? 1 : 0;
    const shame = flags & 128 ? 1 : 0;
    return {
      hold: shame ? 0 : Math.max(smoothstep(60, 86, b), clench),
      squeeze: shame ? 0 : smoothstep(50, 80, b),
      hunch: shame ? 0 : smoothstep(62, 92, b),
      hop: shame ? 0 : smoothstep(48, 96, b) * (0.35 + 0.65 * smoothstep(70, 100, b)),
      butt: shame ? 0 : clench,
      shame,
      shout: flags & 1024 ? 1 : 0,
    };
  }

  function buildGhost(i) {
    const root = new T.Group();
    const profile = [];
    const H = 62;
    const N = 12;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const r = t < 0.62 ? 24 - t * 4 : 21.5 * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.62) / 0.38, 2)));
      profile.push(new T.Vector2(Math.max(0.01, r), t * H));
    }
    const geo = new T.LatheGeometry(profile, 26);
    const base = Float32Array.from(geo.attributes.position.array);
    const mat = new T.MeshStandardMaterial({ color: 0xeaf6ff, emissive: 0x7fc8ff, emissiveIntensity: 0.6, roughness: 0.35, transparent: true, opacity: 0.82, side: T.DoubleSide, depthWrite: false });
    const body = new T.Mesh(geo, mat);
    body.castShadow = false;
    root.add(body);
    const dark = new T.MeshBasicMaterial({ color: 0x05070f });
    const eyeGlow = new T.MeshBasicMaterial({ color: 0xff3d3d, toneMapped: false });
    const eyes = [];
    for (const z of [-8, 8]) {
      const e = new T.Mesh(new T.SphereGeometry(4.4, 10, 8), dark);
      e.scale.set(0.7, 1.5, 1);
      e.position.set(20, 44, z);
      root.add(e);
      const p = new T.Mesh(new T.SphereGeometry(1.9, 8, 6), eyeGlow);
      p.position.set(23, 44, z);
      p.visible = false;
      root.add(p);
      eyes.push(p);
    }
    const mouth = new T.Mesh(new T.SphereGeometry(4.5, 10, 8), dark);
    mouth.scale.set(0.6, 1.3, 1);
    mouth.position.set(21.5, 33, 0);
    root.add(mouth);
    const arms = [];
    for (const z of [-1, 1]) {
      const a = new T.Mesh(new T.CapsuleGeometry(3.6, 15, 4, 8), mat);
      a.position.set(6, 34, z * 22);
      a.rotation.x = z * 0.9;
      root.add(a);
      arms.push(a);
    }
    const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0x77c8ff, transparent: true, opacity: 0.55, depthWrite: false, blending: T.AdditiveBlending }));
    halo.scale.set(120, 120, 1);
    halo.position.y = 34;
    root.add(halo);
    const blob = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.6 }));
    blob.rotation.x = -Math.PI / 2;
    blob.scale.set(46, 46, 1);
    blob.position.y = 0.9;
    scene.add(blob);
    return { root, geo, base, mat, eyes, mouth, arms, halo, blob, h: 0, seen: false, px: 0, py: 0, ph: i * 1.7, mode: 0, stars: null };
  }

  function tintGhost(g, mode) {
    if (g.mode === mode) return;
    g.mode = mode;
    const chase = mode === 1;
    g.mat.emissive.set(chase ? 0xff5a5a : mode === 2 ? 0x3a6a9a : 0x7fc8ff);
    g.mat.opacity = mode === 2 ? 0.45 : mode === 3 ? 0.5 : chase ? 0.92 : 0.8;
    g.halo.material.color.set(chase ? 0xff4444 : 0x77c8ff);
    g.eyes.forEach((e) => (e.visible = chase));
  }

  /* -------------------------------------------------- effects/particles */

  function burst(x, y, z, color, n, speed, size, life, grav) {
    let made = 0;
    for (const p of particles) {
      if (p.life > 0) continue;
      p.sp.position.set(x, y, z);
      p.sp.material.color.set(color);
      const a = Math.random() * TAU;
      const u = Math.random() * 2 - 1;
      const s = (speed || 60) * (0.4 + Math.random() * 0.8);
      p.v.set(Math.cos(a) * Math.sqrt(1 - u * u) * s, Math.abs(u) * s + 20, Math.sin(a) * Math.sqrt(1 - u * u) * s);
      p.max = p.life = (life || 0.7) * (0.7 + Math.random() * 0.6);
      p.size = (size || 8) * (0.7 + Math.random() * 0.7);
      p.grav = grav == null ? 120 : grav;
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

  /* ---- stink clouds ---- */
  let smoke = [];
  function makeSmoke() {
    smoke = [];
    for (let i = 0; i < 70; i++) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0, color: 0xb5cf6a }));
      sp.visible = false;
      scene.add(sp);
      smoke.push({ sp, v: new T.Vector3(), life: 0, max: 1, size: 20 });
    }
  }
  function puff(x, y, z, n, color, size, life, rise) {
    let made = 0;
    for (const p of smoke) {
      if (p.life > 0) continue;
      p.sp.position.set(x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 8, z + (Math.random() - 0.5) * 10);
      p.sp.material.color.set(color);
      const a = Math.random() * TAU;
      p.v.set(Math.cos(a) * (4 + Math.random() * 16), (rise || 20) * (0.6 + Math.random() * 0.7), Math.sin(a) * (4 + Math.random() * 16));
      p.max = p.life = (life || 1.4) * (0.75 + Math.random() * 0.5);
      p.size = (size || 20) * (0.7 + Math.random() * 0.5);
      p.sp.visible = true;
      if (++made >= n) break;
    }
  }
  function stepSmoke(dt) {
    for (const p of smoke) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sp.visible = false;
        continue;
      }
      p.sp.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(1 - dt * 0.8);
      const k = p.life / p.max;
      p.sp.material.opacity = Math.min(0.55, k * 0.8);
      p.sp.scale.setScalar(p.size * (1.7 - k * 0.7));
    }
  }
  const TOOT_WORDS = ['PFFT!', 'PRRT!', 'BRAAP!', 'toot!', 'psst…', 'BLURP!', 'PFFFRT!', 'phbbt!'];

  function fxEvent(e) {
    if (!scene) return;
    const idx = indexById.get(e.playerId);
    const o = playerObjs[idx];
    const pos = o ? o.root.position : { x: me.x, z: me.y };
    if (e.type === 'flash') {
      fx.push({ kind: 'ring', x: pos.x, z: pos.z, born: nowT, life: 0.6, color: '#fff2b0' });
      burst(pos.x, 30, pos.z, '#fff2b0', 18, 130, 9, 0.5, 0);
    } else if (e.type === 'caught') {
      burst(pos.x, 34, pos.z, '#9fd8ff', 26, 120, 10, 0.8, 60);
      fx.push({ kind: 'text', text: '👻 BOO!', color: '#bfe6ff', x: pos.x, z: pos.z, born: nowT, life: 1.4 });
      if (idx === meIdx && !reduceMotion) cam.shake = Math.max(cam.shake, 14);
    } else if (e.type === 'key') {
      const k = keyObjs.get(e.letter);
      if (k && idx === meIdx) burst(k.grp.position.x, 34, k.grp.position.z, KEY_COL[e.letter], 34, 150, 11, 1, 40);
      fx.push({ kind: 'text', text: `🔑 ${e.letter.toUpperCase()}!`, color: KEY_COL[e.letter], x: pos.x, z: pos.z, born: nowT, life: 1.6 });
    } else if (e.type === 'fart' || e.type === 'accident' || e.type === 'relief' || e.type === 'shout') {
      const h = o && o.h !== undefined ? o.h : 0;
      const bx = pos.x - Math.cos(h) * 18;
      const bz = pos.z + Math.sin(h) * 18;
      if (e.type === 'fart') {
        puff(bx, 34, bz, e.big ? 16 : 9, '#b5cf6a', e.big ? 30 : 22, e.big ? 2.2 : 1.5, 18);
        if (!reduceMotion) fx.push({ kind: 'text', text: TOOT_WORDS[(e.kind || 0) % TOOT_WORDS.length], color: '#c8e58a', x: pos.x, z: pos.z, born: nowT, life: 1.2 });
      } else if (e.type === 'accident') {
        puff(pos.x, 30, pos.z, 30, '#8fb04c', 38, 3, 16);
        puff(pos.x, 46, pos.z, 12, '#6d7c3a', 30, 3.4, 22);
        fx.push({ kind: 'text', text: '💩 OOPS!', color: '#e0c56a', x: pos.x, z: pos.z, born: nowT, life: 2.4 });
        if (idx === meIdx && !reduceMotion) cam.shake = Math.max(cam.shake, 9);
      } else if (e.type === 'relief') {
        burst(pos.x, 40, pos.z, '#ffe27a', 30, 120, 12, 1, 40);
        fx.push({ kind: 'text', text: '😌 AAAH!', color: '#ffe27a', x: pos.x, z: pos.z, born: nowT, life: 2 });
      } else {
        fx.push({ kind: 'text', text: '📢 AAAAH!', color: '#bfe6ff', x: pos.x, z: pos.z, born: nowT, life: 1.4 });
        fx.push({ kind: 'ring', x: pos.x, z: pos.z, born: nowT, life: 0.7, color: '#bfe6ff' });
      }
    }
  }

  function say(playerId, text) {
    const idx = indexById.get(playerId);
    if (idx === undefined) return;
    bubbles.set(idx, { text: String(text).slice(0, 34), until: nowT + 3.2 });
  }

  function floatText(text, color) {
    fx.push({ kind: 'text', text, color: color || '#ffe08a', x: me.x, z: me.y, born: nowT, life: 1.6 });
  }

  /* -------------------------------------------------------- start / state */

  function start(payload, myPlayerId, h, opts) {
    hooks = h || hooks;
    P = payload;
    parseLayout(payload);
    players = payload.players;
    indexById = new Map(players.map((p, i) => [p.playerId, i]));
    meIdx = indexById.has(myPlayerId) ? indexById.get(myPlayerId) : -1;
    offset = payload.serverNow - Date.now();
    startsAt = payload.startsAt;
    snaps = [];
    fx.length = 0;
    bubbles.clear();
    goPath = null;
    opened = new Set();
    bladder = 0;
    me = { x: 0, y: 0, face: -1, init: false, flags: 0 };
    if (scene) {
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    particles = [];
    smoke = [];
    buildWorld();
    makeSmoke();
    playerObjs = players.map(() => null);
    ghostObjs = [];
    for (let i = 0; i < payload.ghostCount; i++) {
      const g = buildGhost(i);
      entityGroup.add(g.root);
      ghostObjs.push(g);
    }
    cam.yaw = cam.yawT = 0;
    cam.pitch = cam.pitchT = 1.15;
    cam.dist = cam.distT = 380;
    lightning = { at: 0, until: 0, next: nowT + 12 + Math.random() * 10 };
    if (payload.snapshot) applyState(payload.snapshot);
    running = false;
    resize();
    if (opts && opts.paused) return;
    Promise.race([Soldier.load(), new Promise((r) => setTimeout(r, 7000))]).then(begin);
  }

  function begin() {
    if (!canvas || running) return;
    running = true;
    last = performance.now() / 1000;
    requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    keys.up = keys.down = keys.left = keys.right = keys.rotL = keys.rotR = false;
    joy = { x: 0, y: 0 };
  }

  function applyState(s) {
    snaps.push(s);
    if (snaps.length > 12) snaps.shift();
    bladder = s.b;
    s.open.forEach((l) => opened.add(l));
    const mine = s.p.find((e) => e[0] === meIdx);
    if (!mine) return;
    const [, sx, sy, face, flags] = mine;
    me.flags = flags;
    if (!me.init) {
      me.x = sx;
      me.y = sy;
      me.face = face;
      me.init = true;
      cam.x = sx;
      cam.z = sy;
      return;
    }
    const err = Math.hypot(sx - me.x, sy - me.y);
    if (err > 90 || flags & (1 | 8)) {
      me.x = sx;
      me.y = sy;
    } else if (err > 3) {
      me.x += (sx - me.x) * 0.25;
      me.y += (sy - me.y) * 0.25;
    }
  }

  function sample(t) {
    if (!snaps.length) return null;
    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let i = 0; i < snaps.length - 1; i++) {
      if (snaps[i].t <= t && snaps[i + 1].t >= t) {
        a = snaps[i];
        b = snaps[i + 1];
        break;
      }
    }
    const k = b.t === a.t ? 1 : clamp((t - a.t) / (b.t - a.t), 0, 1);
    const l = (u, v) => u + (v - u) * k;
    return {
      p: b.p.map((e, i) => {
        const o = a.p[i] || e;
        return { idx: e[0], x: l(o[1], e[1]), y: l(o[2], e[2]), face: e[3], flags: e[4], keys: e[5], points: e[6], bladder: e[8] || 0 };
      }),
      g: b.g.map((e, i) => {
        const o = a.g[i] || e;
        return { x: l(o[0], e[0]), y: l(o[1], e[1]), mode: e[2] };
      }),
      b: b.b,
    };
  }

  /* ---------------------------------------------------------- per frame */

  function facing(obj, x, y, dt, fallback) {
    if (!obj.seen) {
      obj.px = x;
      obj.py = y;
      obj.seen = true;
      obj.h = fallback;
      return { moved: 0, speed: 0 };
    }
    const dx = x - obj.px;
    const dy = y - obj.py;
    const d = Math.hypot(dx, dy);
    obj.px = x;
    obj.py = y;
    if (d > 0.08) obj.h += angDiff(obj.h, Math.atan2(-dy, dx)) * Math.min(1, dt * 12);
    return { moved: d, speed: dt > 0 ? d / dt : 0 };
  }

  function syncEntities(s, dt) {
    labels.length = 0;
    let nearest = 1e9;
    for (const e of s.p) {
      const o0 = playerObjs[e.idx];
      const info = players[e.idx];
      if (!info) continue;
      const isMe = e.idx === meIdx;
      const flags = isMe ? me.flags : e.flags;
      if (flags & (64 | 32)) {
        if (o0) o0.root.visible = false;
        continue;
      }
      const x = isMe ? me.x : e.x;
      const y = isMe ? me.y : e.y;
      let o = o0;
      if (!o) {
        o = playerObjs[e.idx] = buildSoldier(e.idx);
        o.isMe = isMe;
        entityGroup.add(o.root);
      }
      o.root.visible = true;
      const f = facing(o, x, y, dt, Math.PI);
      let moving = f.moved > 0.03;
      if (isMe) {
        const v = inputVector();
        moving = (!!(v.dx || v.dy) && !(flags & 9)) || f.moved > 0.2;
      }
      o.root.position.set(x, 0, y);
      o.root.rotation.y = o.h;
      const bl = isMe ? bladder : e.bladder;
      animateSoldier(o, dt, moving, f.speed, Object.assign({ stunned: !!(flags & 1), flashing: !!(flags & 512) }, poseOf(bl, flags)));
      o.pos = { x, y };
      labels.push({ x, z: y, h: 92, info, isMe, idx: e.idx, flags, bladder: bl });
      if (isMe && moving && Math.random() < dt * 8) burst(x, 2, y, '#7a7f96', 1, 14, 8, 0.5, -8);
    }

    // ghosts
    s.g.forEach((gs, i) => {
      const g = ghostObjs[i];
      if (!g) return;
      const f = facing(g, gs.x, gs.y, dt, 0);
      tintGhost(g, gs.mode);
      const bob = Math.sin(nowT * 2.4 + g.ph) * 4;
      const chase = gs.mode === 1;
      const stunned = gs.mode === 2;
      const hover = stunned ? 2 : 14 + bob;
      g.root.position.set(gs.x, hover, gs.y);
      g.root.rotation.y = g.h;
      g.root.rotation.z = stunned ? Math.sin(nowT * 6) * 0.35 : chase ? 0.14 : 0.04;
      g.root.scale.setScalar(chase ? 1.18 + Math.sin(nowT * 16) * 0.03 : 1);
      g.blob.position.set(gs.x, 0.9, gs.y);
      g.mouth.scale.set(0.6, chase ? 2.4 + Math.sin(nowT * 12) : 1.2, 1);
      g.arms.forEach((a, k) => (a.rotation.x = (k ? 1 : -1) * (0.9 + Math.sin(nowT * (chase ? 9 : 3) + k * 2) * (chase ? 0.7 : 0.3))));
      // waving hem
      const pos = g.geo.attributes.position;
      const arr = pos.array;
      for (let v = 0; v < arr.length; v += 3) {
        const y0 = g.base[v + 1];
        if (y0 < 22) {
          const ang = Math.atan2(g.base[v + 2], g.base[v]);
          const w = (1 - y0 / 22) * (3 + (chase ? 2.5 : 0));
          arr[v + 1] = y0 + Math.sin(ang * 6 + nowT * (chase ? 9 : 4)) * w;
        }
      }
      pos.needsUpdate = true;
      const dm = Math.hypot(me.x - gs.x, me.y - gs.y);
      if (chase || dm < 300) nearest = Math.min(nearest, chase ? dm : dm * 1.6);
      if (stunned && Math.random() < dt * 6) burst(gs.x, 46, gs.y, '#ffe27a', 1, 40, 8, 0.6, 30);
      if (chase && Math.random() < dt * 10) burst(gs.x, 20, gs.y, '#a4dcff', 1, 26, 9, 0.7, -10);
    });
    const dk = clamp(1 - nearest / 320, 0, 1);
    danger += (dk - danger) * Math.min(1, dt * 5);
    hooks.danger && hooks.danger(danger);
  }

  function updateCamera(dt) {
    const aspect = W / Math.max(1, H);
    camera.aspect = aspect;
    camera.fov = aspect < 0.9 ? 60 : 47;
    camera.updateProjectionMatrix();
    const tx = me.init ? me.x : (cols * cell) / 2;
    const tz = me.init ? me.y : (rows * cell) / 2;
    cam.x += (tx - cam.x) * Math.min(1, dt * 9);
    cam.z += (tz - cam.z) * Math.min(1, dt * 9);
    cam.yaw += angDiff(cam.yaw, cam.yawT) * Math.min(1, dt * 10);
    cam.pitch += (cam.pitchT - cam.pitch) * Math.min(1, dt * 8);
    cam.dist += (cam.distT - cam.dist) * Math.min(1, dt * 8);
    const boost = aspect < 0.9 ? 1 + (0.9 - aspect) * 0.9 : 1;
    const d = cam.dist * boost;
    const fx_ = Math.sin(cam.yaw);
    const fz_ = -Math.cos(cam.yaw);
    camPos.set(cam.x - fx_ * d * Math.cos(cam.pitch), d * Math.sin(cam.pitch) + 14, cam.z - fz_ * d * Math.cos(cam.pitch));
    if (cam.shake > 0.05) {
      camPos.x += (Math.random() - 0.5) * cam.shake;
      camPos.y += (Math.random() - 0.5) * cam.shake * 0.6;
      camPos.z += (Math.random() - 0.5) * cam.shake;
      cam.shake *= Math.pow(0.02, dt);
    }
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(cam.x + fx_ * 24, 18, cam.z + fz_ * 24);
    // a desperate bladder makes the world sway
    const sway = clamp((bladder - 65) / 35, 0, 1);
    if (sway > 0 && !reduceMotion) camera.rotation.z += Math.sin(nowT * 3.1) * 0.022 * sway;
    focus.x = cam.x;
    focus.z = cam.z;
  }

  function updateWorld(t, dt) {
    const w = world;
    const texel = 1040 / quality.shadowSize;
    const fxp = Math.round(focus.x / texel) * texel;
    const fzp = Math.round(focus.z / texel) * texel;
    w.moon.target.position.set(fxp, 0, fzp);
    w.moon.position.set(fxp + 380, 900, fzp + 300);
    w.moon.target.updateMatrixWorld();
    w.sky.position.copy(camPos);
    w.lamp.position.set(me.x, 58, me.y);
    // thunder and lightning now and then
    if (t > lightning.next && !reduceMotion) {
      lightning.at = t;
      lightning.until = t + 0.35;
      lightning.next = t + 22 + Math.random() * 25;
      hooks.thunder && setTimeout(hooks.thunder, 500);
    }
    const flashK = t < lightning.until ? Math.max(0, 1 - (t - lightning.at) / 0.35) * (Math.sin((t - lightning.at) * 60) > -0.3 ? 1 : 0.3) : 0;
    w.hemi.intensity = 0.6 + flashK * 2.6;
    w.moon.intensity = 1.25 + flashK * 2.4;
    // flames flicker
    for (const tr of w.torches) {
      const f = 0.85 + Math.sin(t * 11 + tr.ph) * 0.12 + Math.sin(t * 23 + tr.ph * 2) * 0.07;
      tr.flame.scale.set(24 * f, 34 * f, 1);
      tr.pool.material.opacity = 0.75 + f * 0.25;
    }
    for (const c of w.candleFlames) {
      const f = 0.85 + Math.sin(t * 13 + c.ph) * 0.15;
      c.f.scale.set(10 * f, 15 * f, 1);
    }
    // dust drifts around the camera focus
    const dp = w.dustPos;
    w.dustSeed.forEach((d, i) => {
      dp[i * 3] = focus.x + ((d.x + t * 6 * d.s + 350) % 700) - 350;
      dp[i * 3 + 1] = d.y + Math.sin(t * d.s + i) * 5;
      dp[i * 3 + 2] = focus.z + ((d.z + t * 3 * d.s + 350) % 700) - 350;
    });
    w.dust.geometry.attributes.position.needsUpdate = true;
    // doors sink, keys spin
    for (const [letter, d] of doorObjs) {
      const isOpen = opened.has(letter);
      if (isOpen && !d.was) {
        d.was = true;
        burst(d.grp.position.x, 30, d.grp.position.z, '#c9b08a', 30, 120, 16, 1, -20);
        hooks.doorOpen && hooks.doorOpen(letter);
      }
      d.open += ((isOpen ? 1 : 0) - d.open) * Math.min(1, dt * 2.6);
      d.grp.position.y = -(WALL_H + 14) * d.open;
      d.halo.material.opacity = 0.7 * (1 - d.open);
      d.lbl.material.opacity = 1 - d.open;
      d.grp.visible = d.open < 0.985;
    }
    for (const [letter, k] of keyObjs) {
      k.taken = opened.has(letter.toUpperCase());
      if (k.taken) {
        k.gone = Math.min(1, k.gone + dt * 3);
        k.grp.scale.setScalar(Math.max(0.001, 1 - k.gone));
        if (k.gone >= 1) k.grp.visible = false;
      }
      k.body.rotation.y = t * 2.2;
      k.body.position.y = 30 + Math.sin(t * 2.6) * 4;
      k.halo.material.opacity = 0.7 + Math.sin(t * 4) * 0.2;
    }
    const tb = 1 + Math.sin(t * 3) * 0.06;
    toilet.glow.scale.setScalar(200 * tb);
    toilet.beam.material.opacity = 0.7 + Math.sin(t * 2) * 0.2;
    toilet.wc.position.y = 88 + Math.sin(t * 2.4) * 4;
  }

  /* -------------------------------------------------------- overlay */

  const _v = new T.Vector3();
  function project(x, y, z) {
    _v.set(x, y, z).project(camera);
    let sx = (_v.x * 0.5 + 0.5) * W;
    let sy = (-_v.y * 0.5 + 0.5) * H;
    let behind = false;
    if (_v.z > 1) {
      behind = true;
      sx = W - sx;
      sy = H - sy;
    }
    return { x: sx, y: sy, behind };
  }

  function rr(c, x, y, w, h, r) {
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

  function drawOverlay() {
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, W, H);
    octx.textAlign = 'center';
    for (const L of labels) {
      const p = project(L.x, L.h + 10, L.z);
      if (p.behind || p.x < -80 || p.x > W + 80 || p.y < -60 || p.y > H + 60) continue;
      const dist = Math.hypot(camPos.x - L.x, camPos.y, camPos.z - L.z);
      const sc = clamp(360 / dist, 0.8, 1.2);
      const fs = 12.5 * sc;
      octx.font = `700 ${fs}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      const name = L.info.name.length > 9 ? L.info.name.slice(0, 8) + '…' : L.info.name;
      const label = `${L.info.avatar} ${name}`;
      const w = octx.measureText(label).width + 14;
      octx.fillStyle = L.isMe ? 'rgba(255,210,63,0.94)' : 'rgba(10,14,36,0.8)';
      rr(octx, p.x - w / 2, p.y - fs - 6, w, fs + 10, 9);
      octx.fill();
      octx.fillStyle = L.isMe ? '#2a1b00' : '#fff';
      octx.fillText(label, p.x, p.y - 3);
      const dance = (L.bladder || 0) > 70;
      if (L.flags & 1) {
        octx.font = `${16 * sc}px system-ui, "Apple Color Emoji", sans-serif`;
        for (let k = 0; k < 3; k++) {
          const a = nowT * 5 + k * 2.1;
          octx.fillText('⭐', p.x + Math.cos(a) * 18, p.y - fs - 14 + Math.sin(a) * 5);
        }
      } else if (L.flags & 8) {
        octx.font = `${20 * sc}px system-ui, "Apple Color Emoji", sans-serif`;
        octx.fillText('💭', p.x + 26, p.y - fs - 10);
      } else if (dance) {
        octx.font = `${17 * sc}px system-ui, "Apple Color Emoji", sans-serif`;
        octx.fillText((L.bladder || 0) > 88 ? '😱💦' : '😬', p.x + 30, p.y - fs - 6 + Math.sin(nowT * 12 + L.idx) * 3);
      }
      const b = bubbles.get(L.idx);
      if (b && b.until > nowT) {
        octx.font = `700 ${12.5 * sc}px system-ui, "Apple Color Emoji", sans-serif`;
        const bw = Math.min(230, octx.measureText(b.text).width + 18);
        const by = p.y - fs - 34 * sc - (L.flags & 8 ? 16 : 0);
        octx.fillStyle = '#fff';
        rr(octx, p.x - bw / 2, by - 15, bw, 26, 10);
        octx.fill();
        octx.beginPath();
        octx.moveTo(p.x - 5, by + 10);
        octx.lineTo(p.x, by + 18);
        octx.lineTo(p.x + 5, by + 10);
        octx.fill();
        octx.fillStyle = '#12163a';
        octx.fillText(b.text, p.x, by + 3);
      }
    }
    // arrow toward the toilet when it is off-screen
    const tp = project(P.toilet.x, 40, P.toilet.y);
    const margin = 46;
    const onScreen = !tp.behind && tp.x > margin && tp.x < W - margin && tp.y > margin + 40 && tp.y < H - margin;
    if (!onScreen) {
      const cx = W / 2;
      const cy = H / 2;
      const ang = Math.atan2(tp.y - cy, tp.x - cx);
      const k = Math.min((W / 2 - margin) / Math.abs(Math.cos(ang) || 1e-6), (H / 2 - margin - 40) / Math.abs(Math.sin(ang) || 1e-6));
      const ax = cx + Math.cos(ang) * k;
      const ay = cy + Math.sin(ang) * k;
      octx.save();
      octx.translate(ax, ay);
      octx.rotate(ang);
      octx.fillStyle = '#ffd23f';
      octx.shadowColor = '#ffd23f';
      octx.shadowBlur = 12;
      octx.beginPath();
      octx.moveTo(16, 0);
      octx.lineTo(-10, -12);
      octx.lineTo(-4, 0);
      octx.lineTo(-10, 12);
      octx.closePath();
      octx.fill();
      octx.restore();
      octx.font = '800 12px system-ui, sans-serif';
      octx.fillStyle = '#ffd23f';
      octx.strokeStyle = 'rgba(0,0,0,0.7)';
      octx.lineWidth = 3;
      const dist = Math.round(Math.hypot(P.toilet.x - me.x, P.toilet.y - me.y) / 10);
      octx.strokeText(`🚽 ${dist} m`, ax - Math.cos(ang) * 30, ay - Math.sin(ang) * 30 + 4);
      octx.fillText(`🚽 ${dist} m`, ax - Math.cos(ang) * 30, ay - Math.sin(ang) * 30 + 4);
    }
    for (const f of fx) {
      const k = (nowT - f.born) / f.life;
      if (f.kind === 'text') {
        const p = project(f.x, 70 + k * 40, f.z);
        if (p.behind) continue;
        octx.globalAlpha = 1 - k;
        octx.font = '800 21px system-ui, "Apple Color Emoji", sans-serif';
        octx.strokeStyle = 'rgba(0,0,0,0.7)';
        octx.lineWidth = 4;
        octx.strokeText(f.text, p.x, p.y);
        octx.fillStyle = f.color;
        octx.fillText(f.text, p.x, p.y);
        octx.globalAlpha = 1;
      } else if (f.kind === 'ring') {
        const c = project(f.x, 4, f.z);
        const e = project(f.x + 210 * k, 4, f.z);
        octx.globalAlpha = 1 - k;
        octx.strokeStyle = f.color;
        octx.lineWidth = 5;
        octx.beginPath();
        octx.ellipse(c.x, c.y, Math.abs(e.x - c.x) || 1, Math.abs(e.x - c.x) * 0.55 || 1, 0, 0, TAU);
        octx.stroke();
        octx.globalAlpha = 1;
      }
    }
    for (let i = fx.length - 1; i >= 0; i--) if (nowT - fx[i].born >= fx[i].life) fx.splice(i, 1);
  }

  function drawMinimap(s) {
    if (!mctx || !P) return;
    const mw = mini.width;
    const mh = mini.height;
    const k = Math.min(mw / (cols * cell), mh / (rows * cell));
    const ox = (mw - cols * cell * k) / 2;
    const oy = (mh - rows * cell * k) / 2;
    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = 'rgba(12,14,30,0.92)';
    mctx.fillRect(0, 0, mw, mh);
    mctx.strokeStyle = '#8aa0ff';
    mctx.lineWidth = Math.max(1, mw / 110);
    mctx.lineCap = 'round';
    mctx.beginPath();
    for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) if (hw[r][c]) {
      mctx.moveTo(ox + c * cell * k, oy + r * cell * k);
      mctx.lineTo(ox + (c + 1) * cell * k, oy + r * cell * k);
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) if (vw[r][c]) {
      mctx.moveTo(ox + c * cell * k, oy + r * cell * k);
      mctx.lineTo(ox + c * cell * k, oy + (r + 1) * cell * k);
    }
    mctx.stroke();
    // doors, keys, toilet
    for (const d of P.doors) {
      if (opened.has(d.letter)) continue;
      mctx.fillStyle = KEY_COL[d.letter.toLowerCase()];
      mctx.globalAlpha = 0.55;
      mctx.fillRect(ox + (d.x - cell / 2) * k + 1, oy + (d.y - cell / 2) * k + 1, cell * k - 2, cell * k - 2);
      mctx.globalAlpha = 1;
      mctx.fillStyle = '#fff';
      mctx.font = `800 ${Math.max(9, cell * k * 0.62)}px system-ui, sans-serif`;
      mctx.textAlign = 'center';
      mctx.textBaseline = 'middle';
      mctx.fillText(d.letter, ox + d.x * k, oy + d.y * k + 1);
    }
    for (const kk of P.keys) {
      const o = keyObjs.get(kk.letter);
      if (o && o.taken) continue;
      mctx.fillStyle = KEY_COL[kk.letter];
      mctx.beginPath();
      mctx.arc(ox + kk.x * k, oy + kk.y * k, Math.max(3, cell * k * 0.24), 0, TAU);
      mctx.fill();
      mctx.fillStyle = '#10142a';
      mctx.font = `800 ${Math.max(7, cell * k * 0.36)}px system-ui, sans-serif`;
      mctx.textAlign = 'center';
      mctx.textBaseline = 'middle';
      mctx.fillText(kk.letter, ox + kk.x * k, oy + kk.y * k + 0.5);
    }
    const pulse = 0.5 + 0.5 * Math.sin(nowT * 5);
    mctx.fillStyle = `rgba(255,210,63,${0.5 + pulse * 0.5})`;
    mctx.beginPath();
    mctx.arc(ox + P.toilet.x * k, oy + P.toilet.y * k, Math.max(4, cell * k * 0.34) + pulse, 0, TAU);
    mctx.fill();
    mctx.font = `${Math.max(8, cell * k * 0.5)}px system-ui, "Apple Color Emoji", sans-serif`;
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    mctx.fillText('🚽', ox + P.toilet.x * k, oy + P.toilet.y * k + 1);
    for (const g of s.g) {
      mctx.fillStyle = g.mode === 1 ? '#ff5470' : g.mode === 2 ? '#7f8cff' : '#e9f6ff';
      mctx.beginPath();
      mctx.arc(ox + g.x * k, oy + g.y * k, Math.max(2.6, cell * k * 0.22), 0, TAU);
      mctx.fill();
    }
    for (const e of s.p) {
      if (e.flags & (64 | 32)) continue;
      const isMe = e.idx === meIdx;
      mctx.fillStyle = isMe ? '#ffffff' : '#7fd4ff';
      mctx.beginPath();
      mctx.arc(ox + (isMe ? me.x : e.x) * k, oy + (isMe ? me.y : e.y) * k, isMe ? 3.6 : 2.6, 0, TAU);
      mctx.fill();
    }
  }

  /* ------------------------------------------------------------ loop */

  let frameAvg = 1 / 60;
  let slow = 0;
  let qStep = 0;
  function adapt(dt) {
    frameAvg = lerp(frameAvg, dt, 0.05);
    if (frameAvg > 1 / 26) slow++;
    else slow = Math.max(0, slow - 2);
    if (slow > 120 && qStep < 3) {
      qStep++;
      slow = 0;
      if (qStep === 1) {
        dprMax = 1;
        resize();
      } else if (qStep === 2) world.moon.castShadow = false;
      else {
        dprMax = 0.75;
        resize();
      }
    }
  }

  function frame(dt) {
    const s = sample(nowServer() - 110);
    if (!s || !world) return;
    syncEntities(s, dt);
    updateCamera(dt);
    updateWorld(nowT, dt);
    stepParticles(dt);
    stepSmoke(dt);
    renderer.render(scene, camera);
    drawOverlay();
    drawMinimap(s);
    adapt(dt);
  }

  function loop(now) {
    if (!running) return;
    const t = now / 1000;
    const dt = Math.min(0.05, Math.max(0, t - last));
    last = t;
    nowT = t;
    if (P && me.init) {
      const v = inputVector();
      stepMe(dt, v);
      const nowMs = performance.now();
      if (Math.abs(v.dx - lastSent.dx) > 0.02 || Math.abs(v.dy - lastSent.dy) > 0.02 || nowMs - lastSent.t > 250) {
        lastSent = { dx: v.dx, dy: v.dy, t: nowMs };
        hooks.sendInput && hooks.sendInput(v.dx, v.dy);
      }
    }
    if (keys.rotL) cam.yawT -= dt * 1.8;
    if (keys.rotR) cam.yawT += dt * 1.8;
    try {
      frame(dt);
    } catch (err) {
      if (!loop.warned) {
        loop.warned = true;
        console.error('maze frame failed', err);
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
    if (camera) {
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    }
  }

  /* --------------------------------------------------------- controls */

  const raycaster = new T.Raycaster();
  function groundPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new T.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const o = raycaster.ray.origin;
    const d = raycaster.ray.direction;
    if (d.y >= -1e-4) return null;
    const t = -o.y / d.y;
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  }

  function bindControls(joyEl, knobEl) {
    const KEYMAP = { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' };
    window.addEventListener('keydown', (e) => {
      if (!running || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '').toUpperCase())) return;
      if (KEYMAP[e.key]) {
        keys[KEYMAP[e.key]] = true;
        goPath = null;
        e.preventDefault();
      } else if (e.key === 'q' || e.key === 'Q') keys.rotL = true;
      else if (e.key === 'e' || e.key === 'E') keys.rotR = true;
      else if (e.key === ' ' || e.key === 'Enter') {
        hooks.flash && hooks.flash();
        e.preventDefault();
      } else if (e.key === '+' || e.key === '=') cam.distT = clamp(cam.distT - 40, 200, 620);
      else if (e.key === '-' || e.key === '_') cam.distT = clamp(cam.distT + 40, 200, 620);
    });
    window.addEventListener('keyup', (e) => {
      if (KEYMAP[e.key]) keys[KEYMAP[e.key]] = false;
      else if (e.key === 'q' || e.key === 'Q') keys.rotL = false;
      else if (e.key === 'e' || e.key === 'E') keys.rotR = false;
    });
    window.addEventListener('blur', () => {
      keys.up = keys.down = keys.left = keys.right = keys.rotL = keys.rotR = false;
    });

    let joyId = null;
    const R = 46;
    function moveKnob(e) {
      const rect = joyEl.getBoundingClientRect();
      let dx = e.clientX - (rect.left + rect.width / 2);
      let dy = e.clientY - (rect.top + rect.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
      joy = { x: dx / R, y: dy / R };
      if (Math.hypot(joy.x, joy.y) < 0.18) joy = { x: 0, y: 0 };
      goPath = null;
    }
    joyEl.addEventListener('pointerdown', (e) => {
      joyId = e.pointerId;
      joyEl.setPointerCapture(joyId);
      moveKnob(e);
      e.preventDefault();
    });
    joyEl.addEventListener('pointermove', (e) => {
      if (e.pointerId === joyId) moveKnob(e);
    });
    const endJoy = (e) => {
      if (e.pointerId !== joyId) return;
      joyId = null;
      joy = { x: 0, y: 0 };
      knobEl.style.transform = 'translate(0, 0)';
    };
    joyEl.addEventListener('pointerup', endJoy);
    joyEl.addEventListener('pointercancel', endJoy);

    const pointers = new Map();
    let drag = null;
    let pinch = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (!P || !running) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (pointers.size === 1) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, t: performance.now() };
      else {
        drag = null;
        const [a, b] = Array.from(pointers.values());
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) cam.distT = clamp(cam.distT * (pinch / d), 200, 620);
        pinch = d;
        return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8) drag.moved = true;
      if (drag.moved) {
        cam.yawT -= (e.clientX - drag.x) * 0.006;
        cam.pitchT = clamp(cam.pitchT + (e.clientY - drag.y) * 0.004, 0.6, 1.3);
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (drag && drag.id === e.pointerId) {
        if (!drag.moved && performance.now() - drag.t < 450) {
          const pt = groundPoint(e.clientX, e.clientY);
          if (pt && me.init) goPath = routeTo(me.x, me.y, clamp(pt.x, 10, cols * cell - 10), clamp(pt.y, 10, rows * cell - 10));
        }
        drag = null;
      }
      if (pointers.size < 2) pinch = 0;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener(
      'wheel',
      (e) => {
        cam.distT = clamp(cam.distT + e.deltaY * 0.35, 200, 620);
        e.preventDefault();
      },
      { passive: false }
    );
  }

  function mount(canvasEl, miniEl, joyEl, knobEl, h) {
    canvas = canvasEl;
    renderer = new T.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setClearColor(0x0a0d1e, 1);
    const cap = renderer.capabilities;
    quality = mobile ? { texScale: 0.85, shadowSize: 1024, aniso: Math.min(2, cap.getMaxAnisotropy()) } : { texScale: 1.25, shadowSize: 2048, aniso: Math.min(8, cap.getMaxAnisotropy()) };
    Soldier.load();
    mini = miniEl;
    mctx = mini.getContext('2d');
    hooks = h || {};
    overlay = document.createElement('canvas');
    overlay.className = 'city-overlay';
    octx = overlay.getContext('2d');
    canvas.parentNode.insertBefore(overlay, canvas.nextSibling);
    const vig = document.createElement('div');
    vig.className = 'city-vignette maze-vignette';
    canvas.parentNode.insertBefore(vig, overlay.nextSibling);
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);
    bindControls(joyEl, knobEl);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) running = false;
      else if (canvas.offsetParent !== null && P) begin();
    });
  }

  return {
    mount,
    start,
    stop,
    applyState,
    fx: fxEvent,
    resume() { if (P && !running) begin(); },
    say,
    floatText,
    get running() { return running; },
    get me() { return me; },
    get cam() { return cam; },
    get layout() { return P; },
    get opened() { return opened; },
    walkTo(x, y) { goPath = routeTo(me.x, me.y, x, y); return !!goPath; },
    get hasPath() { return !!(goPath && goPath.length); },
    reduceMotion,
  };
})();
