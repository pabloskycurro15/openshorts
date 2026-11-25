import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ConnectorCtx, ConnectorDef } from './framework';

export const ADOBE_PRESETS = {
  thumbnail: { label: 'Miniatura de YouTube', width: 1280, height: 720 },
  short: { label: 'Short / Reel / TikTok', width: 1080, height: 1920 },
  square: { label: 'Post cuadrado', width: 1080, height: 1080 },
  story: { label: 'Historia de Instagram', width: 1080, height: 1920 },
  banner: { label: 'Banner de YouTube', width: 2560, height: 1440 },
} as const;
export type AdobePreset = keyof typeof ADOBE_PRESETS;

const MIME_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'application/pdf': '.pdf', 'video/mp4': '.mp4' };

/**
 * Adobe Express (Embed SDK oficial): el editor de Adobe se abre en una página aparte, servida
 * en http://localhost (origen distinto al de JARVIS en 127.0.0.1, así el código de Adobe no ve
 * tu token). Esa página solo recibe un «ticket» de 30 min que permite GUARDAR exportaciones en
 * la carpeta que elijas, nada más. Necesita un Client ID gratuito de Adobe Developer Console.
 */
export class AdobeBridge {
  private tickets = new Map<string, { folderAbs: string; exp: number }>();
  private ctx: ConnectorCtx | null = null;

  def(): ConnectorDef {
    return {
      id: 'adobe',
      name: 'Adobe Express',
      description: 'Diseña miniaturas, portadas y posts con el editor de Adobe Express y guárdalos en tus carpetas para que JARVIS los use (p. ej. como miniatura de YouTube).',
      official: true,
      warning: 'Usa tu cuenta de Adobe (el plan gratuito sirve). Necesitas un Client ID gratuito de Adobe Developer Console con «Adobe Express Embed SDK» y el dominio «localhost» permitido. Funciona en este PC (no desde el móvil). El editor es de Adobe: lo que diseñes pasa por sus servidores.',
      docsUrl: 'https://developer.adobe.com/express/embed-sdk/docs/guides/quickstart/',
      fields: [
        { key: 'clientId', label: 'Client ID (API Key) de Adobe', secret: false, required: true, placeholder: '32 caracteres', help: 'developer.adobe.com/console → Crear proyecto → Añadir API → Adobe Express Embed SDK → dominios: localhost.' },
        { key: 'folder', label: 'Carpeta donde guardar los diseños', secret: false, required: true, placeholder: 'Ruta o nombre de una carpeta autorizada con escritura' },
      ],
      test: async (ctx) => {
        this.ctx = ctx;
        const id = ctx.get('clientId') ?? '';
        if (!/^[A-Za-z0-9]{20,64}$/.test(id)) return { ok: false, detail: 'El Client ID no tiene el formato esperado' };
        ctx.resolveWritable(ctx.get('folder') ?? '');
        return { ok: true, detail: 'Listo: pulsa «Abrir Adobe Express»' };
      },
      start: async (ctx) => { this.ctx = ctx; },
      status: (ctx) => { this.ctx = ctx; return { presets: Object.entries(ADOBE_PRESETS).map(([id, p]) => ({ id, label: p.label })) }; },
      actions: {
        /** Abre el editor: devuelve la URL (en localhost) con un ticket de un solo destino. */
        open: async (ctx, body) => {
          this.ctx = ctx;
          const preset = z.enum(Object.keys(ADOBE_PRESETS) as [AdobePreset, ...AdobePreset[]]).default('thumbnail').parse(body.preset);
          const folderAbs = ctx.resolveWritable(ctx.get('folder') ?? '');
          const t = randomBytes(24).toString('base64url');
          const now = Date.now();
          for (const [k, v] of this.tickets) if (v.exp < now) this.tickets.delete(k);
          this.tickets.set(t, { folderAbs, exp: now + 30 * 60_000 });
          const local = ctx.baseUrl().replace('://127.0.0.1', '://localhost');
          const p = ADOBE_PRESETS[preset];
          return { url: `${local}/adobe-express#t=${t}&c=${encodeURIComponent(ctx.get('clientId') ?? '')}&w=${p.width}&h=${p.height}&n=${encodeURIComponent(p.label)}` };
        },
      },
      // Sin herramientas para la IA: el editor es interactivo y lo usa la persona.
      tools: () => [],
    };
  }

