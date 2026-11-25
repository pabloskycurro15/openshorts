import { useEffect, useRef } from 'react';
import type { AssistantState } from '@jarvis/shared';
import { prefersReducedMotion } from '../lib/settings';

/**
 * Núcleo visual de JARVIS dibujado en Canvas 2D (sin dependencias, bajo consumo).
 * Cada estado define unos parámetros objetivo; el render interpola hacia ellos para
 * que las transiciones sean suaves. El bucle se pausa si la pestaña está oculta o
 * el núcleo no es visible, y respeta prefers-reduced-motion / intensidad 0.
 */

interface Params {
  spin: number; // velocidad de los anillos
  glow: number; // intensidad del halo (0-1)
  wave: number; // amplitud de la onda de audio (0-1)
  waveFreq: number; // frecuencia de la onda
  particleSpeed: number;
  inward: number; // 0 = órbita, 1 = las partículas convergen al centro
  pulse: number; // latido del núcleo
  scan: number; // barrido del anillo de marcas (0-1)
  jitter: number; // temblor (error)
  hue: 0 | 1 | 2; // 0 = acento, 1 = peligro, 2 = gris
}

export const STATE_PARAMS: Record<AssistantState, Params> = {
  idle: { spin: 0.15, glow: 0.45, wave: 0.12, waveFreq: 3, particleSpeed: 0.25, inward: 0, pulse: 0.25, scan: 0, jitter: 0, hue: 0 },
  listening: { spin: 0.3, glow: 0.7, wave: 0.75, waveFreq: 7, particleSpeed: 0.35, inward: 0.15, pulse: 0.4, scan: 0, jitter: 0, hue: 0 },
  processing: { spin: 0.9, glow: 0.6, wave: 0.25, waveFreq: 5, particleSpeed: 0.8, inward: 0.55, pulse: 0.3, scan: 1, jitter: 0, hue: 0 },
  thinking: { spin: 1.4, glow: 0.8, wave: 0.35, waveFreq: 9, particleSpeed: 1.1, inward: 0.85, pulse: 0.55, scan: 0.6, jitter: 0, hue: 0 },
  speaking: { spin: 0.5, glow: 0.95, wave: 1, waveFreq: 4, particleSpeed: 0.5, inward: 0, pulse: 0.9, scan: 0, jitter: 0, hue: 0 },
  executing: { spin: 1.1, glow: 0.75, wave: 0.3, waveFreq: 12, particleSpeed: 1.6, inward: 0, pulse: 0.35, scan: 1, jitter: 0, hue: 0 },
  error: { spin: 0.2, glow: 0.7, wave: 0.45, waveFreq: 14, particleSpeed: 0.2, inward: 0, pulse: 0.6, scan: 0, jitter: 1, hue: 1 },
  offline: { spin: 0.04, glow: 0.12, wave: 0.03, waveFreq: 2, particleSpeed: 0.05, inward: 0, pulse: 0.05, scan: 0, jitter: 0, hue: 2 },
};

const DANGER = '#ff4d4f';
const GRAY = '#5a6b88';
const NAVY = '#13284a';

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

function mix(a: string, b: string, t: number) {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const c = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `#${((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1)}`;
}

interface Particle {
  a: number; // ángulo
  r: number; // radio relativo (0-1.5)
  s: number; // velocidad propia
  size: number;
}

export interface AICoreProps {
  state: AssistantState;
  accent: string;
  /** 0 = estático, 1 = normal, 1.5 = intenso */
  motion?: number;
  particles?: boolean;
  className?: string;
  label?: string;
}

