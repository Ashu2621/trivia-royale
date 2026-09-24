/*
 * City Royale — the Battle Royale mode of City Chaos. Server-authoritative, same map, same renderer.
 *
 * Everybody parachutes into the city with bare fists, scrambles for guns, armor and medkits lying on
 * the streets, and fights while a storm circle closes in. Supply drops with heavy weapons fall into
 * every new circle. Eliminated players do not come back (they drop their loot); the last one standing
 * wins. Snapshots use the same layout as City Chaos so the client renders both with the same code.
 */
const EVENTS = require('./events');
const { serializePlayers } = require('./rooms');
const { getTier } = require('./bots');
const { pickLine } = require('./botLines');
const db = require('./db');
const city = require('./city');
const { WEAPONS, WEAPON_BY_CODE, AMMO_CAP, emptyAmmo, emptyWeapons, gunGate, startReload, spreadFor, afterShot } = require('./weapons');

const { MAP, collides, nearestWalkable, randomWalkable, wallDistance, segmentClear, findPath, CELL, PLAYER_R, BASE_SPEED } = city;
const W = MAP.w;
const H = MAP.h;
const TICK_MS = 50;
const SNAPSHOT_EVERY = 2;
const START_COUNTDOWN_MS = 3400;
const AIR_MS = 7500; // the parachute drop
const LAND_INVULN_MS = 3500;
const ZONE_DELAY_MS = 12000; // after the countdown, before the first circle starts to wait
const MAX_MATCH_MS = 10 * 60 * 1000;
const START_HP = 100;
const NO_HUMANS_END_MS = 5000;
const PLACE_BONUS = [1000, 600, 350, 200, 120];

// the closing circles: radius, hold before it shrinks, shrink time, damage per second outside
const SPEED = Number(process.env.ROYALE_SPEED) || 1; // test knob: run the storm faster
const PHASES = [
  { r: 1180, hold: 42000, shrink: 30000, dps: 1 },
  { r: 760, hold: 34000, shrink: 28000, dps: 2 },
  { r: 470, hold: 28000, shrink: 24000, dps: 4 },
  { r: 260, hold: 22000, shrink: 20000, dps: 6 },
  { r: 130, hold: 18000, shrink: 18000, dps: 9 },
  { r: 30, hold: 0, shrink: 0, dps: 12 },
].map((p) => ({ ...p, hold: p.hold / SPEED, shrink: p.shrink / SPEED }));

const LOOT_TABLE = [
  ['pistol', 10], ['bat', 6], ['smg', 9], ['shotgun', 7], ['ar', 6], ['sniper', 3], ['ammo', 14], ['health', 12], ['armor', 9],
];
const LOOT_AMMO = { pistol: 36, smg: 60, shotgun: 12, ar: 60, sniper: 10 };
const POWER = { fists: 0, bat: 1, pistol: 2, smg: 3, shotgun: 3.5, sniper: 4.5, ar: 5 };
const PICKUP_CODE = { cash: 0, pistol: 1, smg: 2, shotgun: 3, health: 4, armor: 5, bat: 6, ar: 7, sniper: 8, ammo: 9 };

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const TAU = Math.PI * 2;
const angDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
const shuffled = (list) => {
  const c = list.slice();
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
};

const feed = (io, room, text) => io.to(room.code).emit(EVENTS.CITY_FEED, { text });
const fx = (io, room, payload) => io.to(room.code).emit(EVENTS.CITY_FX, payload);
const idOfPs = (sim, ps) => {
  for (const [k, v] of sim.players) if (v === ps) return k;
  return null;
};
const nameOf = (room, id) => {
  const p = room.players.get(id);
  return p ? `${p.avatar} ${p.name}` : 'Someone';
};

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

/* ------------------------------------------------------------------ zone */

function planZone() {
  const circles = [{ x: W / 2 + rnd(-60, 60), y: H / 2 + rnd(-40, 40), r: PHASES[0].r }];
  for (let i = 1; i < PHASES.length; i++) {
    const prev = circles[i - 1];
    const r = PHASES[i].r;
    const room = Math.max(0, prev.r - r);
    const a = rnd(0, TAU);
    const d = Math.sqrt(Math.random()) * room * 0.8;
    let x = prev.x + Math.cos(a) * d;
    let y = prev.y + Math.sin(a) * d;
    x = clamp(x, r * 0.4 + 60, W - r * 0.4 - 60);
    y = clamp(y, r * 0.4 + 60, H - r * 0.4 - 60);
    circles.push({ x, y, r });
  }
  return circles;
}

