// Tracks recently AI-generated question texts per (level, subject) combo, in
// memory only, so a room generating questions for a level/subject someone
// already used can be told to avoid repeating them. Resets on server restart.
const MAX_HISTORY_PER_KEY = 40;
const MAX_KEYS = 200; // cap total tracked combos so this can't grow unbounded

const history = new Map(); // "levelKey::subject" -> string[]

function keyFor(levelKey, subject) {
  return `${levelKey || ''}::${String(subject || '').trim().toLowerCase()}`;
}

function getRecent(levelKey, subject) {
  return history.get(keyFor(levelKey, subject)) || [];
}

function recordUsed(levelKey, subject, texts) {
  if (!texts || !texts.length) return;
  const k = keyFor(levelKey, subject);
  if (!history.has(k) && history.size >= MAX_KEYS) {
    // Evict the oldest tracked combo (Map preserves insertion order).
    const oldestKey = history.keys().next().value;
    history.delete(oldestKey);
  }
  const existing = history.get(k) || [];
  history.set(k, [...existing, ...texts].slice(-MAX_HISTORY_PER_KEY));
}

module.exports = { getRecent, recordUsed };
