import { z } from 'zod';
import { MemoryCategory } from '@jarvis/shared';
import { defineTool, type ToolDefinition } from '../tools/registry';
import { isSensitive } from '../ai/router';
import type { MemoryStore } from './store';

/** «Recuerda que…», «apunta…», «no olvides…»: petición explícita del usuario. */
export const EXPLICIT_REMEMBER = /\b(recuerda(lo|me)?|recuérda(lo|me)|apunta(lo)?|anota(lo)?|guarda(lo)? (que|esto|en (tu|la) memoria)|memoriza(lo)?|no (te )?olvides|no lo olvides|tenlo en cuenta)\b/i;

export function createMemoryTools(store: MemoryStore): ToolDefinition[] {
  const search = defineTool({
    name: 'memory.search',
    description: 'Busca en la memoria de JARVIS (por palabras, fragmentos y significado). Los recuerdos personales solo se incluyen si el usuario lo pide expresamente (includePersonal) y requieren su permiso. Los recuerdos con estado «suggested» no están confirmados.',
    parameters: z.object({
      query: z.string().max(500).describe('Qué buscar'),
      category: MemoryCategory.optional(),
      project: z.string().max(100).optional(),
      includePersonal: z.boolean().default(false).describe('Solo si el usuario ha pedido usar sus datos personales'),
      limit: z.number().int().min(1).max(20).default(8),
    }).strict(),
    permissions: (a) => (a.includePersonal && store.getSettings().personalUse === 'on_request' ? ['memory.read', 'memory.read.personal'] : ['memory.read']),
    // «Aprobar siempre» nunca concede el acceso a lo personal: se pregunta cada vez.
    grantScopes: () => ['memory.read'],
    risk: 'low', sideEffects: false,
    risks: ['Envía recuerdos al modelo de IA'],
    returns: 'Recuerdos (id, categoría, título, contenido, confianza, estado, origen, fecha) ordenados por relevancia.',
    execute: async (a) => {
      const hits = await store.search({ query: a.query, categories: a.category ? [a.category] : undefined, project: a.project, includePersonal: a.includePersonal, limit: a.limit });
      return hits.map((h) => ({ id: h.id, category: h.category, title: h.title, content: h.content.slice(0, 1500), project: h.project, confidence: h.confidence, status: h.status, source: h.source, updatedAt: h.updatedAt }));
    },
  });

  const save = defineTool({
    name: 'memory.save',
    description: 'Guarda un recuerdo. Si el usuario lo ha pedido expresamente («recuerda que…»), queda confirmado; si lo deduces tú, queda como sugerencia pendiente de confirmar. No guardes suposiciones como hechos. Los datos sensibles requieren permiso.',
    parameters: z.object({
      category: MemoryCategory,
      title: z.string().min(1).max(200),
      content: z.string().min(1).max(5000),
      project: z.string().max(100).optional(),
      tags: z.array(z.string().max(40)).max(10).optional(),
      confidence: z.number().min(0).max(1).default(0.7),
      relatedTo: z.array(z.string()).max(5).optional().describe('Ids de recuerdos relacionados'),
    }).strict(),
    permissions: (a) => (isSensitive(`${a.title} ${a.content}`) ? ['memory.write', 'memory.write.sensitive'] : ['memory.write']),
    grantScopes: () => ['memory.write'],
    risk: 'low', sideEffects: true,
    risks: ['Guarda información en la memoria de JARVIS'],
    returns: 'El recuerdo guardado, con su estado (confirmado o sugerencia).',
    execute: (a, ctx) => {
      const explicit = EXPLICIT_REMEMBER.test(ctx.context?.lastUserText ?? '');
      if (!explicit && !store.getSettings().autoSuggest) throw new Error('El usuario ha desactivado que JARVIS proponga recuerdos por su cuenta. Solo puedes guardar si te lo pide.');
      const m = store.create(ctx.principal, { category: a.category, title: a.title, content: a.content, project: a.project ?? null, tags: a.tags, confidence: explicit ? Math.max(a.confidence, 0.9) : Math.min(a.confidence, 0.8) },
        { source: ctx.context?.conversationId ? `conversación:${ctx.context.conversationId}` : 'jarvis', status: explicit ? 'confirmed' : 'suggested' });
      for (const rel of a.relatedTo ?? []) {
        try { store.link(ctx.principal, m.id, rel, 'relacionado'); } catch { /* id inválido: se ignora */ }
      }
      return { id: m.id, status: m.status, note: m.status === 'suggested' ? 'Guardado como sugerencia: el usuario puede confirmarlo en Memoria.' : 'Guardado y confirmado.' };
    },
  });

  const link = defineTool({
    name: 'memory.link',
    description: 'Relaciona dos recuerdos (p. ej. «trabaja en», «forma parte de», «depende de»).',
    parameters: z.object({ fromId: z.string(), toId: z.string(), relation: z.string().min(1).max(60) }).strict(),
    permissions: ['memory.write'],
    risk: 'low', sideEffects: true, risks: [],
    returns: 'La relación creada.',
    execute: (a, ctx) => store.link(ctx.principal, a.fromId, a.toId, a.relation),
  });

  const forget = defineTool({
    name: 'memory.forget',
    description: 'Borra un recuerdo definitivamente. Solo si el usuario lo pide.',
    parameters: z.object({ id: z.string() }).strict(),
    permissions: ['memory.delete'],
    risk: 'high', sideEffects: true,
    risks: ['Borra un recuerdo de forma definitiva'],
    returns: 'Confirmación.',
    execute: (a, ctx) => {
      if (!store.delete(ctx.principal, a.id)) throw new Error('Recuerdo inexistente');
      return { deleted: a.id };
    },
  });

  return [search, save, link, forget] as ToolDefinition[];
}
