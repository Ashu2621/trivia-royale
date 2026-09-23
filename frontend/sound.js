// Tiny synthesized sound effects via Web Audio — no audio files to ship or load.
const SoundFX = (function () {
  const MUTE_KEY = 'triviaRoyaleMuted';
  let ctx = null;
  let muted = localStorage.getItem(MUTE_KEY) === '1';

  function getCtx() {
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) ctx = new Ctx();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Call once on a user gesture to satisfy browser autoplay policies.
  function unlock() {
    getCtx();
  }

  function isMuted() {
    return muted;
  }

  function setMuted(value) {
    muted = value;
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
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

  return {
    unlock,
    isMuted,
    setMuted,
    click() {
      tone(500, 0, 0.08, 'triangle', 0.12);
    },
    tick() {
      tone(700, 0, 0.05, 'square', 0.05);
    },
    correct() {
      tone(523.25, 0, 0.12, 'sine');
      tone(783.99, 0.08, 0.18, 'sine');
    },
    wrong() {
      tone(220, 0, 0.16, 'sawtooth', 0.12);
      tone(164.81, 0.09, 0.22, 'sawtooth', 0.1);
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
    },
  };
})();
