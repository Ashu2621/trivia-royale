const mongoose = require('mongoose');

let enabled = false;

const gameResultSchema = new mongoose.Schema({
  roomCode: String,
  category: { type: String, index: true },
  categoryLabel: String,
  levelKey: { type: String, index: true, default: null },
  levelLabel: { type: String, default: null },
  subject: { type: String, index: true, default: null },
  playedAt: { type: Date, default: Date.now, index: true },
  players: [{ name: String, avatar: String, score: Number, isBot: Boolean }],
  topScore: { type: Number, index: true },
  topPlayerName: String,
  topPlayerAvatar: String,
});

const GameResult = mongoose.model('GameResult', gameResultSchema);

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('MONGODB_URI not set — the Hall of Fame leaderboard is disabled.');
    return;
  }
  try {
    await mongoose.connect(uri);
    enabled = true;
    console.log('Connected to MongoDB — Hall of Fame leaderboard enabled.');
  } catch (err) {
    console.error('MongoDB connection failed — Hall of Fame leaderboard disabled:', err.message);
  }
}

function isEnabled() {
  return enabled;
}

async function saveGameResult({ roomCode, category, categoryLabel, levelKey, levelLabel, subject, players, top: topOverride }) {
  if (!enabled) return;
  const top = topOverride || players[0]; // callers pass the final ranking, survivors first
  if (!top || top.score <= 0) return;
  try {
    await GameResult.create({
      roomCode,
      category,
      categoryLabel,
      levelKey: levelKey || null,
      levelLabel: levelLabel || null,
      subject: subject || null,
      players: players.map((p) => ({ name: p.name, avatar: p.avatar, score: p.score, isBot: !!p.isBot })),
      topScore: top.score,
      topPlayerName: top.name,
      topPlayerAvatar: top.avatar,
    });
  } catch (err) {
    console.error('Failed to save game result:', err.message);
  }
}

function periodSince(period) {
  const now = new Date();
  if (period === 'today') {
    // start of the current day in India time (UTC+5:30)
    const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3600 * 1000);
  }
  if (period === 'week') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === 'year') return new Date(now.getFullYear(), 0, 1);
  return null;
}

async function getTopScores({ limit = 20, period = 'all', category = null, subject = null } = {}) {
  if (!enabled) return [];
  try {
    const query = {};
    if (category) query.category = category;
    if (subject) query.subject = subject;
    const since = periodSince(period);
    if (since) query.playedAt = { $gte: since };

    const docs = await GameResult.find(query).sort({ topScore: -1 }).limit(limit).lean();
    return docs.map((d) => ({
      name: d.topPlayerName,
      avatar: d.topPlayerAvatar,
      score: d.topScore,
      category: d.categoryLabel,
      categoryKey: d.category,
      subject: d.subject,
      levelLabel: d.levelLabel,
      playedAt: d.playedAt,
    }));
  } catch (err) {
    console.error('Failed to fetch leaderboard:', err.message);
    return [];
  }
}

async function getSubjectsForCategory(category) {
  if (!enabled || !category) return [];
  try {
    const subjects = await GameResult.distinct('subject', { category, subject: { $ne: null } });
    return subjects.sort();
  } catch (err) {
    console.error('Failed to fetch leaderboard subjects:', err.message);
    return [];
  }
}

module.exports = { connect, isEnabled, saveGameResult, getTopScores, getSubjectsForCategory };
