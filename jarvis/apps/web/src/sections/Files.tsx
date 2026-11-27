import { useEffect, useState, type FormEvent } from 'react';
import { AppWindow, ChevronRight, File, Folder, FolderPlus, Package, Play, TerminalSquare, Trash2 } from 'lucide-react';
import type { ToolResult } from '@jarvis/shared';
import { Badge, Button, Empty, ErrorNote, Panel } from '../components/ui';
import { core, formatBytes } from '../lib/api';
import { useConnection } from '../lib/connection';

interface FolderCfg { id: string; label: string; path: string; access: 'read' | 'readwrite' }
interface AppCfg { id: string; name: string; command: string; args: string[]; processName?: string }
interface CmdCfg { id: string; name: string; description: string; command: string; args: string[]; cwdFolderId?: string; timeoutSec: number }
interface ControlCfg { folders: FolderCfg[]; apps: AppCfg[]; commands: CmdCfg[] }
interface Entry { name: string; type: 'dir' | 'file' | 'other'; size: number | null; modified: string | null }

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
const uniqueId = (base: string, taken: string[]) => { let id = slug(base); let i = 2; while (taken.includes(id)) id = `${slug(base).slice(0, 36)}-${i++}`; return id; };
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const input = 'w-full rounded-lg border border-navy-600 bg-navy-900 px-3 py-1.5 text-sm outline-none focus:border-accent';

/** Ejecuta una herramienta como usuario; si requiere confirmación, la pide en el momento. */
async function runTool(tool: string, args: unknown): Promise<ToolResult> {
  const r = await core.invoke(tool, args);
  if (r.status !== 'pending_approval') return r;
  if (!window.confirm(`Esta acción es de riesgo alto (${tool}). ¿Confirmas que quieres ejecutarla?`)) return core.resolveApproval(r.approvalId, 'denied');
  return core.resolveApproval(r.approvalId, 'approved');
}

function Explorer({ folders }: { folders: FolderCfg[] }) {
  const [folder, setFolder] = useState(folders[0]?.id ?? '');
  const [dir, setDir] = useState('.');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!folders.some((f) => f.id === folder)) setFolder(folders[0]?.id ?? '');
  }, [folders, folder]);

  useEffect(() => {
    if (!folder) return;
    setErr(null);
    setPreview(null);
    void core.invoke('fs.list', { path: dir, folder }).then((r) => {
      if (r.status === 'ok') setEntries((r.output as { entries: Entry[] }).entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1)));
      else setErr(r.status === 'error' ? r.error : r.status === 'denied' ? r.reason : 'Pendiente');
    });
  }, [folder, dir]);

  if (!folders.length) return <Empty>Autoriza una carpeta para poder explorarla.</Empty>;
  const crumbs = dir === '.' ? [] : dir.split(/[\\/]/);
  const open = async (e: Entry) => {
    const p = dir === '.' ? e.name : `${dir}/${e.name}`;
    if (e.type === 'dir') return setDir(p);
    const r = await core.invoke('fs.read_text', { path: p, folder });
    if (r.status === 'ok') setPreview({ name: e.name, content: (r.output as { content: string }).content });
    else setErr(r.status === 'error' ? r.error : 'No se pudo leer');
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <select aria-label="Carpeta" value={folder} onChange={(e) => { setFolder(e.target.value); setDir('.'); }} className="rounded-lg border border-navy-600 bg-navy-900 px-2 py-1">
          {folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <button type="button" className="text-accent-soft hover:underline" onClick={() => setDir('.')}>raíz</button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1"><ChevronRight size={12} className="text-dim" aria-hidden />
            <button type="button" className="text-accent-soft hover:underline" onClick={() => setDir(crumbs.slice(0, i + 1).join('/'))}>{c}</button></span>
        ))}
      </div>
      {err && <div className="mt-2"><ErrorNote>{err}</ErrorNote></div>}
      <ul className="mt-3 max-h-80 divide-y divide-navy-700 overflow-y-auto rounded-lg border border-navy-700">
        {entries?.map((e) => (
          <li key={e.name}>
            <button type="button" onClick={() => void open(e)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-navy-800">
              {e.type === 'dir' ? <Folder size={15} className="text-accent" aria-hidden /> : <File size={15} className="text-dim" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <span className="font-mono text-[11px] text-dim">{e.size !== null ? formatBytes(e.size) : ''}</span>
            </button>
          </li>
        ))}
        {entries && !entries.length && <li className="px-3 py-3 text-center text-xs text-dim">Carpeta vacía</li>}
      </ul>
      {preview && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-muted"><span className="font-mono">{preview.name}</span><Button tone="ghost" onClick={() => setPreview(null)}>Cerrar</Button></div>
          <pre className="max-h-72 overflow-auto rounded-lg bg-bg/80 p-3 font-mono text-xs whitespace-pre-wrap">{preview.content}</pre>
        </div>
      )}
    </div>
  );
}

