// Computer players. Each tier has its own accuracy and reaction-time profile,
// and every decision (when to answer, right or wrong, who to steal from) is
// made per question rather than from one flat coin-flip, so bots feel like
// distinct opponents instead of a random-number generator.

const BOT_TIERS = {
  rookie: { key: 'rookie', label: 'Rookie', emoji: '🍬', accuracy: 0.45, fastest: 3200, slowest: 11000, powerUse: 0.55 },
  veteran: { key: 'veteran', label: 'Veteran', emoji: '⚔️', accuracy: 0.7, fastest: 2000, slowest: 8500, powerUse: 0.85 },
  elite: { key: 'elite', label: 'Elite', emoji: '🔥', accuracy: 0.88, fastest: 1200, slowest: 5500, powerUse: 1 },
  legend: { key: 'legend', label: 'Legend', emoji: '👑', accuracy: 0.97, fastest: 700, slowest: 3300, powerUse: 1 },
};
const DEFAULT_TIER = 'veteran';

function getTier(key) {
  return BOT_TIERS[key] || BOT_TIERS[DEFAULT_TIER];
}

function listTiers() {
  return Object.values(BOT_TIERS).map(({ key, label, emoji }) => ({ key, label, emoji }));
}

function randomWrongIndex(correctIndex, exclude = []) {
  const options = [0, 1, 2, 3].filter((i) => i !== correctIndex && !exclude.includes(i));
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Plan one bot's answer for a question.
 * - Longer questions take longer to read, so reaction time scales with text length.
 * - Reaction time is skewed toward the fast end of the tier's range (rand^1.7),
 *   with occasional slow "second-guessing" outliers, like a real player.
 * - Accuracy dips a little on long/hard-looking questions and on a losing streak
 *   of confidence; stronger tiers barely dip.
 */
function planAnswer(tierKey, question, durationMs, botState) {
  const tier = getTier(tierKey);
  const textLength = (question.text || '').length + question.choices.reduce((n, c) => n + c.length, 0);
  const readFactor = Math.min(1, textLength / 260); // 0 (short) .. 1 (long)

  const span = tier.slowest - tier.fastest;
  let delay = tier.fastest + span * Math.pow(Math.random(), 1.7) * (0.55 + 0.45 * readFactor);
  if (Math.random() < 0.08) delay += span * 0.35; // occasional hesitation
  delay = Math.max(600, Math.min(durationMs - 900, delay));

  const difficultyPenalty = (1 - tier.accuracy) * readFactor * 0.5;
  const momentum = botState && botState.streak >= 2 ? 0.02 : 0;
  const chance = Math.max(0.15, Math.min(0.99, tier.accuracy - difficultyPenalty + momentum));
  const correct = Math.random() < chance;

  return {
    delay,
    choiceIndex: correct ? question.correctIndex : randomWrongIndex(question.correctIndex),
  };
}

/**
 * Pick a steal/freeze target. Prefer whoever is winning (that is where steals
 * hurt most and freezes matter most); a steal is skipped when nobody has points
 * worth taking, and weaker tiers sometimes just don't use the power.
 */
function chooseTarget(tierKey, type, opponents) {
  const tier = getTier(tierKey);
  if (!opponents.length) return null;
  if (Math.random() > tier.powerUse) return null;

  const ranked = opponents.slice().sort((a, b) => b.score - a.score);
  if (type === 'steal') {
    const worthTaking = ranked.find((o) => o.score > 0);
    return worthTaking ? worthTaking.playerId : null;
  }
  return ranked[0].playerId;
}

function decisionDelay(tierKey) {
  const tier = getTier(tierKey);
  const min = 900 + (tier.fastest / 10);
  return min + Math.random() * 1800;
}

module.exports = { BOT_TIERS, DEFAULT_TIER, getTier, listTiers, planAnswer, chooseTarget, decisionDelay, randomWrongIndex };
