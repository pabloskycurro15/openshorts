import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Brain, Check, Link2, Plus, Search, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { MEMORY_CATEGORY_LABEL, type Memory, type MemoryCategory, type MemoryHit, type MemoryLink, type MemorySettings, type SemanticStatus } from '@jarvis/shared';
import { Badge, Button, Empty, ErrorNote, Panel } from '../components/ui';
import { core } from '../lib/api';
import { useConnection } from '../lib/connection';
import { timeAgo } from '../lib/labels';

const CATS = Object.keys(MEMORY_CATEGORY_LABEL) as MemoryCategory[];
const input = 'w-full rounded-lg border border-navy-600 bg-navy-900 px-3 py-1.5 text-sm outline-none focus:border-accent';
const MATCH: Record<string, string> = { texto: 'palabras', parcial: 'fragmento', significado: 'significado', reciente: 'reciente' };

function sourceLabel(s: string) {
  if (s === 'usuario') return 'Tú';
  if (s.startsWith('conversación:')) return 'Conversación';
  return s;
}

function MemoryCard({ m, active, onOpen, onConfirm }: { m: MemoryHit; active: boolean; onOpen: () => void; onConfirm: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen}
        className={`w-full rounded-lg border p-3 text-left transition-colors ${active ? 'border-accent bg-accent/8' : 'border-navy-700 bg-navy-900/50 hover:border-navy-600'}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{m.title}</span>
          <Badge tone={m.category === 'personal' ? 'warn' : 'muted'}>{MEMORY_CATEGORY_LABEL[m.category]}</Badge>
          {m.status === 'suggested' && <Badge tone="accent">Sugerencia</Badge>}
          {m.sensitive && <Badge tone="danger">Sensible</Badge>}
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted">{m.content}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-dim">
          <span>{sourceLabel(m.source)}</span>
          <span>{timeAgo(m.updatedAt)}</span>
          <span>confianza {Math.round(m.confidence * 100)} %</span>
          {m.project && <span>· {m.project}</span>}
          {m.matchedBy.filter((x) => x !== 'reciente').length > 0 && <span className="text-accent-soft">por {m.matchedBy.map((x) => MATCH[x]).join(' + ')}</span>}
        </div>
      </button>
      {m.status === 'suggested' && (
        <div className="mt-1 flex justify-end"><button type="button" onClick={onConfirm} className="flex items-center gap-1 text-xs text-ok hover:underline"><Check size={12} aria-hidden /> Confirmar</button></div>
      )}
    </li>
  );
}

function Detail({ id, onChanged, onClose }: { id: string; onChanged: () => void; onClose: () => void }) {
  const [data, setData] = useState<{ memory: Memory; links: MemoryLink[] } | null>(null);
  const [edit, setEdit] = useState<{ title: string; content: string; category: MemoryCategory; project: string; tags: string } | null>(null);
  const [linkQ, setLinkQ] = useState('');
  const [linkHits, setLinkHits] = useState<MemoryHit[]>([]);
  const [relation, setRelation] = useState('relacionado');
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => core.memory(id).then(setData).catch((e: Error) => setErr(e.message)), [id]);
  useEffect(() => { void load(); setEdit(null); }, [load]);

  useEffect(() => {
    if (linkQ.trim().length < 2) { setLinkHits([]); return; }
    const t = setTimeout(() => { void core.memories({ q: linkQ }).then((r) => setLinkHits(r.items.filter((x) => x.id !== id).slice(0, 5))); }, 250);
    return () => clearTimeout(t);
  }, [linkQ, id]);

  if (!data) return <Empty>{err ?? 'Cargando…'}</Empty>;
  const m = data.memory;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    try {
      await core.updateMemory(id, { title: edit.title, content: edit.content, category: edit.category, project: edit.project || null, tags: edit.tags.split(',').map((t) => t.trim()).filter(Boolean) });
      setEdit(null);
      await load();
      onChanged();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base text-ink">{m.title}</h3>
        <button type="button" aria-label="Cerrar" onClick={onClose} className="text-dim hover:text-ink"><X size={16} /></button>
      </div>
      {edit ? (
        <form onSubmit={save} className="mt-3 space-y-2">
          <input aria-label="Título" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className={input} />
          <textarea aria-label="Contenido" rows={5} value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} className={input} />
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="Categoría" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as MemoryCategory })} className={input}>
              {CATS.map((c) => <option key={c} value={c}>{MEMORY_CATEGORY_LABEL[c]}</option>)}
            </select>
            <input aria-label="Proyecto" placeholder="Proyecto (opcional)" value={edit.project} onChange={(e) => setEdit({ ...edit, project: e.target.value })} className={input} />
          </div>
          <input aria-label="Etiquetas" placeholder="Etiquetas, separadas por comas" value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} className={input} />
          <div className="flex gap-2"><Button type="submit" tone="accent">Guardar</Button><Button tone="ghost" onClick={() => setEdit(null)}>Cancelar</Button></div>
        </form>
      ) : (
        <>
          <p className="mt-2 text-sm whitespace-pre-wrap text-ink/90">{m.content}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-dim">Categoría</dt><dd>{MEMORY_CATEGORY_LABEL[m.category]}</dd>
            <dt className="text-dim">Estado</dt><dd>{m.status === 'confirmed' ? 'Confirmado' : 'Sugerencia de JARVIS'}</dd>
            <dt className="text-dim">Origen</dt><dd>{sourceLabel(m.source)}</dd>
            <dt className="text-dim">Confianza</dt><dd>{Math.round(m.confidence * 100)} %</dd>
            <dt className="text-dim">Creado</dt><dd>{new Date(m.createdAt).toLocaleString('es-ES')}</dd>
            <dt className="text-dim">Actualizado</dt><dd>{new Date(m.updatedAt).toLocaleString('es-ES')}</dd>
            {m.expiresAt && <><dt className="text-dim">Caduca</dt><dd>{new Date(m.expiresAt).toLocaleString('es-ES')}</dd></>}
            {m.project && <><dt className="text-dim">Proyecto</dt><dd>{m.project}</dd></>}
            {m.tags.length > 0 && <><dt className="text-dim">Etiquetas</dt><dd>{m.tags.join(', ')}</dd></>}
            <dt className="text-dim">Significado</dt><dd>{m.hasEmbedding ? 'Indexado' : 'Sin indexar'}</dd>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {m.status === 'suggested' && <Button tone="accent" onClick={async () => { await core.confirmMemory(id); await load(); onChanged(); }}><Check size={14} aria-hidden /> Confirmar</Button>}
            <Button onClick={() => setEdit({ title: m.title, content: m.content, category: m.category, project: m.project ?? '', tags: m.tags.join(', ') })}>Editar</Button>
            <Button tone="danger" onClick={async () => { if (window.confirm(`¿Borrar «${m.title}» para siempre?`)) { await core.deleteMemory(id); onChanged(); onClose(); } }}><Trash2 size={14} aria-hidden /> Borrar</Button>
          </div>
        </>
      )}
      <div className="mt-5 border-t border-navy-700 pt-3">
        <div className="mb-2 flex items-center gap-2 text-xs tracking-wider text-dim uppercase"><Link2 size={13} aria-hidden /> Relaciones</div>
        {data.links.length ? (
          <ul className="space-y-1.5">
            {data.links.map((l) => (
              <li key={`${l.fromId}-${l.toId}-${l.relation}`} className="flex items-center gap-2 text-sm">
                <Badge>{l.relation}</Badge><span className="min-w-0 flex-1 truncate">{l.otherTitle}</span>
                <button type="button" aria-label="Quitar relación" className="text-dim hover:text-danger" onClick={async () => { await core.unlinkMemory(l.fromId, l.toId, l.relation); await load(); }}><X size={13} /></button>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted">Sin relaciones.</p>}
        <div className="mt-2 flex gap-2">
          <input aria-label="Relación" value={relation} onChange={(e) => setRelation(e.target.value)} className={`${input} w-36`} />
          <input aria-label="Buscar recuerdo para relacionar" placeholder="Buscar otro recuerdo…" value={linkQ} onChange={(e) => setLinkQ(e.target.value)} className={input} />
        </div>
        {linkHits.length > 0 && (
          <ul className="mt-1 rounded-lg border border-navy-700">
            {linkHits.map((h) => (
              <li key={h.id}><button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-navy-800"
                onClick={async () => { await core.linkMemory(id, h.id, relation || 'relacionado'); setLinkQ(''); await load(); }}>{h.title}</button></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SettingsBox({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<{ settings: MemorySettings; semantic: SemanticStatus } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => core.memorySettings().then(setS).catch((e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (s?.semantic.state !== 'loading') return;
    const t = setInterval(() => void load(), 1500);
    return () => clearInterval(t);
  }, [s?.semantic.state]);
  if (!s) return <Empty>{err ?? 'Cargando…'}</Empty>;
  const set = async (p: Partial<MemorySettings>) => setS(await core.setMemorySettings(p));
  const sem = s.semantic;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between"><span className="text-xs tracking-wider text-dim uppercase">Ajustes de memoria</span><button type="button" aria-label="Cerrar" onClick={onClose} className="text-dim hover:text-ink"><X size={16} /></button></div>
      <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={s.settings.autoSuggest} onChange={(e) => void set({ autoSuggest: e.target.checked })} />
        <span>JARVIS puede proponer recuerdos<span className="block text-xs text-dim">Siempre quedan como sugerencias hasta que los confirmes. Lo que le pidas recordar («recuerda que…») se confirma solo.</span></span></label>
      <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={s.settings.personalUse === 'always'} onChange={(e) => void set({ personalUse: e.target.checked ? 'always' : 'on_request' })} />
        <span>Usar mis recuerdos personales sin preguntar<span className="block text-xs text-dim">Desactivado (recomendado): solo se usan si lo pides, y con tu permiso cada vez.</span></span></label>
      <div className="flex items-center gap-3">
        <span>Duración del corto plazo</span>
        <select aria-label="Duración del corto plazo" value={s.settings.shortTermHours} onChange={(e) => void set({ shortTermHours: Number(e.target.value) })} className="rounded-lg border border-navy-600 bg-navy-900 px-2 py-1 text-sm">
          {[6, 24, 72, 168].map((h) => <option key={h} value={h}>{h < 24 ? `${h} h` : `${h / 24} día${h > 24 ? 's' : ''}`}</option>)}
        </select>
      </div>
      <div className="rounded-lg border border-navy-700 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><Sparkles size={14} className="text-accent" aria-hidden /> Búsqueda por significado</span>
          {sem.state === 'ready' ? <Badge tone="ok">Activa</Badge> : sem.state === 'loading' ? <Badge tone="accent">Preparando…</Badge> : sem.state === 'error' ? <Badge tone="danger">Error</Badge> : <Badge>Desactivada</Badge>}
        </div>
        <p className="mt-1 text-xs text-dim">Modelo multilingüe local (~120 MB, se descarga una vez). Entiende lo que buscas aunque uses otras palabras. Nada sale de tu equipo.</p>
        {sem.state === 'error' && <p className="mt-1 text-xs text-danger">{sem.error}</p>}
        {sem.state === 'ready' && <p className="mt-1 text-xs text-muted">{sem.indexed} de {sem.total} recuerdos indexados.</p>}
        <div className="mt-2">
          {s.settings.semantic
            ? <Button tone="ghost" onClick={() => void set({ semantic: false })}>Desactivar</Button>
            : <Button tone="accent" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await set({ semantic: true }); await core.loadSemantic(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); void load(); } }}>{busy ? 'Descargando y preparando…' : 'Activar'}</Button>}
        </div>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
    </div>
  );
}

export function MemorySection() {
  const { status, revision } = useConnection();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<MemoryCategory | ''>('');
  const [onlySuggested, setOnlySuggested] = useState(false);
  const [items, setItems] = useState<MemoryHit[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [side, setSide] = useState<'detail' | 'new' | 'settings'>('detail');
  const [form, setForm] = useState({ category: 'long_term' as MemoryCategory, title: '', content: '', project: '', tags: '' });
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await core.memories({ q: q || undefined, category: cat || undefined, status: onlySuggested ? 'suggested' : undefined });
      setItems(r.items ?? []);
      setCounts(r.counts ?? {});
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [q, cat, onlySuggested]);

  useEffect(() => {
    if (status !== 'online') return;
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [status, revision, load, q]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const m = await core.createMemory({ category: form.category, title: form.title, content: form.content, project: form.project || null, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) });
      setForm({ category: 'long_term', title: '', content: '', project: '', tags: '' });
      setSel(m.id);
      setSide('detail');
      await load();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Panel title="Memoria" icon={Brain} actions={
        <div className="flex gap-1">
          <Button tone="ghost" onClick={() => { setSide('new'); setSel(null); }}><Plus size={14} aria-hidden /> Nuevo</Button>
          <Button tone="ghost" onClick={() => setSide('settings')} title="Ajustes de memoria"><Settings2 size={14} aria-hidden /></Button>
        </div>
      }>
        <div className="flex items-center gap-2 rounded-lg border border-navy-600 bg-navy-900 px-3 focus-within:border-accent">
          <Search size={15} className="text-accent" aria-hidden />
          <label htmlFor="mem-q" className="sr-only">Buscar en la memoria</label>
          <input id="mem-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca por palabras, fragmentos o significado…" className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-dim" />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por categoría">
          <button type="button" aria-pressed={!cat} onClick={() => setCat('')} className={`rounded-full border px-2.5 py-0.5 text-xs ${!cat ? 'border-accent bg-accent/12 text-ink' : 'border-navy-600 text-muted'}`}>Todas · {counts.total ?? 0}</button>
          {CATS.map((c) => (
            <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(cat === c ? '' : c)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${cat === c ? 'border-accent bg-accent/12 text-ink' : 'border-navy-600 text-muted hover:text-ink'}`}>{MEMORY_CATEGORY_LABEL[c]}{counts[c] ? ` · ${counts[c]}` : ''}</button>
          ))}
          {(counts.suggested ?? 0) > 0 && (
            <button type="button" aria-pressed={onlySuggested} onClick={() => setOnlySuggested((v) => !v)} className={`rounded-full border px-2.5 py-0.5 text-xs ${onlySuggested ? 'border-accent bg-accent/20 text-ink' : 'border-accent/50 text-accent'}`}>Sugerencias por revisar · {counts.suggested}</button>
          )}
        </div>
        {err && <div className="mt-3"><ErrorNote>{err}</ErrorNote></div>}
        <ul className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {items?.map((m) => <MemoryCard key={m.id} m={m} active={sel === m.id} onOpen={() => { setSel(m.id); setSide('detail'); }} onConfirm={async () => { await core.confirmMemory(m.id); await load(); }} />)}
        </ul>
        {items && !items.length && <div className="mt-3"><Empty>{q ? 'Nada encontrado.' : 'La memoria está vacía. Crea un recuerdo o dile a JARVIS «recuerda que…».'}</Empty></div>}
      </Panel>

      <Panel>
        {side === 'settings' ? <SettingsBox onClose={() => setSide('detail')} />
          : side === 'new' ? (
            <form onSubmit={create} className="space-y-2">
              <div className="mb-1 text-xs tracking-wider text-dim uppercase">Nuevo recuerdo</div>
              <select aria-label="Categoría" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as MemoryCategory })} className={input}>
                {CATS.map((c) => <option key={c} value={c}>{MEMORY_CATEGORY_LABEL[c]}</option>)}
              </select>
              <input aria-label="Título del recuerdo" required placeholder="Título" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={input} />
              <textarea aria-label="Contenido del recuerdo" required rows={5} placeholder="Qué debe recordar JARVIS" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className={input} />
              <input aria-label="Proyecto del recuerdo" placeholder="Proyecto (opcional)" value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} className={input} />
              <input aria-label="Etiquetas del recuerdo" placeholder="Etiquetas, separadas por comas" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className={input} />
              <div className="flex gap-2"><Button type="submit" tone="accent">Guardar</Button><Button tone="ghost" onClick={() => setSide('detail')}>Cancelar</Button></div>
              <p className="text-[11px] text-dim">Los recuerdos que creas tú quedan confirmados con confianza del 100 %.</p>
            </form>
          ) : sel ? <Detail id={sel} onChanged={() => void load()} onClose={() => setSel(null)} />
          : <Empty>Selecciona un recuerdo para ver su origen, fecha, confianza y relaciones.</Empty>}
      </Panel>
    </div>
  );
}
