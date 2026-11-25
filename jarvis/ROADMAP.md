# Hoja de ruta

Cada fase solo se da por terminada cuando cumple sus criterios de aceptación **verificados**.

\* Fase 3: todo verificado contra el SDK oficial y una API simulada; falta la primera prueba con la API real de
Anthropic, que requiere la clave del usuario (ver TESTING.md).

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Arquitectura, núcleo, seguridad base, API, documentación | ✅ Completada |
| 2 | Interfaz: identidad naranja/azul oscuro, núcleo visual, navegación, 15 secciones, temas | ✅ Completada |
| 3 | Cerebro IA: proveedores, conversación, contexto, uso de herramientas, control de presupuesto | ✅ Completada* |
| 4 | Voz: STT, TTS, interrupción, conversación continua (palabra de activación → Fase 5) | ✅ Completada |
| 5 | App de escritorio Windows (Electron), control de Windows, palabra de activación local | ⏳ Siguiente |
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

### Fase 4 ✅
- [x] Reconocimiento con Web Speech API (gratis) tras la interfaz `SpeechRecognizer` (intercambiable por Whisper).
- [x] Micrófono solo al pulsarlo; indicador rojo; se informa de qué servicio procesa el audio; auditoría de cada
      activación, desactivación y denegación.
- [x] Síntesis con voces del sistema (gratis) tras `SpeechSynthesizer`; voz es-ES masculina/natural por defecto,
      tono 0,85; respuesta frase a frase durante el streaming; Markdown y código adaptados para leerse.
- [x] ElevenLabs preparado: clave cifrada en el núcleo, voces, síntesis por el núcleo, contador de caracteres;
      **desactivado hasta que el usuario lo active**.
- [x] Interrupción (micrófono, Detener, Esc); manos libres; modo discreto; lectura de avisos; ajustes completos.
- [ ] Palabra de activación local → **trasladada a la Fase 5**: en el navegador no puede funcionar en segundo plano
      ni de forma local fiable; en la app de escritorio sí (openWakeWord, modelo «hey jarvis», 100 % local).

### Fase 5 (propuesta)
- App de escritorio Windows con Electron: núcleo integrado, token automático, clave maestra con DPAPI
  (`safeStorage`), arranque con Windows opcional, icono en la bandeja.
- Palabra de activación «Jarvis» local con openWakeWord (ONNX), indicador permanente y desactivable.
- Control de Windows con permisos: abrir/cerrar aplicaciones autorizadas, ventanas, navegador, archivos en
  carpetas autorizadas, comandos de una lista blanca, procesos y rendimiento real (CPU por contadores).
- Todo como herramientas del `ToolRegistry` con riesgos honestos y confirmaciones.
