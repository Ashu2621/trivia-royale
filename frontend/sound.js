// Tiny synthesized sound effects via Web Audio — no audio files to ship or load.
const SoundFX = (function () {
  const MUTE_KEY = 'triviaRoyaleMuted';
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* storage blocked */ }

  function getCtx() {
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) ctx = new Ctx();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Call once on a user gesture to satisfy browser autoplay policies (iOS/Safari especially).
  function unlock() {
    getCtx();
  }

  function isMuted() {
    return muted;
  }

  function setMuted(value) {
    muted = value;
    if (value) stopTension();
    try { localStorage.setItem(MUTE_KEY, value ? '1' : '0'); } catch (e) { /* storage blocked */ }
  }

  function tone(freq, startOffset, duration, type, peakGain) {
    const audioCtx = getCtx();
    if (!audioCtx || muted) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const now = audioCtx.currentTime + startOffset;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peakGain != null ? peakGain : 0.18, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  function sweep(from, to, startOffset, duration, type, peakGain) {
    const audioCtx = getCtx();
    if (!audioCtx || muted) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'sine';
    const now = audioCtx.currentTime + startOffset;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), now + duration);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peakGain != null ? peakGain : 0.2, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  let noiseBuf = null;
  function noise() {
    const audioCtx = getCtx();
    if (!audioCtx) return null;
    if (!noiseBuf) {
      noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  // Filtered noise with an amplitude envelope — the basis for crowd sounds.
  function noiseBurst(startOffset, duration, freq, q, peak, rate) {
    const audioCtx = getCtx();
    const buf = noise();
    if (!audioCtx || !buf || muted) return;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate || 1;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime + startOffset;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + Math.min(0.25, duration * 0.3));
    gain.gain.linearRampToValueAtTime(0.0001, now + duration);
    src.connect(filter).connect(gain).connect(audioCtx.destination);
    src.start(now);
    src.stop(now + duration + 0.05);
  }

  // a hard-attack noise hit for gunshots, punches and explosions
  function snap(startOffset, duration, freq, q, peak, rate, type, pan) {
    const audioCtx = getCtx();
    const buf = noise();
    if (!audioCtx || !buf || muted) return;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate || 1;
    const filter = audioCtx.createBiquadFilter();
    filter.type = type || 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime + startOffset;
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + duration);
    let out = gain;
    src.connect(filter).connect(gain);
    if (pan && audioCtx.createStereoPanner) {
      const p = audioCtx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(p);
      out = p;
    }
    out.connect(audioCtx.destination);
    src.start(now);
    src.stop(now + duration + 0.05);
  }

  function thump(startOffset, from, to, duration, peak) {
    sweep(from, to, startOffset, duration, 'sine', peak);
  }

  /* ---- real recorded samples (CC0, see sounds/CREDITS.md): farts, tummy rumbles, grunts, screams, sighs, flushes ---- */
  const Samples = { buffers: {}, loading: null };

  function prepareSamples() {
    if (Samples.loading) return Samples.loading;
    const audioCtx = getCtx();
    if (!audioCtx) return Promise.resolve();
    Samples.loading = fetch('sounds/manifest.json')
      .then((r) => r.json())
      .then((manifest) => {
        const jobs = [];
        Object.keys(manifest).forEach((kind) => {
          Samples.buffers[kind] = [];
          manifest[kind].forEach((file, i) => {
            jobs.push(
              fetch('sounds/' + file)
                .then((r) => r.arrayBuffer())
                .then((data) => new Promise((res, rej) => audioCtx.decodeAudioData(data, res, rej)))
                .then((buf) => {
                  Samples.buffers[kind][i] = buf;
                })
                .catch(() => {})
            );
          });
        });
        return Promise.all(jobs);
      })
      .catch(() => {});
    return Samples.loading;
  }

  // play one recorded clip: { rate, gain, delay, lowpass, pan }
  function playSample(kind, index, o) {
    const audioCtx = getCtx();
    const list = Samples.buffers[kind];
    if (!audioCtx || muted || !list || !list.length) return null;
    const buf = list[((index % list.length) + list.length) % list.length];
    if (!buf) return null;
    const opts = o || {};
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate || 1;
    const gain = audioCtx.createGain();
    gain.gain.value = opts.gain == null ? 1 : opts.gain;
    let node = src;
    if (opts.lowpass) {
      const f = audioCtx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lowpass;
      node.connect(f);
      node = f;
    }
    node.connect(gain);
    let out = gain;
    if (opts.pan && audioCtx.createStereoPanner) {
      const p = audioCtx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      gain.connect(p);
      out = p;
    }
    out.connect(audioCtx.destination);
    src.start(audioCtx.currentTime + (opts.delay || 0));
    return src;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  // eight different kinds of trouser trumpet, built from the real recordings with a bit of processing
  function fartRecipe(kind, v, pan) {
    const j = () => rnd(0.94, 1.07);
    const vol = Math.max(0.05, Math.min(1.4, v));
    switch (kind % 8) {
      case 0: // quick little pfft
        playSample('fart', 3, { rate: 1.3 * j(), gain: 0.9 * vol, pan });
        break;
      case 1: // the classic
        playSample('fart', 0, { rate: j(), gain: vol, pan });
        break;
      case 2: // long and low
        playSample('fart', 0, { rate: 0.72 * j(), gain: 1.05 * vol, lowpass: 1000, pan });
        break;
      case 3: // squeaker
        playSample('fart', 1, { rate: 1.75 * j(), gain: 0.85 * vol, pan });
        break;
      case 4: // double trouble
        playSample('fart', 2, { rate: 1.05 * j(), gain: vol, pan });
        playSample('fart', 3, { rate: 0.95 * j(), gain: vol, delay: 0.2, pan });
        break;
      case 5: // muffled, straight through the pants
        playSample('fart', 1, { rate: 0.85 * j(), gain: 1.25 * vol, lowpass: 520, pan });
        break;
      case 6: // thunderous
        playSample('fart', 0, { rate: 0.55 * j(), gain: 1.1 * vol, lowpass: 800, pan });
        playSample('fart', 1, { rate: 0.62 * j(), gain: 0.9 * vol, lowpass: 700, delay: 0.03, pan });
        break;
      default: // a moist one
        playSample('fart', 3, { rate: 0.9 * j(), gain: vol, pan });
        playSample('bubble', Math.floor(Math.random() * 2), { rate: 1.1, gain: 0.5 * vol, delay: 0.05, pan });
    }
    if (Math.random() < 0.22) playSample('gut', Math.floor(Math.random() * 16), { rate: rnd(0.85, 1.1), gain: 0.55 * vol, delay: -0.0, pan });
  }

  // the little noises a person makes trying to hold it in
  function voiceLine(type, v, pan) {
    const vol = Math.max(0.05, Math.min(1.4, v));
    const i = Math.floor(Math.random() * 10);
    switch (type) {
      case 'strain':
        playSample('grunt', i, { rate: rnd(0.8, 1.05), gain: 0.95 * vol, pan });
        if (Math.random() < 0.5) playSample('gut', Math.floor(Math.random() * 16), { gain: 0.5 * vol, delay: 0.25, pan });
        break;
      case 'panic':
        playSample('ooh', 0, { rate: rnd(0.95, 1.15), gain: vol, pan });
        break;
      case 'hurt':
        playSample('hurt', i, { rate: rnd(0.85, 1.05), gain: vol, pan });
        break;
      case 'gasp':
        playSample('gasp', 0, { rate: rnd(0.95, 1.1), gain: vol, pan });
        break;
      case 'scream':
        playSample('scream', i, { rate: rnd(0.9, 1.1), gain: vol, pan });
        break;
      case 'sigh':
        playSample('sigh', 0, { rate: rnd(0.9, 1.05), gain: 1.2 * vol, pan });
        break;
      default:
        playSample('burp', i, { gain: vol, pan });
    }
  }

  let tensionNodes = null;
  function stopTension() {
    if (!tensionNodes) return;
    const { osc, lfo, gain, audioCtx } = tensionNodes;
    gain.gain.cancelScheduledValues(audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + 0.15);
    osc.stop(audioCtx.currentTime + 0.2);
    lfo.stop(audioCtx.currentTime + 0.2);
    tensionNodes = null;
  }

  const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 987.77, 1046.5, 1174.66];

  return {
    unlock,
    isMuted,
    setMuted,
    click() {
      tone(500, 0, 0.08, 'triangle', 0.12);
    },
    lock() {
      tone(440, 0, 0.06, 'triangle', 0.14);
      tone(660, 0.05, 0.1, 'triangle', 0.14);
    },
    tick() {
      tone(700, 0, 0.05, 'square', 0.05);
    },
    count() {
      tone(660, 0, 0.14, 'square', 0.1);
    },
    go() {
      tone(880, 0, 0.12, 'square', 0.12);
      tone(1174.66, 0.08, 0.28, 'square', 0.12);
      sweep(200, 900, 0, 0.3, 'sawtooth', 0.06);
    },
    correct() {
      tone(523.25, 0, 0.12, 'sine');
      tone(783.99, 0.08, 0.18, 'sine');
    },
    // Climbing arpeggio — the longer the streak, the higher and longer it runs.
    combo(level) {
      const steps = Math.min(SCALE.length, 2 + level);
      for (let i = 0; i < steps; i++) tone(SCALE[i], i * 0.055, 0.16, 'triangle', 0.14);
      if (level >= 3) sweep(300, 1400, 0, 0.35, 'sawtooth', 0.05);
    },
    wrong() {
      tone(220, 0, 0.16, 'sawtooth', 0.12);
      tone(164.81, 0.09, 0.22, 'sawtooth', 0.1);
    },
    boom() {
      sweep(180, 40, 0, 0.35, 'sine', 0.3);
      sweep(900, 100, 0, 0.18, 'sawtooth', 0.08);
    },
    lifeline() {
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone(f, i * 0.05, 0.14, 'sine', 0.1));
    },
    steal() {
      tone(600, 0, 0.08, 'square', 0.14);
      tone(900, 0.07, 0.08, 'square', 0.14);
      tone(1200, 0.14, 0.15, 'square', 0.14);
    },
    freeze() {
      tone(900, 0, 0.2, 'sine', 0.1);
      tone(700, 0.12, 0.25, 'sine', 0.1);
    },
    // Crowd sounds for the studio audience.
    applause(seconds, loudness) {
      const d = seconds || 2.2;
      const g = loudness || 0.16;
      noiseBurst(0, d, 2400, 0.7, g, 1.0);
      noiseBurst(0.05, d, 1400, 0.6, g * 0.8, 1.3);
      for (let i = 0; i < Math.floor(d * 7); i++) noiseBurst(Math.random() * d * 0.8, 0.06, 3200, 1.2, g * 0.9, 1.8);
    },
    cheer() {
      noiseBurst(0, 1.6, 900, 0.8, 0.2, 0.8);
      sweep(320, 520, 0, 0.9, 'sawtooth', 0.03);
      this.applause(2.6, 0.18);
    },
    gasp() {
      noiseBurst(0, 0.55, 1800, 1.4, 0.12, 1.4);
      sweep(500, 300, 0, 0.5, 'sine', 0.03);
    },
    groan() {
      sweep(220, 130, 0, 0.7, 'sawtooth', 0.05);
      noiseBurst(0, 0.8, 500, 0.9, 0.08, 0.7);
    },
    drumroll(seconds) {
      const d = seconds || 1.2;
      for (let i = 0; i < d * 18; i++) noiseBurst(i / 18, 0.05, 240, 2, 0.05 + (i / (d * 18)) * 0.1, 1);
    },
    buzz() {
      tone(1320, 0, 0.07, 'square', 0.06);
      tone(1760, 0.06, 0.09, 'square', 0.05);
    },
    // Battle-royale style cues for the between-levels walk.
    siren() {
      for (let i = 0; i < 3; i++) {
        sweep(420, 760, i * 0.55, 0.5, 'sawtooth', 0.05);
        sweep(760, 420, i * 0.55 + 0.27, 0.28, 'sawtooth', 0.04);
      }
    },
    whoosh() {
      noiseBurst(0, 0.7, 1200, 0.5, 0.1, 1.6);
      sweep(200, 900, 0, 0.6, 'sine', 0.03);
    },
    eliminated() {
      sweep(320, 60, 0, 0.7, 'sawtooth', 0.16);
      noiseBurst(0, 0.5, 300, 0.7, 0.12, 0.6);
      tone(110, 0.05, 0.6, 'square', 0.06);
    },
    step() {
      noiseBurst(0, 0.05, 700, 2, 0.05, 1.2);
    },
    // Low, slowly pulsing drone for the last seconds of a question.
    tension(on) {
      if (!on) return stopTension();
      const audioCtx = getCtx();
      if (!audioCtx || muted || tensionNodes) return;
      const osc = audioCtx.createOscillator();
      const lfo = audioCtx.createOscillator();
      const lfoGain = audioCtx.createGain();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      lfo.frequency.value = 3.2;
      lfoGain.gain.value = 0.03;
      gain.gain.value = 0.045;
      lfo.connect(lfoGain).connect(gain.gain);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      lfo.start();
      tensionNodes = { osc, lfo, gain, audioCtx };
    },
    // ---- real body sounds (recordings) ----
    prepareBody() {
      return prepareSamples();
    },
    bodyReady() {
      return Object.keys(Samples.buffers).reduce((n, k) => n + Samples.buffers[k].filter(Boolean).length, 0);
    },
    fart(kind, volume, pan) {
      fartRecipe(kind || 0, volume == null ? 1 : volume, pan || 0);
    },
    voice(type, volume, pan) {
      voiceLine(type, volume == null ? 1 : volume, pan || 0);
    },
    tummy(volume) {
      playSample('gut', Math.floor(Math.random() * 16), { rate: rnd(0.9, 1.1), gain: 0.8 * (volume == null ? 1 : volume) });
    },
    // the full disaster: a scream, a monster fart and a lot of bubbling
    accident(volume) {
      const v = volume == null ? 1 : volume;
      voiceLine('scream', v);
      fartRecipe(6, 1.2 * v, 0);
      setTimeout(() => {
        fartRecipe(7, v, 0);
        playSample('bubble', 0, { gain: 0.7 * v, rate: 0.9 });
      }, 420);
      setTimeout(() => voiceLine('hurt', 0.8 * v), 900);
    },
    // sweet, sweet relief
    relief(volume) {
      const v = volume == null ? 1 : volume;
      voiceLine('sigh', v);
      setTimeout(() => playSample('flush', Math.floor(Math.random() * 2), { gain: 0.9 * v }), 500);
    },
    // ---- City Chaos: combat ----
    gun(kind, volume, pan) {
      const v = volume == null ? 1 : volume;
      if (kind === 3) { // SMG: a short, dry rattle
        snap(0, 0.09, 1900, 0.7, 0.16 * v, 1.2, 'bandpass', pan);
        thump(0, 260, 90, 0.08, 0.1 * v);
      } else if (kind === 4) { // shotgun: a big boom with a low thud
        snap(0, 0.4, 700, 0.4, 0.3 * v, 0.7, 'lowpass', pan);
        snap(0, 0.12, 2400, 0.6, 0.2 * v, 1.1, 'bandpass', pan);
        thump(0, 150, 45, 0.3, 0.22 * v);
        snap(0.42, 0.06, 3000, 3, 0.05 * v, 1.4, 'bandpass', pan);
        snap(0.5, 0.05, 2600, 3, 0.04 * v, 1.4, 'bandpass', pan);
      } else { // pistol: a sharp crack
        snap(0, 0.18, 1500, 0.6, 0.2 * v, 1, 'bandpass', pan);
        thump(0, 210, 70, 0.14, 0.14 * v);
        snap(0.16, 0.08, 2800, 3, 0.035 * v, 1.3, 'bandpass', pan);
      }
    },
    punch(volume) {
      const v = volume == null ? 1 : volume;
      snap(0, 0.1, 380, 0.9, 0.22 * v, 0.8, 'lowpass');
      thump(0, 160, 70, 0.1, 0.16 * v);
    },
    swing(volume) {
      const v = volume == null ? 1 : volume;
      snap(0, 0.22, 1800, 0.8, 0.07 * v, 1.6, 'bandpass');
      sweep(500, 1100, 0, 0.2, 'sine', 0.02 * v);
    },
    // a bat cracking against something
    bat(volume) {
      const v = volume == null ? 1 : volume;
      snap(0, 0.14, 900, 1.5, 0.3 * v, 1, 'bandpass');
      thump(0, 300, 80, 0.16, 0.18 * v);
      tone(1250, 0, 0.09, 'triangle', 0.05 * v);
    },
    hit(volume) {
      const v = volume == null ? 1 : volume;
      snap(0, 0.07, 520, 1, 0.14 * v, 1, 'bandpass');
    },
    ricochet() {
      sweep(2600, 900, 0, 0.22, 'sine', 0.04);
    },
    hurtGrunt(volume) {
      voiceLine('hurt', volume == null ? 0.8 : volume);
    },
    boom(volume) {
      const v = volume == null ? 1 : volume;
      snap(0, 1.1, 260, 0.5, 0.38 * v, 0.55, 'lowpass');
      thump(0, 110, 30, 0.9, 0.3 * v);
      snap(0.05, 0.5, 900, 0.5, 0.15 * v, 0.9, 'bandpass');
    },
    crash(volume) {
      const v = volume == null ? 1 : volume;
      snap(0, 0.3, 500, 0.5, 0.22 * v, 0.8, 'lowpass');
      snap(0.02, 0.2, 2400, 1.5, 0.08 * v, 1.2, 'bandpass');
      thump(0, 130, 50, 0.25, 0.16 * v);
    },
    honk(volume) {
      const v = volume == null ? 1 : volume;
      tone(392, 0, 0.32, 'sawtooth', 0.06 * v);
      tone(494, 0, 0.32, 'sawtooth', 0.05 * v);
    },
    engineRev(volume) {
      const v = volume == null ? 1 : volume;
      sweep(70, 190, 0, 0.5, 'sawtooth', 0.05 * v);
      snap(0, 0.5, 240, 0.7, 0.05 * v, 0.6, 'lowpass');
    },
    carDoor(volume) {
      const v = volume == null ? 1 : volume;
      snap(0, 0.1, 500, 1, 0.16 * v, 0.9, 'lowpass');
      thump(0, 180, 70, 0.1, 0.1 * v);
    },
    cash() {
      tone(1568, 0, 0.09, 'triangle', 0.1);
      tone(2093, 0.07, 0.22, 'triangle', 0.09);
    },
    pickup() {
      tone(660, 0, 0.08, 'square', 0.07);
      tone(990, 0.07, 0.14, 'square', 0.07);
    },
    reload() {
      snap(0, 0.05, 2200, 2, 0.08, 1.3, 'bandpass');
      snap(0.22, 0.06, 1500, 2, 0.1, 1, 'bandpass');
    },
    // a police siren whoop
    policeSiren(volume) {
      const v = volume == null ? 1 : volume;
      for (let i = 0; i < 3; i++) {
        sweep(700, 1000, i * 0.44, 0.22, 'sawtooth', 0.035 * v);
        sweep(1000, 700, i * 0.44 + 0.22, 0.22, 'sawtooth', 0.035 * v);
      }
    },
    wanted() {
      [523.25, 392, 523.25, 392].forEach((f, i) => tone(f, i * 0.14, 0.13, 'square', 0.07));
      this.policeSiren(0.8);
    },
    wasted() {
      sweep(420, 55, 0, 1.1, 'sawtooth', 0.13);
      snap(0, 0.6, 300, 0.7, 0.14, 0.6, 'lowpass');
      tone(98, 0.1, 0.9, 'square', 0.05);
    },
    respawn() {
      [392, 523.25, 659.25, 880].forEach((f, i) => tone(f, i * 0.06, 0.22, 'triangle', 0.1));
    },
    heistAlarm() {
      for (let i = 0; i < 6; i++) tone(i % 2 ? 880 : 1046, i * 0.14, 0.12, 'square', 0.08);
    },
    heartbeat() {
      thump(0, 90, 50, 0.16, 0.2);
      thump(0.2, 80, 45, 0.18, 0.15);
    },
    // ---- We Gotta Go (haunted maze) ----
    ghost() {
      sweep(760, 180, 0, 0.9, 'sine', 0.07);
      sweep(520, 130, 0.08, 1.0, 'triangle', 0.05);
      noiseBurst(0, 0.6, 900, 1.4, 0.03, 1);
    },
    boo() {
      sweep(240, 60, 0, 0.5, 'sawtooth', 0.14);
      noiseBurst(0, 0.35, 500, 0.8, 0.12, 0.8);
    },
    // a short, cheeky squeak of relief
    toot() {
      sweep(190, 95, 0, 0.16, 'sawtooth', 0.09);
      sweep(150, 80, 0.16, 0.22, 'square', 0.06);
    },
    flush() {
      noiseBurst(0, 1.4, 700, 0.6, 0.11, 0.7);
      sweep(600, 120, 0.1, 1.2, 'sine', 0.04);
      [523.25, 659.25, 783.99].forEach((f, i) => tone(f, 1.1 + i * 0.09, 0.3, 'triangle', 0.1));
    },
    door() {
      noiseBurst(0, 0.7, 260, 0.7, 0.1, 0.5);
      sweep(90, 45, 0, 0.6, 'square', 0.09);
    },
    key() {
      [880, 1174.7, 1568].forEach((f, i) => tone(f, i * 0.07, 0.35, 'triangle', 0.13));
    },
    thunder() {
      noiseBurst(0, 1.6, 180, 0.5, 0.16, 0.5);
      sweep(70, 35, 0, 1.4, 'sawtooth', 0.07);
    },
    flashlight() {
      sweep(1400, 500, 0, 0.25, 'sine', 0.08);
      noiseBurst(0, 0.15, 2600, 2, 0.05, 1.4);
    },
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.11, 0.3, 'triangle', 0.16));
      [783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, 0.55 + i * 0.1, 0.5, 'triangle', 0.12));
    },
  };
})();

