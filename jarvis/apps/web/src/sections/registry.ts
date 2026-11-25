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
  { id: 'tareas', label: 'Centro de tareas', icon: ListChecks, phase: 7, summary: 'Objetivos, planes y progreso.',
    planned: ['Tareas descompuestas por el agente coordinador', 'Progreso, errores y resultados en tiempo real', 'Detener o reanudar tareas'] },
  { id: 'automatizaciones', label: 'Automatizaciones', icon: Workflow, phase: 9, summary: 'Rutinas y tareas programadas.',
    planned: ['Disparadores por hora, evento o condición', 'Secuencias de acciones con permisos propios', 'Historial de ejecuciones y reintentos seguros', 'Aprobación para acciones importantes'] },
  { id: 'conectores', label: 'Conectores', icon: Cable, phase: 8, summary: 'Servicios e integraciones.',
    planned: ['Gmail, Calendar, Drive, YouTube, GitHub, Spotify, Telegram…', 'Credenciales cifradas y permisos por conector', 'Registro de actividad y errores', 'Aprobación antes de activar cualquier conector'] },
  { id: 'configuracion', label: 'Configuración', icon: Settings, phase: 2, summary: 'Apariencia, conexión y preferencias.' },
  { id: 'monitor', label: 'Monitor del equipo', icon: Activity, phase: 2, summary: 'Rendimiento del ordenador en tiempo real.' },
  { id: 'historial', label: 'Historial', icon: History, phase: 2, summary: 'Registro de auditoría verificable.' },
  { id: 'notificaciones', label: 'Notificaciones', icon: Bell, phase: 2, summary: 'Eventos del sistema en directo.' },
  { id: 'laboratorio', label: 'Laboratorio', icon: FlaskConical, phase: 2, summary: 'Pruebas visuales y funciones experimentales.' },
  { id: 'archivos', label: 'Archivos y proyectos', icon: FolderKanban, phase: 5, summary: 'Carpetas autorizadas y proyectos.',
    planned: ['Explorar solo carpetas que tú autorices', 'Crear, editar y organizar archivos con confirmación', 'Proyectos de programación con su contexto'] },
  { id: 'comandos', label: 'Centro de comandos', icon: TerminalSquare, phase: 2, summary: 'Herramientas disponibles y ejecución manual.' },
  { id: 'memoria', label: 'Memoria', icon: Brain, phase: 6, summary: 'Recuerdos y conocimientos.',
    planned: ['8 categorías: corto/largo plazo, personal, proyectos, documental, contextual, relacional, visual', 'Búsqueda híbrida (texto + semántica)', 'Editar, borrar, ver origen, fecha y confianza', 'Los recuerdos personales solo se usan si lo pides'] },
  { id: 'agentes', label: 'Agentes', icon: Bot, phase: 7, summary: 'Equipo de agentes especializados.',
    planned: ['Coordinador + investigación, programación, documentos, productividad, automatización, análisis, sistema, integraciones', 'Permisos independientes por agente', 'Estado, progreso y consumo de cada uno'] },
  { id: 'seguridad', label: 'Seguridad y permisos', icon: ShieldCheck, phase: 2, summary: 'Confirmaciones, permisos y emergencia.' },
];

/** Última fase completada y verificada. */
export const CURRENT_PHASE = 4;

export const sectionById = (id: string) => SECTIONS.find((s) => s.id === id);
