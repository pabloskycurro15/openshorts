import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { CURRENT_PHASE, SECTIONS } from '../src/sections/registry';
import { Markdown } from '../src/components/Markdown';
import { STATE_PARAMS } from '../src/components/AICore';
import { STATE_LABEL } from '../src/lib/labels';
import { formatBytes, formatDuration } from '../src/lib/api';
import { readStore, writeStore } from '../src/lib/storage';

describe('secciones', () => {
  it('existen las 15 secciones del documento, con ids únicos', () => {
    expect(SECTIONS).toHaveLength(15);
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(15);
  });

  it('toda sección aún no operativa explica qué hará y en qué fase', () => {
    for (const s of SECTIONS.filter((x) => x.phase > CURRENT_PHASE)) {
      expect(s.planned?.length, s.id).toBeGreaterThan(0);
    }
  });
});

describe('Markdown', () => {
  it('renderiza formato básico y nunca inyecta HTML', () => {
    const { container } = render(<Markdown text={'Hola **mundo** y `código`\n\n- uno\n- dos\n\n<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('strong')?.textContent).toBe('mundo');
    expect(container.querySelector('code')?.textContent).toBe('código');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('núcleo visual', () => {
  it('define parámetros y etiqueta para los 8 estados', () => {
    const states = ['idle', 'listening', 'processing', 'thinking', 'speaking', 'executing', 'error', 'offline'];
    expect(Object.keys(STATE_PARAMS).sort()).toEqual([...states].sort());
    expect(Object.keys(STATE_LABEL).sort()).toEqual([...states].sort());
    expect(STATE_PARAMS.error.hue).toBe(1);
    expect(STATE_PARAMS.offline.hue).toBe(2);
  });
});

describe('utilidades', () => {
  it('formatea bytes y duraciones', () => {
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(16 * 1024 ** 3)).toBe('16.0 GB');
    expect(formatDuration(90061)).toBe('1 d 1 h 1 min');
    expect(formatDuration(59)).toBe('0 min');
  });

  it('el almacenamiento tolera un localStorage que falla', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    expect(readStore('x', 'def')).toBe('def');
    spy.mockRestore();
    const spy2 = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('lleno'); });
    expect(() => writeStore('x', 1)).not.toThrow();
    spy2.mockRestore();
  });
});

// ── Integración de la App con un núcleo simulado (fetch + WebSocket falsos) ──

class FakeWS {
  static last: FakeWS | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.last = this;
    setTimeout(() => this.onopen?.(), 0);
  }
  close() {}
  emit(type: string, payload: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type, ts: new Date().toISOString(), payload }) });
  }
}

const health = { status: 'ok', version: '0.1.0', uptimeSec: 5, lockdown: false, modules: [{ id: 'system', name: 'Sistema', version: '0.1.0', description: '', dependsOn: [], status: 'running', error: null }] };

const aiStatus = { provider: 'anthropic', configured: true, keyUpdatedAt: null, settings: { model: 'claude-opus-5-5', effort: 'medium', monthlyLimitUsd: 5 },
  models: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5', description: '', price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } }],
  spentMonthUsd: 0, budgetRatio: 0, warn: false, blocked: false, activeConversations: [] };
let aiConfigured = true;
const voiceEvents: string[] = [];

function mockCore(validToken: string) {
  vi.stubGlobal('WebSocket', FakeWS);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
    if (auth !== `Bearer ${validToken}`) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    const path = String(url);
    if (path === '/api/chat') {
      const lines = [
        { type: 'start', conversationId: '11111111-1111-4111-8111-111111111111', title: 'Hola' },
        { type: 'text', delta: 'A su ' }, { type: 'text', delta: '**servicio**.' },
        { type: 'tool_call', id: 't1', tool: 'system.datetime', input: {} },
        { type: 'approval_required', id: 't1', approvalId: 'ap1', tool: 'system.datetime', reason: 'jarvis pide permiso para: system.time.read', risk: 'low' },
        { type: 'usage', model: 'claude-opus-5-5', costUsd: 0.0061, monthUsd: 0.01, limitUsd: 5 },
        { type: 'done', stopReason: 'end_turn' },
      ].map((l) => JSON.stringify(l)).join('\n') + '\n';
      return new Response(lines, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
    }
    if (path === '/api/voice/event') { voiceEvents.push(JSON.parse(String(init?.body)).event); return new Response('{"ok":true}', { status: 200 }); }
    const body = path.startsWith('/api/ai/status') ? { ...aiStatus, configured: aiConfigured }
      : path.startsWith('/api/conversations') ? []
      : path.startsWith('/api/health') ? health
      : path.startsWith('/api/approvals') ? []
      : path.startsWith('/api/tools/invoke') ? { status: 'ok', output: { platform: 'linux', release: '6', arch: 'x64', hostname: 'pc', cpu: { model: 'x', cores: 4, loadAvg: [1, 1, 1] }, memory: { totalBytes: 100, freeBytes: 50 }, uptimeSec: 60 } }
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  }));
}

