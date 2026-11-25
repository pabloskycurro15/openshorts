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

## Decisiones pendientes del usuario
- Proveedor de IA por defecto para la Fase 3 (implica coste).
- Voz premium (ElevenLabs) o solo voces gratuitas del sistema.
