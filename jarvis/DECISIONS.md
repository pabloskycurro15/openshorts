# Decisiones técnicas (ADR)

Formato: contexto → alternativas → decisión → consecuencias. Estado: ✅ aceptada · 🔶 provisional (pendiente de validar o de tu aprobación).

---

## ADR-001 · Ubicación del proyecto ✅
**Contexto:** el entorno de desarrollo solo puede publicar en el repositorio `openshorts`.
**Decisión:** JARVIS vive en la carpeta autocontenida `jarvis/`, sin dependencias de OpenShorts.
**Consecuencias:** puede moverse a su propio repositorio en cualquier momento copiando la carpeta.
OpenShorts podrá integrarse más adelante como **conector** (p. ej. "Jarvis, saca 5 clips de este vídeo").

## ADR-002 · Lenguaje: TypeScript de extremo a extremo ✅
**Alternativas:** Python (mejor ecosistema de ML local, pero separa el lenguaje del núcleo y de la UI);
Rust (máximo rendimiento, desarrollo más lento); Go.
**Decisión:** TypeScript en núcleo (Node 22) y clientes.
**Por qué:** un único lenguaje y los mismos contratos zod en núcleo, escritorio, PWA e iOS; SDK oficiales
de todos los proveedores de IA; Node corre de forma nativa en Windows.
**Limitación:** tareas de ML local pesadas (palabra de activación, STT local) pueden necesitar ONNX Runtime
o un proceso auxiliar Python; se decidirá en la Fase 4.

## ADR-003 · Escritorio Windows: Electron 🔶
**Alternativas:** Tauri 2 (binarios de ~10 MB, menos RAM, pero el núcleo Node tendría que empaquetarse
aparte como sidecar); WinUI/.NET (nativo, pero otro lenguaje y sin compartir UI con iOS/PWA).
**Decisión:** Electron, ejecutando el núcleo en un `utilityProcess` con el Node que ya incluye.
**Por qué:** un solo runtime, módulos nativos (better-sqlite3) sin complicaciones, acceso a PowerShell
y UI Automation para el control de Windows, instalador maduro (electron-builder / NSIS) y autoactualización.
**Coste:** instalador de ~100-150 MB y más RAM que Tauri. Se valida en la Fase 5.

## ADR-004 · iOS: Capacitor sobre la UI web 🔶
**Alternativas:** SwiftUI nativo (mejor integración, pero UI duplicada); React Native (otro árbol de UI).
**Decisión:** Capacitor reutilizando `apps/web`, con plugins nativos para voz, notificaciones y Keychain.
**Requisitos ineludibles de Apple:** un Mac con Xcode para compilar, y una cuenta Apple Developer
(99 USD/año) para instalar fuera del simulador más de 7 días o publicar. Ver REQUIREMENTS.md.

## ADR-005 · Interfaz: React + Vite + Tailwind + PWA ✅
Mismo stack que el dashboard de OpenShorts (coherencia y conocimiento previo). La PWA es la propia
app web con manifiesto y service worker; escritorio e iOS la empaquetan.

## ADR-006 · Persistencia: SQLite local (+ FTS5, + sqlite-vec) ✅
**Alternativas:** PostgreSQL local (pesado para un asistente personal); LanceDB/Chroma para vectores
(otro servicio más).
**Decisión:** un único archivo SQLite en modo WAL. FTS5 (verificado disponible) para búsqueda textual
y `sqlite-vec` (Fase 6) para la semántica → búsqueda híbrida en una sola base de datos.
**Sincronización en la nube** (Fase 10): candidato Supabase (Postgres + pgvector), ya conectado a tu
cuenta, pero **no se usará sin tu aprobación de coste**.

## ADR-007 · API interna: Fastify REST + WebSocket ✅
REST para órdenes, WebSocket para eventos en tiempo real (estado del núcleo visual, aprobaciones,
progreso de agentes). Contratos zod compartidos. Escucha solo en `127.0.0.1` por defecto.

## ADR-008 · Modelo de seguridad ✅
Motor de permisos por ámbitos jerárquicos, concesiones explícitas para todo principal que no sea el usuario,
confirmación obligatoria en riesgo alto/crítico, auditoría encadenada por hashes y modo emergencia.
Detalle en SECURITY.md.

## ADR-009 · IA independiente del proveedor ✅
Interfaz `AIProvider` (chat en streaming + llamadas a herramientas + healthCheck). Adaptadores previstos:
Anthropic (Claude), Google (Gemini, ya usado en OpenShorts), OpenAI-compatible y Ollama (local, gratis).
**Decisión del usuario (2026-11-25):** Claude **Opus 5.5** como modelo por defecto, vía API de Anthropic
con crédito de prepago (5 $ iniciales, sin recarga automática). Sonnet 5.5 y Haiku 5.5 seleccionables.
JARVIS incluirá además su propio límite de gasto mensual.

