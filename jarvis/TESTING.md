# Pruebas

## Estrategia
- **Unitarias / integración (Vitest):** cada módulo del núcleo, con base de datos SQLite en memoria.
- **API:** `fastify.inject` para HTTP y un servidor real en puerto efímero para WebSocket.
- **Manual / extremo a extremo:** arranque real del núcleo y peticiones `curl`.
- Fases futuras: pruebas de componentes de UI, capturas con Playwright, pruebas en Windows real.

## Resultados reales (2026-11-25, Linux x64, Node 22.23)

`npm run check` → typecheck OK, lint OK (0 avisos), **39/39 pruebas superadas**.

| Archivo | Pruebas | Cubre |
|---|---|---|
| `kernel.test.ts` | 7 | Bus de eventos (entrega, desuscripción, aislamiento de errores); módulos (orden, ciclos, ausentes, duplicados, fallos aislados) |
| `security.test.ts` | 17 | Coincidencia de ámbitos (9 casos); reglas del motor de permisos; no escalada; emergencia; auditoría (cadena, solo inserción, detección de manipulación) |
| `tools.test.ts` | 8 | `system.info` real; validación; denegación; flujo de aprobación; denegar; emergencia frente a aprobaciones; permisos por recurso; auditoría |
| `server.test.ts` | 7 | Token obligatorio; health; listado e invocación; 400 ante cuerpo no válido; emergencia; WebSocket con y sin token; token local 0600 |

Prueba manual con el servidor real: `/api/ping` 200, sin token 401, `/api/health` ok, `system.info` con datos
reales del equipo, `/api/audit/verify` → `{"ok":true}`.

## No probado todavía
- Ejecución en Windows 11 (se validará en la Fase 5 en un equipo Windows; este entorno es Linux).
