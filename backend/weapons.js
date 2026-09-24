// Shared weapon table + gunplay rules (magazines, reloading, heat/recoil) for City Chaos and Battle Royale.
const WEAPONS = {
  fists: { code: 0, melee: true, dmg: 14, range: 42, cd: 420, cone: 1.2, label: 'Fists' },
  bat: { code: 1, melee: true, dmg: 32, range: 58, cd: 720, cone: 1.5, label: 'Bat' },
  pistol: { code: 2, dmg: 17, range: 520, cd: 380, spread: 0.03, ammoKey: 'pistol', label: 'Pistol', mag: 12, reload: 1300, heat: 0.14 },
  smg: { code: 3, dmg: 9, range: 460, cd: 110, spread: 0.09, ammoKey: 'smg', label: 'SMG', mag: 30, reload: 1800, heat: 0.1 },
  shotgun: { code: 4, dmg: 11, pellets: 6, range: 250, cd: 900, spread: 0.24, ammoKey: 'shotgun', label: 'Shotgun', mag: 6, reload: 2300, heat: 0.3 },
  ar: { code: 5, dmg: 19, range: 640, cd: 125, spread: 0.04, ammoKey: 'ar', label: 'Assault Rifle', mag: 30, reload: 2000, heat: 0.09 },
  sniper: { code: 6, dmg: 78, range: 1300, cd: 1400, spread: 0.004, ammoKey: 'sniper', label: 'Sniper', mag: 5, reload: 2700, heat: 0.9 },
};
const WEAPON_BY_CODE = ['fists', 'bat', 'pistol', 'smg', 'shotgun', 'ar', 'sniper'];
const AMMO_CAP = { pistol: 120, smg: 300, shotgun: 48, ar: 240, sniper: 30 };
const GUN_KEYS = ['pistol', 'smg', 'shotgun', 'ar', 'sniper'];
const HEAT_DECAY_PER_S = 1.5;

const emptyAmmo = () => ({ pistol: 0, smg: 0, shotgun: 0, ar: 0, sniper: 0 });
const emptyWeapons = () => ({ fists: true, bat: false, pistol: false, smg: false, shotgun: false, ar: false, sniper: false });

function refill(ps, key) {
  const w = WEAPONS[key];
  ps.mag = ps.mag || {};
  ps.mag[key] = Math.min(w.mag, ps.ammo[key] || 0);
}

// can this gun fire right now? (also finishes a reload that has run its course)
function gunGate(ps, key, now) {
  const w = WEAPONS[key];
  ps.mag = ps.mag || {};
  if (ps.reloadUntil && now >= ps.reloadUntil) {
    if (ps.reloadKey) refill(ps, ps.reloadKey);
    ps.reloadUntil = 0;
    ps.reloadKey = '';
  }
  if (ps.reloadUntil > now) return false;
  if (ps.mag[key] === undefined) refill(ps, key);
  if (ps.mag[key] > ps.ammo[key]) ps.mag[key] = ps.ammo[key];
  if (ps.mag[key] <= 0) {
    startReload(ps, key, now);
    return false;
  }
  void w;
  return true;
}

function startReload(ps, key, now) {
  const w = WEAPONS[key];
  if (!w || w.melee || ps.reloadUntil > now) return false;
  ps.mag = ps.mag || {};
  if (ps.mag[key] === undefined) refill(ps, key);
  if (ps.mag[key] >= w.mag || ps.ammo[key] <= ps.mag[key]) return false;
  ps.reloadKey = key;
  ps.reloadUntil = now + w.reload;
  return true;
}

function currentHeat(ps, now) {
  return Math.max(0, (ps.heat || 0) - ((now - (ps.heatAt || now)) / 1000) * HEAT_DECAY_PER_S);
}

function spreadFor(ps, w, now, moving) {
  return (w.spread || 0) * (1 + currentHeat(ps, now) * 1.6 + (moving ? 0.6 : 0));
}

function afterShot(ps, key, now) {
  const w = WEAPONS[key];
  ps.ammo[key] -= 1;
  ps.mag[key] = Math.max(0, (ps.mag[key] || 0) - 1);
  ps.heat = Math.min(1.2, currentHeat(ps, now) + (w.heat || 0.1));
  ps.heatAt = now;
  if (ps.mag[key] <= 0) startReload(ps, key, now + 200);
}

module.exports = { WEAPONS, WEAPON_BY_CODE, AMMO_CAP, GUN_KEYS, emptyAmmo, emptyWeapons, gunGate, startReload, spreadFor, afterShot, currentHeat, refill };