## ADR-010 · Identidad visual: naranja y azul oscuro ✅ (decisión del usuario)
Sustituye a la paleta azul/cian del prompt original. Tokens previstos:

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#050A14` | Fondo casi negro azulado |
| `--navy-900` | `#0A1628` | Paneles |
| `--navy-700` | `#13284A` | Bordes, paneles elevados |
| `--orange-500` | `#FF7A1A` | Acento principal, núcleo activo |
| `--orange-300` | `#FFA552` | Brillos, hover |
| `--amber-200` | `#FFD3A1` | Texto destacado |
| `--text` | `#E7EEF8` | Texto principal |
| `--danger` | `#FF4D4F` | Error / emergencia |

Será configurable (sistema de temas, Fase 2).

**Actualización (0.5.1, referencia visual del usuario):** núcleo como esfera de partículas flotando en el
espacio con anillos de HUD, en naranja; capa holográfica global. Todo respeta «reducir movimiento» y la
intensidad de animación; el fondo se limita a ~30 fps y todo se pausa con la pestaña oculta.

## ADR-013 · Motor de conversación ✅
- **Bucle de herramientas propio** (no el Tool Runner del SDK): cada acción debe pasar por `ToolRegistry`
  (permisos, confirmaciones que pueden tardar minutos, auditoría) y el motor no debe depender de un proveedor.
- **Identidad del asistente:** principal `agent:jarvis`, nunca `user`. Como el usuario está presente en la
  conversación, una concesión ausente se convierte en **pregunta** (no en denegación). «Aprobar siempre» crea una
  concesión permanente; el riesgo alto y crítico siempre vuelve a preguntar. Los procesos en segundo plano
  (Fases 8–9) no son interactivos: sin concesión, se deniega.
- **Historial de solo inserción** y contenido original del proveedor reenviado sin cambios (Claude verifica que no
  se edite su razonamiento). Todo `tool_use` recibe su `tool_result`, también al cancelar o denegar.
- **Respaldo automático** `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) en Opus y Sonnet: si
  los filtros de seguridad declinan una petición legítima, Anthropic la reintenta con otro modelo. Haiku no lo admite.
- **Caché automática** del prefijo (`cache_control` en la petición): instrucciones, herramientas e historial se
  cobran al 10 % en turnos posteriores. Las instrucciones de sistema son texto fijo (sin fechas) para no romperla;
  la fecha se obtiene con la herramienta `system.datetime`.
- **Esfuerzo por defecto: medio** (es el valor por defecto de Opus 5.5); configurable (bajo/medio/alto).
- **Coste:** tokens reales devueltos por la API × precios públicos (`ai/pricing.ts`). Es una estimación local;
  la factura oficial está en la consola de Anthropic.
- **Límite de 15 pasos** por respuesta para evitar bucles costosos.

## ADR-014 · Almacén de credenciales ✅
AES-256-GCM con el nombre del secreto como dato autenticado; clave maestra en archivo 0600 separado de la base de
datos (`MasterKeyProvider` intercambiable: en la Fase 5, Electron `safeStorage`/DPAPI). Protege frente a
filtraciones de la base de datos o de copias; no frente a quien controle por completo la cuenta del usuario.

## ADR-021 · Multiagente secuencial con coordinador ✅
- Coordinador sin herramientas (solo texto): plan JSON → subtareas en orden → síntesis. Secuencial (no en paralelo)
  para que cada agente aproveche lo anterior y para que las confirmaciones lleguen de una en una.
- Agente = prompt + lista de herramientas + nivel de modelo + identidad `agent:<id>`. Los permisos son por agente:
  conceder algo al programador no lo concede al investigador. Ningún agente puede concederse nada.
- Límite de 10 pasos por subtarea y 6 subtareas por tarea (control de coste); coste guardado como «tarea:<id>».
- Búsqueda web: herramienta de servidor de Anthropic (`web_search_20260209`), solo con Claude y solo si el usuario
  la activa; se cobra 0,01 $ por búsqueda además de los tokens.

## ADR-020 · Memoria híbrida local ✅
- **Almacenamiento:** SQLite (misma base de datos), tabla `memories` + `memory_links`; índices FTS5
  (`unicode61 remove_diacritics 2`) y de trigramas (texto normalizado sin tildes) para fragmentos y errores.
- **Significado:** `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (384 dimensiones, q8) con transformers.js y ONNX
  Runtime nativo en el núcleo; vectores guardados como BLOB; búsqueda por coseno (suficiente para miles de
  recuerdos). Elegido frente a `multilingual-e5-small` por separar mejor lo relevante (prueba en español).
  Opcional y desactivado por defecto (descarga de ~120 MB que decide el usuario).
