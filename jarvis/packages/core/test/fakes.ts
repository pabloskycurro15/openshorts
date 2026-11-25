import type { AIProvider, ChatMessage, TurnRequest, TurnResult } from '../src/ai/provider';
import { ANTHROPIC_MODELS } from '../src/ai/pricing';

type Step = Partial<TurnResult> | ((req: TurnRequest) => Promise<Partial<TurnResult>> | Partial<TurnResult>);

/** Proveedor de pruebas con respuestas guionizadas (solo para tests). */
export class ScriptedProvider implements AIProvider {
  readonly id = 'test';
  readonly displayName = 'Test';
  readonly models = ANTHROPIC_MODELS;
  calls: TurnRequest[] = [];
  constructor(private script: Step[]) {}

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    this.calls.push({ ...req, messages: structuredClone(req.messages) });
    const step = this.script.shift();
    if (!step) throw new Error('Guion agotado');
    const r = typeof step === 'function' ? await step(req) : step;
    const message: ChatMessage = r.message ?? { role: 'assistant', content: [] };
    for (const b of message.content) if (b.type === 'text') req.onText?.(b.text);
    return {
      message,
      stopReason: r.stopReason ?? 'end_turn',
      usage: r.usage ?? { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
      servedModel: r.servedModel ?? req.model,
      refusalDetail: r.refusalDetail,
    };
  }

  async healthCheck() {
    return { ok: true, detail: 'ok' };
  }
}

export const text = (t: string): Partial<TurnResult> => ({ message: { role: 'assistant', content: [{ type: 'text', text: t }] } });
export const toolCall = (id: string, name: string, input: unknown = {}, pre = ''): Partial<TurnResult> => ({
  stopReason: 'tool_use',
  message: { role: 'assistant', content: [...(pre ? [{ type: 'text' as const, text: pre }] : []), { type: 'tool_use', id, name, input }] },
});