// where the circle is at time t
function zoneAt(sim, now) {
  let t = now - sim.zoneStart;
  const cs = sim.circles;
  if (t < 0) return { ...cs[0], nx: cs[0].x, ny: cs[0].y, nr: cs[0].r, s0: sim.zoneStart, s1: sim.zoneStart, ph: 0, dps: PHASES[0].dps, shrinking: false };
  let start = 0;
  for (let i = 0; i < PHASES.length - 1; i++) {
    const ph = PHASES[i];
    const holdEnd = start + ph.hold;
    const shrinkEnd = holdEnd + ph.shrink;
    const a = cs[i];
    const b = cs[i + 1];
    if (t < holdEnd) return { ...a, nx: b.x, ny: b.y, nr: b.r, s0: sim.zoneStart + holdEnd, s1: sim.zoneStart + shrinkEnd, ph: i, dps: ph.dps, shrinking: false };
    if (t < shrinkEnd) {
      const k = (t - holdEnd) / ph.shrink;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, r: a.r + (b.r - a.r) * k, nx: b.x, ny: b.y, nr: b.r, s0: sim.zoneStart + holdEnd, s1: sim.zoneStart + shrinkEnd, ph: i, dps: PHASES[i + 1].dps, shrinking: true };
    }
    start = shrinkEnd;
  }
  const last = cs[cs.length - 1];
  return { ...last, nx: last.x, ny: last.y, nr: last.r, s0: 0, s1: 0, ph: PHASES.length - 1, dps: PHASES[PHASES.length - 1].dps, shrinking: false };
}

/* ------------------------------------------------------------------ loot */

function pickType() {
  const total = LOOT_TABLE.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [t, w] of LOOT_TABLE) {
    r -= w;
    if (r <= 0) return t;
  }
  return 'ammo';
}

function dropPickup(sim, type, x, y, value, ttl) {
  const pk = { id: sim.nextId++, type, x, y, value, expires: ttl ? Date.now() + ttl : 0 };
  sim.pickups.push(pk);
  return pk;
}

function lootValue(type) {
  if (type === 'health') return 55;
  if (type === 'armor') return 50;
  if (type === 'ammo') return 1;
  if (type === 'bat') return 1;
  return LOOT_AMMO[type];
}

function scatterLoot(sim) {
  const spots = [];
  for (const b of MAP.buildings) {
    for (let i = 0; i < 3; i++) spots.push({ x: b.door.x + rnd(-110, 110), y: b.door.y + rnd(-20, 45) });
    spots.push({ x: b.x - 30, y: b.y + b.h / 2 });
    spots.push({ x: b.x + b.w + 30, y: b.y + b.h / 2 });
  }
  for (const p of MAP.parks) for (let i = 0; i < 3; i++) spots.push({ x: p.x + rnd(30, p.w - 30), y: p.y + rnd(30, p.h - 30) });
  for (let i = 0; i < 16; i++) spots.push(randomWalkable());
  for (const s of shuffled(spots).slice(0, 78)) {
    const [cx, cy] = nearestWalkable(s.x, s.y);
    const type = pickType();
    dropPickup(sim, type, cx * CELL + CELL / 2, cy * CELL + CELL / 2, lootValue(type), 0);
  }
}

function powerOf(key) {
  return POWER[key] || 0;
}

function hasAmmo(ps, key) {
  const w = WEAPONS[key];
  return !!(ps.weapons[key] && (w.melee || ps.ammo[w.ammoKey] > 0));
}

function bestGun(ps) {
  let best = 'fists';
  for (const key of Object.keys(WEAPONS)) if (hasAmmo(ps, key) && powerOf(key) > powerOf(best)) best = key;
  return best;
}

function givePickup(io, room, id, ps, pk) {
  if (pk.type === 'health') {
    if (ps.hp >= START_HP) return false;
    ps.hp = Math.min(START_HP, ps.hp + pk.value);
  } else if (pk.type === 'armor') {
    if (ps.armor >= 100) return false;
    ps.armor = Math.min(100, ps.armor + pk.value);
  } else if (pk.type === 'bat') {
    if (ps.weapons.bat) return false;
    ps.weapons.bat = true;
    if (powerOf('bat') > powerOf(ps.weapon)) ps.weapon = 'bat';
  } else if (pk.type === 'ammo') {
    let used = false;
    for (const key of ['pistol', 'smg', 'shotgun', 'ar', 'sniper']) {
      if (!ps.weapons[key]) continue;
      const add = Math.round((LOOT_AMMO[key] || 20) * 0.7);
      if (ps.ammo[key] < AMMO_CAP[key]) used = true;
      ps.ammo[key] = Math.min(AMMO_CAP[key], ps.ammo[key] + add);
    }
    if (!used) return false;
  } else {
    const key = pk.type;
    const had = ps.weapons[key];
    if (had && ps.ammo[key] >= AMMO_CAP[key]) return false;
    ps.weapons[key] = true;
    ps.ammo[key] = Math.min(AMMO_CAP[key], ps.ammo[key] + pk.value);
    if (!had && ps.mag) delete ps.mag[key];
    if (powerOf(key) > powerOf(ps.weapon) || !hasAmmo(ps, ps.weapon)) ps.weapon = key;
  }
  fx(io, room, { type: 'pickup', playerId: id, what: pk.type, x: pk.x, y: pk.y });
  return true;
}

