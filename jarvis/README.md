# JARVIS

Asistente personal inteligente multimodal: núcleo local seguro, voz, memoria, agentes,
conectores, automatizaciones y control autorizado del ordenador, con clientes de
escritorio (Windows 11), iOS y PWA.

> **Estado actual: Fases 1–5B completadas (núcleo, interfaz holográfica, cerebro IA, voz local con palabra de
> activación, control del equipo y app de escritorio).** Siguiente: memoria (Fase 6). ver [ROADMAP.md](ROADMAP.md) y [PROGRESS.md](PROGRESS.md).
> Este documento solo describe lo que existe y está probado.

## Qué funciona hoy

- Núcleo `@jarvis/core` (Node 22 + TypeScript) con:
  - Registro de módulos con dependencias, orden topológico y aislamiento de fallos.
  - Bus de eventos tipado.
  - Motor de permisos de mínimo privilegio (concesiones por ámbito, confirmaciones, sin escalada).
  - Registro de herramientas: validación de argumentos, permisos, cola de aprobaciones y auditoría.
  - Auditoría de solo inserción con cadena de hashes verificable.
  - Modo emergencia (bloquea toda operación con efectos).
  - API REST + WebSocket de eventos, protegida por token local.
  - Herramienta real `system.info` (SO, CPU, memoria).
- Contratos compartidos `@jarvis/shared` (zod) para todos los clientes.
- Interfaz `@jarvis/web` (React 19 + Vite + Tailwind 4), naranja y azul oscuro:
  - Núcleo visual animado (Canvas) con 8 estados, conectado en tiempo real al núcleo.
  - Navegación con las 15 secciones. Operativas con datos reales: Inicio, Monitor, Seguridad
    (confirmaciones, permisos, emergencia, verificación), Historial, Notificaciones, Laboratorio,
    Centro de comandos y Configuración (apariencia). El resto indica claramente su fase.
  - Diseño adaptable (escritorio y móvil), respeta «reducir movimiento», pausa animaciones en segundo plano.
- Cerebro IA (Fase 3):
  - Conversación con Claude Opus 5.5 (Sonnet 5.5 y Haiku 5.5 seleccionables) con respuestas en streaming.
  - Uso de herramientas a través del sistema de permisos: JARVIS pide confirmación en el propio chat
    (Aprobar / Aprobar siempre / Denegar).
  - Clave API guardada cifrada (AES-256-GCM); ninguna ruta de la API la devuelve.
  - Control de gasto: coste por respuesta, gasto del mes, aviso al 80 % y bloqueo al 100 % del límite (5 $ por defecto).
  - Conversaciones persistentes; cancelación; el modo emergencia corta cualquier respuesta en curso.
- Voz (Fase 4):
  - Micrófono al pulsar (indicador rojo, quién procesa el audio, cada activación auditada).
  - Respuestas habladas frase a frase mientras se generan, en español de España (voz grave por defecto).
  - Interrupción (micrófono, Detener o Esc), manos libres, modo discreto, lectura de avisos importantes.
  - Ajustes de voz, velocidad, tono y volumen. ElevenLabs preparado (de pago, desactivado por defecto).
- Control del equipo (Fase 5A), siempre dentro de listas blancas que defines tú:
  - Archivos en carpetas autorizadas (leer, crear, modificar con copia, mover, borrar a la papelera de JARVIS).
  - Aplicaciones autorizadas (abrir/cerrar), navegador (abrir webs), comandos predefinidos sin shell.
  - Procesos y uso real de CPU; ventanas (listar, traer al frente, minimizar — solo Windows).
- App de escritorio (Electron): núcleo integrado, conexión automática, clave maestra protegida con DPAPI,
  bandeja del sistema, Ctrl+Alt+J, inicio con Windows, ventana aislada.
- Sin módulos nativos: SQLite integrado de Node (se instala en Windows sin herramientas de compilación).
- Voz 100 % local (Fase 5B): Whisper en tu equipo (el audio no sale) y palabra de activación «Jarvis».
- 139 pruebas automatizadas (ver [TESTING.md](TESTING.md)).

## Instalar la app de escritorio en Windows 11

1. Instala **Node.js 22.13 o superior** (https://nodejs.org, versión LTS) y **Git** (https://git-scm.com).
2. En PowerShell:
   ```powershell
   git clone https://github.com/pabloskycurro15/openshorts.git
   cd openshorts
   git checkout claude/peaceful-maxwell-2nmkbw
   cd jarvis
   npm install
   npm run dist:win
   ```
3. Ejecuta `jarvis\apps\desktop\release\JARVIS-Setup-0.6.0.exe`. Windows SmartScreen avisará de que el
   instalador no está firmado: «Más información» → «Ejecutar de todas formas» (firmarlo requiere un certificado de pago).

Para probar sin instalar: `npm run desktop` (desde `jarvis/`).

## Activar el cerebro

1. Carga crédito en https://platform.claude.com/settings/billing (desactiva la recarga automática).
2. Crea una clave en https://platform.claude.com/settings/keys.
3. En JARVIS: **Configuración → Cerebro IA**, pega la clave y pulsa Guardar (se verifica sola, sin coste).

## Inicio rápido

```bash
cd jarvis
npm install
cp .env.example .env        # opcional
npm run dev                 # núcleo en http://127.0.0.1:7777
npm run dev:web             # interfaz en http://127.0.0.1:5180 (en otra terminal)
npm run desktop             # o bien: la app de escritorio (incluye núcleo e interfaz)
npm run check               # tipos + lint + pruebas
```

El token de acceso se genera en `.data/auth-token` en el primer arranque. La interfaz lo pide
la primera vez (pégalo en la pantalla de vinculación). También sirve para la API:

```bash
curl -H "Authorization: Bearer $(cat .data/auth-token)" http://127.0.0.1:7777/api/health
```

## Documentación

| Documento | Contenido |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Arquitectura, módulos, API y modelo de datos |
| [DECISIONS.md](DECISIONS.md) | Decisiones técnicas justificadas (ADR) |
| [REQUIREMENTS.md](REQUIREMENTS.md) | Requisitos, limitaciones de plataforma y costes |
| [SECURITY.md](SECURITY.md) | Modelo de seguridad y permisos |
| [ROADMAP.md](ROADMAP.md) | Fases y criterios de aceptación |
| [PROGRESS.md](PROGRESS.md) | Registro de tareas y progreso |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Convenciones y cómo crear módulos/herramientas |
| [TESTING.md](TESTING.md) | Estrategia y resultados reales de pruebas |
| [CHANGELOG.md](CHANGELOG.md) | Historial de cambios |
