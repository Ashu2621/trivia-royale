/*
 * Studio audience — a canvas crowd that sits below the stage.
 * Three rows of people (faces lit by stage light), each with their own skin,
 * hair, clothes and timing. The crowd reacts to the game through moods:
 *   idle   – relaxed sway            tense – leaning in, tiny tremor
 *   clap   – polite applause          cheer – on their feet, arms up, camera flashes
 *   gasp   – lean back, open mouths   groan – heads down
 * Draws at ~30fps, only while the question screen is visible.
 */
const Audience = (function () {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const SKIN = ['#f1c9a5', '#e0ac82', '#c68a5e', '#a86b42', '#8a5232', '#f6d5b8'];
  const HAIR = ['#1a1410', '#2b1d14', '#4a2f1c', '#6b4a2f', '#9a9a9a', '#0e0e12', '#5a2a1a'];
  const CLOTHES = ['#6d3fb0', '#2a6fb0', '#b03f6d', '#3fa07a', '#c9922a', '#d9d9e0', '#7a2a2a', '#2a2f4d', '#e07b39'];

  let canvas = null;
  let ctx = null;
  let W = 0;
  let H = 0;
  let people = [];
  let mood = 'idle';
  let moodUntil = 0;
  let running = false;
  let last = 0;
  let flashes = [];
  let observer = null;

  function build() {
    people = [];
    const rows = [
      { base: 0.5, scale: 0.62, shade: 0.55 },
      { base: 0.76, scale: 0.82, shade: 0.35 },
      { base: 1.06, scale: 1.05, shade: 0.12 },
    ];
    rows.forEach((row, r) => {
      const gap = 36 * row.scale;
      const count = Math.ceil(W / gap) + 1;
      for (let i = 0; i < count; i++) {
        people.push({
          x: i * gap + rand(-6, 6) * row.scale + (r % 2 ? gap / 2 : 0) - gap / 2,
          base: H * row.base + rand(-3, 3),
          sc: row.scale * rand(0.92, 1.08),
          shade: row.shade,
          skin: pick(SKIN),
          hair: pick(HAIR),
          cloth: pick(CLOTHES),
          long: Math.random() < 0.4,
          ph: rand(0, TAU),
          speed: rand(0.8, 1.3),
          row: r,
        });
      }
    });
  }

  function resize() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
    draw(performance.now() / 1000);
  }

  function darken(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * (1 - k));
    const g = Math.round(((n >> 8) & 255) * (1 - k));
    const b = Math.round((n & 255) * (1 - k));
    return `rgb(${r},${g},${b})`;
  }

  function drawPerson(p, t) {
    const sc = p.sc;
    const w = t * p.speed + p.ph;
    let bob = Math.sin(w * 1.3) * 1.1 * sc;
    let lean = 0;
    let armsUp = 0;
    let clap = 0;
    let mouth = 'flat';

    if (mood === 'tense') {
      bob = Math.sin(w * 9) * 0.5 * sc;
      lean = 1.5 * sc;
    } else if (mood === 'clap') {
      bob = Math.sin(w * 4) * 1.4 * sc;
      clap = 1;
      mouth = 'smile';
    } else if (mood === 'cheer') {
      bob = -Math.abs(Math.sin(w * 3.2)) * 7 * sc;
      armsUp = 1;
      mouth = 'smile';
    } else if (mood === 'gasp') {
      bob = 2 * sc;
      lean = -2 * sc;
      mouth = 'open';
    } else if (mood === 'groan') {
      bob = 1.5 * sc;
      lean = 2.5 * sc;
      mouth = 'frown';
    }

    const x = p.x;
    const headR = 8 * sc;
    const shoulderY = p.base - 16 * sc - bob;
    const headY = p.base - 27 * sc - bob + lean * 0.4;
    const shade = p.shade;

    // arms first, so the torso overlaps their base
    if (armsUp) {
      ctx.strokeStyle = darken(p.cloth, shade);
      ctx.lineWidth = 3.4 * sc;
      ctx.lineCap = 'round';
      const sway = Math.sin(w * 5) * 2.5 * sc;
      ctx.beginPath();
      ctx.moveTo(x - 11 * sc, shoulderY + 4 * sc);
      ctx.lineTo(x - 15 * sc + sway, headY - 13 * sc);
      ctx.moveTo(x + 11 * sc, shoulderY + 4 * sc);
      ctx.lineTo(x + 15 * sc - sway, headY - 13 * sc);
      ctx.stroke();
      ctx.fillStyle = darken(p.skin, shade);
      ctx.beginPath();
      ctx.arc(x - 15 * sc + sway, headY - 14 * sc, 2.7 * sc, 0, TAU);
      ctx.arc(x + 15 * sc - sway, headY - 14 * sc, 2.7 * sc, 0, TAU);
      ctx.fill();
    }

    // torso
    ctx.fillStyle = darken(p.cloth, shade);
    ctx.beginPath();
    const bx = x - 13 * sc;
    const by = shoulderY;
    const bw = 26 * sc;
    const br = 10 * sc;
    ctx.moveTo(bx, by + 30 * sc);
    ctx.lineTo(bx, by + br);
    ctx.quadraticCurveTo(bx, by, bx + br, by);
    ctx.lineTo(bx + bw - br, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
    ctx.lineTo(bx + bw, by + 30 * sc);
    ctx.closePath();
    ctx.fill();

    // hair behind head (long hair)
    if (p.long) {
      ctx.fillStyle = darken(p.hair, shade);
      ctx.beginPath();
      ctx.ellipse(x, headY + 3 * sc, headR + 1.5 * sc, headR + 4 * sc, 0, 0, TAU);
      ctx.fill();
    }

    // head
    ctx.fillStyle = darken(p.skin, shade);
    ctx.beginPath();
    ctx.arc(x + lean * 0.3, headY, headR, 0, TAU);
    ctx.fill();

    // hair on top
    ctx.fillStyle = darken(p.hair, shade);
    ctx.beginPath();
    ctx.arc(x + lean * 0.3, headY - 0.5 * sc, headR + 0.6 * sc, Math.PI * 1.02, Math.PI * 1.98);
    ctx.fill();

    // face
    const fx = x + lean * 0.3;
    ctx.fillStyle = `rgba(20,14,12,${0.85 - shade * 0.5})`;
    ctx.beginPath();
    ctx.arc(fx - 3 * sc, headY + 0.5 * sc, 0.95 * sc, 0, TAU);
    ctx.arc(fx + 3 * sc, headY + 0.5 * sc, 0.95 * sc, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(20,14,12,${0.8 - shade * 0.5})`;
    ctx.lineWidth = Math.max(0.8, 1 * sc);
    ctx.beginPath();
    if (mouth === 'smile') ctx.arc(fx, headY + 2.6 * sc, 2.6 * sc, 0.15 * Math.PI, 0.85 * Math.PI);
    else if (mouth === 'frown') ctx.arc(fx, headY + 6 * sc, 2.4 * sc, 1.15 * Math.PI, 1.85 * Math.PI);
    else if (mouth === 'open') ctx.ellipse(fx, headY + 4 * sc, 1.7 * sc, 2.3 * sc, 0, 0, TAU);
    else {
      ctx.moveTo(fx - 1.8 * sc, headY + 4 * sc);
      ctx.lineTo(fx + 1.8 * sc, headY + 4 * sc);
    }
    ctx.stroke();

    if (clap) {
      const spread = 1.5 + Math.abs(Math.sin(w * 7.5)) * 5;
      ctx.fillStyle = darken(p.skin, shade);
      ctx.beginPath();
      ctx.arc(x - spread * sc, shoulderY + 10 * sc, 2.6 * sc, 0, TAU);
      ctx.arc(x + spread * sc, shoulderY + 10 * sc, 2.6 * sc, 0, TAU);
      ctx.fill();
    }
  }

  function draw(t) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#040a2a');
    bg.addColorStop(1, '#0a1240');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (mood !== 'idle' && performance.now() > moodUntil) mood = 'idle';

    for (const p of people) drawPerson(p, t);

    // stage light sweeping across the faces
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 2; i++) {
      const cx = W * (0.5 + 0.42 * Math.sin(t * 0.45 + i * 2.6));
      const g = ctx.createRadialGradient(cx, H * 0.5, 0, cx, H * 0.5, W * 0.32);
      g.addColorStop(0, i ? 'rgba(255,200,90,0.16)' : 'rgba(90,150,255,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';

    // top fade so the crowd melts into the stage
    const fade = ctx.createLinearGradient(0, 0, 0, H * 0.4);
    fade.addColorStop(0, 'rgba(4,10,42,0.85)');
    fade.addColorStop(1, 'rgba(4,10,42,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, H * 0.4);

    // camera flashes when the crowd is on its feet
    if (mood === 'cheer' && Math.random() < 0.25) flashes.push({ x: rand(0, W), y: rand(H * 0.15, H * 0.8), life: 1 });
    flashes = flashes.filter((f) => (f.life -= 0.16) > 0);
    for (const f of flashes) {
      ctx.fillStyle = `rgba(255,255,255,${f.life * 0.9})`;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const r = i % 2 ? 2 : 6 * f.life + 2;
        ctx.lineTo(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  function loop(now) {
    if (!running) return;
    if (now - last > 32) {
      last = now;
      draw(now / 1000);
    }
    requestAnimationFrame(loop);
  }

  function mount(el) {
    canvas = el;
    ctx = canvas.getContext('2d');
    if (window.ResizeObserver) {
      observer = new ResizeObserver(resize);
      observer.observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }
    resize();
  }

  function start() {
    if (!canvas || running) return;
    resize();
    if (reduceMotion || document.hidden) return;
    running = true;
    requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
  }

  function setMood(next, ms) {
    mood = next;
    moodUntil = performance.now() + (ms || 2200);
    if (!running && canvas && !reduceMotion) start();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) running = false;
    else if (canvas && canvas.offsetParent !== null) start();
  });

  return { mount, start, stop, setMood };
})();