export function FilesSection() {
  const { status } = useConnection();
  const [cfg, setCfg] = useState<ControlCfg | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fForm, setFForm] = useState({ label: '', path: '', access: 'read' as FolderCfg['access'] });
  const [aForm, setAForm] = useState({ name: '', command: '', args: '', processName: '' });
  const [cForm, setCForm] = useState({ name: '', description: '', command: '', args: '', cwdFolderId: '', timeoutSec: 60 });

  const load = () => core.control().then(setCfg).catch((e: Error) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { if (status === 'online') void load(); }, [status]);

  const save = async (next: ControlCfg, ok: string) => {
    setMsg(null);
    try {
      setCfg(await core.setControl(next));
      setMsg({ ok: true, text: ok });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  if (!cfg) return <Empty>Cargando…</Empty>;

  const addFolder = async (e: FormEvent) => {
    e.preventDefault();
    const f: FolderCfg = { id: uniqueId(fForm.label, cfg.folders.map((x) => x.id)), label: fForm.label.trim(), path: fForm.path.trim(), access: fForm.access };
    if (await save({ ...cfg, folders: [...cfg.folders, f] }, `Carpeta «${f.label}» autorizada.`)) setFForm({ label: '', path: '', access: 'read' });
  };
  const addApp = async (e: FormEvent) => {
    e.preventDefault();
    const a: AppCfg = { id: uniqueId(aForm.name, cfg.apps.map((x) => x.id)), name: aForm.name.trim(), command: aForm.command.trim(), args: lines(aForm.args), ...(aForm.processName.trim() ? { processName: aForm.processName.trim() } : {}) };
    if (await save({ ...cfg, apps: [...cfg.apps, a] }, `Aplicación «${a.name}» autorizada.`)) setAForm({ name: '', command: '', args: '', processName: '' });
  };
  const addCmd = async (e: FormEvent) => {
    e.preventDefault();
    const c: CmdCfg = { id: uniqueId(cForm.name, cfg.commands.map((x) => x.id)), name: cForm.name.trim(), description: cForm.description.trim(), command: cForm.command.trim(), args: lines(cForm.args), timeoutSec: cForm.timeoutSec, ...(cForm.cwdFolderId ? { cwdFolderId: cForm.cwdFolderId } : {}) };
    if (await save({ ...cfg, commands: [...cfg.commands, c] }, `Comando «${c.name}» autorizado.`)) setCForm({ name: '', description: '', command: '', args: '', cwdFolderId: '', timeoutSec: 60 });
  };
  const remove = (kind: keyof ControlCfg, id: string, label: string) => {
    if (!window.confirm(`¿Quitar «${label}» de la lista autorizada?`)) return;
    void save({ ...cfg, [kind]: (cfg[kind] as { id: string }[]).filter((x) => x.id !== id) } as ControlCfg, `«${label}» ya no está autorizado.`);
  };
  const exec = async (tool: string, args: unknown, label: string) => {
    const r = await runTool(tool, args);
    setMsg(r.status === 'ok'
      ? { ok: true, text: `${label}: ${tool === 'command.run' ? `código ${(r.output as { exitCode: number }).exitCode}. ${String((r.output as { stdout: string }).stdout).slice(0, 300)}` : 'hecho.'}` }
      : { ok: false, text: `${label}: ${r.status === 'error' ? r.error : r.status === 'denied' ? r.reason : r.status}` });
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2 rounded-lg border border-navy-700 bg-navy-900/50 p-3 text-xs text-muted">
        JARVIS solo puede tocar lo que autorices aquí. Todo lo demás de tu equipo no existe para él. Leer es de riesgo bajo; crear archivos, medio; modificar, mover, borrar (a su papelera), cerrar aplicaciones y ejecutar comandos, alto: siempre te pedirá confirmación.
      </div>
      {msg && <div className="lg:col-span-2">{msg.ok ? <p role="status" className="text-sm text-ok">{msg.text}</p> : <ErrorNote>{msg.text}</ErrorNote>}</div>}

      <Panel title="Carpetas autorizadas" icon={FolderPlus}>
        <ul className="space-y-2">
          {cfg.folders.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              <Folder size={15} className="text-accent" aria-hidden />
              <span className="min-w-0 flex-1"><span className="block truncate">{f.label}</span><span className="block truncate font-mono text-[11px] text-dim">{f.path}</span></span>
              <Badge tone={f.access === 'readwrite' ? 'warn' : 'ok'}>{f.access === 'readwrite' ? 'Lectura y escritura' : 'Solo lectura'}</Badge>
              <button type="button" aria-label={`Quitar ${f.label}`} onClick={() => remove('folders', f.id, f.label)} className="p-1 text-dim hover:text-danger"><Trash2 size={14} /></button>
            </li>
          ))}
          {!cfg.folders.length && <li className="text-sm text-muted">Ninguna todavía.</li>}
        </ul>
        <form onSubmit={addFolder} className="mt-4 space-y-2 border-t border-navy-700 pt-3">
          <input aria-label="Nombre de la carpeta" required placeholder="Nombre (p. ej. Proyectos)" value={fForm.label} onChange={(e) => setFForm({ ...fForm, label: e.target.value })} className={input} />
          <input aria-label="Ruta de la carpeta" required placeholder="Ruta completa (Windows: C:\Users\Tú\Proyectos · Mac: /Users/tú/Proyectos)" value={fForm.path} onChange={(e) => setFForm({ ...fForm, path: e.target.value })} className={`${input} font-mono`} />
          <div className="flex gap-2">
            <select aria-label="Acceso" value={fForm.access} onChange={(e) => setFForm({ ...fForm, access: e.target.value as FolderCfg['access'] })} className={input}>
              <option value="read">Solo lectura</option><option value="readwrite">Lectura y escritura</option>
            </select>
            <Button type="submit" tone="accent">Autorizar</Button>
          </div>
        </form>
      </Panel>

      <Panel title="Explorador" icon={Folder}><Explorer folders={cfg.folders} /></Panel>

      <Panel title="Aplicaciones autorizadas" icon={AppWindow}>
        <ul className="space-y-2">
          {cfg.apps.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1"><span className="block truncate">{a.name}</span><span className="block truncate font-mono text-[11px] text-dim">{a.command} {a.args.join(' ')}</span></span>
              <Button onClick={() => void exec('app.open', { appId: a.id }, a.name)}><Play size={13} aria-hidden /> Abrir</Button>
              <button type="button" aria-label={`Quitar ${a.name}`} onClick={() => remove('apps', a.id, a.name)} className="p-1 text-dim hover:text-danger"><Trash2 size={14} /></button>
            </li>
          ))}
          {!cfg.apps.length && <li className="text-sm text-muted">Ninguna todavía.</li>}
        </ul>
        <form onSubmit={addApp} className="mt-4 space-y-2 border-t border-navy-700 pt-3">
          <input aria-label="Nombre de la aplicación" required placeholder="Nombre (p. ej. Bloc de notas)" value={aForm.name} onChange={(e) => setAForm({ ...aForm, name: e.target.value })} className={input} />
          <input aria-label="Ejecutable" required placeholder="Ejecutable (Windows: notepad.exe o C:\Program Files\...\app.exe · Mac: open)" value={aForm.command} onChange={(e) => setAForm({ ...aForm, command: e.target.value })} className={`${input} font-mono`} />
          <textarea aria-label="Argumentos" placeholder="Argumentos fijos (uno por línea, opcional; Mac: -a y en otra línea el nombre de la app, p. ej. Safari)" rows={2} value={aForm.args} onChange={(e) => setAForm({ ...aForm, args: e.target.value })} className={`${input} font-mono`} />
          <div className="flex gap-2">
            <input aria-label="Nombre de proceso" placeholder="Proceso para cerrarla (Windows: notepad.exe · Mac: nombre de la app, p. ej. Safari)" value={aForm.processName} onChange={(e) => setAForm({ ...aForm, processName: e.target.value })} className={`${input} font-mono`} />
            <Button type="submit" tone="accent">Autorizar</Button>
          </div>
        </form>
      </Panel>

      <Panel title="Comandos permitidos" icon={TerminalSquare}>
        <ul className="space-y-2">
          {cfg.commands.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1"><span className="block truncate">{c.name}</span><span className="block truncate font-mono text-[11px] text-dim">{c.command} {c.args.join(' ')}</span></span>
              <Button onClick={() => void exec('command.run', { commandId: c.id }, c.name)}><Play size={13} aria-hidden /> Ejecutar</Button>
              <button type="button" aria-label={`Quitar ${c.name}`} onClick={() => remove('commands', c.id, c.name)} className="p-1 text-dim hover:text-danger"><Trash2 size={14} /></button>
            </li>
          ))}
          {!cfg.commands.length && <li className="text-sm text-muted">Ninguno todavía.</li>}
        </ul>
        <form onSubmit={addCmd} className="mt-4 space-y-2 border-t border-navy-700 pt-3">
          <input aria-label="Nombre del comando" required placeholder="Nombre (p. ej. Compilar proyecto)" value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} className={input} />
          <input aria-label="Descripción" placeholder="Qué hace (lo leerá JARVIS)" value={cForm.description} onChange={(e) => setCForm({ ...cForm, description: e.target.value })} className={input} />
          <input aria-label="Programa" required placeholder="Programa (p. ej. npm.cmd, git, python)" value={cForm.command} onChange={(e) => setCForm({ ...cForm, command: e.target.value })} className={`${input} font-mono`} />
          <textarea aria-label="Argumentos del comando" placeholder="Argumentos fijos, uno por línea (p. ej. run ↵ build)" rows={2} value={cForm.args} onChange={(e) => setCForm({ ...cForm, args: e.target.value })} className={`${input} font-mono`} />
          <div className="flex gap-2">
            <select aria-label="Carpeta de trabajo" value={cForm.cwdFolderId} onChange={(e) => setCForm({ ...cForm, cwdFolderId: e.target.value })} className={input}>
              <option value="">Sin carpeta de trabajo</option>
              {cfg.folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <Button type="submit" tone="accent">Autorizar</Button>
          </div>
          <p className="text-[11px] text-dim">Se ejecutan sin intérprete de comandos y con argumentos fijos: JARVIS no puede añadir ni cambiar nada. Para scripts .bat usa «cmd.exe» con argumentos «/c» y la ruta del script.</p>
        </form>
      </Panel>
      <ProgramsPanel />
    </div>
  );
}

