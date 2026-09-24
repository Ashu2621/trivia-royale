const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const rooms = require('./rooms');
const socketHandlers = require('./socketHandlers');
const db = require('./db');
const bots = require('./bots');

const PORT = process.env.PORT || 3000;

const app = express();
app.get('/api/meta', (req, res) => {
  res.json({ avatars: rooms.AVATARS, botTiers: bots.listTiers() });
});
const VALID_PERIODS = new Set(['all', 'today', 'week', 'month', 'year']);

app.get('/api/leaderboard', async (req, res) => {
  const period = VALID_PERIODS.has(req.query.period) ? req.query.period : 'all';
  const scores = await db.getTopScores({ limit: 20, period });
  res.json({ enabled: db.isEnabled(), scores });
});
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => socketHandlers.register(io, socket));

rooms.startCleanupSweep();
db.connect();

server.listen(PORT, () => {
  console.log(`City Chaos listening on port ${PORT}`);
});
