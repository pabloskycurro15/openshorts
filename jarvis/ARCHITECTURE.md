# Arquitectura de JARVIS

## Visión general

```
┌──────────────── Clientes ────────────────┐
│  Escritorio (Electron)   PWA    iOS (Capacitor)  │   ← misma UI React (apps/web)
└──────────────┬───────────────────────────┘
               │ REST + WebSocket (contratos @jarvis/shared, token)
┌──────────────▼──────────── Núcleo local (@jarvis/core) ─────────────────────┐
│  API (Fastify)                                                              │
│  ┌────────── Kernel ──────────┐  ┌──────── Seguridad ────────┐              │
│  │ EventBus · ModuleRegistry  │  │ PermissionEngine          │              │
│  │ Config · Logger            │  │ Approvals · AuditLog      │              │
│  └────────────────────────────┘  │ Auth · (Vault, Fase 8/11) │              │
│  ┌────────── ToolRegistry (única puerta de acción) ─────────┐              │
│  └───────────────────────────────────────────────────────────┘              │
│  Módulos: system ✔ · ai · voice · memory · agents · connectors ·            │
│           automations · windows-control · sync · backup                      │
│  Persistencia: SQLite (WAL) + FTS5 (+ sqlite-vec en Fase 6)                  │
└──────────────┬──────────────────────────────────────────────────────────────┘
               │ (solo con autorización y coste aprobado)
     Proveedores de IA · TTS/STT · APIs de conectores · nube de sincronización
```

✔ = implementado. El resto son módulos previstos con interfaz definida en las fases indicadas en ROADMAP.md.

## Principios

1. **Toda acción pasa por una herramienta.** La IA, los agentes, las automatizaciones y los
   conectores nunca ejecutan código directamente: invocan `ToolRegistry.invoke()`, que valida
   argumentos (zod), comprueba permisos, pide confirmación si procede y audita el resultado.
2. **Módulos desacoplados.** Cada módulo declara un manifiesto (`id`, `version`, `dependsOn`) y
   recibe un `ModuleContext` con los servicios del núcleo. Se comunican por el `EventBus` o
   registrando herramientas, nunca importándose entre sí. Las dependencias circulares se detectan
   al arrancar.
3. **Contratos compartidos.** Todo lo que cruza la red se define en `@jarvis/shared` con zod y se
   valida en ambos extremos.
4. **Independencia de proveedor.** `ai/provider.ts` define `AIProvider`; voz, sincronización y
   conectores seguirán el mismo patrón (interfaz + adaptadores).
5. **Fallos aislados.** Un módulo que falla queda en estado `failed`, sus dependientes no arrancan
   y el resto del sistema sigue funcionando (estado `degraded` en `/api/health`).

## Estructura de carpetas

```
jarvis/
├── packages/
│   ├── shared/          Contratos zod y tipos (estados, eventos, permisos, API)
│   └── core/
│       ├── src/
│       │   ├── kernel/      events, modules, config, logger
│       │   ├── security/    permissions, audit, auth
│       │   ├── tools/       registry + builtin/ (system)
│       │   ├── storage/     SQLite y migraciones
│       │   ├── ai/          interfaz de proveedores (Fase 3)
│       │   ├── server/      API REST + WebSocket
│       │   ├── app.ts       composición del núcleo
│       │   └── main.ts      punto de entrada
│       └── test/
└── apps/                (Fase 2+) web (React/PWA), desktop (Electron), ios (Capacitor)
```

## API (v1)

Todas las rutas salvo `/api/ping` requieren `Authorization: Bearer <token>`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/ping` | Comprobación pública de vida |
| GET | `/api/health` | Versión, uptime, modo emergencia, estado de módulos |
| GET | `/api/modules` | Módulos registrados |
| GET | `/api/tools` | Herramientas con JSON Schema, permisos y riesgos |
| POST | `/api/tools/invoke` | `{tool, args}` → `ok` / `pending_approval` / `denied` / `error` |
| GET | `/api/approvals?status=` | Solicitudes de confirmación |
| GET | `/api/approvals/:id` | Detalle y resultado |
| POST | `/api/approvals/:id` | `{decision: approved|denied}` |
| GET | `/api/permissions` | Concesiones vigentes |
| GET | `/api/audit?limit=&before=` | Auditoría paginada |
| GET | `/api/audit/verify` | Verifica la cadena de hashes |
| POST | `/api/emergency` | `{lockdown: bool}` — bloqueo total de operaciones con efectos |
| WS | `/api/events?token=` | Flujo de eventos (`assistant.state`, `approval.*`, `tool.invoked`...) |

## Modelo de datos (migración 1)

- `audit_log` — solo inserción (triggers impiden UPDATE/DELETE), `prev_hash` + `hash` SHA-256.
- `permission_grants` — (principal, ámbito, modo `allow|ask`).
- `approvals` — solicitudes de confirmación y su estado.
- `settings` — clave/valor (p. ej. `security.lockdown`).

Las migraciones se versionan con `PRAGMA user_version` y nunca se editan una vez publicadas.

## Flujo de una invocación

```
invoke(principal, tool, args)
  → ¿existe? → validar args (zod) → calcular ámbitos (pueden depender de args)
  → PermissionEngine.check
       deny  → auditar 'denied'
       ask   → crear aprobación (TTL 10 min) → evento approval.requested → auditar 'pending'
                 usuario aprueba → (re-comprobar emergencia) → ejecutar → auditar
       allow → ejecutar → auditar 'success' / 'failure'
```