type ProgramRow = { id: string; name: string; purpose: string; installed: boolean | null; detail: string };

/** Programas que JARVIS puede usar o instalar (catálogo cerrado; instalar siempre se confirma). */
function ProgramsPanel() {
  const [rows, setRows] = useState<ProgramRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = async () => {
    const r = await core.invoke('programs.list', {});
    if (r.status === 'ok') setRows(r.output as ProgramRow[]);
  };
  useEffect(() => { void load(); }, []);
  return (
    <Panel title="Programas" icon={Package} className="lg:col-span-2">
      <p className="mb-3 text-xs text-muted">Programas que JARVIS sabe usar para crear vídeos y contenido. En Windows puede instalarlos por ti con winget (repositorio oficial de Microsoft), siempre con tu confirmación.</p>
      {rows ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-lg border border-navy-700 bg-navy-900/50 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-ink">{p.name} {p.installed ? <Badge tone="ok">Instalado</Badge> : p.installed === false ? <Badge tone="warn">No instalado</Badge> : <Badge>—</Badge>}</div>
                <div className="text-xs text-dim">{p.purpose}</div>
                {p.installed && p.detail && <div className="truncate font-mono text-[10px] text-dim">{p.detail}</div>}
              </div>
              {p.installed === false && (
                <Button disabled={!!busy} onClick={() => void (async () => {
                  setBusy(p.id);
                  setMsg(null);
                  const r = await runTool('programs.install', { id: p.id }).catch((err: Error) => ({ status: 'error' as const, error: err.message }));
                  setMsg(r.status === 'ok' ? { ok: true, text: `${p.name} instalado.` } : { ok: false, text: r.status === 'error' ? r.error : r.status === 'denied' ? r.reason : 'Sin resultado' });
                  setBusy(null);
                  void load();
                })()}>{busy === p.id ? 'Instalando…' : 'Instalar'}</Button>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-dim">Comprobando…</p>}
      {msg && <p role="status" className={`mt-2 text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </Panel>
  );
}
