// Grade levels, competitive exams, and their subject/topic taxonomy, offered
// for AI-generated / study-mode questions. Purely metadata — actual questions
// are generated on demand by ai.js, or added manually by the host; nothing
// here is a question bank or copied from any real exam.

const GENERAL = 'General (mixed topics)';

function subject(label, topics) {
  return { label, subcategories: [GENERAL, ...topics] };
}

const LEVELS = [
  {
    key: 'class1_5',
    label: 'Class 1–5 (Primary)',
    group: 'School',
    categories: [
      subject('Mathematics', ['Numbers & Counting', 'Addition & Subtraction', 'Shapes & Patterns', 'Basic Multiplication & Division']),
      subject('Science (EVS)', ['Plants', 'Animals', 'Human Body', 'Our Environment']),
      subject('English', ['Grammar Basics', 'Vocabulary', 'Reading Comprehension']),
      subject('General Knowledge', ['World Around Us', 'Festivals & Culture', 'Famous Places']),
    ],
  },
  {
    key: 'class6_8',
    label: 'Class 6–8 (Middle)',
    group: 'School',
    categories: [
      subject('Mathematics', ['Integers & Fractions', 'Algebra Basics', 'Geometry', 'Ratio & Proportion']),
      subject('Science', ['Physics Basics', 'Chemistry Basics', 'Biology Basics']),
      subject('Social Science', ['History', 'Geography', 'Civics']),
      subject('English', ['Grammar', 'Literature']),
    ],
  },
  {
    key: 'class9_10',
    label: 'Class 9–10 (Secondary)',
    group: 'School',
    categories: [
      subject('Mathematics', ['Algebra', 'Geometry', 'Trigonometry', 'Statistics & Probability']),
      subject('Physics', ['Motion & Force', 'Electricity', 'Light & Sound']),
      subject('Chemistry', ['Atoms & Molecules', 'Acids, Bases & Salts', 'Carbon Compounds']),
      subject('Biology', ['Life Processes', 'Heredity & Evolution', 'Our Environment']),
      subject('Social Science', ['History', 'Geography', 'Political Science', 'Economics']),
    ],
  },
  {
    key: 'class11_12',
    label: 'Class 11–12 (Senior Secondary)',
    group: 'School',
    categories: [
      subject('Physics', ['Mechanics', 'Thermodynamics', 'Electromagnetism', 'Optics', 'Modern Physics']),
      subject('Chemistry', ['Physical Chemistry', 'Organic Chemistry', 'Inorganic Chemistry']),
      subject('Mathematics', ['Calculus', 'Algebra', 'Coordinate Geometry', 'Probability']),
      subject('Biology', ['Cell Biology', 'Genetics', 'Human Physiology', 'Ecology']),
      subject('Commerce', ['Accountancy', 'Business Studies', 'Economics']),
      subject('Humanities', ['History', 'Political Science', 'Geography', 'Sociology']),
    ],
  },
  {
    key: 'ug',
    label: 'Undergraduate',
    group: 'Higher Education',
    categories: [
      subject('Engineering', ['Computer Science', 'Mechanical', 'Electrical', 'Civil', 'Electronics']),
      subject('Science', ['Physics', 'Chemistry', 'Mathematics', 'Biology']),
      subject('Commerce & Management', ['Accounting', 'Finance', 'Marketing', 'Economics']),
      subject('Arts & Humanities', ['History', 'Political Science', 'Literature', 'Psychology']),
      subject('Medicine', ['Anatomy', 'Physiology', 'Pharmacology', 'Pathology']),
    ],
  },
  {
    key: 'pg',
    label: 'Postgraduate',
    group: 'Higher Education',
    categories: [
      subject('Engineering', ['Computer Science', 'Mechanical', 'Electrical', 'Civil', 'Electronics']),
      subject('Science', ['Physics', 'Chemistry', 'Mathematics', 'Biology']),
      subject('Management (MBA)', ['Finance', 'Marketing', 'Operations', 'Strategy', 'HR']),
      subject('Arts & Humanities', ['History', 'Political Science', 'Literature', 'Psychology']),
      subject('Medicine', ['Clinical Medicine', 'Surgery', 'Pharmacology', 'Pathology']),
    ],
  },
  {
    key: 'phd',
    label: 'PhD / Research',
    group: 'Higher Education',
    categories: [
      subject('Research Methodology', ['Quantitative Methods', 'Qualitative Methods', 'Statistics', 'Academic Writing']),
      subject('Engineering & Technology', ['Computer Science', 'Mechanical', 'Electrical', 'Civil']),
      subject('Natural Sciences', ['Physics', 'Chemistry', 'Biology', 'Mathematics']),
      subject('Social Sciences & Humanities', ['Economics', 'Sociology', 'Political Science', 'Literature']),
    ],
  },
  {
    key: 'jee',
    label: 'JEE (Engineering Entrance)',
    group: 'Competitive Exams',
    categories: [
      subject('Physics', ['Mechanics', 'Thermodynamics', 'Electrodynamics', 'Optics & Modern Physics']),
      subject('Chemistry', ['Physical Chemistry', 'Organic Chemistry', 'Inorganic Chemistry']),
      subject('Mathematics', ['Algebra', 'Calculus', 'Coordinate Geometry', 'Trigonometry']),
    ],
  },
  {
    key: 'neet',
    label: 'NEET (Medical Entrance)',
    group: 'Competitive Exams',
    categories: [
      subject('Physics', ['Mechanics', 'Thermodynamics', 'Electrodynamics', 'Optics & Modern Physics']),
      subject('Chemistry', ['Physical Chemistry', 'Organic Chemistry', 'Inorganic Chemistry']),
      subject('Biology', ['Botany', 'Zoology', 'Human Physiology', 'Genetics & Evolution']),
    ],
  },
  {
    key: 'upsc',
    label: 'UPSC Civil Services',
    group: 'Competitive Exams',
    categories: [
      subject('History', ['Ancient India', 'Medieval India', 'Modern India', 'World History']),
      subject('Polity', ['Constitution', 'Governance', 'Parliament & Judiciary']),
      subject('Geography', ['Physical Geography', 'Indian Geography', 'World Geography']),
      subject('Economics', ['Indian Economy', 'Economic Policies', 'International Economics']),
      subject('Science & Technology', ['Space', 'Defence', 'Biotechnology', 'IT & Computers']),
      subject('Environment & Ecology', ['Biodiversity', 'Climate Change', 'Conservation']),
      subject('Current Affairs', ['National', 'International', 'Government Schemes']),
    ],
  },
  {
    key: 'ssc',
    label: 'SSC',
    group: 'Competitive Exams',
    categories: [
      subject('Quantitative Aptitude', ['Arithmetic', 'Algebra', 'Geometry', 'Data Interpretation']),
      subject('General Reasoning', ['Verbal Reasoning', 'Non-Verbal Reasoning', 'Analytical Reasoning']),
      subject('English Language', ['Grammar', 'Vocabulary', 'Comprehension']),
      subject('General Awareness', ['History', 'Geography', 'Polity', 'Current Affairs']),
    ],
  },
  {
    key: 'banking',
    label: 'Banking Exams (IBPS/SBI)',
    group: 'Competitive Exams',
    categories: [
      subject('Quantitative Aptitude', ['Arithmetic', 'Data Interpretation', 'Number Series']),
      subject('Reasoning Ability', ['Verbal Reasoning', 'Puzzles & Seating', 'Syllogism']),
      subject('English Language', ['Grammar', 'Vocabulary', 'Comprehension']),
      subject('General Awareness', ['Banking Awareness', 'Current Affairs', 'Static GK']),
      subject('Computer Knowledge', ['Computer Fundamentals', 'MS Office', 'Internet & Networking']),
    ],
  },
  {
    key: 'gate',
    label: 'GATE',
    group: 'Competitive Exams',
    categories: [
      subject('Engineering Mathematics', ['Linear Algebra', 'Calculus', 'Probability & Statistics']),
      subject('Computer Science', ['Data Structures', 'Algorithms', 'Operating Systems', 'DBMS', 'Computer Networks']),
      subject('Mechanical Engineering', ['Thermodynamics', 'Fluid Mechanics', 'Machine Design']),
      subject('Electrical Engineering', ['Circuits', 'Power Systems', 'Control Systems']),
      subject('Civil Engineering', ['Structural Engineering', 'Geotechnical Engineering', 'Fluid Mechanics']),
      subject('Electronics & Communication', ['Signals & Systems', 'Digital Electronics', 'Communication Systems']),
    ],
  },
  {
    key: 'cat',
    label: 'CAT (MBA Entrance)',
    group: 'Competitive Exams',
    categories: [
      subject('Quantitative Ability', ['Arithmetic', 'Algebra', 'Geometry', 'Number Systems']),
      subject('Verbal Ability & Reading Comprehension', ['Reading Comprehension', 'Grammar', 'Vocabulary', 'Para-jumbles']),
      subject('Data Interpretation & Logical Reasoning', ['Data Interpretation', 'Logical Reasoning', 'Puzzles']),
    ],
  },
];

const DEFAULT_LEVEL = 'class9_10';

function getLevelList() {
  return LEVELS;
}

function findLevel(key) {
  return LEVELS.find((l) => l.key === key) || LEVELS.find((l) => l.key === DEFAULT_LEVEL);
}

function getLevelLabel(key) {
  return findLevel(key).label;
}

module.exports = { LEVELS, DEFAULT_LEVEL, getLevelList, getLevelLabel, findLevel };
