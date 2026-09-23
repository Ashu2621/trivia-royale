const QUESTION_DURATION_MS = 15000;
const POWER_ROUND_INTERVAL = 3; // every 3rd question (1-indexed: 3, 6, 9, ...) is a power round

const CATEGORIES = {
  general: {
    label: 'General Knowledge',
    emoji: '🌍',
    questions: [
      { text: 'What planet is known as the Red Planet?', choices: ['Venus', 'Mars', 'Jupiter', 'Saturn'], correctIndex: 1 },
      { text: 'How many continents are there on Earth?', choices: ['5', '6', '7', '8'], correctIndex: 2 },
      { text: 'What is the largest ocean on Earth?', choices: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correctIndex: 3 },
      { text: 'Who painted the Mona Lisa?', choices: ['Van Gogh', 'Picasso', 'Da Vinci', 'Monet'], correctIndex: 2 },
      { text: 'What is the chemical symbol for gold?', choices: ['Ag', 'Au', 'Gd', 'Go'], correctIndex: 1 },
      { text: 'Which country invented pizza?', choices: ['France', 'Greece', 'Italy', 'Spain'], correctIndex: 2 },
      { text: 'How many legs does a spider have?', choices: ['6', '8', '10', '12'], correctIndex: 1 },
      { text: 'What is the smallest prime number?', choices: ['0', '1', '2', '3'], correctIndex: 2 },
      { text: 'Which gas do plants absorb from the atmosphere?', choices: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], correctIndex: 2 },
      { text: 'What is the capital of Japan?', choices: ['Seoul', 'Beijing', 'Tokyo', 'Bangkok'], correctIndex: 2 },
      { text: 'How many sides does a hexagon have?', choices: ['5', '6', '7', '8'], correctIndex: 1 },
      { text: 'What is the tallest mountain in the world?', choices: ['K2', 'Kilimanjaro', 'Everest', 'Denali'], correctIndex: 2 },
    ],
  },
  movies: {
    label: 'Movies & TV',
    emoji: '🎬',
    questions: [
      { text: 'Which movie features a magical ring that must be destroyed?', choices: ['Harry Potter', 'The Lord of the Rings', 'Narnia', 'Eragon'], correctIndex: 1 },
      { text: 'Who directed "Jaws" and "E.T."?', choices: ['James Cameron', 'George Lucas', 'Steven Spielberg', 'Martin Scorsese'], correctIndex: 2 },
      { text: 'In "The Wizard of Oz," what color are Dorothy\'s slippers?', choices: ['Red', 'Silver', 'Gold', 'Blue'], correctIndex: 0 },
      { text: 'Which show is set in the fictional town of Hawkins, Indiana?', choices: ['Riverdale', 'Stranger Things', 'Twin Peaks', 'Supernatural'], correctIndex: 1 },
      { text: 'What is the name of the coffee shop in "Friends"?', choices: ['Central Perk', 'Java Joe\'s', 'The Grind', 'Common Grounds'], correctIndex: 0 },
      { text: 'Which superhero is known as the "Dark Knight"?', choices: ['Superman', 'Batman', 'Iron Man', 'Green Arrow'], correctIndex: 1 },
      { text: 'What is the highest-grossing animated film of all time (as of 2024)?', choices: ['Frozen II', 'Inside Out 2', 'The Lion King (2019)', 'Toy Story 4'], correctIndex: 1 },
      { text: 'Which actor played Jack in "Titanic"?', choices: ['Brad Pitt', 'Matt Damon', 'Leonardo DiCaprio', 'Tom Cruise'], correctIndex: 2 },
      { text: 'What animal is Simba in "The Lion King"?', choices: ['Tiger', 'Lion', 'Leopard', 'Cheetah'], correctIndex: 1 },
      { text: 'Which streaming show follows a chess prodigy in the 1960s?', choices: ['The Crown', 'The Queen\'s Gambit', 'Mad Men', 'Bridgerton'], correctIndex: 1 },
      { text: 'Who plays Iron Man in the Marvel Cinematic Universe?', choices: ['Chris Evans', 'Chris Hemsworth', 'Robert Downey Jr.', 'Mark Ruffalo'], correctIndex: 2 },
      { text: 'What is the name of the ship in "Star Trek"?', choices: ['Enterprise', 'Voyager', 'Discovery', 'Defiant'], correctIndex: 0 },
    ],
  },
  science: {
    label: 'Science',
    emoji: '🔬',
    questions: [
      { text: 'What is the powerhouse of the cell?', choices: ['Nucleus', 'Ribosome', 'Mitochondria', 'Golgi body'], correctIndex: 2 },
      { text: 'What force keeps planets in orbit around the sun?', choices: ['Magnetism', 'Gravity', 'Friction', 'Inertia'], correctIndex: 1 },
      { text: 'What is the chemical formula for water?', choices: ['CO2', 'H2O', 'O2', 'NaCl'], correctIndex: 1 },
      { text: 'How many bones are in the adult human body?', choices: ['186', '206', '226', '246'], correctIndex: 1 },
      { text: 'What is the speed of light approximately?', choices: ['300,000 km/s', '150,000 km/s', '3,000 km/s', '30,000 km/s'], correctIndex: 0 },
      { text: 'Which planet has the most moons in our solar system?', choices: ['Jupiter', 'Saturn', 'Uranus', 'Neptune'], correctIndex: 1 },
      { text: 'What gas do humans exhale the most of?', choices: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'], correctIndex: 2 },
      { text: 'What is the study of earthquakes called?', choices: ['Geology', 'Seismology', 'Meteorology', 'Volcanology'], correctIndex: 1 },
      { text: 'What particle has a negative charge?', choices: ['Proton', 'Neutron', 'Electron', 'Photon'], correctIndex: 2 },
      { text: 'Which vitamin does sunlight help your body produce?', choices: ['Vitamin A', 'Vitamin C', 'Vitamin D', 'Vitamin K'], correctIndex: 2 },
      { text: 'What is the hardest natural substance on Earth?', choices: ['Gold', 'Iron', 'Diamond', 'Quartz'], correctIndex: 2 },
      { text: 'How many chambers does the human heart have?', choices: ['2', '3', '4', '5'], correctIndex: 2 },
    ],
  },
  sports: {
    label: 'Sports',
    emoji: '🏆',
    questions: [
      { text: 'How many players are on a standard soccer team on the field?', choices: ['9', '10', '11', '12'], correctIndex: 2 },
      { text: 'In which sport would you perform a slam dunk?', choices: ['Volleyball', 'Basketball', 'Tennis', 'Badminton'], correctIndex: 1 },
      { text: 'How often are the Summer Olympic Games held?', choices: ['Every 2 years', 'Every 4 years', 'Every 5 years', 'Every 3 years'], correctIndex: 1 },
      { text: 'What sport uses terms like "love" and "deuce"?', choices: ['Tennis', 'Cricket', 'Badminton', 'Table tennis'], correctIndex: 0 },
      { text: 'How many players are on a basketball team on the court?', choices: ['4', '5', '6', '7'], correctIndex: 1 },
      { text: 'In cricket, how many players are on each team?', choices: ['9', '10', '11', '12'], correctIndex: 2 },
      { text: 'What color card signals a player is sent off in soccer?', choices: ['Yellow', 'Blue', 'Red', 'Black'], correctIndex: 2 },
      { text: 'Which country has won the most FIFA World Cups?', choices: ['Germany', 'Argentina', 'Brazil', 'Italy'], correctIndex: 2 },
      { text: 'How long is a marathon race?', choices: ['21.1 km', '26.2 miles', '30 miles', '100 km'], correctIndex: 1 },
      { text: 'In golf, what term means one stroke under par?', choices: ['Bogey', 'Eagle', 'Birdie', 'Albatross'], correctIndex: 2 },
      { text: 'Which sport is known as "the king of sports" in much of the world?', choices: ['Basketball', 'Soccer', 'Cricket', 'Rugby'], correctIndex: 1 },
      { text: 'How many rings are on the Olympic flag?', choices: ['4', '5', '6', '7'], correctIndex: 1 },
    ],
  },
  custom: {
    label: 'Custom / Study Mode',
    emoji: '📝',
    questions: [], // unused directly — the live pool lives on room.customQuestions
  },
};

