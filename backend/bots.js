// Computer players. Each tier fights, shoots and runs missions differently:
// accuracy (how close their shots land), aggression (how eagerly they pick fights),
// reaction (how long they take to shoot once someone is in range) and speed.

const BOT_TIERS = {
  rookie: { key: 'rookie', label: 'Rookie', emoji: '🍬', accuracy: 0.32, aggression: 0.45, reaction: 700, speed: 0.72, sight: 220 },
  veteran: { key: 'veteran', label: 'Veteran', emoji: '⚔️', accuracy: 0.5, aggression: 0.65, reaction: 480, speed: 0.82, sight: 260 },
  elite: { key: 'elite', label: 'Elite', emoji: '🔥', accuracy: 0.7, aggression: 0.85, reaction: 300, speed: 0.92, sight: 300 },
  legend: { key: 'legend', label: 'Legend', emoji: '👑', accuracy: 0.86, aggression: 1, reaction: 160, speed: 0.98, sight: 340 },
};
const DEFAULT_TIER = 'veteran';

function getTier(key) {
  return BOT_TIERS[key] || BOT_TIERS[DEFAULT_TIER];
}

function listTiers() {
  return Object.values(BOT_TIERS).map(({ key, label, emoji }) => ({ key, label, emoji }));
}

module.exports = { BOT_TIERS, DEFAULT_TIER, getTier, listTiers };
