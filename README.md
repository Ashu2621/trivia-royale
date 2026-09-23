# ⚡ Trivia Royale

A live multiplayer trivia game. No login, no app install — join with a 4-letter room code from any phone or laptop, anywhere.

## How to play

1. One player picks a name, an avatar, and a category, then taps **Create a Room** — they get a 4-letter code and a QR code to share.
2. Everyone else taps **Join a Room** (or scans the QR code) and enters their name and that code.
3. Once 2+ players have joined, the host taps **Start Game**.
4. Each question gives everyone 15 seconds. Answer fast *and* correctly for more points (200–1000, scaled by speed). Wrong or no answer = 0.
5. Every 3rd question is a power round, alternating:
   - **⚡ Steal Round** — the fastest correct answer steals 150 points from one opponent.
   - **🥶 Freeze Round** — the fastest correct answer locks one opponent out of the very next question.
6. If the host disconnects, the next connected player automatically becomes host — the game never gets stuck.
7. After the last question, highest score wins, with confetti for the win. Hit **Play Again** to replay instantly with the same room code — great for a recurring game night.
8. Every finished game's top score is saved to the **🏆 Hall of Fame** (top-right) — an all-time leaderboard across every room ever played.

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

## Deploying it live (Render — free, no credit card)

1. Push this project to a GitHub repo (public or private both work).
2. Go to [render.com](https://render.com) and sign up (you can use your GitHub account to sign in).
3. Click **New +** → **Web Service**, and connect the GitHub repo you just pushed.
4. Fill in:
   - **Name**: anything, e.g. `trivia-royale`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Click **Create Web Service**. Render will build and deploy — takes 1-2 minutes.
6. Once it says "Live", your public URL is shown at the top (something like `https://trivia-royale.onrender.com`). That's the link to share with players.

**Note:** the free tier spins down after inactivity, so the first request after a while takes ~30-50s to wake up (the next ones are instant). Also, waking up from a cold start clears any rooms from before — fine for a party game played fresh each time.
