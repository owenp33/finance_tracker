import { useEffect, useRef } from 'react';
import { seedSky, stepSky, SKY_SPEED } from '../utils/sky';

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const MAX_PIXEL_RATIO = 1.5;     // sharp enough for small stars without drawing a huge canvas on big screens

// One frame: stars twinkling by the time `t` (seconds), shooting stars with a fading tail, emojis bobbing
function drawSky(ctx, sky, t) {
  ctx.clearRect(0, 0, sky.width, sky.height);

  for (const s of sky.stars) {
    ctx.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * s.twinkle * SKY_SPEED + s.phase));
    ctx.fillStyle = s.lime ? '#d9f99d' : '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (const m of sky.meteors) {
    const fade = Math.max(0, 1 - m.age / m.life);
    const speed = Math.hypot(m.vx, m.vy);
    const tailX = m.x - (m.vx / speed) * m.length;
    const tailY = m.y - (m.vy / speed) * m.length;
    const tail = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
    tail.addColorStop(0, m.lime ? `rgba(217, 249, 157, ${fade})` : `rgba(255, 255, 255, ${fade})`);
    tail.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.strokeStyle = tail;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();
  }

  ctx.textBaseline = 'middle';
  for (const c of sky.coins) {
    ctx.globalAlpha = c.alpha;
    ctx.font = `${c.size}px ${EMOJI_FONT}`;
    ctx.fillText(c.emoji, c.x, c.y + Math.sin(t * 1.3 * SKY_SPEED + c.phase) * c.bob);
  }
  ctx.globalAlpha = 1;
}

// The background sky: twinkling stars, shooting stars and money emojis drifting across (utils/sky), on a
// canvas fixed behind every card (styles/base.css .background-sky), so they show in the gaps and across
// the login screen. It pauses while the tab is hidden, draws one still frame for anyone who asks for
// reduced motion, and draws nothing where the browser has no canvas.
export default function BackgroundSky() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) return undefined;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

    let sky = null;
    let frame = 0;
    let last = 0;
    let running = false;

    const now = () => performance.now() / 1000;

    const resize = () => {
      const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      sky = seedSky(width, height);
      drawSky(ctx, sky, now());
    };

    const tick = (time) => {
      if (!running) return;
      const dt = last ? Math.min(0.05, (time - last) / 1000) : 0;
      last = time;
      sky = stepSky(sky, dt, time / 1000);
      drawSky(ctx, sky, time / 1000);
      frame = window.requestAnimationFrame(tick);
    };

    const start = () => {
      if (running || reducedMotion?.matches || document.hidden) return;
      running = true;
      last = 0;
      frame = window.requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      window.cancelAnimationFrame(frame);
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    const onMotionSetting = () => (reducedMotion.matches ? stop() : start());

    resize();
    start();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    reducedMotion?.addEventListener?.('change', onMotionSetting);

    return () => {
      stop();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      reducedMotion?.removeEventListener?.('change', onMotionSetting);
    };
  }, []);

  return <canvas ref={canvasRef} className="background-sky" aria-hidden="true" />;
}
