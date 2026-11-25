# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado semántico.

## [0.5.0] — 2026-11-25
### Añadido
- App de escritorio (Electron 45): núcleo integrado, conexión automática, DPAPI, bandeja, Ctrl+Alt+J, inicio con
  Windows, ventana aislada; empaquetado con electron-builder (instalador NSIS para Windows).
- Control del equipo con listas blancas: archivos, aplicaciones, navegador, comandos, procesos y ventanas.
- Sección «Archivos y proyectos» (carpetas, explorador, aplicaciones, comandos); Monitor con uso real de CPU y
  procesos.
- El núcleo puede servir la interfaz (`JARVIS_WEB_DIR`) con CSP.
- 20 pruebas nuevas (126 en total); prueba de la app real y empaquetada con Playwright + Electron.

### Cambiado
- Base de datos: `node:sqlite` en lugar de better-sqlite3 (sin módulos nativos). Requiere Node ≥ 22.13.

## [0.4.0] — 2026-11-25
### Añadido
- Voz: micrófono al pulsar con indicador y auditoría, respuestas habladas frase a frase, interrupción, manos
  libres, modo discreto, lectura de avisos, ajustes de voz/velocidad/tono/volumen.
- ElevenLabs preparado a través del núcleo (desactivado por defecto) con contador de caracteres.
- Migración 3 (`voice_usage`).
- 15 pruebas nuevas (106 en total) y prueba de voz en navegador real.

### Corregido
- El troceado de frases podía cortar dentro de un bloque de código.

## [0.3.0] — 2026-11-25
### Añadido
- Cerebro IA: capa de proveedores, adaptador Anthropic (SDK oficial, streaming, respaldo automático, caché),
  Opus 5.5 por defecto, Sonnet 5.5 y Haiku 5.5 seleccionables, nivel de razonamiento configurable.
- Motor de conversación con herramientas, confirmaciones en el chat, límite de pasos y cancelación.
- Almacén de credenciales cifrado; control de gasto mensual con aviso y bloqueo.
- Herramienta `system.datetime`.
- Interfaz: sección Conversación, panel Cerebro IA en Configuración, gasto del mes en Inicio, «Aprobar siempre».
- 42 pruebas nuevas (91 en total) y prueba en navegador contra API simulada.

### Corregido
- Carrera en la espera de confirmaciones: una decisión muy rápida podía darse por perdida.

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