/* ------------------------------------------------------------------ setup */

function startRoyale(io, room) {
  const now = Date.now();
  const order = [...room.players.values()].map((p) => p.playerId);
  const startsAt = now + START_COUNTDOWN_MS;
  const sim = {
    mode: 'royale',
    map: MAP,
    missions: [],
    mansion: null,
    startsAt,
    airUntil: startsAt + AIR_MS,
    zoneStart: startsAt + AIR_MS + ZONE_DELAY_MS,
    endsAt: startsAt + MAX_MATCH_MS,
    circles: planZone(),
    dropsDone: -1,
    order,
    nextId: 1,
    pickups: [],
    players: new Map(),
    tick: 0,
    over: false,
    lastTickAt: now,
    noHumansSince: null,
    eliminated: [],
  };
  scatterLoot(sim);
  // everybody drops next to some gun, spread well apart (nobody starts helpless)
  const spots = [];
  const guns = shuffled(sim.pickups.filter((k) => ['pistol', 'smg', 'shotgun', 'ar'].includes(k.type)));
  for (let i = 0; i < order.length; i++) {
    let best = null;
    for (const k of guns) {
      const d = spots.reduce((m, sp) => Math.min(m, Math.hypot(sp.x - k.x, sp.y - k.y)), 1e9);
      if (d > 260) {
        best = { x: k.x - 26, y: k.y, d };
        break;
      }
      if (!best || d > best.d) best = { x: k.x - 26, y: k.y, d };
    }
    if (!best) {
      const c = randomWalkable();
      best = { x: c.x, y: c.y, d: 0 };
    }
    const [cx, cy] = nearestWalkable(best.x, best.y);
    spots.push({ x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });
  }
  order.forEach((id, i) => {
    const p = room.players.get(id);
    p.score = 0;
    p.left = false;
    sim.players.set(id, {
      idx: i,
      x: spots[i].x,
      y: spots[i].y,
      ang: rnd(0, TAU),
      input: { dx: 0, dy: 0 },
      hp: START_HP,
      armor: 0,
      weapon: 'fists',
      weapons: emptyWeapons(),
      ammo: emptyAmmo(),
      mag: {},
      reloadUntil: 0,
      reloadKey: '',
      heat: 0,
      heatAt: 0,
      nextAttackAt: 0,
      attackUntil: 0,
      hurtUntil: 0,
      invulnUntil: sim.airUntil + LAND_INVULN_MS,
      kills: 0,
      damage: 0,
      dead: false,
      place: 0,
      lastHurtBy: null,
      speedMul: p.isBot ? getTier(p.botTier).speed : 1,
      // bots
      botNextThink: 0,
      botGoal: null,
      botTarget: null,
      botStrafeAt: 0,
      botStrafeDir: 1,
      botReactAt: 0,
      botRepathAt: 0,
      botPathGoal: null,
      path: [],
    });
  });
  room.city = sim;
  room.mode = 'royale';
  room.state = 'city';
  room.startsAt = sim.startsAt;
  io.to(room.code).emit(EVENTS.CITY_START, initPayload(room));
  room.timers.cityTick = setInterval(() => tick(io, room), TICK_MS);
}

function aliveList(sim) {
  return [...sim.players.entries()].filter(([, ps]) => !ps.dead);
}

function initPayload(room) {
  const sim = room.city;
  return {
    mode: 'royale',
    map: sim.map,
    missions: [],
    kinds: {},
    weapons: WEAPON_BY_CODE.map((k) => ({ key: k, label: WEAPONS[k].label, melee: !!WEAPONS[k].melee })),
    players: sim.order.map((id) => {
      const p = room.players.get(id);
      return { playerId: id, name: p.name, avatar: p.avatar, isBot: !!p.isBot, botTier: p.botTier || null };
    }),
    npcLooks: [],
    mansion: null,
    guardCount: 0,
    startsAt: sim.startsAt,
    airUntil: sim.airUntil,
    zoneStart: sim.zoneStart,
    endsAt: sim.endsAt,
    serverNow: Date.now(),
    snapshot: snapshot(room),
  };
}

/* ---------------------------------------------------------------- combat */

