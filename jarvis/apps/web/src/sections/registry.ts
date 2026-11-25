import {
  Activity, Bot, Brain, Cable, FlaskConical, FolderKanban, History, Home, ListChecks,
  MessageSquare, Bell, Settings, ShieldCheck, TerminalSquare, Workflow, type LucideIcon,
} from 'lucide-react';

export interface SectionDef {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Fase en la que la sección queda operativa (≤ CURRENT_PHASE = disponible ya). */
  phase: number;
  summary: string;
  /** Qué hará la sección cuando su fase esté completa (se muestra mientras tanto). */
  planned?: string[];
}

/** Las 15 secciones de JARVIS, en el orden del documento de requisitos. */
export const SECTIONS: SectionDef[] = [
  { id: 'inicio', label: 'Inicio', icon: Home, phase: 2, summary: 'Núcleo, estado del sistema y resumen.' },
  { id: 'conversacion', label: 'Conversación', icon: MessageSquare, phase: 3, summary: 'Habla o escribe a JARVIS.' },
  { id: 'tareas', label: 'Centro de tareas', icon: ListChecks, phase: 7, summary: 'Objetivos que reparte el equipo de agentes.' },
  { id: 'automatizaciones', label: 'Automatizaciones', icon: Workflow, phase: 9, summary: 'Rutinas y tareas programadas.',
    planned: ['Disparadores por hora, evento o condición', 'Secuencias de acciones con permisos propios', 'Historial de ejecuciones y reintentos seguros', 'Aprobación para acciones importantes'] },
  { id: 'conectores', label: 'Conectores', icon: Cable, phase: 8, summary: 'Google, WhatsApp, Telegram, GitHub, Netlify y OpenShorts.' },
  { id: 'configuracion', label: 'Configuración', icon: Settings, phase: 2, summary: 'Apariencia, conexión y preferencias.' },
  { id: 'monitor', label: 'Monitor del equipo', icon: Activity, phase: 2, summary: 'Rendimiento del ordenador en tiempo real.' },
  { id: 'historial', label: 'Historial', icon: History, phase: 2, summary: 'Registro de auditoría verificable.' },
  { id: 'notificaciones', label: 'Notificaciones', icon: Bell, phase: 2, summary: 'Eventos del sistema en directo.' },
  { id: 'laboratorio', label: 'Laboratorio', icon: FlaskConical, phase: 2, summary: 'Pruebas visuales y funciones experimentales.' },
  { id: 'archivos', label: 'Archivos y proyectos', icon: FolderKanban, phase: 5, summary: 'Carpetas, aplicaciones y comandos autorizados.' },
  { id: 'comandos', label: 'Centro de comandos', icon: TerminalSquare, phase: 2, summary: 'Herramientas disponibles y ejecución manual.' },
  { id: 'memoria', label: 'Memoria', icon: Brain, phase: 6, summary: 'Recuerdos y conocimientos.' },
  { id: 'agentes', label: 'Agentes', icon: Bot, phase: 7, summary: 'Equipo de agentes especializados.' },
  { id: 'seguridad', label: 'Seguridad y permisos', icon: ShieldCheck, phase: 2, summary: 'Confirmaciones, permisos y emergencia.' },
];

/** Última fase completada y verificada. */
export const CURRENT_PHASE = 8;

export const sectionById = (id: string) => SECTIONS.find((s) => s.id === id);
