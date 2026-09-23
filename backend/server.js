const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const rooms = require('./rooms');
const socketHandlers = require('./socketHandlers');
const db = require('./db');
const ai = require('./ai');
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
  });
});
app.get('/api/leaderboard', async (req, res) => {
  const scores = await db.getTopScores(20);
  res.json({ enabled: db.isEnabled(), scores });
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
