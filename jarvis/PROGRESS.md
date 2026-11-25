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

## Decisiones tomadas por el usuario
- Cerebro: Claude Opus 5.5 (API de Anthropic, prepago de 5 $, sin recarga automática).

## Decisiones pendientes del usuario
- Voz premium (ElevenLabs) o solo voces gratuitas del sistema (Fase 4).
