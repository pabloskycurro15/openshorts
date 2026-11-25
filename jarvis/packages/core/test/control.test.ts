import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Principal } from '@jarvis/shared';
import { createJarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import type { Platform } from '../src/control/platform';
import { nodePlatform } from '../src/control/platform';
import { parsePs, parseWindows, parseWindowsProcesses, sampleCpuUsage, windowScript } from '../src/control/os-tools';
import { resolveAuthorized } from '../src/control/paths';
import { JARVIS_PRINCIPAL } from '../src/ai/engine';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };

class FakePlatform implements Platform {
  os: NodeJS.Platform;
  launched: { command: string; args: string[] }[] = [];
  ran: { command: string; args: string[] }[] = [];
  killed: string[] = [];
  constructor(os: NodeJS.Platform = 'linux', private output = '') { this.os = os; }
  launch(command: string, args: string[]) {
    this.launched.push({ command, args });
    let dead = false;
    return { pid: 4242, exited: () => dead, kill: () => { dead = true; this.killed.push(command); } };
  }
  async run(command: string, args: string[]) {
    this.ran.push({ command, args });
    return { exitCode: 0, stdout: this.output, stderr: '', timedOut: false };
  }
}

async function setup(platform: Platform = new FakePlatform()) {
  const dataDir = tmpDir();
  const j = createJarvis(loadConfig({}, { dataDir, logLevel: 'silent' }), { dbFile: ':memory:', platform });
  await j.start();
  const docs = fs.realpathSync(fs.mkdtempSync(path.join(tmpDir(), 'docs-')));
  const ro = fs.realpathSync(fs.mkdtempSync(path.join(tmpDir(), 'ro-')));
  fs.writeFileSync(path.join(docs, 'nota.txt'), 'hola mundo');
  fs.writeFileSync(path.join(ro, 'leer.txt'), 'solo lectura');
  const secret = fs.mkdtempSync(path.join(tmpDir(), 'fuera-'));
  fs.writeFileSync(path.join(secret, 'secreto.txt'), 'NO');
  j.control.set(USER, {
    folders: [{ id: 'docs', label: 'Documentos', path: docs, access: 'readwrite' }, { id: 'ro', label: 'Lectura', path: ro, access: 'read' }],
    apps: [{ id: 'editor', name: 'Editor', command: 'notepad.exe', args: [], processName: 'notepad.exe' }],
    commands: [{ id: 'saluda', name: 'Saludar', command: process.execPath, args: ['-e', 'console.log("hola desde comando")'], timeoutSec: 20 }],
  });
  const invoke = (tool: string, args: unknown, who: Principal = USER) => j.tools.invoke(who, tool, args);
  return { j, docs, ro, secret, invoke, dataDir };
}

describe('Configuración del control', () => {
  it('solo el usuario la modifica; valida rutas y prohíbe raíces de disco', async () => {
    const { j, docs } = await setup();
    expect(() => j.control.set(JARVIS_PRINCIPAL, { folders: [] })).toThrow(/Solo el usuario/);
    expect(() => j.control.set(USER, { folders: [{ id: 'x', label: 'X', path: 'relativa', access: 'read' }] })).toThrow(/absoluta/);
    expect(() => j.control.set(USER, { folders: [{ id: 'x', label: 'X', path: '/no/existe/jamas', access: 'read' }] })).toThrow(/no existe/);
    expect(() => j.control.set(USER, { folders: [{ id: 'x', label: 'X', path: path.parse(docs).root, access: 'read' }] })).toThrow(/raíz/);
    expect(() => j.control.set(USER, { folders: [{ id: 'a', label: 'A', path: docs, access: 'read' }, { id: 'a', label: 'B', path: docs, access: 'read' }] })).toThrow(/repetido/);
    expect(j.audit.list().some((e) => e.action === 'control.config')).toBe(true);
  });
});

describe('Rutas autorizadas', () => {
  it('bloquea «..», rutas absolutas externas y enlaces simbólicos que escapan', async () => {
    const { j, docs, secret } = await setup();
    const folders = j.control.get().folders;
    expect(resolveAuthorized(folders, 'nota.txt').abs).toBe(path.join(docs, 'nota.txt'));
    expect(() => resolveAuthorized(folders, '../../etc/passwd')).toThrow(/fuera/);
    expect(() => resolveAuthorized(folders, path.join(secret, 'secreto.txt'))).toThrow(/fuera/);
    fs.symlinkSync(secret, path.join(docs, 'atajo'));
    expect(() => resolveAuthorized(folders, 'atajo/secreto.txt')).toThrow(/enlace/);
    expect(resolveAuthorized(folders, 'nueva/sub/archivo.txt').rel).toBe(path.join('nueva', 'sub', 'archivo.txt'));
  });
});

