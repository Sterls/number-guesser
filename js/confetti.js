// A short burst of tumbling confetti squares over the whole screen.
// Skipped when the phone asks for reduced motion.

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function confetti(colors, { count = 110, duration = 2600 } = {}) {
  if (reduceMotion()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  // Two fountains from the lower corners, angled towards the middle.
  const bits = Array.from({ length: count }, (_, i) => {
    const left = i % 2 === 0;
    const tilt = 0.12 + Math.random() * 0.4; // radians away from straight up
    const speed = h * (0.016 + Math.random() * 0.012);
    return {
      x: left ? w * 0.05 : w * 0.95,
      y: h,
      vx: (left ? 1 : -1) * Math.sin(tilt) * speed,
      vy: -Math.cos(tilt) * speed,
      size: 7 + Math.random() * 8,
      spin: (Math.random() - 0.5) * 0.4,
      turn: Math.random() * Math.PI,
      flip: Math.random() * Math.PI,
      color: colors[i % colors.length],
    };
  });

  const start = performance.now();
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    const fade = Math.min(1, Math.max(0, (duration - t) / 600));
    for (const b of bits) {
      b.vy += h * 0.00045; // gravity
      b.vx *= 0.99;
      b.vy *= 0.99;
      b.x += b.vx;
      b.y += b.vy;
      b.turn += b.spin;
      b.flip += 0.15;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.turn);
      ctx.scale(1, Math.cos(b.flip)); // tumble
      ctx.fillStyle = b.color;
      ctx.fillRect(-b.size / 2, -b.size / 2, b.size, b.size);
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
