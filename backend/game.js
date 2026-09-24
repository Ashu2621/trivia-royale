// Match lifecycle for the room: start, back to the lobby, and someone pressing Back.
const EVENTS = require('./events');
const rooms = require('./rooms');
const city = require('./city');
const royale = require('./royale');

const { serializePlayers, clearRoomTimers } = rooms;

function emitToRoom(io, room, event, payload) {
  io.to(room.code).emit(event, payload);
}

function startGame(io, room, mode) {
  if (room.state !== 'lobby') return;
  clearRoomTimers(room);
  room.mode = mode === 'royale' ? 'royale' : 'city';
  if (room.mode === 'royale') royale.startRoyale(io, room);
  else city.startCity(io, room);
}

function resetToLobby(io, room) {
  if (room.state !== 'final') return;
  clearRoomTimers(room);
  for (const [id, p] of [...room.players.entries()]) {
    if (p.left) {
      room.players.delete(id); // someone who walked out mid-match doesn't come back
      continue;
    }
    p.score = 0;
  }
  city.stopCity(room);
  room.mode = null;
  room.state = 'lobby';
  emitToRoom(io, room, EVENTS.GAME_RESET_TO_LOBBY, { players: serializePlayers(room) });
}

// The Back button. In the lobby or on the results screen the player simply leaves;
// mid-match they drop out and the match carries on without them.
function handleLeave(io, room, player) {
  if (room.state === 'lobby' || room.state === 'final') {
    rooms.leaveIdleRoom(room, player.playerId);
    if (rooms.getRoom(room.code)) emitToRoom(io, room, EVENTS.PLAYER_LIST_UPDATE, { players: serializePlayers(room) });
    return;
  }
  player.left = true;
  rooms.markDisconnected(room, player.playerId);
  rooms.promoteNextHostIfNeeded(room, player.playerId);
  emitToRoom(io, room, EVENTS.PLAYER_LIST_UPDATE, { players: serializePlayers(room) });
  // the city simulation notices the player has left
}

module.exports = { startGame, resetToLobby, handleLeave };