describe('Herramientas de archivos', () => {
  it('listar, leer, crear, sobrescribir (con copia), mover y borrar a la papelera', async () => {
    const { invoke, docs } = await setup();
    const list = await invoke('fs.list', { path: '.', folder: 'docs' });
    expect(list.status).toBe('ok');
    expect(JSON.stringify(list)).toContain('nota.txt');
    expect(await invoke('fs.read_text', { path: 'nota.txt' })).toMatchObject({ status: 'ok', output: { content: 'hola mundo' } });

    expect((await invoke('fs.create_file', { path: 'proyectos/plan.md', content: '# Plan' })).status).toBe('ok');
    expect(fs.readFileSync(path.join(docs, 'proyectos/plan.md'), 'utf8')).toBe('# Plan');
    expect((await invoke('fs.create_file', { path: 'proyectos/plan.md', content: 'x' })).status).toBe('error'); // no sobrescribe

    // Riesgo alto: el usuario debe confirmar.
    const ow = await invoke('fs.overwrite_file', { path: 'nota.txt', content: 'nuevo' });
    expect(ow.status).toBe('pending_approval');
  });

  it('una vez aprobado, sobrescribir guarda copia y borrar mueve a la papelera', async () => {
    const { j, invoke, docs, dataDir } = await setup();
    const ow = await invoke('fs.overwrite_file', { path: 'nota.txt', content: 'nuevo' });
    if (ow.status !== 'pending_approval') throw new Error('esperaba confirmación');
    const r = await j.tools.resolveApproval(USER, ow.approvalId, 'approved');
    expect(r.status).toBe('ok');
    expect(fs.readFileSync(path.join(docs, 'nota.txt'), 'utf8')).toBe('nuevo');
    const backup = (r as { output: { backup: string } }).output.backup;
    expect(fs.readFileSync(backup, 'utf8')).toBe('hola mundo');
    expect(backup.startsWith(path.join(dataDir, 'papelera'))).toBe(true);

    const del = await invoke('fs.delete', { path: 'nota.txt' });
    if (del.status !== 'pending_approval') throw new Error('esperaba confirmación');
    const d = await j.tools.resolveApproval(USER, del.approvalId, 'approved');
    expect(fs.existsSync(path.join(docs, 'nota.txt'))).toBe(false);
    expect(fs.existsSync((d as { output: { trash: string } }).output.trash)).toBe(true);
  });

  it('respeta las carpetas de solo lectura y rechaza rutas no autorizadas sin preguntar', async () => {
    const { invoke, secret } = await setup();
    expect(await invoke('fs.read_text', { path: 'leer.txt', folder: 'ro' })).toMatchObject({ status: 'ok' });
    expect(await invoke('fs.create_file', { path: 'x.txt', folder: 'ro', content: 'x' })).toMatchObject({ status: 'error' });
    const out = await invoke('fs.read_text', { path: path.join(secret, 'secreto.txt') }, JARVIS_PRINCIPAL);
    expect(out.status).toBe('error'); // ni siquiera se pide confirmación
  });

  it('«Aprobar siempre» concede la carpeta entera, no solo el archivo', async () => {
    const { j, invoke } = await setup();
    const r = await j.tools.invoke(JARVIS_PRINCIPAL, 'fs.read_text', { path: 'nota.txt' }, { interactive: true });
    if (r.status !== 'pending_approval') throw new Error('esperaba confirmación');
    await j.tools.resolveApproval(USER, r.approvalId, 'approved_always');
    expect((await j.tools.invoke(JARVIS_PRINCIPAL, 'fs.list', { path: '.', folder: 'docs' }, { interactive: true })).status).toBe('ok');
    // Escritura sigue requiriendo permiso.
    expect((await j.tools.invoke(JARVIS_PRINCIPAL, 'fs.create_file', { path: 'a.txt', content: '' }, { interactive: true })).status).toBe('pending_approval');
    void invoke;
  });

  it('no lee binarios ni archivos enormes', async () => {
    const { invoke, docs } = await setup();
    fs.writeFileSync(path.join(docs, 'bin.dat'), Buffer.from([1, 0, 2, 3]));
    fs.writeFileSync(path.join(docs, 'grande.txt'), 'x'.repeat(300 * 1024));
    expect(await invoke('fs.read_text', { path: 'bin.dat' })).toMatchObject({ status: 'error', error: expect.stringMatching(/binario/) });
    expect(await invoke('fs.read_text', { path: 'grande.txt' })).toMatchObject({ status: 'error', error: expect.stringMatching(/grande/) });
  });
});

