import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { CircleStop, Headphones, KeyRound, MessageSquarePlus, Mic, PanelLeft, Send, Trash2, Volume2, VolumeX, Wrench, ShieldQuestion } from 'lucide-react';
import { useVoice } from '../voice/VoiceProvider';
import { ModelSwitch } from '../components/ModelSwitch';
import type { AiStatus, ChatEvent, ChatMessageView, ConversationSummary, RiskLevel } from '@jarvis/shared';
import { Badge, Button, ErrorNote, Meter } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { core, formatUsd } from '../lib/api';
import { useConnection } from '../lib/connection';
import { RISK_LABEL, timeAgo } from '../lib/labels';

/** Elemento de la vista: texto o acción de herramienta, en orden. */
type Item =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; tool: string; status: string; summary: string; approval?: { approvalId: string; reason: string; risk: RiskLevel; resolved?: boolean } }
  | { kind: 'notice'; tone: 'error' | 'warning'; text: string }
  | { kind: 'cost'; text: string };

/** Convierte el historial guardado en elementos visibles (los resultados se asocian a su herramienta). */
function fromHistory(messages: ChatMessageView[]): Item[] {
  const results = new Map<string, { content: string; isError?: boolean }>();
  for (const m of messages) for (const b of m.content) if (b.type === 'tool_result') results.set(b.toolUseId, b);
  const items: Item[] = [];
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === 'text') items.push(m.role === 'user' ? { kind: 'user', text: b.text } : { kind: 'text', text: b.text });
      else if (b.type === 'tool_use') {
        const r = results.get(b.id);
        items.push({ kind: 'tool', id: b.id, tool: b.name, status: r ? (r.isError ? 'error' : 'ok') : 'pending', summary: r ? (r.isError ? r.content.split('.')[0]! : 'Completado') : 'Sin resultado' });
      }
    }
  }
  return items;
}

const STATUS_TONE: Record<string, 'ok' | 'danger' | 'accent' | 'warn' | 'muted'> = { ok: 'ok', error: 'danger', denied: 'warn', pending_approval: 'accent', running: 'accent', pending: 'muted' };

