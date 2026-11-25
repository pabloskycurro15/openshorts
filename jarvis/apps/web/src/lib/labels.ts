import type { AssistantState, RiskLevel } from '@jarvis/shared';

export const STATE_LABEL: Record<AssistantState, string> = {
  idle: 'En espera',
  listening: 'Escuchando',
  processing: 'Procesando',
  thinking: 'Pensando',
  speaking: 'Respondiendo',
  executing: 'Ejecutando tareas',
  error: 'Error',
  offline: 'Desconectado',
};

export const RISK_LABEL: Record<RiskLevel, string> = { low: 'Bajo', medium: 'Medio', high: 'Alto', critical: 'Crítico' };

export const EVENT_LABEL: Record<string, string> = {
  'assistant.state': 'Cambio de estado',
  'module.status': 'Estado de módulo',
  'approval.requested': 'Confirmación solicitada',
  'approval.resolved': 'Confirmación resuelta',
  'tool.invoked': 'Herramienta ejecutada',
  'audit.appended': 'Registro de auditoría',
  'emergency.changed': 'Modo emergencia',
};

export const PRINCIPAL_LABEL: Record<string, string> = {
  user: 'Usuario',
  core: 'Núcleo',
  module: 'Módulo',
  agent: 'Agente',
  connector: 'Conector',
  automation: 'Automatización',
};

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'hace unos segundos';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleString('es-ES');
}
