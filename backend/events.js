// Shared Socket.IO event-name constants. Mirrored verbatim in frontend/events.js
// (no bundler here, so the two copies must be kept in sync by hand).
const EVENTS = {
  // client -> server
  ROOM_CREATE: 'room:create',
  ROOM_JOIN: 'room:join',
  GAME_START: 'game:start',
  GAME_PLAY_AGAIN: 'game:play_again',
  BOT_ADD: 'bot:add',
  BOT_REMOVE: 'bot:remove',
  ROOM_LEAVE: 'room:leave',
  CITY_INPUT: 'city:input',
  CITY_ATTACK: 'city:attack',
  CITY_USE: 'city:use',
  CITY_WEAPON: 'city:weapon',
  CITY_RELOAD: 'city:reload',
  CITY_SHOUT: 'city:shout',
  VOICE_JOIN: 'voice:join',
  VOICE_LEAVE: 'voice:leave',
  VOICE_SIGNAL: 'voice:signal',

  // server -> client
  ROOM_JOINED: 'room:joined',
  ROOM_ERROR: 'room:error',
  PLAYER_LIST_UPDATE: 'player:list_update',
  GAME_FINAL: 'game:final',
  GAME_RESET_TO_LOBBY: 'game:reset_to_lobby',
  CITY_START: 'city:start',
  CITY_STATE: 'city:state',
  CITY_FX: 'city:fx',
  CITY_FEED: 'city:feed',
  BOT_SAY: 'bot:say',
  VOICE_PEERS: 'voice:peers',
  VOICE_JOINED: 'voice:joined',
  VOICE_LEFT: 'voice:left',
  VOICE_SIGNAL_IN: 'voice:signal_in',
};

module.exports = EVENTS;
