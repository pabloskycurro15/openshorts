import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readStore, writeStore } from './storage';

export const ACCENTS = {
  naranja: { label: 'Naranja', hex: '#ff7a1a', soft: '#ffa552' },
  ambar: { label: 'Ámbar', hex: '#ffb020', soft: '#ffd06b' },
  cobre: { label: 'Cobre', hex: '#e8633a', soft: '#ff9a76' },
  azul: { label: 'Azul eléctrico', hex: '#2f7bff', soft: '#7fb0ff' },
  cian: { label: 'Cian', hex: '#22d3ee', soft: '#8beeff' },
} as const;
export type AccentId = keyof typeof ACCENTS;

export interface Appearance {
  accent: AccentId;
  grid: boolean;
  /** Intensidad de las animaciones del núcleo: 0 = estático, 1 = normal, 1.5 = intenso. */
  motion: 0 | 0.5 | 1 | 1.5;
  particles: boolean;
}

const DEFAULTS: Appearance = { accent: 'naranja', grid: true, motion: 1, particles: true };
const KEY = 'jarvis.appearance';

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

const Ctx = createContext<{ appearance: Appearance; update: (p: Partial<Appearance>) => void; reset: () => void } | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(() => ({ ...DEFAULTS, ...readStore<Partial<Appearance>>(KEY, {}) }));

  useEffect(() => {
    const a = ACCENTS[appearance.accent] ?? ACCENTS.naranja;
    const root = document.documentElement;
    root.style.setProperty('--accent', a.hex);
    root.style.setProperty('--accent-soft', a.soft);
    root.style.setProperty('--accent-rgb', hexToRgb(a.hex));
    root.dataset.motion = appearance.motion === 0 ? 'off' : 'on';
    writeStore(KEY, appearance);
  }, [appearance]);

  const value = useMemo(
    () => ({
      appearance,
      update: (p: Partial<Appearance>) => setAppearance((s) => ({ ...s, ...p })),
      reset: () => setAppearance(DEFAULTS),
    }),
    [appearance],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings fuera de SettingsProvider');
  return v;
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
