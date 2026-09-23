const MIN_SCORE = 200;
const MAX_BONUS = 800;

/**
 * @param {number} answeredAt ms timestamp the server received the answer
 * @param {number} questionStartedAt ms timestamp the question started
 * @param {number} durationMs total time allowed for the question
 * @param {boolean} isCorrect
 * @returns {number}
 */
function calculateScore(answeredAt, questionStartedAt, durationMs, isCorrect) {
  if (!isCorrect) return 0;
  const timeUsed = Math.max(0, Math.min(durationMs, answeredAt - questionStartedAt));
  const fraction = 1 - timeUsed / durationMs;
  return Math.round(MIN_SCORE + MAX_BONUS * fraction);
}

module.exports = { calculateScore, MIN_SCORE, MAX_BONUS };
