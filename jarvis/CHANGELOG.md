# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado semántico.

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
