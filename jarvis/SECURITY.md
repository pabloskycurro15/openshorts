# Seguridad de JARVIS

## Implementado (Fase 1) y probado

### Autenticación del núcleo
- Token aleatorio de 256 bits generado en el primer arranque en `<dataDir>/auth-token` con permisos `0600`.
- Todas las rutas salvo `/api/ping` lo exigen (`Authorization: Bearer`; en WebSocket, `?token=`).
- Comparación en tiempo constante (`timingSafeEqual`).
- El núcleo escucha solo en `127.0.0.1` por defecto.

### Principales y ámbitos
Principal = quién actúa: `user`, `core`, `module`, `agent`, `connector`, `automation`.
Ámbito = qué se toca: `accion.subaccion[:recurso]`, p. ej. `fs.read:C:/Users/Ana/Proyectos/x.txt`.
Las concesiones admiten comodín final (`fs.*`, `fs.read:C:/Users/Ana/Proyectos/*`).

### Reglas del motor de permisos
1. **Modo emergencia** → se deniega toda operación con efectos, de cualquier principal (incluido el usuario).
   También cancela las aprobaciones pendientes, y anula las que se aprueben después.
2. **Usuario** → puede actuar directamente; riesgo `high` y `critical` requieren confirmación.
3. **Resto de principales** → necesitan una concesión explícita para *cada* ámbito; si falta una, se deniega.
4. Con concesión, el riesgo `high`/`critical` **siempre** requiere confirmación.
5. **Sin escalada:** solo el usuario concede, revoca, resuelve aprobaciones o cambia el modo emergencia.
   Los intentos de otros principales se rechazan y quedan auditados como `permission.escalation_attempt`.

### Auditoría
- Tabla de solo inserción (triggers SQLite impiden UPDATE y DELETE).
- Cada entrada contiene el SHA-256 de la anterior; `GET /api/audit/verify` detecta cualquier manipulación,
  incluso si alguien elimina los triggers (probado).
- Se audita: arranque/parada, toda invocación de herramienta (con resultado), concesiones, revocaciones,
  aprobaciones y modo emergencia.

### Registros
El logger censura campos `token`, `apiKey`, `password`, `secret` y la cabecera `authorization`.

## Pendiente (con fase prevista)
| Medida | Fase |
|---|---|
| Almacén de credenciales cifrado (Windows DPAPI / Keychain de iOS) para claves de IA y conectores | 3 y 8 |
| Cuentas de usuario, contraseñas (Argon2id), sesiones y gestión de dispositivos | 10 |
| TLS y emparejamiento de dispositivos para acceso desde iPhone/PWA | 10 |
| Cifrado en reposo de datos sensibles y copias de seguridad cifradas con restauración verificada | 11 |
| Detección de operaciones sospechosas (frecuencia anómala, patrones) | 11 |
| Panel de emergencia en la interfaz (la API ya existe) | 2 |

## Normas para desarrolladores
- Nunca incluir claves en el código ni en `.env` versionados.
- Toda capacidad nueva con efectos se expone como herramienta con `risk`, `sideEffects` y `permissions` honestos.
- Las herramientas que reciben rutas deben normalizarlas (absolutas, sin `..`, resolviendo enlaces) **antes**
  de construir el ámbito.
- No ejecutar comandos construidos a partir de texto externo sin validación con lista blanca.

## Informar de vulnerabilidades
Abrir una incidencia privada en el repositorio o contactar con el propietario.
