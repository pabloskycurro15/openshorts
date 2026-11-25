import { z } from 'zod';
import { defineTool } from '../tools/registry';
import type { ConnectorCtx, ConnectorDef } from './framework';
import { jsonFetch } from './http';

const REPO = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Formato «propietario/repositorio»');

/** GitHub (API REST oficial) con un token personal de permisos mínimos. */
export function githubConnector(opts: { baseUrl?: string } = {}): ConnectorDef {
  const base = opts.baseUrl ?? 'https://api.github.com';
  const gh = <T>(ctx: ConnectorCtx, p: string, init: RequestInit = {}) =>
    jsonFetch<T>(ctx.fetch, `${base}${p}`, { ...init, headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', authorization: `Bearer ${ctx.get('token')}`, 'user-agent': 'jarvis-assistant', ...(init.body ? { 'content-type': 'application/json' } : {}) } });

  return {
    id: 'github',
    name: 'GitHub',
    description: 'Consulta repositorios, issues y archivos, y crea issues con tu confirmación.',
    official: true,
    docsUrl: 'https://github.com/settings/personal-access-tokens/new',
    fields: [{ key: 'token', label: 'Token personal (fine-grained)', secret: true, required: true, placeholder: 'github_pat_…', help: 'Dale solo los repositorios y permisos que quieras (lectura de contenido; issues si quieres crearlas).' }],
    async test(ctx) {
      const u = await gh<{ login: string }>(ctx, '/user');
      return { ok: true, detail: `Conectado como ${u.login}` };
    },
    tools: (ctx) => [
      defineTool({
        name: 'github.repos', description: 'Lista tus repositorios de GitHub (los más recientes primero).',
        parameters: z.object({ limit: z.number().int().min(1).max(100).default(30) }),
        permissions: ['connector.github.read'], risk: 'low', sideEffects: false, risks: [], returns: 'Nombre, visibilidad, descripción y fecha.',
        async execute({ limit }) {
          const r = await gh<{ full_name: string; private: boolean; description: string | null; pushed_at: string; html_url: string }[]>(ctx, `/user/repos?sort=pushed&per_page=${limit}`);
          return r.map((x) => ({ repo: x.full_name, private: x.private, description: x.description, pushedAt: x.pushed_at, url: x.html_url }));
        },
      }),
      defineTool({
        name: 'github.issues', description: 'Lista las issues abiertas (o cerradas) de un repositorio.',
        parameters: z.object({ repo: REPO, state: z.enum(['open', 'closed', 'all']).default('open'), limit: z.number().int().min(1).max(100).default(20) }),
        permissions: ['connector.github.read'], risk: 'low', sideEffects: false, risks: [], returns: 'Número, título, estado, autor y enlace.',
        async execute({ repo, state, limit }) {
          const r = await gh<{ number: number; title: string; state: string; user: { login: string }; html_url: string; pull_request?: unknown }[]>(ctx, `/repos/${repo}/issues?state=${state}&per_page=${limit}`);
          return r.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, state: i.state, author: i.user.login, url: i.html_url }));
        },
      }),
      defineTool({
        name: 'github.read_file', description: 'Lee un archivo de texto de un repositorio.',
        parameters: z.object({ repo: REPO, path: z.string().min(1).max(500), ref: z.string().max(200).optional() }),
        permissions: ['connector.github.read'], risk: 'low', sideEffects: false, risks: [], returns: 'Contenido del archivo (máx. 200 KB).',
        async execute({ repo, path, ref }) {
          const r = await gh<{ type: string; encoding: string; content: string; size: number }>(ctx, `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
          if (r.type !== 'file') throw new Error('No es un archivo');
          if (r.size > 200_000) throw new Error('Archivo demasiado grande');
          return Buffer.from(r.content, 'base64').toString('utf8');
        },
      }),
      defineTool({
        name: 'github.create_issue', description: 'Crea una issue en un repositorio. Siempre pide confirmación.',
        parameters: z.object({ repo: REPO, title: z.string().min(1).max(250), body: z.string().max(20000).default('') }),
        permissions: ['connector.github.write'], risk: 'high', sideEffects: true,
        risks: ['Publica una issue visible para quien tenga acceso al repositorio'], returns: 'Número y enlace de la issue.',
        async execute({ repo, title, body }) {
          const r = await gh<{ number: number; html_url: string }>(ctx, `/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title, body }) });
          return { number: r.number, url: r.html_url };
        },
      }),
    ],
  };
}
