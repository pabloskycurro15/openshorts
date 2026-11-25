import { useEffect, useRef } from 'react';
import type { AssistantState } from '@jarvis/shared';
import { prefersReducedMotion } from '../lib/settings';

/**
 * Núcleo holográfico de JARVIS (Canvas 2D, sin dependencias).
 * Una esfera de ~1600 partículas que gira en 3D, rodeada de anillos de datos, una
 * corona de marcas que reacciona como un ecualizador, una órbita punteada y
 * etiquetas técnicas. Flota suavemente. Cada estado define parámetros objetivo y el
 * render interpola hacia ellos. Se pausa oculto/fuera de pantalla y respeta
 * «reducir movimiento».
 */

interface Params {
  spin: number; // velocidad de giro de la esfera y anillos
  glow: number; // intensidad del brillo (0-1)
  wave: number; // amplitud de la corona (0-1)
  waveFreq: number;
  particleSpeed: number; // satélites y órbita
  inward: number; // contracción de la esfera (pensar)
  pulse: number; // latido
  scan: number; // barrido radar (0-1)
  jitter: number; // temblor (error)
  hue: 0 | 1 | 2; // 0 acento, 1 peligro, 2 gris
}

export const STATE_PARAMS: Record<AssistantState, Params> = {
  idle: { spin: 0.18, glow: 0.55, wave: 0.18, waveFreq: 3, particleSpeed: 0.25, inward: 0, pulse: 0.25, scan: 0, jitter: 0, hue: 0 },
  listening: { spin: 0.3, glow: 0.8, wave: 0.85, waveFreq: 7, particleSpeed: 0.4, inward: 0.1, pulse: 0.45, scan: 0, jitter: 0, hue: 0 },
  processing: { spin: 0.8, glow: 0.7, wave: 0.3, waveFreq: 5, particleSpeed: 0.9, inward: 0.35, pulse: 0.3, scan: 1, jitter: 0, hue: 0 },
  thinking: { spin: 1.3, glow: 0.85, wave: 0.4, waveFreq: 9, particleSpeed: 1.2, inward: 0.6, pulse: 0.55, scan: 0.6, jitter: 0, hue: 0 },
  speaking: { spin: 0.5, glow: 1, wave: 1, waveFreq: 4, particleSpeed: 0.6, inward: 0, pulse: 0.9, scan: 0, jitter: 0, hue: 0 },
  executing: { spin: 1, glow: 0.8, wave: 0.35, waveFreq: 12, particleSpeed: 1.6, inward: 0.2, pulse: 0.35, scan: 1, jitter: 0, hue: 0 },
  error: { spin: 0.2, glow: 0.75, wave: 0.5, waveFreq: 14, particleSpeed: 0.2, inward: 0, pulse: 0.6, scan: 0, jitter: 1, hue: 1 },
  offline: { spin: 0.05, glow: 0.18, wave: 0.04, waveFreq: 2, particleSpeed: 0.05, inward: 0, pulse: 0.05, scan: 0, jitter: 0, hue: 2 },
};

