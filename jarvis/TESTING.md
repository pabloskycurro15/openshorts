# Pruebas

## Estrategia
- **Unitarias / integración (Vitest):** cada módulo del núcleo, con base de datos SQLite en memoria.
- **API:** `fastify.inject` para HTTP y un servidor real en puerto efímero para WebSocket.
- **Manual / extremo a extremo:** arranque real del núcleo y peticiones `curl`.
- Fases futuras: pruebas de componentes de UI, capturas con Playwright, pruebas en Windows real.

## Resultados reales (2026-11-25, Linux x64, Node 22.23)

`npm run check` → typecheck OK (núcleo, web y escritorio), lint OK (0 avisos), **203/203 pruebas superadas**.

| Archivo | Pruebas | Cubre |
|---|---|---|
| `kernel.test.ts` | 7 | Bus de eventos (entrega, desuscripción, aislamiento de errores); módulos (orden, ciclos, ausentes, duplicados, fallos aislados) |
| `security.test.ts` | 17 | Coincidencia de ámbitos (9 casos); reglas del motor de permisos; no escalada; emergencia; auditoría (cadena, solo inserción, detección de manipulación) |
| `tools.test.ts` | 8 | `system.info` real; validación; denegación; flujo de aprobación; denegar; emergencia frente a aprobaciones; permisos por recurso; auditoría |
| `server.test.ts` | 8 | Token obligatorio; health; listado e invocación; 400 ante cuerpo no válido; emergencia; revocación de permisos; WebSocket con y sin token; token local 0600 |
| `vault-budget.test.ts` | 8 | Cifrado/descifrado; el secreto no aparece en claro en los archivos de la base de datos; clave maestra 0600; otra clave no descifra; dato autenticado; ajustes por defecto y validación; aviso 80 % y bloqueo 100 %; reinicio mensual |
| `anthropic.test.ts` | 9 | Traducción de nombres y esquemas; reenvío intacto del razonamiento; cálculo de coste; **SDK real contra un servidor SSE local que imita la API**: petición (modelo, esfuerzo, caché, respaldo y cabecera beta, herramientas), streaming de texto, razonamiento y herramienta, uso de tokens; Haiku sin respaldo; errores traducidos; verificación sin coste |
| `engine.test.ts` | 13 | Sin clave; respuesta simple (streaming, coste, persistencia, estados); confirmación + «aprobar siempre»; denegación; herramienta inexistente y argumentos no válidos; cancelar durante la espera; presupuesto agotado; aviso 80 %; negativa del modelo; error del proveedor; límite de pasos; emergencia; respuestas simultáneas |
| `ai-routes.test.ts` | 6 | Estado inicial; la clave nunca sale por la API y se guarda cifrada; validación de ajustes; chat NDJSON por HTTP real, listado y borrado; chat sin clave; mensaje vacío |
| `tools.test.ts` (ampliado) | +3 | Espera de confirmación con carrera; caducidad; agente interactivo pregunta / en segundo plano se deniega |
| `voice.test.ts` (núcleo) | 5 | Auditoría del micrófono; ElevenLabs desactivado por defecto y no activable sin clave; con clave (contra API simulada): voces, síntesis MP3, cuerpo de la petición, contador de caracteres, la clave nunca sale; borrar clave desactiva; clave rechazada |
| `control.test.ts` | 16 | Config solo por el usuario, rutas absolutas, existentes, sin raíz de disco, ids únicos; rutas: `..`, absolutas externas, enlaces simbólicos; archivos: listar, leer, crear (sin sobrescribir), sobrescribir con copia y confirmación, borrar a papelera, solo lectura, rechazo sin preguntar, «aprobar siempre» = carpeta, binarios y tamaño; apps autorizadas sin shell y cierre; URLs solo http(s) con `rundll32`; comandos de lista blanca ejecutados de verdad; tiempo máximo; procesos reales; análisis de PowerShell/ps/ventanas; scripts sin inyección; ventanas solo Windows; CPU real |
| `server.test.ts` (ampliado) | +2 | API de control; servido de la interfaz con CSP y API protegida |
| `apps/desktop/test/master-key.test.ts` | 2 | Clave maestra cifrada por el sistema, recuperable y nunca en claro; rechazo de archivos no cifrados por el sistema |
| `agents.test.ts` | 8 | Definiciones y herramientas acotadas; extracción del plan JSON; plan → ejecución con identidad propia → síntesis, contexto encadenado, prompts y herramientas por agente, coste; herramienta no permitida denegada y permiso pendiente que espera al usuario; plan ilegible; agentes desactivados/desconocidos; cancelación por emergencia; API y bloqueo en emergencia |
| `memory.test.ts` | 11 | CRUD, confirmación solo por el usuario, relaciones, auditoría sin contenido; sensible; caducidad; búsqueda sin tildes, prefijos y con errores (trigramas); significado (embedder simulado); filtros, personal excluido, sugerencias puntúan menos; «recuerda que…» → confirmado / deducción → sugerencia; sensible y personal piden permiso siempre; uso personal «siempre»; sin propuestas; borrar = riesgo alto; API |
| `router.test.ts` | 25 | Clasificación (7 casos), acciones y datos sensibles; cadenas por nivel, sensibles fuera del gratis, Gemini desactivable, solo proveedores con clave, pausa; motor: cupo agotado en los dos Gemini → Haiku con aviso y pausa, modelo guardado por mensaje; modelo fijo; claves por proveedor; adaptador OpenAI (petición sin estado, texto, llamada, uso con caché, reenvío del razonamiento cifrado, errores de saldo/límite/clave); adaptador Gemini (esquemas, petición, firma reenviada intacta, respuesta de función, cupo 429, bloqueo); precios |
| `apps/web/test/vad.test.ts` | 13 | Detector de voz (silencio, frase con margen, ruidos cortos, frases largas, adaptación a ruido constante); palabra de activación (9 casos, incluidas variantes y falsos positivos) |
| `apps/web/test/voice.test.tsx` | 9 | Texto para voz; troceado por frases (abreviaturas, código); reconocimiento (sin soporte, parciales y final es-ES, permiso denegado, silencio); síntesis (cola, ajustes, fin, cancelación); voz por defecto |
| `connectors.test.ts` | 10 | Marco: herramientas ocultas sin activar, secretos cifrados y fuera de la API, credencial errónea rechazada, registro y estadísticas, borrar credenciales; GitHub: issue con confirmación; ZIP válido (CRC, deflate, sin ocultos); Netlify: ruta fuera rechazada sin preguntar, confirmación, ZIP enviado; OpenShorts: clave de Gemini del almacén; Telegram: solo chat autorizado, pendientes y autorización; WhatsApp: teléfonos, QR, código, órdenes solo desde ti mismo (por LID), sin bucles, mensajes ajenos nunca son órdenes, leer con permiso, envío crítico siempre confirmado, límite 15/h; emergencia; API HTTP |
| `google.test.ts` | 7 | Correo RFC 2822 con UTF-8 y extracción de texto; OAuth: URL con PKCE y redirección local, «state» de un solo uso, verificador comprobado, token cifrado y fuera de la API, cuenta, revocación; renovación y token revocado; Gmail (permiso, búsqueda, lectura multiparte, borrador, envío crítico siempre confirmado); Calendar (zona local, 1 h por defecto, día completo); Drive (consulta escapada, exportar Documento, subir solo desde carpetas autorizadas en multipart); vuelta OAuth por HTTP |
| `apps/web/test/web.test.tsx` | 14 | 15 secciones con ids únicos y plan para las futuras; 8 estados del núcleo visual; utilidades; almacenamiento tolerante a fallos; App con núcleo simulado: pantalla de vinculación, panel con 15 secciones, reacción a eventos (estado y emergencia), secciones futuras honestas, token caducado |

