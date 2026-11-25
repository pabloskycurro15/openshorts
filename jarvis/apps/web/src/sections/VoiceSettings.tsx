import { useEffect, useState, type FormEvent } from 'react';
import { AudioLines, ExternalLink, KeyRound, Mic, ShieldCheck } from 'lucide-react';
import type { ElevenLabsVoice, VoiceStatus } from '@jarvis/shared';
import { Badge, Button, ErrorNote, Panel } from '../components/ui';
import { core } from '../lib/api';
import { useConnection } from '../lib/connection';
import { useVoice, type VoiceSettings } from '../voice/VoiceProvider';
import { systemVoices } from '../voice/webspeech';
import { desktop } from '../lib/desktop';

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  const id = `sl-${label}`;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><label htmlFor={id} className="text-muted">{label}</label><span className="font-mono">{fmt(value)}</span></div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
    </div>
  );
}

function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
      <span>{label}{hint && <span className="block text-xs text-dim">{hint}</span>}</span>
    </label>
  );
}

const REPLY: { v: VoiceSettings['replyMode']; label: string }[] = [
  { v: 'voice', label: 'Si le hablo' }, { v: 'always', label: 'Siempre' }, { v: 'never', label: 'Nunca' },
];

function ElevenLabsPanel({ onEngine }: { onEngine: (on: boolean) => void }) {
  const { status: link } = useConnection();
  const [st, setSt] = useState<VoiceStatus | null>(null);
  const [key, setKey] = useState('');
  const [voices, setVoices] = useState<ElevenLabsVoice[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => core.voiceStatus().then(setSt).catch((e: Error) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { if (link === 'online') void load(); }, [link]);
  const run = async (fn: () => Promise<string>) => {
    setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); await load(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
  };
  if (!st) return null;
  const el = st.elevenlabs;
  return (
    <div className="rounded-lg border border-navy-600 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm"><AudioLines size={15} className="text-accent" aria-hidden /> Voz premium · ElevenLabs</span>
        <Badge tone="warn">De pago</Badge>
      </div>
      <p className="mt-1 text-xs text-dim">Voz masculina, grave y natural. Factura por caracteres (planes desde ~5 USD/mes). Desactivada hasta que tú la actives. El texto de las respuestas se envía a ElevenLabs.</p>
      <form className="mt-2 flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(async () => { await core.setElevenLabsKey(key); setKey(''); return 'Clave de ElevenLabs guardada (cifrada).'; }); }}>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-navy-600 bg-navy-900 px-3 focus-within:border-accent">
          <KeyRound size={14} className="text-accent" aria-hidden />
          <label htmlFor="el-key" className="sr-only">Clave de ElevenLabs</label>
          <input id="el-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={el.configured ? 'Configurada · pega otra para sustituirla' : 'Clave API de ElevenLabs'}
            className="min-w-0 flex-1 bg-transparent py-1.5 font-mono text-sm outline-none placeholder:text-dim" />
        </div>
        <Button type="submit" disabled={key.trim().length < 20}>Guardar</Button>
      </form>
      <a className="mt-1 inline-flex items-center gap-1 text-xs text-accent-soft underline" href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">Obtener clave <ExternalLink size={11} aria-hidden /></a>
      {el.configured && (
        <div className="mt-3 space-y-2">
          <Check label="Usar ElevenLabs para las respuestas habladas" checked={el.settings.enabled}
            onChange={(v) => run(async () => { await core.elevenLabsSettings({ enabled: v }); onEngine(v); return v ? 'ElevenLabs activado.' : 'ElevenLabs desactivado: se usa la voz del sistema.'; })} />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Voz:</span>
            {voices ? (
              <select aria-label="Voz de ElevenLabs" value={el.settings.voiceId} onChange={(e) => run(async () => { await core.elevenLabsSettings({ voiceId: e.target.value }); return 'Voz cambiada.'; })}
                className="rounded-lg border border-navy-600 bg-navy-900 px-2 py-1 text-sm">
                {voices.map((v) => <option key={v.voiceId} value={v.voiceId}>{v.name}{v.labels.gender ? ` · ${v.labels.gender}` : ''}{v.labels.accent ? ` · ${v.labels.accent}` : ''}</option>)}
              </select>
            ) : (
              <><span className="font-mono text-xs">{el.settings.voiceId === 'pNInz6obpgDQGcFmaJgB' ? 'Adam (grave, masculina)' : el.settings.voiceId}</span>
                <Button tone="ghost" onClick={() => run(async () => { setVoices(await core.elevenLabsVoices()); return 'Voces cargadas.'; })}>Ver voces</Button></>
            )}
          </div>
          <p className="text-xs text-dim">Este mes: {el.charsMonth.toLocaleString('es-ES')} caracteres enviados.</p>
          <Button tone="ghost" onClick={() => { if (window.confirm('¿Borrar la clave de ElevenLabs?')) void run(async () => { await core.deleteElevenLabsKey(); onEngine(false); return 'Clave borrada.'; }); }}>Borrar clave</Button>
        </div>
      )}
      {msg && (msg.ok ? <p role="status" className="mt-2 text-sm text-ok">{msg.text}</p> : <div className="mt-2"><ErrorNote>{msg.text}</ErrorNote></div>)}
    </div>
  );
}

export function VoiceSettingsPanel() {
  const v = useVoice();
  const s = v.settings;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => systemVoices());
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const on = () => setVoices(systemVoices());
    window.speechSynthesis.addEventListener?.('voiceschanged', on);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', on);
  }, []);
  const spanish = voices.filter((x) => x.lang.toLowerCase().startsWith('es'));
  const list = spanish.length ? spanish : voices;

  return (
    <Panel title="Voz" icon={Mic}>
      <div className="space-y-4">
        <div className="rounded-lg border border-navy-700 bg-navy-900/50 p-3 text-xs text-muted">
          <p className="flex items-start gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <span><strong className="text-ink">Privacidad del micrófono:</strong> se activa al pulsar el micrófono (o en manos libres), con indicador visible. Ahora el audio lo procesa: <strong className="text-ink">{v.processor}</strong>. Con la palabra de activación, el micrófono queda abierto pero todo se procesa en tu equipo (indicador naranja). Cada activación queda en el Historial.</span></p>
          {!v.recognitionSupported && <p className="mt-2 text-warn">{s.recognition === 'browser' ? 'Este navegador no ofrece reconocimiento en la nube: elige «Local (Whisper)».' : 'Este navegador no admite el reconocimiento local.'}</p>}
        </div>

        <fieldset>
          <legend className="mb-2 text-xs tracking-wider text-dim uppercase">Reconocimiento de voz</legend>
          <div className="grid grid-cols-2 gap-2">
            {([['local', 'Local (Whisper)', 'Privado: el audio no sale del equipo'], ['browser', 'Navegador', 'Servicio en la nube de Google/Microsoft']] as const).map(([val, label, hint]) => (
              <button key={val} type="button" aria-pressed={s.recognition === val} title={hint}
                disabled={val === 'browser' && !!desktop()}
                onClick={() => v.update({ recognition: val, ...(val === 'browser' ? { wakeWord: false } : {}) })}
                className={`rounded-lg border px-2 py-1.5 text-left text-sm disabled:opacity-40 ${s.recognition === val ? 'border-accent bg-accent/12 text-ink' : 'border-navy-600 text-muted hover:text-ink'}`}>
                {label}<span className="block text-[11px] text-dim">{hint}</span>
              </button>
            ))}
          </div>
          {s.recognition === 'local' && (
            <div className="mt-3 rounded-lg border border-navy-700 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>Modelo Whisper base <span className="text-xs text-dim">(~{v.model.sizeMb} MB, se descarga una vez de Hugging Face)</span></span>
                {v.model.state === 'ready' ? <Badge tone="ok">Listo</Badge> : v.model.state === 'loading' ? <Badge tone="accent">{Math.round(v.model.progress * 100)} %</Badge> : v.model.state === 'error' ? <Badge tone="danger">Error</Badge> : <Badge>Sin descargar</Badge>}
              </div>
              {v.model.state === 'loading' && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-navy-700"><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(v.model.progress * 100)}%` }} /></div>}
              {v.model.state === 'error' && <p className="mt-2 text-xs text-danger">{v.model.error}</p>}
              {(v.model.state === 'idle' || v.model.state === 'error') && <div className="mt-2"><Button tone="accent" onClick={() => void v.loadModel().catch(() => undefined)}>Descargar y preparar</Button></div>}
              <div className="mt-3 border-t border-navy-700 pt-2">
                <Check label="Palabra de activación «Jarvis»" hint="Escucha continua 100 % local: un detector de voz despierta a Whisper solo cuando hablas; si la frase empieza por «Jarvis», actúa. Ejemplo: «Jarvis, ¿qué hora es?»."
                  checked={s.wakeWord} onChange={(x) => { if (x) void v.loadModel().catch(() => undefined); v.update({ wakeWord: x }); }} />
                {v.wakeActive && <p className="text-xs text-accent-soft">Escuchando «Jarvis»… {v.lastHeard && <span className="text-dim">Última frase oída: «{v.lastHeard}» (no se guarda)</span>}</p>}
              </div>
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-xs tracking-wider text-dim uppercase">Responder hablando</legend>
          <div className="grid grid-cols-3 gap-2">
            {REPLY.map((r) => (
              <button key={r.v} type="button" aria-pressed={s.replyMode === r.v} onClick={() => v.update({ replyMode: r.v })}
                className={`rounded-lg border px-2 py-1.5 text-sm ${s.replyMode === r.v ? 'border-accent bg-accent/12 text-ink' : 'border-navy-600 text-muted hover:text-ink'}`}>{r.label}</button>
            ))}
          </div>
        </fieldset>

        {v.synthesisSupported ? (
          <div className="space-y-3">
            <div>
              <label htmlFor="sys-voice" className="mb-1 block text-xs tracking-wider text-dim uppercase">Voz del sistema (gratis)</label>
              <select id="sys-voice" value={s.voiceURI ?? ''} onChange={(e) => v.update({ voiceURI: e.target.value || null })}
                className="w-full rounded-lg border border-navy-600 bg-navy-900 px-2 py-1.5 text-sm">
                {!list.length && <option value="">Voz por defecto del sistema</option>}
                {list.map((x) => <option key={x.voiceURI} value={x.voiceURI}>{x.name} · {x.lang}{x.localService ? '' : ' · en línea (envía el texto al proveedor)'}</option>)}
              </select>
              <p className="mt-1 text-xs text-dim">En Windows, las voces «Natural» de Edge (p. ej. Álvaro) suenan mucho más humanas.</p>
            </div>
            <Slider label="Velocidad" value={s.rate} min={0.6} max={1.6} step={0.05} onChange={(x) => v.update({ rate: x })} fmt={(x) => `${x.toFixed(2)}×`} />
            <Slider label="Tono (más bajo = más grave)" value={s.pitch} min={0.5} max={1.5} step={0.05} onChange={(x) => v.update({ pitch: x })} fmt={(x) => x.toFixed(2)} />
            <Slider label="Volumen" value={s.volume} min={0} max={1} step={0.05} onChange={(x) => v.update({ volume: x })} fmt={(x) => `${Math.round(x * 100)} %`} />
            <div className="flex gap-2">
              <Button tone="accent" onClick={() => { v.cancelSpeech(); const was = s.muted; if (was) v.update({ muted: false }); setTimeout(() => v.say('Buenas tardes. Todos los sistemas operativos y a su servicio.'), 0); }}>Probar voz</Button>
              <Button tone="ghost" onClick={() => v.cancelSpeech()}>Parar</Button>
            </div>
          </div>
        ) : <p className="text-sm text-warn">Este navegador no admite síntesis de voz.</p>}

        <div className="divide-y divide-navy-700">
          <Check label="Enviar al terminar de hablar" hint="Si lo desactivas, podrás revisar el texto antes de enviarlo." checked={s.autoSend} onChange={(x) => v.update({ autoSend: x })} />
          <Check label="Manos libres" hint="Tras cada respuesta hablada, vuelve a escuchar. Se detiene si no dices nada." checked={s.handsFree} onChange={(x) => v.update({ handsFree: x })} />
          <Check label="Leer en voz alta los avisos importantes" hint="Confirmaciones pendientes y modo emergencia." checked={s.readNotifications} onChange={(x) => v.update({ readNotifications: x })} />
          <Check label="Modo discreto" hint="Silencia toda la voz de JARVIS." checked={s.muted} onChange={(x) => { if (x) v.cancelSpeech(); v.update({ muted: x }); }} />
        </div>

        <ElevenLabsPanel onEngine={(on) => v.update({ engine: on ? 'elevenlabs' : 'system' })} />
      </div>
    </Panel>
  );
}
