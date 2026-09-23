// Generates fresh, original exam-style multiple-choice questions with Google
// Gemini's free-tier API. Never reproduces real questions from any source —
// the model is explicitly instructed to write new ones that match the style
// and difficulty of a given level/subject, not to recall specific real ones.

// Google retires Gemini model names regularly (gemini-2.0-flash now returns
// 404), so try a list of models in order and remember whichever one works.
// Set GEMINI_MODEL to pin a specific model as the first choice.
const DEFAULT_MODELS = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'];
const MAX_COUNT = 15;
const MIN_COUNT = 4;
const REQUEST_TIMEOUT_MS = 45000;

let workingModel = null;

function isEnabled() {
  return !!process.env.GEMINI_API_KEY;
}

function modelCandidates() {
  const list = [];
  if (process.env.GEMINI_MODEL) list.push(process.env.GEMINI_MODEL.trim());
  if (workingModel) list.push(workingModel);
  for (const m of DEFAULT_MODELS) list.push(m);
  return [...new Set(list)];
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
    `- Spread the correct answer across all four positions; do not always put it first.\n` +
    `- correctIndex is the 0-based index (0, 1, 2, or 3) of the correct option in the choices array.`;

  if (avoid && avoid.length) {
    prompt +=
      `\n\nThis exact level/subject combination was quizzed before in another room. To keep it fresh, ` +
      `do NOT reuse or closely resemble any of these already-used questions:\n` +
      avoid.map((t) => `- ${t}`).join('\n');
  }
  return prompt;
}

async function callModel(model, prompt, useSchema) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const generationConfig = { responseMimeType: 'application/json', temperature: 0.9 };
  if (useSchema) generationConfig.responseSchema = QUESTION_SCHEMA;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      // Key goes in a header, not the URL, so it can't leak into logs or error text.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    // Some models wrap JSON in a markdown fence even when asked not to.
    const match = String(text).match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw e;
  }
}

function friendlyHttpError(status, body) {
  if (status === 400 && /API key/i.test(body)) return 'The Gemini API key was rejected — check GEMINI_API_KEY on the server.';
  if (status === 401 || status === 403) return 'The Gemini API key was rejected or lacks access — check GEMINI_API_KEY on the server.';
  if (status === 429) return 'The AI is busy (free-tier rate limit) — wait a few seconds and try again.';
  return `AI request failed (${status}).`;
}

async function generateQuestions({ levelLabel, subject, count, avoid }) {
  if (!isEnabled()) {
    throw new Error('AI question generation is not configured on this server.');
  }
  const safeCount = Math.max(MIN_COUNT, Math.min(MAX_COUNT, Number(count) || 10));
  const prompt = buildPrompt(levelLabel, subject, safeCount, avoid);

  let lastError = null;
  for (const model of modelCandidates()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await callModel(model, prompt, attempt === 0);
      } catch (err) {
        lastError = new Error(err.name === 'AbortError' ? 'The AI took too long to respond — try again.' : `AI request failed: ${err.message}`);
        continue;
      }

      if (res.status === 404) {
        // This model name has been retired — move on to the next candidate.
        lastError = new Error('No available Gemini model responded — the server may need GEMINI_MODEL updated.');
        break;
      }
      if (res.status === 429 || res.status === 503) {
        const body = await res.text().catch(() => '');
        lastError = new Error(friendlyHttpError(res.status, body));
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`Gemini ${model} responded ${res.status}:`, body.slice(0, 300));
        // A schema rejection (400) is worth one retry without responseSchema.
        if (res.status === 400 && attempt === 0 && !/API key/i.test(body)) {
          lastError = new Error(friendlyHttpError(res.status, body));
          continue;
        }
        throw new Error(friendlyHttpError(res.status, body));
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
      if (!text) {
        lastError = new Error('AI returned an empty response — try again.');
        continue;
      }

      let parsed;
      try {
        parsed = extractJson(text);
      } catch (e) {
        lastError = new Error('AI returned malformed data — try a different topic.');
        continue;
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

      if (!valid.length) {
        lastError = new Error('AI returned no valid questions — try a different topic.');
        continue;
      }
      workingModel = model;
      return valid;
    }
  }
  throw lastError || new Error('AI question generation failed — try again.');
}

module.exports = { isEnabled, generateQuestions, MAX_COUNT, MIN_COUNT };