const DANGER = '#ff4d4f';
const GRAY = '#5a6b88';
const N_SURFACE = 2000;
const N_VOLUME = 1600;
const N_SPHERE = N_SURFACE + N_VOLUME;
const LABELS = ['NÚCLEO 07', 'RED ORBITAL', 'ENLACE SIN', 'FLUJO SIS'];

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const css = (c: [number, number, number], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

export interface AICoreProps {
  state: AssistantState;
  accent: string;
  /** 0 = estático, 1 = normal, 1.5 = intenso */
  motion?: number;
  particles?: boolean;
  className?: string;
  label?: string;
  /** Mostrar etiquetas técnicas alrededor (desactivar en tamaños pequeños). */
  labels?: boolean;
}

export function AICore({ state, accent, motion = 1, particles = true, className, label, labels = true }: AICoreProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ state, accent, motion, particles, labels });
  propsRef.current = { state, accent, motion, particles, labels };
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // Esfera de Fibonacci: reparto uniforme de puntos.
    const sx = new Float32Array(N_SPHERE);
    const sy = new Float32Array(N_SPHERE);
    const sz = new Float32Array(N_SPHERE);
    const seed = new Float32Array(N_SPHERE);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N_SURFACE; i++) {
      const y = 1 - (i / (N_SURFACE - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      const j = 0.9 + Math.random() * 0.1; // ligera rugosidad: textura «digital»
      sx[i] = Math.cos(th) * r * j;
      sy[i] = y * j;
      sz[i] = Math.sin(th) * r * j;
      seed[i] = Math.random() * 1000;
    }
    // Relleno de volumen: da el aspecto de esfera «llena» de datos.
    for (let i = N_SURFACE; i < N_SPHERE; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const rr = Math.cbrt(Math.random()) * 0.97;
      const s = Math.sqrt(1 - u * u);
      sx[i] = Math.cos(th) * s * rr;
      sy[i] = u * rr;
      sz[i] = Math.sin(th) * s * rr;
      seed[i] = Math.random() * 1000;
    }
    const sats = Array.from({ length: 5 }, (_, i) => ({ a: (i / 5) * Math.PI * 2, r: 1.5 + (i % 2) * 0.12, s: 0.6 + Math.random() * 0.6 }));

    const cur: Params = { ...STATE_PARAMS[propsRef.current.state] };
    const hueW = [1, 0, 0];
    let w = 0;
    let h = 0;
    let t = Math.random() * 100;
    let rotY = 0;
    let last = performance.now();
    let raf = 0;
    let visible = true;
    let running = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (dt: number) => {
      const { state: st, motion: mo, particles: showParticles, labels: showLabels, accent: acc } = propsRef.current;
      const target = STATE_PARAMS[st];
      const k = 1 - Math.exp(-dt * 3.2);
      (Object.keys(target) as (keyof Params)[]).forEach((key) => {
        if (key !== 'hue') (cur[key] as number) += ((target[key] as number) - (cur[key] as number)) * k;
      });
      for (let i = 0; i < 3; i++) hueW[i]! += ((target.hue === i ? 1 : 0) - hueW[i]!) * k;

      t += dt * mo;
      rotY += dt * mo * (0.25 + cur.spin * 0.6);

      const base = mix(mix(rgb(acc), rgb(DANGER), hueW[1]!), rgb(GRAY), hueW[2]!);
      const soft = mix(base, [255, 214, 160], 0.45);
      const hot: [number, number, number] = mix([255, 244, 230], rgb(GRAY), hueW[2]!);
      const R = Math.min(w, h) * 0.25;
      const cx = w / 2 + (cur.jitter > 0.05 ? (Math.random() - 0.5) * 4 * cur.jitter : 0);
      const cy = h / 2 + Math.sin(t * 0.6) * R * 0.025; // flota

      ctx.clearRect(0, 0, w, h);

      // Halo
      const halo = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 2.2);
      halo.addColorStop(0, css(base, 0.28 * cur.glow));
      halo.addColorStop(0.45, css(base, 0.08 * cur.glow));
      halo.addColorStop(1, css(base, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      // Barrido radar
      if (cur.scan > 0.03) {
        const a0 = (t * 1.6) % (Math.PI * 2);
        const sweep = ctx.createConicGradient ? ctx.createConicGradient(a0, cx, cy) : null;
        if (sweep) {
          sweep.addColorStop(0, css(base, 0.28 * cur.scan));
          sweep.addColorStop(0.08, css(base, 0));
          sweep.addColorStop(1, css(base, 0));
          ctx.fillStyle = sweep;
          ctx.beginPath();
          ctx.arc(cx, cy, R * 1.45, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Corona de marcas (ecualizador)
      const ticks = 180;
      for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * Math.PI * 2 - t * 0.05;
        const n = Math.sin(a * cur.waveFreq + t * 5) * 0.5 + Math.sin(a * (cur.waveFreq + 3) - t * 3.3) * 0.3 + Math.sin(i * 12.9898 + t * 9) * 0.2;
        const len = R * (0.05 + Math.max(0, n) * 0.14 * cur.wave + (i % 15 === 0 ? 0.06 : 0));
        const r1 = R * 1.32;
        ctx.strokeStyle = css(i % 15 === 0 ? soft : base, 0.35 + 0.55 * cur.glow * (0.6 + Math.max(0, n) * 0.4));
        ctx.lineWidth = i % 15 === 0 ? 2 : 1.2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * (r1 + len), cy + Math.sin(a) * (r1 + len));
        ctx.stroke();
      }

      // Órbita punteada exterior
      const dots = 120;
      const orbR = R * 1.68;
      ctx.fillStyle = css(soft, 0.55 * (0.4 + cur.glow * 0.6));
      for (let i = 0; i < dots; i++) {
        if (i % 17 > 13) continue; // huecos
        const a = (i / dots) * Math.PI * 2 + t * 0.08;
        ctx.fillRect(cx + Math.cos(a) * orbR - 1, cy + Math.sin(a) * orbR - 1, 2, 2);
      }
      // Satélites
      if (showParticles) {
        for (const s of sats) {
          s.a += dt * mo * cur.particleSpeed * s.s * 0.5;
          const x = cx + Math.cos(s.a) * R * s.r;
          const y = cy + Math.sin(s.a) * R * s.r;
          const g = ctx.createRadialGradient(x, y, 0, x, y, 6);
          g.addColorStop(0, css(hot, 0.95 * cur.glow));
          g.addColorStop(1, css(base, 0));
          ctx.fillStyle = g;
          ctx.fillRect(x - 6, y - 6, 12, 12);
        }
      }

      // Anillos de datos
      ctx.lineCap = 'round';
      ctx.shadowColor = css(base, 0.9);
      ctx.shadowBlur = 10 * cur.glow;
      ctx.strokeStyle = css(base, 0.5 + 0.4 * cur.glow);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.08, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = css(base, 0.35 + 0.3 * cur.glow);
      for (const rr of [1.19, 1.23]) {
        ctx.beginPath();
        ctx.arc(cx, cy, R * rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Segmentos brillantes que giran
      ctx.lineWidth = 3;
      ctx.strokeStyle = css(soft, 0.75 * (0.5 + cur.glow * 0.5));
      for (let s = 0; s < 4; s++) {
        const a = t * (0.3 + cur.spin * 0.4) + (s * Math.PI) / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.21, a, a + 0.35);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // Etiquetas técnicas
      if (showLabels && R > 70) {
        ctx.font = `600 ${Math.max(8, R * 0.055)}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.fillStyle = css(soft, 0.85 * (0.4 + cur.glow * 0.6));
        LABELS.forEach((txt, i) => {
          const a = (i / LABELS.length) * Math.PI * 2 + 0.6 + t * 0.04;
          const x = cx + Math.cos(a) * R * 1.27;
          const y = cy + Math.sin(a) * R * 1.27;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(a + Math.PI / 2 + (Math.sin(a) > 0 ? Math.PI : 0));
          ctx.textAlign = 'center';
          ctx.fillText(txt, 0, 0);
          ctx.restore();
        });
      }

      // Brillo interior de la esfera
      const coreR = R * (0.92 - cur.inward * 0.12) * (1 + Math.sin(t * 3.1) * 0.025 * cur.pulse);
      const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 1.05);
      inner.addColorStop(0, css(base, 0.35 * cur.glow));
      inner.addColorStop(0.7, css(base, 0.12 * cur.glow));
      inner.addColorStop(1, css(base, 0));
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 1.05, 0, Math.PI * 2);
      ctx.fill();

      // Esfera de partículas (agrupadas por color y nivel de brillo para dibujar rápido)
      const tilt = 0.35 + Math.sin(t * 0.2) * 0.12;
      const cosY = Math.cos(rotY), sinY = Math.sin(rotY), cosX = Math.cos(tilt), sinX = Math.sin(tilt);
      const buckets: Path2D[][] = [[new Path2D(), new Path2D(), new Path2D(), new Path2D()], [new Path2D(), new Path2D(), new Path2D(), new Path2D()], [new Path2D(), new Path2D(), new Path2D(), new Path2D()]];
      const speakAmp = cur.wave * cur.pulse * 0.07;
      for (let i = 0; i < N_SPHERE; i++) {
        const x1 = sx[i]! * cosY - sz[i]! * sinY;
        const z1 = sx[i]! * sinY + sz[i]! * cosY;
        const y2 = sy[i]! * cosX - z1 * sinX;
        const z2 = sy[i]! * sinX + z1 * cosX;
        const d = (z2 + 1) / 2; // 0 detrás, 1 delante
        const wob = 1 + Math.sin(seed[i]! + t * 7) * speakAmp;
        const px = cx + x1 * coreR * wob;
        const py = cy + y2 * coreR * wob;
        const flick = Math.sin(seed[i]! * 3.7 + t * (6 + (i % 7))) > 0.7 ? 1 : 0;
        const level = Math.min(3, Math.floor(d * 3.4) + flick);
        const group = flick && d > 0.5 ? 2 : i % 3 === 0 ? 1 : 0;
        const size = (i >= N_SURFACE ? 0.9 : 1.1) + d * 1.4;
        buckets[group]![level]!.rect(px - size / 2, py - size / 2, size, size);
      }
      const colors = [base, soft, hot];
      const alphas = [0.2, 0.45, 0.75, 1];
      for (let g = 0; g < 3; g++) {
        for (let l = 0; l < 4; l++) {
          ctx.fillStyle = css(colors[g]!, alphas[l]! * (0.35 + cur.glow * 0.65));
          ctx.fill(buckets[g]![l]!);
        }
      }
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

  useEffect(() => {
    redrawRef.current();
  }, [state, accent, motion, particles, labels]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={label ?? `Núcleo de JARVIS: ${state}`} data-state={state} />;
}