### Conectores con servicios reales (Fase 8A)
- WhatsApp: Baileys contra los servidores reales de WhatsApp → QR recibido (Node), mostrado en Chromium y en la app
  de escritorio empaquetada (Electron). La vinculación con un teléfono no se ha podido probar aquí.
- GitHub: activar con un token falso → «HTTP 401 (credencial no válida o sin permisos): Bad credentials».
- OpenShorts sin servidor arrancado → «No se pudo conectar».

### Prueba en navegador real (Playwright + Chromium, núcleo y web arrancados)
- Token incorrecto → mensaje «Token incorrecto»; token correcto → panel «Núcleo en línea».
- Recorrido por Inicio, Monitor, Seguridad, Historial, Comandos, Laboratorio, Configuración, Notificaciones y Memoria.
- Centro de comandos: ejecución real de `system.info` → «Correcto».
- Seguridad: activar emergencia (con doble confirmación) → banner y bloqueo; verificación de auditoría → «Íntegro»; desactivar.
- Laboratorio: estados Escuchando, Respondiendo y Error.
- Móvil 390×844: sin desbordamiento horizontal, menú lateral desplegable, **0 errores de consola**.

Prueba manual con el servidor real: `/api/ping` 200, sin token 401, `/api/health` ok, `system.info` con datos
reales del equipo, `/api/audit/verify` → `{"ok":true}`.