function ToolChip({ item, onDecide }: { item: Extract<Item, { kind: 'tool' }>; onDecide: (approvalId: string, d: 'approved' | 'approved_always' | 'denied') => void }) {
  const a = item.approval;
  return (
    <div className="my-2 rounded-lg border border-navy-600 bg-navy-900/70 p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Wrench size={13} className="text-accent" aria-hidden />
        <span className="font-mono text-amber-200">{item.tool}</span>
        <Badge tone={STATUS_TONE[item.status] ?? 'muted'}>{item.status === 'running' ? 'Ejecutando…' : item.summary}</Badge>
      </div>
      {a && !a.resolved && (
        <div className="mt-2 rounded-md border border-accent/40 bg-accent/8 p-2.5" role="group" aria-label="Confirmación requerida">
          <p className="flex items-start gap-2 text-sm text-ink">
            <ShieldQuestion size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <span>JARVIS necesita tu permiso. <span className="text-muted">{a.reason}</span> <Badge tone={a.risk === 'low' ? 'ok' : a.risk === 'medium' ? 'warn' : 'danger'}>Riesgo {RISK_LABEL[a.risk]}</Badge></span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button tone="accent" onClick={() => onDecide(a.approvalId, 'approved')}>Aprobar</Button>
            {(a.risk === 'low' || a.risk === 'medium') && <Button onClick={() => onDecide(a.approvalId, 'approved_always')} title="No volverá a preguntar para esta herramienta">Aprobar siempre</Button>}
            <Button tone="danger" onClick={() => onDecide(a.approvalId, 'denied')}>Denegar</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotConfigured({ goSettings }: { goSettings: () => void }) {
  return (
    <div className="mx-auto mt-10 max-w-md panel p-6 text-center">
      <KeyRound size={28} className="mx-auto text-accent" aria-hidden />
      <h2 className="mt-3 font-display text-sm tracking-[0.2em] uppercase">Cerebro sin configurar</h2>
      <p className="mt-2 text-sm text-muted">Para conversar, JARVIS necesita tu clave API de Anthropic. Se guarda cifrada en tu equipo y nunca se muestra.</p>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-left text-sm text-muted">
        <li>Carga crédito en <a className="text-accent-soft underline" href="https://platform.claude.com/settings/billing" target="_blank" rel="noreferrer">platform.claude.com</a> (sin recarga automática).</li>
        <li>Crea una clave en <a className="text-accent-soft underline" href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">API Keys</a>.</li>
        <li>Pégala en Configuración → Cerebro IA.</li>
      </ol>
      <div className="mt-5"><Button tone="accent" onClick={goSettings}>Ir a Configuración</Button></div>
    </div>
  );
}

export function ConversationSection({ navigate }: { navigate: (id: string) => void }) {
  const { status: link, revision } = useConnection();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<string | null>(null);
  currentRef.current = current;
  const voice = useVoice();
  const speakThisTurn = useRef(false);

  const refreshMeta = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([core.aiStatus(), core.conversations()]);
      setStatus(s);
      setList(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (link === 'online') void refreshMeta();
  }, [link, revision, refreshMeta]);

  const open = useCallback(async (id: string | null) => {
    setCurrent(id);
    setShowList(false);
    setError(null);
    if (!id) return setItems([]);
    const c = await core.conversation(id);
    setItems(fromHistory(c.messages));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [items]);

  const onEvent = (e: ChatEvent) => {
    if (speakThisTurn.current) {
      if (e.type === 'text') voice.feed(e.delta);
      else if (e.type === 'message_end' || e.type === 'tool_call') { voice.endReply(); voice.beginReply(); }
      else if (e.type === 'approval_required') { voice.endReply(); voice.say('Necesito tu confirmación.'); voice.beginReply(); }
      else if (e.type === 'error') { voice.endReply(); voice.say(e.message); }
      else if (e.type === 'done') voice.endReply();
    }
    setItems((prev) => {
      const next = [...prev];
      const last = next.at(-1);
      switch (e.type) {
        case 'start':
          setCurrent(e.conversationId);
          break;
        case 'text':
          if (last?.kind === 'text') next[next.length - 1] = { ...last, text: last.text + e.delta };
          else next.push({ kind: 'text', text: e.delta });
          break;
        case 'tool_call':
          next.push({ kind: 'tool', id: e.id, tool: e.tool, status: 'running', summary: 'Ejecutando…' });
          break;
        case 'approval_required': {
          const i = next.findIndex((x) => x.kind === 'tool' && x.id === e.id);
          if (i >= 0) next[i] = { ...(next[i] as Extract<Item, { kind: 'tool' }>), status: 'pending_approval', summary: 'Esperando tu confirmación', approval: { approvalId: e.approvalId, reason: e.reason, risk: e.risk } };
          break;
        }
        case 'tool_result': {
          const i = next.findIndex((x) => x.kind === 'tool' && x.id === e.id);
          if (i >= 0) {
            const t = next[i] as Extract<Item, { kind: 'tool' }>;
            next[i] = { ...t, status: e.status, summary: e.summary, approval: t.approval ? { ...t.approval, resolved: true } : undefined };
          }
          break;
        }
        case 'usage':
          next.push({ kind: 'cost', text: `${formatUsd(e.costUsd)} · mes ${formatUsd(e.monthUsd)} de ${formatUsd(e.limitUsd)}` });
          break;
        case 'warning':
          next.push({ kind: 'notice', tone: 'warning', text: e.message });
          break;
        case 'error':
          next.push({ kind: 'notice', tone: 'error', text: e.message });
          break;
      }
      return next;
    });
  };

  const sendText = async (raw: string, viaVoice: boolean) => {
    const message = raw.trim();
    if (!message || busy) return;
    setInput('');
    setError(null);
    setBusy(true);
    setItems((p) => [...p, { kind: 'user', text: message }]);
    const mode = voice.settings.replyMode;
    speakThisTurn.current = !voice.settings.muted && (mode === 'always' || (mode === 'voice' && viaVoice));
    if (speakThisTurn.current) voice.beginReply();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let ok = true;
    try {
      await core.chat({ conversationId: currentRef.current ?? undefined, message }, onEvent, ctrl.signal);
    } catch (err) {
      ok = false;
      if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (speakThisTurn.current) voice.endReply();
      setBusy(false);
      abortRef.current = null;
      void refreshMeta();
    }
    // Manos libres: cuando JARVIS termina de hablar, vuelve a escuchar.
    if (ok && viaVoice && voice.settings.handsFree && !voice.settings.muted) {
      await voice.whenIdle();
      handsFreeNext.current?.();
    }
  };
  const handsFreeNext = useRef<(() => void) | null>(null);

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    void sendText(input, false);
  };

  const talk = async () => {
    if (voice.listening) return voice.stopListening();
    const text = await voice.listen();
    if (!text) return;
    if (voice.settings.autoSend) await sendText(text, true);
    else setInput((p) => (p ? `${p} ${text}` : text));
  };
  handsFreeNext.current = () => void talk();

  const stop = async () => {
    voice.cancelSpeech();
    if (currentRef.current) await core.stopChat(currentRef.current).catch(() => undefined);
  };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        voice.cancelSpeech();
        if (voice.listening) voice.stopListening();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voice]);

  const decide = async (approvalId: string, d: 'approved' | 'approved_always' | 'denied') => {
    try {
      await core.resolveApproval(approvalId, d);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  if (status && !status.configured) return <NotConfigured goSettings={() => navigate('configuracion')} />;

  const sidebar = (
    <div className="flex h-full flex-col">
      <Button tone="accent" onClick={() => open(null)}><MessageSquarePlus size={15} aria-hidden /> Nueva conversación</Button>
      <ul className="mt-3 flex-1 space-y-1 overflow-y-auto">
        {list.map((c) => (
          <li key={c.id} className="group flex items-center gap-1">
            <button type="button" onClick={() => open(c.id)}
              className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-left ${current === c.id ? 'bg-accent/12 text-ink' : 'text-muted hover:bg-navy-800 hover:text-ink'}`}>
              <div className="truncate text-sm">{c.title}</div>
              <div className="text-[11px] text-dim">{timeAgo(c.updatedAt)} · {formatUsd(c.costUsd)}</div>
            </button>
            <button type="button" aria-label={`Borrar «${c.title}»`} title="Borrar"
              onClick={async () => {
                if (!window.confirm(`¿Borrar la conversación «${c.title}»? No se puede deshacer.`)) return;
                await core.deleteConversation(c.id);
                if (current === c.id) void open(null);
                void refreshMeta();
              }}
              className="rounded p-1.5 text-dim opacity-0 group-hover:opacity-100 hover:text-danger focus:opacity-100">
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {!list.length && <li className="px-2 py-4 text-center text-xs text-dim">Aún no hay conversaciones.</li>}
      </ul>
    </div>
  );

  return (
    <div className="mx-auto grid h-full max-w-6xl gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="panel hidden p-3 lg:block">{sidebar}</aside>
      {showList && <div className="panel p-3 lg:hidden">{sidebar}</div>}

      <section className="panel flex min-h-[70vh] flex-col overflow-hidden lg:min-h-0">
        <header className="flex flex-wrap items-center gap-3 border-b border-navy-700 px-4 py-3">
          <button type="button" className="text-muted hover:text-ink lg:hidden" onClick={() => setShowList((v) => !v)} aria-label="Conversaciones"><PanelLeft size={18} /></button>
          <ModelSwitch onChange={(s) => setStatus(s)} />
          {voice.synthesisSupported && (
            <button type="button" onClick={() => { if (!voice.settings.muted) voice.cancelSpeech(); voice.update({ muted: !voice.settings.muted }); }}
              aria-pressed={!voice.settings.muted} title={voice.settings.muted ? 'Modo discreto: voz silenciada' : 'Respuestas habladas activas'}
              className={`rounded-lg border p-1.5 ${voice.settings.muted ? 'border-navy-600 text-dim' : 'border-accent/50 text-accent'}`}>
              {voice.settings.muted ? <VolumeX size={15} aria-hidden /> : <Volume2 size={15} aria-hidden />}
              <span className="sr-only">{voice.settings.muted ? 'Activar voz' : 'Modo discreto'}</span>
            </button>
          )}
          {voice.recognitionSupported && (
            <button type="button" onClick={() => { const v = !voice.settings.handsFree; voice.update({ handsFree: v }); void core.voiceEvent(v ? 'handsfree_on' : 'handsfree_off').catch(() => undefined); }}
              aria-pressed={voice.settings.handsFree} title="Manos libres: tras cada respuesta hablada vuelve a escuchar"
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${voice.settings.handsFree ? 'border-accent/50 text-accent' : 'border-navy-600 text-dim'}`}>
              <Headphones size={14} aria-hidden /> Manos libres
            </button>
          )}
          {status && (
            <div className="ml-auto flex min-w-[160px] items-center gap-2 text-xs text-muted" title="Gasto estimado este mes">
              <span className="font-mono">{formatUsd(status.spentMonthUsd)} / {formatUsd(status.settings.monthlyLimitUsd)}</span>
              <div className="w-24"><Meter label="Gasto del mes" value={status.budgetRatio} tone={status.blocked ? 'danger' : status.warn ? 'warn' : 'accent'} /></div>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
          {!items.length && (
            <div className="mx-auto mt-16 max-w-sm text-center">
              <p className="font-display text-sm tracking-[0.3em] text-dim uppercase">A su servicio</p>
              <p className="mt-2 text-sm text-muted">Pregúntame lo que necesites. Puedes escribirme o pulsar el micrófono y hablarme. Ahora mismo puedo conversar, razonar y consultar la hora y el estado de tu equipo.</p>
            </div>
          )}
          {items.map((it, i) => {
            switch (it.kind) {
              case 'user':
                return <div key={i} className="my-3 flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-sm bg-navy-700 px-4 py-2.5 text-sm whitespace-pre-wrap">{it.text}</div></div>;
              case 'text':
                return (
                  <div key={i} className="my-3 flex gap-3">
                    <span aria-hidden className="mt-1 h-6 w-6 shrink-0 rounded-full border border-accent/60 bg-[radial-gradient(circle,var(--accent)_25%,transparent_30%)]" />
                    <div className="min-w-0 max-w-[85%]"><Markdown text={it.text} /></div>
                  </div>
                );
              case 'tool':
                return <div key={i} className="ml-9 max-w-[85%]"><ToolChip item={it} onDecide={decide} /></div>;
              case 'notice':
                return <p key={i} role={it.tone === 'error' ? 'alert' : 'status'} className={`my-2 ml-9 rounded-lg border p-2.5 text-sm ${it.tone === 'error' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-warn/40 bg-warn/10 text-warn'}`}>{it.text}</p>;
              case 'cost':
                return <p key={i} className="ml-9 font-mono text-[10px] text-dim">{it.text}</p>;
            }
          })}
          {busy && items.at(-1)?.kind === 'user' && <p className="ml-9 animate-pulse text-xs text-muted">Pensando…</p>}
          {voice.speaking && <p className="ml-9 text-xs text-accent-soft">Hablando… (Esc para interrumpir)</p>}
          <div ref={endRef} />
        </div>

        {error && <div className="px-4"><ErrorNote>{error}</ErrorNote></div>}
        {voice.error && <div className="px-4 pt-2"><ErrorNote>{voice.error}</ErrorNote></div>}
        {voice.listening && (
          <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm" role="status">
            <span className="pulse-dot h-2 w-2 rounded-full bg-danger" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{voice.partial || 'Escuchando… habla ahora'}</span>
            <span className="hidden text-[11px] text-dim sm:inline">Audio procesado por {voice.processor}</span>
          </div>
        )}
        {status?.blocked && <div className="px-4 pt-2"><ErrorNote>Has alcanzado tu límite de gasto mensual. Puedes ampliarlo en Configuración.</ErrorNote></div>}

        <form onSubmit={send} className="flex items-end gap-2 border-t border-navy-700 p-3">
          <label htmlFor="chat-input" className="sr-only">Mensaje para JARVIS</label>
          <textarea id="chat-input" rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
            placeholder="Escribe a JARVIS…  (Intro para enviar, Mayús+Intro para salto de línea)" maxLength={20000}
            className="max-h-40 min-h-[42px] flex-1 resize-y rounded-xl border border-navy-600 bg-navy-900 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-dim focus:border-accent" />
          {voice.recognitionSupported && !busy && (
            <button type="button" onClick={() => void talk()} disabled={status?.blocked}
              aria-pressed={voice.listening} aria-label={voice.listening ? 'Terminar de hablar' : 'Hablar con JARVIS'}
              title={voice.listening ? 'Terminar de hablar' : `Hablar (el audio lo procesa el ${voice.processor})`}
              className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-40 ${voice.listening ? 'border-danger bg-danger/20 text-danger' : 'border-navy-600 bg-navy-900 text-accent hover:border-accent'}`}>
              <Mic size={18} aria-hidden />
            </button>
          )}
          {busy
            ? <Button tone="danger" onClick={stop} title="Detener la respuesta"><CircleStop size={16} aria-hidden /> Detener</Button>
            : <Button type="submit" tone="accent" disabled={!input.trim() || status?.blocked} title="Enviar"><Send size={16} aria-hidden /> Enviar</Button>}
        </form>
      </section>
    </div>
  );
}