// A spoken "host" using the browser's built-in speech synthesis — no audio files, no network.
// Reads questions, the correct answer, eliminations and the winner. Off by default.
const VoiceHost = (function () {
  const KEY = 'triviaRoyaleVoice';
  const synth = window.speechSynthesis || null;
  let on = false;
  try { on = localStorage.getItem(KEY) === '1'; } catch (e) { /* storage blocked */ }
  let voices = [];
  function refresh() {
    if (synth) voices = synth.getVoices();
  }
  if (synth) {
    refresh();
    synth.onvoiceschanged = refresh;
  }

  function pick(text) {
    const devanagari = /[\u0900-\u097F]/.test(text);
    const wanted = devanagari ? ['hi-in', 'hi'] : ['en-in', 'en-gb', 'en-us', 'en'];
    for (const l of wanted) {
      const v = voices.find((x) => x.lang && x.lang.replace('_', '-').toLowerCase().startsWith(l));
      if (v) return { voice: v, lang: v.lang };
    }
    return { voice: null, lang: devanagari ? 'hi-IN' : 'en-IN' };
  }

  return {
    supported: !!synth,
    isOn: () => on,
    set(value) {
      on = !!value;
      try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
      if (!on && synth) synth.cancel();
    },
    speak(text, opts) {
      if (!on || !synth || !text || SoundFX.isMuted()) return;
      const u = new SpeechSynthesisUtterance(String(text).slice(0, 220));
      const { voice, lang } = pick(u.text);
      if (voice) u.voice = voice;
      u.lang = lang;
      u.rate = 1.03;
      if (!(opts && opts.queue)) synth.cancel();
      synth.speak(u);
    },
  };
})();
