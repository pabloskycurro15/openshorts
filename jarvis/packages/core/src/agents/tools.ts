import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../tools/registry';
import type { TaskManager } from './tasks';

/** Herramienta para que JARVIS delegue un objetivo grande en el equipo de agentes. */
export function createAgentTools(tasks: TaskManager): ToolDefinition[] {
  return [defineTool({
    name: 'agents.delegate',
    description: 'Encarga un objetivo grande y de varios pasos (investigar, preparar un documento, revisar un proyecto…) al equipo de agentes. Se ejecuta en segundo plano; el usuario sigue el progreso en el Centro de tareas.',
    parameters: z.object({ goal: z.string().min(5).max(4000) }).strict(),
    permissions: ['agents.delegate'],
    risk: 'medium', sideEffects: true,
    risks: ['Pone a trabajar a varios agentes (puede consumir créditos de IA)'],
    returns: 'Id de la tarea creada.',
    execute: ({ goal }) => {
      const t = tasks.start(goal);
      return { taskId: t.id, note: 'Tarea en marcha. El usuario puede seguirla en el Centro de tareas.' };
    },
  }) as ToolDefinition];
}
