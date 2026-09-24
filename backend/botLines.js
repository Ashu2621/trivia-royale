// Short in-character lines computer players shout during a match. Each level has its own
// personality (nervous rookie … cocky legend), with a little Hinglish mixed in.
const LINES = {
  rookie: {
    taunt: ['Please mat maro 🙏', 'Main bas yahan se guzar raha tha 😅', 'Sorry sorry! 🙈'],
    kill: ['Wait, maine maar diya?! 😲', 'Lucky shot 🍀'],
    die: ['Meri toh lag gayi 😭', 'Aaj ka din hi kharab hai 🙈'],
    hurt: ['Aww! 😬', 'Ouch ouch ouch'],
    accident: ['Bahut zor se lagi thi 😭', 'Oops… 😬'],
    relief: ['Aaahhh 😌', 'Ab jaake sukoon aaya'],
    win: ['Main jeet gaya?! 😲🎉'],
  },
  veteran: {
    taunt: ['Come on then.', 'Aa jao, dekhte hain 😤', 'Try me.'],
    kill: ['Down. ✅', 'Ek aur 😌', 'Next!'],
    die: ['I\'ll be back.', 'Arre yaar 😤'],
    hurt: ['Not bad.', 'Hmm, that stung.'],
    accident: ['Not my proudest moment.', 'Arre yaar 😤'],
    relief: ['Much better 😌', 'Phew.'],
    win: ['GG! Solid game 🏆'],
  },
  elite: {
    taunt: ['Too easy 😎', 'Line mein lag jao 😏', 'You\'re in my zone.'],
    kill: ['Boom! 💥', 'Bilkul sahi 😏', 'Headshot 🔥'],
    die: ['Impossible… 😳', 'Rematch? 🔁'],
    hurt: ['Glitch in the matrix 🤨', 'Lucky.'],
    accident: ['Nobody saw that. 😐', 'Yeh mat likhna leaderboard pe'],
    relief: ['Elite bladder restored 😎'],
    win: ['Too easy 😎 GG', 'Champion yahin hai 👑'],
  },
  legend: {
    taunt: ['Legends don\'t run.', 'Sab kuch pata hai 🧠', 'Wake me when it\'s hard 😴'],
    kill: ['Predictable. 😏', 'Expected. ✅', 'GG EZ'],
    die: ['I was robbed. 😤', 'Lag. Definitely lag.'],
    hurt: ['Impressive. For a rookie.'],
    accident: ['This never happened. 😐'],
    relief: ['Balance restored. 😌'],
    win: ['GG EZ 👑', 'Legends never lose 🔥'],
  },
};

function pickLine(tier, kind) {
  const set = LINES[tier] || LINES.veteran;
  const list = set[kind];
  if (!list || !list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

module.exports = { pickLine };
