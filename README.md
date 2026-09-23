# ⚡ Trivia Royale

A live multiplayer trivia game. No login, no app install — join with a 4-letter room code from any phone or laptop, anywhere.

## How to play

1. One player picks a name, an avatar, and a category, then taps **Create a Room** — they get a 4-letter code and a QR code to share.
2. Everyone else taps **Join a Room** (or scans the QR code) and enters their name and that code.
3. Once 2+ players have joined, the host taps **Start Game** — everyone sees a synced 3-2-1 countdown. Playing alone? Tap **⚡ Quick Play vs Bot** on the home screen to jump straight into a game against a computer opponent.
4. Each question gives everyone 15 seconds. **Tap an answer and it locks in instantly** (on a keyboard: keys 1–4 or A–D). Answer fast *and* correctly for more points (200–1000, scaled by speed). Wrong or no answer = 0.
   - **🔥 Combo streaks** — consecutive correct answers add bonus points (+50 per streak step, up to +200).
   - **✂️ 50/50 booster** — two per game; removes two wrong answers, but that answer earns 60% points.
5. Every 3rd question is a power round, alternating:
   - **⚡ Steal Round** — the fastest correct answer steals 150 points from one opponent.
   - **🥶 Freeze Round** — the fastest correct answer locks one opponent out of the very next question.
6. If the host disconnects, the next connected player automatically becomes host — the game never gets stuck.
7. After the last question, highest score wins, with a full-screen celebration. Hit **Play Again** to replay instantly with the same room code — great for a recurring game night.
8. Every finished game's top score is saved to the **🏆 Hall of Fame** (top-right) — an all-time leaderboard across every room ever played.
9. Pick **📝 Custom / Study Mode** as the category to turn any room into an exam-prep quiz: choose a grade level (Class 1–12, undergraduate, postgraduate, PhD) or a competitive exam (JEE, NEET, UPSC, SSC, Banking, GATE, CAT), then a category and sub-category (e.g. Physics → Optics), and let AI generate original exam-style questions — or add your own questions by hand. Needs at least 4 questions in the pool before the host can start.

## The Hot Seat studio

When a quiz starts, the screen becomes a game-show set (you can turn this off in the 🎨 menu):

- **Four contestant desks (A–D)** — you sit at the desk you lock in; when the answer is revealed everyone takes the desk they chose, the right desk lights up green, and wrong answers slump.
- **Fastest Finger lane** — every player's avatar is shown thinking, then buzzes in with a rank badge and their reaction time (`1st · 1.8s`). Only *who* has locked in is shared, never *which* answer, so nothing is given away.
- **A live audience** (`frontend/studio.js`) — three rows of people who lean in as time runs out, gasp or groan on a miss, and clap or cheer (with camera flashes) on a streak, with synthesized crowd sound.
- **📊 Audience Poll** — a second booster besides 50/50: shows what the studio thinks, at a small points discount. The audience is usually right, and sometimes confidently wrong.
- A drumroll before each reveal, and a low tension drone in the last five seconds.

## Computer opponents

Add a 🤖 computer player from the lobby (or use Quick Play) and pick its level — each has its own accuracy and reaction-time profile, reads longer questions more slowly, and chooses steal/freeze targets tactically:

| Level | Accuracy | Typical answer time |
|---|---|---|
| 🍬 Rookie | ~45% | ~5 s |
| ⚔️ Veteran | ~70% | ~4 s |
| 🔥 Elite | ~88% | ~2.4 s |
| 👑 Legend | ~97% | ~1.4 s |

## Themes & engine

Five themes, switchable from the 🎨 button: **Candy Blast** (glossy candies and jelly buttons), **Battle Zone** (a shrinking-zone battle-royale HUD with air drops), **Neon City** (synthwave sunset, skyline and a neon grid), plus **Midnight** and **Daylight**. Each is rendered by a small dependency-free canvas engine (`frontend/engine.js`) — animated scenes, a particle system (sparks, confetti, candies, coins, stars), floating score text, screen shake and flash. It pauses in background tabs, caps the pixel ratio, lowers its own quality if frames run slow, and respects `prefers-reduced-motion`. The layout adapts from phones to tablets to laptops (safe-area aware for iPhone/iPad notches; installable to the home screen).

## Running locally

```bash
npm install
npm start
```

