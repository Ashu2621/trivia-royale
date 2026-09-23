// Shared Socket.IO event-name constants. Mirrored verbatim in public/events.js
// (no bundler here, so the two copies must be kept in sync by hand).
const EVENTS = {
  // client -> server
  ROOM_CREATE: 'room:create',
  ROOM_JOIN: 'room:join',
  GAME_START: 'game:start',
  ANSWER_SUBMIT: 'answer:submit',
  STEAL_CHOOSE: 'steal:choose',
  GAME_PLAY_AGAIN: 'game:play_again',

  // server -> client
  ROOM_JOINED: 'room:joined',
  ROOM_ERROR: 'room:error',
  PLAYER_LIST_UPDATE: 'player:list_update',
  QUESTION_START: 'question:start',
  ANSWER_ACK: 'answer:ack',
  QUESTION_REVEAL: 'question:reveal',
  STEAL_PROMPT: 'steal:prompt',
  STEAL_WAITING: 'steal:waiting',
  STEAL_RESULT: 'steal:result',
  GAME_FINAL: 'game:final',
  GAME_RESET_TO_LOBBY: 'game:reset_to_lobby',
};

module.exports = EVENTS;
