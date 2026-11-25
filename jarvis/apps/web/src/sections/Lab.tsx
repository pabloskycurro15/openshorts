import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import type { AssistantState } from '@jarvis/shared';
import { AICore } from '../components/AICore';
import { Badge, Panel } from '../components/ui';
import { ACCENTS, useSettings } from '../lib/settings';
import { STATE_LABEL } from '../lib/labels';

const STATES = Object.keys(STATE_LABEL) as AssistantState[];

/** Vista previa local de los estados del núcleo. No cambia el estado real de JARVIS. */
export function LabSection() {
  const { appearance } = useSettings();
  const [state, setState] = useState<AssistantState>('thinking');
  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Panel title="Simulador del núcleo visual" icon={FlaskConical} actions={<Badge tone="accent">Vista previa</Badge>}>
        <div className="mx-auto aspect-square w-full max-w-[480px]">
          <AICore state={state} accent={ACCENTS[appearance.accent].hex} motion={appearance.motion} particles={appearance.particles} className="h-full w-full" />
        </div>
        <p className="text-center font-display text-lg tracking-[0.2em] uppercase glow-text">{STATE_LABEL[state]}</p>
      </Panel>
      <Panel title="Estados">
        <p className="mb-3 text-sm text-muted">Previsualiza cómo reacciona el núcleo en cada estado. Solo afecta a esta vista: el estado real lo marca el núcleo.</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Estado de vista previa">
          {STATES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={state === s} onClick={() => setState(s)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${state === s ? 'border-accent bg-accent/12 text-ink' : 'border-navy-600 bg-navy-900 text-muted hover:text-ink'}`}>
              {STATE_LABEL[s]}
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}