async function renderApp() {
  vi.resetModules();
  const { App } = await import('../src/App');
  const { ConnectionProvider } = await import('../src/lib/connection');
  const { SettingsProvider } = await import('../src/lib/settings');
  const { VoiceProvider } = await import('../src/voice/VoiceProvider');
  return render(<SettingsProvider><ConnectionProvider><VoiceProvider><App /></VoiceProvider></ConnectionProvider></SettingsProvider>);
}

describe('App', () => {
  beforeEach(() => { vi.unstubAllGlobals(); FakeWS.last = null; });

  it('sin token muestra la pantalla de vinculación', async () => {
    mockCore('buen-token');
    await renderApp();
    expect(screen.getByLabelText('Token de acceso')).toBeTruthy();
  });

  it('con token válido muestra el panel con las 15 secciones y reacciona a eventos', async () => {
    mockCore('buen-token');
    window.localStorage.setItem('jarvis.token', JSON.stringify('buen-token'));
    await renderApp();
    await waitFor(() => expect(screen.getAllByText('Núcleo en línea').length).toBeGreaterThan(0));
    const nav = screen.getAllByRole('navigation', { name: 'Secciones' })[0]!;
    expect(nav.querySelectorAll('button')).toHaveLength(15);

    act(() => FakeWS.last!.emit('assistant.state', { state: 'thinking' }));
    await waitFor(() => expect(document.querySelector('canvas[data-state="thinking"]')).toBeTruthy());

    act(() => FakeWS.last!.emit('emergency.changed', { lockdown: true, by: { kind: 'user', id: 'owner' } }));
    await waitFor(() => expect(screen.getAllByText('Modo emergencia').length).toBeGreaterThan(0));
  });

  it('las secciones futuras dicen claramente que no funcionan aún', async () => {
    mockCore('t');
    window.localStorage.setItem('jarvis.token', JSON.stringify('t'));
    window.location.hash = '/memoria';
    await renderApp();
    await waitFor(() => expect(screen.getByText('Disponible en la Fase 6')).toBeTruthy());
    expect(screen.getByText(/todavía no funciona/)).toBeTruthy();
  });

  it('Conversación sin clave API: explica cómo configurarla', async () => {
    mockCore('t');
    aiConfigured = false;
    window.localStorage.setItem('jarvis.token', JSON.stringify('t'));
    window.location.hash = '/conversacion';
    await renderApp();
    await waitFor(() => expect(screen.getByText('Cerebro sin configurar')).toBeTruthy());
    aiConfigured = true;
  });

  it('Conversación: muestra la respuesta en streaming, la herramienta, la confirmación y el coste', async () => {
    mockCore('t');
    window.localStorage.setItem('jarvis.token', JSON.stringify('t'));
    window.location.hash = '/conversacion';
    await renderApp();
    const input = await screen.findByLabelText('Mensaje para JARVIS');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input, { target: { value: 'Hola' } });
    fireEvent.click(screen.getByTitle('Enviar'));
    await waitFor(() => expect(screen.getByText('servicio')).toBeTruthy());
    expect(screen.getByText('Hola')).toBeTruthy();
    expect(screen.getByText('system.datetime')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Confirmación requerida' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aprobar siempre' })).toBeTruthy();
    expect(screen.getByText(/0\.0061 \$ · mes 0\.01 \$ de 5\.00 \$/)).toBeTruthy();
  });

  it('Voz: hablar envía el mensaje, la respuesta se lee en voz alta y el micrófono queda auditado', async () => {
    const { FakeRecognition, installFakeSynthesis } = await import('./voice-fakes');
    mockCore('t');
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    const { spoken } = installFakeSynthesis();
    window.localStorage.setItem('jarvis.token', JSON.stringify('t'));
    window.location.hash = '/conversacion';
    await renderApp();
    const mic = await screen.findByRole('button', { name: 'Hablar con JARVIS' });
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(mic);
    await waitFor(() => expect(FakeRecognition.instances.length).toBeGreaterThan(0));
    const rec = FakeRecognition.instances.at(-1)!;
    expect(screen.getByRole('status').textContent).toMatch(/Escuchando/);
    act(() => rec.say([{ text: 'hola jarvis', final: true }]));
    act(() => rec.onend!());
    await waitFor(() => expect(screen.getByText('hola jarvis')).toBeTruthy());
    await waitFor(() => expect(spoken.map((s) => s.text)).toContain('A su servicio.'));
    expect(spoken.map((s) => s.text)).toContain('Necesito tu confirmación.');
    expect(voiceEvents).toEqual(expect.arrayContaining(['mic_on', 'mic_off']));
  });

  it('un token guardado que ya no es válido vuelve a la pantalla de vinculación', async () => {
    mockCore('nuevo');
    window.localStorage.setItem('jarvis.token', JSON.stringify('viejo'));
    await renderApp();
    await waitFor(() => expect(screen.getByText('El token guardado ya no es válido.')).toBeTruthy());
  });
});
