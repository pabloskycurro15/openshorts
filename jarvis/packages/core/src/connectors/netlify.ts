import fs from 'node:fs';
import { z } from 'zod';
import { defineTool } from '../tools/registry';
import type { ConnectorCtx, ConnectorDef } from './framework';
import { jsonFetch } from './http';
import { zipDirectory } from './zip';

/** Netlify: publicar webs estáticas desde una carpeta autorizada (plan gratuito). */
export function netlifyConnector(opts: { baseUrl?: string } = {}): ConnectorDef {
  const base = opts.baseUrl ?? 'https://api.netlify.com/api/v1';
  const nf = <T>(ctx: ConnectorCtx, p: string, init: RequestInit & { timeoutMs?: number } = {}) =>
    jsonFetch<T>(ctx.fetch, `${base}${p}`, { ...init, headers: { authorization: `Bearer ${ctx.get('token')}`, ...(init.headers as Record<string, string> | undefined) } });

  return {
    id: 'netlify',
    name: 'Netlify',
    description: 'Publica webs estáticas desde tus carpetas autorizadas y consulta tus sitios.',
    official: true,
    warning: 'Publicar hace la web accesible para cualquiera en Internet. El plan gratuito de Netlify tiene límites de ancho de banda y minutos de compilación.',
    docsUrl: 'https://app.netlify.com/user/applications#personal-access-tokens',
    fields: [{ key: 'token', label: 'Token de acceso personal', secret: true, required: true, placeholder: 'nfp_…', help: 'Netlify → User settings → Applications → Personal access tokens.' }],
    async test(ctx) {
      const u = await nf<{ email?: string; full_name?: string }>(ctx, '/user');
      return { ok: true, detail: `Conectado como ${u.full_name ?? u.email ?? 'usuario'}` };
    },
    tools: (ctx) => [
      defineTool({
        name: 'netlify.sites', description: 'Lista tus sitios de Netlify.',
        parameters: z.object({}),
        permissions: ['connector.netlify.read'], risk: 'low', sideEffects: false, risks: [], returns: 'Id, nombre, URL y última actualización.',
        async execute() {
          const r = await nf<{ id: string; name: string; ssl_url?: string; url: string; updated_at: string }[]>(ctx, '/sites?per_page=50');
          return r.map((s) => ({ id: s.id, name: s.name, url: s.ssl_url ?? s.url, updatedAt: s.updated_at }));
        },
      }),
      defineTool({
        name: 'netlify.deploy',
        description: 'Publica en Netlify una carpeta autorizada con una web estática (index.html). Sin siteId crea un sitio nuevo. Siempre pide confirmación.',
        parameters: z.object({
          path: z.string().min(1).describe('Carpeta (dentro de las autorizadas) con la web'),
          siteId: z.string().max(100).optional().describe('Sitio existente; si se omite se crea uno'),
          name: z.string().regex(/^[a-z0-9-]{3,60}$/).optional().describe('Subdominio para un sitio nuevo'),
        }),
        // La ruta se valida antes de pedir confirmación: fuera de las carpetas autorizadas se rechaza sin preguntar.
        permissions: (a) => { ctx.resolvePath(a.path); return ['connector.netlify.deploy']; }, risk: 'high', sideEffects: true,
        risks: ['La web queda publicada y accesible en Internet', 'Sube todos los archivos de la carpeta (excepto ocultos y node_modules)'],
        returns: 'URL publicada y estado del despliegue.',
        async execute({ path: p, siteId, name }) {
          const dir = ctx.resolvePath(p);
          if (!fs.statSync(dir).isDirectory()) throw new Error('La ruta no es una carpeta');
          if (!fs.existsSync(`${dir}/index.html`)) throw new Error('La carpeta no contiene index.html');
          const zip = zipDirectory(dir);
          let id = siteId;
          if (!id) {
            const site = await nf<{ id: string }>(ctx, '/sites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(name ? { name } : {}) });
            id = site.id;
          }
          const d = await nf<{ id: string; state: string; ssl_url?: string; url?: string; deploy_ssl_url?: string }>(ctx, `/sites/${encodeURIComponent(id)}/deploys`, {
            method: 'POST', headers: { 'content-type': 'application/zip' }, body: new Uint8Array(zip), timeoutMs: 120_000,
          });
          return { siteId: id, deployId: d.id, state: d.state, url: d.ssl_url ?? d.url, deployUrl: d.deploy_ssl_url, bytes: zip.length };
        },
      }),
    ],
  };
}