export function AICore({ state, accent, motion = 1, particles = true, className, label }: AICoreProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ state, accent, motion, particles });
  propsRef.current = { state, accent, motion, particles };
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const cur: Params = { ...STATE_PARAMS[propsRef.current.state] };
    // Mezcla de color continua: 0 acento, 1 peligro, 2 gris → interpolamos pesos.
    const hueW = [1, 0, 0];
    const parts: Particle[] = Array.from({ length: 90 }, () => ({
      a: Math.random() * Math.PI * 2,
      r: 0.45 + Math.random() * 1.0,
      s: 0.4 + Math.random() * 0.9,
      size: 0.6 + Math.random() * 1.6,
    }));

    let w = 0;
    let h = 0;
    let dpr = 1;
    let t = 0;
    let last = performance.now();
    let raf = 0;
    let visible = true;
    let running = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const color = () => {
      const { accent: acc } = propsRef.current;
      // Media ponderada de los tres colores posibles.
      const ad = mix(acc, DANGER, hueW[1]! / Math.max(hueW[0]! + hueW[1]!, 1e-6));
      return mix(ad, GRAY, hueW[2]!);
    };

    const draw = (dt: number) => {
      const { state: st, motion: mo, particles: showParticles } = propsRef.current;
      const target = STATE_PARAMS[st];
      const k = 1 - Math.exp(-dt * 3.5);
      (Object.keys(target) as (keyof Params)[]).forEach((key) => {
        if (key !== 'hue') (cur[key] as number) += ((target[key] as number) - (cur[key] as number)) * k;
      });
      for (let i = 0; i < 3; i++) hueW[i]! += ((target.hue === i ? 1 : 0) - hueW[i]!) * k;

      const speed = mo;
      t += dt * speed;
      const c = color();
      const cx = w / 2 + (cur.jitter > 0.05 ? (Math.random() - 0.5) * 3 * cur.jitter : 0);
      const cy = h / 2;
      const R = Math.min(w, h) * 0.3;

      ctx.clearRect(0, 0, w, h);

      // Halo exterior
      const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.9);
      halo.addColorStop(0, rgba(c, 0.22 * cur.glow));
      halo.addColorStop(0.5, rgba(c, 0.07 * cur.glow));
      halo.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      // Anillo de marcas con barrido
      const ticks = 120;
      const scanPos = (t * 0.9) % (Math.PI * 2);
      for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * Math.PI * 2;
        const d = Math.abs(((a - scanPos + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        const lit = cur.scan * Math.max(0, 1 - d / 0.9);
        const long = i % 10 === 0;
        const r1 = R * 1.32;
        const r2 = R * (long ? 1.42 : 1.37);
        ctx.strokeStyle = lit > 0.02 ? rgba(c, 0.25 + lit * 0.75) : rgba(NAVY, 0.9);
        ctx.lineWidth = long ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }

      // Anillos giratorios segmentados
      const rings: [number, number, number, number][] = [
        // radio, dirección, nº de segmentos, grosor
        [1.15, 1, 3, 2.5],
        [0.98, -1.6, 5, 1.5],
        [0.84, 2.3, 8, 1],
      ];
      ctx.lineCap = 'round';
      for (const [rr, dir, segs, lw] of rings) {
        const rot = t * cur.spin * dir;
        const span = (Math.PI * 2) / segs;
        ctx.strokeStyle = rgba(c, 0.35 + cur.glow * 0.5);
        ctx.lineWidth = lw;
        ctx.shadowColor = rgba(c, 0.8);
        ctx.shadowBlur = 8 * cur.glow;
        for (let s = 0; s < segs; s++) {
          ctx.beginPath();
          ctx.arc(cx, cy, R * rr, rot + s * span, rot + s * span + span * 0.62);
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;

      // Onda de audio circular
      const N = 160;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const n =
          Math.sin(a * cur.waveFreq + t * 4) * 0.5 +
          Math.sin(a * (cur.waveFreq * 0.5 + 1) - t * 2.7) * 0.3 +
          Math.sin(a * 2 + t * 6) * 0.2;
        const r = R * 0.66 + n * R * 0.11 * cur.wave;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(c, 0.5 + cur.wave * 0.4);
      ctx.lineWidth = 1.5;
      ctx.shadowColor = rgba(c, 0.9);
      ctx.shadowBlur = 12 * cur.glow;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Partículas
      if (showParticles) {
        for (const p of parts) {
          p.a += dt * speed * cur.particleSpeed * p.s * 0.6;
          if (cur.inward > 0.05) {
            p.r -= dt * speed * cur.inward * p.s * 0.35;
            if (p.r < 0.35) p.r = 1.2 + Math.random() * 0.3;
          }
          const x = cx + Math.cos(p.a) * R * p.r;
          const y = cy + Math.sin(p.a) * R * p.r * 0.92;
          const alpha = 0.25 + 0.6 * (1 - Math.abs(p.r - 0.9) / 0.9);
          ctx.fillStyle = rgba(c, alpha * (0.4 + cur.glow * 0.6));
          ctx.beginPath();
          ctx.arc(x, y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Esfera central con latido
      const beat = 1 + Math.sin(t * 3.2) * 0.06 * cur.pulse;
      const coreR = R * 0.42 * beat;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      g.addColorStop(0, rgba('#fff4e6', 0.95 * (0.35 + cur.glow * 0.65)));
      g.addColorStop(0.25, rgba(c, 0.85 * (0.3 + cur.glow * 0.7)));
      g.addColorStop(0.7, rgba(c, 0.18 * cur.glow));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // Anillo interior fino
      ctx.strokeStyle = rgba(c, 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    };

    const isStatic = () => propsRef.current.motion === 0 || prefersReducedMotion();

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      draw(dt);
      if (visible && !document.hidden && !isStatic()) raf = requestAnimationFrame(loop);
      else running = false;
    };

    const start = () => {
      if (isStatic()) {
        // Sin animación: fijar parámetros del estado y dibujar un único fotograma.
        Object.assign(cur, STATE_PARAMS[propsRef.current.state]);
        for (let i = 0; i < 3; i++) hueW[i] = STATE_PARAMS[propsRef.current.state].hue === i ? 1 : 0;
        draw(0);
        return;
      }
      if (running || !visible || document.hidden) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    redrawRef.current = start;

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (!running) start();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) start();
    });
    io.observe(canvas);
    const onVis = () => {
      if (!document.hidden) start();
    };
    document.addEventListener('visibilitychange', onVis);
    start();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // Cambios de estado o ajustes: reactivar el bucle o redibujar el fotograma estático.
  useEffect(() => {
    redrawRef.current();
  }, [state, accent, motion, particles]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={label ?? `Núcleo de JARVIS: ${state}`}
      data-state={state}
    />
  );
}
