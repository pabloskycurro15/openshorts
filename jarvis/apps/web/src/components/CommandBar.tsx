import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Mic, Send, ShieldQuestion, Square } from 'lucide-react';
import type { ChatEvent } from '@jarvis/shared';
import { core } from '../lib/api';
import { readStore, writeStore } from '../lib/storage';
import { useVoice } from '../voice/VoiceProvider';
import { ModelSwitch } from './ModelSwitch';

const CONV_KEY = 'jarvis.homeConversation';

/**
 * Barra de órdenes del Inicio: habla o escribe sin salir de la pantalla principal.
 * La respuesta aparece como subtítulo bajo el núcleo y se guarda en Conversación.
 */
export function CommandBar({ onSubtitle }: { onSubtitle: (text: string, live: boolean) => void }) {
  const voice = useVoice();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<{ approvalId: string; tool: string; risk: string } | null>(null);
  const conv = useRef<string | null>(readStore<string | null>(CONV_KEY, null));
  const text = useRef('');

  const send = async (raw: string, viaVoice: boolean) => {
    const message = raw.trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    text.current = '';
    onSubtitle('', true);
    const speak = !voice.settings.muted && (voice.settings.replyMode === 'always' || (voice.settings.replyMode === 'voice' && viaVoice));
    if (speak) voice.beginReply();
    const onEvent = (e: ChatEvent) => {
      switch (e.type) {
        case 'start':
          conv.current = e.conversationId;
          writeStore(CONV_KEY, e.conversationId);
          break;
        case 'text':
          text.current += e.delta;
          if (speak) voice.feed(e.delta);
          onSubtitle(text.current, true);
          break;
        case 'message_end':
          if (speak) { voice.endReply(); voice.beginReply(); }
          text.current += ' ';
          break;
        case 'tool_call':
          onSubtitle(`${text.current}\n⟐ ${e.tool}…`, true);
          break;
        case 'approval_required':
          setApproval({ approvalId: e.approvalId, tool: e.tool, risk: e.risk });
          if (speak) voice.say('Necesito tu confirmación.');
          break;
        case 'tool_result':
          setApproval(null);
          break;
        case 'error':
          text.current += `\n${e.message}`;
          onSubtitle(text.current, true);
          if (speak) voice.say(e.message);
          break;
      }
    };
    try {
      await core.chat({ conversationId: conv.current ?? undefined, message }, onEvent).catch(async (err: Error) => {
        // La conversación guardada pudo borrarse: empezar una nueva.
        if (conv.current && /inexistente|No encontrada/i.test(err.message)) {
          conv.current = null;
          writeStore(CONV_KEY, null);
          await core.chat({ message }, onEvent);
        } else throw err;
      });
    } catch (err) {
      onSubtitle(err instanceof Error ? err.message : String(err), false);
    } finally {
      if (speak) voice.endReply();
      setBusy(false);
      setApproval(null);
      onSubtitle(text.current.trim(), false);
    }
    if (viaVoice && voice.settings.handsFree && !voice.settings.muted) {
      await voice.whenIdle();
      void talk();
    }
  };

  const talk = async () => {
    if (voice.listening) return voice.stopListening();
    const t = await voice.listen();
    if (t) {
      if (voice.settings.autoSend) await send(t, true);
      else setInput(t);
    }
  };

  // «Jarvis, …»: ejecutar la orden; solo «Jarvis»: escuchar la orden a continuación.
  const handleWake = useRef<(c: string) => void>(() => {});
  handleWake.current = (command: string) => {
    if (busy) return;
    if (command) void send(command, true);
    else void talk();
  };
  useEffect(() => {
    const off = voice.onWake((c) => handleWake.current(c));
    const pending = voice.takePendingWake();
    if (pending !== null) handleWake.current(pending);
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.onWake]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(input, false);
  };

  return (
    <div className="w-full max-w-2xl">
      {approval && (
        <div className="holo-pill mb-2 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-2 text-sm" role="group" aria-label="Confirmación requerida">
          <ShieldQuestion size={16} className="text-accent" aria-hidden />
          <span className="flex-1">JARVIS pide permiso para usar <span className="font-mono text-amber-200">{approval.tool}</span></span>
          <button type="button" className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-bg" onClick={() => void core.resolveApproval(approval.approvalId, 'approved')}>Aprobar</button>
          {(approval.risk === 'low' || approval.risk === 'medium') && <button type="button" className="rounded-full border border-accent/60 px-3 py-1 text-xs text-accent" onClick={() => void core.resolveApproval(approval.approvalId, 'approved_always')}>Siempre</button>}
          <button type="button" className="rounded-full border border-danger/60 px-3 py-1 text-xs text-danger" onClick={() => void core.resolveApproval(approval.approvalId, 'denied')}>Denegar</button>
        </div>
      )}
      <form onSubmit={submit} className="holo-pill flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-5">
        <label htmlFor="home-cmd" className="sr-only">Orden para JARVIS</label>
        <input id="home-cmd" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} autoComplete="off"
          placeholder={voice.listening ? (voice.partial || 'Escuchando…') : 'Háblale o escríbele a JARVIS…'}
          className="min-w-0 flex-1 bg-transparent py-2 font-mono text-sm text-ink outline-none placeholder:text-dim" />
        <span className="hidden sm:block"><ModelSwitch /></span>
        {voice.recognitionSupported && (
          <button type="button" onClick={() => void talk()} disabled={busy} aria-label={voice.listening ? 'Terminar de hablar' : 'Hablar con JARVIS'}
            className={`flex h-10 w-10 items-center justify-center rounded-full border transition-all ${voice.listening ? 'border-danger bg-danger/25 text-danger shadow-[0_0_18px_var(--color-danger)]' : 'border-accent/50 text-accent hover:bg-accent/15'}`}>
            <Mic size={17} aria-hidden />
          </button>
        )}
        {busy ? (
          <button type="button" aria-label="Detener" onClick={() => { voice.cancelSpeech(); if (conv.current) void core.stopChat(conv.current); }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-danger/80 text-bg"><Square size={14} aria-hidden /></button>
        ) : (
          <button type="submit" aria-label="Enviar" disabled={!input.trim()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-bg shadow-[0_0_20px_var(--accent)] transition-transform hover:scale-105 disabled:opacity-40 disabled:shadow-none">
            <Send size={16} aria-hidden />
          </button>
        )}
      </form>
    </div>
  );
}
