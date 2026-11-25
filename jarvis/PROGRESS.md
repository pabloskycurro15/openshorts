# Registro de progreso

## 2026-11-25 — Fase 1
- [x] Inspección del entorno: Node 22, Python 3.13, Rust; repositorio OpenShorts sin código previo de JARVIS.
- [x] Decisiones de arquitectura y stack documentadas (DECISIONS.md).
- [x] Estructura del monorepo (`packages/shared`, `packages/core`).
- [x] Kernel: EventBus, ModuleRegistry, configuración, logger con censura de secretos.
- [x] Persistencia SQLite con migraciones versionadas (FTS5 verificado).
- [x] Seguridad: PermissionEngine, AuditLog encadenado, token local.
- [x] ToolRegistry con aprobaciones; herramienta `system.info`.
- [x] API REST + WebSocket.
- [x] 39 pruebas pasando; typecheck y lint limpios; prueba manual con el servidor arrancado.
- [x] Documentación inicial.

## 2026-11-25 — Fase 2
- [x] App web React 19 + Vite 8 + Tailwind 4 en el monorepo.
- [x] Tema naranja/azul oscuro con tokens y acento personalizable.
- [x] Núcleo visual Canvas con 8 estados e interpolación suave; pausa y movimiento reducido.
- [x] Conexión en tiempo real con reconexión exponencial; detección de token inválido.
- [x] 15 secciones: 8 operativas con datos reales, 7 con su plan y fase (sin datos inventados).
- [x] Endpoints de revocación de permisos.
- [x] 49 pruebas; prueba en Chromium real (escritorio 1440×900 y móvil 390×844) con capturas.

## 2026-11-25 — Fase 3
- [x] Almacén cifrado, migración 2 (secretos, conversaciones, mensajes, consumo).
- [x] Interfaz de proveedores neutra + adaptador Anthropic con el SDK oficial 1.14.
- [x] Motor de conversación con herramientas, permisos interactivos y espera de confirmaciones.
- [x] Control de gasto (5 $/mes por defecto) y coste por respuesta.
- [x] API de IA y chat en streaming (NDJSON).
- [x] Interfaz: Conversación, Cerebro IA, gasto en Inicio.
- [x] 91 pruebas; prueba en navegador: interfaz → núcleo → SDK real → API de Anthropic simulada.
- [ ] Prueba con la API real — **pendiente de que el usuario cargue crédito y pegue su clave**.

## 2026-11-25 — Fase 4
- [x] Interfaces de voz intercambiables; Web Speech (reconocimiento y síntesis).
- [x] Respuesta hablada en streaming; interrupción; manos libres; modo discreto; avisos hablados.
- [x] Auditoría del micrófono; aviso del servicio que procesa el audio.
- [x] ElevenLabs preparado y desactivado (decisión del usuario: empezar gratis).
- [x] 106 pruebas; prueba de voz en Chromium real con micrófono y altavoz simulados.
- [ ] Palabra de activación local → Fase 5 (escritorio).

## 2026-11-25 — Fase 5A
- [x] Control del equipo con listas blancas y protección de rutas; herramientas de archivos, apps, navegador,
      comandos, procesos y ventanas.
- [x] Migración a `node:sqlite`.
- [x] App de escritorio Electron con DPAPI, bandeja, atajo, inicio con Windows; empaquetado verificado.
- [x] 126 pruebas; prueba de extremo a extremo de la app de escritorio real y de la empaquetada.
- [ ] Prueba en Windows 11 real — pendiente del usuario.
- Decisión técnica: Fase 5 dividida en 5A/5B porque Electron no tiene reconocimiento de voz en la nube.

## 2026-11-25 — Rediseño holográfico y Fase 5B
- [x] Núcleo de partículas flotando en el espacio (referencia del usuario, en naranja) y capa holográfica.
- [x] Selector rápido de modelo (Opus/Sonnet/Haiku).
- [x] Whisper local y palabra de activación; verificados con audio en español sintetizado en local.
- [ ] Pendiente de decisión del usuario: activar la búsqueda web (coste: ~10 $ por 1.000 búsquedas + tokens).

## 2026-11-25 — Varios cerebros (0.7)
- [x] Adaptadores OpenAI y Gemini; repartidor y respaldo; interfaz.
- [x] Probado contra simuladores de las tres APIs (navegador real).
- [ ] Primera llamada real a OpenAI y Gemini — pendiente de las claves del usuario.

## 2026-11-25 — Fase 6 (memoria)
- [x] Almacén, búsqueda híbrida, reglas, herramientas, API e interfaz.
- [x] Modelo de significado real verificado (Node, navegador, escritorio empaquetado).
- Búsqueda web: preparada para la siguiente iteración, desactivada hasta que el usuario la active (coste).

## 2026-11-25 — Fase 7 (multiagente) y búsqueda web
- [x] Coordinador, agentes, tareas, API e interfaz; verificado en navegador con API simulada.
- [x] Búsqueda web programada y desactivada (decisión del usuario: «prográmala para luego»).

## 2026-11-25 — Fase 8A (conectores)
- [x] Marco de conectores, WhatsApp, Telegram, GitHub, Netlify y OpenShorts; API, interfaz y pruebas.
- [x] WhatsApp: QR real recibido de los servidores de WhatsApp en Node, navegador y app de escritorio empaquetada.
- [x] GitHub real: un token falso se rechaza con «401 Bad credentials» (verificado contra api.github.com).
- [ ] Vinculación real de WhatsApp, bot real de Telegram, publicación real en Netlify y OpenShorts en marcha:
      requieren que el usuario escanee el QR / cree el bot / dé los tokens desde su equipo.
- [x] Fase 8B: Google (Gmail, Calendar, Drive) con OAuth; API simulada completa en pruebas; en navegador real la
      tarjeta abre Google con la URL correcta (Google rechaza un cliente inventado con «invalid_client», como debe)
      y la página de vuelta rechaza un «state» falso.
- [ ] Autorización real con la cuenta del usuario: requiere que cree su cliente OAuth (gratis) en Google Cloud.

## Decisiones tomadas por el usuario
- WhatsApp con su número personal mediante conexión no oficial, aceptando el riesgo de bloqueo («da igual las
  consecuencias»). Medidas igualmente: confirmación en cada envío, 15/hora, sin envíos masivos. El número no se
  guarda en el código ni en el repositorio: se introduce en la app.
- Búsqueda web: implementada pero desactivada hasta que el usuario la active.
- Repartir tareas entre Gemini gratis, GPT-6.1 Terra y Claude «como mejor veas» (0.7). ChatGPT gratis no tiene API.
- Cerebro: Claude Opus 5.5 (API de Anthropic, prepago de 5 $, sin recarga automática). Límite en JARVIS: 5 $/mes.

- Voz: empezar con voces gratuitas del sistema; ElevenLabs preparado para activarlo más adelante.

## Decisiones pendientes del usuario
- Ninguna por ahora.
