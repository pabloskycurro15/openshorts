# Hoja de ruta

Cada fase solo se da por terminada cuando cumple sus criterios de aceptación **verificados**.

\* Fase 5A: verificado en Linux con Electron real y empaquetado; falta la prueba en Windows 11 real (control de
ventanas, DPAPI, instalador), que debe hacer el usuario.

\* Fase 3: todo verificado contra el SDK oficial y una API simulada; falta la primera prueba con la API real de
Anthropic, que requiere la clave del usuario (ver TESTING.md).

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Arquitectura, núcleo, seguridad base, API, documentación | ✅ Completada |
| 2 | Interfaz: identidad naranja/azul oscuro, núcleo visual, navegación, 15 secciones, temas | ✅ Completada |
| 3 | Cerebro IA: proveedores, conversación, contexto, uso de herramientas, control de presupuesto | ✅ Completada* |
| 4 | Voz: STT, TTS, interrupción, conversación continua (palabra de activación → Fase 5) | ✅ Completada |
| 5A | App de escritorio Windows (Electron) y control del equipo con listas blancas | ✅ Completada* |
| 5B | Voz 100 % local (Whisper) y palabra de activación «Jarvis» | ✅ Completada* |
| 6 | Memoria: categorías, búsqueda híbrida FTS5 + vectores, administración | ✅ Completada |
| 7 | Multiagente: coordinador, agentes especializados, supervisión | ✅ Completada |
| 8 | Conectores: extensiones, almacén de credenciales, integraciones prioritarias | ✅ Completada* (Google, WhatsApp, Telegram, GitHub, Netlify, OpenShorts) |
| 9 | Automatizaciones: motor, programador, rutinas, historial | ✅ Completada |
| 10 | iOS (Capacitor) y PWA, autenticación, sincronización | ✅ Completada* (compilar iOS: Mac) |
| 11 | Seguridad avanzada y mantenimiento: cifrado, copias, diagnóstico, actualizaciones | ✅ Completada |
| 12 | Validación integral, instalador Windows, compilación iOS, despliegue PWA | ✅ Completada* (instalador: CI en Windows; iOS nativo: Mac) |

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

### Fase 5A ✅*
- [x] App de escritorio con Electron 45: núcleo integrado, token efímero entregado por preload, ventana aislada
      (contextIsolation, sandbox, sin Node), navegación externa bloqueada, micrófono solo para JARVIS.
- [x] Clave maestra con `safeStorage` (DPAPI en Windows); bandeja (mostrar, emergencia, iniciar con Windows,
      salir); atajo Ctrl+Alt+J; instancia única; cierre limpio.
- [x] Empaquetado con electron-builder: Linux probado; `JARVIS.exe` de Windows generado; instalador NSIS
      configurado (se genera en Windows con `npm run dist:win`).
- [x] Control del equipo con listas blancas: carpetas, aplicaciones, comandos; navegador; procesos; ventanas.
- [x] Protección de rutas (`..`, rutas externas, enlaces simbólicos); papelera de JARVIS; copia antes de modificar.
- [x] Uso real de CPU por contadores (también en Windows) y lista de procesos en el Monitor.
- [x] Migración a SQLite integrado de Node (sin módulos nativos).
- [ ] Prueba en Windows 11 real (instalador, DPAPI, ventanas, aplicaciones) — **la hace el usuario**.

### Fase 5B ✅*
- [x] Whisper local (transformers.js, ONNX WebAssembly, Web Worker) como motor de reconocimiento elegible
      (navegador o local); local por defecto en escritorio; descarga del modelo con progreso.
- [x] Detector de voz con suelo de ruido adaptativo; palabra de activación «Jarvis» (con orden en la misma frase).
- [x] Pausa durante el habla de JARVIS; pitido de activación; enrutado de la orden desde cualquier sección.
- [x] Indicador naranja de escucha local; auditoría de activación y detecciones.
- [ ] Probar con micrófono real en Windows (el entorno de pruebas usa audio sintetizado en español).

### Fase 6 ✅ — Memoria
- [x] Migración 4: recuerdos (8 categorías, origen, fecha, confianza, estado, sensible, caducidad), relaciones,
      índices FTS5 (sin tildes) y de trigramas.
- [x] Búsqueda híbrida: palabras (BM25, prefijos) + fragmentos (trigramas, tolera errores) + significado (modelo
      multilingüe local, ~120 MB) fusionados con RRF y ajustados por confianza/estado; filtros por categoría,
      proyecto y estado.
- [x] Reglas: «recuerda que…» → confirmado; deducciones → sugerencias; sensible y personal piden permiso cada vez;
      uso personal configurable; corto plazo que caduca; auditoría sin contenido.
- [x] Herramientas `memory.search/save/link/forget`; sección Memoria (buscar, filtrar, crear, editar, confirmar,
      borrar, relacionar, ajustes, activar significado).
- [x] Verificado: modelo real en Node, navegador y app de escritorio empaquetada.
- [ ] Memoria visual con imágenes (hoy: descripciones de texto) — junto con el análisis de pantalla.

### Fase 7 ✅ — Multiagente
- [x] Bucle de razonamiento común (`ai/loop.ts`) para la conversación y los agentes.
- [x] Coordinador: plan JSON validado (1-6 subtareas; si es ilegible, una subtarea de análisis) y síntesis final.
- [x] 8 agentes (investigación, programación, documentos, productividad, análisis, sistema, automatización,
      integraciones) con herramientas acotadas, identidad propia `agent:<id>` y nivel de modelo; activables.
- [x] Cada agente recibe los resultados de los anteriores; herramientas fuera de su lista → denegadas; permisos
      pendientes → la subtarea espera al usuario (aprobables desde el Centro de tareas).
- [x] Coste por tarea y subtarea; cancelación; la emergencia detiene todas las tareas; tareas interrumpidas por un
      reinicio se marcan como fallidas. Herramienta `agents.delegate` para que JARVIS encargue objetivos grandes.
- [x] Búsqueda web (Claude) preparada y desactivada; el repartidor la usa solo si el usuario la activa.

### Fase 8 — Conectores
- [x] 8A: marco de extensiones, WhatsApp (no oficial), Telegram, GitHub, Netlify, OpenShorts; sección Conectores.
- [x] 8B: Gmail, Google Calendar y Google Drive (OAuth de Google).
- \* Falta la prueba con las cuentas reales del usuario (QR, bot, tokens y cliente OAuth).

Propuesta original:
- Arquitectura de extensiones (manifiesto, operaciones como herramientas, credenciales en el almacén, aprobación
  antes de activar, registro y errores).
- Prioritarios: Gmail, Google Calendar, Google Drive (OAuth de Google), GitHub, Telegram (bot), OpenShorts (JARVIS
  → clips) y Netlify (publicar webs). Cada uno con sus permisos y riesgos.
