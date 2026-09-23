const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const rooms = require('./rooms');
const socketHandlers = require('./socketHandlers');
const db = require('./db');
const ai = require('./ai');
const bots = require('./bots');
const { getCategoryList } = require('./questions');
const { getLevelList } = require('./levels');

const PORT = process.env.PORT || 3000;

const app = express();
app.get('/api/meta', (req, res) => {
  res.json({
    categories: getCategoryList(),
    avatars: rooms.AVATARS,
    levels: getLevelList(),
    aiEnabled: ai.isEnabled(),
    botTiers: bots.listTiers(),
  });
});
const VALID_PERIODS = new Set(['all', 'week', 'month', 'year']);

app.get('/api/leaderboard', async (req, res) => {
  const period = VALID_PERIODS.has(req.query.period) ? req.query.period : 'all';
  const category = typeof req.query.category === 'string' && req.query.category ? req.query.category : null;
  const subject = typeof req.query.subject === 'string' && req.query.subject ? req.query.subject : null;
  const scores = await db.getTopScores({ limit: 20, period, category, subject });
  res.json({ enabled: db.isEnabled(), scores });
});
app.get('/api/leaderboard/subjects', async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : null;
  const subjects = await db.getSubjectsForCategory(category);
  res.json({ subjects });
});
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => socketHandlers.register(io, socket));

rooms.startCleanupSweep();
db.connect();

server.listen(PORT, () => {
  console.log(`Trivia Royale listening on port ${PORT}`);
});
