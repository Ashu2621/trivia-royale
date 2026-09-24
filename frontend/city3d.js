/*
 * City — the Three.js renderer and controls for City Chaos.
 *
 * The server owns the simulation; this module draws it. Everyone is interpolated between snapshots,
 * your own character is predicted locally. Third-person chase camera: drag to orbit, wheel / pinch to
 * zoom, WASD moves relative to the camera, Space / click / tap fights, F gets in and out of cars.
 */
const City = (function () {
  'use strict';

  const T = THREE;
  if (T.ColorManagement) T.ColorManagement.legacyMode = false;

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, k) => a + (b - a) * k;
  const angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };
  const PLAYER_R = 11;
  const BASE_SPEED = 170;
  const CLENCH_MUL = 0.35;
  const DOOR_RADIUS = 46;
  const MATCH_MS = 8 * 60 * 1000;
  const FIRE_EVERY_MS = 90;
  const GUARD_HP = 60;
  const COP_HP = 70;
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const mobile = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || Math.min(screen.width, screen.height) < 700;

  const SKIN = ['#f5d0b0', '#e6b48a', '#c98f62', '#a86b42', '#7c4a2d', '#f9dcc4'];
  const SHIRT = ['#e63946', '#f4a261', '#2a9d8f', '#4361ee', '#9b5de5', '#f15bb5', '#00bbf9', '#8ac926', '#ff7b00', '#7209b7'];
  const PLAYER_TINT = ['#e63946', '#4361ee', '#2a9d8f', '#f4a261', '#9b5de5', '#f15bb5', '#00bbf9', '#8ac926', '#ff7b00', '#7209b7'];
  const GUARD_TINT = '#a8742a';
  const COP_TINT = '#2b4fa8';
  const CAR_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#ecf0f1', '#9b59b6'];
  const PICKUP_ICON = ['💵', '🔫', '🔫', '🔫', '❤️', '🛡️', '🏏', '🔫', '🎯', '📦']; // cash pistol smg shotgun health armor bat ar sniper ammo
  const PICKUP_COLOR = ['#5ee38f', '#cfd8e3', '#5ee38f', '#5aa8ff', '#ff5470', '#5ac8ff', '#d9a05b', '#b47cff', '#ffd23f', '#ffe08a'];
  const AIR_MS = 7500;
  const WEAPON_COUNT = 7;
  const HIT_COLOR = ['#ff5a5a', '#ffffff', '#ffb347', '#7fb4ff', '#9fe6ff'];

  let canvas = null;
  let overlay = null;
  let octx = null;
  let mini = null;
  let mctx = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let world = null;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let dprMax = mobile ? 1.5 : 2;
  let hooks = {};
  let running = false;
  let last = 0;
  let nowT = 0;
  let q = null;
  let post = null;
  let weather = 'clear';
  let rain = null;
  let muzzleLight = null;
  let muzzleT = 0;
  const lightning = { next: 0, until: 0, at: 0 };
  let mode = 'city';
  let airUntil = 0;
  let spectateIdx = -1;
  let zoneMesh = null;
  let nextRing = null;
  const hitDirs = [];
  const hitMark = { at: -9, kill: false };
  const cross = { heat: 0 };
  let ads = false;
  let adsK = 0;
  const flares = [];

  let map = null;
  let missions = [];
  let missionBuilding = [];
  let players = [];
  let indexById = new Map();
  let meIdx = -1;
  let npcLooks = [];
  let snaps = [];
  let offset = 0;
  let startsAt = 0;
  let cur = null; // the sample being drawn this frame
  let me = newMe();
  const keys = { up: false, down: false, left: false, right: false, rotL: false, rotR: false };
  let joy = { x: 0, y: 0 };
  let lastSent = { dx: 0, dy: 0, t: 0 };
  // firing: held keys / buttons / pointer, repeated while held
  const fire = { key: false, btn: false, ptr: null, last: 0 };
  const fx = [];
  const bubbles = new Map();

  function newMe() {
    return { x: 0, y: 0, ang: 0, init: false, flags: 0, mission: 0, cash: 0, weapon: 0, hp: 100, armor: 0, bladder: 0, world: 0, keys: 0, wanted: 0, ammo: -1, kills: 0, hold: 0, owned: 1, mag: -1, reloading: false, place: 0, spectate: -1 };
  }

  // camera rig
  const cam = { yaw: 0, yawT: 0, pitch: 1.0, pitchT: 1.0, dist: 330, distT: 330, x: 0, z: 0, shake: 0 };
  const camPos = new T.Vector3();
  const focus = { x: 0, z: 0 };

  // entities
  let npcObjs = [];
  let carObjs = [];
  let playerObjs = [];
  let guardObjs = [];
  let copObjs = [];
  let pickupObjs = new Map();
  let marker = null;
  let particles = [];
  const labels = [];
  let entityGroup = null;
  let shadowTex = null;
  let glowTex = null;
  let beamTex = null;
  let charMat = null;
  const paintMats = new Map();
  const iconTex = new Map();

  /* ------------------------------------------------------------- physics */

  function collides(x, y, r) {
    if (x < r || y < r || x > map.w - r || y > map.h - r) return true;
    for (const o of map.obstacles) {
      if (x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r) return true;
    }
    return false;
  }

  function speedOf(flags) {
    if (flags & 2048) return 0;
    if (flags & 131072) return 210;
    if (flags & (1 | 4 | 32 | 64 | 128)) return 0;
    return BASE_SPEED * (flags & 256 ? CLENCH_MUL : 1);
  }

  // controls are relative to the camera: "up" walks away from the viewer
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
    const sp = speedOf(me.flags);
    if (!sp || (!v.dx && !v.dy) || nowServer() < startsAt) return;
    const vx = v.dx * sp * dt;
    const vy = v.dy * sp * dt;
    if (!collides(me.x + vx, me.y, PLAYER_R)) me.x += vx;
    if (!collides(me.x, me.y + vy, PLAYER_R)) me.y += vy;
  }

  /* -------------------------------------------------------- textures */

  function radial(stops, size) {
    const c = document.createElement('canvas');
    c.width = c.height = size || 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, c.width / 2);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr;
    g.fillRect(0, 0, c.width, c.height);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    return t;
  }

  function makeAssets() {
    shadowTex = radial([[0, 'rgba(0,0,0,0.55)'], [0.6, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']], 64);
    glowTex = radial([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']], 64);
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,214,90,0)');
    gr.addColorStop(0.7, 'rgba(255,214,90,0.35)');
    gr.addColorStop(1, 'rgba(255,240,170,0.95)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 128);
    beamTex = new T.CanvasTexture(c);
    beamTex.encoding = T.sRGBEncoding;
  }

  /* ---------------------------------------------------- shared bits */

  const matCache = new Map();
  function pm(hex, rough, metal) {
    const key = `${hex}|${rough}|${metal}`;
    let m = matCache.get(key);
    if (!m) {
      m = new T.MeshStandardMaterial({ color: hex, roughness: rough == null ? 0.75 : rough, metalness: metal || 0 });
      matCache.set(key, m);
      world && world.envMats.push(m);
    }
    return m;
  }

  const G = {}; // shared geometries
  function geos() {
    if (G.shadow) return;
    G.shadow = new T.PlaneGeometry(1, 1);
    G.tracer = new T.CylinderGeometry(0.7, 0.7, 1, 5);
  }

  /* ------------------------------------------- skinned soldier model (shared) */

  // Everyone in the city is the rigged Mixamo soldier from soldier.js, tinted per person. Big enough
  // that the acting (holding it in! punching! swinging a bat!) reads from the chase camera.
  const SOLDIER_SCALE = 40;

  function buildPerson(o) {
    geos();
    const s0 = Soldier.create({
      scale: SOLDIER_SCALE * (o.sv || 1),
      tint: o.tint,
      tintMix: o.mix == null ? 0.55 : o.mix,
      castShadow: o.shadow !== false,
      envMats: world && world.envMats,
      gun: !!o.gun,
    });
    const k = s0.scale / 27;
    const blob = new T.Mesh(G.shadow, new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.scale.set(32 * k, 32 * k, 1);
    blob.position.y = 0.9;
    s0.root.add(blob);
    return Object.assign(s0, { blob, phase: Math.random() * TAU, h: 0, px: 0, py: 0, seen: false, lastAtk: -9, atkAlt: 0, hp: 100 });
  }

  function animatePerson(p, dt, moving, speed, st) {
    Soldier.update(p, dt, Object.assign({ moving, speed, time: nowT }, st));
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

  // a heading in server terms (atan2(dy, dx)) becomes the model's yaw
  const yawOf = (ang) => -ang;

  // Kenney Car Kit (CC0) models, one per colour code; the blocky car below is the fallback
  const CAR_MODEL_NAMES = ['sedan', 'suv', 'taxi', 'hatchback-sports', 'van', 'sedan-sports'];
  let carModels = null;
  let carsWait = null;
  function loadCars() {
    if (carsWait) return carsWait;
    carsWait = new Promise((resolve) => {
      if (!T.GLTFLoader) return resolve();
      const loader = new T.GLTFLoader();
      const cache = {};
      let left = CAR_MODEL_NAMES.length;
      const done = () => {
        if (--left === 0) {
          carModels = cache;
          resolve();
        }
      };
      for (const n of CAR_MODEL_NAMES) {
        loader.load(
          `models/cars/${n}.glb`,
          (g) => {
            cache[n] = g.scene;
            done();
          },
          undefined,
          () => done()
        );
      }
    });
    return carsWait;
  }

  function buildCarModel(idx) {
    const src = carModels && carModels[CAR_MODEL_NAMES[idx % CAR_MODEL_NAMES.length]];
    if (!src) return null;
    const inner = src.clone(true);
    const box = new T.Box3().setFromObject(inner);
    const size = box.getSize(new T.Vector3());
    let fz = 0;
    let bz = 0;
    const wheels = [];
    const origMats = [];
    inner.traverse((o) => {
      if (o.name === 'wheel-front-left') fz = o.position.z;
      if (o.name === 'wheel-back-left') bz = o.position.z;
      if (o.name && o.name.indexOf('wheel') === 0) wheels.push(o);
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material && o.material.metalness !== undefined) {
          o.material.metalness = 0.2;
          o.material.roughness = 0.5;
        }
        origMats.push([o, o.material]);
        if (o.material && world && world.envMats.indexOf(o.material) < 0) world.envMats.push(o.material);
      }
    });
    const front = fz >= bz ? 1 : -1;
    const k = 62 / Math.max(0.1, size.z);
    inner.scale.setScalar(k);
    inner.position.y = -box.min.y * k;
    const wrap = new T.Group();
    wrap.add(inner);
    wrap.rotation.y = front > 0 ? Math.PI / 2 : -Math.PI / 2; // the car's nose points +X like everything else
    const g = new T.Group();
    g.add(wrap);
    const blob = new T.Mesh(G.shadow, new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.scale.set(78, 42, 1);
    blob.position.y = 0.9;
    g.add(blob);
    const lamps = [];
    for (const z of [-9.5, 9.5]) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffeeb0, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
      sp.scale.set(30, 30, 1);
      sp.position.set(33, 10.5, z);
      g.add(sp);
      lamps.push(sp);
    }
    return {
      root: g,
      paint: null,
      model: true,
      axis: 'x',
      spinSign: front,
      wheels,
      lamps,
      head: { emissiveIntensity: 0 },
      h: 0,
      spin: 0,
      px: 0,
      py: 0,
      seen: false,
      driver: null,
      setWreck(on) {
        for (const [m, mat] of origMats) m.material = on ? charMat : mat;
      },
    };
  }

  function buildCar(hex, idx) {
    const m = idx === undefined ? null : buildCarModel(idx);
    return m || buildCarBlocky(hex);
  }

  function buildCarBlocky(hex) {
    const g = new T.Group();
    const key = hex;
    let paint = paintMats.get(key);
    if (!paint) {
      paint = new T.MeshStandardMaterial({ color: hex, roughness: 0.26, metalness: 0.62 });
      paintMats.set(key, paint);
      world.envMats.push(paint);
    }
    const glass = pm('#0a1a26', 0.08, 0.9);
    const dark = pm('#141518', 0.6, 0.2);
    const chrome = pm('#cfd4da', 0.2, 0.9);
    const blob = new T.Mesh(G.shadow, new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.scale.set(78, 42, 1);
    blob.position.y = 0.9;
    g.add(blob);
    const lower = new T.Mesh(new T.BoxGeometry(58, 9, 27), paint);
    lower.position.y = 9;
    lower.castShadow = true;
    g.add(lower);
    const hood = new T.Mesh(new T.BoxGeometry(18, 3, 25), paint);
    hood.position.set(19, 14.6, 0);
    hood.rotation.z = -0.1;
    hood.castShadow = true;
    g.add(hood);
    const cabin = new T.Mesh(new T.BoxGeometry(27, 9, 23), glass);
    cabin.position.set(-5, 18, 0);
    cabin.castShadow = true;
    g.add(cabin);
    const roof = new T.Mesh(new T.BoxGeometry(23, 2, 21), paint);
    roof.position.set(-5, 23.2, 0);
    roof.castShadow = true;
    g.add(roof);
    for (const z of [-11.6, 11.6]) {
      const pil = new T.Mesh(new T.BoxGeometry(2, 9, 1.6), paint);
      pil.position.set(-15, 18, z);
      g.add(pil);
      const pil2 = pil.clone();
      pil2.position.x = 5;
      g.add(pil2);
    }
    for (const x of [-29.5, 29.5]) {
      const bump = new T.Mesh(new T.BoxGeometry(2, 4, 28), dark);
      bump.position.set(x, 6.2, 0);
      g.add(bump);
    }
    const head = new T.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffeeb0, emissiveIntensity: 0.4 });
    const tail = new T.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1e1e, emissiveIntensity: 0.9 });
    const lamps = [];
    for (const z of [-9.5, 9.5]) {
      const h = new T.Mesh(new T.BoxGeometry(1.6, 3, 6), head);
      h.position.set(28.6, 10.5, z);
      g.add(h);
      const t = new T.Mesh(new T.BoxGeometry(1.6, 2.6, 6), tail);
      t.position.set(-29, 10.5, z);
      g.add(t);
      const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffeeb0, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
      sp.scale.set(30, 30, 1);
      sp.position.set(33, 10.5, z);
      g.add(sp);
      lamps.push(sp);
    }
    const wheels = [];
    const wGeo = new T.CylinderGeometry(6.4, 6.4, 5, 16);
    const rimGeo = new T.CylinderGeometry(3.6, 3.6, 5.2, 8);
    for (const x of [-18.5, 18.5]) {
      for (const z of [-13.4, 13.4]) {
        const w = new T.Group();
        w.position.set(x, 6.4, z);
        const tire = new T.Mesh(wGeo, dark);
        tire.rotation.x = Math.PI / 2;
        tire.castShadow = true;
        w.add(tire);
        const rim = new T.Mesh(rimGeo, chrome);
        rim.rotation.x = Math.PI / 2;
        w.add(rim);
        g.add(w);
        wheels.push(w);
      }
    }
    return { root: g, paint, wheels, lamps, head, h: 0, spin: 0, px: 0, py: 0, seen: false, driver: null };
  }

  /* ------------------------------------------------- icon sprites + tracers */

  function iconTexture(emoji, color) {
    const key = emoji + color;
    let t = iconTex.get(key);
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(48, 48, 6, 48, 48, 46);
    gr.addColorStop(0, 'rgba(10,14,36,0.85)');
    gr.addColorStop(0.75, 'rgba(10,14,36,0.7)');
    gr.addColorStop(1, 'rgba(10,14,36,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(48, 48, 46, 0, TAU);
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(48, 48, 36, 0, TAU);
    g.stroke();
    g.font = '44px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, 48, 52);
    t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    iconTex.set(key, t);
    return t;
  }

  const tracers = [];
  function makeTracers() {
    tracers.length = 0;
    for (let i = 0; i < 40; i++) {
      const m = new T.Mesh(G.tracer, new T.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
      m.visible = false;
      scene.add(m);
      tracers.push({ m, life: 0, max: 0.1 });
    }
  }

  const UP = new T.Vector3(0, 1, 0);
  const _a = new T.Vector3();
  const _b = new T.Vector3();
  function tracer(ax, ay, az, bx, by, bz, color, life, width) {
    const t = tracers.find((x) => x.life <= 0);
    if (!t) return;
    _a.set(ax, ay, az);
    _b.set(bx, by, bz);
    const d = _b.clone().sub(_a);
    const len = d.length();
    if (len < 1) return;
    t.m.position.copy(_a).lerp(_b, 0.5);
    t.m.scale.set(width || 1, len, width || 1);
    t.m.quaternion.setFromUnitVectors(UP, d.normalize());
    t.m.material.color.set(color || '#ffe6a0').multiplyScalar(post ? 3.2 : 1);
    t.max = t.life = life || 0.1;
    t.m.visible = true;
  }

  function stepTracers(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.m.visible = false;
        continue;
      }
      t.m.material.opacity = clamp(t.life / t.max, 0, 1);
    }
  }

  // one big soft flash for explosions
  let flashSprite = null;
  let flashLife = 0;
  function bigFlash(x, y, z, size) {
    if (!flashSprite) {
      flashSprite = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffb060, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
      scene.add(flashSprite);
    }
    flashSprite.position.set(x, y, z);
    flashSprite.userData.size = size;
    flashSprite.material.color.set(0xffb060).multiplyScalar(post ? 4 : 1);
    flashLife = 0.45;
    flashSprite.visible = true;
  }
  function stepFlash(dt) {
    if (!flashSprite || flashLife <= 0) return;
    flashLife -= dt;
    if (flashLife <= 0) {
      flashSprite.visible = false;
      return;
    }
    const k = flashLife / 0.45;
    flashSprite.material.opacity = k;
    flashSprite.scale.setScalar(flashSprite.userData.size * (1.6 - k * 0.6));
  }

  /* ---------------------------------------------------- scene setup */

  function tuneQuality() {
    const gl = renderer.capabilities;
    q = mobile
      ? { texScale: 1, shadowSize: 1024, aniso: Math.min(2, gl.getMaxAnisotropy()), npcShadows: false, mobile: true }
      : { texScale: 1.5, shadowSize: 2048, aniso: Math.min(8, gl.getMaxAnisotropy()), npcShadows: true };
  }

  function ensureWorld() {
    if (world && world.mapW === map.w) return;
    if (scene) {
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(48, 1, 6, 12000);
    makeAssets();
    geos();
    world = CityWorld.build(scene, renderer, map, missions, q);
    world.mapW = map.w;
    charMat = new T.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.9, metalness: 0.2 });
    entityGroup = new T.Group();
    scene.add(entityGroup);
    marker = buildMarker();
    scene.add(marker.group);
    const zm = buildZone();
    zoneMesh = zm.wall;
    nextRing = zm.ring;
    particles = [];
    smoke = [];
    makeParticles();
    makeSmoke();
    makeTracers();
    rain = buildRain();
    muzzleLight = new T.PointLight(0xffc27a, 0, 260, 2);
    scene.add(muzzleLight);
    world.setTime(0.05);
    resize();
  }

  function buildMarker() {
    const group = new T.Group();
    const beam = new T.Mesh(
      new T.CylinderGeometry(19, 19, 520, 24, 1, true),
      new T.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false, toneMapped: false })
    );
    beam.position.y = 260;
    group.add(beam);
    const ring = new T.Mesh(new T.TorusGeometry(DOOR_RADIUS - 6, 1.8, 8, 48), new T.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false, transparent: true }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 6;
    group.add(ring);
    const disc = new T.Mesh(new T.CircleGeometry(DOOR_RADIUS, 40), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 5.2;
    group.add(disc);
    const N = 36;
    const pos = new Float32Array(N * 3);
    const seed = [];
    for (let i = 0; i < N; i++) seed.push({ a: Math.random() * TAU, r: Math.random() * 30, t: Math.random() });
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    const pts = new T.Points(geo, new T.PointsMaterial({ color: 0xffe08a, size: 5, transparent: true, opacity: 0.9, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
    pts.frustumCulled = false;
    group.add(pts);
    group.visible = false;
    return { group, beam, ring, disc, pts, pos, seed, geo };
  }

  function updateMarker(t) {
    const target = missions[me.mission] || null;
    if (!target) {
      marker.group.visible = false;
      return;
    }
    marker.group.visible = true;
    marker.group.position.set(target.door.x, 0, target.door.y);
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    marker.ring.scale.setScalar(1 + pulse * 0.1);
    marker.ring.material.opacity = 0.7 + 0.3 * pulse;
    marker.disc.material.opacity = 0.14 + 0.1 * pulse;
    marker.beam.material.opacity = 0.75 + 0.25 * pulse;
    for (let i = 0; i < marker.seed.length; i++) {
      const s = marker.seed[i];
      const age = (t * 0.5 + s.t) % 1;
      marker.pos[i * 3] = Math.cos(s.a + t * 0.6) * (s.r + 8);
      marker.pos[i * 3 + 1] = age * 240;
      marker.pos[i * 3 + 2] = Math.sin(s.a + t * 0.6) * (s.r + 8);
    }
    marker.geo.attributes.position.needsUpdate = true;
  }

  /* ---------------------------------------------------- particles */

  function makeParticles() {
    particles = [];
    for (let i = 0; i < 90; i++) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0, blending: T.AdditiveBlending }));
      sp.visible = false;
      scene.add(sp);
      particles.push({ sp, v: new T.Vector3(), life: 0, max: 1, size: 8 });
    }
  }

  function burst(x, y, z, color, n, speed, size, life, grav) {
    let made = 0;
    for (const p of particles) {
      if (p.life > 0) continue;
      p.sp.position.set(x, y, z);
      p.sp.material.color.set(color).multiplyScalar(post ? 1.9 : 1);
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
      if (p.sp.position.y < 1) {
        p.sp.position.y = 1;
        p.v.y *= -0.3;
      }
      const k = p.life / p.max;
      p.sp.material.opacity = Math.min(1, k * 1.6);
      p.sp.scale.setScalar(p.size * (0.6 + 0.6 * k));
    }
  }

  /* ------------------------------------------------------- stink clouds + body fx */

  let smoke = [];
  function makeSmoke() {
    smoke = [];
    for (let i = 0; i < 70; i++) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0, color: 0xb5cf6a }));
      sp.visible = false;
      scene.add(sp);
      smoke.push({ sp, v: new T.Vector3(), life: 0, max: 1, size: 20, grow: 1 });
    }
  }

  function puff(x, y, z, n, color, size, life, rise) {
    let made = 0;
    for (const p of smoke) {
      if (p.life > 0) continue;
      p.sp.position.set(x + rand(-5, 5), y + rand(-4, 4), z + rand(-5, 5));
      p.sp.material.color.set(color);
      const a = Math.random() * TAU;
      p.v.set(Math.cos(a) * rand(4, 20), (rise || 20) * rand(0.6, 1.3), Math.sin(a) * rand(4, 20));
      p.max = p.life = (life || 1.4) * rand(0.75, 1.25);
      p.size = (size || 20) * rand(0.7, 1.2);
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

  /* ------------------------------------------------------- combat + body fx */

  const TOOT_WORDS = ['PFFT!', 'PRRT!', 'BRAAP!', 'toot!', 'psst…', 'BLURP!', 'PFFFRT!', 'phbbt!'];

  function textFx(text, color, x, y, h, life) {
    fx.push({ kind: 'text', text, color, x, y, h: h == null ? 70 : h, born: nowT, life: life || 1.2 });
  }

  function posOf(id) {
    const idx = indexById.get(id);
    if (idx === undefined) return null;
    if (idx === meIdx) return { x: me.x, y: me.y, idx, o: playerObjs[idx] };
    const o = playerObjs[idx];
    return o && o.pos ? { x: o.pos.x, y: o.pos.y, idx, o } : { x: me.x, y: me.y, idx, o };
  }

  function strike(o) {
    if (!o) return;
    o.lastAtk = nowT;
    o.atkAlt ^= 1;
  }

  // server events: gunfire, punches, hits, explosions, body noises
  function combatMarks(e) {
    const myId = (players[meIdx] || {}).playerId;
    if (!myId) return;
    if (e.type === 'hit' && e.by === myId && e.dmg > 0) {
      hitMark.at = nowT;
      hitMark.kill = false;
    } else if (e.type === 'kill' && e.killer === myId) {
      hitMark.at = nowT;
      hitMark.kill = true;
    } else if (e.type === 'shot' && e.playerId === myId) cross.heat = Math.min(1, cross.heat + (e.w === 6 ? 1 : e.w === 4 ? 0.5 : 0.16));
    else if (e.type === 'hit' && e.k === 0 && e.playerId === myId && e.from) hitDirs.push({ ang: Math.atan2(e.from[1] - me.y, e.from[0] - me.x), born: nowT });
    else if (e.type === 'airdrop') {
      flares.push({ x: e.x, y: e.y, born: nowT, life: 60 });
      textFx('📦 SUPPLY DROP', '#ffd23f', e.x, e.y, 110, 3);
    } else if (e.type === 'zone' && !reduceMotion) cam.shake = Math.max(cam.shake, 5);
  }

  function fxEvent(e) {
    if (!scene || !e) return;
    combatMarks(e);
    const P = e.playerId ? posOf(e.playerId) : null;
    const isMe = !!P && P.idx === meIdx;
    const px = P ? P.x : me.x;
    const pz = P ? P.y : me.y;
    const h = P && P.o && P.o.h !== undefined ? -P.o.h : 0; // heading in server terms
    const bx = px - Math.cos(h) * 16;
    const bz = pz - Math.sin(h) * 16;
    switch (e.type) {
      case 'shot': {
        if (P) strike(P.o);
        if (muzzleLight) {
          muzzleLight.position.set(e.x, 46, e.y);
          muzzleT = 0.07;
        }
        const gh = 30;
        burst(e.x, gh, e.y, '#ffd27a', 4, 40, 16, 0.12, 0);
        for (const end of e.ends || []) {
          tracer(e.x, gh, e.y, end[0], gh - 4, end[1], e.w === 4 ? '#ffb347' : '#ffe6a0', 0.1, e.w === 3 ? 0.8 : 1);
          burst(end[0], 14, end[1], '#ffe9b0', 3, 60, 7, 0.3, 90);
        }
        if (isMe && !reduceMotion) cam.shake = Math.max(cam.shake, e.w === 4 ? 6 : e.w === 3 ? 1.6 : 2.6);
        break;
      }
      case 'melee': {
        if (P) strike(P.o);
        if (e.hit) {
          const hx = px + Math.cos(h) * 30;
          const hz = pz + Math.sin(h) * 30;
          burst(hx, 30, hz, e.w === 1 ? '#f1c98a' : '#ffd0d0', 8, 90, 10, 0.4, 120);
          if (isMe && !reduceMotion) cam.shake = Math.max(cam.shake, 3);
        }
        break;
      }
      case 'hit': {
        const col = HIT_COLOR[e.k] || '#fff';
        if (e.dmg > 0) {
          burst(e.x, 34, e.y, e.k === 0 ? '#ff4d4d' : '#ffd7a0', e.k === 0 ? 10 : 7, 70, 9, 0.5, 130);
          textFx(String(e.dmg), col, e.x + rand(-6, 6), e.y + rand(-6, 6), 62, 0.9);
        } else if (e.k === 4) {
          textFx('BLOCKED', '#9fe6ff', e.x, e.y, 62, 0.8);
        }
        if (e.playerId && e.playerId === (players[meIdx] || {}).playerId && !reduceMotion) cam.shake = Math.max(cam.shake, 5 + Math.min(8, e.dmg * 0.2));
        break;
      }
      case 'down': {
        puff(e.x, 24, e.y, 4, '#8a8f99', 22, 1.2, 12);
        break;
      }
      case 'boom': {
        burst(e.x, 24, e.y, '#ffb347', 34, 240, 26, 0.9, -10);
        burst(e.x, 24, e.y, '#ff5a2a', 18, 160, 20, 0.7, 20);
        puff(e.x, 30, e.y, 16, '#2a2a2e', 44, 3.2, 26);
        bigFlash(e.x, 28, e.y, 240);
        const d = Math.hypot(e.x - me.x, e.y - me.y);
        if (!reduceMotion) cam.shake = Math.max(cam.shake, clamp(26 - d / 30, 0, 26));
        break;
      }
      case 'crash': {
        burst(e.x, 18, e.y, '#ffd27a', 10, 130, 9, 0.4, 160);
        puff(e.x, 20, e.y, 3, '#9a9a9a', 22, 1, 12);
        const d = Math.hypot(e.x - me.x, e.y - me.y);
        if (!reduceMotion) cam.shake = Math.max(cam.shake, clamp(9 - d / 60, 0, 9));
        break;
      }
      case 'pickup':
        burst(e.x, 24, e.y, '#8dffb0', 12, 90, 9, 0.7, 30);
        if (isMe) textFx(e.what === 'cash' ? '+$' : e.what === 'health' ? '❤️ +HP' : e.what === 'armor' ? '🛡️ +ARMOR' : `🔫 ${String(e.what).toUpperCase()}`, '#8dffb0', px, pz, 74, 1.4);
        break;
      case 'carjack':
        textFx('🚗 CARJACK!', '#ffd23f', px, pz, 80, 1.3);
        break;
      case 'heist':
        textFx('💰 HEIST!', '#ffd23f', px, pz, 80, 1.6);
        burst(px, 50, pz, '#ffd23f', 30, 150, 11, 1, 40);
        break;
      case 'reward':
        textFx(e.kind === 'gun' ? '🔫 ARSENAL!' : e.kind === 'hospital' ? '❤️ PATCHED UP' : '✔ DONE', '#8dffb0', px, pz, 80, 1.5);
        burst(px, 44, pz, '#8dffb0', 22, 120, 10, 0.9, 40);
        break;
      case 'respawn':
        burst(px, 6, pz, '#9fe6ff', 22, 120, 12, 0.9, -20);
        break;
      case 'wanted':
        if (isMe) textFx(`⭐ WANTED ${'★'.repeat(e.level || 1)}`, '#ff9aa9', px, pz, 86, 1.6);
        break;
      case 'fart':
        puff(bx, 30, bz, e.big ? 16 : 9, '#b5cf6a', e.big ? 30 : 22, e.big ? 2.2 : 1.5, 18);
        if (!reduceMotion) textFx(TOOT_WORDS[(e.kind || 0) % TOOT_WORDS.length], '#c8e58a', px, pz, 70, 1.2);
        break;
      case 'accident':
        puff(px, 26, pz, 30, '#8fb04c', 38, 3, 16);
        puff(px, 40, pz, 12, '#6d7c3a', 30, 3.4, 22);
        textFx('💩 OOPS! −$250', '#e0c56a', px, pz, 80, 2.4);
        if (isMe && !reduceMotion) cam.shake = Math.max(cam.shake, 9);
        break;
      case 'relief':
        burst(px, 40, pz, '#ffe27a', 30, 120, 12, 1, 40);
        puff(px, 20, pz, 8, '#ffffff', 26, 1.4, 30);
        textFx('😌 AAAH!', '#ffe27a', px, pz, 80, 2);
        break;
      case 'shout':
        textFx('📢 AAAAH!', '#bfe6ff', px, pz, 80, 1.4);
        break;
      default:
        break;
    }
  }

  function say(playerId, text) {
    const idx = indexById.get(playerId);
    if (idx === undefined) return;
    bubbles.set(idx, { text: String(text).slice(0, 34), until: nowT + 3.2 });
  }

  function floatText(text, color) {
    textFx(text, color || '#ffe08a', me.x, me.y, 80, 1.6);
    if (scene && me.init) burst(me.x, 40, me.y, color || '#ffe08a', 26, 90, 9, 0.9, 80);
  }

  /* ---------------------------------------------------- start / state */

  function start(payload, myPlayerId, h) {
    hooks = h || hooks;
    map = payload.map;
    missions = payload.missions;
    players = payload.players;
    npcLooks = payload.npcLooks || [];
    indexById = new Map(players.map((p, i) => [p.playerId, i]));
    meIdx = indexById.has(myPlayerId) ? indexById.get(myPlayerId) : -1;
    offset = payload.serverNow - Date.now();
    startsAt = payload.startsAt;
    mode = payload.mode || 'city';
    weather = ['clear', 'clear', 'rain', 'fog', 'clear', 'rain'][Math.abs(Math.floor((payload.startsAt || 0) / 1000)) % 6];
    if (/[?&]weather=(rain|fog|clear)/.test(location.search)) weather = RegExp.$1;
    lightning.next = 6;
    hooks.weather && hooks.weather(weather);
    airUntil = payload.airUntil || 0;
    spectateIdx = -1;
    hitDirs.length = 0;
    flares.length = 0;
    ads = false;
    adsK = 0;
    snaps = [];
    cur = null;
    fx.length = 0;
    bubbles.clear();
    fire.key = fire.btn = false;
    fire.ptr = null;
    me = newMe();
    ensureWorld();
    missionBuilding = missions.map((m) => map.buildings.findIndex((b) => b.door.x === m.door.x && b.door.y === m.door.y));
    buildEntities();
    if (payload.snapshot) applyState(payload.snapshot);
    running = false;
    resize();
    Promise.race([Promise.all([Soldier.load(), loadCars()]), new Promise((r) => setTimeout(r, 9000))]).then(begin);
  }

  function buildEntities() {
    while (entityGroup.children.length) entityGroup.remove(entityGroup.children[0]);
    npcObjs = [];
    carObjs = [];
    guardObjs = [];
    copObjs = [];
    pickupObjs = new Map();
    playerObjs = players.map(() => null);
    cam.yaw = cam.yawT = 0;
    cam.pitch = cam.pitchT = 1.0;
    cam.dist = cam.distT = 330;
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
    fire.key = fire.btn = false;
    fire.ptr = null;
    joy = { x: 0, y: 0 };
  }

  function applyState(s) {
    snaps.push(s);
    if (snaps.length > 12) snaps.shift();
    const e = s.p.find((r) => r[0] === meIdx);
    if (!e) return;
    const [, sx, sy, ang, flags, mission, cash, weapon, hp, armor, bladder, w, kmask, wanted, ammo, kills, hold, owned, mag] = e;
    me.flags = flags;
    me.mission = mission;
    me.cash = cash;
    me.weapon = weapon;
    me.hp = hp;
    me.armor = armor;
    me.bladder = bladder || 0;
    me.world = w || 0;
    me.keys = kmask || 0;
    me.wanted = wanted || 0;
    me.ammo = ammo;
    me.kills = kills || 0;
    me.hold = hold || 0;
    me.owned = owned || 1;
    me.mag = mag == null ? -1 : mag;
    me.reloading = !!(flags & 32768);
    me.place = mode === 'royale' ? mission : 0;
    me.spectate = spectateIdx;
    if (!me.init) {
      me.x = sx;
      me.y = sy;
      me.ang = ang / 100;
      me.init = true;
      cam.x = sx;
      cam.z = sy;
    } else if (flags & 4) {
      // driving: the car mesh is the truth (see syncEntities)
    } else if (mode === 'royale' && flags & 2048) {
      // eliminated: the camera follows someone else (see updateCamera)
    } else {
      const err = Math.hypot(sx - me.x, sy - me.y);
      if (err > 90 || flags & (1 | 2048 | 128)) {
        me.x = sx;
        me.y = sy;
      } else if (err > 3) {
        me.x += (sx - me.x) * 0.25;
        me.y += (sy - me.y) * 0.25;
      }
    }
    hooks.onState && hooks.onState(me, s);
  }

  /* -------------------------------------------------- snapshot lookup */

  const lerpAng = (a, b, k) => a + angDiff(a, b) * k;

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
        const jump = Math.hypot(e[1] - o[1], e[2] - o[2]) > 150; // respawn / teleport: no sliding across the map
        return { idx: e[0], x: jump ? e[1] : l(o[1], e[1]), y: jump ? e[2] : l(o[2], e[2]), ang: lerpAng(o[3] / 100, e[3] / 100, k), flags: e[4], mission: e[5], cash: e[6], weapon: e[7], hp: e[8], armor: e[9], bladder: e[10] || 0, world: e[11] || 0, wanted: e[13] || 0 };
      }),
      n: b.n.map((e, i) => {
        const o = a.n[i] || e;
        const jump = Math.hypot(e[0] - o[0], e[1] - o[1]) > 150;
        return { x: jump ? e[0] : l(o[0], e[0]), y: jump ? e[1] : l(o[1], e[1]), d: e[2], walk: e[3], state: e[4], look: npcLooks[i] || [0, 0] };
      }),
      c: b.c.map((e, i) => {
        const o = a.c[i] || e;
        const jump = Math.hypot(e[0] - o[0], e[1] - o[1]) > 150;
        return { x: jump ? e[0] : l(o[0], e[0]), y: jump ? e[1] : l(o[1], e[1]), ang: lerpAng(o[2] / 100, e[2] / 100, k), color: e[3], driver: e[4], hp: e[5], mode: e[6] };
      }),
      gd: (b.gd || []).map((e, i) => {
        const o = (a.gd || [])[i] || e;
        return { x: l(o[0], e[0]), y: l(o[1], e[1]), ang: lerpAng(o[2] / 100, e[2] / 100, k), hp: e[3], alive: e[4], shooting: e[5] };
      }),
      cp: (b.cp || []).map((e, i) => {
        const o = (a.cp || [])[i] || e;
        const jump = Math.hypot(e[0] - o[0], e[1] - o[1]) > 150;
        return { x: jump ? e[0] : l(o[0], e[0]), y: jump ? e[1] : l(o[1], e[1]), ang: lerpAng(o[2] / 100, e[2] / 100, k), hp: e[3], shooting: e[4] };
      }),
      pk: b.pk || [],
      z: b.z ? [l(a.z ? a.z[0] : b.z[0], b.z[0]), l(a.z ? a.z[1] : b.z[1], b.z[1]), l(a.z ? a.z[2] : b.z[2], b.z[2]), b.z[3], b.z[4], b.z[5], b.z[6], b.z[7], b.z[8], b.z[9]] : null,
      al: b.al,
      endsAt: b.endsAt,
    };
  }

  /* --------------------------------------------------- per-frame sync */

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
    if (d > 0.08 && !obj.holdYaw) obj.h += angDiff(obj.h, yawOf(Math.atan2(dy, dx))) * Math.min(1, dt * 12);
    return { moved: d, speed: dt > 0 ? d / dt : 0 };
  }

  function turnTo(obj, ang, dt, rate) {
    obj.h += angDiff(obj.h, yawOf(ang)) * Math.min(1, dt * (rate || 14));
  }

  function buildChute(tint) {
    const g = new T.Group();
    const canopy = new T.Mesh(
      new T.SphereGeometry(34, 20, 8, 0, TAU, 0, Math.PI * 0.5),
      new T.MeshStandardMaterial({ color: tint, roughness: 0.7, side: T.DoubleSide, emissive: tint, emissiveIntensity: 0.15 })
    );
    canopy.position.y = 96;
    canopy.scale.y = 0.7;
    canopy.castShadow = false;
    g.add(canopy);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      pts.push(new T.Vector3(Math.cos(a) * 34, 96, Math.sin(a) * 34), new T.Vector3(0, 48, 0));
    }
    g.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0xe8e8e8 })));
    g.visible = false;
    return g;
  }

  function buildZone() {
    const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
    const fs = `uniform float time; varying vec2 vUv;
      void main(){
        float h = vUv.y;
        float bands = 0.5 + 0.5 * sin(vUv.x * 220.0 + time * 1.6) * sin(h * 14.0 - time * 2.4);
        float a = (1.0 - h) * (0.10 + 0.10 * bands) + 0.012;
        a *= smoothstep(0.9, 0.3, h);
        gl_FragColor = vec4(vec3(0.3, 0.55, 0.95), a);
      }`;
    const geo = new T.CylinderGeometry(1, 1, 900, 112, 1, true);
    geo.translate(0, 450, 0);
    const wall = new T.Mesh(geo, new T.ShaderMaterial({ uniforms: { time: { value: 0 } }, vertexShader: vs, fragmentShader: fs, transparent: true, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
    wall.frustumCulled = false;
    wall.visible = false;
    scene.add(wall);
    const ringGeo = new T.RingGeometry(0.99, 1, 128);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, toneMapped: false, side: T.DoubleSide, depthWrite: false }));
    ring.frustumCulled = false;
    ring.visible = false;
    scene.add(ring);
    return { wall, ring };
  }

  function makeNpc(i, n) {
    const look = n.look;
    const o = buildPerson({ tint: SHIRT[look[1] % SHIRT.length], mix: 0.4, sv: 0.94 * (0.93 + ((look[0] * 7 + look[1] + i) % 8) * 0.013), shadow: q.npcShadows });
    entityGroup.add(o.root);
    return o;
  }

  function smokeCar(c, dt) {
    if (c.mode === 3) {
      if (Math.random() < dt * 14) puff(c.x, 28, c.y, 1, '#1f1f22', 34, 2.4, 26);
      if (Math.random() < dt * 5) puff(c.x + rand(-8, 8), 20, c.y + rand(-8, 8), 1, '#ff7a2a', 18, 0.7, 30);
    } else if (c.hp < 25) {
      if (Math.random() < dt * 12) puff(c.x, 24, c.y, 1, '#3a3a3e', 26, 1.8, 22);
      if (Math.random() < dt * 4) puff(c.x + rand(-6, 6), 18, c.y + rand(-6, 6), 1, '#ff8a3a', 14, 0.6, 26);
    } else if (c.hp < 55) {
      if (Math.random() < dt * 8) puff(c.x + Math.cos(c.ang) * 18, 22, c.y + Math.sin(c.ang) * 18, 1, '#b8b8bc', 20, 1.6, 20);
    }
  }

  function syncEntities(s, dt) {
    labels.length = 0;
    cur = s;
    const shadows = q.npcShadows;

    // traffic, parked and wrecked cars, and the ones people are driving
    let myCar = null;
    for (let i = 0; i < s.c.length; i++) {
      const c = s.c[i];
      let o = carObjs[i];
      if (!o) {
        o = carObjs[i] = buildCar(CAR_COLORS[c.color % CAR_COLORS.length], c.color);
        o.wreck = false;
        entityGroup.add(o.root);
      }
      if (c.mode === 3 && !o.wreck) {
        o.wreck = true;
        if (o.setWreck) o.setWreck(true);
        else
          o.root.traverse((m) => {
            if (m.isMesh && m.material === o.paint) m.material = charMat;
          });
      } else if (c.mode !== 3 && o.wreck) {
        o.wreck = false;
        if (o.setWreck) o.setWreck(false);
        else
          o.root.traverse((m) => {
            if (m.isMesh && m.material === charMat) m.material = o.paint;
          });
      }
      const f = facing(o, c.x, c.y, dt, yawOf(c.ang));
      o.h = yawOf(c.ang);
      o.root.position.set(c.x, 0, c.y);
      o.root.rotation.y = o.h;
      o.spin += f.moved / 6.4;
      for (const w of o.wheels) w.rotation[o.axis || 'z'] = o.axis ? o.spin * o.spinSign : -o.spin;
      const op = c.mode === 3 ? 0 : world.night * 0.9;
      for (const l of o.lamps) l.material.opacity = op;
      o.head.emissiveIntensity = 0.4 + world.night * 3;
      o.pos = { x: c.x, y: c.y };
      smokeCar(c, dt);
      if (c.driver === meIdx) myCar = c;
      if (c.driver >= 0 && c.mode === 1 && f.moved > 0.5 && Math.random() < dt * 14) burst(c.x - Math.cos(c.ang) * 30, 4, c.y - Math.sin(c.ang) * 30, '#cfc9bd', 1, 28, 14, 0.6, -10);
    }
    // driving: the camera follows the rendered car
    if (myCar && me.flags & 4) {
      me.x = myCar.x;
      me.y = myCar.y;
      me.ang = myCar.ang;
    }

    // pedestrians
    for (let i = 0; i < s.n.length; i++) {
      const n = s.n[i];
      let o = npcObjs[i];
      if (!o) o = npcObjs[i] = makeNpc(i, n);
      const f = facing(o, n.x, n.y, dt, n.d > 0 ? 0 : Math.PI);
      const dead = n.state === 2;
      const moving = !!n.walk && f.moved > 0.02 && !dead;
      o.root.position.set(n.x, 0, n.y);
      o.root.rotation.y = o.h;
      animatePerson(o, dt, moving, n.state === 1 ? 130 : f.speed, { dead, weapon: 0, atkAge: 99, stunned: false });
      if (!shadows) o.blob.visible = !dead;
    }

    // guards and cops
    syncArmed(s.gd, guardObjs, GUARD_TINT, GUARD_HP, dt, 3, true);
    syncArmed(s.cp, copObjs, COP_TINT, COP_HP, dt, 2, false);

    // loot
    const seen = new Set();
    for (const [id, x, y, code] of s.pk) {
      seen.add(id);
      let o = pickupObjs.get(id);
      if (!o) {
        const sp = new T.Sprite(new T.SpriteMaterial({ map: iconTexture(PICKUP_ICON[code] || '💵', PICKUP_COLOR[code] || '#fff'), transparent: true, depthWrite: false, toneMapped: false }));
        sp.scale.set(26, 26, 1);
        entityGroup.add(sp);
        o = { sp, ph: Math.random() * TAU };
        pickupObjs.set(id, o);
      }
      o.sp.position.set(x, 20 + Math.sin(nowT * 3 + o.ph) * 3, y);
    }
    for (const [id, o] of pickupObjs) {
      if (!seen.has(id)) {
        entityGroup.remove(o.sp);
        o.sp.material.dispose();
        pickupObjs.delete(id);
      }
    }

    // players
    for (const e of s.p) {
      const info = players[e.idx];
      if (!info) continue;
      const isMe = e.idx === meIdx;
      let o = playerObjs[e.idx];
      if (e.flags & 64 || e.world === 1) {
        if (o) o.root.visible = false;
        continue;
      }
      const flags = isMe ? me.flags : e.flags;
      const x = isMe ? me.x : e.x;
      const y = isMe ? me.y : e.y;
      if (!o) {
        o = playerObjs[e.idx] = buildPerson({ tint: PLAYER_TINT[e.idx % PLAYER_TINT.length], mix: 0.55, gun: true });
        o.isMe = isMe;
        entityGroup.add(o.root);
      }
      const inCar = !!(flags & 4);
      const air = !!(flags & 131072);
      const airH = air ? 520 * Math.pow(clamp((airUntil - nowServer()) / AIR_MS, 0, 1), 0.85) : 0;
      if (air && !o.chute) {
        o.chute = buildChute(PLAYER_TINT[e.idx % PLAYER_TINT.length]);
        o.root.add(o.chute);
      }
      if (o.chute) o.chute.visible = air;
      if (o.wasAir && !air) burst(x, 4, y, '#d9d2c2', 16, 90, 16, 0.8, -10);
      o.wasAir = air;
      o.blob.position.y = 0.9 - airH;
      o.root.visible = !inCar;
      o.pos = { x, y };
      if (inCar) {
        labels.push({ x, z: y, h: 62, info, isMe, idx: e.idx, flags, hp: e.hp, armor: e.armor, wanted: e.wanted, dead: false });
        continue;
      }
      const dead = !!(flags & 2048);
      const f = facing(o, x, y, dt, yawOf(e.ang));
      // a strike seen only through the flags (bots) still animates
      if (flags & 4096 && nowT - o.lastAtk > 0.35) strike(o);
      const attacking = nowT - o.lastAtk < 0.4;
      // face where you aim; otherwise where you walk
      if (isMe) {
        o.holdYaw = true;
        turnTo(o, me.ang, dt, 16);
      } else if (attacking || f.moved < 0.05) {
        o.holdYaw = true;
        turnTo(o, e.ang, dt, 14);
      } else o.holdYaw = false;
      let moving = f.moved > 0.03;
      if (isMe) {
        const v = inputVector();
        moving = (!!(v.dx || v.dy) && speedOf(flags) > 0) || f.moved > 0.2;
      }
      o.root.position.set(x, airH, y);
      o.root.rotation.y = o.h;
      const bl = isMe ? me.bladder : e.bladder;
      const weapon = isMe ? me.weapon : e.weapon;
      animatePerson(
        o,
        dt,
        moving && !dead && !air,
        f.speed,
        Object.assign(
          {
            weapon,
            atkAge: nowT - o.lastAtk,
            atkAlt: o.atkAlt,
            dead,
            hurt: !!(flags & 8192),
            ghost: !!(flags & 16384),
            stunned: !!(flags & 1),
            armed: weapon >= 2,
          },
          poseOf(bl, flags)
        )
      );
      if (isMe && moving && !dead && Math.random() < dt * 9) burst(x, 2, y, '#d9d2c2', 1, 18, 9, 0.5, -10);
      labels.push({ x, z: y, h: (dead ? 30 : 88) + airH, info, isMe, idx: e.idx, flags, hp: e.hp, armor: e.armor, wanted: e.wanted, dead });
    }
  }

  function syncArmed(list, objs, tint, maxHp, dt, weapon, isGuard) {
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      let o = objs[i];
      if (!o) {
        o = objs[i] = buildPerson({ tint, mix: 0.62, gun: true, sv: 0.98 });
        entityGroup.add(o.root);
      }
      const alive = isGuard ? !!g.alive : g.hp > 0;
      if (g.shooting && nowT - o.lastAtk > 0.32) strike(o);
      const f = facing(o, g.x, g.y, dt, yawOf(g.ang));
      const moving = f.moved > 0.03 && alive;
      if (g.shooting || f.moved < 0.05) {
        o.holdYaw = true;
        turnTo(o, g.ang, dt, 12);
      } else o.holdYaw = false;
      o.root.position.set(g.x, 0, g.y);
      o.root.rotation.y = o.h;
      animatePerson(o, dt, moving, f.speed, { weapon, atkAge: nowT - o.lastAtk, atkAlt: 0, dead: !alive, hurt: false });
      o.root.visible = alive || o.deadK > 0.02;
      if (alive) labels.push({ x: g.x, z: g.y, h: 84, info: null, npcHp: g.hp / maxHp, isCop: !isGuard, isGuard });
    }
    for (let i = list.length; i < objs.length; i++) if (objs[i]) objs[i].root.visible = false;
  }

  /* --------------------------------------------------------- camera */

  function updateCamera(dt) {
    const aspect = W / Math.max(1, H);
    camera.aspect = aspect;
    adsK += ((ads && !(me.flags & 4) ? 1 : 0) - adsK) * Math.min(1, dt * 8);
    const sniper = me.weapon === 6;
    camera.fov = (aspect < 0.9 ? 60 : 46) - adsK * (sniper ? 20 : 11);
    camera.updateProjectionMatrix();
    let tx = me.init ? me.x : map.w / 2;
    let tz = me.init ? me.y : map.h / 2;
    me.spectate = -1;
    if (mode === 'royale' && me.flags & 2048 && cur) {
      // eliminated: watch whoever is still standing
      const alive = (idx) => {
        const e = cur.p.find((r) => r.idx === idx);
        return !!e && !(e.flags & (2048 | 64));
      };
      if (spectateIdx < 0 || !alive(spectateIdx)) {
        let best = -1;
        let bestHp = -1;
        for (const e of cur.p) {
          if (e.flags & (2048 | 64) || e.idx === meIdx) continue;
          if (e.hp > bestHp) {
            bestHp = e.hp;
            best = e.idx;
          }
        }
        spectateIdx = best;
      }
      const o = playerObjs[spectateIdx];
      if (o && o.pos) {
        tx = o.pos.x;
        tz = o.pos.y;
        me.spectate = spectateIdx;
      }
    }
    cam.x += (tx - cam.x) * Math.min(1, dt * 9);
    cam.z += (tz - cam.z) * Math.min(1, dt * 9);
    cam.yaw += angDiff(cam.yaw, cam.yawT) * Math.min(1, dt * 10);
    cam.pitch += (cam.pitchT - cam.pitch) * Math.min(1, dt * 8);
    cam.dist += (cam.distT - cam.dist) * Math.min(1, dt * 8);
    const portraitBoost = aspect < 0.9 ? 1 + (0.9 - aspect) * 0.9 : 1;
    const inCar = !!(me.flags & 4);
    const airNow = !!(me.flags & 131072);
    const d = Math.max(120, (cam.dist + (inCar ? 90 : 0) + (airNow ? 220 : 0)) * portraitBoost * (1 - adsK * (sniper ? 0.5 : 0.28)));
    const fx_ = Math.sin(cam.yaw);
    const fz_ = -Math.cos(cam.yaw);
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    camPos.set(cam.x - fx_ * d * cp, d * sp + 14, cam.z - fz_ * d * cp);
    if (cam.shake > 0.05) {
      camPos.x += (Math.random() - 0.5) * cam.shake;
      camPos.y += (Math.random() - 0.5) * cam.shake * 0.6;
      camPos.z += (Math.random() - 0.5) * cam.shake;
      cam.shake *= Math.pow(0.02, dt);
    }
    camera.position.copy(camPos);
    camera.lookAt(cam.x + fx_ * 26, 20, cam.z + fz_ * 26);
    // a desperate bladder makes the world sway
    const sway = clamp((me.bladder - 70) / 30, 0, 1);
    if (sway > 0 && !reduceMotion) camera.rotation.z += Math.sin(nowT * 3.1) * 0.018 * sway;
    focus.x = cam.x;
    focus.z = cam.z;
  }

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
    return { x: sx, y: sy, behind, z: _v.z };
  }

  // where a screen point lands on the ground
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

  // what the floating icon / GPS points at: your mission, or the safe zone when you are in the storm
  function markTarget() {
    if (mode === 'royale') {
      const z = cur && cur.z;
      return z && me.flags & 65536 ? { door: { x: z[3], y: z[4] }, icon: '🌀', name: 'Safe zone' } : null;
    }
    return missions[me.mission] || null;
  }

  /* --------------------------------------------------------- overlay */

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

  function bar(x, y, w, h, k, fill, back) {
    octx.fillStyle = back || 'rgba(0,0,0,0.55)';
    rr(octx, x - 1, y - 1, w + 2, h + 2, 3);
    octx.fill();
    octx.fillStyle = fill;
    octx.fillRect(x, y, Math.max(0, w * clamp(k, 0, 1)), h);
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
      if (!L.info) {
        // guards and cops: a health bar over the head
        const w = 34 * sc;
        bar(p.x - w / 2, p.y - 4, w, 5 * sc, L.npcHp, L.isCop ? '#5a8bff' : '#ffb347');
        continue;
      }
      const fs = 12.5 * sc;
      octx.font = `700 ${fs}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      const name = L.info.name.length > 9 ? L.info.name.slice(0, 8) + '…' : L.info.name;
      const label = `${L.info.avatar} ${name}`;
      const w = octx.measureText(label).width + 14;
      const top = p.y - fs - 6;
      octx.globalAlpha = L.dead ? 0.55 : 1;
      octx.fillStyle = L.isMe ? 'rgba(255,210,63,0.94)' : 'rgba(10,14,36,0.78)';
      rr(octx, p.x - w / 2, top, w, fs + 10, 9);
      octx.fill();
      octx.fillStyle = L.isMe ? '#2a1b00' : '#fff';
      octx.fillText(label, p.x, p.y - 3);
      if (!L.dead) {
        const bw = Math.max(46, w) * (L.isMe ? 0.9 : 1);
        bar(p.x - bw / 2, top - 8 * sc, bw, 5 * sc, L.hp / 100, L.hp > 50 ? '#3ee08f' : L.hp > 25 ? '#ffb703' : '#ff5470');
        if (L.armor > 0) bar(p.x - bw / 2, top - 14 * sc, bw, 3 * sc, L.armor / 100, '#5ac8ff');
      } else {
        octx.font = `${20 * sc}px system-ui, "Apple Color Emoji", sans-serif`;
        octx.fillText('💀', p.x, top - 6);
      }
      octx.globalAlpha = 1;
      if (L.wanted > 0 && !L.isMe) {
        octx.font = `${12 * sc}px system-ui, "Apple Color Emoji", sans-serif`;
        octx.fillText('⭐'.repeat(Math.min(5, L.wanted)), p.x, top - (L.armor > 0 ? 20 : 14) * sc);
      }
      if (L.flags & 1) {
        octx.font = `${16 * sc}px system-ui, "Apple Color Emoji", sans-serif`;
        for (let k = 0; k < 3; k++) {
          const a = nowT * 5 + k * 2.1;
          octx.fillText('⭐', p.x + Math.cos(a) * 18, p.y - fs - 24 + Math.sin(a) * 5);
        }
      }
      if (L.flags & 32) {
        octx.font = `${24 * sc}px system-ui, "Apple Color Emoji", sans-serif`;
        octx.fillText('🏁', p.x, top - 20);
      }
      const b = bubbles.get(L.idx);
      if (b && b.until > nowT) {
        octx.font = `700 ${12.5 * sc}px system-ui, "Apple Color Emoji", sans-serif`;
        const bw = Math.min(230, octx.measureText(b.text).width + 18);
        const by = top - 34 * sc;
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
    // mission icon floating over the target
    const target = markTarget();
    if (target) {
      const p = project(target.door.x, 120, target.door.y);
      if (!p.behind && p.x > 0 && p.x < W && p.y > 0 && p.y < H) {
        const bob = Math.sin(nowT * 3) * 4;
        octx.font = '30px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        octx.fillStyle = '#fff';
        octx.fillText(target.icon, p.x, p.y + bob);
        const dist = Math.round(Math.hypot(target.door.x - me.x, target.door.y - me.y) / 10);
        octx.font = '800 12px system-ui, sans-serif';
        octx.strokeStyle = 'rgba(0,0,0,0.7)';
        octx.lineWidth = 3;
        octx.strokeText(`${dist} m`, p.x, p.y + 18 + bob);
        octx.fillStyle = '#ffd23f';
        octx.fillText(`${dist} m`, p.x, p.y + 18 + bob);
      }
    }
    // "F" prompt over the nearest free car
    if (cur && !(me.flags & (4 | 2048 | 32))) {
      let best = null;
      let bd = 66;
      for (const c of cur.c) {
        if (c.mode === 3 || c.driver >= 0) continue;
        const d = Math.hypot(c.x - me.x, c.y - me.y);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (best) {
        const p = project(best.x, 46, best.y);
        if (!p.behind) {
          octx.font = '800 13px system-ui, "Apple Color Emoji", sans-serif';
          const txt = mobile ? '🚗 tap 🚗' : '🚗 press F';
          const w = octx.measureText(txt).width + 16;
          octx.fillStyle = 'rgba(10,14,36,0.85)';
          rr(octx, p.x - w / 2, p.y - 15, w, 24, 9);
          octx.fill();
          octx.fillStyle = '#ffd23f';
          octx.fillText(txt, p.x, p.y + 2);
        }
      }
    }
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      const k = (nowT - f.born) / f.life;
      if (k >= 1) {
        fx.splice(i, 1);
        continue;
      }
      const p = project(f.x, f.h + k * 40, f.y);
      if (p.behind) continue;
      octx.globalAlpha = 1 - k * k;
      const big = /^\d+$/.test(f.text);
      octx.font = `800 ${big ? 19 : 21}px system-ui, "Apple Color Emoji", sans-serif`;
      octx.strokeStyle = 'rgba(0,0,0,0.65)';
      octx.lineWidth = 4;
      octx.strokeText(f.text, p.x, p.y);
      octx.fillStyle = f.color;
      octx.fillText(f.text, p.x, p.y);
      octx.globalAlpha = 1;
    }
  }

  function drawMinimap() {
    if (!mctx || !map) return;
    const mw = mini.width;
    const mh = mini.height;
    const k = Math.min(mw / map.w, mh / map.h);
    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = '#243044';
    mctx.fillRect(0, 0, mw, mh);
    mctx.fillStyle = '#6f7a8c';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) mctx.fillRect((c * map.colStep + 100) * k, (r * map.rowStep + 100) * k, 380 * k, 260 * k);
    mctx.fillStyle = '#3f8f4f';
    for (const p of map.parks) mctx.fillRect(p.x * k, p.y * k, p.w * k, p.h * k);
    for (const b of map.buildings) {
      mctx.fillStyle = b.color;
      mctx.fillRect(b.x * k, b.y * k, b.w * k, b.h * k);
    }
    if (mode === 'royale' && cur && cur.z) {
      const z = cur.z;
      mctx.lineWidth = 2;
      mctx.strokeStyle = '#7fd4ff';
      mctx.beginPath();
      mctx.arc(z[0] * k, z[1] * k, Math.max(1, z[2] * k), 0, TAU);
      mctx.stroke();
      mctx.lineWidth = 1.5;
      mctx.strokeStyle = '#ffffff';
      mctx.beginPath();
      mctx.arc(z[3] * k, z[4] * k, Math.max(1, z[5] * k), 0, TAU);
      mctx.stroke();
    }
    const target = markTarget();
    if (target) {
      const pulse = 3 + Math.sin(nowT * 5) * 1.5;
      mctx.strokeStyle = '#ffd23f';
      mctx.lineWidth = 2;
      mctx.beginPath();
      mctx.arc(target.door.x * k, target.door.y * k, pulse + 2, 0, TAU);
      mctx.stroke();
      mctx.fillStyle = '#ffd23f';
      mctx.beginPath();
      mctx.arc(target.door.x * k, target.door.y * k, 2.5, 0, TAU);
      mctx.fill();
    }
    const dot = (x, y, r, col) => {
      mctx.fillStyle = col;
      mctx.beginPath();
      mctx.arc(x * k, y * k, r, 0, TAU);
      mctx.fill();
    };
    if (cur) {
      for (const c of cur.c) {
        if (c.mode === 3) continue;
        mctx.fillStyle = c.driver >= 0 ? '#ffe066' : 'rgba(255,255,255,0.45)';
        mctx.fillRect(c.x * k - 1.5, c.y * k - 1.5, 3, 3);
      }
      for (const g of cur.gd) if (g.alive) dot(g.x, g.y, 2, '#ff9d3a');
      const flash = Math.sin(nowT * 10) > 0;
      for (const c of cur.cp) if (c.hp > 0) dot(c.x, c.y, 2.6, flash ? '#4d7dff' : '#ff4d5e');
      for (const e of cur.p) {
        if (e.flags & 64 || e.world === 1 || e.flags & 2048) continue;
        const isMe = e.idx === meIdx;
        dot(isMe ? me.x : e.x, isMe ? me.y : e.y, isMe ? 4 : 3, isMe ? '#ffffff' : players[e.idx] && players[e.idx].isBot ? '#ff8a8a' : '#7fd4ff');
      }
    }
    // where the camera is looking
    if (me.init) {
      mctx.fillStyle = 'rgba(255,255,255,0.28)';
      mctx.beginPath();
      const ax = me.x * k;
      const ay = me.y * k;
      const a0 = cam.yaw - Math.PI / 2;
      mctx.moveTo(ax, ay);
      mctx.arc(ax, ay, 26 * (mw / 180), a0 - 0.42, a0 + 0.42);
      mctx.closePath();
      mctx.fill();
    }
  }

  let frameAvg = 1 / 60;
  let slowFrames = 0;
  let qualityStep = 0;
  function adaptQuality(dt) {
    frameAvg = lerp(frameAvg, dt, 0.05);
    if (frameAvg > 1 / 26) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 2);
    if (slowFrames > 120 && qualityStep < 3) {
      qualityStep++;
      slowFrames = 0;
      if (qualityStep === 1) {
        dprMax = 1;
        if (post) post.setQuality(1);
        resize();
      } else if (qualityStep === 2) {
        world.sun.castShadow = false;
        if (post) post.setQuality(2);
      } else {
        renderer.setPixelRatio(0.75);
        dprMax = 0.75;
        resize();
      }
    }
  }

  /* ------------------------------------------------------------- loop */

  /* -------------------------------------------------------- weather */

  const GREY = new T.Color(0x3d4757);
  const MIST = new T.Color(0xaab4c2);
  const _skyTmp = new T.Color();

  function buildRain() {
    const N = mobile ? 900 : 1900;
    const base = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      base[i * 3] = rand(-560, 560);
      base[i * 3 + 1] = rand(0, 520);
      base[i * 3 + 2] = rand(-560, 560);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(N * 6), 3));
    const mesh = new T.LineSegments(geo, new T.LineBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.5, depthWrite: false, fog: false }));
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, base, N };
  }

  function stepRain(dt) {
    if (!rain) return;
    const on = weather === 'rain';
    rain.mesh.visible = on;
    if (!on) return;
    const pos = rain.mesh.geometry.attributes.position.array;
    const b = rain.base;
    for (let i = 0; i < rain.N; i++) {
      let y = b[i * 3 + 1] - dt * 780;
      if (y < 0) {
        y += 520;
        b[i * 3] = rand(-560, 560);
        b[i * 3 + 2] = rand(-560, 560);
      }
      b[i * 3 + 1] = y;
      const x = focus.x + b[i * 3];
      const z = focus.z + b[i * 3 + 2];
      pos[i * 6] = x;
      pos[i * 6 + 1] = y;
      pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x - 4;
      pos[i * 6 + 4] = y + 22;
      pos[i * 6 + 5] = z - 1.5;
    }
    rain.mesh.geometry.attributes.position.needsUpdate = true;
  }

  // called after the sky has set its light for the time of day: dim it down for rain and fog
  function applyWeather() {
    let flash = 0;
    if (weather === 'rain') {
      world.sun.intensity *= 0.26;
      world.hemi.intensity *= 0.72;
      world.fog.color.lerp(GREY, 0.7);
      world.fog.near = 60;
      world.fog.far = 1250;
      const u = world.sky.material.uniforms;
      u.top.value.lerp(GREY, 0.75);
      u.mid.value.lerp(GREY, 0.75);
      if (nowT > lightning.next && !reduceMotion) {
        lightning.at = nowT;
        lightning.until = nowT + 0.32;
        lightning.next = nowT + 14 + Math.random() * 22;
        hooks.thunder && setTimeout(hooks.thunder, 600 + Math.random() * 900);
      }
      if (nowT < lightning.until) flash = Math.max(0, 1 - (nowT - lightning.at) / 0.32) * (Math.sin((nowT - lightning.at) * 55) > -0.3 ? 1 : 0.35);
      world.hemi.intensity += flash * 3.2;
      world.sun.intensity += flash * 1.5;
    } else if (weather === 'fog') {
      world.sun.intensity *= 0.7;
      world.fog.color.lerp(MIST, 0.8);
      world.fog.near = 40;
      world.fog.far = 1150;
      const u = world.sky.material.uniforms;
      u.top.value.lerp(MIST, 0.6);
      u.mid.value.lerp(MIST, 0.85);
    } else {
      world.fog.near = 900;
      world.fog.far = 4300;
    }
    void _skyTmp;
  }

  function updateZone(s) {
    const on = mode === 'royale' && !!s.z;
    zoneMesh.visible = on;
    nextRing.visible = on;
    if (!on) return;
    const z = s.z;
    zoneMesh.position.set(z[0], 0, z[1]);
    zoneMesh.scale.set(Math.max(1, z[2]), 1, Math.max(1, z[2]));
    zoneMesh.material.uniforms.time.value = nowT;
    nextRing.position.set(z[3], 1.5, z[4]);
    nextRing.scale.set(Math.max(1, z[5]), 1, Math.max(1, z[5]));
    for (const f of flares) {
      if (nowT - f.born > f.life) continue;
      if (Math.random() < 0.5) puff(f.x + rand(-4, 4), 8, f.y + rand(-4, 4), 1, '#ff3d3d', 26, 3.2, 70);
    }
  }

  let lastCross = 0;
  function drawCombatOverlay() {
    const dtc = nowT - lastCross;
    lastCross = nowT;
    cross.heat = Math.max(0, cross.heat - dtc * 1.6);
    const alive = !(me.flags & (2048 | 4 | 131072));
    // supply drop flares
    for (let i = flares.length - 1; i >= 0; i--) {
      const f = flares[i];
      if (nowT - f.born > f.life) {
        flares.splice(i, 1);
        continue;
      }
      const p = project(f.x, 90, f.y);
      if (p.behind || p.x < 10 || p.x > W - 10 || p.y < 10 || p.y > H - 10) continue;
      octx.font = '26px system-ui, "Apple Color Emoji", sans-serif';
      octx.textAlign = 'center';
      octx.fillText('📦', p.x, p.y);
      octx.font = '800 12px system-ui, sans-serif';
      octx.fillStyle = '#ffd23f';
      octx.fillText(`${Math.round(Math.hypot(f.x - me.x, f.y - me.y) / 10)} m`, p.x, p.y + 16);
    }
    // where the shots are going
    if (alive && me.weapon >= 2 && me.init) {
      const reach = me.weapon === 6 ? 380 : me.weapon === 4 ? 130 : 210;
      const p = project(me.x + Math.cos(me.ang) * reach, 26, me.y + Math.sin(me.ang) * reach);
      if (!p.behind) {
        const moving = !!(keys.up || keys.down || keys.left || keys.right || joy.x || joy.y);
        const gap = (me.weapon === 6 ? 3 : 7) + cross.heat * 16 + (moving ? 5 : 0) - adsK * 3 + (me.weapon === 4 ? 10 : 0);
        octx.strokeStyle = me.reloading ? 'rgba(255,210,90,0.9)' : 'rgba(255,255,255,0.92)';
        octx.lineWidth = 2;
        octx.shadowColor = 'rgba(0,0,0,0.8)';
        octx.shadowBlur = 3;
        octx.beginPath();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          octx.moveTo(p.x + dx * gap, p.y + dy * gap);
          octx.lineTo(p.x + dx * (gap + 8), p.y + dy * (gap + 8));
        }
        octx.stroke();
        octx.fillStyle = 'rgba(255,60,60,0.95)';
        octx.fillRect(p.x - 1, p.y - 1, 2, 2);
        octx.shadowBlur = 0;
        // hit marker
        const hk = nowT - hitMark.at;
        if (hk < 0.28) {
          octx.strokeStyle = hitMark.kill ? 'rgba(255,50,50,1)' : 'rgba(255,255,255,1)';
          octx.lineWidth = hitMark.kill ? 3.5 : 2.5;
          const r0 = 6 + hk * 30;
          octx.globalAlpha = 1 - hk / 0.28;
          octx.beginPath();
          for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            octx.moveTo(p.x + dx * r0, p.y + dy * r0);
            octx.lineTo(p.x + dx * (r0 + 8), p.y + dy * (r0 + 8));
          }
          octx.stroke();
          octx.globalAlpha = 1;
        }
      }
    }
    // a scope vignette for the sniper
    if (adsK > 0.05 && me.weapon === 6 && alive) {
      const g = octx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.18, W / 2, H / 2, Math.min(W, H) * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${0.75 * adsK})`);
      octx.fillStyle = g;
      octx.fillRect(0, 0, W, H);
    }
    // where you are being hit from
    const fwd = Math.atan2(-Math.cos(cam.yaw), Math.sin(cam.yaw));
    for (let i = hitDirs.length - 1; i >= 0; i--) {
      const h = hitDirs[i];
      const age = nowT - h.born;
      if (age > 1.5) {
        hitDirs.splice(i, 1);
        continue;
      }
      const rel = h.ang - fwd;
      const fxv = Math.cos(rel);
      const rxv = Math.sin(rel);
      const cx = W / 2 + rxv * Math.min(W, H) * 0.36;
      const cy = H / 2 - fxv * Math.min(W, H) * 0.36;
      octx.save();
      octx.translate(cx, cy);
      octx.rotate(Math.atan2(-fxv, rxv) + Math.PI / 2);
      octx.globalAlpha = 1 - age / 1.5;
      octx.fillStyle = 'rgba(255,40,50,0.95)';
      octx.beginPath();
      octx.moveTo(0, -16);
      octx.lineTo(22, 12);
      octx.lineTo(-22, 12);
      octx.closePath();
      octx.fill();
      octx.restore();
    }
    octx.globalAlpha = 1;
  }

  function frame(dt) {
    const s = sample(nowServer() - 110);
    if (!s || !world) return;
    const p = s.endsAt ? clamp(1 - (s.endsAt - nowServer()) / MATCH_MS, 0, 1) : 0;
    world.setTime(p);
    applyWeather();
    stepRain(dt);
    if (muzzleLight) {
      muzzleT = Math.max(0, muzzleT - dt);
      muzzleLight.intensity = (muzzleT / 0.07) * 9;
    }
    syncEntities(s, dt);
    updateCamera(dt);
    const target = mode === 'royale' ? markTarget() : missions[me.mission] || null;
    updateMarker(nowT);
    world.update(nowT, dt, focus, camPos, mode === 'royale' ? -1 : target ? missionBuilding[me.mission] : -1);
    updateZone(s);
    stepParticles(dt);
    stepSmoke(dt);
    stepTracers(dt);
    stepFlash(dt);
    if (post) {
      const ps = post.state;
      ps.hurt = Math.max(ps.hurt * Math.pow(0.02, dt), me.flags & 8192 ? 0.9 : 0);
      ps.lowHp = me.flags & 2048 ? 1 : clamp((38 - me.hp) / 38, 0, 1);
      ps.time = nowT;
      const n = world.night;
      ps.tint = me.flags & 65536 ? [0.8, 0.92, 1.25] : [1 - n * 0.06, 1 - n * 0.02, 1 + n * 0.1];
      ps.exposure = (0.98 + n * 0.12) * (weather === 'rain' ? 0.72 : weather === 'fog' ? 1.0 : 1);
      if (weather === 'rain') ps.tint = [ps.tint[0] * 0.93, ps.tint[1] * 0.98, ps.tint[2] * 1.08];
    }
    if (!(post && post.render(scene, camera))) renderer.render(scene, camera);
    drawOverlay();
    drawCombatOverlay();
    drawMinimap();
    if (hooks.gps) {
      const sp = target ? project(target.door.x, 20, target.door.y) : { x: 0, y: 0 };
      hooks.gps(target, sp, { x: me.x, y: me.y });
    }
    adaptQuality(dt);
  }

  const firing = () => fire.key || fire.btn || !!fire.ptr;

  function sendFire() {
    if (!firing() || me.flags & (4 | 2048 | 32) || nowServer() < startsAt) return;
    const nowMs = performance.now();
    if (nowMs - fire.last < FIRE_EVERY_MS) return;
    fire.last = nowMs;
    if (fire.ptr) {
      const g = groundPoint(fire.ptr.x, fire.ptr.y);
      if (g) me.ang = Math.atan2(g.y - me.y, g.x - me.x);
    }
    hooks.attack && hooks.attack(Math.round(me.ang * 1000) / 1000);
  }

  function loop(now) {
    if (!running) return;
    const t = now / 1000;
    const dt = Math.min(0.05, Math.max(0, t - last));
    last = t;
    nowT = t;
    if (map && me.init) {
      const v = inputVector();
      stepMe(dt, v);
      // face where you walk, unless you are fighting (then the aim holds, so you can strafe)
      if ((v.dx || v.dy) && !firing() && !(me.flags & 4)) me.ang = Math.atan2(v.dy, v.dx);
      const nowMs = performance.now();
      if (Math.abs(v.dx - lastSent.dx) > 0.02 || Math.abs(v.dy - lastSent.dy) > 0.02 || nowMs - lastSent.t > 250) {
        lastSent = { dx: v.dx, dy: v.dy, t: nowMs };
        hooks.sendInput && hooks.sendInput(v.dx, v.dy);
      }
      sendFire();
    }
    if (keys.rotL) cam.yawT -= dt * 1.8;
    if (keys.rotR) cam.yawT += dt * 1.8;
    try {
      frame(dt);
    } catch (err) {
      if (!loop.warned) {
        loop.warned = true;
        console.error('city frame failed', err);
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
    if (post) post.setSize(W * dpr, H * dpr);
    overlay.width = Math.round(W * dpr);
    overlay.height = Math.round(H * dpr);
    if (camera) {
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    }
  }

  /* --------------------------------------------------------- controls */

  function cycleWeapon() {
    const owned = me.owned || 1;
    for (let i = 1; i <= WEAPON_COUNT; i++) {
      const code = (me.weapon + i) % WEAPON_COUNT;
      if (owned & (1 << code)) {
        hooks.weapon && hooks.weapon(code);
        me.weapon = code;
        return code;
      }
    }
    return me.weapon;
  }

  function bindControls(joyEl, knobEl) {
    const KEYMAP = { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' };
    const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '').toUpperCase());
    window.addEventListener('keydown', (e) => {
      if (!running || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (KEYMAP[e.key]) {
        keys[KEYMAP[e.key]] = true;
        e.preventDefault();
      } else if (e.key === 'q' || e.key === 'Q') keys.rotL = true;
      else if (e.key === 'e' || e.key === 'E') keys.rotR = true;
      else if (e.key === ' ' || e.key === 'j' || e.key === 'J') {
        fire.key = true;
        e.preventDefault();
      } else if ((e.key === 'f' || e.key === 'F') && !e.repeat) {
        hooks.use && hooks.use();
      } else if (e.key >= '1' && e.key <= '7') {
        const code = Number(e.key) - 1;
        if ((me.owned || 1) & (1 << code)) {
          hooks.weapon && hooks.weapon(code);
          me.weapon = code;
        }
      } else if ((e.key === 'r' || e.key === 'R') && !e.repeat) {
        hooks.reload && hooks.reload();
      } else if (e.key === 'z' || e.key === 'Z') {
        if (!e.repeat) ads = !ads;
      } else if (e.key === 'Tab' && !e.repeat) {
        cycleWeapon();
        e.preventDefault();
      } else if (e.key === '+' || e.key === '=') cam.distT = clamp(cam.distT - 40, 190, 560);
      else if (e.key === '-' || e.key === '_') cam.distT = clamp(cam.distT + 40, 190, 560);
    });
    window.addEventListener('keyup', (e) => {
      if (KEYMAP[e.key]) keys[KEYMAP[e.key]] = false;
      else if (e.key === 'q' || e.key === 'Q') keys.rotL = false;
      else if (e.key === 'e' || e.key === 'E') keys.rotR = false;
      else if (e.key === ' ' || e.key === 'j' || e.key === 'J') fire.key = false;
    });
    window.addEventListener('blur', () => {
      keys.up = keys.down = keys.left = keys.right = keys.rotL = keys.rotR = false;
      fire.key = fire.btn = false;
      fire.ptr = null;
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

    // drag = orbit the camera, tap = shoot / punch that way, press and hold = keep firing there, wheel / two fingers = zoom
    const pointers = new Map();
    let drag = null;
    let pinch = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (!map || !running) return;
      if (e.button === 2) {
        ads = true;
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (pointers.size === 1) {
        const d0 = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, t: performance.now(), hold: 0 };
        drag = d0;
        // press and hold without moving keeps firing at that spot
        d0.hold = setTimeout(() => {
          if (drag === d0 && !d0.moved) fire.ptr = { x: d0.x, y: d0.y, id: d0.id };
        }, 220);
      } else {
        drag = null;
        fire.ptr = null;
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
        if (pinch) cam.distT = clamp(cam.distT * (pinch / d), 190, 560);
        pinch = d;
        return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      if (fire.ptr && fire.ptr.id === e.pointerId) {
        fire.ptr.x = e.clientX;
        fire.ptr.y = e.clientY;
      }
      if (!drag.moved && !fire.ptr && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 12) drag.moved = true;
      if (drag.moved) {
        cam.yawT -= (e.clientX - drag.x) * 0.006;
        cam.pitchT = clamp(cam.pitchT + (e.clientY - drag.y) * 0.004, 0.55, 1.2);
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const up = (e) => {
      if (e.button === 2) ads = false;
      pointers.delete(e.pointerId);
      if (fire.ptr && fire.ptr.id === e.pointerId) fire.ptr = null;
      if (drag && drag.id === e.pointerId) {
        clearTimeout(drag.hold);
        // a quick tap: one shot / punch toward the tapped spot
        if (!drag.moved && performance.now() - drag.t < 300 && e.type === 'pointerup' && running && !(me.flags & (4 | 2048 | 32))) {
          const g = groundPoint(e.clientX, e.clientY);
          if (g && me.init) {
            me.ang = Math.atan2(g.y - me.y, g.x - me.x);
            fire.last = performance.now();
            hooks.attack && hooks.attack(Math.round(me.ang * 1000) / 1000);
          }
        }
        drag = null;
      }
      if (pointers.size < 2) pinch = 0;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        cam.distT = clamp(cam.distT + e.deltaY * 0.35, 190, 560);
        e.preventDefault();
      },
      { passive: false }
    );
  }

  function mount(canvasEl, miniEl, joyEl, knobEl, h) {
    canvas = canvasEl;
    if (typeof THREE === 'undefined') throw new Error('three.js not loaded');
    renderer = new T.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setClearColor(0x0b1022, 1);
    tuneQuality();
    loadCars();
    if (typeof Post !== 'undefined' && !/[?&]nopost/.test(location.search)) {
      try {
        post = Post.create(renderer, { mobile });
      } catch (err) {
        console.warn('post-processing unavailable', err);
        post = null;
      }
    }
    Soldier.load();
    mini = miniEl;
    mctx = mini.getContext('2d');
    hooks = h || {};
    overlay = document.createElement('canvas');
    overlay.className = 'city-overlay';
    octx = overlay.getContext('2d');
    canvas.parentNode.insertBefore(overlay, canvas.nextSibling);
    const vig = document.createElement('div');
    vig.className = 'city-vignette';
    canvas.parentNode.insertBefore(vig, overlay.nextSibling);
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);
    bindControls(joyEl, knobEl);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) running = false;
      else if (canvas.offsetParent !== null && map) begin();
    });
  }

  return {
    mount,
    start,
    stop,
    applyState,
    fx: fxEvent,
    say,
    floatText,
    resume() { if (map && !running) begin(); },
    setFire(on) { fire.btn = !!on; },
    setAds(on) { ads = !!on; },
    toggleAds() { ads = !ads; return ads; },
    reload() { hooks.reload && hooks.reload(); },
    get mode() { return mode; },
    get weather() { return weather; },
    get zone() { return cur && cur.z; },
    get alive() { return cur && cur.al; },
    cycleWeapon,
    get running() { return running; },
    get view() { return cur; },
    get me() { return me; },
    get cam() { return cam; },
    get missions() { return missions; },
    reduceMotion,
  };
})();
