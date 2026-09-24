# 🌆 City Chaos: We Gotta Go

A free-roam **3D multiplayer city brawl** you play in the browser — no login, no install. Punch, swing a bat, shoot, hijack cars and run people over, rob the bank, dodge the cops, survive a **haunted mansion** and find a toilet before your **bladder hits 100%**. Play with friends via a 4-letter room code (phones, tablets, laptops), or against smart computer players.

## How to play

- **Goal** — your **cash is your score**. Most cash when the 8 minutes are up wins; finishing all four missions earns a big bonus.
- **Missions** — 1) 🔫 Gun Store, 2) 🏚️ Haunted Mansion, 3) 💰 Bank heist, 4) 🚽 Royal Restroom (finish). Stand in the glowing ring and hold still. Side stops work any time: 🏥 Hospital heals, 🚗 Garage gives a car, 🍔 Diner / 🎮 Arcade / 📻 Radio pay cash, 🚓 Police lets you bribe away your stars.
- **Fighting (GTA-style)** — fists, 🏏 bat, 🔫 pistol / SMG / shotgun. `Space` / `J` / click / tap / the 👊 button attacks (hold to keep going, auto-aim), `1–5` or `Tab` switches weapon. Armed guards protect every building; other players fight back.
- **Cars** — walk up and press `F` (or 🚗) to hijack. Run people over; cars catch fire and explode.
- **Wanted level** — hurt people, rob the bank, blow things up and the cops come, more of them with every ⭐.
- **Wasted** — you respawn at the hospital after a few seconds; you drop 20% of your cash (grab it back!) and whoever got you earns +$250.
- **The bladder** — it fills all match long. Your character dances, holds it with both hands and lets out real recorded toots. Find a blue public toilet stall (hold the door), or the mansion / Royal Restroom. At 100%: an accident (−$250, everyone hears it).
- **Haunted Mansion** — 3D maze with 3 keys 🔑 (+$300 each) that open the lettered gates, ghosts 👻 that add to your bladder, a 🚽 exit worth $1000 with instant relief. `F` = flashlight.
- **Microphone** — real **WebRTC voice chat** with your whole gang; **shout** into your mic and nearby ghosts flee.
- **Bots** — four difficulty tiers (Rookie / Veteran / Elite / Legend) that fight, take revenge, steal cars, run missions and hunt toilets.
- **Awards + Hall of Fame** — Top Gun, Mission Master, Punching Bag, Leaky Pants / Iron Bladder, Loudest Cheeks; results are saved to an all-time 🏆 Hall of Fame (optional MongoDB).

Controls: `WASD`/arrows move · `Space`/click fight · `F` car (or flashlight) · `1–5`/`Tab` weapon · drag or `Q`/`E` orbit the camera · wheel zoom · on touch: joystick + buttons.

## Tech

Node.js + Express + Socket.IO, one process, all rooms in memory. The **server is authoritative**: a 20 Hz simulation (walking, hit-scan shooting with wall ray-casts, melee cones, cars, roadkill, explosions, cops with A* pathfinding, guards, pedestrians, loot, wanted levels, bladder, ghosts) and 10 Hz snapshots. The client (plain HTML/CSS/JS, no build step) interpolates snapshots and predicts your own movement.

- **Graphics** — Three.js (vendored): PBR lighting, soft shadows, day-to-dusk sky, a rigged Mixamo soldier (`frontend/models/Soldier.glb`) animated with two-bone IK for acting: gun aim, alternating punches, full bat swings, ragdoll-style falls, and hands held between the legs when nature calls.
- **Sound** — real CC0 recordings for the body noises (`frontend/sounds/`, see `CREDITS.md`) plus synthesized gunshots, punches, explosions and sirens (Web Audio).
- **Voice** — peer-to-peer WebRTC audio mesh; Socket.IO only relays signalling.

## Running locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in a couple of tabs (or on your phone via your computer's local IP). Test knobs (env vars): `BLADDER_FILL_S` (seconds for a bladder to fill), `STARTER_ARSENAL=1` (everyone starts with every weapon), `TEST_START_MANSION=1` (humans start inside the mansion).

## Hall of Fame (MongoDB — optional, free tier)

Set `MONGODB_URI` (e.g. a free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) cluster; allow `0.0.0.0/0` under Network Access). Without it the game works fully and the Hall of Fame shows "not set up yet".

## Deploying (Render — free)

`render.yaml` is a Blueprint: push to GitHub, **New + → Blueprint**, add `MONGODB_URI` if you want the Hall of Fame, **Apply**. (Manual: Web Service, build `npm install`, start `npm start`, Free.) The free tier sleeps after inactivity, so the first request can take ~30–50 s; in-memory rooms are cleared on wake-up.
