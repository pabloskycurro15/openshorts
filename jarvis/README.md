# JARVIS

Asistente personal inteligente multimodal: núcleo local seguro, voz, memoria, agentes,
conectores, automatizaciones y control autorizado del ordenador, con clientes de
escritorio (Windows 11), iOS y PWA.

> **Estado actual: Fases 1 y 2 completadas (núcleo + interfaz).** Todavía no hay
> IA ni voz: ver [ROADMAP.md](ROADMAP.md) y [PROGRESS.md](PROGRESS.md).
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
- 49 pruebas automatizadas (ver [TESTING.md](TESTING.md)).

## Inicio rápido

```bash
cd jarvis
npm install
cp .env.example .env        # opcional
npm run dev                 # núcleo en http://127.0.0.1:7777
npm run dev:web             # interfaz en http://127.0.0.1:5180 (en otra terminal)
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
