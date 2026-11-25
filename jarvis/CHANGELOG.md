# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado semántico.

## [0.13.0] — 2026-11-25
### Añadido
- iPhone y PWA (Fase 10): vinculación de dispositivos con código de un solo uso y QR, token propio por
  dispositivo (solo su huella SHA-256 en la base de datos), revocación, freno contra fuerza bruta. Migración 8.
- Acceso desde la red local (segundo puerto, misma autenticación, HTTP y WebSocket) y dirección HTTPS pública
  (Tailscale) para el QR.
- Notificaciones push web con claves VAPID propias (avisos de automatizaciones y confirmaciones pendientes).
- PWA instalable: manifiesto, iconos, service worker (interfaz sin conexión, nunca la API), márgenes seguros.
- Proyecto iOS con Capacitor 8 (`apps/mobile`), permisos de micrófono y red local, icono; CORS solo para la app.
- Guía `IPHONE.md`. 8 pruebas nuevas (226 en total).

## [0.12.0] — 2026-11-25
### Añadido
- Automatizaciones (Fase 9): disparadores por hora (días de la semana), intervalo, una vez, WhatsApp recibido
  (filtros por remitente y texto), correo nuevo en Gmail (sondeo cada 5 min, sin disparar por lo antiguo),
  condición del equipo (CPU/memoria > % durante X min) y manual. Acciones con IA (instrucciones + herramientas
  elegidas) o pasos fijos sin IA con plantillas `{{event.*}}`, `{{last}}`, `{{date}}`, `{{time}}`.
- Identidad propia por automatización (`automation:<id>`) con los permisos que el usuario concede al activarla;
  riesgo alto/crítico pide confirmación aunque no haya nadie (la ejecución espera y avisa).
- Historial de ejecuciones con registro paso a paso y coste, reintentos seguros (solo si no hubo efectos),
  límite diario, sin solapes, emergencia → omitidas/canceladas. Migración 7.
- Herramientas `notify.send`, `automations.list` y `automations.propose` (JARVIS propone; el usuario activa).
- Sección Automatizaciones con plantillas y editor; avisos emergentes en la web y notificaciones del sistema en
  el escritorio. 15 pruebas nuevas (218 en total).

## [0.11.0] — 2026-11-25
### Añadido
- Conector Google (Fase 8B) con OAuth 2.0 de escritorio (PKCE, «state» de un solo uso, vuelta a 127.0.0.1):
  Gmail (buscar, leer, borradores, enviar con confirmación siempre y 20/h), Calendar (ver y crear eventos con la
  zona horaria local) y Drive (buscar, leer Documentos/Hojas/Presentaciones como texto, subir desde carpetas
  autorizadas). Token de actualización cifrado; renovación automática; si Google lo revoca, pide reconectar.
- Agenda real de Google Calendar en Inicio. Agentes de productividad e integraciones con Gmail/Calendar/Drive.
- Errores de APIs externas más legibles. 7 pruebas nuevas (203 en total).

## [0.10.0] — 2026-11-25
### Añadido
- Conectores (Fase 8, primera parte): marco común (manifiesto, credenciales cifradas en el almacén, activación solo
  por el usuario, herramientas que solo existen con el conector activado, registro de actividad y errores,
  acciones desde la interfaz). Migración 6 (`connector_log`).
- WhatsApp (no oficial, Baileys): vinculación por QR o código, órdenes desde «Mensaje a ti mismo», leer chats con
  permiso, enviar con confirmación siempre y máximo 15 por hora.
- Telegram (bot oficial, solo el chat autorizado), GitHub, Netlify (publicar una carpeta autorizada) y OpenShorts.
- Canales externos: Telegram y WhatsApp conversan con JARVIS con su propia conversación persistente.
- Sección Conectores; el agente «integraciones» usa los conectores. 11 pruebas nuevas (196 en total).

## [0.9.0] — 2026-11-25
### Añadido
- Multiagente (Fase 7): coordinador, 8 agentes especializados con identidad y permisos propios, Centro de tareas en
  directo, panel de Agentes, «Agentes trabajando» en Inicio, herramienta `agents.delegate`. Migración 5.
- Búsqueda web con Claude (desactivada por defecto) con límite por respuesta y coste contabilizado.
- 10 pruebas nuevas (185 en total) y prueba de una tarea de 3 agentes en el navegador.

### Cambiado
- El bucle de razonamiento se extrae a `ai/loop.ts` y lo comparten la conversación y los agentes.

## [0.8.0] — 2026-11-25
### Añadido
- Memoria (Fase 6): recuerdos con 8 categorías, relaciones, búsqueda híbrida (palabras, fragmentos, significado
  local), sugerencias, reglas de privacidad, herramientas para JARVIS y sección Memoria.
- Migración 4. 11 pruebas nuevas (175 en total). Verificación real del modelo en Node, navegador y escritorio.

### Cambiado
- App de escritorio: dependencias de IA local empaquetadas aparte y sin binarios innecesarios (274 MB).

## [0.7.0] — 2026-11-25
### Añadido
- Proveedores OpenAI (GPT-6.1 Terra, API Responses sin estado) y Google Gemini (nivel gratuito).
- Repartidor automático por dificultad con respaldo entre modelos, pausa de modelos sin cupo y protección de datos
  sensibles; modo «Automático» por defecto.
- Claves por proveedor (`/api/ai/keys/:provider`), etiqueta del modelo en cada respuesta, selector con
  «Automático», tabla del reparto en Configuración.