const DEFAULT_CATEGORY = 'general';

function getCategoryList() {
  return Object.entries(CATEGORIES).map(([key, c]) => ({ key, label: c.label, emoji: c.emoji }));
}

function resolveCategory(key) {
  return CATEGORIES[key] ? key : DEFAULT_CATEGORY;
}

function getQuestions(categoryKey) {
  return CATEGORIES[resolveCategory(categoryKey)].questions;
}

function getCategoryLabel(categoryKey) {
  const c = CATEGORIES[resolveCategory(categoryKey)];
  return `${c.emoji} ${c.label}`;
}

/**
 * Every 3rd question is a "power round." They alternate flavor:
 * the 1st, 3rd, 5th... power round is a Steal Round; the 2nd, 4th... is a Freeze Round.
 * @returns {'steal' | 'freeze' | null}
 */
function getPowerRoundType(questionIndex) {
  const position = questionIndex + 1; // 1-based
  if (position % POWER_ROUND_INTERVAL !== 0) return null;
  const powerRoundNumber = position / POWER_ROUND_INTERVAL;
  return powerRoundNumber % 2 === 1 ? 'steal' : 'freeze';
}

module.exports = {
  CATEGORIES,
  DEFAULT_CATEGORY,
  getCategoryList,
  getCategoryLabel,
  resolveCategory,
  getQuestions,
  QUESTION_DURATION_MS,
  getPowerRoundType,
};
