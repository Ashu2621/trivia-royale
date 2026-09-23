// Shared Socket.IO event-name constants. Mirrored verbatim in frontend/events.js
// (no bundler here, so the two copies must be kept in sync by hand).
const EVENTS = {
  // client -> server
  ROOM_CREATE: 'room:create',
  ROOM_JOIN: 'room:join',
  GAME_START: 'game:start',
  ANSWER_SUBMIT: 'answer:submit',
  STEAL_CHOOSE: 'steal:choose',
  FREEZE_CHOOSE: 'freeze:choose',
  GAME_PLAY_AGAIN: 'game:play_again',
  BOT_ADD: 'bot:add',
  BOT_REMOVE: 'bot:remove',
  QUESTIONS_GENERATE: 'questions:generate',
  QUESTION_ADD: 'question:add',
  QUESTION_REMOVE: 'question:remove',
  LIFELINE_USE: 'lifeline:use',

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
  FREEZE_PROMPT: 'freeze:prompt',
  FREEZE_WAITING: 'freeze:waiting',
  FREEZE_RESULT: 'freeze:result',
  GAME_FINAL: 'game:final',
  GAME_RESET_TO_LOBBY: 'game:reset_to_lobby',
  QUESTIONS_GENERATING: 'questions:generating',
  QUESTION_POOL_UPDATE: 'question:pool_update',
  GAME_STARTING: 'game:starting',
  LIFELINE_RESULT: 'lifeline:result',
  ANSWER_PROGRESS: 'answer:progress',
};

module.exports = EVENTS;
