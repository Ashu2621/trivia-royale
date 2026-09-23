const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const rooms = require('./rooms');
const socketHandlers = require('./socketHandlers');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => socketHandlers.register(io, socket));

rooms.startCleanupSweep();

server.listen(PORT, () => {
  console.log(`Trivia Royale listening on port ${PORT}`);
});
