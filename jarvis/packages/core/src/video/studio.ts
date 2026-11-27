import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { Database } from '../storage/db';
import { getSetting, setSetting } from '../storage/db';
import { defineTool, type ToolDefinition } from '../tools/registry';
import type { ControlConfig } from '../control/config';
import { PathDenied, resolveAuthorized, type ResolvedPath } from '../control/paths';
import type { Platform } from '../control/platform';

/** Programas que JARVIS sabe instalar (con winget en Windows) y usar. Lista cerrada: nada de instalar «cualquier cosa». */
export const PROGRAMS = {
  ffmpeg: { name: 'FFmpeg', winget: 'Gyan.FFmpeg', brew: 'ffmpeg', macApp: null, purpose: 'Crear y editar vídeos (recortar, unir, presentaciones, miniaturas)', exe: 'ffmpeg', url: 'https://ffmpeg.org/download.html' },
  vlc: { name: 'VLC', winget: 'VideoLAN.VLC', brew: '--cask vlc', macApp: 'VLC.app', purpose: 'Reproducir y revisar vídeos y audio', exe: 'vlc', url: 'https://www.videolan.org/vlc/' },
  obs: { name: 'OBS Studio', winget: 'OBSProject.OBSStudio', brew: '--cask obs', macApp: 'OBS.app', purpose: 'Grabar la pantalla o la cámara para tus vídeos', exe: 'obs64', url: 'https://obsproject.com/' },
  handbrake: { name: 'HandBrake', winget: 'HandBrake.HandBrake', brew: '--cask handbrake-app', macApp: 'HandBrake.app', purpose: 'Comprimir vídeos grandes antes de subirlos', exe: 'HandBrakeCLI', url: 'https://handbrake.fr/' },
} as const;

/** Homebrew en Mac (Apple Silicon: /opt/homebrew; Intel: /usr/local). Las apps abiertas desde el Finder no heredan su PATH. */
export const BREW_PATHS = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
export type ProgramId = keyof typeof PROGRAMS;

const FORMATS = { vertical: [1080, 1920], horizontal: [1920, 1080], square: [1080, 1080] } as const;
const VIDEO_TIMEOUT = 20 * 60_000;
const TIME = z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$|^\d+(\.\d+)?$/, 'Tiempo en segundos o mm:ss / hh:mm:ss');

/**
 * Estudio de vídeo con FFmpeg: lee de carpetas autorizadas y escribe archivos NUEVOS en
 * carpetas autorizadas con escritura (nunca sobrescribe). Sin shell: argumentos separados.
 * Si FFmpeg no está, lo dice y ofrece instalarlo (con tu confirmación).
 */
export class VideoStudio {
  private cached: { ffmpeg: string | null; ffprobe: string | null; at: number } | null = null;

  constructor(private db: Database, private getConfig: () => ControlConfig, private platform: Platform) {}

  /** Busca ffmpeg en la ruta configurada, en el PATH y donde lo deja winget. */
  async locate(force = false): Promise<{ ffmpeg: string | null; ffprobe: string | null }> {
    if (!force && this.cached && Date.now() - this.cached.at < 60_000) return this.cached;
    const candidates: string[] = [];
    const custom = getSetting(this.db, 'programs.ffmpeg');
    if (custom) candidates.push(custom);
    candidates.push('ffmpeg');
    if (this.platform.os === 'darwin') candidates.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg');
    if (this.platform.os === 'win32') {
      const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
      candidates.push(path.join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'));
      const pkgs = path.join(local, 'Microsoft', 'WinGet', 'Packages');
      try {
        for (const d of fs.readdirSync(pkgs).filter((x) => x.startsWith('Gyan.FFmpeg'))) {
          for (const sub of fs.readdirSync(path.join(pkgs, d))) candidates.push(path.join(pkgs, d, sub, 'bin', 'ffmpeg.exe'));
        }
      } catch { /* sin winget */ }
    }
    let found: string | null = null;
    for (const c of candidates) {
      const r = await this.platform.run(c, ['-version'], { timeoutMs: 8000, maxBytes: 4000 });
      if (r.exitCode === 0 && /ffmpeg version/i.test(r.stdout)) { found = c; break; }
    }
    const probe = found ? found.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace(/ffmpeg/i, 'ffprobe')) : null;
    this.cached = { ffmpeg: found, ffprobe: probe, at: Date.now() };
    return this.cached;
  }

  setFfmpegPath(p: string | null) {
    setSetting(this.db, 'programs.ffmpeg', p ?? '');
    this.cached = null;
  }

  private async ff(): Promise<{ ffmpeg: string; ffprobe: string }> {
    const l = await this.locate();
    if (!l.ffmpeg || !l.ffprobe) throw new Error('FFmpeg no está instalado. Pídeme «instala FFmpeg» (te pediré confirmación) o instálalo desde Archivos y proyectos → Programas.');
    return { ffmpeg: l.ffmpeg, ffprobe: l.ffprobe };
  }

