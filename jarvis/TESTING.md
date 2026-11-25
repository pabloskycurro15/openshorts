# Pruebas

## Estrategia
- **Unitarias / integración (Vitest):** cada módulo del núcleo, con base de datos SQLite en memoria.
- **API:** `fastify.inject` para HTTP y un servidor real en puerto efímero para WebSocket.
- **Manual / extremo a extremo:** arranque real del núcleo y peticiones `curl`.
- Fases futuras: pruebas de componentes de UI, capturas con Playwright, pruebas en Windows real.

## Resultados reales (2026-11-25, Linux x64, Node 22.23)

`npm run check` → typecheck OK (núcleo y web), lint OK (0 avisos), **49/49 pruebas superadas**.

| Archivo | Pruebas | Cubre |
|---|---|---|
| `kernel.test.ts` | 7 | Bus de eventos (entrega, desuscripción, aislamiento de errores); módulos (orden, ciclos, ausentes, duplicados, fallos aislados) |
| `security.test.ts` | 17 | Coincidencia de ámbitos (9 casos); reglas del motor de permisos; no escalada; emergencia; auditoría (cadena, solo inserción, detección de manipulación) |
| `tools.test.ts` | 8 | `system.info` real; validación; denegación; flujo de aprobación; denegar; emergencia frente a aprobaciones; permisos por recurso; auditoría |
| `server.test.ts` | 8 | Token obligatorio; health; listado e invocación; 400 ante cuerpo no válido; emergencia; revocación de permisos; WebSocket con y sin token; token local 0600 |
| `apps/web/test/web.test.tsx` | 9 | 15 secciones con ids únicos y plan para las futuras; 8 estados del núcleo visual; utilidades; almacenamiento tolerante a fallos; App con núcleo simulado: pantalla de vinculación, panel con 15 secciones, reacción a eventos (estado y emergencia), secciones futuras honestas, token caducado |

### Prueba en navegador real (Playwright + Chromium, núcleo y web arrancados)
- Token incorrecto → mensaje «Token incorrecto»; token correcto → panel «Núcleo en línea».
- Recorrido por Inicio, Monitor, Seguridad, Historial, Comandos, Laboratorio, Configuración, Notificaciones y Memoria.
- Centro de comandos: ejecución real de `system.info` → «Correcto».
- Seguridad: activar emergencia (con doble confirmación) → banner y bloqueo; verificación de auditoría → «Íntegro»; desactivar.
- Laboratorio: estados Escuchando, Respondiendo y Error.
- Móvil 390×844: sin desbordamiento horizontal, menú lateral desplegable, **0 errores de consola**.

Prueba manual con el servidor real: `/api/ping` 200, sin token 401, `/api/health` ok, `system.info` con datos
reales del equipo, `/api/audit/verify` → `{"ok":true}`.

## No probado todavía
- Ejecución en Windows 11 (se validará en la Fase 5 en un equipo Windows; este entorno es Linux).
- Safari/iOS (Fase 10).