function targetsFor(sim, room, attId, now) {
  const out = [];
  for (const [id, ps] of sim.players) {
    if (id === attId || ps.dead || now < sim.airUntil) continue;
    const p = room.players.get(id);
    if (!p || p.left) continue;
    out.push({ kind: 'player', id, ref: ps, x: ps.x, y: ps.y, r: 13 });
  }
  return out;
}

function killPlayer(io, room, sim, id, ps, killerPs, cause, now) {
  if (ps.dead) return;
  const aliveBefore = aliveList(sim).length;
  ps.dead = true;
  ps.hp = 0;
  ps.place = aliveBefore;
  ps.input = { dx: 0, dy: 0 };
  sim.eliminated.push(id);
  // the loot drops where they fell
  const drop = (type, value) => dropPickup(sim, type, ps.x + rnd(-18, 18), ps.y + rnd(-18, 18), value, 0);
  const gun = bestGun(ps);
  if (gun !== 'fists' && gun !== 'bat') drop(gun, Math.max(8, Math.round(ps.ammo[gun] * 0.6)));
  else if (ps.weapons.bat) drop('bat', 1);
  if (ps.armor > 20) drop('armor', Math.round(ps.armor));
  if (Math.random() < 0.6) drop('health', 45);
  let kid = null;
  if (killerPs && killerPs !== ps) {
    killerPs.kills += 1;
    for (const [k, v] of sim.players) if (v === killerPs) kid = k;
    say(io, room, kid, 'kill', 0.6);
  }
  say(io, room, id, 'die', 0.5);
  const left = aliveBefore - 1;
  fx(io, room, { type: 'kill', killer: kid, victim: id, weapon: cause });
  const who = nameOf(room, id);
  feed(io, room, kid ? `💀 ${nameOf(room, kid)} eliminated ${who} (${cause}) · ${left} left` : `💀 ${who} ${cause === 'zone' ? 'was caught in the storm' : 'died'} · ${left} left`);
}

function damagePlayer(io, room, sim, id, ps, dmg, killerPs, cause, now, silent) {
  if (ps.dead || ps.invulnUntil > now || now < sim.airUntil) return false;
  let d = dmg;
  if (ps.armor > 0 && !silent) {
    const a = Math.min(ps.armor, d * 0.6);
    ps.armor -= a;
    d -= a;
  }
  ps.hp -= d;
  if (killerPs) {
    ps.lastHurtBy = killerPs;
    killerPs.damage += Math.round(dmg);
  }
  if (!silent) {
    ps.hurtUntil = now + 220;
    fx(io, room, { type: 'hit', x: Math.round(ps.x), y: Math.round(ps.y), dmg: Math.round(dmg), k: 0, playerId: id, by: killerPs ? idOfPs(sim, killerPs) : null, from: killerPs ? [Math.round(killerPs.x), Math.round(killerPs.y)] : null });
    say(io, room, id, 'hurt', 0.05);
  }
  if (ps.hp <= 0) {
    killPlayer(io, room, sim, id, ps, killerPs || null, cause, now);
    return true;
  }
  return false;
}

function attackNow(io, room, id, ps, now, opt) {
  const sim = room.city;
  if (!sim || ps.dead || now < sim.airUntil || now < ps.nextAttackAt || now < sim.startsAt) return false;
  let key = ps.weapon;
  let w = WEAPONS[key];
  if (!w) return false;
  if (!w.melee && ps.ammo[w.ammoKey] <= 0) {
    key = ps.weapons.bat ? 'bat' : 'fists';
    ps.weapon = key;
    w = WEAPONS[key];
  }
  if (!w.melee && !gunGate(ps, key, now)) return false;
  const targets = targetsFor(sim, room, id, now);
  let aim = ps.ang;
  if (opt && opt.target) aim = Math.atan2(opt.target.y - ps.y, opt.target.x - ps.x) + (opt.err || 0);
  else {
    let bestScore = Infinity;
    let picked = null;
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
    for (const h of hits.slice(0, 2)) damagePlayer(io, room, sim, h.t.id, h.t.ref, w.dmg, ps, w.label.toLowerCase(), now);
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
    const wall = wallDistance(sim, 0, ox, oy, a, w.range);
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
    if (hit) damagePlayer(io, room, sim, hit.id, hit.ref, w.dmg, ps, w.label.toLowerCase(), now);
  }
  fx(io, room, { type: 'shot', playerId: id, w: w.code, x: Math.round(ox), y: Math.round(oy), ends });
  return true;
}

/* ------------------------------------------------------------------ bots */

