// Minimal canvas confetti burst — no dependency.
function fireConfetti() {
  const colors = ['#e64c66', '#3aa0ff', '#ffc23a', '#35c46f', '#7c5cff', '#ffb84d'];
  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '999';
  document.body.appendChild(canvas);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const count = 120;
  const particles = Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: -20 - Math.random() * height * 0.4,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 10,
    color: colors[Math.floor(Math.random() * colors.length)],
    vy: 2.5 + Math.random() * 3.5,
    vx: -1.5 + Math.random() * 3,
    rotation: Math.random() * Math.PI,
    vr: -0.2 + Math.random() * 0.4,
  }));

  const durationMs = 3200;
  const start = performance.now();

  function frame(now) {
    const elapsed = now - start;
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (elapsed < durationMs) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(frame);
}
