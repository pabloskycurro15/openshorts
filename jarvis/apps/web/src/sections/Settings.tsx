import { Brain, Link2, Mic, Palette } from 'lucide-react';
import { Badge, Button, Panel } from '../components/ui';
import { ACCENTS, useSettings, type AccentId, type Appearance } from '../lib/settings';
import { useConnection, type LinkStatus } from '../lib/connection';

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2 text-sm">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-navy-600'} peer-focus-visible:outline-2 peer-focus-visible:outline-accent`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-ink transition-transform ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
      </span>
    </label>
  );
}

const LINK_LABEL: Record<LinkStatus, string> = { online: 'en línea', connecting: 'conectando', offline: 'sin conexión', unauthorized: 'token no válido', 'no-token': 'sin vincular' };

const MOTION: { v: Appearance['motion']; label: string }[] = [
  { v: 0, label: 'Sin animación' }, { v: 0.5, label: 'Suave' }, { v: 1, label: 'Normal' }, { v: 1.5, label: 'Intensa' },
];

export function SettingsSection() {
  const { appearance, update, reset } = useSettings();
  const { disconnect, status } = useConnection();
  return (
    <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
      <Panel title="Apariencia" icon={Palette} actions={<Button tone="ghost" onClick={reset}>Restablecer</Button>}>
        <fieldset>
          <legend className="mb-2 text-xs tracking-wider text-dim uppercase">Color de acento</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ACCENTS) as AccentId[]).map((id) => (
              <button key={id} type="button" onClick={() => update({ accent: id })} aria-pressed={appearance.accent === id}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${appearance.accent === id ? 'border-accent text-ink' : 'border-navy-600 text-muted hover:text-ink'}`}>
                <span className="h-3.5 w-3.5 rounded-full" style={{ background: ACCENTS[id].hex, boxShadow: `0 0 8px ${ACCENTS[id].hex}` }} />
                {ACCENTS[id].label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="mt-5">
          <legend className="mb-2 text-xs tracking-wider text-dim uppercase">Animaciones</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MOTION.map((m) => (
              <button key={m.v} type="button" onClick={() => update({ motion: m.v })} aria-pressed={appearance.motion === m.v}
                className={`rounded-lg border px-2 py-1.5 text-sm ${appearance.motion === m.v ? 'border-accent bg-accent/12 text-ink' : 'border-navy-600 text-muted hover:text-ink'}`}>{m.label}</button>
            ))}
          </div>
          <p className="mt-2 text-xs text-dim">Si tu sistema pide reducir el movimiento, JARVIS lo respeta siempre.</p>
        </fieldset>
        <div className="mt-4 divide-y divide-navy-700">
          <Toggle label="Rejilla de fondo" checked={appearance.grid} onChange={(v) => update({ grid: v })} />
          <Toggle label="Partículas del núcleo" checked={appearance.particles} onChange={(v) => update({ particles: v })} />
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel title="Conexión con el núcleo" icon={Link2}>
          <p className="text-sm text-muted">Estado: <span className="text-ink">{LINK_LABEL[status]}</span>. El token se guarda solo en este navegador.</p>
          <div className="mt-3"><Button tone="danger" onClick={disconnect}>Desvincular este navegador</Button></div>
        </Panel>
        <Panel title="Cerebro IA" icon={Brain}>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between"><span className="text-muted">Modelo por defecto</span><span>Claude Opus 5.5</span></li>
            <li className="flex justify-between"><span className="text-muted">Límite de gasto mensual</span><Badge>Fase 3</Badge></li>
            <li className="flex justify-between"><span className="text-muted">Clave API</span><Badge>Fase 3 · almacén cifrado</Badge></li>
          </ul>
        </Panel>
        <Panel title="Voz y sonidos" icon={Mic}>
          <p className="text-sm text-muted">Voz, velocidad, tono, volumen, palabra de activación y sonidos se configurarán aquí en la Fase 4.</p>
        </Panel>
      </div>
    </div>
  );
}