  private resolve(p: string, folder?: string): ResolvedPath {
    return resolveAuthorized(this.getConfig().folders, p, folder);
  }

  /** Salida: dentro de una carpeta con escritura, extensión permitida y sin sobrescribir. */
  private output(p: string, ext: string[], folder?: string): ResolvedPath {
    const r = this.resolve(p, folder);
    if (r.folder.access !== 'readwrite') throw new PathDenied(`La carpeta «${r.folder.label}» es de solo lectura`);
    if (!ext.includes(path.extname(r.abs).toLowerCase())) throw new Error(`La salida debe ser ${ext.join(' o ')}`);
    if (fs.existsSync(r.abs)) throw new Error(`Ya existe ${r.rel}: elige otro nombre (nunca sobrescribo)`);
    return r;
  }

  private async exec(args: string[]): Promise<void> {
    const { ffmpeg } = await this.ff();
    const r = await this.platform.run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { timeoutMs: VIDEO_TIMEOUT, maxBytes: 20_000 });
    if (r.timedOut) throw new Error('FFmpeg tardó demasiado (más de 20 min)');
    if (r.exitCode !== 0) throw new Error(`FFmpeg falló: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ').slice(0, 400)}`);
  }

  async probe(abs: string): Promise<{ duration: number; width: number | null; height: number | null; videoCodec: string | null; audio: boolean; sizeBytes: number }> {
    const { ffprobe } = await this.ff();
    const r = await this.platform.run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', abs], { timeoutMs: 30_000, maxBytes: 200_000 });
    if (r.exitCode !== 0) throw new Error(`No es un archivo multimedia válido: ${r.stderr.slice(0, 200)}`);
    const j = JSON.parse(r.stdout) as { format: { duration?: string; size?: string }; streams: { codec_type: string; codec_name: string; width?: number; height?: number }[] };
    const v = j.streams.find((s) => s.codec_type === 'video');
    return { duration: Number(j.format.duration ?? 0), width: v?.width ?? null, height: v?.height ?? null, videoCodec: v?.codec_name ?? null, audio: j.streams.some((s) => s.codec_type === 'audio'), sizeBytes: Number(j.format.size ?? fs.statSync(abs).size) };
  }

  tools(): ToolDefinition[] {
    const scope = (action: string, r: ResolvedPath) => [`${action}:${r.abs}`];
    const grant = (action: string, r: ResolvedPath) => [`${action}:${r.folder.path}`, `${action}:${r.folder.path}${path.sep}*`];
    const fit = (w: number, h: number) => `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30`;
    const Format = z.enum(['vertical', 'horizontal', 'square']).default('vertical').describe('vertical 1080×1920 (Shorts/Reels/TikTok), horizontal 1920×1080, square 1080×1080');

    return [
      defineTool({
        name: 'video.probe', description: 'Información de un vídeo o audio de una carpeta autorizada (duración, resolución, códecs).',
        parameters: z.object({ path: z.string().min(1), folder: z.string().optional() }),
        permissions: (a) => scope('fs.read', this.resolve(a.path, a.folder)), grantScopes: (a) => grant('fs.read', this.resolve(a.path, a.folder)),
        risk: 'low', sideEffects: false, risks: [], returns: 'Duración (s), ancho, alto, códec, si tiene audio y tamaño.',
        execute: async (a) => this.probe(this.resolve(a.path, a.folder).abs),
      }),
      defineTool({
        name: 'video.trim', description: 'Recorta un vídeo entre dos tiempos y guarda un archivo nuevo (.mp4).',
        parameters: z.object({ path: z.string().min(1), start: TIME, end: TIME, output: z.string().min(1), folder: z.string().optional(), format: z.enum(['original', 'vertical', 'horizontal', 'square']).default('original') }),
        permissions: (a) => [...scope('fs.read', this.resolve(a.path, a.folder)), ...scope('fs.write', this.output(a.output, ['.mp4'], a.folder))],
        grantScopes: (a) => grant('fs.write', this.resolve(a.output, a.folder)),
        risk: 'medium', sideEffects: true, risks: ['Crea un archivo de vídeo nuevo'], returns: 'Ruta del vídeo creado y su duración.',
        execute: async (a) => {
          const input = this.resolve(a.path, a.folder).abs;
          const out = this.output(a.output, ['.mp4'], a.folder);
          const vf = a.format === 'original' ? [] : ['-vf', fit(FORMATS[a.format][0], FORMATS[a.format][1])];
          await this.exec(['-ss', a.start, '-to', a.end, '-i', input, ...vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out.abs]);
          return { output: out.rel, folder: out.folder.label, duration: (await this.probe(out.abs)).duration };
        },
      }),
      defineTool({
        name: 'video.concat', description: 'Une varios vídeos en uno (los adapta al formato elegido).',
        parameters: z.object({ paths: z.array(z.string().min(1)).min(2).max(30), output: z.string().min(1), folder: z.string().optional(), format: Format }),
        permissions: (a) => [...a.paths.flatMap((p) => scope('fs.read', this.resolve(p, a.folder))), ...scope('fs.write', this.output(a.output, ['.mp4'], a.folder))],
        grantScopes: (a) => grant('fs.write', this.resolve(a.output, a.folder)),
        risk: 'medium', sideEffects: true, risks: ['Crea un archivo de vídeo nuevo'], returns: 'Ruta del vídeo creado y su duración.',
        execute: async (a) => {
          const inputs = a.paths.map((p) => this.resolve(p, a.folder).abs);
          const out = this.output(a.output, ['.mp4'], a.folder);
          const info = await Promise.all(inputs.map((i) => this.probe(i)));
          const withAudio = info.every((i) => i.audio);
          const [w, h] = FORMATS[a.format];
          const chains = inputs.map((_, i) => `[${i}:v]${fit(w, h)}[v${i}]`).join(';');
          const pads = inputs.map((_, i) => `[v${i}]${withAudio ? `[${i}:a]` : ''}`).join('');
          const filter = `${chains};${pads}concat=n=${inputs.length}:v=1:a=${withAudio ? 1 : 0}[v]${withAudio ? '[a]' : ''}`;
          await this.exec([...inputs.flatMap((i) => ['-i', i]), '-filter_complex', filter, '-map', '[v]', ...(withAudio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '160k'] : ['-an']), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out.abs]);
          return { output: out.rel, folder: out.folder.label, duration: (await this.probe(out.abs)).duration, audio: withAudio };
        },
      }),
      defineTool({
        name: 'video.slideshow', description: 'Crea un vídeo a partir de imágenes (y una música opcional). Ideal para Shorts/Reels.',
        parameters: z.object({ images: z.array(z.string().min(1)).min(1).max(60), audio: z.string().optional(), secondsPerImage: z.number().min(0.5).max(30).default(3), output: z.string().min(1), folder: z.string().optional(), format: Format }),
        permissions: (a) => [...a.images.flatMap((p) => scope('fs.read', this.resolve(p, a.folder))), ...(a.audio ? scope('fs.read', this.resolve(a.audio, a.folder)) : []), ...scope('fs.write', this.output(a.output, ['.mp4'], a.folder))],
        grantScopes: (a) => grant('fs.write', this.resolve(a.output, a.folder)),
        risk: 'medium', sideEffects: true, risks: ['Crea un archivo de vídeo nuevo'], returns: 'Ruta del vídeo creado y su duración.',
        execute: async (a) => {
          const imgs = a.images.map((p) => this.resolve(p, a.folder).abs);
          const out = this.output(a.output, ['.mp4'], a.folder);
          const [w, h] = FORMATS[a.format];
          const total = imgs.length * a.secondsPerImage;
          const inputs = imgs.flatMap((i) => ['-loop', '1', '-t', String(a.secondsPerImage), '-i', i]);
          const chains = imgs.map((_, i) => `[${i}:v]${fit(w, h)},format=yuv420p[v${i}]`).join(';');
          const filter = `${chains};${imgs.map((_, i) => `[v${i}]`).join('')}concat=n=${imgs.length}:v=1:a=0[v]`;
          const audio = a.audio ? ['-i', this.resolve(a.audio, a.folder).abs] : [];
          await this.exec([...inputs, ...audio, '-filter_complex', filter, '-map', '[v]', ...(a.audio ? ['-map', `${imgs.length}:a`, '-c:a', 'aac', '-b:a', '160k', '-shortest'] : []), '-t', String(total), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out.abs]);
          return { output: out.rel, folder: out.folder.label, duration: (await this.probe(out.abs)).duration };
        },
      }),
      defineTool({
        name: 'video.thumbnail', description: 'Saca una imagen (miniatura) de un momento del vídeo.',
        parameters: z.object({ path: z.string().min(1), at: TIME.default('1'), output: z.string().min(1), folder: z.string().optional() }),
        permissions: (a) => [...scope('fs.read', this.resolve(a.path, a.folder)), ...scope('fs.write', this.output(a.output, ['.jpg', '.png'], a.folder))],
        grantScopes: (a) => grant('fs.write', this.resolve(a.output, a.folder)),
        risk: 'low', sideEffects: true, risks: ['Crea una imagen nueva'], returns: 'Ruta de la imagen.',
        execute: async (a) => {
          const out = this.output(a.output, ['.jpg', '.png'], a.folder);
          await this.exec(['-ss', a.at, '-i', this.resolve(a.path, a.folder).abs, '-frames:v', '1', '-q:v', '2', out.abs]);
          return { output: out.rel, folder: out.folder.label };
        },
      }),
    ];
  }
}