function botMoveTo(ps, gx, gy, now, speedy) {
  if (!ps.botPathGoal || Math.hypot(ps.botPathGoal.x - gx, ps.botPathGoal.y - gy) > 70 || now > ps.botRepathAt) {
    ps.path = findPath(ps.x, ps.y, gx, gy);
    ps.botPathGoal = { x: gx, y: gy };
    ps.botRepathAt = now + 1600;
  }
  while (ps.path.length && Math.hypot(ps.path[0].x - ps.x, ps.path[0].y - ps.y) < 15) ps.path.shift();
  const t = ps.path[0] || { x: gx, y: gy };
  const d = Math.hypot(t.x - ps.x, t.y - ps.y);
  if (d < 6) ps.input = { dx: 0, dy: 0 };
  else ps.input = { dx: (t.x - ps.x) / d, dy: (t.y - ps.y) / d };
  void speedy;
}

function bestWeaponAt(ps, dist) {
  const has = (k) => hasAmmo(ps, k);
  if (dist > 420 && has('sniper')) return 'sniper';
  if (dist < 120 && has('shotgun')) return 'shotgun';
  if (dist < 520 && has('ar')) return 'ar';
  if (dist < 300 && has('smg')) return 'smg';
  if (has('pistol')) return 'pistol';
  if (has('smg')) return 'smg';
  if (has('ar')) return 'ar';
  if (has('shotgun') && dist < 220) return 'shotgun';
  if (has('sniper')) return 'sniper';
  return ps.weapons.bat ? 'bat' : 'fists';
}

function lootWant(ps, pk) {
  const gunCount = ['pistol', 'smg', 'shotgun', 'ar', 'sniper'].filter((k) => ps.weapons[k]).length;
  switch (pk.type) {
    case 'health': return ps.hp < 60 ? 3 : ps.hp < 95 ? 0.6 : 0;
    case 'armor': return ps.armor < 25 ? 2.5 : ps.armor < 90 ? 0.8 : 0;
    case 'ammo': return gunCount ? 1.2 : 0;
    case 'bat': return ps.weapons.bat ? 0 : 0.8;
    default: {
      const key = pk.type;
      if (!ps.weapons[key]) return 1.5 + powerOf(key) * (gunCount ? 0.5 : 1) + (gunCount ? 0 : 3);
      return ps.ammo[key] < AMMO_CAP[key] * 0.5 ? 1.2 : 0.2;
    }
  }
}

