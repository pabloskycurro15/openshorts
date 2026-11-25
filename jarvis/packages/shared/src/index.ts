/**
 * @jarvis/shared — contratos estables entre el núcleo y los clientes
 * (escritorio, PWA, iOS). Todo lo que cruza la frontera de red se define aquí
 * con esquemas zod, para validar en ambos extremos.
 */
import { z } from 'zod';

// ───────────────────────── Estados del asistente ─────────────────────────

export const AssistantState = z.enum([
  'idle', // Inactivo
  'listening', // Escuchando
  'processing', // Procesando
  'thinking', // Pensando
  'speaking', // Respondiendo
  'executing', // Ejecutando tareas
  'error', // Error
  'offline', // Desconectado
]);
export type AssistantState = z.infer<typeof AssistantState>;

// ───────────────────────── Riesgo y permisos ─────────────────────────

/** Nivel de riesgo de una operación. Determina la política por defecto. */
export const RiskLevel = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevel>;

/** Decisión de una política de permisos. */
export const PolicyDecision = z.enum(['allow', 'ask', 'deny']);
export type PolicyDecision = z.infer<typeof PolicyDecision>;

/** Tipo de entidad que solicita una operación. */
export const PrincipalKind = z.enum(['user', 'core', 'module', 'agent', 'connector', 'automation']);
export type PrincipalKind = z.infer<typeof PrincipalKind>;

export const Principal = z.object({
  kind: PrincipalKind,
  id: z.string().min(1),
});
export type Principal = z.infer<typeof Principal>;

/**
 * Un permiso es un ámbito jerárquico separado por puntos con recurso opcional:
 *   "system.info.read"
 *   "fs.read:C:/Users/Ana/Proyectos"
 * Las concesiones admiten comodín final: "fs.*" o "fs.read:C:/Users/Ana/*".
 */
export const PermissionScope = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_*]+)*(:.+)?$/, 'Ámbito de permiso no válido');
export type PermissionScope = z.infer<typeof PermissionScope>;

export const ApprovalStatus = z.enum(['pending', 'approved', 'denied', 'expired']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalRequest = z.object({
  id: z.string(),
  principal: Principal,
  tool: z.string(),
  args: z.unknown(),
  scopes: z.array(PermissionScope),
  risk: RiskLevel,
  reason: z.string(),
  status: ApprovalStatus,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

// ───────────────────────── Herramientas ─────────────────────────

/** Descripción pública (serializable) de una herramienta registrada. */
export const ToolDescriptor = z.object({
  name: z.string(),
  description: z.string(),
  /** JSON Schema de los parámetros (derivado del esquema zod). */
  parameters: z.record(z.string(), z.unknown()),
  permissions: z.array(PermissionScope),
  risk: RiskLevel,
  sideEffects: z.boolean(),
  risks: z.array(z.string()),
  returns: z.string(),
});
export type ToolDescriptor = z.infer<typeof ToolDescriptor>;

export const ToolResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), output: z.unknown() }),
  z.object({ status: z.literal('pending_approval'), approvalId: z.string() }),
  z.object({ status: z.literal('denied'), reason: z.string() }),
  z.object({ status: z.literal('error'), error: z.string() }),
]);
export type ToolResult = z.infer<typeof ToolResult>;

// ───────────────────────── Módulos ─────────────────────────

export const ModuleStatus = z.enum(['registered', 'starting', 'running', 'stopped', 'failed']);
export type ModuleStatus = z.infer<typeof ModuleStatus>;

export const ModuleInfo = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  dependsOn: z.array(z.string()),
  status: ModuleStatus,
  error: z.string().nullable(),
});
export type ModuleInfo = z.infer<typeof ModuleInfo>;

// ───────────────────────── Auditoría ─────────────────────────

export const AuditEntry = z.object({
  seq: z.number().int(),
  ts: z.string(),
  principal: Principal,
  action: z.string(),
  target: z.string().nullable(),
  outcome: z.enum(['success', 'failure', 'denied', 'pending']),
  details: z.unknown(),
  hash: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

// ───────────────────────── Eventos (bus y WebSocket) ─────────────────────────

/** Mapa de eventos del sistema: nombre → carga útil. */
export interface JarvisEvents {
  'assistant.state': { state: AssistantState; detail?: string };
  'module.status': { id: string; status: ModuleStatus; error?: string | null };
  'approval.requested': ApprovalRequest;
  'approval.resolved': ApprovalRequest;
  'tool.invoked': { tool: string; principal: Principal; outcome: ToolResult['status'] };
  'audit.appended': AuditEntry;
  'emergency.changed': { lockdown: boolean; by: Principal };
}
export type JarvisEventName = keyof JarvisEvents;

export interface EventEnvelope<K extends JarvisEventName = JarvisEventName> {
  type: K;
  ts: string;
  payload: JarvisEvents[K];
}

// ───────────────────────── API REST ─────────────────────────

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeSec: z.number(),
  lockdown: z.boolean(),
  modules: z.array(ModuleInfo),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const InvokeToolRequest = z.object({
  tool: z.string(),
  args: z.unknown().default({}),
});
export type InvokeToolRequest = z.infer<typeof InvokeToolRequest>;

export const ResolveApprovalRequest = z.object({
  decision: z.enum(['approved', 'denied']),
});

export const EmergencyRequest = z.object({ lockdown: z.boolean() });

export const RevokeRequest = z.object({
  principal: Principal,
  scope: z.string().optional(),
});

export const GrantInfo = z.object({
  id: z.string(),
  principal: Principal,
  scope: z.string(),
  mode: z.enum(['allow', 'ask']),
  grantedAt: z.string(),
});
export type GrantInfo = z.infer<typeof GrantInfo>;

export const API_VERSION = 'v1';
