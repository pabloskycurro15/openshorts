import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../lib/settings';

/**
 * Fondo espacial: tres capas de estrellas con paralaje, centelleo, estrellas fugaces
 * ocasionales y nebulosas del color de acento. Fijo detrás de toda la interfaz.
 * Limitado a ~30 fps y pausado con la pestaña oculta.
 */
export function Starfield({ accent, motion = 1 }: { accent: string; motion?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const props = useRef({ accent, motion });
  props.current = { accent, motion };

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let w = 0, h = 0, raf = 0, last = 0, t = 0;
    type Star = { x: number; y: number; z: number; tw: number; s: number };
    let stars: Star[] = [];
    let shooting: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
    let nextShoot = 4 + Math.random() * 6;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(420, Math.round((w * h) / 4500));
      stars = Array.from({ length: count }, () => ({ x: Math.random() * w, y: Math.random() * h, z: Math.random() < 0.6 ? 0.3 : Math.random() < 0.8 ? 0.6 : 1, tw: Math.random() * 10, s: Math.random() }));
    };

    const rgb = () => {
      const n = parseInt(props.current.accent.slice(1), 16);
      return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    };

    const draw = (dt: number) => {
      const mo = props.current.motion;
      t += dt * mo;
      ctx.clearRect(0, 0, w, h);
      const c = rgb();
      // Nebulosas
      const neb = (x: number, y: number, r: number, a: number, col: string) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${col},${a})`);
        g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      };
      neb(w * 0.78 + Math.sin(t * 0.03) * 40, h * 0.22, Math.max(w, h) * 0.45, 0.07, c);
      neb(w * 0.15, h * 0.85 + Math.cos(t * 0.025) * 30, Math.max(w, h) * 0.4, 0.09, '28,56,102');
      // Estrellas con paralaje (derivan lentamente hacia la izquierda)
      for (const s of stars) {
        s.x -= dt * mo * s.z * 4;
        if (s.x < -2) { s.x = w + 2; s.y = Math.random() * h; }
        const tw = 0.55 + 0.45 * Math.sin(t * (1 + s.s * 2) + s.tw);
        const a = (0.25 + s.z * 0.6) * tw;
        const size = s.z === 1 ? 1.6 : s.z === 0.6 ? 1.1 : 0.8;
        ctx.fillStyle = s.s > 0.9 ? `rgba(${c},${a})` : `rgba(226,234,248,${a})`;
        ctx.fillRect(s.x, s.y, size, size);
      }
      // Estrella fugaz
      nextShoot -= dt * mo;
      if (!shooting && nextShoot <= 0) {
        shooting = { x: Math.random() * w * 0.8 + w * 0.2, y: Math.random() * h * 0.4, vx: -(400 + Math.random() * 300), vy: 160 + Math.random() * 120, life: 1 };
        nextShoot = 6 + Math.random() * 10;
      }
      if (shooting) {
        shooting.x += shooting.vx * dt; shooting.y += shooting.vy * dt; shooting.life -= dt * 1.2;
        const g = ctx.createLinearGradient(shooting.x, shooting.y, shooting.x - shooting.vx * 0.12, shooting.y - shooting.vy * 0.12);
        g.addColorStop(0, `rgba(255,240,220,${Math.max(0, shooting.life)})`);
        g.addColorStop(1, 'rgba(255,240,220,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(shooting.x, shooting.y); ctx.lineTo(shooting.x - shooting.vx * 0.12, shooting.y - shooting.vy * 0.12); ctx.stroke();
        if (shooting.life <= 0) shooting = null;
      }
    };

    const isStatic = () => props.current.motion === 0 || prefersReducedMotion();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const dt = (now - last) / 1000;
      if (dt < 1 / 30) return; // ~30 fps: suficiente para el fondo
      last = now;
      draw(Math.min(dt, 0.1));
    };
    resize();
    const onResize = () => { resize(); if (isStatic()) draw(0); };
    window.addEventListener('resize', onResize);
    if (isStatic()) draw(0);
    else raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [motion]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-0 h-full w-full" />;
}