- **Fusión:** RRF de las tres listas, ajustada por confianza y estado; corte relativo (≥ 60 % del mejor) para
  evitar ruido semántico.
- **Reglas:** confirmado solo si el usuario lo pide en su mensaje (lo comprueba el núcleo, no el modelo);
  sugerencias para lo demás; sensible y personal requieren permiso cada vez («aprobar siempre» no lo cubre);
  auditoría con metadatos, nunca contenido.
- **Escritorio:** transformers.js y onnxruntime-node fuera del paquete y desempaquetados del asar; excluidos
  caché, librerías CUDA/TensorRT y binarios de otros sistemas (app de 1,5 GB → 274 MB sin comprimir).

## ADR-019 · Varios proveedores y repartidor automático ✅ (decisión del usuario: «repártelo como veas mejor»)
- **Proveedores:** Anthropic (Claude), OpenAI (GPT-6.1 Terra, API Responses) y Google (Gemini, nivel gratuito de
  AI Studio, API generateContent). El plan gratuito de ChatGPT no tiene API (automatizar la web incumple sus
  condiciones), por eso OpenAI es de pago.
- **Clasificación local por reglas** (sin gastar una llamada para decidir): sencilla / media / compleja, acciones
  sobre el equipo y datos sensibles.
- **Cadenas:** sencilla → Gemini 3.5 Flash-Lite (gratis, ~500/día) → Gemini 3.8 Flash (gratis, ~20/día) → Haiku;
  media → Terra → Sonnet → Opus; compleja → Opus → Sonnet → Terra; acciones → Sonnet/Opus (usan mejor las
  herramientas); lo sensible nunca va al nivel gratuito de Google (usa los datos para mejorar sus productos).
- **Respaldo:** si un modelo falla por cupo, saldo, clave o caída *antes de escribir nada*, se pasa al siguiente,
  se avisa y ese modelo queda en pausa 10 minutos. Dentro de una respuesta se mantiene el mismo modelo.
- **Transparencia:** evento `route` (modelo y motivo) y modelo guardado en cada mensaje; coste por respuesta.
- **Historial entre proveedores:** cada adaptador reenvía intacto el contenido original solo si es suyo
  (razonamiento cifrado de OpenAI, firmas de Gemini, razonamiento de Claude); el de otros, en formato neutro.
- **Limitaciones honestas:** los formatos de OpenAI y Gemini se han implementado según su documentación oficial y
  probado contra simuladores; falta la primera llamada real (requiere las claves). Terra responde de golpe (sin
  streaming) hasta verificar sus eventos. Si el proyecto de Google tiene facturación activada, Gemini deja de ser
  gratis y el contador de JARVIS no lo reflejaría.
- Por defecto ahora es **Automático** (antes Opus fijo); se puede fijar cualquier modelo desde el selector.

## ADR-018 · Voz local: Whisper + detector de voz como palabra de activación ✅
- **Reconocimiento local:** Whisper *base* (multilingüe, cuantizado q8, ~80 MB) con transformers.js y ONNX
  Runtime en WebAssembly, dentro de un Web Worker. Probado con español: «¿Qué hora es?» exacto, ~0,6 s por frase
  en CPU (Node). *tiny* descartado (transcripciones erróneas en español).
- **Privacidad:** el audio nunca sale del equipo; solo se descarga el modelo una vez de Hugging Face (y se guarda
  en la caché). El motor WebAssembly lo sirve el propio JARVIS (`/ort/`), sin CDN.
- **Palabra de activación:** en lugar de un modelo dedicado (openWakeWord), un detector de voz por energía con suelo
  de ruido adaptativo despierta a Whisper solo cuando alguien habla; si la frase empieza por «Jarvis» (o variantes
  como «Yarvis», «Jarbis»), se activa. Ventajas: un único modelo, español nativo, orden en la misma frase
  («Jarvis, ¿qué hora es?»). Coste: CPU solo mientras se habla. Se pausa mientras JARVIS habla o escucha una orden.
- Escritorio: reconocimiento local por defecto (Electron no tiene el servicio en la nube del navegador) y política
  de audio sin gesto previo para que la activación funcione al arrancar.
- Pendiente de valorar: WebGPU para acelerar en equipos con GPU.

