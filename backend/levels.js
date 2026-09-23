// Grade levels and competitive exams offered for AI-generated / study-mode questions.
// Purely metadata — actual questions are generated on demand by ai.js, or added
// manually by the host; nothing here is a question bank.
const LEVELS = [
  { key: 'class1_5', label: 'Class 1–5 (Primary)', group: 'School' },
  { key: 'class6_8', label: 'Class 6–8 (Middle)', group: 'School' },
  { key: 'class9_10', label: 'Class 9–10 (Secondary)', group: 'School' },
  { key: 'class11_12', label: 'Class 11–12 (Senior Secondary)', group: 'School' },
  { key: 'ug', label: 'Undergraduate', group: 'Higher Education' },
  { key: 'pg', label: 'Postgraduate', group: 'Higher Education' },
  { key: 'phd', label: 'PhD / Research', group: 'Higher Education' },
  { key: 'jee', label: 'JEE (Engineering Entrance)', group: 'Competitive Exams' },
  { key: 'neet', label: 'NEET (Medical Entrance)', group: 'Competitive Exams' },
  { key: 'upsc', label: 'UPSC Civil Services', group: 'Competitive Exams' },
  { key: 'ssc', label: 'SSC', group: 'Competitive Exams' },
  { key: 'banking', label: 'Banking Exams (IBPS/SBI)', group: 'Competitive Exams' },
  { key: 'gate', label: 'GATE', group: 'Competitive Exams' },
  { key: 'cat', label: 'CAT (MBA Entrance)', group: 'Competitive Exams' },
];

const DEFAULT_LEVEL = 'class9_10';

function getLevelList() {
  return LEVELS;
}

function getLevelLabel(key) {
  const found = LEVELS.find((l) => l.key === key);
  return found ? found.label : LEVELS.find((l) => l.key === DEFAULT_LEVEL).label;
}

module.exports = { LEVELS, DEFAULT_LEVEL, getLevelList, getLevelLabel };
