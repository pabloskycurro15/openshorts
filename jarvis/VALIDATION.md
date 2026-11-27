# Validación integral (Fase 12) — JARVIS 1.0.0

Leyenda: ✅ verificado de verdad · 🧪 verificado con servicios simulados (sin coste) · ⏳ pendiente de algo que
solo puede hacer el usuario (cuentas reales, Windows/iPhone/Mac físicos).

## Resumen
- `npm run check`: typecheck (núcleo, web, escritorio), lint con 0 avisos y **242 pruebas automáticas** superadas.
- Prueba de humo en Chromium contra el núcleo real: **15/15 secciones operativas**, conversación con respuesta,
  9 conectores listados, FFmpeg detectado, **0 errores** en consola.
- App de escritorio empaquetada (Linux, Electron 45.5) arrancada: núcleo en línea y diagnóstico completo.
- CI (GitHub Actions) preparada para repetir todo en **Windows real** y generar el instalador — ⏳ el usuario
  debe activar Actions en su fork.

## Por áreas
| Área | Estado | Cómo se ha comprobado |
|---|---|---|
| Núcleo, módulos, eventos, API | ✅ | Pruebas + núcleo real |
| Seguridad: permisos, confirmaciones, auditoría encadenada, emergencia | ✅ | Pruebas + navegador (emergencia con doble confirmación, verificación de auditoría) |
| Almacén cifrado (AES-256-GCM, DPAPI en Windows) | ✅ / ⏳ | Pruebas; DPAPI real pendiente de Windows (lo cubre la CI) |
| Interfaz (15 secciones, núcleo visual 8 estados, holográfica) | ✅ | Chromium y Electron |
| Cerebro IA (Claude, GPT, Gemini, repartidor, presupuesto) | 🧪 / ⏳ | SDK real contra servidores simulados; falta la primera llamada con tus claves |
| Voz (Whisper local, palabra «Jarvis», TTS, VAD) | ✅ / ⏳ | Modelo real con audio sintetizado; falta micrófono real |
| Control de Windows (archivos, apps, comandos, ventanas) | ✅ / ⏳ | Pruebas con procesos reales en Linux; ventanas y PowerShell en Windows real (CI) |
| Memoria (FTS5 + trigramas + significado local) | ✅ | Modelo real en Node, navegador y escritorio |
| Multiagente (coordinador + 8 agentes) | 🧪 | Tarea de 3 agentes en el navegador con IA simulada |
| Conectores: Google (Gmail, Calendar, Drive, YouTube), Spotify, Telegram, GitHub, Netlify, OpenShorts | 🧪 / ⏳ | APIs simuladas; GitHub y Google reales rechazan credenciales falsas como deben |
| WhatsApp (no oficial) | ✅ / ⏳ | QR real de los servidores de WhatsApp (Node, Chromium, Electron); falta vincular tu teléfono |
| Vinted (experimental) | 🧪 / ⏳ | Web simulada; con tu cookie puede fallar por su protección anti-robots |
| Adobe Express | 🧪 / ⏳ | Puente, ticket y CSP probados; editor real necesita tu Client ID |
| Llamadas y conversación por teléfono (Twilio) | 🧪 / ⏳ | Conversación con tu Gemini real a través de los webhooks firmados (Twilio simulado); falta tu cuenta de Twilio y el túnel |
| Estudio de vídeo (FFmpeg) y programas | ✅ / ⏳ | FFmpeg real (presentación, recorte, unión, miniatura); winget en Windows real |
| Automatizaciones | ✅ | Programador, disparadores, permisos, historial; navegador (plantilla → ejecución → aviso) |
| iPhone / PWA | ✅ / ⏳ | iPhone 15 Pro emulado vinculado por red local; PWA sin conexión; push cifrado real contra servidor local. Falta iPhone físico + Tailscale |
| App de Mac (Apple Silicon) | 🧪 / ⏳ | macOS simulado (AppleScript, Homebrew); estructura de la app generada y revisada (arm64, permisos, icono); el `.dmg` firmado y las pruebas en macOS real los hace la CI |
| App iOS nativa (Capacitor) | ⏳ | Proyecto generado; compilar requiere Mac con Xcode |
| Copias cifradas y restauración verificada | ✅ | Restauración en «otro equipo» con clave maestra distinta en las pruebas; navegador |
| Supabase (copia externa) | 🧪 / ⏳ | API de Storage simulada; tu plan gratuito tiene 2 proyectos activos (máximo) |
| Vigilancia de actividad sospechosa y diagnóstico | ✅ | Pruebas (ráfaga → emergencia, auditoría manipulada) y navegador |

## Pendiente del usuario (lista para «conectar todo al final»)
1. Activar GitHub Actions en el fork → pruebas en Windows e instalador `JARVIS-Setup-1.0.0.exe`.
2. Claves de IA (Gemini gratis como mínimo; Anthropic/OpenAI si quieres).
3. Google Cloud: cliente OAuth «App de escritorio» (Gmail, Calendar, Drive, YouTube).
4. Twilio (llamadas): Account SID, Auth Token, número de Twilio y verificar tu móvil.
5. WhatsApp: escanear el QR. Telegram: crear el bot. Spotify: Client ID. Adobe: Client ID. Vinted: cookie.
5. GitHub/Netlify: tokens. OpenShorts: dirección del servidor.
6. Supabase: decidir qué proyecto pausar (o usar un contenedor en uno existente) y pegar URL y clave.
7. iPhone: Tailscale + vincular + «Añadir a pantalla de inicio».
