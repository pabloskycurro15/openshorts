import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Principal } from '@jarvis/shared';
import { createJarvis, type Jarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { googleConnector } from '../src/connectors/google';
import type { Platform } from '../src/control/platform';
import { nodePlatform } from '../src/control/platform';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };
const AGENT: Principal = { kind: 'agent', id: 'jarvis' };
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

const running: Jarvis[] = [];
afterEach(async () => { for (const j of running.splice(0)) await j.stop().catch(() => undefined); });

async function setup(opts: { platform?: Platform; fetch?: typeof fetch; google?: boolean } = {}) {
  const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', embedder: null, connectors: opts.google ? [googleConnector()] : [], platform: opts.platform, fetch: opts.fetch });
  await j.start();
  running.push(j);
  const media = tmpDir();
  const out = tmpDir();
  j.control.set(USER, { folders: [{ id: 'media', label: 'Medios', path: media, access: 'read' }, { id: 'videos', label: 'Vídeos', path: out, access: 'readwrite' }], apps: [], commands: [] });
  return { j, media, out };
}

describe.skipIf(!hasFfmpeg)('Estudio de vídeo (FFmpeg real)', () => {
  it('presentación vertical con música, recorte, unión y miniatura; nunca sobrescribe ni escribe en solo lectura', async () => {
    const { j, media, out } = await setup();
    for (const [i, c] of ['orange', 'navy', 'white'].entries()) execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=640x480`, '-frames:v', '1', path.join(media, `img${i}.png`)]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', path.join(media, 'musica.m4a')]);

    expect(await j.tools.invoke(USER, 'video.slideshow', { images: ['img0.png'], output: path.join(media, 'x.mp4') })).toMatchObject({ status: 'error', error: expect.stringContaining('solo lectura') });
    const s = await j.tools.invoke(USER, 'video.slideshow', { images: [0, 1, 2].map((i) => path.join(media, `img${i}.png`)), audio: path.join(media, 'musica.m4a'), secondsPerImage: 2, output: path.join(out, 'presentacion.mp4') });
    expect(s).toMatchObject({ status: 'ok', output: { output: 'presentacion.mp4' } });
    const p = await j.tools.invoke(USER, 'video.probe', { path: path.join(out, 'presentacion.mp4') });
    expect(p).toMatchObject({ status: 'ok', output: { width: 1080, height: 1920, videoCodec: 'h264', audio: true } });
    expect((p as { output: { duration: number } }).output.duration).toBeGreaterThan(5.5);

    expect(await j.tools.invoke(USER, 'video.slideshow', { images: [path.join(media, 'img0.png')], output: path.join(out, 'presentacion.mp4') })).toMatchObject({ status: 'error', error: expect.stringContaining('nunca sobrescribo') });

    expect(await j.tools.invoke(USER, 'video.trim', { path: path.join(out, 'presentacion.mp4'), start: '1', end: '3', output: path.join(out, 'recorte.mp4') })).toMatchObject({ status: 'ok' });
    const c = await j.tools.invoke(USER, 'video.concat', { paths: [path.join(out, 'recorte.mp4'), path.join(out, 'recorte.mp4')], output: path.join(out, 'union.mp4'), format: 'horizontal' });
    expect(c).toMatchObject({ status: 'ok', output: { audio: true } });
    expect(await j.tools.invoke(USER, 'video.probe', { path: path.join(out, 'union.mp4') })).toMatchObject({ output: { width: 1920, height: 1080 } });
    expect(await j.tools.invoke(USER, 'video.thumbnail', { path: path.join(out, 'union.mp4'), at: '1', output: path.join(out, 'mini.jpg') })).toMatchObject({ status: 'ok' });
    expect(fs.statSync(path.join(out, 'mini.jpg')).size).toBeGreaterThan(1000);

    // Un agente necesita permiso (escribir en la carpeta) y «aprobar siempre» concede la carpeta entera.
    const r = await j.tools.invoke(AGENT, 'video.thumbnail', { path: path.join(out, 'union.mp4'), output: path.join(out, 'mini2.jpg') }, { interactive: true });
    expect(r.status).toBe('pending_approval');
    await j.tools.resolveApproval(USER, (r as { approvalId: string }).approvalId, 'approved_always');
    expect(j.permissions.listGrants(AGENT).map((g) => g.scope)).toEqual(expect.arrayContaining([`fs.write:${out}`]));
  }, 60_000);
});

describe('Programas instalables', () => {
  it('sin FFmpeg lo dice claramente; instalar con winget es crítico y solo del catálogo', async () => {
    const calls: string[][] = [];
    const fake: Platform = {
      os: 'win32',
      launch: nodePlatform.launch,
      async run(cmd, args) {
        calls.push([cmd, ...args]);
        if (cmd === 'winget' && args[0] === 'install') return { exitCode: 0, stdout: 'Instalado correctamente', stderr: '', timedOut: false };
        if (cmd === 'winget') return { exitCode: 1, stdout: 'No se encontró', stderr: '', timedOut: false };
        return { exitCode: null, stdout: '', stderr: `Programa no encontrado: ${cmd}`, timedOut: false };
      },
    };
    const { j, out } = await setup({ platform: fake });
    expect(await j.tools.invoke(USER, 'video.thumbnail', { path: path.join(out, 'a.mp4'), output: path.join(out, 'b.jpg') })).toMatchObject({ status: 'error', error: expect.stringContaining('FFmpeg no está instalado') });
    const list = await j.tools.invoke(USER, 'programs.list', {});
    expect(list).toMatchObject({ status: 'ok', output: expect.arrayContaining([expect.objectContaining({ id: 'ffmpeg', installed: false })]) });
    expect((await j.tools.invoke(USER, 'programs.install', { id: 'cualquiercosa' })).status).toBe('error');
    const r = await j.tools.invoke(AGENT, 'programs.install', { id: 'ffmpeg' }, { interactive: true });
    expect(r.status).toBe('pending_approval');
    expect(await j.tools.resolveApproval(USER, (r as { approvalId: string }).approvalId, 'approved')).toMatchObject({ status: 'ok' });
    expect(calls.find((c) => c[1] === 'install')).toEqual(['winget', 'install', '--id', 'Gyan.FFmpeg', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity']);
  });
});

describe('YouTube (API simulada)', () => {
  it('subida reanudable: privado por defecto, #Shorts, solo desde carpetas autorizadas y con confirmación', async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
    const f = (async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
      let body = '';
      if (typeof init.body === 'string') body = init.body;
      else if (init.body && typeof (init.body as ReadableStream).getReader === 'function') {
        const chunks: Uint8Array[] = [];
        for await (const c of init.body as unknown as AsyncIterable<Uint8Array>) chunks.push(c);
        body = `<${Buffer.concat(chunks).length} bytes>`;
      }
      calls.push({ url, method: init.method ?? 'GET', headers, body });
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'at1', expires_in: 3600, refresh_token: 'rt', scope: 'https://www.googleapis.com/auth/youtube.upload' });
      if (url.endsWith('/v1/userinfo')) return Response.json({ email: 'yo@gmail.com' });
      if (url.includes('/upload/youtube/v3/videos?uploadType=resumable')) return new Response(null, { status: 200, headers: { location: 'https://upload.test/sesion-1' } });
      if (url === 'https://upload.test/sesion-1') return Response.json({ id: 'abcDEF12345', status: { privacyStatus: 'private', uploadStatus: 'uploaded' } });
      if (url.includes('/youtube/v3/channels')) return Response.json({ items: [{ id: 'UC1', snippet: { title: 'Mi canal', customUrl: '@mi' }, statistics: { subscriberCount: '12', videoCount: '3', viewCount: '400' } }] });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const { j, out } = await setup({ fetch: f, google: true });
    fs.writeFileSync(path.join(out, 'clip.mp4'), Buffer.alloc(5000, 1));
    j.connectors.configure(USER, 'google', { clientId: 'cid', clientSecret: 'GOCSPX-x' });
    const { url } = (await j.connectors.action(USER, 'google', 'authorize', {})) as { url: string };
    expect(new URL(url).searchParams.get('scope')).toContain('youtube.upload');
    // Simular el canje (sin PKCE real: el servidor simulado no lo comprueba).
    await j.connectors.oauthCallback('google', { code: 'c', state: new URL(url).searchParams.get('state')! });
    await j.connectors.enable(USER, 'google');
    expect(await j.tools.invoke(USER, 'youtube.channel', {})).toMatchObject({ status: 'ok', output: { title: 'Mi canal', subscribers: 12 } });

    expect(await j.tools.invoke(USER, 'youtube.upload', { path: '/etc/hosts', title: 'x' })).toMatchObject({ status: 'error' });
    const r = await j.tools.invoke(AGENT, 'youtube.upload', { path: path.join(out, 'clip.mp4'), title: 'Bares de Nerja', shorts: true }, { interactive: true });
    expect(r.status).toBe('pending_approval');
    const done = await j.tools.resolveApproval(USER, (r as { approvalId: string }).approvalId, 'approved_always');
    expect(done).toMatchObject({ status: 'ok', output: { id: 'abcDEF12345', url: 'https://youtu.be/abcDEF12345', privacy: 'private' } });
    const init = calls.find((c) => c.url.includes('uploadType=resumable'))!;
    expect(JSON.parse(init.body)).toMatchObject({ snippet: { title: 'Bares de Nerja #Shorts' }, status: { privacyStatus: 'private', selfDeclaredMadeForKids: false } });
    expect(init.headers['x-upload-content-length']).toBe('5000');
    expect(calls.find((c) => c.url === 'https://upload.test/sesion-1')!.body).toBe('<5000 bytes>');
    // Crítico: vuelve a preguntar aunque se aprobara «siempre».
    expect((await j.tools.invoke(AGENT, 'youtube.upload', { path: path.join(out, 'clip.mp4'), title: 'Otro' }, { interactive: true })).status).toBe('pending_approval');
  });
});