  /** Guarda una exportación del editor (data URL) en la carpeta del ticket. */
  saveExport(ticket: string, dataUrl: string, name?: string): { file: string; bytes: number } {
    const t = this.tickets.get(ticket);
    if (!t || t.exp < Date.now()) throw new Error('Ticket caducado: vuelve a abrir el editor desde JARVIS');
    const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw new Error('Formato de exportación no reconocido');
    const ext = MIME_EXT[m[1]!];
    if (!ext) throw new Error(`Tipo no admitido: ${m[1]}`);
    const data = Buffer.from(m[2]!, 'base64');
    const safe = (name ?? 'diseno').normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'diseno';
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const file = path.join(t.folderAbs, `adobe-${safe}-${stamp}${ext}`);
    fs.writeFileSync(file, data, { flag: 'wx' });
    this.ctx?.log('exportar', 'ok', `${path.basename(file)} (${data.length} bytes)`);
    return { file: path.basename(file), bytes: data.length };
  }
}

/** Página del editor (se sirve con su propia CSP, que solo permite Adobe). */
export const ADOBE_PAGE = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JARVIS · Adobe Express</title>
<style>html,body{margin:0;height:100%;background:#050a14;color:#e8eefc;font-family:system-ui}#bar{padding:10px 16px;border-bottom:1px solid #1d2b4a;display:flex;gap:12px;align-items:center}#bar b{color:#ff8a1f;letter-spacing:.3em}#msg{font-size:13px;color:#9fb0d0}</style>
<script src="https://cc-embed.adobe.com/sdk/v4/CCEverywhere.js"></script></head>
<body><div id="bar"><b>JARVIS</b><span id="msg">Cargando Adobe Express…</span></div>
<script type="module">
const p = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, '', location.pathname);
const msg = (t) => { document.getElementById('msg').textContent = t; };
const save = async (asset, name) => {
  const r = await fetch('/adobe-express/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: p.get('t'), data: asset.data, name }) });
  const j = await r.json();
  msg(r.ok ? 'Guardado en JARVIS: ' + j.file + '. Puedes seguir diseñando o cerrar esta pestaña.' : 'No se pudo guardar: ' + j.error);
};
try {
  const { editor } = await window.CCEverywhere.initialize({ clientId: p.get('c'), appName: 'JARVIS' }, { loginMode: 'delayed' });
  msg('Diseña y pulsa «Guardar en JARVIS» para traer el resultado (' + p.get('n') + ').');
  editor.create(
    { canvasSize: { width: Number(p.get('w')), height: Number(p.get('h')), unit: 'px' } },
    { callbacks: { onPublish: (_intent, params) => { for (const a of params.asset || []) save(a, p.get('n')); }, onError: (e) => msg('Adobe Express: ' + (e && e.message || e)) } },
    [{ id: 'jarvis-save', label: 'Guardar en JARVIS', action: { target: 'publish' }, style: { uiType: 'button' } }, { id: 'download', label: 'Descargar', action: { target: 'download' }, style: { uiType: 'button' } }],
  );
} catch (e) { msg('No se pudo abrir Adobe Express: ' + (e && e.message || e) + '. Revisa el Client ID y que «localhost» esté permitido en Adobe Developer Console.'); }
</script></body></html>`;

export const ADOBE_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline' https://cc-embed.adobe.com https://*.adobe.com https://*.adobe.io https://*.adobelogin.com; frame-src https://*.adobe.com https://*.adobe.io https://*.adobelogin.com https://*.adobeprojectm.com; connect-src 'self' https://*.adobe.com https://*.adobe.io https://*.adobelogin.com https://*.adobeprojectm.com; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https:; font-src https: data:; media-src blob: https:; worker-src blob:";
