// Short in-character lines computer players say during a match. Each level has
// its own personality (shy rookie … cocky legend), with a little Hinglish mixed in.
const LINES = {
  rookie: {
    lock: ['Umm… B? 🤞', 'Bhagwan bharose 🙏', 'Guessing!', 'Pata nahi yaar 😅'],
    right: ['Wait, sahi ho gaya?! 😲', 'Lucky! 🍀'],
    wrong: ['Oops… 😬', 'Galat gaya 🙈', 'Mera dimaag hang 🤯'],
    out: ['Meri toh lag gayi 😭', 'GG guys, mazaa aaya!'],
    steal: ['Sorry not sorry 🙈'],
    win: ['Main jeet gaya?! 😲🎉'],
  },
  veteran: {
    lock: ['Locked.', 'Pakka yehi hai.', 'Easy one.', 'Done ✅'],
    right: ['Nice ✅', 'Yeh toh aata tha 😌'],
    wrong: ['Hmm, close.', 'Next one!', 'Arre yaar 😤'],
    out: ['Well played all. 👏', 'Aaj nahi, kal sahi.'],
    steal: ['Points mine 😎'],
    win: ['GG! Solid game 🏆'],
  },
  elite: {
    lock: ['Too easy 😎', 'Next!', 'Lock kar diya 🔒', 'Yeh toh gift tha'],
    right: ['Boom! 💥', 'Bilkul sahi 😏', 'Streak on 🔥'],
    wrong: ['Glitch in the matrix 🤨', 'Yeh kaise hua?!'],
    out: ['Impossible… 😳', 'Rematch? 🔁'],
    steal: ['Thanks for the points 💰', 'Chori chori chupke chupke 😈'],
    win: ['Too easy 😎 GG', 'Champion yahin hai 👑'],
  },
  legend: {
    lock: ['Already know it.', 'Wake me when it’s hard 😴', 'GG in advance.', 'Ek second bhi nahi laga'],
    right: ['Predictable. 😏', 'Expected. ✅', 'Sab kuch pata hai 🧠'],
    wrong: ['…Not possible. 😳'],
    out: ['I was robbed. 😤'],
    steal: ['Your points are mine now 😈'],
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
