import fs from 'node:fs';
import path from 'node:path';
import type { DiagnosticCheck, DiagnosticsReport, Principal } from '@jarvis/shared';
import type { Jarvis } from '../app';

const MB = 1024 * 1024;

function dirSize(dir: string): number {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += dirSize(full);
    else if (e.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

/** Diagnóstico del sistema: comprobaciones con estado y explicación. Nunca incluye secretos. */
export function runDiagnostics(j: Jarvis): DiagnosticsReport {
  const checks: DiagnosticCheck[] = [];
  const add = (id: string, label: string, fn: () => [DiagnosticCheck['status'], string]) => {
    try {
      const [status, detail] = fn();
      checks.push({ id, label, status, detail });
    } catch (err) {
      checks.push({ id, label, status: 'error', detail: (err as Error).message });
    }
  };
  const one = <T>(sql: string, ...p: string[]) => j.db.prepare(sql).get(...p) as T;
  const since = new Date(Date.now() - 86_400_000).toISOString();

  add('db', 'Base de datos', () => {
    const r = j.db.pragma('quick_check', { simple: true });
    const v = j.db.pragma('user_version', { simple: true });
    return r === 'ok' ? ['ok', `Íntegra · esquema v${String(v)}`] : ['error', `Comprobación: ${String(r)}`];
  });
  add('audit', 'Registro de auditoría', () => {
    const v = j.audit.verify();
    return v.ok ? ['ok', `Cadena íntegra · ${v.count} registros`] : ['error', `Manipulado en el registro ${v.brokenAt}`];
  });
  add('vault', 'Almacén cifrado', () => {
    j.vault.set('diagnostics.probe', 'ok');
    const ok = j.vault.get('diagnostics.probe') === 'ok';
    j.vault.delete('diagnostics.probe');
    return ok ? ['ok', 'Cifrado y descifrado correctos'] : ['error', 'No se pudo descifrar'];
  });
  add('modules', 'Módulos', () => {
    const m = j.modules.list();
    const bad = m.filter((x) => x.status !== 'running');
    return bad.length ? ['error', `Con fallos: ${bad.map((b) => `${b.id} (${b.error ?? b.status})`).join(', ')}`] : ['ok', `${m.length} activos`];
  });
  add('disk', 'Espacio en disco', () => {
    const st = fs.statfsSync(j.config.dataDir);
    const free = st.bavail * st.bsize;
    const data = dirSize(j.config.dataDir);
    const txt = `${(free / 1024 / MB).toFixed(1)} GB libres · datos de JARVIS: ${(data / MB).toFixed(1)} MB`;
    return free < 1024 * MB ? ['error', txt] : free < 5 * 1024 * MB ? ['warn', txt] : ['ok', txt];
  });
  add('ai', 'Cerebro (IA)', () => {
    const s = j.ai.status();
    const conf = (s.providers ?? []).filter((p) => p.configured).map((p) => p.name);
    if (!conf.length) return ['warn', 'Sin claves configuradas: no puede responder'];
    return s.blocked ? ['error', `Presupuesto agotado (${s.spentMonthUsd.toFixed(2)} $ de ${s.settings.monthlyLimitUsd} $)`]
      : s.warn ? ['warn', `Gasto al ${Math.round(s.budgetRatio * 100)} % del límite · ${conf.join(', ')}`]
        : ['ok', `${conf.join(', ')} · gasto ${s.spentMonthUsd.toFixed(2)} $ de ${s.settings.monthlyLimitUsd} $`];
  });
  add('connectors', 'Conectores', () => {
    const on = j.connectors.list().filter((c) => c.enabled);
    const errs = one<{ n: number }>("SELECT COUNT(*) AS n FROM connector_log WHERE outcome = 'error' AND ts >= ?", since).n;
    if (!on.length) return ['ok', 'Ninguno activo'];
    return [errs ? 'warn' : 'ok', `${on.map((c) => c.name).join(', ')} · ${errs} error(es) en 24 h`];
  });
  add('automations', 'Automatizaciones', () => {
    const active = one<{ n: number }>('SELECT COUNT(*) AS n FROM automations WHERE enabled = 1').n;
    const failed = one<{ n: number }>("SELECT COUNT(*) AS n FROM automation_runs WHERE status IN ('error','denied') AND started_at >= ?", since).n;
    return [failed ? 'warn' : 'ok', `${active} activa(s) · ${failed} fallo(s) en 24 h`];
  });
  add('backup', 'Copias de seguridad', () => {
    const s = j.backups.status();
    if (!s.hasPassphrase) return ['warn', 'Sin configurar: define una frase y activa la copia diaria'];
    if (!s.lastOk) return ['warn', 'Todavía no hay ninguna copia verificada'];
    const age = (Date.now() - new Date(s.lastOk).getTime()) / 86_400_000;
    return [age > 3 ? 'warn' : 'ok', `Última copia verificada hace ${age < 1 ? 'menos de un día' : `${Math.floor(age)} día(s)`}${s.settings.auto ? ` · automática a las ${s.settings.time}` : ' · automática desactivada'}${s.settings.offsite ? ' · con copia externa' : ''}`];
  });
  add('security', 'Seguridad', () => {
    const n = j.monitor.unacknowledged();
    const crit = one<{ n: number }>("SELECT COUNT(*) AS n FROM security_alerts WHERE level = 'critical' AND acknowledged = 0").n;
    const lock = j.permissions.isLockdown();
    return [crit || lock ? 'error' : n ? 'warn' : 'ok', `${lock ? 'MODO EMERGENCIA ACTIVO · ' : ''}${n} alerta(s) sin revisar · ${j.devices.list().length} dispositivo(s) vinculado(s)`];
  });
  add('remote', 'Acceso remoto', () => {
    const r = j.remote?.status();
    if (!r) return ['ok', 'Solo este equipo'];
    if (r.mode === 'lan' && !r.listening) return ['error', r.error ?? 'No escucha'];
    return ['ok', r.mode === 'lan' ? `Red local en el puerto ${r.port}${r.publicUrl ? ` · ${r.publicUrl}` : ''}` : `Solo este equipo${r.publicUrl ? ` · ${r.publicUrl}` : ''}`];
  });
  add('runtime', 'Entorno', () => ['ok', `JARVIS ${j.version} · Node ${process.versions.node}${process.versions.electron ? ` · Electron ${process.versions.electron}` : ''} · ${process.platform} ${process.arch}`]);
  return { generatedAt: new Date().toISOString(), version: j.version, checks };
}

/** Limpieza: borra historiales operativos antiguos (nunca la auditoría) y optimiza la base de datos. */
export function cleanup(j: Jarvis, by: Principal, days = 90, vacuum = false): Record<string, number> {
  if (by.kind !== 'user' && by.kind !== 'core') throw new Error('Solo el usuario lanza el mantenimiento');
  const cut = new Date(Date.now() - days * 86_400_000).toISOString();
  const del = (sql: string) => j.db.prepare(sql).run(cut).changes;
  const r = {
    automationRuns: del('DELETE FROM automation_runs WHERE started_at < ?'),
    connectorLog: del('DELETE FROM connector_log WHERE ts < ?'),
    approvals: del("DELETE FROM approvals WHERE status <> 'pending' AND created_at < ?"),
    alerts: del('DELETE FROM security_alerts WHERE acknowledged = 1 AND ts < ?'),
  };
  j.db.exec('PRAGMA optimize');
  if (vacuum) j.db.exec('VACUUM');
  j.audit.append({ principal: by, action: 'maintenance.cleanup', outcome: 'success', details: { days, vacuum, ...r } });
  return r;
}

/** Comprueba si hay una versión nueva publicada en GitHub (Releases). Solo consulta: nunca instala nada sola. */
export async function checkUpdates(j: Jarvis, f: typeof fetch = (...a) => fetch(...a)): Promise<{ current: string; latest: string | null; newer: boolean; url: string | null; notes: string | null; detail: string }> {
  const repo = (j.db.prepare("SELECT value FROM settings WHERE key = 'updates.repo'").get() as { value: string } | undefined)?.value ?? 'pabloskycurro15/openshorts';
  const token = j.vault.get('connector.github.token');
  const res = await f(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'jarvis-assistant', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (res.status === 404) return { current: j.version, latest: null, newer: false, url: null, notes: null, detail: token ? 'Todavía no hay versiones publicadas' : 'Sin versiones publicadas o repositorio privado (activa el conector de GitHub para consultarlo)' };
  if (!res.ok) throw new Error(`GitHub respondió HTTP ${res.status}`);
  const r = (await res.json()) as { tag_name: string; html_url: string; body?: string };
  const latest = r.tag_name.replace(/^v/, '');
  const num = (v: string) => v.split(/[.-]/).slice(0, 3).map((x) => Number(x) || 0);
  const [a, b] = [num(latest), num(j.version)];
  const newer = a[0]! > b[0]! || (a[0] === b[0] && (a[1]! > b[1]! || (a[1] === b[1] && a[2]! > b[2]!)));
  return { current: j.version, latest, newer, url: r.html_url, notes: r.body?.slice(0, 2000) ?? null, detail: newer ? `Disponible la versión ${latest}` : 'Tienes la última versión' };
}
