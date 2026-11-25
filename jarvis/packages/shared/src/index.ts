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
  /** approved_always concede además el permiso de forma permanente. */
  decision: z.enum(['approved', 'approved_always', 'denied']),
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

// ───────────────────────── IA y conversación (Fase 3) ─────────────────────────

export const Effort = z.enum(['low', 'medium', 'high']);
export type Effort = z.infer<typeof Effort>;

export const AiSettings = z.object({
  model: z.string().min(1),
  effort: Effort,
  /** Límite de gasto mensual en USD. JARVIS se detiene al alcanzarlo. */
  monthlyLimitUsd: z.number().min(0).max(10_000),
});
export type AiSettings = z.infer<typeof AiSettings>;

export interface AiModelView {
  id: string;
  label: string;
  description: string;
  price: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface AiStatus {
  provider: string;
  configured: boolean;
  keyUpdatedAt: string | null;
  settings: AiSettings;
  models: AiModelView[];
  spentMonthUsd: number;
  /** 0-1+ fracción del límite consumida. */
  budgetRatio: number;
  warn: boolean;
  blocked: boolean;
  activeConversations: string[];
}

export const SetApiKeyRequest = z.object({ apiKey: z.string().trim().min(20).max(400) });

export const ChatRequest = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(20_000),
});

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  costUsd: number;
}

export type ChatBlockView =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface ChatMessageView {
  seq: number;
  role: 'user' | 'assistant';
  content: ChatBlockView[];
  createdAt: string;
}

/** Eventos del flujo de una respuesta (NDJSON en POST /api/chat). */
export type ChatEvent =
  | { type: 'start'; conversationId: string; title: string }
  | { type: 'text'; delta: string }
  | { type: 'message_end' }
  | { type: 'tool_call'; id: string; tool: string; input: unknown }
  | { type: 'approval_required'; id: string; approvalId: string; tool: string; reason: string; risk: RiskLevel }
  | { type: 'tool_result'; id: string; tool: string; status: ToolResult['status']; summary: string }
  | { type: 'usage'; model: string; costUsd: number; monthUsd: number; limitUsd: number }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; stopReason: string };

// ───────────────────────── Voz (Fase 4) ─────────────────────────

export const ElevenLabsSettings = z.object({
  /** Desactivado por defecto: es un servicio de pago y solo se usa si el usuario lo activa. */
  enabled: z.boolean(),
  voiceId: z.string().regex(/^[A-Za-z0-9]{10,40}$/, 'Identificador de voz no válido'),
  modelId: z.string().min(1).max(60),
  stability: z.number().min(0).max(1),
  similarity: z.number().min(0).max(1),
});
export type ElevenLabsSettings = z.infer<typeof ElevenLabsSettings>;

export interface VoiceStatus {
  elevenlabs: {
    configured: boolean;
    settings: ElevenLabsSettings;
    /** Caracteres enviados este mes (ElevenLabs factura por caracteres). */
    charsMonth: number;
  };
}

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  labels: Record<string, string>;
}

export const VoiceEventRequest = z.object({
  event: z.enum(['mic_on', 'mic_off', 'mic_denied', 'handsfree_on', 'handsfree_off']),
  /** Servicio que procesa el audio (p. ej. "navegador (Google)"). */
  processor: z.string().max(80).optional(),
});

export const TtsRequest = z.object({ text: z.string().trim().min(1).max(2500) });
