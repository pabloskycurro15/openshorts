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
