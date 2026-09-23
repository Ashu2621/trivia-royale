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
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.11, 0.3, 'triangle', 0.16));
      [783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, 0.55 + i * 0.1, 0.5, 'triangle', 0.12));
    },
  };
})();
