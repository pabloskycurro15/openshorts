# Hoja de ruta

Cada fase solo se da por terminada cuando cumple sus criterios de aceptación **verificados**.

\* Fase 3: todo verificado contra el SDK oficial y una API simulada; falta la primera prueba con la API real de
Anthropic, que requiere la clave del usuario (ver TESTING.md).

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Arquitectura, núcleo, seguridad base, API, documentación | ✅ Completada |
| 2 | Interfaz: identidad naranja/azul oscuro, núcleo visual, navegación, 15 secciones, temas | ✅ Completada |
| 3 | Cerebro IA: proveedores, conversación, contexto, uso de herramientas, control de presupuesto | ✅ Completada* |
| 4 | Voz: STT, TTS, palabra de activación local, interrupción, conversación continua | ⏳ Siguiente |
| 5 | Control de Windows (Electron + PowerShell/UI Automation) | Pendiente |
| 6 | Memoria: categorías, búsqueda híbrida FTS5 + vectores, administración | Pendiente |
| 7 | Multiagente: coordinador, agentes especializados, supervisión | Pendiente |
| 8 | Conectores: extensiones, almacén de credenciales, integraciones prioritarias | Pendiente |
| 9 | Automatizaciones: motor, programador, rutinas, historial | Pendiente |
| 10 | iOS (Capacitor) y PWA, autenticación, sincronización | Pendiente |
| 11 | Seguridad avanzada y mantenimiento: cifrado, copias, diagnóstico, actualizaciones | Pendiente |
| 12 | Validación integral, instalador Windows, compilación iOS, despliegue PWA | Pendiente |

## Criterios de aceptación

### Fase 1 ✅
- [x] Monorepo con TypeScript estricto, ESLint (0 avisos) y Vitest.
- [x] Contratos compartidos con zod.
- [x] Registro de módulos con dependencias, detección de ciclos y aislamiento de fallos.
- [x] Motor de permisos con mínimo privilegio, confirmaciones y sin escalada.
- [x] Registro de herramientas con validación, aprobaciones y auditoría.
- [x] Auditoría de solo inserción con verificación de integridad.
- [x] API REST + WebSocket autenticada; modo emergencia.
- [x] Núcleo arrancado y probado con peticiones reales.
- [x] Documentación inicial completa.

### Fase 2 ✅
- [x] App `apps/web` con React + Vite + Tailwind, tokens de color naranja/azul oscuro.
- [x] Núcleo visual animado (Canvas 2D) con los 8 estados, conectado al WebSocket.
- [x] Navegación con las 15 secciones; las de fases futuras lo indican claramente, sin datos inventados.
- [x] Secciones con datos reales: Inicio, Monitor, Seguridad (aprobaciones, permisos, emergencia,
      verificación de auditoría), Historial, Notificaciones, Laboratorio, Centro de comandos, Configuración.
- [x] Personalización: color de acento, intensidad de animación, rejilla, partículas.
- [x] Diseño adaptable (escritorio y móvil, sin desbordamiento horizontal), `prefers-reduced-motion`,
      pausa en segundo plano y fuera de pantalla.
- [x] Pruebas de componentes y prueba en navegador real con capturas.

### Fase 3 ✅*
- [x] Adaptador Anthropic (Claude Opus 5.5 por defecto) tras la interfaz `AIProvider`; Sonnet/Haiku seleccionables.
- [x] Almacén de credenciales cifrado para la clave API (nunca en el código ni en texto plano).
- [x] Conversación en streaming con contexto e historial persistente; uso de herramientas vía `ToolRegistry`.
- [x] Confirmaciones en el chat (Aprobar / Aprobar siempre / Denegar); el asistente nunca actúa como usuario.
- [x] Control de presupuesto: coste por respuesta, aviso al 80 %, bloqueo al 100 % del límite mensual.
- [x] Estados del núcleo visual dirigidos por la IA (pensando, respondiendo, ejecutando).
- [x] Límite de 15 pasos por respuesta; cancelación; emergencia corta respuestas en curso.
- [ ] Primera conversación con la API real (pendiente de la clave del usuario).

### Fase 4 (propuesta)
- Reconocimiento de voz: Web Speech API (gratis) con botón de micrófono e indicador visible; arquitectura
  intercambiable para Whisper (local o API) más adelante.
- Síntesis de voz: voces del sistema en español de España (gratis); adaptador ElevenLabs opcional (de pago,
  solo con aprobación) para la voz masculina, grave y cinematográfica.
- Interrupción: hablar o pulsar detiene la respuesta en curso.
- Conversación continua (manos libres) con detección de turnos.
- Palabra de activación local ("Jarvis") con openWakeWord en el navegador/escritorio; sin enviar audio fuera.
- Ajustes: voz, velocidad, tono, volumen, modo discreto.
