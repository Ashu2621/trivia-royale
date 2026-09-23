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
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.11, 0.3, 'triangle', 0.16));
      [783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, 0.55 + i * 0.1, 0.5, 'triangle', 0.12));
    },
  };
})();
