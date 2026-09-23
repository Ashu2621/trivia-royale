const QUESTION_DURATION_MS = 15000;
const STEAL_INTERVAL = 3; // every 3rd question (1-indexed: 3, 6, 9, ...) is a steal round

const QUESTIONS = [
  { text: 'What planet is known as the Red Planet?', choices: ['Venus', 'Mars', 'Jupiter', 'Saturn'], correctIndex: 1 },
  { text: 'How many continents are there on Earth?', choices: ['5', '6', '7', '8'], correctIndex: 2 },
  { text: 'What is the largest ocean on Earth?', choices: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correctIndex: 3 },
  { text: 'Who painted the Mona Lisa?', choices: ['Van Gogh', 'Picasso', 'Da Vinci', 'Monet'], correctIndex: 2 },
  { text: 'What is the chemical symbol for gold?', choices: ['Ag', 'Au', 'Gd', 'Go'], correctIndex: 1 },
  { text: 'Which country invented pizza?', choices: ['France', 'Greece', 'Italy', 'Spain'], correctIndex: 2 },
  { text: 'How many legs does a spider have?', choices: ['6', '8', '10', '12'], correctIndex: 1 },
  { text: 'What is the smallest prime number?', choices: ['0', '1', '2', '3'], correctIndex: 2 },
  { text: 'Which language has the most native speakers worldwide?', choices: ['English', 'Hindi', 'Mandarin Chinese', 'Spanish'], correctIndex: 2 },
  { text: 'What gas do plants absorb from the atmosphere?', choices: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], correctIndex: 2 },
  { text: 'How many sides does a hexagon have?', choices: ['5', '6', '7', '8'], correctIndex: 1 },
  { text: 'What is the capital of Japan?', choices: ['Seoul', 'Beijing', 'Tokyo', 'Bangkok'], correctIndex: 2 },
];

function isStealRound(questionIndex) {
  // questionIndex is 0-based; treat as 1-based position for the "every 3rd" rule
  return (questionIndex + 1) % STEAL_INTERVAL === 0;
}

module.exports = { QUESTIONS, QUESTION_DURATION_MS, isStealRound };
