/*
 * Trivia Royale FX Engine — dependency-free canvas renderer.
 *
 *  - Background scenes, one per theme: glossy floating candies (Candy Blast),
 *    a shrinking battle-royale zone with air drops (Battle Zone), and a
 *    synthwave sunset city with a moving neon grid (Neon City).
 *  - A particle layer (sparks, confetti, candies, coins, stars, shockwaves)
 *    that sits above the UI and never blocks input.
 *  - Floating score text, screen shake, screen flash.
 *
 * One requestAnimationFrame loop drives everything. It pauses when the tab is
 * hidden, draws a single still frame under prefers-reduced-motion, caps the
 * device pixel ratio, and lowers its own quality if frames run slow, so it
 * stays smooth from a phone to a 4K laptop.
 */
const Engine = (function () {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const PALETTES = {
    candy: ['#ff4d8d', '#ffb627', '#38d9a9', '#4dabf7', '#b26bff', '#ff7043'],
    battle: ['#ffb300', '#ff7a00', '#ffe066', '#d4dcc0', '#ff3d2e'],
    vice: ['#ff2e93', '#2ee6ff', '#ffd23f', '#b26bff', '#ff8a3d'],
    midnight: ['#9b7dff', '#ffb84d', '#5cb2ff', '#57d68c', '#ff6b8b'],
    light: ['#7c5cff', '#ff8a3d', '#3aa0ff', '#35c46f', '#ff5c7c'],
  };

  let bgCanvas, bgCtx, fxCanvas, fxCtx, fxLayer;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let themeKey = 'candy';
  let scene = null;
  let quality = 1;
  let running = false;
  let lastT = 0;
  let frames = 0;
  let frameMs = 0;
  let fxDirty = false;
  let px = 0;
  let py = 0;
  let tpx = 0;
  let tpy = 0;
  const particles = [];
  const MAX_PARTICLES = 420;

  /* ------------------------------------------------------------ sprites */

  const spriteCache = new Map();

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(((n >> 16) & 255) + amt, 0, 255);
    const g = clamp(((n >> 8) & 255) + amt, 0, 255);
    const b = clamp((n & 255) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  function gloss(c, r) {
    const g = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.03, -r * 0.35, -r * 0.4, r * 0.62);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(-r * 0.35, -r * 0.4, r * 0.62, 0, TAU);
    c.fill();
  }

  function bodyGradient(c, r, color) {
    const g = c.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, shade(color, 55));
    g.addColorStop(0.55, color);
    g.addColorStop(1, shade(color, -55));
    return g;
  }

  function starPath(c, r, inner) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * inner;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    c.closePath();
  }

  function heartPath(c, r) {
    c.beginPath();
    c.moveTo(0, r * 0.9);
    c.bezierCurveTo(-r * 1.3, r * 0.1, -r * 0.7, -r * 0.95, 0, -r * 0.35);
    c.bezierCurveTo(r * 0.7, -r * 0.95, r * 1.3, r * 0.1, 0, r * 0.9);
    c.closePath();
  }

  // Pre-render one candy to an offscreen canvas so the per-frame cost is a drawImage.
  function candySprite(shape, color, size) {
    const sp = Math.min(dpr, 2);
    const key = `${shape}|${color}|${size}|${sp}`;
    if (spriteCache.has(key)) return spriteCache.get(key);
    const pad = 6;
    const dim = Math.ceil((size + pad * 2) * sp);
    const cv = document.createElement('canvas');
    cv.width = cv.height = dim;
    const c = cv.getContext('2d');
    c.scale(sp, sp);
    c.translate(dim / sp / 2, dim / sp / 2);
    const r = size / 2;

    if (shape === 'ball') {
      c.fillStyle = bodyGradient(c, r, color);
      c.beginPath();
      c.arc(0, 0, r, 0, TAU);
      c.fill();
      c.save();
      c.beginPath();
      c.arc(0, 0, r, 0, TAU);
      c.clip();
      c.strokeStyle = 'rgba(255,255,255,0.32)';
      c.lineWidth = r * 0.22;
      for (let i = -1; i <= 1; i++) {
        c.beginPath();
        c.arc(i * r * 0.9, r * 0.2, r * 1.1, Math.PI * 1.15, Math.PI * 1.85);
        c.stroke();
      }
      c.restore();
      gloss(c, r);
    } else if (shape === 'bean') {
      c.rotate(-0.5);
      c.fillStyle = bodyGradient(c, r, color);
      c.beginPath();
      c.ellipse(0, 0, r, r * 0.62, 0, 0, TAU);
      c.fill();
      c.rotate(0.5);
      gloss(c, r * 0.9);
    } else if (shape === 'wrap') {
      c.fillStyle = shade(color, 30);
      c.beginPath();
      c.moveTo(-r * 0.55, 0);
      c.lineTo(-r * 1.05, -r * 0.5);
      c.lineTo(-r * 1.05, r * 0.5);
      c.closePath();
      c.fill();
      c.beginPath();
      c.moveTo(r * 0.55, 0);
      c.lineTo(r * 1.05, -r * 0.5);
      c.lineTo(r * 1.05, r * 0.5);
      c.closePath();
      c.fill();
      c.fillStyle = bodyGradient(c, r, color);
      c.beginPath();
      c.ellipse(0, 0, r * 0.62, r * 0.5, 0, 0, TAU);
      c.fill();
      gloss(c, r * 0.75);
    } else if (shape === 'star') {
      c.fillStyle = bodyGradient(c, r, color);
      starPath(c, r, 0.48);
      c.fill();
      c.strokeStyle = shade(color, -70);
      c.lineWidth = 1.2;
      c.stroke();
      gloss(c, r * 0.8);
    } else {
      c.fillStyle = bodyGradient(c, r, color);
      heartPath(c, r * 0.95);
      c.fill();
      gloss(c, r * 0.8);
    }
    spriteCache.set(key, cv);
    return cv;
  }

  /* ------------------------------------------------------------- scenes */

  function baseCount(perPixels, lo, hi) {
    return Math.round(clamp((W * H) / perPixels, lo, hi) * quality);
  }

  function gradientFill(stops) {
    const g = bgCtx.createLinearGradient(0, 0, 0, H);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    bgCtx.fillStyle = g;
    bgCtx.fillRect(0, 0, W, H);
  }

  /* --- Candy Blast --- */
  function candyScene() {
    const shapes = ['ball', 'ball', 'bean', 'wrap', 'star', 'heart'];
    const items = [];
    const n = baseCount(24000, 14, 44);
    for (let i = 0; i < n; i++) {
      const size = rand(26, 66);
      items.push({
        x: rand(0, W),
        y: rand(-H * 0.1, H),
        size,
        sprite: candySprite(pick(shapes), pick(PALETTES.candy), Math.round(size)),
        vy: rand(10, 34) * (size / 46),
        sway: rand(6, 26),
        ph: rand(0, TAU),
        spin: rand(-0.6, 0.6),
        rot: rand(0, TAU),
        depth: rand(0.4, 1),
      });
    }
    const twinkles = Array.from({ length: Math.round(28 * quality) }, () => ({ x: rand(0, W), y: rand(0, H), ph: rand(0, TAU), s: rand(2, 5) }));
    return {
      draw(t, dt) {
        gradientFill([[0, '#4b2bd4'], [0.5, '#9a3fe8'], [1, '#ff5fae']]);
        // soft drifting light
        const gx = W * (0.3 + 0.1 * Math.sin(t * 0.2));
        const glow = bgCtx.createRadialGradient(gx, H * 0.2, 0, gx, H * 0.2, W * 0.6);
        glow.addColorStop(0, 'rgba(255,255,255,0.22)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        bgCtx.fillStyle = glow;
        bgCtx.fillRect(0, 0, W, H);

        for (const s of twinkles) {
          const a = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.4 + s.ph));
          bgCtx.fillStyle = `rgba(255,255,255,${a * 0.8})`;
          bgCtx.save();
          bgCtx.translate(s.x, s.y);
          bgCtx.rotate(t * 0.3 + s.ph);
          starPath(bgCtx, s.s, 0.4);
          bgCtx.fill();
          bgCtx.restore();
        }

        for (const it of items) {
          it.y += it.vy * dt;
          it.rot += it.spin * dt;
          if (it.y - it.size > H) {
            it.y = -it.size * 1.5;
            it.x = rand(0, W);
          }
          const x = it.x + Math.sin(t * 0.7 + it.ph) * it.sway + px * 30 * it.depth;
          const y = it.y + py * 20 * it.depth;
          bgCtx.save();
          bgCtx.globalAlpha = 0.55 + 0.4 * it.depth;
          bgCtx.translate(x, y);
          bgCtx.rotate(it.rot);
          const d = it.sprite.width / Math.min(dpr, 2);
          bgCtx.drawImage(it.sprite, -d / 2, -d / 2, d, d);
          bgCtx.restore();
        }

        // cotton-candy clouds along the bottom edge
        bgCtx.fillStyle = 'rgba(255,255,255,0.10)';
        for (let i = 0; i < 9; i++) {
          const cx = (i / 8) * W + Math.sin(t * 0.3 + i) * 14;
          const r = 60 + (i % 3) * 26;
          bgCtx.beginPath();
          bgCtx.arc(cx, H + 20 + Math.sin(t * 0.5 + i * 2) * 6, r, 0, TAU);
          bgCtx.fill();
        }
      },
    };
  }

  /* --- Battle Zone --- */
  function battleScene() {
    const dust = Array.from({ length: Math.round(46 * quality) }, () => ({ x: rand(0, W), y: rand(0, H), vx: rand(-8, 8), vy: rand(-6, 6), r: rand(0.6, 2) }));
    const fog = Array.from({ length: 5 }, (_, i) => ({ x: rand(0, W), y: (H / 5) * i + rand(0, H / 8), r: rand(W * 0.3, W * 0.6), vx: rand(6, 16) * (i % 2 ? 1 : -1) }));
    const drops = Array.from({ length: Math.max(1, Math.round(2 * quality)) }, () => ({ x: rand(W * 0.1, W * 0.9), y: rand(-H, H * 0.4), vy: rand(16, 28), size: rand(34, 52), ph: rand(0, TAU), c: pick(['#e5432f', '#f2b705', '#3fae6a']) }));
    const tracers = [];
    let nextTracer = 1.2;
    let zoneStart = 0;
    const ZONE_SECONDS = 24;
    let vignette = null;

    function drawDrop(d, t) {
      const sway = Math.sin(t * 0.9 + d.ph) * 6;
      const x = d.x + sway + px * 16;
      const y = d.y + py * 10;
      const r = d.size;
      bgCtx.save();
      bgCtx.translate(x, y);
      bgCtx.rotate(Math.sin(t * 0.9 + d.ph) * 0.05);
      const panels = 5;
      for (let i = 0; i < panels; i++) {
        bgCtx.fillStyle = i % 2 ? '#e9e4cf' : '#c9411f';
        bgCtx.beginPath();
        bgCtx.moveTo(-r + (2 * r * i) / panels, 0);
        bgCtx.quadraticCurveTo(-r + (2 * r * (i + 0.5)) / panels, -r * 0.95, -r + (2 * r * (i + 1)) / panels, 0);
        bgCtx.closePath();
        bgCtx.fill();
      }
      bgCtx.strokeStyle = 'rgba(230,230,210,0.55)';
      bgCtx.lineWidth = 1;
      for (let i = 0; i <= panels; i += 1) {
        bgCtx.beginPath();
        bgCtx.moveTo(-r + (2 * r * i) / panels, 0);
        bgCtx.lineTo(0, r * 1.15);
        bgCtx.stroke();
      }
      const b = r * 0.4;
      bgCtx.fillStyle = d.c;
      bgCtx.fillRect(-b / 2, r * 1.15, b, b);
      bgCtx.fillStyle = 'rgba(0,0,0,0.35)';
      bgCtx.fillRect(-b / 2, r * 1.15 + b * 0.42, b, b * 0.16);
      bgCtx.restore();
    }

    return {
      draw(t, dt) {
        gradientFill([[0, '#0a0f09'], [0.55, '#182213'], [1, '#2a361f']]);

        // tactical grid
        bgCtx.strokeStyle = 'rgba(200,220,170,0.05)';
        bgCtx.lineWidth = 1;
        const step = 64;
        const off = (t * 6) % step;
        bgCtx.beginPath();
        for (let x = -step + off; x < W + step; x += step) {
          bgCtx.moveTo(x + px * 8, 0);
          bgCtx.lineTo(x + px * 8, H);
        }
        for (let y = -step + off; y < H + step; y += step) {
          bgCtx.moveTo(0, y + py * 8);
          bgCtx.lineTo(W, y + py * 8);
        }
        bgCtx.stroke();

        for (const f of fog) {
          f.x += f.vx * dt;
          if (f.x > W + f.r) f.x = -f.r;
          if (f.x < -f.r) f.x = W + f.r;
          const g = bgCtx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
          g.addColorStop(0, 'rgba(190,205,170,0.09)');
          g.addColorStop(1, 'rgba(190,205,170,0)');
          bgCtx.fillStyle = g;
          bgCtx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
        }

        // the closing zone
        const cycle = ((t - zoneStart) % ZONE_SECONDS) / ZONE_SECONDS;
        const maxR = Math.hypot(W, H) * 0.62;
        const zr = maxR * (1 - cycle * 0.72);
        const cx = W * 0.62 + px * 20;
        const cy = H * 0.42 + py * 14;
        bgCtx.fillStyle = 'rgba(40,110,255,0.13)';
        bgCtx.beginPath();
        bgCtx.rect(0, 0, W, H);
        bgCtx.arc(cx, cy, zr, 0, TAU, true);
        bgCtx.fill('evenodd');
        const pulse = 0.55 + 0.35 * Math.sin(t * 3);
        bgCtx.strokeStyle = `rgba(90,170,255,${pulse})`;
        bgCtx.lineWidth = 2.5;
        if (quality > 0.6) {
          bgCtx.shadowColor = 'rgba(90,170,255,0.9)';
          bgCtx.shadowBlur = 16;
        }
        bgCtx.beginPath();
        bgCtx.arc(cx, cy, zr, 0, TAU);
        bgCtx.stroke();
        bgCtx.shadowBlur = 0;

        for (const d of dust) {
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          if (d.x < 0) d.x = W;
          if (d.x > W) d.x = 0;
          if (d.y < 0) d.y = H;
          if (d.y > H) d.y = 0;
          bgCtx.fillStyle = 'rgba(230,235,200,0.35)';
          bgCtx.beginPath();
          bgCtx.arc(d.x, d.y, d.r, 0, TAU);
          bgCtx.fill();
        }

        for (const d of drops) {
          d.y += d.vy * dt;
          if (d.y - d.size * 2 > H) {
            d.y = -d.size * 2;
            d.x = rand(W * 0.08, W * 0.92);
          }
          drawDrop(d, t);
        }

        nextTracer -= dt;
        if (nextTracer <= 0 && quality > 0.5) {
          nextTracer = rand(1.4, 3.6);
          const y = rand(H * 0.1, H * 0.8);
          const dir = Math.random() < 0.5 ? 1 : -1;
          tracers.push({ x: dir > 0 ? -60 : W + 60, y, vx: dir * rand(900, 1500), vy: rand(-120, 120), life: 1 });
        }
        for (let i = tracers.length - 1; i >= 0; i--) {
          const tr = tracers[i];
          tr.x += tr.vx * dt;
          tr.y += tr.vy * dt;
          tr.life -= dt * 0.9;
          if (tr.life <= 0) {
            tracers.splice(i, 1);
            continue;
          }
          bgCtx.strokeStyle = `rgba(255,220,110,${tr.life * 0.85})`;
          bgCtx.lineWidth = 2;
          bgCtx.beginPath();
          bgCtx.moveTo(tr.x, tr.y);
          bgCtx.lineTo(tr.x - tr.vx * 0.06, tr.y - tr.vy * 0.06);
          bgCtx.stroke();
        }

        if (!vignette || vignette.w !== W || vignette.h !== H) {
          const g = bgCtx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.62);
          g.addColorStop(0, 'rgba(0,0,0,0)');
          g.addColorStop(1, 'rgba(0,0,0,0.6)');
          vignette = { g, w: W, h: H };
        }
        bgCtx.fillStyle = vignette.g;
        bgCtx.fillRect(0, 0, W, H);
      },
    };
  }

  /* --- Neon City --- */
  function viceScene() {
    const hy = Math.round(H * 0.66);
    const stars = Array.from({ length: Math.round(70 * quality) }, () => ({ x: rand(0, W), y: rand(0, hy * 0.7), ph: rand(0, TAU), r: rand(0.5, 1.7) }));

    function makeSkyline(color, minH, maxH, minW, maxW, lit) {
      const cv = document.createElement('canvas');
      const sp = Math.min(dpr, 2);
      cv.width = Math.ceil(W * sp);
      cv.height = Math.ceil(hy * sp);
      const c = cv.getContext('2d');
      c.scale(sp, sp);
      const blinkers = [];
      let x = -20;
      while (x < W + 20) {
        const w = rand(minW, maxW);
        const h = rand(minH, maxH);
        c.fillStyle = color;
        c.fillRect(x, hy - h, w, h);
        for (let wy = hy - h + 8; wy < hy - 10; wy += 13) {
          for (let wx = x + 6; wx < x + w - 8; wx += 11) {
            if (Math.random() < lit) {
              const wc = pick(['#ffd23f', '#2ee6ff', '#ff5fae']);
              c.fillStyle = wc;
              c.globalAlpha = 0.75;
              c.fillRect(wx, wy, 4, 6);
              c.globalAlpha = 1;
              if (Math.random() < 0.04) blinkers.push({ x: wx, y: wy, c: wc, ph: rand(0, TAU) });
            }
          }
        }
        x += w + rand(1, 5);
      }
      return { cv, blinkers };
    }

    const far = makeSkyline('#2a0b52', hy * 0.16, hy * 0.42, 26, 60, 0.18);
    const near = makeSkyline('#14042e', hy * 0.12, hy * 0.34, 34, 78, 0.22);

    // the sun, pre-rendered with its signature horizontal cuts
    const sunR = Math.min(W, H) * 0.19;
    const sunCv = document.createElement('canvas');
    const sunSp = Math.min(dpr, 2);
    sunCv.width = sunCv.height = Math.ceil(sunR * 2 * sunSp);
    const sc = sunCv.getContext('2d');
    sc.scale(sunSp, sunSp);
    const sg = sc.createLinearGradient(0, 0, 0, sunR * 2);
    sg.addColorStop(0, '#ffe66d');
    sg.addColorStop(0.5, '#ff8a3d');
    sg.addColorStop(1, '#ff2e93');
    sc.fillStyle = sg;
    sc.beginPath();
    sc.arc(sunR, sunR, sunR, 0, TAU);
    sc.fill();
    sc.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) {
      const y = sunR * (0.95 + i * 0.16);
      sc.fillRect(0, y, sunR * 2, 1.5 + i * 1.6);
    }

    function palm(x, base, height, dir, t) {
      const sway = Math.sin(t * 0.8 + x) * 5;
      const topX = x + dir * height * 0.25 + sway;
      const topY = base - height;
      bgCtx.strokeStyle = '#0a0118';
      bgCtx.lineWidth = Math.max(5, height * 0.045);
      bgCtx.lineCap = 'round';
      bgCtx.beginPath();
      bgCtx.moveTo(x, base);
      bgCtx.quadraticCurveTo(x + dir * height * 0.02, base - height * 0.55, topX, topY);
      bgCtx.stroke();
      bgCtx.lineWidth = 3;
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI * 0.95 + (i / 6) * Math.PI * 0.9;
        const len = height * 0.42;
        const ex = topX + Math.cos(a) * len;
        const ey = topY + Math.sin(a) * len * 0.55 + len * 0.25;
        bgCtx.beginPath();
        bgCtx.moveTo(topX, topY);
        bgCtx.quadraticCurveTo(topX + Math.cos(a) * len * 0.5, topY + Math.sin(a) * len * 0.9 - 6 + Math.sin(t * 1.2 + i) * 2, ex, ey);
        bgCtx.stroke();
      }
    }

    let shooting = null;
    let nextShoot = 4;

    return {
      draw(t, dt) {
        gradientFill([[0, '#08001f'], [0.3, '#2a0a5c'], [0.55, '#9b1a86'], [hy / H, '#ff3e8f'], [Math.min(1, hy / H + 0.001), '#0d0220'], [1, '#170436']]);

        for (const s of stars) {
          const a = 0.3 + 0.7 * Math.abs(Math.sin(t * 1.2 + s.ph));
          bgCtx.fillStyle = `rgba(255,255,255,${a})`;
          bgCtx.fillRect(s.x + px * 6, s.y + py * 4, s.r, s.r);
        }

        nextShoot -= dt;
        if (nextShoot <= 0 && !shooting) {
          shooting = { x: rand(W * 0.2, W * 0.9), y: rand(0, hy * 0.3), life: 1 };
          nextShoot = rand(5, 10);
        }
        if (shooting) {
          shooting.x -= 520 * dt;
          shooting.y += 200 * dt;
          shooting.life -= dt * 1.4;
          if (shooting.life <= 0) shooting = null;
          else {
            bgCtx.strokeStyle = `rgba(255,255,255,${shooting.life})`;
            bgCtx.lineWidth = 2;
            bgCtx.beginPath();
            bgCtx.moveTo(shooting.x, shooting.y);
            bgCtx.lineTo(shooting.x + 90, shooting.y - 34);
            bgCtx.stroke();
          }
        }

        const pulse = 1 + 0.015 * Math.sin(t * 1.6);
        const sd = sunR * 2 * pulse;
        bgCtx.save();
        if (quality > 0.6) {
          bgCtx.shadowColor = 'rgba(255,60,150,0.85)';
          bgCtx.shadowBlur = 50;
        }
        bgCtx.drawImage(sunCv, W / 2 - sd / 2 + px * 10, hy - sd * 0.62, sd, sd);
        bgCtx.restore();

        const drawLayer = (layer, shift) => {
          bgCtx.drawImage(layer.cv, shift, 0, W, hy);
          for (const b of layer.blinkers) {
            const a = Math.sin(t * 2 + b.ph) > 0.2 ? 0.9 : 0.05;
            bgCtx.globalAlpha = a;
            bgCtx.fillStyle = b.c;
            bgCtx.fillRect(b.x + shift, b.y, 4, 6);
          }
          bgCtx.globalAlpha = 1;
        };
        drawLayer(far, px * 8);
        drawLayer(near, px * 18);

        palm(W * 0.06, hy + 6, H * 0.34, 1, t);
        palm(W * 0.94, hy + 6, H * 0.3, -1, t);

        // neon grid floor in perspective
        const vx = W / 2 + px * 30;
        bgCtx.save();
        bgCtx.beginPath();
        bgCtx.rect(0, hy, W, H - hy);
        bgCtx.clip();
        bgCtx.lineWidth = 1.4;
        if (quality > 0.6) {
          bgCtx.shadowColor = '#ff2e93';
          bgCtx.shadowBlur = 8;
        }
        bgCtx.strokeStyle = 'rgba(255,46,147,0.75)';
        bgCtx.beginPath();
        const cols = 22;
        for (let i = -cols; i <= cols; i++) {
          bgCtx.moveTo(vx, hy);
          bgCtx.lineTo(vx + i * (W / 6.5), H);
        }
        bgCtx.stroke();
        bgCtx.strokeStyle = 'rgba(46,230,255,0.65)';
        bgCtx.beginPath();
        const rows = 14;
        const scroll = (t * 0.5) % 1;
        for (let i = 0; i < rows; i++) {
          const f = (i + scroll) / rows;
          const y = hy + (H - hy) * f * f;
          bgCtx.moveTo(0, y);
          bgCtx.lineTo(W, y);
        }
        bgCtx.stroke();
        bgCtx.restore();

        const haze = bgCtx.createLinearGradient(0, hy - 30, 0, hy + 60);
        haze.addColorStop(0, 'rgba(255,60,150,0)');
        haze.addColorStop(0.5, 'rgba(255,60,150,0.28)');
        haze.addColorStop(1, 'rgba(255,60,150,0)');
        bgCtx.fillStyle = haze;
        bgCtx.fillRect(0, hy - 30, W, 90);
      },
    };
  }

  /* --- Midnight & Daylight --- */
  function softScene(dark) {
    const blobs = Array.from({ length: 4 }, (_, i) => ({
      x: rand(0, W),
      y: rand(0, H),
      r: rand(Math.min(W, H) * 0.3, Math.min(W, H) * 0.6),
      vx: rand(-12, 12),
      vy: rand(-9, 9),
      c: dark ? pick(['124,92,255', '255,184,77', '58,160,255', '240,80,140']) : pick(['124,92,255', '255,160,90', '80,170,255', '90,210,150']),
      a: dark ? 0.2 : 0.16,
    }));
    const stars = dark ? Array.from({ length: Math.round(60 * quality) }, () => ({ x: rand(0, W), y: rand(0, H), ph: rand(0, TAU), r: rand(0.5, 1.6) })) : [];
    return {
      draw(t, dt) {
        if (dark) gradientFill([[0, '#0d0b24'], [1, '#1b1740']]);
        else gradientFill([[0, '#f6f7ff'], [1, '#dfe4ff']]);
        for (const b of blobs) {
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          if (b.x < -b.r || b.x > W + b.r) b.vx *= -1;
          if (b.y < -b.r || b.y > H + b.r) b.vy *= -1;
          const g = bgCtx.createRadialGradient(b.x + px * 20, b.y + py * 20, 0, b.x, b.y, b.r);
          g.addColorStop(0, `rgba(${b.c},${b.a})`);
          g.addColorStop(1, `rgba(${b.c},0)`);
          bgCtx.fillStyle = g;
          bgCtx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
        }
        for (const s of stars) {
          bgCtx.fillStyle = `rgba(255,255,255,${0.25 + 0.75 * Math.abs(Math.sin(t + s.ph))})`;
          bgCtx.fillRect(s.x, s.y, s.r, s.r);
        }
      },
    };
  }

  function buildScene() {
    if (!W || !H) return;
    spriteCache.clear();
    if (themeKey === 'candy') scene = candyScene();
    else if (themeKey === 'battle') scene = battleScene();
    else if (themeKey === 'vice') scene = viceScene();
    else scene = softScene(themeKey !== 'light');
  }

  /* ----------------------------------------------------------- particles */

  function paletteColors(custom) {
    return custom && custom.length ? custom : PALETTES[themeKey] || PALETTES.candy;
  }

  function addParticle(p) {
    if (particles.length >= MAX_PARTICLES * Math.max(quality, 0.5)) particles.shift();
    particles.push(p);
    fxDirty = true;
    kick();
  }

  function burst(target, opts) {
    if (reduceMotion) return;
    const o = opts || {};
    const { x, y } = pointOf(target);
    const kind = o.kind || 'spark';
    const count = Math.round((o.count || 24) * Math.max(quality, 0.5));
    const colors = paletteColors(o.colors);
    const power = o.power || 1;
    for (let i = 0; i < count; i++) {
      const a = o.cone ? -Math.PI / 2 + rand(-o.cone, o.cone) : rand(0, TAU);
      const sp = rand(120, 520) * power;
      const base = {
        kind,
        x: x + rand(-4, 4),
        y: y + rand(-4, 4),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        color: pick(colors),
        life: 0,
        max: rand(0.7, 1.4),
        rot: rand(0, TAU),
        vr: rand(-8, 8),
        size: rand(3, 7),
        g: 900,
        drag: 0.985,
      };
      if (kind === 'confetti') Object.assign(base, { size: rand(6, 11), g: 520, max: rand(1.8, 3), drag: 0.975 });
      if (kind === 'coin') Object.assign(base, { size: rand(9, 14), g: 760, max: rand(1.3, 2), spin: rand(0, TAU) });
      if (kind === 'star') Object.assign(base, { size: rand(8, 15), g: 380, max: rand(0.9, 1.5) });
      if (kind === 'candy') {
        const shape = pick(['ball', 'bean', 'wrap', 'star', 'heart']);
        const size = Math.round(rand(16, 30));
        Object.assign(base, { sprite: candySprite(shape, base.color, size), size, g: 820, max: rand(1.2, 1.9) });
      }
      addParticle(base);
    }
  }

  function shockwave(target, color) {
    if (reduceMotion) return;
    const { x, y } = pointOf(target);
    addParticle({ kind: 'ring', x, y, life: 0, max: 0.7, color: color || pick(paletteColors()), size: 10 });
  }

  function drawParticles(dt) {
    fxCtx.clearRect(0, 0, W, H);
    if (!particles.length) {
      fxDirty = false;
      return;
    }
    fxCtx.globalCompositeOperation = 'source-over';
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.max) {
        particles.splice(i, 1);
        continue;
      }
      const k = p.life / p.max;
      const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      if (p.kind === 'ring') {
        fxCtx.strokeStyle = p.color;
        fxCtx.globalAlpha = (1 - k) * 0.8;
        fxCtx.lineWidth = 4 * (1 - k) + 1;
        fxCtx.beginPath();
        fxCtx.arc(p.x, p.y, p.size + k * 120, 0, TAU);
        fxCtx.stroke();
        continue;
      }
      p.vy += p.g * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      fxCtx.globalAlpha = fade;
      fxCtx.fillStyle = p.color;
      if (p.kind === 'spark') {
        fxCtx.globalCompositeOperation = 'lighter';
        fxCtx.beginPath();
        fxCtx.arc(p.x, p.y, p.size * (1 - k * 0.6), 0, TAU);
        fxCtx.fill();
        fxCtx.globalCompositeOperation = 'source-over';
      } else if (p.kind === 'confetti') {
        fxCtx.save();
        fxCtx.translate(p.x, p.y);
        fxCtx.rotate(p.rot);
        fxCtx.scale(1, Math.abs(Math.cos(p.rot * 1.3)) * 0.8 + 0.2);
        fxCtx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        fxCtx.restore();
      } else if (p.kind === 'coin') {
        p.spin += dt * 12;
        fxCtx.save();
        fxCtx.translate(p.x, p.y);
        fxCtx.scale(Math.max(0.15, Math.abs(Math.cos(p.spin))), 1);
        fxCtx.fillStyle = '#ffd23f';
        fxCtx.beginPath();
        fxCtx.arc(0, 0, p.size, 0, TAU);
        fxCtx.fill();
        fxCtx.strokeStyle = '#c98f00';
        fxCtx.lineWidth = 2;
        fxCtx.stroke();
        fxCtx.restore();
      } else if (p.kind === 'star') {
        fxCtx.save();
        fxCtx.translate(p.x, p.y);
        fxCtx.rotate(p.rot);
        fxCtx.fillStyle = p.color;
        starPath(fxCtx, p.size * (0.6 + 0.4 * Math.sin(p.life * 18)), 0.45);
        fxCtx.fill();
        fxCtx.restore();
      } else if (p.kind === 'candy' && p.sprite) {
        const d = p.sprite.width / Math.min(dpr, 2);
        fxCtx.save();
        fxCtx.translate(p.x, p.y);
        fxCtx.rotate(p.rot);
        fxCtx.drawImage(p.sprite, -d / 2, -d / 2, d, d);
        fxCtx.restore();
      }
    }
    fxCtx.globalAlpha = 1;
  }

  /* ---------------------------------------------------------- DOM helpers */

  function pointOf(target) {
    if (target && typeof target.getBoundingClientRect === 'function') {
      const r = target.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    if (target && typeof target.x === 'number') return target;
    return { x: W / 2, y: H / 2 };
  }

  function floatText(target, text, opts) {
    if (!fxLayer) return;
    const o = opts || {};
    const { x, y } = pointOf(target);
    const el = document.createElement('div');
    el.className = 'float-text' + (o.cls ? ' ' + o.cls : '');
    el.textContent = text;
    el.style.left = clamp(x, 40, W - 40) + 'px';
    el.style.top = y + 'px';
    if (o.color) el.style.color = o.color;
    if (o.size) el.style.fontSize = o.size;
    fxLayer.appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }

  function shake(el, cls) {
    if (!el || reduceMotion) return;
    const c = cls || 'shake';
    el.classList.remove(c);
    void el.offsetWidth;
    el.classList.add(c);
    setTimeout(() => el.classList.remove(c), 700);
  }

  function flash(color) {
    if (reduceMotion) return;
    const el = document.getElementById('screenFlash');
    if (!el) return;
    el.style.setProperty('--flash', color || 'rgba(255,255,255,0.5)');
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  function celebrate() {
    const kind = themeKey === 'vice' ? 'coin' : themeKey === 'candy' ? 'candy' : 'star';
    const waves = 9;
    for (let i = 0; i < waves; i++) {
      setTimeout(() => {
        const x = rand(W * 0.12, W * 0.88);
        const y = rand(H * 0.18, H * 0.5);
        burst({ x, y }, { kind: 'confetti', count: 26, power: 1.1 });
        burst({ x, y }, { kind, count: 12, power: 0.9 });
        burst({ x, y }, { kind: 'spark', count: 18, power: 1.2 });
        shockwave({ x, y });
      }, i * 260);
    }
  }

  /* --------------------------------------------------------------- loop */

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, W * H > 2000000 ? 1.5 : 2);
    for (const cv of [bgCanvas, fxCanvas]) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px';
      cv.style.height = H + 'px';
    }
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildScene();
    drawStill();
  }

  function drawStill() {
    if (scene) scene.draw(performance.now() / 1000, 0);
  }

  function kick() {
    if (reduceMotion || running || document.hidden) return;
    running = true;
    lastT = performance.now();
    requestAnimationFrame(frame);
  }

  function frame(now) {
    if (document.hidden) {
      running = false;
      return;
    }
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    px += (tpx - px) * Math.min(1, dt * 4);
    py += (tpy - py) * Math.min(1, dt * 4);
    if (scene) scene.draw(now / 1000, dt);
    if (fxDirty) drawParticles(dt);

    frames += 1;
    frameMs += dt * 1000;
    if (frames === 50) {
      const avg = frameMs / frames;
      if (avg > 28 && quality > 0.45) {
        quality *= 0.72;
        buildScene();
      }
      frames = 0;
      frameMs = 0;
    }
    requestAnimationFrame(frame);
  }

  function setTheme(key) {
    themeKey = PALETTES[key] ? key : 'candy';
    if (bgCanvas) {
      buildScene();
      drawStill();
    }
  }

  function init(initialTheme) {
    bgCanvas = document.getElementById('bgCanvas');
    fxCanvas = document.getElementById('fxCanvas');
    fxLayer = document.getElementById('fxLayer');
    if (!bgCanvas || !fxCanvas) return;
    bgCtx = bgCanvas.getContext('2d');
    fxCtx = fxCanvas.getContext('2d');
    themeKey = PALETTES[initialTheme] ? initialTheme : 'candy';
    resize();

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 120);
    });
    window.addEventListener('orientationchange', () => setTimeout(resize, 250));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) kick();
    });
    window.addEventListener('pointermove', (e) => {
      tpx = (e.clientX / W - 0.5) * 2;
      tpy = (e.clientY / H - 0.5) * 2;
    }, { passive: true });

    if (!reduceMotion) {
      running = true;
      lastT = performance.now();
      requestAnimationFrame(frame);
    }
  }

  return { init, setTheme, burst, shockwave, floatText, shake, flash, celebrate, get reduceMotion() { return reduceMotion; }, palette: () => paletteColors() };
})();

// Kept for callers that only want a quick confetti pop.
function fireConfetti() {
  Engine.celebrate();
}