### Prueba de extremo a extremo de la Fase 3 (navegador real)
Interfaz → núcleo → SDK oficial de Anthropic → **API simulada local** (servidor SSE en `127.0.0.1:7890` mediante
`ANTHROPIC_BASE_URL`), sin coste:
- Sin clave: la Conversación explica cómo configurarla. Clave mal formada → rechazada. Clave con formato válido →
  guardada y «verificada» (contra la API simulada).
- «¿Qué hora es?» → texto en streaming → herramienta `system.datetime` → confirmación en el chat →
  «Aprobar siempre» → respuesta con la hora real del equipo. Segunda pregunta: sin confirmación.
- Historial persistente tras recargar; el permiso concedido aparece en Seguridad; gasto visible en Inicio.
- Peticiones recibidas: modelo `claude-opus-5-5`, esfuerzo `medium`, cabecera de respaldo, herramientas
  `system__info` y `system__datetime`, historial de 1 → 3 → 5 → 7 mensajes.
- Móvil sin desbordamiento. Único error de consola: el 400 esperado al rechazar la clave mal formada.

### Prueba de voz de extremo a extremo (Fase 4, navegador real)
Interfaz → núcleo → SDK → API simulada, con **micrófono y altavoz simulados** (el navegador sin cabeza no tiene
audio): pulsar micrófono → indicador «Micrófono ACTIVO · audio procesado por servicio de voz de Google (Chrome)» y
núcleo en «Escuchando» → «qué hora es» → confirmación hablada («Necesito tu confirmación.») → respuesta leída
frase a frase en es-ES con tono 0,85 → un mensaje escrito no se lee (modo «si le hablo») → manos libres reabre el
micrófono tras responder → 4 activaciones auditadas en el Historial → 0 errores de consola.

### App de escritorio (Fase 5A, Electron 45 real bajo Xvfb, con Playwright)
Mismo guion en modo desarrollo **y con el ejecutable empaquetado** por electron-builder:
conexión automática sin pantalla de token → la ventana no tiene Node → navegación a un sitio externo bloqueada →
autorizar una carpeta, explorarla y previsualizar un archivo → Monitor con uso de CPU y 12 procesos reales →
aviso honesto de voz local → 0 errores → cierre limpio. Además: `JARVIS.exe` (PE32+ x86-64) generado para Windows;
el instalador NSIS no se pudo generar aquí (requiere Wine o Windows).

