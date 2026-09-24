/*
 * City3D — the Three.js renderer and controls for City Mission.
 *
 * Same contract as the 2D renderer (city2d.js): the server owns the simulation, this module
 * draws it. Everyone is interpolated between snapshots; your own soldier is predicted locally.
 * The view is a third-person chase camera: drag to orbit, wheel / pinch to zoom, WASD moves
 * relative to the camera, tap the ground to walk there.
 */
const City3D = (function () {
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
  const PLAYER_R = 11;
  const BASE_SPEED = 170;
  const BOOST_MUL = 1.75;
  const DOOR_RADIUS = 46;
  const MATCH_MS = 8 * 60 * 1000;
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const mobile = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || Math.min(screen.width, screen.height) < 700;

  const SKIN = ['#f5d0b0', '#e6b48a', '#c98f62', '#a86b42', '#7c4a2d', '#f9dcc4'];
  const SHIRT = ['#e63946', '#f4a261', '#2a9d8f', '#4361ee', '#9b5de5', '#f15bb5', '#00bbf9', '#8ac926', '#ff7b00', '#7209b7'];
  const HAIR = ['#141013', '#2b1d14', '#4a2f1c', '#7a5230', '#9a9a9a', '#8a3b1c', '#d8b25a'];
  const PANTS = ['#2b3550', '#3a3f4a', '#5b4a36', '#22262e', '#4a5568'];
  const HELMET = ['#4b5a3a', '#2f3640', '#6b5b3a', '#3d4a5c', '#5a3a3a', '#37474f'];
  const VEST = ['#2d3a2a', '#252b33', '#4a4130', '#26303f'];
  const CAR_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#ecf0f1', '#9b59b6'];

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
  let me = { x: 0, y: 0, face: 1, init: false, flags: 0, mission: 0, points: 0, blaster: 0 };
  const keys = { up: false, down: false, left: false, right: false };
  let joy = { x: 0, y: 0 };
  let goTo = null;
  let lastSent = { dx: 0, dy: 0, t: 0 };
  const fx = [];
  const bubbles = new Map();

  // camera rig
  const cam = { yaw: 0, yawT: 0, pitch: 1.04, pitchT: 1.04, dist: 410, distT: 410, x: 0, z: 0, shake: 0 };
  const camPos = new T.Vector3();
  const focus = { x: 0, z: 0 };

  // entities
  let npcObjs = [];
  let carObjs = [];
  let playerObjs = [];
  let marker = null;
  let particles = [];
  const labels = [];
  let entityGroup = null;
  let shadowTex = null;
  let glowTex = null;
  let beamTex = null;
  const paintMats = new Map();

  /* ------------------------------------------------------------- physics */

  function collides(x, y, r) {
    if (x < r || y < r || x > map.w - r || y > map.h - r) return true;
    for (const o of map.obstacles) {
      if (x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r) return true;
    }
    return false;
  }

  function speedOf(flags) {
    if (flags & 1 || flags & 8 || flags & 32) return 0;
    return BASE_SPEED * (flags & 4 ? BOOST_MUL : 1);
  }

  // controls are relative to the camera: "up" walks away from the viewer
  function inputVector() {
    let ix = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let iy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (!ix && !iy && (joy.x || joy.y)) {
      ix = joy.x;
      iy = joy.y;
    }
    let dx;
    let dy;
    if (ix || iy) {
      const c = Math.cos(cam.yaw);
      const s = Math.sin(cam.yaw);
      dx = c * ix - s * iy;
      dy = s * ix + c * iy;
    } else if (goTo) {
      const ex = goTo.x - me.x;
      const ey = goTo.y - me.y;
      const d = Math.hypot(ex, ey);
      if (d < 10) {
        goTo = null;
        dx = dy = 0;
      } else {
        dx = ex / d;
        dy = ey / d;
      }
    } else {
      dx = dy = 0;
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
    const px = me.x;
    const py = me.y;
    if (!collides(me.x + vx, me.y, PLAYER_R)) me.x += vx;
    if (!collides(me.x, me.y + vy, PLAYER_R)) me.y += vy;
    if (Math.abs(v.dx) > 0.15) me.face = v.dx > 0 ? 1 : -1;
    if (goTo && Math.abs(me.x - px) + Math.abs(me.y - py) < 0.01) goTo = null;
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

  /* ---------------------------------------------------- 3D characters */

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
    if (G.torso) return;
    G.torso = new T.BoxGeometry(14.5, 15, 8.6);
    G.vest = new T.BoxGeometry(15.6, 11, 9.6);
    G.pouch = new T.BoxGeometry(3.6, 3.4, 1.8);
    G.pelvis = new T.BoxGeometry(13.6, 5, 8.2);
    G.thigh = new T.BoxGeometry(5.6, 10.4, 5.8);
    G.shin = new T.BoxGeometry(5, 10.2, 5.2);
    G.boot = new T.BoxGeometry(8.8, 3.8, 5.8);
    G.uarm = new T.BoxGeometry(4.6, 8.6, 4.6);
    G.farm = new T.BoxGeometry(4.2, 8.2, 4.2);
    G.hand = new T.SphereGeometry(2.2, 8, 6);
    G.head = new T.SphereGeometry(4.7, 14, 12);
    G.neck = new T.CylinderGeometry(1.9, 2.1, 2.6, 8);
    G.helmet = new T.SphereGeometry(5.5, 14, 8, 0, TAU, 0, Math.PI * 0.56);
    G.hair = new T.SphereGeometry(5, 12, 8, 0, TAU, 0, Math.PI * 0.62);
    G.pack = new T.BoxGeometry(4.6, 11.5, 9.6);
    G.eye = new T.BoxGeometry(0.9, 1.1, 1);
    G.shades = new T.BoxGeometry(1.4, 1.7, 8.2);
    G.gunBody = new T.BoxGeometry(2.6, 15, 3);
    G.gunBarrel = new T.CylinderGeometry(0.7, 0.7, 8, 6);
    G.gunMag = new T.BoxGeometry(2, 4.6, 2.4);
    G.gunScope = new T.BoxGeometry(2, 5, 2);
    G.shadow = new T.PlaneGeometry(1, 1);
  }

  function part(geo, mat, parent, x, y, z, shadow) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = shadow !== false;
    parent.add(m);
    return m;
  }

  /* ------------------------------------------- skinned soldier model */

  // A real rigged, textured character (Mixamo "Vanguard", MIT-hosted in three.js examples)
  // with Idle / Walk / Run clips. Everyone in the city is this model, tinted per person.
  let soldierGLTF = null;
  let modelWait = Promise.resolve();
  const SOLDIER_SCALE = 27; // 1.83 m model -> ~49 world units

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
        (err) => {
          console.warn('soldier model failed to load, using the built-in figures', err);
          resolve();
        }
      );
    });
  }

  function buildSoldier(look, o) {
    geos();
    const npc = !!o.npc;
    const root = new T.Group();
    const inner = T.SkeletonUtils.clone(soldierGLTF.scene);
    inner.scale.setScalar(SOLDIER_SCALE * (npc ? look.sv : 1));
    inner.rotation.y = Math.PI / 2; // the model faces +Z, our heading faces +X
    root.add(inner);
    const tint = new T.Color(look.shirt).lerp(new T.Color('#ffffff'), npc ? 0.4 : 0.55);
    inner.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = npc ? q.npcShadows : true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.material = m.material.clone();
      if (/body/i.test(m.material.name)) m.material.color.copy(tint);
      m.material.roughness = 0.62;
      world && world.envMats.push(m.material);
    });
    const mixer = new T.AnimationMixer(inner);
    const acts = {};
    for (const name of ['Idle', 'Walk', 'Run']) {
      const a = mixer.clipAction(T.AnimationClip.findByName(soldierGLTF.animations, name));
      a.play();
      a.setEffectiveWeight(name === 'Idle' ? 1 : 0);
      acts[name] = a;
    }
    mixer.update(Math.random() * 2);

    // rifle in the right hand
    const gun = new T.Group();
    gun.visible = false;
    const hand = inner.getObjectByName('mixamorigRightHand');
    if (hand) {
      const ws = new T.Vector3();
      hand.getWorldScale(ws);
      gun.scale.setScalar(1 / (ws.x || 0.27));
      gun.position.set(0, 6, 3);
      gun.rotation.set(0, 0, Math.PI / 2);
      hand.add(gun);
    } else root.add(gun);
    const metal = pm('#23262c', 0.45, 0.7);
    part(G.gunBody, metal, gun, 0, -3, 0);
    part(G.gunBarrel, pm('#111', 0.4, 0.8), gun, 0, -14, 0);
    part(G.gunMag, pm('#1a1c20', 0.6, 0.4), gun, 0, -3.5, 0).position.x = 2.4;
    part(G.gunScope, pm('#2c313a', 0.4, 0.6), gun, 0, -1, 0).position.x = -1.9;
    const tip = part(new T.SphereGeometry(1.6, 6, 6), new T.MeshBasicMaterial({ color: 0xffa040, toneMapped: false }), gun, 0, -19, 0, false);
    tip.visible = false;

    const blob = new T.Mesh(G.shadow, new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.scale.set(32, 32, 1);
    blob.position.y = 0.9;
    root.add(blob);
    const shield = new T.Mesh(new T.SphereGeometry(23, 20, 14), new T.MeshBasicMaterial({ color: 0x5adcff, transparent: true, opacity: 0.2, depthWrite: false, blending: T.AdditiveBlending }));
    shield.position.y = 25;
    shield.visible = false;
    root.add(shield);

    return { root, inner, mixer, acts, w: { Idle: 1, Walk: 0, Run: 0 }, gun, tip, shield, blob, phase: Math.random() * TAU, h: 0, px: 0, py: 0, seen: false, soldier: !npc, baseScale: inner.scale.x };
  }

  function animateSoldier(p, dt, moving, speed, st) {
    const dazed = !!(st && st.stunned);
    const won = !!(st && st.finished);
    const go = moving && !dazed && !(st && st.thinking);
    const target = { Idle: go ? 0 : 1, Walk: go && speed < 105 ? 1 : 0, Run: go && speed >= 105 ? 1 : 0 };
    const k = Math.min(1, dt * 9);
    for (const n of ['Idle', 'Walk', 'Run']) {
      p.w[n] += (target[n] - p.w[n]) * k;
      p.acts[n].setEffectiveWeight(Math.max(0.0001, p.w[n]));
    }
    p.acts.Walk.setEffectiveTimeScale(clamp(speed / 38, 0.6, 2.2));
    p.acts.Run.setEffectiveTimeScale(clamp(speed / 125, 0.7, 1.9));
    p.acts.Idle.setEffectiveTimeScale(dazed ? 0.4 : 1);
    p.mixer.update(dt);
    p.inner.position.y = won ? Math.abs(Math.sin(nowT * 7)) * 6 : 0;
    p.inner.rotation.z = dazed ? Math.sin(nowT * 5) * 0.28 : 0;
    p.inner.rotation.x = dazed ? 0.22 : 0;
    p.gun.visible = !!(st && st.armed);
    p.tip.visible = false;
  }

  // a person, 49 units tall, facing +X (his right hand is +Z)
  function buildPerson(look, o) {
    geos();
    if (soldierGLTF) return buildSoldier(look, o || {});
    o = o || {};
    const soldier = !!o.soldier;
    const skin = pm(look.skin, 0.65);
    const shirt = pm(look.shirt, 0.8);
    const pants = pm(soldier ? look.cargo : look.pants, 0.85);
    const bootM = pm('#1b1b1f', 0.6);
    const root = new T.Group();
    const body = new T.Group();
    root.add(body);

    const blob = new T.Mesh(G.shadow, new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.scale.set(30, 30, 1);
    blob.position.y = 0.9;
    root.add(blob);

    part(G.pelvis, pants, body, 0, 23, 0);
    const legs = [];
    for (const side of [-1, 1]) {
      const hip = new T.Group();
      hip.position.set(0, 23, side * 3.7);
      body.add(hip);
      part(G.thigh, pants, hip, 0, -5.2, 0);
      const knee = new T.Group();
      knee.position.y = -10.4;
      hip.add(knee);
      part(G.shin, pants, knee, 0, -5.1, 0);
      part(G.boot, bootM, knee, 1.4, -10.4, 0);
      legs.push({ hip, knee });
    }
    const torso = new T.Group();
    body.add(torso);
    part(G.torso, shirt, torso, 0, 31.5, 0);
    if (soldier) {
      const vest = pm(look.vest, 0.7);
      part(G.vest, vest, torso, 0.2, 32.6, 0);
      for (const z of [-2.6, 0, 2.6]) part(G.pouch, pm('#1d2321', 0.8), torso, 5.3, 29.2, z, false);
      part(G.pack, pm(look.vest, 0.9), torso, -7.4, 31.5, 0);
    }
    part(G.neck, skin, torso, 0, 39.7, 0, false);
    const head = new T.Group();
    head.position.set(0, 44.4, 0);
    torso.add(head);
    const headM = part(G.head, skin, head, 0, 0, 0);
    headM.scale.set(0.95, 1.05, 0.92);
    for (const z of [-1.8, 1.8]) part(G.eye, pm('#15151a', 0.4), head, 4.2, 0.4, z, false);
    if (soldier) {
      part(G.helmet, pm(look.helmet, 0.55, 0.15), head, 0, 0.6, 0);
      part(G.shades, pm('#0b0b0f', 0.15, 0.6), head, 4.1, 0.5, 0, false);
      const strap = part(new T.BoxGeometry(5.4, 0.8, 9.4), pm('#141414', 0.9), head, 0, -1.5, 0, false);
      strap.scale.set(0.6, 1, 1);
    } else {
      const hair = part(G.hair, pm(look.hair, 0.85), head, -0.5, 0.9, 0);
      hair.rotation.z = 0.12;
      if (look.cap) part(new T.CylinderGeometry(5.3, 5.5, 2.4, 12), pm(look.shirt, 0.8), head, 0, 3.2, 0);
    }
    const arms = [];
    for (const side of [-1, 1]) {
      const sh = new T.Group();
      sh.position.set(0, 38, side * 8.9);
      torso.add(sh);
      part(G.uarm, shirt, sh, 0, -4.3, 0);
      const el = new T.Group();
      el.position.y = -8.6;
      sh.add(el);
      part(G.farm, soldier ? shirt : skin, el, 0, -4.1, 0);
      part(G.hand, skin, el, 0, -8.4, 0, false);
      arms.push({ sh, el });
    }
    // rifle, held in the right hand and pointing along the forearm
    const gun = new T.Group();
    gun.visible = false;
    arms[1].el.add(gun);
    const metal = pm('#23262c', 0.45, 0.7);
    part(G.gunBody, metal, gun, 0, -12, 0);
    part(G.gunBarrel, pm('#111', 0.4, 0.8), gun, 0, -23, 0);
    part(G.gunMag, pm('#1a1c20', 0.6, 0.4), gun, 0, -12.5, 0).position.x = 2.4;
    part(G.gunScope, pm('#2c313a', 0.4, 0.6), gun, 0, -10, 0).position.x = -1.9;
    const tipM = new T.MeshBasicMaterial({ color: 0xff6a3a, toneMapped: false });
    const tip = part(new T.SphereGeometry(1.1, 6, 6), tipM, gun, 0, -27.4, 0, false);
    tip.visible = false;

    const shield = new T.Mesh(new T.SphereGeometry(21, 20, 14), new T.MeshBasicMaterial({ color: 0x5adcff, transparent: true, opacity: 0.2, depthWrite: false, blending: T.AdditiveBlending }));
    shield.position.y = 24;
    shield.visible = false;
    root.add(shield);

    return { root, body, torso, head, legs, arms, gun, tip, shield, blob, phase: Math.random() * TAU, h: 0, hInit: false, px: 0, py: 0, seen: false, soldier };
  }

  const _tmp = new T.Vector3();
  function animatePerson(p, dt, moving, speed, st) {
    if (p.mixer) return animateSoldier(p, dt, moving, speed, st);
    const speedK = Math.min(1.4, speed / 60);
    const aim = !!(st && st.aim);
    const dazed = !!(st && st.stunned);
    const won = !!(st && st.finished);
    const thinking = !!(st && st.thinking);
    if (moving) p.phase += dt * (8.5 + speedK * 4);
    const ph = p.phase;
    const amp = moving ? 0.78 : 0;
    const bob = moving ? Math.abs(Math.cos(ph)) * 1.6 : Math.sin(nowT * 2 + p.phase) * 0.25;
    p.body.position.y = dazed ? -1 : won ? Math.abs(Math.sin(nowT * 7)) * 5 : bob;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const a = Math.sin(ph) * amp * s;
      p.legs[i].hip.rotation.z = a;
      p.legs[i].knee.rotation.z = -Math.max(0, Math.cos(ph) * s) * amp * 1.15 - (moving ? 0.06 : 0);
    }
    const [lA, rA] = p.arms;
    const sw = moving ? Math.sin(ph) * 0.7 : Math.sin(nowT * 1.8 + p.phase) * 0.05;
    lA.sh.rotation.set(0, 0, -sw);
    rA.sh.rotation.set(0, 0, sw);
    lA.el.rotation.z = moving ? -0.55 : -0.15;
    rA.el.rotation.z = moving ? -0.55 : -0.15;
    p.torso.rotation.z = moving ? 0.1 : 0;
    p.torso.rotation.y = moving ? Math.sin(ph) * 0.12 : 0;
    p.head.rotation.set(0, 0, 0);
    if (aim) {
      rA.sh.rotation.set(0, 0.05, 1.42 + (moving ? Math.sin(ph * 2) * 0.03 : 0));
      rA.el.rotation.z = 0.12;
      lA.sh.rotation.set(0.5, -0.5, 1.2);
      lA.el.rotation.z = 0.35;
      p.torso.rotation.y = -0.15;
    }
    if (won) {
      lA.sh.rotation.set(0, 0, 2.9 + Math.sin(nowT * 9) * 0.25);
      rA.sh.rotation.set(0, 0, -2.9 + Math.sin(nowT * 9 + 1) * 0.25);
      lA.sh.rotation.z = -lA.sh.rotation.z;
    }
    if (thinking) {
      rA.sh.rotation.set(0, 0, 2.35);
      rA.el.rotation.z = 1.1;
      p.head.rotation.z = 0.12;
    }
    if (dazed) {
      p.torso.rotation.z = Math.sin(nowT * 6) * 0.35 - 0.25;
      p.body.rotation.z = Math.sin(nowT * 5) * 0.06;
      lA.sh.rotation.z = -0.5;
      rA.sh.rotation.z = -0.5;
      p.head.rotation.z = Math.sin(nowT * 7) * 0.3;
    } else p.body.rotation.z = 0;
    p.gun.visible = !!(st && st.armed);
    p.tip.visible = false;
  }

  function buildCar(hex) {
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
    return { root: g, wheels, lamps, head, h: 0, spin: 0, px: 0, py: 0, seen: false, driver: null };
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
    world = CityWorld.build(scene, renderer, map, missions, q);
    world.mapW = map.w;
    entityGroup = new T.Group();
    scene.add(entityGroup);
    marker = buildMarker();
    scene.add(marker.group);
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
      if (p.sp.position.y < 1) {
        p.sp.position.y = 1;
        p.v.y *= -0.3;
      }
      const k = p.life / p.max;
      p.sp.material.opacity = Math.min(1, k * 1.6);
      p.sp.scale.setScalar(p.size * (0.6 + 0.6 * k));
    }
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
    snaps = [];
    if (scene) fx.forEach((f) => f.bolt && scene.remove(f.bolt.g));
    fx.length = 0;
    bubbles.clear();
    goTo = null;
    me = { x: 0, y: 0, face: 1, init: false, flags: 0, mission: 0, points: 0, blaster: 0 };
    ensureWorld();
    missionBuilding = missions.map((m) => map.buildings.findIndex((b) => b.door.x === m.door.x && b.door.y === m.door.y));
    buildEntities();
    if (payload.snapshot) applyState(payload.snapshot);
    running = false;
    resize();
    Promise.race([modelWait, new Promise((r) => setTimeout(r, 7000))]).then(begin);
  }

  function buildEntities() {
    while (entityGroup.children.length) entityGroup.remove(entityGroup.children[0]);
    if (!particles.length) makeParticles();
    npcObjs = [];
    for (let i = 0; i < 40; i++) npcObjs.push(null);
    carObjs = [];
    playerObjs = players.map(() => null);
    cam.yaw = cam.yawT = 0;
    cam.pitch = cam.pitchT = 1.04;
    cam.dist = cam.distT = 410;
  }

  function personLook(idx, soldier) {
    const h = (idx + 1) * 2654435761;
    return {
      skin: SKIN[(h >>> 3) % SKIN.length],
      shirt: SHIRT[(h >>> 7) % SHIRT.length],
      hair: HAIR[(h >>> 11) % HAIR.length],
      pants: PANTS[(h >>> 13) % PANTS.length],
      cargo: PANTS[(h >>> 15) % PANTS.length],
      helmet: HELMET[(h >>> 5) % HELMET.length],
      vest: VEST[(h >>> 9) % VEST.length],
      cap: ((h >>> 17) & 3) === 0,
      sv: 0.93 + ((h >>> 19) & 7) * 0.013,
      soldier,
    };
  }

  function begin() {
    if (!canvas || running) return;
    running = true;
    last = performance.now() / 1000;
    requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    keys.up = keys.down = keys.left = keys.right = false;
    joy = { x: 0, y: 0 };
  }

  function applyState(s) {
    snaps.push(s);
    if (snaps.length > 12) snaps.shift();
    const mine = s.p.find((e) => e[0] === meIdx);
    if (!mine) return;
    const [, sx, sy, face, flags, mission, points, blaster] = mine;
    me.flags = flags;
    me.mission = mission;
    me.points = points;
    me.blaster = blaster;
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
    if (err > 90 || flags & 8 || flags & 1) {
      me.x = sx;
      me.y = sy;
    } else if (err > 3) {
      me.x += (sx - me.x) * 0.25;
      me.y += (sy - me.y) * 0.25;
    }
  }

  /* -------------------------------------------------------- effects */

  function makeBolt(color) {
    const g = new T.Group();
    const segs = [];
    const geo = new T.CylinderGeometry(0.9, 0.9, 1, 5);
    for (let i = 0; i < 9; i++) {
      const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color, transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
      g.add(m);
      segs.push(m);
    }
    const flashA = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    const flashB = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    g.add(flashA, flashB);
    scene.add(g);
    return { g, segs, flashA, flashB };
  }

  function zapFx(fromId, toId, blockedByShield) {
    if (!scene) return;
    const from = indexById.get(fromId);
    const to = indexById.get(toId);
    const color = blockedByShield ? 0x5adcff : 0xffe14d;
    fx.push({ kind: 'zap', from, to, born: nowT, life: 0.5, blocked: !!blockedByShield, bolt: makeBolt(color), color, jit: 0 });
    if (to === meIdx && !reduceMotion) cam.shake = Math.max(cam.shake, blockedByShield ? 4 : 11);
  }

  function say(playerId, text) {
    const idx = indexById.get(playerId);
    if (idx === undefined) return;
    bubbles.set(idx, { text: String(text).slice(0, 34), until: nowT + 3.2 });
  }

  function floatText(text, color) {
    fx.push({ kind: 'text', text, color: color || '#ffe08a', x: me.x, y: me.y, born: nowT, life: 1.6 });
    if (scene && me.init) burst(me.x, 40, me.y, color || '#ffe08a', 26, 90, 9, 0.9, 80);
  }

  /* -------------------------------------------------- snapshot lookup */

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
        return { idx: e[0], x: l(o[1], e[1]), y: l(o[2], e[2]), face: e[3], flags: e[4], mission: e[5], points: e[6], blaster: e[7] };
      }),
      n: b.n.map((e, i) => {
        const o = a.n[i] || e;
        return { x: l(o[0], e[0]), y: l(o[1], e[1]), d: e[2], walk: e[3], look: npcLooks[i] || [0, 0] };
      }),
      c: b.c.map((e, i) => {
        const o = a.c[i] || e;
        return { x: l(o[0], e[0]), y: l(o[1], e[1]), vertical: e[2] === 1, dir: e[3], color: e[4] };
      }),
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
    if (d > 0.08) {
      const target = Math.atan2(-dy, dx);
      obj.h += angDiff(obj.h, target) * Math.min(1, dt * 12);
    }
    return { moved: d, speed: dt > 0 ? d / dt : 0 };
  }

  function syncEntities(s, dt) {
    labels.length = 0;
    const withShadow = q.npcShadows;

    // pedestrians
    for (let i = 0; i < s.n.length; i++) {
      const n = s.n[i];
      let o = npcObjs[i];
      if (!o) {
        const look = personLook(n.look[0] * 7 + n.look[1] + 100 + i, false);
        look.skin = SKIN[n.look[0] % SKIN.length];
        look.shirt = SHIRT[n.look[1] % SHIRT.length];
        look.hair = HAIR[(n.look[0] + n.look[1]) % HAIR.length];
        o = npcObjs[i] = buildPerson(look, { soldier: false, npc: true });
        if (!withShadow) o.root.traverse((m) => (m.castShadow = false));
        entityGroup.add(o.root);
      }
      const f = facing(o, n.x, n.y, dt, n.d > 0 ? 0 : Math.PI);
      const moving = !!n.walk && f.moved > 0.02;
      o.root.position.set(n.x, 4.4 * 0, n.y);
      o.root.rotation.y = o.h;
      animatePerson(o, dt, moving, f.speed, null);
    }

    // traffic
    for (let i = 0; i < s.c.length; i++) {
      const c = s.c[i];
      let o = carObjs[i];
      if (!o) {
        o = carObjs[i] = buildCar(CAR_COLORS[c.color % CAR_COLORS.length]);
        entityGroup.add(o.root);
      }
      const heading = c.vertical ? (c.dir > 0 ? -Math.PI / 2 : Math.PI / 2) : c.dir > 0 ? 0 : Math.PI;
      const f = facing(o, c.x, c.y, dt, heading);
      o.h = heading;
      o.root.position.set(c.x, 0, c.y);
      o.root.rotation.y = o.h;
      o.spin += f.moved / 6.4;
      for (const w of o.wheels) w.rotation.z = -o.spin;
      const op = world.night * 0.9;
      for (const l of o.lamps) l.material.opacity = op;
      o.head.emissiveIntensity = 0.4 + world.night * 3;
    }

    // players
    for (const e of s.p) {
      if (e.flags & 64) {
        const o = playerObjs[e.idx];
        if (o) o.root.visible = false;
        continue;
      }
      const info = players[e.idx];
      if (!info) continue;
      const isMe = e.idx === meIdx;
      const x = isMe ? me.x : e.x;
      const y = isMe ? me.y : e.y;
      const flags = isMe ? me.flags : e.flags;
      const blaster = isMe ? me.blaster : e.blaster;
      let o = playerObjs[e.idx];
      if (!o) {
        const look = personLook(e.idx, true);
        const person = buildPerson(look, { soldier: true });
        const car = buildCar(isMe ? '#ffd23f' : CAR_COLORS[e.idx % CAR_COLORS.length]);
        car.root.visible = false;
        const root = new T.Group();
        root.add(person.root, car.root);
        entityGroup.add(root);
        o = playerObjs[e.idx] = { root, person, car, look, h: 0, seen: false, px: 0, py: 0, iX: 0, iY: 0, spin: 0 };
      }
      o.root.visible = true;
      const f = facing(o, x, y, dt, isMe && me.face < 0 ? Math.PI : 0);
      let moving = f.moved > 0.03;
      if (isMe) {
        const v = inputVector();
        moving = (!!(v.dx || v.dy) && !(flags & 9)) || f.moved > 0.2;
      }
      const inCar = !!(flags & 4);
      o.root.position.set(x, 0, y);
      o.root.rotation.y = o.h;
      o.person.root.visible = !inCar;
      o.car.root.visible = inCar;
      if (inCar) {
        o.spin += f.moved / 6.4;
        for (const w of o.car.wheels) w.rotation.z = -o.spin;
        const op = world.night * 0.9;
        for (const l of o.car.lamps) l.material.opacity = op;
        o.car.head.emissiveIntensity = 0.4 + world.night * 3;
        if (moving && Math.random() < dt * 22) burst(x - Math.cos(-o.h) * 30, 4, y + Math.sin(-o.h) * 30, '#cfc9bd', 1, 28, 14, 0.6, -10);
      } else {
        animatePerson(o.person, dt, moving, f.speed, { armed: blaster > 0, aim: blaster > 0 && !moving, stunned: !!(flags & 1), finished: !!(flags & 32), thinking: !!(flags & 8) });
        if (isMe && moving && Math.random() < dt * 9) burst(x, 2, y, '#d9d2c2', 1, 18, 9, 0.5, -10);
      }
      o.person.shield.visible = !!(flags & 2);
      if (flags & 2) {
        o.person.shield.material.opacity = 0.16 + 0.07 * Math.sin(nowT * 5);
        o.person.shield.scale.setScalar(1 + 0.03 * Math.sin(nowT * 6));
      }
      labels.push({ x, z: y, h: inCar ? 46 : 58, info, isMe, idx: e.idx, flags });
      o.pos = { x, y };
    }
  }

  function drawZaps(s) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      const k = (nowT - f.born) / f.life;
      if (k >= 1) {
        if (f.bolt) {
          scene.remove(f.bolt.g);
          f.bolt.segs.forEach((m) => m.material.dispose());
        }
        fx.splice(i, 1);
        continue;
      }
      if (f.kind !== 'zap') continue;
      const A = playerObjs[f.from];
      const B = playerObjs[f.to];
      if (!A || !B || !A.pos || !B.pos) continue;
      const a = new T.Vector3(A.pos.x, 32, A.pos.y);
      const b = new T.Vector3(B.pos.x, 30, B.pos.y);
      // the muzzle: a little ahead of the shooter
      const dir = b.clone().sub(a).setY(0).normalize();
      a.addScaledVector(dir, 16);
      const pts = [a.clone()];
      const N = f.bolt.segs.length;
      const jit = 5 + (1 - k) * 4;
      for (let n = 1; n < N; n++) {
        const u = n / N;
        const p = a.clone().lerp(b, u);
        p.x += (Math.random() - 0.5) * jit * 2;
        p.y += (Math.random() - 0.5) * jit * 1.2;
        p.z += (Math.random() - 0.5) * jit * 2;
        pts.push(p);
      }
      pts.push(b.clone());
      const up = new T.Vector3(0, 1, 0);
      for (let n = 0; n < N; n++) {
        const p0 = pts[n];
        const p1 = pts[n + 1];
        const seg = f.bolt.segs[n];
        const d = p1.clone().sub(p0);
        const len = d.length();
        seg.position.copy(p0).lerp(p1, 0.5);
        seg.scale.set(1 + (1 - k) * 1.2, len, 1 + (1 - k) * 1.2);
        seg.quaternion.setFromUnitVectors(up, d.normalize());
        seg.material.opacity = 1 - k;
      }
      f.bolt.flashA.position.copy(a);
      f.bolt.flashB.position.copy(b);
      f.bolt.flashA.scale.setScalar(26 * (1 - k) + 6);
      f.bolt.flashB.scale.setScalar(38 * (1 - k) + 8);
      f.bolt.flashA.material.opacity = f.bolt.flashB.material.opacity = 1 - k;
      if (!f.hit) {
        f.hit = true;
        burst(b.x, 28, b.z, f.blocked ? '#7fe6ff' : '#ffe14d', 22, 110, 10, 0.6, 140);
      }
      // the shooter raises the rifle briefly
      if (A.person) A.person.tip.visible = k < 0.4;
    }
    void s;
  }

  /* --------------------------------------------------------- camera */

  function updateCamera(dt) {
    const aspect = W / Math.max(1, H);
    camera.aspect = aspect;
    camera.fov = aspect < 0.9 ? 60 : 46;
    camera.updateProjectionMatrix();
    const tx = me.init ? me.x : map.w / 2;
    const tz = me.init ? me.y : map.h / 2;
    cam.x += (tx - cam.x) * Math.min(1, dt * 9);
    cam.z += (tz - cam.z) * Math.min(1, dt * 9);
    cam.yaw += angDiff(cam.yaw, cam.yawT) * Math.min(1, dt * 10);
    cam.pitch += (cam.pitchT - cam.pitch) * Math.min(1, dt * 8);
    cam.dist += (cam.distT - cam.dist) * Math.min(1, dt * 8);
    const portraitBoost = aspect < 0.9 ? 1 + (0.9 - aspect) * 0.9 : 1;
    const d = cam.dist * portraitBoost;
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
      octx.fillStyle = L.isMe ? 'rgba(255,210,63,0.94)' : 'rgba(10,14,36,0.78)';
      rr(octx, p.x - w / 2, p.y - fs - 6, w, fs + 10, 9);
      octx.fill();
      octx.fillStyle = L.isMe ? '#2a1b00' : '#fff';
      octx.fillText(label, p.x, p.y - 3);
      if (L.flags & 1) {
        octx.font = `${16 * sc}px system-ui, "Apple Color Emoji", sans-serif`;
        for (let k = 0; k < 3; k++) {
          const a = nowT * 5 + k * 2.1;
          octx.fillText('⭐', p.x + Math.cos(a) * 18, p.y - fs - 14 + Math.sin(a) * 5);
        }
      }
      if (L.flags & 8) {
        octx.font = `${20 * sc}px system-ui, "Apple Color Emoji", sans-serif`;
        octx.fillText('💭', p.x + 26, p.y - fs - 10);
      }
      if (L.flags & 32) {
        octx.font = `${24 * sc}px system-ui, "Apple Color Emoji", sans-serif`;
        octx.fillText('🏁', p.x, p.y - fs - 16);
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
    // mission icon floating over the target
    const target = missions[me.mission];
    if (target) {
      const p = project(target.door.x, 120, target.door.y);
      if (!p.behind && p.x > 0 && p.x < W && p.y > 0 && p.y < H) {
        const bob = Math.sin(nowT * 3) * 4;
        octx.font = '30px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        octx.fillStyle = '#fff';
        octx.fillText(target.icon, p.x, p.y + bob);
        const dist = Math.round(Math.hypot(target.door.x - me.x, target.door.y - me.y) / 10);
        octx.font = '800 12px system-ui, sans-serif';
        octx.fillStyle = 'rgba(0,0,0,0.6)';
        octx.strokeStyle = 'rgba(0,0,0,0.7)';
        octx.lineWidth = 3;
        octx.strokeText(`${dist} m`, p.x, p.y + 18 + bob);
        octx.fillStyle = '#ffd23f';
        octx.fillText(`${dist} m`, p.x, p.y + 18 + bob);
      }
    }
    for (const f of fx) {
      if (f.kind !== 'text') continue;
      const k = (nowT - f.born) / f.life;
      const p = project(f.x, 70 + k * 40, f.y);
      if (p.behind) continue;
      octx.globalAlpha = 1 - k;
      octx.font = '800 21px system-ui, sans-serif';
      octx.strokeStyle = 'rgba(0,0,0,0.65)';
      octx.lineWidth = 4;
      octx.strokeText(f.text, p.x, p.y);
      octx.fillStyle = f.color;
      octx.fillText(f.text, p.x, p.y);
      octx.globalAlpha = 1;
    }
  }

  function drawMinimap(s, target) {
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
    for (const e of s.p) {
      if (e.flags & 64) continue;
      const isMe = e.idx === meIdx;
      mctx.fillStyle = isMe ? '#ffffff' : players[e.idx] && players[e.idx].isBot ? '#ff8a8a' : '#7fd4ff';
      mctx.beginPath();
      mctx.arc((isMe ? me.x : e.x) * k, (isMe ? me.y : e.y) * k, isMe ? 4 : 3, 0, TAU);
      mctx.fill();
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

  /* ------------------------------------------------------------- loop */

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
        resize();
      } else if (qualityStep === 2) {
        world.sun.castShadow = false;
      } else {
        renderer.setPixelRatio(0.75);
        dprMax = 0.75;
        resize();
      }
    }
  }

  function frame(dt) {
    const s = sample(nowServer() - 110);
    if (!s || !world) return;
    const p = s.endsAt ? clamp(1 - (s.endsAt - nowServer()) / MATCH_MS, 0, 1) : 0;
    world.setTime(p);
    syncEntities(s, dt);
    updateCamera(dt);
    const target = missions[me.mission] || null;
    updateMarker(nowT);
    world.update(nowT, dt, focus, camPos, target ? missionBuilding[me.mission] : -1);
    stepParticles(dt);
    drawZaps(s);
    renderer.render(scene, camera);
    drawOverlay();
    drawMinimap(s, target);
    if (hooks.gps) {
      const sp = target ? project(target.door.x, 20, target.door.y) : { x: 0, y: 0 };
      hooks.gps(target, sp, { x: me.x, y: me.y });
    }
    adaptQuality(dt);
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
        goTo = null;
        e.preventDefault();
      } else if (e.key === 'q' || e.key === 'Q') keys.rotL = true;
      else if (e.key === 'e' || e.key === 'E') keys.rotR = true;
      else if (e.key === ' ' || e.key === 'Enter') {
        hooks.zap && hooks.zap();
        e.preventDefault();
      } else if (e.key === '+' || e.key === '=') cam.distT = clamp(cam.distT - 40, 190, 560);
      else if (e.key === '-' || e.key === '_') cam.distT = clamp(cam.distT + 40, 190, 560);
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
      goTo = null;
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

    // drag = orbit the camera, tap = walk there, wheel / two fingers = zoom
    const pointers = new Map();
    let drag = null;
    let pinch = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (!map || !running) return;
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
        if (pinch) cam.distT = clamp(cam.distT * (pinch / d), 190, 560);
        pinch = d;
        return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8) drag.moved = true;
      if (drag.moved) {
        cam.yawT -= (e.clientX - drag.x) * 0.006;
        cam.pitchT = clamp(cam.pitchT + (e.clientY - drag.y) * 0.004, 0.55, 1.2);
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (drag && drag.id === e.pointerId) {
        if (!drag.moved && performance.now() - drag.t < 450) {
          const pt = groundPoint(e.clientX, e.clientY);
          if (pt) goTo = pt;
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
    loadModels();
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

  return { mount, start, stop, applyState, zapFx, say, floatText, get running() { return running; }, get me() { return me; }, get camYaw() { return cam.yaw; }, get cam() { return cam; }, get missions() { return missions; }, walkTo(x, y) { goTo = { x, y }; }, reduceMotion };
})();
