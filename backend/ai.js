// Generates fresh, original exam-style multiple-choice questions with Google
// Gemini's free-tier API. Never reproduces real questions from any source —
// the model is explicitly instructed to write new ones that match the style
// and difficulty of a given level/subject, not to recall specific real ones.
const MODEL = 'gemini-2.0-flash';
const MAX_COUNT = 15;
const MIN_COUNT = 4;

function isEnabled() {
  return !!process.env.GEMINI_API_KEY;
}

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
          correctIndex: { type: 'integer' },
        },
        required: ['text', 'choices', 'correctIndex'],
      },
    },
  },
  required: ['questions'],
};

function buildPrompt(levelLabel, subject, count, avoid) {
  let prompt =
    `You are an expert exam-question setter. Write ${count} brand-new multiple-choice questions ` +
    `for the "${levelLabel}" level, on the subject/topic: "${subject}".\n\n` +
    `Rules:\n` +
    `- Match the real difficulty, phrasing style, and format that "${levelLabel}" exams actually use for this topic.\n` +
    `- Every question must be entirely original — do not copy or closely paraphrase any specific real past question you may recall. Write new questions in that style instead.\n` +
    `- Each question has exactly 4 answer options, in plain text, with exactly one correct answer.\n` +
    `- Keep each question and each option concise (under ~25 words).\n` +
    `- Vary the topics within the subject so the set feels like a well-rounded quiz, not repetitive.\n` +
    `- correctIndex is the 0-based index (0, 1, 2, or 3) of the correct option in the choices array.`;

  if (avoid && avoid.length) {
    prompt +=
      `\n\nThis exact level/subject combination was quizzed before in another room. To keep it fresh, ` +
      `do NOT reuse or closely resemble any of these already-used questions:\n` +
      avoid.map((t) => `- ${t}`).join('\n');
  }
  return prompt;
}

async function generateQuestions({ levelLabel, subject, count, avoid }) {
  if (!isEnabled()) {
    throw new Error('AI question generation is not configured on this server.');
  }
  const safeCount = Math.max(MIN_COUNT, Math.min(MAX_COUNT, Number(count) || 10));
  const prompt = buildPrompt(levelLabel, subject, safeCount, avoid);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: QUESTION_SCHEMA,
        temperature: 0.9,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI request failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('AI returned an empty response — try again.');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('AI returned malformed data — try a different topic.');
  }

  const valid = (parsed.questions || [])
    .filter(
      (q) =>
        q &&
        typeof q.text === 'string' &&
        q.text.trim() &&
        Array.isArray(q.choices) &&
        q.choices.length === 4 &&
        q.choices.every((c) => typeof c === 'string' && c.trim()) &&
        Number.isInteger(q.correctIndex) &&
        q.correctIndex >= 0 &&
        q.correctIndex <= 3
    )
    .map((q) => ({
      text: q.text.trim().slice(0, 300),
      choices: q.choices.map((c) => c.trim().slice(0, 120)),
      correctIndex: q.correctIndex,
    }));

  if (!valid.length) throw new Error('AI returned no valid questions — try a different topic.');
  return valid;
}

module.exports = { isEnabled, generateQuestions, MAX_COUNT, MIN_COUNT };