### Rediseño holográfico (0.5.1, navegador real)
Inicio a 1600×1000 y 390×844: núcleo animado, órden escrita en la barra → confirmación en la barra → «Siempre» →
subtítulo con la respuesta (sin marcas de formato) → guardada en Conversación; sin desbordamiento en móvil;
0 errores. Rendimiento con renderizado por software (sin GPU): 21–26 fps; con GPU será mayor.

### Voz local (Fase 5B) — audio real en español, micrófono simulado
Audio generado en local con un modelo TTS español (MMS) e inyectado como micrófono de Chromium
(`--use-file-for-fake-audio-capture`):
- Node: Whisper base transcribe «¿Qué hora es?» exacto (~0,6 s); con «Jarvis…» → «Jarvis que horas».
- Navegador: pulsar el micrófono → Whisper en WebAssembly → «¿Qué hora es?» enviado → confirmación (~16 s con modelo en caché).
- Navegador, sin tocar nada: escucha local activa (indicador) → «Yarvis, qué hora es» → orden enviada → confirmación
  (~20 s, incluye carga del modelo) → `voice.wake_on` y `voice.wake_detected` auditados → 0 errores.
- App de escritorio (Electron): reconocimiento local por defecto, descarga del modelo con la CSP del núcleo,
  «¿Qué hora es?» transcrito (17 s incluida la descarga).
- Fallos encontrados y corregidos gracias a estas pruebas: variantes del motor ONNX no copiadas; Vite no veía los
  ficheros copiados; detector de voz engañado por ruido constante.

### Repartidor con tres proveedores (0.7, navegador real, APIs simuladas)
Claves de Anthropic, OpenAI y Google guardadas y verificadas desde Configuración → «Hola» → Gemini 3.5 Flash-Lite,
0 $ → explicación del IVA → GPT-6.1 Terra, 0,0012 $ → «Planifica una estrategia…» → Claude Opus 5.5, 0,0076 $ →
cupo de Gemini agotado → avisos y respuesta de Claude Haiku → 0 errores.

### Memoria con el modelo real (Fase 6)
- Node: 5 recuerdos; «¿de qué trabajo?» → Profesión, «¿qué bebo al despertar?» → Desayuno, «la página del
  restaurante de la costa» → Bar La Marina, «¿qué vehículo tengo?» → Coche, «raqueta» → Deporte (todo por
  significado, sin palabras en común).
- Navegador: crear 4 recuerdos desde la interfaz, «malga agenci» → Profesión (fragmentos), relación
  Profesión → Bar La Marina, activar significado (4 s) y las tres búsquedas por significado correctas; 0 errores.
- App de escritorio empaquetada (Electron 45): el motor nativo carga, descarga el modelo e indexa; búsqueda correcta.

### Multiagente (Fase 7, navegador real, API simulada)
«Busca en Nerja bares que no tengan web y prepara una propuesta» → plan de 3 subtareas (investigador, analista,
documental) → ejecutadas en orden con Opus/Opus/Sonnet y coste por subtarea → resultado final honesto (sin búsqueda
web, datos orientativos) → panel de Agentes con los 8 agentes → 0 errores.

## No probado todavía
- **Llamadas reales a OpenAI y Gemini** (formatos según su documentación oficial, probados contra simuladores).
- **Windows 11 real**: instalador, DPAPI, control de ventanas (PowerShell + user32), cierre por nombre de proceso,
  apertura de URLs con `rundll32`, inicio con Windows. Solo hay pruebas de la lógica y del análisis de salidas.
- **Voz con micrófono y altavoces reales** (Chrome/Edge o la app en tu equipo): el entorno de pruebas no tiene audio;
  la voz se ha probado con audio sintetizado. Rendimiento de Whisper en tu CPU.
- **Conversación con la API real de Anthropic**: requiere la clave del usuario. Al configurarla, «Probar conexión»
  hace una consulta gratuita y el primer mensaje confirmará el flujo completo.
- Ejecución en Windows 11 (se validará en la Fase 5 en un equipo Windows; este entorno es Linux).
- Safari/iOS (Fase 10).