/** Programas instalables: estado y, en Windows, instalación con winget (siempre con confirmación). */
export function createProgramTools(studio: VideoStudio, platform: Platform): ToolDefinition[] {
  const status = async () => {
    const ff = await studio.locate(true);
    const out: { id: ProgramId; name: string; purpose: string; installed: boolean | null; detail: string }[] = [];
    for (const [id, p] of Object.entries(PROGRAMS) as [ProgramId, (typeof PROGRAMS)[ProgramId]][]) {
      if (id === 'ffmpeg') { out.push({ id, name: p.name, purpose: p.purpose, installed: !!ff.ffmpeg, detail: ff.ffmpeg ?? 'No encontrado' }); continue; }
      if (platform.os === 'darwin' && p.macApp) {
        const home = process.env.HOME ?? '';
        const found = [`/Applications/${p.macApp}`, `${home}/Applications/${p.macApp}`].find((x) => fs.existsSync(x));
        out.push({ id, name: p.name, purpose: p.purpose, installed: !!found, detail: found ?? '' });
        continue;
      }
      if (platform.os !== 'win32') { out.push({ id, name: p.name, purpose: p.purpose, installed: null, detail: 'Comprobación disponible en Windows' }); continue; }
      const r = await platform.run('winget', ['list', '--id', p.winget, '-e', '--accept-source-agreements', '--disable-interactivity'], { timeoutMs: 60_000, maxBytes: 20_000 });
      out.push({ id, name: p.name, purpose: p.purpose, installed: r.exitCode === 0 && r.stdout.includes(p.winget), detail: r.exitCode === null ? r.stderr : '' });
    }
    return out;
  };
  return [
    defineTool({
      name: 'programs.list', description: 'Programas que JARVIS puede usar o instalar (FFmpeg, VLC, OBS, HandBrake) y si están instalados.',
      parameters: z.object({}), permissions: ['programs.read'], risk: 'low', sideEffects: false, risks: [], returns: 'Lista con nombre, para qué sirve y si está instalado.',
      execute: status,
    }),
    defineTool({
      name: 'programs.install',
      description: 'Instala uno de los programas del catálogo (winget en Windows, Homebrew en Mac). Pide confirmación SIEMPRE.',
      parameters: z.object({ id: z.enum(Object.keys(PROGRAMS) as [ProgramId, ...ProgramId[]]) }),
      permissions: (a) => [`programs.install:${a.id}`], risk: 'critical', sideEffects: true,
      risks: ['Instala software en tu equipo desde el repositorio oficial (winget de Microsoft u Homebrew en Mac)', 'Puede pedir permisos de administrador'],
      returns: 'Resultado de la instalación.',
      async execute({ id }) {
        const p = PROGRAMS[id];
        if (platform.os === 'darwin') {
          let brew: string | null = null;
          for (const b of BREW_PATHS) {
            const v = await platform.run(b, ['--version'], { timeoutMs: 15_000, maxBytes: 2000 });
            if (v.exitCode === 0) { brew = b; break; }
          }
          if (!brew) throw new Error(`Para instalar programas en Mac hace falta Homebrew (gratis): abre Terminal y sigue las instrucciones de brew.sh. O descarga ${p.name} de ${p.url}`);
          const r = await platform.run(brew, ['install', ...p.brew.split(' ')], { timeoutMs: 20 * 60_000, maxBytes: 40_000 });
          if (r.exitCode !== 0) throw new Error(`Homebrew terminó con código ${r.exitCode}: ${(r.stdout + r.stderr).trim().split('\n').slice(-3).join(' ').slice(0, 300)}`);
          if (id === 'ffmpeg') await studio.locate(true);
          return { installed: true, program: p.name, note: id === 'ffmpeg' ? 'FFmpeg listo para crear vídeos' : 'Instalado' };
        }
        if (platform.os !== 'win32') throw new Error(`Instalación automática en Windows y Mac. Descárgalo de ${p.url}`);
        const r = await platform.run('winget', ['install', '--id', p.winget, '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], { timeoutMs: 15 * 60_000, maxBytes: 40_000 });
        if (r.exitCode === null && /no encontrado/i.test(r.stderr)) throw new Error('winget no está disponible en este Windows. Instala «Instalador de aplicación» desde Microsoft Store.');
        if (r.exitCode !== 0) throw new Error(`winget terminó con código ${r.exitCode}: ${(r.stdout + r.stderr).trim().split('\n').slice(-3).join(' ').slice(0, 300)}`);
        if (id === 'ffmpeg') await studio.locate(true);
        return { installed: true, program: p.name, note: id === 'ffmpeg' ? 'FFmpeg listo para crear vídeos' : 'Instalado' };
      },
    }),
  ];
}
