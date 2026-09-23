const mongoose = require('mongoose');

let enabled = false;

const gameResultSchema = new mongoose.Schema({
  roomCode: String,
  category: String,
  categoryLabel: String,
  playedAt: { type: Date, default: Date.now },
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

async function saveGameResult({ roomCode, category, categoryLabel, players }) {
  if (!enabled) return;
  const top = players.slice().sort((a, b) => b.score - a.score)[0];
  if (!top || top.score <= 0) return;
  try {
    await GameResult.create({
      roomCode,
      category,
      categoryLabel,
      players: players.map((p) => ({ name: p.name, avatar: p.avatar, score: p.score, isBot: !!p.isBot })),
      topScore: top.score,
      topPlayerName: top.name,
      topPlayerAvatar: top.avatar,
    });
  } catch (err) {
    console.error('Failed to save game result:', err.message);
  }
}

async function getTopScores(limit = 20) {
  if (!enabled) return [];
  try {
    const docs = await GameResult.find().sort({ topScore: -1 }).limit(limit).lean();
    return docs.map((d) => ({
      name: d.topPlayerName,
      avatar: d.topPlayerAvatar,
      score: d.topScore,
      category: d.categoryLabel,
      playedAt: d.playedAt,
    }));
  } catch (err) {
    console.error('Failed to fetch leaderboard:', err.message);
    return [];
  }
}

module.exports = { connect, isEnabled, saveGameResult, getTopScores };
