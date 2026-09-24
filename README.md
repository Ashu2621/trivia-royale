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

## 🌆 City Mission: We Gotta Go (open world + haunted mansion + a very full bladder)

One mode, two worlds, a pure race. Pick **City Mission** on the home screen: everyone drops into a 3D city with wandering people and traffic and races through the same list of missions — a shop, the **Haunted Mansion**, another shop and finally the **Royal Restroom** 🚽 (first one through it wins).

- **A quiz gate at every door** — reach the door and a question opens; only a correct answer unlocks the reward (🔫 a blaster that stuns rivals, 🚗 a turbo car, 🛡️ a shield, 💰 cash). A wrong answer locks you out for a few seconds.
- **The Haunted Mansion** — answer its gate and you walk into a generated maze of moonlit halls. Three locked rooms (A, B, C) block the way; each key is guarded by a **quiz**. Ghosts chase you (a catch freezes you and fills your bladder) — swing the flashlight (Space / 🔦) or **shout into your microphone** to scare them off. The way out is the toilet at the far end, which completes the mission. Every match gets a fresh maze, checked so every door is a real chokepoint and every key is reachable.
- **Your bladder is your clock** — it fills the whole match. Public toilet stalls (blue cabins on the sidewalks) give relief, but they are quiz-locked too. At high pressure your soldier fidgets, squeezes their knees together, hunches over with both hands clamped between the legs and hops; a clench sends a hand to the back and a **fart** (8 different kinds, real recordings) with a green stink cloud. At 100% you have an **accident**: frozen in shame for a few seconds and −250 points. Awards: 🧊 Iron Bladder, 💩 Leaky Pants, 💨 Loudest Cheeks, 👻 Ghost Magnet.
- **Real 3D** (Three.js): PBR lighting, real-time shadows, image-based reflections, a sky that moves from morning to dusk, lit storefronts and rooftop props, and big rigged soldier characters with Idle/Walk/Run blending plus procedural acting (two-bone IK for the hands). Falls back to a 2D view without WebGL (the mansion needs WebGL).
- **Voice chat** — the 🎙️ button switches your microphone on and joins a peer-to-peer (WebRTC) voice channel with the rest of the room; the speaking indicator lights up next to whoever talks. (Uses public STUN servers only — very strict corporate networks may need a TURN server.)
- **Sounds** — real CC0 recordings (farts, tummy rumbles, grunts, screams, sighs, flushes), see `frontend/sounds/CREDITS.md`.
- **Controls** — third-person camera: drag to look around, wheel/pinch to zoom, Q/E to rotate. Joystick on phones and tablets, WASD/arrows on laptops (Space = zap / flashlight), or tap the ground to walk there.
- **Computer players** run the same missions with A* pathfinding, take the mansion too, use the public toilets when desperate, answer quizzes at their level's accuracy, chat and zap rivals.
- Server-authoritative: the server simulates city and mansion at 20 Hz and sends 10 Hz snapshots; your own character is predicted locally. Code: `backend/city.js` (simulation), `backend/maze.js` (maze generator + helpers), `frontend/city3d.js` + `city3d_world.js` (city renderer), `frontend/maze3d.js` (mansion renderer), `frontend/soldier.js` (character + acting), `frontend/voice.js` (voice chat), `frontend/city2d.js` (fallback). Three.js r147 (MIT) with GLTFLoader/SkeletonUtils is vendored in `frontend/vendor/`; the soldier is the free Mixamo character shipped with the three.js examples.

## 🎬 Hot Seat studio in 3D

The Hot Seat / battle-royale match screen (every level a room, every player at a desk, survivors running to the next room while the storm closes) is now a real **3D game-show studio** too: glossy reflective floors, truss spotlights, an LED wall screen per level, a rigged soldier avatar behind each desk, parachute drops at the start, collapse animations for the eliminated and a running-through-the-corridor finale. It falls back to the classic 2D map when WebGL isn't available (or with `?arena2d`). Code: `frontend/arena3d.js`, `frontend/arena2d.js`, `frontend/arena.js` (picks one).

## More ways to play

- **🤝 Team mode** — the host picks Solo / 2 / 3 / 4 teams in the lobby. Players are dealt onto colour teams (humans first); shirts and table stripes show the team, a live team-score strip sits above the map, and steal/freeze can only target other teams. With 3+ teams the lowest-scoring team is knocked out together at the end of each level; with 2 teams the match is a straight team-vs-team score race.
- **📅 Daily Challenge** — 12 questions drawn from every ready-made bank, seeded by today's date (India time), so everybody gets the same set in the same order. Quick-plays against a bot; your best is remembered on the button, and the Hall of Fame has a "Today" filter.
- **😎 Reactions & spectator fans** — eight emoji reactions float over your table for the whole room (rate-limited). Eliminated players can tap a contender's table to cheer for them (a ❤ count appears on the table; it never affects scoring).
- **🤖 Computer players talk** — each level has a personality (shy rookie … cocky legend) and says short in-character lines, with some Hinglish, in speech bubbles.
- **🏅 Match awards** — Fastest Finger, Streak King, Sharpshooter, Point Thief and Comeback Kid, computed from per-match stats.
- **🇮🇳 Hinglish GK** category, and **language choice for AI questions** (English / Hinglish / Hindi).
- **🎙️ Voice host** — browser speech synthesis reads questions, the correct answer, eliminations and the winner. Off by default.
- **📎 Questions from your own notes** — in Study Mode, paste text or upload a PDF (≤ 3 MB) and the AI writes questions based only on it.
- **Keep-alive** — `.github/workflows/keepalive.yml` pings `/healthz` every 10 minutes so Render's free tier doesn't fall asleep.

## Levels, the map, and elimination

A match is split into 2–4 **levels** (Qualifier → Quarter-final → Semi-final → Grand Final), each a few questions long. The whole match is one map (`frontend/arena.js`):

- **Every level is a room** with its own colour, a wall screen showing the level name and its sub-level progress dots, and one table per player. Each player is an animated human character sitting at their table — typing, pressing their buzzer (the lamp lights and a rank chip shows who was fastest), cheering on a correct answer and slumping on a wrong one.
- **The start is a drop-in**: everyone parachutes onto their table.
- **At the end of a level the storm closes**: the lowest third of the remaining players (at least one, never below two survivors) are eliminated and collapse where they sit (`#N OUT`). The safe zone closes on the next room and the survivors stand up and run down the corridor to new tables. The camera follows the squad.
- A **level map strip** under the arena shows every level, its sub-levels and how many players are still in; tap the arena (or 🗺 Map) to zoom out over all rooms.
- Eliminated players keep watching the rest of the tournament; the match only ends early if every human has left. Final ranking puts survivors first, then the eliminated by how long they lasted.
- The **← Back button** (and the phone's back gesture) leaves the room or match at any time: in the lobby the host crown passes on, mid-match the seat is dropped out.

## The Hot Seat studio

When a quiz starts, the screen becomes a game-show set (you can turn this off in the 🎨 menu):

- **Fastest Finger** — each table's lamp lights when its player locks in, with a rank chip and reaction time (`1 · 1.8s`). Only *who* has locked in is shared, never *which* answer, so nothing is given away; at the reveal each table shows the letter chosen and a ✓ or ✗.
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
