import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ChatEvent, Principal } from '@jarvis/shared';
import { createJarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { buildServer } from '../src/server/http';
import type { Embedder } from '../src/memory/embedder';
import { fold } from '../src/memory/store';
import { EXPLICIT_REMEMBER } from '../src/memory/tools';
import { JARVIS_PRINCIPAL } from '../src/ai/engine';
import { ScriptedProvider, text, toolCall } from './fakes';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };

/** Embedder de pruebas: «significado» por grupos de sinónimos (determinista, sin red). */
const GROUPS = [['trabajo', 'trabaja', 'empleo', 'oficio', 'diseñador', 'agencia', 'curro'], ['cafe', 'desayuno', 'bebida', 'mañanas'], ['web', 'pagina', 'sitio', 'bar', 'nerja', 'proyecto']];
class FakeEmbedder implements Embedder {
  readonly model = 'fake';
  ready = false;
  status() { return { state: (this.ready ? 'ready' : 'idle') as 'ready' | 'idle', model: this.model, error: null }; }
  async load() { this.ready = true; }
  async embed(texts: string[]) {
    return texts.map((t) => {
      const f = fold(t);
      const v = new Float32Array(GROUPS.length + 1);
      GROUPS.forEach((g, i) => { v[i] = g.filter((w) => f.includes(w)).length; });
      v[GROUPS.length] = 0.1;
      const n = Math.hypot(...v);
      return v.map((x) => x / n);
    });
  }
}

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function setup(script: ConstructorParameters<typeof ScriptedProvider>[0] = []) {
  const provider = new ScriptedProvider(script);
  const embedder = new FakeEmbedder();
  const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', providerFactory: () => provider, embedder });
  await j.start();
  return { j, provider, embedder };
}
const mk = (j: Awaited<ReturnType<typeof setup>>['j'], category: 'long_term' | 'personal' | 'project' | 'short_term', title: string, content: string, extra: object = {}) =>
  j.memory.create(USER, { category, title, content, ...extra }, { source: 'usuario', status: 'confirmed' });