describe('Aplicaciones, navegador y comandos', () => {
  it('solo abre aplicaciones autorizadas, sin shell, y cierra las que abrió', async () => {
    const p = new FakePlatform('win32');
    const { invoke, j } = await setup(p);
    expect(await invoke('app.open', { appId: 'calc' })).toMatchObject({ status: 'error' });
    expect(await invoke('app.open', { appId: 'editor' })).toMatchObject({ status: 'ok', output: { opened: 'Editor' } });
    expect(p.launched).toEqual([{ command: 'notepad.exe', args: [] }]);
    const close = await invoke('app.close', { appId: 'editor' });
    if (close.status !== 'pending_approval') throw new Error('cerrar debe pedir confirmación');
    await j.tools.resolveApproval(USER, close.approvalId, 'approved');
    expect(p.killed).toEqual(['notepad.exe']);
  });

  it('abre solo URLs http(s) con el abridor del sistema', async () => {
    const p = new FakePlatform('win32');
    const { invoke } = await setup(p);
    expect(await invoke('browser.open_url', { url: 'javascript:alert(1)' })).toMatchObject({ status: 'error' });
    expect(await invoke('browser.open_url', { url: 'file:///C:/Windows/system32' })).toMatchObject({ status: 'error' });
    expect(await invoke('browser.open_url', { url: 'https://www.ejemplo.es/a b' })).toMatchObject({ status: 'ok' });
    expect(p.launched.at(-1)).toEqual({ command: 'rundll32', args: ['url.dll,FileProtocolHandler', 'https://www.ejemplo.es/a%20b'] });
  });

  it('command.run: solo comandos de la lista blanca, ejecutados de verdad, siempre con confirmación', async () => {
    const { invoke, j } = await setup(nodePlatform);
    expect(await invoke('command.run', { commandId: 'rm-rf' })).toMatchObject({ status: 'error' });
    const r = await invoke('command.run', { commandId: 'saluda' });
    if (r.status !== 'pending_approval') throw new Error('debe pedir confirmación');
    const out = await j.tools.resolveApproval(USER, r.approvalId, 'approved');
    expect(out).toMatchObject({ status: 'ok', output: { exitCode: 0, timedOut: false } });
    expect((out as { output: { stdout: string } }).output.stdout.trim()).toBe('hola desde comando');
  });

  it('nodePlatform.run respeta el tiempo máximo', async () => {
    const r = await nodePlatform.run(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], { timeoutMs: 300, maxBytes: 100 });
    expect(r.timedOut).toBe(true);
    const missing = await nodePlatform.run('programa-que-no-existe-jarvis', [], { timeoutMs: 1000, maxBytes: 100 });
    expect(missing.stderr).toMatch(/no encontrado/);
  });
});

describe('Procesos, ventanas y CPU', () => {
  it('lista procesos reales en este sistema', async () => {
    const { invoke } = await setup(nodePlatform);
    const r = await invoke('system.processes', { limit: 5 });
    expect(r.status).toBe('ok');
    const list = (r as { output: { pid: number; name: string }[] }).output;
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.pid).toBeGreaterThan(0);
  });

  it('analiza la salida de PowerShell y de ps', () => {
    expect(parseWindowsProcesses('{"Id":4,"ProcessName":"System","CPU":12.345,"WorkingSet64":1024}')).toEqual([{ pid: 4, name: 'System', cpu: 12.3, memoryBytes: 1024 }]);
    expect(parseWindowsProcesses('[{"Id":1,"ProcessName":"a","CPU":null,"WorkingSet64":5}]')[0]!.cpu).toBeNull();
    expect(parsePs('  123 /usr/bin/node 12.5 2048\n 7 bash 0.0 100\n')).toEqual([
      { pid: 123, name: 'node', cpu: 12.5, memoryBytes: 2048 * 1024 }, { pid: 7, name: 'bash', cpu: 0, memoryBytes: 102400 },
    ]);
    expect(parseWindows('131234\t888\tSin título - Bloc de notas\r\n99\t1\tExplorador\r\nbasura')).toEqual([
      { handle: '131234', pid: 888, title: 'Sin título - Bloc de notas' }, { handle: '99', pid: 1, title: 'Explorador' },
    ]);
  });

  it('los scripts de ventanas no admiten identificadores manipulados', () => {
    expect(() => windowScript('focus', '1; Remove-Item C:\\')).toThrow();
    expect(windowScript('minimize', '12345')).toContain('ShowWindow([IntPtr]12345, 6)');
  });

  it('el control de ventanas informa de que solo funciona en Windows', async () => {
    const { invoke } = await setup(new FakePlatform('linux'));
    expect(await invoke('window.list', {})).toMatchObject({ status: 'error', error: expect.stringMatching(/solo está disponible en Windows/) });
  });

  it('mide el uso real de CPU', async () => {
    const u = await sampleCpuUsage(100);
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThanOrEqual(100);
  });
});