function botThink(io, room, sim, id, ps, p, now) {
  if (ps.dead || now < ps.botNextThink) return;
  ps.botNextThink = now + 110;
  const tier = getTier(p.botTier);
  const zone = zoneAt(sim, now);
  // in the air: steer toward loot-rich streets
  if (now < sim.airUntil) {
    if (!ps.botGoal) {
      const c = randomWalkable();
      ps.botGoal = { x: c.x, y: c.y };
    }
    botMoveTo(ps, ps.botGoal.x, ps.botGoal.y, now);
    return;
  }
  ps.botGoal = null;

  // the storm comes first
  const dc = Math.hypot(ps.x - zone.x, ps.y - zone.y);
  const dn = Math.hypot(ps.x - zone.nx, ps.y - zone.ny);
  const soon = now > zone.s0 - 9000;
  const outside = dc > zone.r - 20;
  const outNext = soon && dn > zone.nr - 60;

  // closest visible enemy
  let foe = null;
  let foeD = Infinity;
  for (const [oid, ops] of sim.players) {
    if (oid === id || ops.dead) continue;
    const d = Math.hypot(ops.x - ps.x, ops.y - ps.y);
    if (d < foeD && d < tier.sight * 1.7 && segmentClear(sim, 0, ps.x, ps.y, ops.x, ops.y)) {
      foe = ops;
      foeD = d;
    }
  }
  const armed = bestGun(ps) !== 'fists';
  const wantsFight = foe && ps.hp > 24 && (armed ? foeD < tier.sight * 1.5 : foeD < 120 * tier.aggression + 40);
  if (wantsFight && !(outside && ps.hp < 60)) {
    const key = bestWeaponAt(ps, foeD);
    if (key !== ps.weapon) {
      ps.weapon = key;
      if (ps.reloadKey && ps.reloadKey !== key) ps.reloadUntil = 0;
    }
    const w = WEAPONS[key];
    const aim = Math.atan2(foe.y - ps.y, foe.x - ps.x);
    ps.ang = aim;
    if (w.melee) {
      ps.input = foeD > w.range - 8 ? { dx: Math.cos(aim), dy: Math.sin(aim) } : { dx: 0, dy: 0 };
    } else {
      if (now > ps.botStrafeAt) {
        ps.botStrafeAt = now + 800 + Math.random() * 900;
        ps.botStrafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      const ideal = key === 'shotgun' ? 90 : key === 'sniper' ? 380 : key === 'ar' ? 230 : 170;
      let mx = 0;
      let my = 0;
      if (foeD > ideal + 50) {
        mx = Math.cos(aim);
        my = Math.sin(aim);
      } else if (foeD < ideal - 60) {
        mx = -Math.cos(aim);
        my = -Math.sin(aim);
      }
      mx += -Math.sin(aim) * ps.botStrafeDir * 0.7;
      my += Math.cos(aim) * ps.botStrafeDir * 0.7;
      ps.input = { dx: mx, dy: my };
    }
    if (now >= ps.botReactAt) {
      const range = w.melee ? w.range : w.range * 0.92;
      if (foeD < range) {
        ps.botReactAt = now + tier.reaction * (0.6 + Math.random() * 0.8) * (w.cd > 600 ? 0.5 : 1);
        attackNow(io, room, id, ps, now, { target: foe, err: (Math.random() - 0.5) * 2 * (1 - tier.accuracy) * 0.3 });
        if (Math.random() < 0.04) say(io, room, id, 'taunt', 1);
      }
    }
    return;
  }

  // reload when nothing is going on
  const gw = WEAPONS[ps.weapon];
  if (gw && !gw.melee) startReload(ps, ps.weapon, now);
  else if (armed && ps.weapon !== bestGun(ps)) ps.weapon = bestGun(ps);

  if (outside || outNext) {
    botMoveTo(ps, zone.nx, zone.ny, now);
    return;
  }
  // loot
  let best = null;
  let bs = 0;
  for (const pk of sim.pickups) {
    const d = Math.hypot(pk.x - ps.x, pk.y - ps.y);
    if (d > 650) continue;
    const want = lootWant(ps, pk);
    if (want <= 0) continue;
    if (Math.hypot(pk.x - zone.nx, pk.y - zone.ny) > zone.nr + 40 && soon) continue;
    const score = want * 300 - d;
    if (score > bs) {
      bs = score;
      best = pk;
    }
  }
  if (best) {
    botMoveTo(ps, best.x, best.y, now);
    return;
  }
  // nothing to grab: drift toward the middle of the coming circle, hunting a little
  const gx = zone.nx + Math.cos(ps.idx * 1.7 + now / 9000) * zone.nr * 0.4;
  const gy = zone.ny + Math.sin(ps.idx * 1.7 + now / 9000) * zone.nr * 0.4;
  botMoveTo(ps, gx, gy, now);
}

/* ------------------------------------------------------------------ tick */

function snapshot(room) {
  const sim = room.city;
  const now = Date.now();
  const zone = zoneAt(sim, now);
  const alive = aliveList(sim).length;
  return {
    t: now,
    p: sim.order.map((id) => {
      const ps = sim.players.get(id);
      const pl = room.players.get(id);
      let flags = 0;
      if (pl && pl.left) flags |= 64;
      if (ps.dead) flags |= 2048;
      if (ps.attackUntil > now) flags |= 4096;
      if (ps.hurtUntil > now) flags |= 8192;
      if (ps.invulnUntil > now && now >= sim.airUntil) flags |= 16384;
      if (ps.reloadUntil > now) flags |= 32768;
      if (now < sim.airUntil) flags |= 131072;
      if (!ps.dead && now >= sim.airUntil && Math.hypot(ps.x - zone.x, ps.y - zone.y) > zone.r) flags |= 65536;
      const w = WEAPONS[ps.weapon];
      const ammo = w && !w.melee ? ps.ammo[w.ammoKey] : -1;
      const magNow = w && !w.melee ? Math.min(ps.mag[ps.weapon] === undefined ? Math.min(w.mag, ps.ammo[w.ammoKey]) : ps.mag[ps.weapon], ps.ammo[w.ammoKey]) : -1;
      let owned = 0;
      WEAPON_BY_CODE.forEach((k, code) => {
        const wk = WEAPONS[k];
        if (ps.weapons[k] && (wk.melee || ps.ammo[wk.ammoKey] > 0)) owned |= 1 << code;
      });
      // same layout as City Chaos; cash = kills, mission = place once out
      return [ps.idx, Math.round(ps.x), Math.round(ps.y), Math.round(ps.ang * 100), flags, ps.place || 0, ps.kills, w ? w.code : 0, Math.max(0, Math.round(ps.hp)), Math.round(ps.armor), 0, 0, 0, 0, ammo, ps.kills, 0, owned, magNow];
    }),
    n: [],
    c: [],
    gd: [],
    cp: [],
    pk: sim.pickups.map((k) => [k.id, Math.round(k.x), Math.round(k.y), PICKUP_CODE[k.type], k.value]),
    g: [],
    z: [Math.round(zone.x), Math.round(zone.y), Math.round(zone.r), Math.round(zone.nx), Math.round(zone.ny), Math.round(zone.nr), zone.s0, zone.s1, zone.ph, zone.dps],
    al: alive,
    endsAt: sim.endsAt,
  };
}

function tick(io, room) {
  const sim = room.city;
  if (!sim || room.state !== 'city' || sim.over) return;
  const now = Date.now();
  const dt = Math.min(0.1, (now - sim.lastTickAt) / 1000);
  sim.lastTickAt = now;
  sim.tick += 1;

  if (now >= sim.startsAt) {
    const zone = zoneAt(sim, now);
    const landed = now >= sim.airUntil;
    // supply drops fall into every new circle
    const phaseNow = now >= sim.zoneStart ? zone.ph + (zone.shrinking ? 1 : 0) : -1;
    if (landed && phaseNow > sim.dropsDone && phaseNow >= 1 && phaseNow < PHASES.length) {
      sim.dropsDone = phaseNow;
      const c = sim.circles[phaseNow];
      for (const [type, val] of [['sniper', 12], ['ar', 90], ['armor', 100], ['health', 100], ['ammo', 1]]) {
        const a = rnd(0, TAU);
        const d = Math.random() * c.r * 0.6;
        const [cx, cy] = nearestWalkable(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d);
        const pk = dropPickup(sim, type, cx * CELL + CELL / 2, cy * CELL + CELL / 2, val, 0);
        if (type === 'sniper') fx(io, room, { type: 'airdrop', x: pk.x, y: pk.y });
      }
      feed(io, room, '📦 Supply drop! Heavy weapons landed in the new circle');
    }
    if (zone.shrinking && !sim.warned) sim.warned = {};
    if (sim.warned && zone.shrinking && !sim.warned[zone.ph]) {
      sim.warned[zone.ph] = true;
      feed(io, room, '🌀 The storm is closing in!');
      fx(io, room, { type: 'zone', phase: zone.ph });
    }

    for (const [id, ps] of sim.players) {
      const p = room.players.get(id);
      if (p && p.left && !ps.dead) killPlayer(io, room, sim, id, ps, null, 'left', now);
      if (!p || p.left || ps.dead) continue;
      if (!p.isBot && !p.connected) ps.input = { dx: 0, dy: 0 };
      if (p.isBot) botThink(io, room, sim, id, ps, p, now);

      // walking (drifting under the parachute a little faster)
      const { dx, dy } = ps.input;
      if (dx || dy) {
        const len = Math.hypot(dx, dy) || 1;
        const sp = (landed ? BASE_SPEED : 210) * (ps.speedMul || 1);
        const vx = (dx / len) * sp * dt;
        const vy = (dy / len) * sp * dt;
        if (!collides(ps.x + vx, ps.y, PLAYER_R)) ps.x += vx;
        if (!collides(ps.x, ps.y + vy, PLAYER_R)) ps.y += vy;
        if (!p.isBot && ps.attackUntil < now && Math.hypot(dx, dy) > 0.15) ps.ang = Math.atan2(dy, dx);
      }
      if (!landed) continue;
      // storm damage
      if (Math.hypot(ps.x - zone.x, ps.y - zone.y) > zone.r) {
        ps.stormAcc = (ps.stormAcc || 0) + zone.dps * dt;
        if (ps.stormAcc >= 1) {
          const d = Math.floor(ps.stormAcc);
          ps.stormAcc -= d;
          damagePlayer(io, room, sim, id, ps, d, null, 'zone', now, true);
          if (ps.dead) continue;
        }
      }
      // loot underfoot
      for (let i = sim.pickups.length - 1; i >= 0; i--) {
        const pk = sim.pickups[i];
        if (Math.hypot(pk.x - ps.x, pk.y - ps.y) < 22 && givePickup(io, room, id, ps, pk)) sim.pickups.splice(i, 1);
      }
    }
    sim.pickups = sim.pickups.filter((k) => !k.expires || k.expires > now);

    // the end
    const alive = aliveList(sim);
    const humansAlive = alive.filter(([id]) => {
      const p = room.players.get(id);
      return p && !p.isBot && !p.left && p.connected;
    });
    if (!humansAlive.length) {
      if (!sim.noHumansSince) sim.noHumansSince = now;
    } else sim.noHumansSince = null;
    if (landed && (alive.length <= 1 || (sim.noHumansSince && now - sim.noHumansSince > NO_HUMANS_END_MS) || now >= sim.endsAt)) {
      finishRoyale(io, room);
      return;
    }
  }
  if (sim.tick % SNAPSHOT_EVERY === 0) io.to(room.code).emit(EVENTS.CITY_STATE, snapshot(room));
}

function finishRoyale(io, room) {
  const sim = room.city;
  if (!sim || sim.over) return;
  sim.over = true;
  clearInterval(room.timers.cityTick);
  room.timers.cityTick = null;
  const entries = [...sim.players.entries()];
  const alive = entries.filter(([, ps]) => !ps.dead).sort((a, b) => b[1].kills - a[1].kills || b[1].hp - a[1].hp);
  alive.forEach(([, ps], i) => {
    ps.place = i + 1;
  });
  const total = entries.length;
  for (const [id, ps] of entries) {
    const p = room.players.get(id);
    if (!p) continue;
    p.score = (PLACE_BONUS[ps.place - 1] || 60) + ps.kills * 100;
    ps.score = p.score;
  }
  room.state = 'final';
  const board = serializePlayers(room);
  const nameOfId = (id) => room.players.get(id).name;
  const awards = [];
  const winner = entries.find(([, ps]) => ps.place === 1);
  if (winner) awards.push({ key: 'win', icon: '🏆', title: 'Winner Winner', playerId: winner[0], name: nameOfId(winner[0]), detail: 'last one standing' });
  const frag = entries.slice().sort((a, b) => b[1].kills - a[1].kills)[0];
  if (frag && frag[1].kills > 0) awards.push({ key: 'kills', icon: '🔫', title: 'Top Fragger', playerId: frag[0], name: nameOfId(frag[0]), detail: `${frag[1].kills} elimination${frag[1].kills > 1 ? 's' : ''}` });
  const dmg = entries.slice().sort((a, b) => b[1].damage - a[1].damage)[0];
  if (dmg && dmg[1].damage > 0) awards.push({ key: 'damage', icon: '💥', title: 'Most Damage', playerId: dmg[0], name: nameOfId(dmg[0]), detail: `${dmg[1].damage} damage dealt` });
  const first = entries.find(([, ps]) => ps.place === total);
  if (first && total > 2 && first[1].place !== 1) awards.push({ key: 'early', icon: '🪂', title: 'Rough Landing', playerId: first[0], name: nameOfId(first[0]), detail: 'first one out' });
  room.awards = awards.slice(0, 4);
  const stats = {};
  for (const [id, ps] of entries) stats[id] = { kills: ps.kills, deaths: ps.dead ? 1 : 0, place: ps.place, damage: ps.damage, missions: 0, accidents: 0 };
  io.to(room.code).emit(EVENTS.GAME_FINAL, { mode: 'royale', leaderboard: board, podium: board.slice(0, 3), awards: room.awards, stats, total });
  db.saveGameResult({ roomCode: room.code, category: 'royale', categoryLabel: '🪂 City Royale', levelKey: null, levelLabel: null, subject: null, players: board });
}

/* ---------------------------------------------------- inputs from clients */

function playerOf(room, id) {
  const sim = room.city;
  if (!sim || room.state !== 'city') return null;
  return sim.players.get(id) || null;
}

function setInput(room, playerId, dx, dy) {
  const ps = playerOf(room, playerId);
  if (!ps || ps.dead) return;
  const x = Number(dx);
  const y = Number(dy);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const len = Math.hypot(x, y);
  ps.input = len > 1 ? { dx: x / len, dy: y / len } : { dx: x, dy: y };
}

function attack(io, room, playerId, ang) {
  const ps = playerOf(room, playerId);
  if (!ps) return;
  if (typeof ang === 'number' && Number.isFinite(ang)) ps.ang = ang;
  attackNow(io, room, playerId, ps, Date.now(), null);
}

function use() {
  // no cars in the royale (yet): F does nothing
}

function selectWeapon(room, playerId, code) {
  const ps = playerOf(room, playerId);
  if (!ps || ps.dead) return;
  const key = WEAPON_BY_CODE[Number(code)];
  if (!key || !ps.weapons[key]) return;
  if (WEAPONS[key].ammoKey && ps.ammo[WEAPONS[key].ammoKey] <= 0) return;
  if (ps.reloadKey && ps.reloadKey !== key) {
    ps.reloadUntil = 0;
    ps.reloadKey = '';
  }
  ps.weapon = key;
}

function reload(room, playerId) {
  const ps = playerOf(room, playerId);
  if (!ps || ps.dead) return;
  startReload(ps, ps.weapon, Date.now());
}

function shout() {}

function stopRoyale(room) {
  if (room.timers && room.timers.cityTick) {
    clearInterval(room.timers.cityTick);
    room.timers.cityTick = null;
  }
  room.city = null;
}

module.exports = { startRoyale, initPayload, setInput, attack, use, selectWeapon, reload, shout, stopRoyale, finishRoyale };