describe('Memoria: almacenamiento', () => {
  it('crea, edita, confirma, relaciona y borra (con auditoría sin contenido)', async () => {
    const { j } = await setup();
    const a = mk(j, 'project', 'Web del bar La Marina', 'Proyecto en Nerja: web con reservas', { project: 'La Marina', tags: ['web', 'nerja'] });
    expect(a).toMatchObject({ category: 'project', project: 'La Marina', tags: ['web', 'nerja'], status: 'confirmed', confidence: 1, source: 'usuario' });
    const b = j.memory.create(JARVIS_PRINCIPAL, { category: 'long_term', title: 'Prefiere webs oscuras', content: 'Parece preferir diseños oscuros' }, { source: 'jarvis', status: 'suggested' });
    expect(b.status).toBe('suggested');
    expect(j.memory.confirm(USER, b.id).status).toBe('confirmed');
    expect(() => j.memory.confirm(JARVIS_PRINCIPAL, b.id)).toThrow(/Solo el usuario/);
    j.memory.link(USER, a.id, b.id, 'estilo');
    expect(j.memory.links(a.id)).toMatchObject([{ fromId: a.id, toId: b.id, relation: 'estilo', otherTitle: 'Prefiere webs oscuras' }]);
    expect(j.memory.update(USER, a.id, { content: 'Web con reservas y carta' }).content).toBe('Web con reservas y carta');
    expect(j.memory.delete(USER, b.id)).toBe(true);
    expect(j.memory.links(a.id)).toEqual([]);
    const audit = JSON.stringify(j.audit.list({ limit: 50 }));
    expect(audit).toContain('memory.create');
    expect(audit).not.toContain('reservas'); // el contenido no va al registro
  });

  it('marca lo sensible y caduca el corto plazo', async () => {
    const { j } = await setup();
    expect(mk(j, 'personal', 'Banco', 'Mi cuenta bancaria es del BBVA').sensitive).toBe(true);
    const st = mk(j, 'short_term', 'Llamar luego', 'Llamar a Ana a las cinco');
    expect(st.expiresAt).not.toBeNull();
    j.db.prepare('UPDATE memories SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), st.id);
    expect((await j.memory.search({ query: 'Ana' })).length).toBe(0);
    expect(j.memory.purgeExpired()).toBe(1);
  });
});

describe('Memoria: búsqueda híbrida', () => {
  it('palabras sin tildes, prefijos y fragmentos con errores', async () => {
    const { j } = await setup();
    mk(j, 'long_term', 'Trabajo', 'Trabaja como diseñador gráfico en una agencia de Málaga');
    mk(j, 'long_term', 'Café', 'Le gusta el café solo por las mañanas');
    expect((await j.memory.search({ query: 'disenador' }))[0]!.title).toBe('Trabajo'); // sin tilde
    expect((await j.memory.search({ query: 'diseñ' }))[0]!.title).toBe('Trabajo'); // prefijo
    const typo = await j.memory.search({ query: 'malga agenci' }); // errores
    expect(typo[0]!.title).toBe('Trabajo');
    expect(typo[0]!.matchedBy).toContain('parcial');
  });

  it('por significado cuando no coinciden las palabras', async () => {
    const { j, embedder } = await setup();
    const trabajo = mk(j, 'long_term', 'Ocupación', 'Diseñador en una agencia');
    mk(j, 'long_term', 'Desayuno', 'Café solo por las mañanas');
    expect((await j.memory.search({ query: '¿de qué curro?' })).length).toBe(0); // sin significado: nada
    j.memory.updateSettings(USER, { semantic: true });
    await embedder.load();
    await j.memory.reindex();
    const hits = await j.memory.search({ query: '¿de qué curro?' });
    expect(hits[0]!.id).toBe(trabajo.id);
    expect(hits[0]!.matchedBy).toEqual(['significado']);
    expect(j.memory.semanticStatus()).toMatchObject({ state: 'ready', indexed: 2, total: 2 });
  });

  it('filtros: categoría, proyecto; lo personal excluido salvo petición; sugerencias puntúan menos', async () => {
    const { j } = await setup();
    mk(j, 'personal', 'Cumpleaños', 'Su cumpleaños es el 3 de mayo');
    mk(j, 'project', 'Bar Marina', 'Web del bar', { project: 'Marina' });
    mk(j, 'project', 'Tienda', 'Web de la tienda', { project: 'Tienda' });
    expect(await j.memory.search({ query: 'cumpleaños' })).toHaveLength(0);
    expect(await j.memory.search({ query: 'cumpleaños', includePersonal: true })).toHaveLength(1);
    expect((await j.memory.search({ query: 'web', project: 'Marina' })).map((h) => h.title)).toEqual(['Bar Marina']);
    j.memory.create(USER, { category: 'long_term', title: 'Web A', content: 'web' }, { source: 'x', status: 'suggested' });
    j.memory.create(USER, { category: 'long_term', title: 'Web B', content: 'web' }, { source: 'x', status: 'confirmed' });
    const hits = await j.memory.search({ query: 'web', categories: ['long_term'] });
    expect(hits[0]!.title).toBe('Web B');
  });
});

describe('Memoria: herramientas y reglas', () => {
  it('«recuerda que…» → confirmado; deducción propia → sugerencia', async () => {
    const { j } = await setup([
      toolCall('t1', 'memory.save', { category: 'long_term', title: 'Color favorito', content: 'Su color favorito es el naranja' }),
      text('Anotado.'),
      toolCall('t2', 'memory.save', { category: 'long_term', title: 'Le gusta el diseño', content: 'Parece interesarle el diseño' }),
      text('Lo tendré en cuenta.'),
    ]);
    j.ai.setApiKey(USER, 'sk-ant-api03-PRUEBA-0000000000000000');
    j.ai.budget.updateSettings({ model: 'claude-opus-5-5' });
    j.permissions.grant(USER, JARVIS_PRINCIPAL, 'memory.write');
    await j.ai.engine.run({ message: 'Recuerda que mi color favorito es el naranja' }, () => {});
    await j.ai.engine.run({ message: 'Me encanta mirar portfolios de diseñadores' }, () => {});
    const all = await j.memory.search({ query: '' });
    expect(Object.fromEntries(all.map((m) => [m.title, m.status]))).toEqual({ 'Color favorito': 'confirmed', 'Le gusta el diseño': 'suggested' });
    expect(all.find((m) => m.title === 'Color favorito')!.source).toMatch(/^conversación:/);
    expect(EXPLICIT_REMEMBER.test('no te olvides de que tengo cita')).toBe(true);
    expect(EXPLICIT_REMEMBER.test('¿qué recuerdos tienes?')).toBe(false);
  });

  it('lo sensible y lo personal piden permiso cada vez, aunque haya «aprobar siempre»', async () => {
    const { j } = await setup();
    j.permissions.grant(USER, JARVIS_PRINCIPAL, 'memory.write');
    j.permissions.grant(USER, JARVIS_PRINCIPAL, 'memory.read');
    const inv = (tool: string, args: object) => j.tools.invoke(JARVIS_PRINCIPAL, tool, args, { interactive: true, context: { lastUserText: 'recuerda esto' } });
    expect((await inv('memory.save', { category: 'long_term', title: 'Nota', content: 'Algo normal' })).status).toBe('ok');
    const s = await inv('memory.save', { category: 'personal', title: 'PIN', content: 'El PIN de la tarjeta es 1234' });
    expect(s.status).toBe('pending_approval');
    if (s.status !== 'pending_approval') return;
    await j.tools.resolveApproval(USER, s.approvalId, 'approved_always');
    expect((await inv('memory.save', { category: 'personal', title: 'PIN 2', content: 'Otro PIN de tarjeta' })).status).toBe('pending_approval');
    expect((await inv('memory.search', { query: 'pin' })).status).toBe('ok');
    expect((await inv('memory.search', { query: 'pin', includePersonal: true })).status).toBe('pending_approval');
  });

  it('con «siempre» en uso personal, no pide permiso para lo personal', async () => {
    const { j } = await setup();
    j.permissions.grant(USER, JARVIS_PRINCIPAL, 'memory.read');
    j.memory.updateSettings(USER, { personalUse: 'always' });
    expect((await j.tools.invoke(JARVIS_PRINCIPAL, 'memory.search', { query: 'x', includePersonal: true }, { interactive: true })).status).toBe('ok');
  });

  it('sin «proponer recuerdos», JARVIS solo guarda si se lo piden', async () => {
    const { j } = await setup();
    j.permissions.grant(USER, JARVIS_PRINCIPAL, 'memory.write');
    j.memory.updateSettings(USER, { autoSuggest: false });
    const args = { category: 'long_term', title: 'X', content: 'Y' };
    expect((await j.tools.invoke(JARVIS_PRINCIPAL, 'memory.save', args, { interactive: true, context: { lastUserText: 'hola' } })).status).toBe('error');
    expect((await j.tools.invoke(JARVIS_PRINCIPAL, 'memory.save', args, { interactive: true, context: { lastUserText: 'apunta esto' } })).status).toBe('ok');
  });

  it('borrar un recuerdo es de riesgo alto', async () => {
    const { j } = await setup();
    const m = mk(j, 'long_term', 'A', 'B');
    j.permissions.grant(USER, JARVIS_PRINCIPAL, 'memory.delete');
    expect((await j.tools.invoke(JARVIS_PRINCIPAL, 'memory.forget', { id: m.id }, { interactive: true })).status).toBe('pending_approval');
  });
});

describe('Memoria: API', () => {
  it('listado, creación, detalle con relaciones, confirmación y ajustes', async () => {
    const { j } = await setup();
    app = await buildServer(j, 'm'.repeat(43));
    const auth = { authorization: `Bearer ${'m'.repeat(43)}` };
    const created = (await app.inject({ method: 'POST', url: '/api/memory', headers: auth, payload: { category: 'project', title: 'Marina', content: 'Web del bar' } })).json();
    expect(created.status).toBe('confirmed');
    expect((await app.inject({ method: 'POST', url: '/api/memory', headers: auth, payload: { category: 'inventada', title: 'x', content: 'y' } })).statusCode).toBe(400);
    const list = (await app.inject({ url: '/api/memory?q=bar', headers: auth })).json();
    expect(list.items[0].id).toBe(created.id);
    expect(list.counts).toMatchObject({ total: 1, project: 1 });
    const detail = (await app.inject({ url: `/api/memory/${created.id}`, headers: auth })).json();
    expect(detail).toMatchObject({ memory: { title: 'Marina' }, links: [] });
    const s = (await app.inject({ method: 'PUT', url: '/api/memory/settings', headers: auth, payload: { autoSuggest: false } })).json();
    expect(s.settings).toMatchObject({ autoSuggest: false, personalUse: 'on_request', semantic: false });
  });
  void ({} as ChatEvent);
});
