import { z } from 'zod';
import { AutomationInput } from '@jarvis/shared';
import type { EventBus } from '../kernel/events';
import { defineTool, type ToolDefinition } from '../tools/registry';
import { describeTrigger, type AutomationManager } from './manager';

/** Herramientas de automatización: avisar al usuario y proponer rutinas (que el usuario revisa y activa). */
export function createAutomationTools(m: AutomationManager, bus: EventBus): ToolDefinition[] {
  return [
    defineTool({
      name: 'notify.send',
      description: 'Muestra un aviso al usuario en JARVIS (y en el escritorio). Sin coste ni efectos externos.',
      parameters: z.object({ title: z.string().min(1).max(120), body: z.string().max(2000).default('') }),
      permissions: ['notify.send'], risk: 'low', sideEffects: false, risks: [], returns: 'Confirmación.',
      execute({ title, body }, ctx) {
        bus.emit('notification', { title, body, source: `${ctx.principal.kind}:${ctx.principal.id}` });
        return { shown: true };
      },
    }),
    defineTool({
      name: 'automations.list',
      description: 'Lista las automatizaciones del usuario con su disparador, estado y última ejecución.',
      parameters: z.object({}),
      permissions: ['automations.read'], risk: 'low', sideEffects: false, risks: [], returns: 'Nombre, disparador, activa, próxima y última ejecución.',
      execute() {
        return m.list().map((a) => ({ id: a.id, name: a.name, trigger: describeTrigger(a.trigger), mode: a.action.mode, enabled: a.enabled, proposed: a.proposed,
          nextRunAt: a.nextRunAt, lastRun: a.lastRun ? { status: a.lastRun.status, at: a.lastRun.startedAt, result: a.lastRun.result?.slice(0, 300) ?? a.lastRun.error } : null }));
      },
    }),
    defineTool({
      name: 'automations.propose',
      description: 'Propone una automatización (queda DESACTIVADA hasta que el usuario la revise y la active en Automatizaciones). ' +
        'trigger.type: daily {time "HH:MM", days [1-7]} | interval {minutes ≥5; ≥30 con IA} | once {at "AAAA-MM-DDTHH:MM"} | whatsapp {from?, contains?} | gmail {query} | condition {metric cpu|memory, above %, forMinutes} | manual. ' +
        'action.mode: ai {instructions, tools[] con los nombres exactos de herramientas necesarias} | steps {steps [{tool, args}] con plantillas {{event.campo}}, {{last}}, {{date}}, {{time}}}.',
      parameters: AutomationInput,
      permissions: ['automations.propose'], risk: 'low', sideEffects: false, risks: [],
      returns: 'La propuesta creada (desactivada) y los permisos que pedirá al activarla.',
      execute(input, ctx) {
        const a = m.create(ctx.principal, input);
        return { id: a.id, name: a.name, trigger: describeTrigger(a.trigger), status: 'Propuesta: el usuario debe revisarla y activarla en Automatizaciones', permissionsOnEnable: m.requiredScopes(a) };
      },
    }),
  ];
}
