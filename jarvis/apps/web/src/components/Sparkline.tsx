/** Gráfica de línea mínima en SVG (sin dependencias). Valores en 0-1. */
export function Sparkline({ values, label, height = 56 }: { values: number[]; label: string; height?: number }) {
  const w = 300;
  const pts = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const step = w / (pts.length - 1);
  const y = (v: number) => height - 4 - Math.max(0, Math.min(1, v)) * (height - 8);
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-14 w-full" role="img" aria-label={label}>
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={w} y1={y(g)} y2={y(g)} stroke="#13284a" strokeDasharray="3 4" />)}
      <path d={`${d} L${w},${height} L0,${height} Z`} fill="url(#spark-fill)" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
