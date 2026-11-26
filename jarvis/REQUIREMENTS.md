# Requisitos

## Funcionales (resumen por áreas)
Núcleo y módulos · Interfaz (15 secciones, núcleo visual con 8 estados) · IA con herramientas ·
Voz (STT, TTS, activación, interrupción) · Memoria (8 categorías, búsqueda híbrida) · Multiagente ·
Control de Windows · Automatizaciones · Conectores · Seguridad y emergencia · Sincronización y copias ·
Clientes Windows, iOS y PWA. El detalle y los criterios de aceptación de cada fase están en ROADMAP.md.

## No funcionales
- **Seguridad:** mínimo privilegio, confirmación de operaciones sensibles, auditoría verificable, sin
  credenciales en el código.
- **Privacidad:** el micrófono nunca transmite audio continuo hacia fuera; los recuerdos personales solo se
  usan para personalizar si el usuario lo pide (configurable).
- **Mantenibilidad:** módulos con contratos estables, pruebas, documentación y migraciones versionadas.
- **Rendimiento:** las animaciones de la interfaz deben respetar `prefers-reduced-motion` y pausarse en
  segundo plano.
- **Resiliencia:** desconexiones gestionadas mostrando qué funciones dejan de estar disponibles.

## Limitaciones reales de plataforma

### iOS
- **No** es posible escuchar continuamente una palabra de activación en segundo plano (salvo con Siri/App
  Intents: "Oye Siri, pregunta a Jarvis…", que es la vía prevista).
- **No** se pueden controlar otras aplicaciones; sí usar Atajos/App Intents que exponga JARVIS.
- La ejecución en segundo plano es limitada; las tareas largas corren en el núcleo del PC o en la nube y el
  iPhone recibe notificaciones.
- Compilar requiere **macOS + Xcode**; instalar en el dispositivo de forma estable o publicar requiere una
  **cuenta Apple Developer (99 USD/año)**.

### Windows
- El control de otras aplicaciones se hará con PowerShell, UI Automation y la API de ventanas; las apps que
  no expongan accesibilidad solo podrán controlarse de forma limitada.
- Firmar el instalador evita avisos de SmartScreen pero requiere un certificado de firma de código (de pago).

### Conectores
- **WhatsApp:** solo existe API oficial para empresas (WhatsApp Business Platform). Por decisión expresa del
  usuario se usa la vía no oficial (dispositivo vinculado), con avisos, confirmación en cada envío y límite.
- **Vinted:** no tiene API pública. Por petición del usuario hay un conector experimental con su cookie de
  sesión (puede dejar de funcionar); alternativa estable: avisos por correo + Gmail.
- **Adobe Express:** solo el editor embebido oficial (Embed SDK) con Client ID gratuito; la IA no edita diseños.
- **YouTube:** subir desde un proyecto de Google sin auditar deja los vídeos como privados; cuota ≈ 6 subidas/día.
- **Spotify:** el control de reproducción por API requiere cuenta Premium.
- Gmail/Calendar/Drive/YouTube requieren crear un proyecto OAuth en Google Cloud (gratuito; ciertos ámbitos
  sensibles necesitan verificación de Google para uso no personal).

## Servicios externos y costes estimados

**No se contratará ni activará nada de pago sin tu autorización explícita.**

| Servicio | Para qué | Coste estimado | Alternativa gratuita |
|---|---|---|---|
| Modelo de IA (Claude / OpenAI / Gemini) | Cerebro (repartidor automático) | Gemini: gratis con límite diario · Terra 1 $/5 $ · Haiku 0,10/0,50 · Sonnet 2/10 · Opus 4/20 (por millón de tokens) | Gemini gratis cubre lo sencillo; Ollama local en el futuro |
| ElevenLabs | Voz premium | Desde ~5 USD/mes | Voces del sistema (Web Speech / SAPI) |
| STT en la nube (Whisper API) | Transcripción precisa | ~0,006 USD/min | Web Speech API / Whisper local |
| Supabase | Copia externa cifrada (opcional) | Plan gratuito (1 GB); Pro 25 USD/mes | Copias locales / disco externo |
| Tailscale | iPhone fuera de casa con HTTPS | Gratis (uso personal) | Solo red local |
| Twilio | Llamadas de JARVIS a tu móvil | Prueba gratis (~15 $); luego número ~1-3 $/mes + ~0,02-0,10 $/min | Avisos por Telegram/WhatsApp/push |
| Spotify Premium | Controlar la reproducción | Suscripción del usuario | Buscar y gestionar listas funciona sin Premium |
| Apple Developer | App iOS en el dispositivo / publicar | 99 USD/año | Simulador o instalación de 7 días con Apple ID gratuito |
| Certificado de firma de código para Windows | Evitar avisos de SmartScreen | ~70-300 €/año | Instalador sin firmar (muestra aviso) |
| Dominio | Acceso remoto a la PWA | ~10 €/año | Red local / túnel gratuito |