- 25 pruebas nuevas (164 en total) y prueba en navegador con los tres proveedores simulados.

## [0.6.0] — 2026-11-25
### Añadido
- Voz 100 % local: Whisper base (transformers.js + ONNX WebAssembly en un Web Worker), motor servido por JARVIS,
  descarga del modelo con progreso; elegible frente al reconocimiento del navegador; por defecto en escritorio.
- Palabra de activación «Jarvis» local (detector de voz + Whisper), con orden en la misma frase, pitido,
  pausa mientras JARVIS habla y enrutado desde cualquier sección. Indicador naranja y auditoría.
- 13 pruebas nuevas (139 en total) y pruebas reales con micrófono simulado (navegador y escritorio).

### Corregido
- Detector de voz: un ruido constante ya no se toma por voz (suelo de ruido adaptativo siempre).
- Motor ONNX: se copian todas sus variantes y antes de que Vite indexe `public/`.

## [0.5.1] — 2026-11-25
### Cambiado (petición del usuario: estética de la referencia, en naranja, más holográfica)
- Núcleo rediseñado: esfera de ~3600 partículas en 3D (superficie + volumen) con destellos, anillos de datos,
  corona-ecualizador, órbita punteada, satélites, etiquetas técnicas y barrido radar; flota en el espacio.
- Fondo espacial: estrellas en 3 capas con paralaje, centelleo, estrellas fugaces y nebulosas.
- Capa holográfica: borde de luz que recorre cada panel, esquinas de HUD, entrada con destello, líneas de
  barrido, texto con brillo, haz en el menú activo, transición entre secciones.
- Inicio estilo HUD: núcleo central, subtítulo en directo de la respuesta y barra de órdenes (voz o texto).
- Selector rápido de modelo (Opus / Sonnet / Haiku) en Inicio y Conversación.
- `POST /api/chat` con una conversación inexistente responde 404.

## [0.5.0] — 2026-11-25
### Añadido
- App de escritorio (Electron 45): núcleo integrado, conexión automática, DPAPI, bandeja, Ctrl+Alt+J, inicio con
  Windows, ventana aislada; empaquetado con electron-builder (instalador NSIS para Windows).
- Control del equipo con listas blancas: archivos, aplicaciones, navegador, comandos, procesos y ventanas.
- Sección «Archivos y proyectos» (carpetas, explorador, aplicaciones, comandos); Monitor con uso real de CPU y
  procesos.
- El núcleo puede servir la interfaz (`JARVIS_WEB_DIR`) con CSP.
- 20 pruebas nuevas (126 en total); prueba de la app real y empaquetada con Playwright + Electron.

### Cambiado
- Base de datos: `node:sqlite` en lugar de better-sqlite3 (sin módulos nativos). Requiere Node ≥ 22.13.

## [0.4.0] — 2026-11-25
### Añadido
- Voz: micrófono al pulsar con indicador y auditoría, respuestas habladas frase a frase, interrupción, manos
  libres, modo discreto, lectura de avisos, ajustes de voz/velocidad/tono/volumen.
- ElevenLabs preparado a través del núcleo (desactivado por defecto) con contador de caracteres.
- Migración 3 (`voice_usage`).
- 15 pruebas nuevas (106 en total) y prueba de voz en navegador real.

### Corregido
- El troceado de frases podía cortar dentro de un bloque de código.

## [0.3.0] — 2026-11-25
### Añadido
- Cerebro IA: capa de proveedores, adaptador Anthropic (SDK oficial, streaming, respaldo automático, caché),
  Opus 5.5 por defecto, Sonnet 5.5 y Haiku 5.5 seleccionables, nivel de razonamiento configurable.
- Motor de conversación con herramientas, confirmaciones en el chat, límite de pasos y cancelación.
- Almacén de credenciales cifrado; control de gasto mensual con aviso y bloqueo.
- Herramienta `system.datetime`.
- Interfaz: sección Conversación, panel Cerebro IA en Configuración, gasto del mes en Inicio, «Aprobar siempre».
- 42 pruebas nuevas (91 en total) y prueba en navegador contra API simulada.

### Corregido
- Carrera en la espera de confirmaciones: una decisión muy rápida podía darse por perdida.

## [0.2.0] — 2026-11-25
### Añadido
- Interfaz `@jarvis/web`: identidad naranja/azul oscuro, núcleo visual animado con 8 estados, 15 secciones,
  pantalla de vinculación por token, indicadores de privacidad (micrófono, cámara, pantalla), modo emergencia,
  confirmaciones, permisos, historial de auditoría, monitor del equipo, notificaciones en directo, centro de
  comandos, laboratorio de estados y personalización de apariencia.
- API: `POST /api/permissions/revoke` y `POST /api/permissions/revoke-all`.
- 10 pruebas nuevas (1 del núcleo, 9 de la interfaz).

### Decidido
- Cerebro por defecto: Claude Opus 5.5 (ADR-009).

## [0.1.0] — 2026-11-25
### Añadido
- Núcleo `@jarvis/core`: kernel de módulos, bus de eventos, motor de permisos, registro de herramientas con
  aprobaciones, auditoría encadenada, modo emergencia, API REST + WebSocket con token local.
- Herramienta `system.info`.
- Contratos compartidos `@jarvis/shared`.
- Documentación inicial y 39 pruebas automatizadas.
