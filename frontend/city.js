/*
 * City — the open-world renderer and controls for City Mission mode.
 *
 * The server owns the simulation. This module draws it: streets, buildings, parks,
 * wandering pedestrians, traffic and every player, interpolated between server
 * snapshots. Your own character is predicted locally (same speed and collision
 * rules) so it responds instantly, then gently corrected toward the server.
 * Controls: WASD / arrow keys, an on-screen joystick, or tap the map to walk there.
 */
const City = (function () {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const PLAYER_R = 11;
  const BASE_SPEED = 170;
  const BOOST_MUL = 1.75;
  const DOOR_RADIUS = 46;
  const LIFT = 46; // how tall buildings look
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const SKIN = ['#f5d0b0', '#e6b48a', '#c98f62', '#a86b42', '#7c4a2d', '#f9dcc4'];
  const SHIRT = ['#e63946', '#f4a261', '#2a9d8f', '#4361ee', '#9b5de5', '#f15bb5', '#00bbf9', '#8ac926', '#ff7b00', '#7209b7'];
  const HAIR = ['#141013', '#2b1d14', '#4a2f1c', '#7a5230', '#9a9a9a', '#8a3b1c', '#d8b25a'];
  const CAR_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#ecf0f1', '#9b59b6'];

  let canvas = null;
  let ctx = null;
  let mini = null;
  let mctx = null;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let hooks = {};
  let running = false;
  let last = 0;

  let map = null;
  let missions = [];
  let players = []; // [{playerId,name,avatar,isBot}]
  let indexById = new Map();
  let meIdx = -1;
  let npcLooks = [];
  let snaps = [];
  let offset = 0; // server clock - local clock
  let startsAt = 0;
  let me = { x: 0, y: 0, face: 1, init: false, flags: 0, mission: 0, points: 0, blaster: 0 };
  const cam = { x: 0, y: 0, s: 0.7 };
  const keys = { up: false, down: false, left: false, right: false };
  let joy = { x: 0, y: 0 };
  let goTo = null;
  let lastSent = { dx: 0, dy: 0, t: 0 };
  const fx = []; // {kind, ...}
  const bubbles = new Map(); // idx -> {text, until}
  let nowT = 0;

  /* ------------------------------------------------------------- physics */

  function collides(x, y, r) {
    if (x < r || y < r || x > map.w - r || y > map.h - r) return true;
    for (const o of map.obstacles) {
      if (x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r) return true;
    }
    return false;
  }

  function speedOf(flags) {
    if (flags & 1 || flags & 8 || flags & 32) return 0; // stunned, in a quiz, or finished
    return BASE_SPEED * (flags & 4 ? BOOST_MUL : 1);
  }

  function inputVector() {
    let dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (!dx && !dy && (joy.x || joy.y)) {
      dx = joy.x;
      dy = joy.y;
    }
    if (!dx && !dy && goTo) {
      const ex = goTo.x - me.x;
      const ey = goTo.y - me.y;
      const d = Math.hypot(ex, ey);
      if (d < 10) goTo = null;
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
    if (goTo && Math.abs(me.x - px) + Math.abs(me.y - py) < 0.01) goTo = null; // walked into a wall
  }

  const nowServer = () => Date.now() + offset;

  /* ---------------------------------------------------------------- setup */

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
    fx.length = 0;
    bubbles.clear();
    goTo = null;
    me = { x: 0, y: 0, face: 1, init: false, flags: 0, mission: 0, points: 0, blaster: 0 };
    if (payload.snapshot) applyState(payload.snapshot);
    running = false;
    resize();
    begin();
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
      cam.y = sy;
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

  /* --------------------------------------------------------------- effects */

  function zapFx(fromId, toId, blockedByShield) {
    fx.push({ kind: 'zap', from: indexById.get(fromId), to: indexById.get(toId), born: nowT, life: 0.45, blocked: !!blockedByShield });
  }

  function say(playerId, text) {
    const idx = indexById.get(playerId);
    if (idx === undefined) return;
    bubbles.set(idx, { text: String(text).slice(0, 34), until: nowT + 3.2 });
  }

  function floatText(text, color) {
    fx.push({ kind: 'text', text, color: color || '#ffe08a', x: me.x, y: me.y - 60, born: nowT, life: 1.6 });
  }

  /* -------------------------------------------------------------- lookups */

  // interpolated positions of everyone at `t` (server ms), from the snapshot buffer
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
    const lerp = (u, v) => u + (v - u) * k;
    return {
      p: b.p.map((e, i) => {
        const o = a.p[i] || e;
        return { idx: e[0], x: lerp(o[1], e[1]), y: lerp(o[2], e[2]), face: e[3], flags: e[4], mission: e[5], points: e[6], blaster: e[7], moving: Math.abs(e[1] - o[1]) + Math.abs(e[2] - o[2]) > 0.5 };
      }),
      n: b.n.map((e, i) => {
        const o = a.n[i] || e;
        return { x: lerp(o[0], e[0]), y: lerp(o[1], e[1]), d: e[2], walk: e[3], look: npcLooks[i] || [0, 0] };
      }),
      c: b.c.map((e, i) => {
        const o = a.c[i] || e;
        return { x: lerp(o[0], e[0]), y: lerp(o[1], e[1]), vertical: e[2] === 1, dir: e[3], color: e[4] };
      }),
      endsAt: b.endsAt,
    };
  }

  /* --------------------------------------------------------------- drawing */

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => clamp(Math.round(v + k), 0, 255);
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
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

  function drawGround() {
    ctx.fillStyle = '#2f3542';
    ctx.fillRect(0, 0, map.w, map.h);
    // lane markings
    ctx.strokeStyle = 'rgba(255, 214, 90, 0.55)';
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 22]);
    ctx.beginPath();
    for (let i = 0; i < map.cols; i++) {
      const x = i * map.colStep + 50;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, map.h);
    }
    for (let j = 0; j < map.rows; j++) {
      const y = j * map.rowStep + 50;
      ctx.moveTo(0, y);
      ctx.lineTo(map.w, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // sidewalks / blocks
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const x0 = c * map.colStep + 100;
        const y0 = r * map.rowStep + 100;
        ctx.fillStyle = '#5a6272';
        rr(ctx, x0 - 6, y0 - 6, 392, 272, 10);
        ctx.fill();
        ctx.fillStyle = '#aeb6c4';
        rr(ctx, x0, y0, 380, 260, 8);
        ctx.fill();
      }
    }
    // crosswalks at intersections
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < map.cols; i++) {
      for (let j = 0; j < map.rows; j++) {
        const cx = i * map.colStep + 50;
        const cy = j * map.rowStep + 50;
        for (let k = -3; k <= 3; k++) {
          ctx.fillRect(cx - 44 + k * 13, cy - 62, 7, 10);
          ctx.fillRect(cx - 44 + k * 13, cy + 52, 7, 10);
          ctx.fillRect(cx - 62, cy - 44 + k * 13, 10, 7);
          ctx.fillRect(cx + 52, cy - 44 + k * 13, 10, 7);
        }
      }
    }
  }

  function drawParks(t) {
    for (const p of map.parks) {
      ctx.fillStyle = '#3f8f4f';
      rr(ctx, p.x, p.y, p.w, p.h, 14);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      for (let i = 0; i < 40; i++) ctx.fillRect(p.x + ((i * 53) % (p.w - 8)) + 4, p.y + ((i * 37) % (p.h - 8)) + 4, 3, 3);
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      ctx.fillStyle = '#8fa3b8';
      ctx.beginPath();
      ctx.arc(cx, cy, 34, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#4aa8e0';
      ctx.beginPath();
      ctx.arc(cx, cy, 27 + Math.sin(t * 2) * 1.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 12 + Math.sin(t * 3) * 3, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.name, cx, p.y + p.h - 8);
    }
  }

  function drawTree(x, y) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 6, 18, 8, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(x - 3, y - 12, 6, 18);
    ctx.fillStyle = '#2e7d3a';
    ctx.beginPath();
    ctx.arc(x, y - 26, 20, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#3f9d4d';
    ctx.beginPath();
    ctx.arc(x - 6, y - 32, 11, 0, TAU);
    ctx.fill();
  }

  function drawBuilding(b, t, isTarget) {
    const x = b.x;
    const y = b.y;
    const w = b.w;
    const h = b.h;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x + 8, y + h - 4, w, 16);
    // front face
    const face = ctx.createLinearGradient(0, y + h - LIFT, 0, y + h);
    face.addColorStop(0, shade(b.color, -50));
    face.addColorStop(1, shade(b.color, -85));
    ctx.fillStyle = face;
    ctx.fillRect(x, y + h - LIFT, w, LIFT);
    // windows
    for (let wx = x + 14; wx < x + w - 24; wx += 34) {
      const lit = Math.sin(wx * 0.37 + b.x) > -0.2;
      ctx.fillStyle = lit ? 'rgba(255, 236, 160, 0.9)' : 'rgba(30, 40, 60, 0.9)';
      ctx.fillRect(wx, y + h - LIFT + 8, 20, 14);
    }
    // door
    ctx.fillStyle = '#1a1f2c';
    rr(ctx, b.door.x - 18, y + h - 30, 36, 30, 4);
    ctx.fill();
    ctx.fillStyle = isTarget ? '#ffd23f' : 'rgba(255,255,255,0.35)';
    ctx.fillRect(b.door.x - 18, y + h - 32, 36, 3);
    // roof (lifted)
    const roof = ctx.createLinearGradient(0, y - LIFT, 0, y + h - LIFT);
    roof.addColorStop(0, shade(b.color, 55));
    roof.addColorStop(1, shade(b.color, 5));
    ctx.fillStyle = roof;
    rr(ctx, x, y - LIFT, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    rr(ctx, x + 5, y - LIFT + 5, w - 10, h - 10, 4);
    ctx.stroke();
    // roof details
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x + w - 70, y - LIFT + 20, 46, 32);
    ctx.fillRect(x + 24, y - LIFT + 30, 30, 22);
    // sign
    ctx.fillStyle = '#0d1226';
    rr(ctx, x + w / 2 - 92, y - LIFT + h / 2 - 22, 184, 44, 12);
    ctx.fill();
    ctx.strokeStyle = isTarget ? '#ffd23f' : b.color;
    ctx.lineWidth = 3;
    rr(ctx, x + w / 2 - 92, y - LIFT + h / 2 - 22, 184, 44, 12);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 22px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${b.icon} ${b.name}`, x + w / 2, y - LIFT + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    void t;
  }

  function drawPerson(x, y, look, opts) {
    const o = opts || {};
    const face = o.face || 1;
    const moving = o.moving;
    const swing = moving ? Math.sin(nowT * 14 + (o.phase || 0)) : 0;
    const bob = moving ? Math.abs(Math.cos(nowT * 14 + (o.phase || 0))) * 2 : 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 13, 4, 0, 0, TAU);
    ctx.fill();
    const grey = o.stunned ? 0.35 : 0;
    const col = (hex) => (grey ? shade(hex, -40) : hex);
    ctx.lineCap = 'round';
    // legs
    ctx.strokeStyle = col('#222a48');
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-3, -22 - bob);
    ctx.lineTo(-3 - swing * 8 * face, -2);
    ctx.moveTo(3, -22 - bob);
    ctx.lineTo(3 + swing * 8 * face, -2);
    ctx.stroke();
    // torso
    ctx.fillStyle = col(look.shirt);
    rr(ctx, -9, -46 - bob, 18, 26, 8);
    ctx.fill();
    // arms
    ctx.strokeStyle = col(look.shirt);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-9, -42 - bob);
    ctx.lineTo(-11 + swing * 6 * face, -28 - bob);
    ctx.moveTo(9, -42 - bob);
    ctx.lineTo(11 - swing * 6 * face, -28 - bob);
    ctx.stroke();
    if (o.blaster) {
      ctx.fillStyle = '#c0392b';
      rr(ctx, face > 0 ? 8 : -22, -36 - bob, 14, 7, 2);
      ctx.fill();
    }
    // head
    ctx.fillStyle = col(look.skin);
    ctx.beginPath();
    ctx.arc(0, -55 - bob, 9.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = col(look.hair);
    ctx.beginPath();
    ctx.arc(0, -56.5 - bob, 10, Math.PI, TAU);
    ctx.fill();
    ctx.fillStyle = '#1b1414';
    ctx.beginPath();
    ctx.arc(face * 3.5, -55 - bob, 1.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawCarSprite(x, y, color, vertical, dir, driverLook) {
    ctx.save();
    ctx.translate(x, y);
    if (vertical) ctx.rotate(Math.PI / 2 * (dir > 0 ? 1 : -1));
    else if (dir < 0) ctx.scale(-1, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 12, 30, 7, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(-20, 6, 11, 7);
    ctx.fillRect(9, 6, 11, 7);
    const body = ctx.createLinearGradient(0, -14, 0, 12);
    body.addColorStop(0, shade(color, 40));
    body.addColorStop(1, shade(color, -30));
    ctx.fillStyle = body;
    rr(ctx, -30, -10, 60, 22, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(160, 220, 255, 0.9)';
    rr(ctx, -12, -18, 26, 12, 4);
    ctx.fill();
    ctx.fillStyle = color;
    rr(ctx, -14, -22, 30, 8, 4);
    ctx.fill();
    ctx.fillStyle = '#ffe9a0';
    ctx.fillRect(26, -4, 4, 6);
    if (driverLook) {
      ctx.fillStyle = driverLook.skin;
      ctx.beginPath();
      ctx.arc(0, -16, 6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function nameTag(x, y, p, isMe) {
    const fs = 12 / Math.max(cam.s, 0.55);
    ctx.font = `700 ${fs}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    const label = `${p.avatar} ${p.name.length > 9 ? p.name.slice(0, 8) + '…' : p.name}`;
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = isMe ? 'rgba(255, 210, 63, 0.92)' : 'rgba(10, 14, 36, 0.78)';
    rr(ctx, x - w / 2, y - fs - 4, w, fs + 8, 8);
    ctx.fill();
    ctx.fillStyle = isMe ? '#2a1b00' : '#fff';
    ctx.fillText(label, x, y - 3);
  }

  function drawBubble(idx, x, y) {
    const b = bubbles.get(idx);
    if (!b || b.until < nowT) return;
    const fs = 12 / Math.max(cam.s, 0.55);
    ctx.font = `700 ${fs}px system-ui, "Apple Color Emoji", sans-serif`;
    const w = Math.min(220, ctx.measureText(b.text).width + 16);
    ctx.fillStyle = '#fff';
    rr(ctx, x - w / 2, y - fs - 10, w, fs + 12, 9);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 5, y + 2);
    ctx.lineTo(x, y + 9);
    ctx.lineTo(x + 5, y + 2);
    ctx.fill();
    ctx.fillStyle = '#12163a';
    ctx.textAlign = 'center';
    ctx.fillText(b.text, x, y - 3);
  }

  function drawMarker(m, t) {
    const d = m.door;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    // rising beam
    const g = ctx.createLinearGradient(0, d.y - 230, 0, d.y);
    g.addColorStop(0, 'rgba(255, 210, 63, 0)');
    g.addColorStop(1, `rgba(255, 210, 63, ${0.28 + 0.12 * pulse})`);
    ctx.fillStyle = g;
    ctx.fillRect(d.x - 26, d.y - 230, 52, 230);
    // ring
    ctx.strokeStyle = `rgba(255, 210, 63, ${0.7 + 0.3 * pulse})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(d.x, d.y, DOOR_RADIUS - 6 + pulse * 5, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 210, 63, 0.16)';
    ctx.beginPath();
    ctx.arc(d.x, d.y, DOOR_RADIUS, 0, TAU);
    ctx.fill();
    ctx.font = '26px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(m.icon, d.x, d.y - 40 - pulse * 6);
  }

  function drawFx(t, s) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      const k = (nowT - f.born) / f.life;
      if (k >= 1) {
        fx.splice(i, 1);
        continue;
      }
      if (f.kind === 'zap') {
        const a = s.p.find((e) => e.idx === f.from);
        const b = s.p.find((e) => e.idx === f.to);
        if (!a || !b) continue;
        const ax = a.idx === meIdx ? me.x : a.x;
        const ay = (a.idx === meIdx ? me.y : a.y) - 34;
        const bx = b.idx === meIdx ? me.x : b.x;
        const by = (b.idx === meIdx ? me.y : b.y) - 34;
        ctx.strokeStyle = f.blocked ? `rgba(90, 220, 255, ${1 - k})` : `rgba(255, 240, 120, ${1 - k})`;
        ctx.lineWidth = 4;
        ctx.shadowColor = f.blocked ? '#5adcff' : '#ffe14d';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        const segs = 7;
        for (let n = 1; n < segs; n++) {
          const u = n / segs;
          ctx.lineTo(ax + (bx - ax) * u + rand(-9, 9), ay + (by - ay) * u + rand(-9, 9));
        }
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (f.kind === 'text') {
        ctx.globalAlpha = 1 - k;
        ctx.font = `800 ${18 / Math.max(cam.s, 0.55)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = f.color;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 3;
        ctx.strokeText(f.text, f.x, f.y - k * 40);
        ctx.fillText(f.text, f.x, f.y - k * 40);
        ctx.globalAlpha = 1;
      }
    }
  }

  function personLook(idx) {
    const h = idx * 2654435761;
    return { skin: SKIN[(h >>> 3) % SKIN.length], shirt: SHIRT[(h >>> 7) % SHIRT.length], hair: HAIR[(h >>> 11) % HAIR.length] };
  }

  function draw(t, dt) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1b2030';
    ctx.fillRect(0, 0, W, H);
    if (!map) return;
    const s = sample(nowServer() - 110);
    if (!s) return;

    // camera follows the player
    cam.s = clamp(W / 760, 0.5, 1.25);
    const tx = me.init ? me.x : map.w / 2;
    const ty = me.init ? me.y : map.h / 2;
    cam.x += (tx - cam.x) * Math.min(1, dt * 8);
    cam.y += (ty - cam.y) * Math.min(1, dt * 8);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.s, cam.s);
    ctx.translate(-cam.x, -cam.y);

    drawGround();
    drawParks(t);

    const target = missions[me.mission] || null;
    const items = [];
    for (const b of map.buildings) items.push({ y: b.y + b.h, draw: () => drawBuilding(b, t, target && target.door.x === b.door.x && target.door.y === b.door.y) });
    for (const tr of map.trees) items.push({ y: tr[1], draw: () => drawTree(tr[0], tr[1]) });
    for (const c of s.c) items.push({ y: c.y, draw: () => drawCarSprite(c.x, c.y, CAR_COLORS[c.color % CAR_COLORS.length], c.vertical, c.dir, null) });
    for (const n of s.n) {
      const look = { skin: SKIN[n.look[0] % SKIN.length], shirt: SHIRT[n.look[1] % SHIRT.length], hair: HAIR[(n.look[0] + n.look[1]) % HAIR.length] };
      items.push({ y: n.y, draw: () => drawPerson(n.x, n.y, look, { face: n.d, moving: n.walk, phase: n.x * 0.1 }) });
    }
    for (const e of s.p) {
      if (e.flags & 64) continue;
      const info = players[e.idx];
      if (!info) continue;
      const isMe = e.idx === meIdx;
      const x = isMe ? me.x : e.x;
      const y = isMe ? me.y : e.y;
      const face = isMe ? me.face : e.face;
      const flags = isMe ? me.flags : e.flags;
      const moving = isMe ? !!(inputVector().dx || inputVector().dy) && !(flags & 9) : e.moving;
      const look = personLook(e.idx);
      items.push({
        y: y + 1,
        draw: () => {
          if (flags & 4) drawCarSprite(x, y - 6, isMe ? '#ffd23f' : CAR_COLORS[e.idx % CAR_COLORS.length], false, face, look);
          else drawPerson(x, y, look, { face, moving, phase: e.idx, stunned: !!(flags & 1), blaster: e.blaster > 0 });
          if (flags & 2) {
            ctx.strokeStyle = 'rgba(90, 220, 255, 0.85)';
            ctx.fillStyle = 'rgba(90, 220, 255, 0.16)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(x, y - 28, 34 + Math.sin(t * 5) * 2, 0, TAU);
            ctx.fill();
            ctx.stroke();
          }
          if (flags & 1) {
            for (let k = 0; k < 3; k++) {
              const a = t * 5 + k * 2.1;
              ctx.font = '16px system-ui, "Apple Color Emoji", sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText('⭐', x + Math.cos(a) * 16, y - 72 + Math.sin(a) * 5);
            }
          }
          if (flags & 8) {
            ctx.font = '20px system-ui, "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('💭', x + 20, y - 74);
          }
          if (flags & 32) {
            ctx.font = '22px system-ui, "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('🏁', x, y - 82);
          }
          nameTag(x, y - 88, info, isMe);
          drawBubble(e.idx, x, y - 106);
        },
      });
    }
    items.sort((a, b) => a.y - b.y);
    // the current mission marker sits under everything on the ground
    if (target) drawMarker(target, t);
    for (const it of items) it.draw();
    drawFx(t, { p: s.p.map((e) => ({ ...e })) });
    ctx.restore();

    drawMinimap(s, target);
    hooks.gps && hooks.gps(target, worldToScreen(target ? target.door.x : 0, target ? target.door.y : 0), { x: me.x, y: me.y });
  }

  function worldToScreen(wx, wy) {
    return { x: (wx - cam.x) * cam.s + W / 2, y: (wy - cam.y) * cam.s + H / 2 };
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
  }

  /* ----------------------------------------------------------------- loop */

  function loop(now) {
    if (!running) return;
    const t = now / 1000;
    const dt = Math.min(0.05, Math.max(0, t - last));
    last = t;
    nowT = t;
    if (map && me.init) {
      const v = inputVector();
      stepMe(dt, v);
      // tell the server what we're pressing (on change, and as a keep-alive)
      const nowMs = performance.now();
      if (Math.abs(v.dx - lastSent.dx) > 0.02 || Math.abs(v.dy - lastSent.dy) > 0.02 || nowMs - lastSent.t > 250) {
        lastSent = { dx: v.dx, dy: v.dy, t: nowMs };
        hooks.sendInput && hooks.sendInput(v.dx, v.dy);
      }
    }
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
  }

  /* --------------------------------------------------------------- controls */

  function bindControls(joyEl, knobEl) {
    const KEYMAP = { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' };
    window.addEventListener('keydown', (e) => {
      if (!running || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '').toUpperCase())) return;
      if (KEYMAP[e.key]) {
        keys[KEYMAP[e.key]] = true;
        goTo = null;
        e.preventDefault();
      } else if (e.key === ' ' || e.key === 'Enter') {
        hooks.zap && hooks.zap();
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (KEYMAP[e.key]) keys[KEYMAP[e.key]] = false;
    });
    window.addEventListener('blur', () => {
      keys.up = keys.down = keys.left = keys.right = false;
    });

    // virtual joystick
    let joyId = null;
    const R = 46;
    function moveKnob(e) {
      const rect = joyEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
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
    joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) moveKnob(e); });
    const endJoy = (e) => {
      if (e.pointerId !== joyId) return;
      joyId = null;
      joy = { x: 0, y: 0 };
      knobEl.style.transform = 'translate(0, 0)';
    };
    joyEl.addEventListener('pointerup', endJoy);
    joyEl.addEventListener('pointercancel', endJoy);

    // tap the map to walk there
    canvas.addEventListener('pointerdown', (e) => {
      if (!map || !running) return;
      const rect = canvas.getBoundingClientRect();
      goTo = { x: (e.clientX - rect.left - W / 2) / cam.s + cam.x, y: (e.clientY - rect.top - H / 2) / cam.s + cam.y };
    });
  }

  function mount(canvasEl, miniEl, joyEl, knobEl, h) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    mini = miniEl;
    mctx = mini.getContext('2d');
    hooks = h || {};
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);
    bindControls(joyEl, knobEl);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) running = false;
      else if (canvas.offsetParent !== null && map) begin();
    });
  }

  return { mount, start, stop, applyState, zapFx, say, floatText, get running() { return running; }, get me() { return me; }, reduceMotion };
})();