## ADR-015 · SQLite integrado de Node en lugar de better-sqlite3 ✅ (sustituye parte de ADR-006)
**Problema:** better-sqlite3 es un módulo nativo: hay que compilarlo por separado para Node y para Electron, y en
Windows suele exigir las herramientas de compilación de Visual Studio.
**Decisión:** `node:sqlite` (integrado en Node ≥ 22.13 y en Electron 45 / Node 24) tras un envoltorio mínimo
(`storage/sqlite.ts`) con la misma API que usaba el proyecto. FTS5 verificado.
**Consecuencias:** cero dependencias nativas; instalación trivial en Windows; el mismo núcleo funciona dentro de
Electron. En Node 22 muestra un aviso «experimental» (silenciado); en Node 24 es estable.

## ADR-016 · Modelo de seguridad de la app de escritorio ✅
- El núcleo corre en el proceso principal; la ventana carga la interfaz servida por el propio núcleo
  (`127.0.0.1`) con CSP estricta.
- Ventana con `contextIsolation`, `sandbox` y sin Node. El preload solo expone `{token, version, platform}` y solo
  a páginas del mismo origen. Token efímero por arranque (no se guarda en disco).
- Navegación fuera de JARVIS bloqueada (los enlaces se abren en el navegador). Solo se concede el permiso de
  micrófono, y solo a JARVIS.
- Clave maestra cifrada con DPAPI (`safeStorage`); si el sistema no ofrece almacén seguro, se usa el archivo 0600.

## ADR-017 · Control del equipo por listas blancas ✅
- Lo que no está autorizado no existe: carpetas, aplicaciones y comandos los define el usuario (solo él).
- Rutas resueltas con `realpath` (incluye enlaces) y comprobadas contra la carpeta; prohibido autorizar la raíz
  de un disco. Una ruta no válida se rechaza **sin** pedir confirmación.
- Procesos sin shell y con argumentos fijos definidos por el usuario: el modelo solo elige un id.
- Borrar = mover a la papelera de JARVIS; modificar guarda copia previa.
- «Aprobar siempre» concede la carpeta entera (lectura o escritura), no todo el disco; el riesgo alto vuelve a
  preguntar siempre.
- Ventanas vía PowerShell + user32 (EncodedCommand; identificadores solo numéricos).

## ADR-011 · Voz ✅
- Base gratuita: Web Speech API (reconocimiento y síntesis del sistema).
- Voz premium masculina, profunda y cinematográfica: ElevenLabs (ya usado en OpenShorts; de pago).
- Palabra de activación **local**: openWakeWord (código abierto, ONNX) como primera opción; Porcupine
  como alternativa (requiere clave y licencia).
- Nunca se envía audio continuo a servicios externos: solo tras la activación o con el botón.
**Implementado (Fase 4):**
- Reconocimiento con Web Speech API. **Limitación honesta:** en Chrome/Edge/Safari el audio lo procesa el servicio
  en la nube del navegador (Google/Microsoft/Apple), no JARVIS. Por eso: solo al pulsar, indicador visible, aviso
  del procesador y auditoría. Whisper local queda como alternativa futura tras la misma interfaz.
- Síntesis: voces del sistema; las voces «en línea» envían el texto al proveedor y se marcan como tal.
- ElevenLabs a través del núcleo (la clave nunca llega al navegador); voz por defecto «Adam», modelo
  `eleven_multilingual_v2`. Desactivado por defecto.
- Ajustes de voz por dispositivo (localStorage): cada equipo tiene sus voces y su micrófono.
- Palabra de activación y reconocimiento local: Fase 5B. En Electron no existe el servicio de voz en la nube del
  navegador, así que el escritorio necesita Whisper local (más privado, además).

## ADR-012 · Detalles de la interfaz ✅
- **React 19 + Vite 8 + Tailwind 4** (tokens de diseño en CSS con `@theme`; acento como variable de tiempo de
  ejecución para la personalización).
- **Núcleo visual en Canvas 2D**, no WebGL: suficiente para anillos, onda y ~90 partículas a 60 fps con un coste
  mínimo; sin dependencias. Se pausa con la pestaña oculta o fuera de pantalla y respeta `prefers-reduced-motion`.
- **Enrutado por hash** propio (`#/seccion`): sin dependencia y compatible con `file://` en Electron.
- **Fuentes locales** (`@fontsource`: Orbitron para títulos, Inter para texto, JetBrains Mono para datos): sin
  peticiones a terceros, por privacidad y para funcionar sin Internet.
- **Iconos:** lucide-react (única dependencia visual).
- **Conexión:** la web habla con el proxy de Vite, que reenvía `/api` al núcleo (sin CORS). Token del núcleo
  guardado en el navegador; en la app de escritorio lo inyectará Electron (Fase 5).