Then open `http://localhost:3000` in a couple of browser tabs (or on your phone via your computer's local IP) to test with multiple "players."

The Hall of Fame needs a database (see below) — without one, the game still works end-to-end, the leaderboard just shows "not set up."

## Tech

Node.js + Express + Socket.IO, single process. Active games live in server memory (no database needed to play). Plain HTML/CSS/JS on the client — no build step. Sound effects are synthesized with the Web Audio API (no audio files), and the QR code is generated client-side.

## Setting up the Hall of Fame (MongoDB — free tier)

Finished games are saved to MongoDB for the all-time leaderboard. This is optional — the game is fully playable without it.

1. Create a free cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) (no credit card needed for the free tier).
2. In Atlas, create a database user (username/password) and, under Network Access, allow access from anywhere (`0.0.0.0/0`) so Render can reach it.
3. Get your connection string from **Connect → Drivers** — it looks like `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/trivia`.
4. Set it as an environment variable named `MONGODB_URI`:
   - Locally: `MONGODB_URI="mongodb+srv://..." npm start`
   - On Render: in your Web Service's **Environment** tab, add `MONGODB_URI` with that value, then redeploy.

Without `MONGODB_URI` set, the server logs a note and the Hall of Fame button just shows "not set up yet" — nothing else is affected.

## Setting up AI question generation (Google Gemini — free tier)

Custom / Study Mode's "Generate with AI" button uses Google Gemini to write original, exam-style questions for a given grade/exam level and subject. This is optional — hosts can always add questions by hand instead.

1. Go to [Google AI Studio](https://aistudio.google.com/apikey) and sign in with any Google account.
2. Click **Create API key** — it's free, no credit card, and takes one click (no separate signup form).
3. Set it as an environment variable named `GEMINI_API_KEY`:
   - Locally: `GEMINI_API_KEY="..." npm start`
   - On Render: in your Web Service's **Environment** tab, add `GEMINI_API_KEY` with that value, then redeploy.

Google retires Gemini model names now and then, so the server tries a list of models in order and remembers the one that works. To pin one, set `GEMINI_MODEL` (e.g. `gemini-3.6-flash`).

Without `GEMINI_API_KEY` set, the "Generate with AI" button is hidden and the lobby shows a hint to add questions manually instead — the rest of the game is unaffected. The AI is explicitly instructed to write brand-new questions matching a level's real difficulty and style, never to reproduce specific real past questions from anywhere.

## Deploying it live (Render — free, no credit card)

This repo includes a `render.yaml` Blueprint, so Render can configure everything itself — you only fill in one field.

1. Push this project to a GitHub repo (public or private both work).
2. Go to [render.com](https://render.com) and sign up (you can use your GitHub account to sign in — no credit card needed for the free tier).
3. Click **New +** → **Blueprint**, and connect the GitHub repo you just pushed. Render reads `render.yaml` and pre-fills the service (Node, `npm install`, `npm start`, free plan) automatically.
4. It'll ask for the env vars the blueprint left blank: `MONGODB_URI` and `GEMINI_API_KEY`. Paste in whichever you've set up (see above) — leave either blank and that one feature just stays off, everything else still works.
5. Click **Apply**. Render builds and deploys — takes 1-2 minutes.
6. Once it says "Live", your public URL is shown at the top (something like `https://trivia-royale.onrender.com`). That's the link to share with players — and the one to put in the contest submission.

*(No blueprint? You can also do it manually: **New +** → **Web Service** → connect the repo → Build Command `npm install`, Start Command `npm start`, Instance Type Free.)*

**Note:** the free tier spins down after inactivity, so the first request after a while takes ~30-50s to wake up (the next ones are instant). Also, waking up from a cold start clears any in-memory rooms from before (the Hall of Fame is unaffected, since it lives in MongoDB) — fine for a party game played fresh each time.

## Submitting to the contest

- **Title**: `Trivia Royale` (or your own spin on it).
- **Cover image**: a 1200×630 card is included as a design Artifact from this build — open it, and use its export/screenshot to save a PNG.
- **Description**: *"Trivia Royale is a live multiplayer trivia game — join with a 4-letter room code from any phone, no login, no app install. Every 3rd question is a power round: steal points from a rival or freeze them out of the next question. Play solo against a computer opponent, or with a group anywhere; every win gets saved to an all-time Hall of Fame. Switch to Study Mode to turn any room into an AI-generated exam-prep quiz for any grade level (Class 1 through PhD) or competitive exam (JEE, NEET, UPSC, SSC, Banking, GATE, CAT) — or add your own questions by hand."*
- **Link**: your live Render URL from above.
