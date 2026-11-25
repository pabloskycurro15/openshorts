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

### Credenciales (Fase 3)
- Almacén cifrado AES-256-GCM (`security/vault.ts`); clave maestra en `<dataDir>/vault.key` (0600).
- La clave API solo entra (`PUT /api/ai/key`); ninguna ruta la devuelve (probado: no aparece en estado, auditoría
  ni salud). La auditoría guarda solo los 4 últimos caracteres.

### Asistente conversacional (Fase 3)
- Actúa como `agent:jarvis`, nunca como el usuario. Sin concesión, pregunta en el chat; con «Aprobar siempre»
  queda una concesión revocable en Seguridad. Riesgo alto/crítico: siempre pregunta.
- Las salidas del modelo (argumentos de herramientas) se validan con zod antes de ejecutar nada.
- Límite de gasto y de pasos; el modo emergencia corta respuestas en curso y cancela confirmaciones.
- Las instrucciones de sistema obligan a la honestidad: no afirmar acciones no realizadas ni capacidades inexistentes.

### Voz y micrófono (Fase 4)
- El micrófono solo se abre por acción del usuario (o en manos libres, que el usuario activa y queda auditado).
- Indicador rojo en la barra superior y en el chat, con el servicio que procesa el audio.
- Auditoría: `voice.mic_on`, `voice.mic_off`, `voice.mic_denied`, `voice.handsfree_on/off`.
- Nada de audio continuo hacia fuera; sin palabra de activación en el navegador.
- ElevenLabs: clave cifrada en el núcleo, desactivado por defecto, contador de caracteres enviados.

### Control del equipo (Fase 5A)
- Listas blancas de carpetas (solo lectura o lectura/escritura), aplicaciones y comandos; solo el usuario las edita
  y cada cambio se audita.
- Protección de rutas frente a `..`, rutas absolutas externas y enlaces simbólicos (probado).
- Sin shell; argumentos fijos; tiempo máximo y salida recortada en comandos.
- Riesgos: leer bajo · crear medio · modificar/mover/borrar/cerrar apps/comandos alto (siempre confirmación).
- Papelera de JARVIS y copia previa a cualquier modificación.

### App de escritorio (Fase 5A)
- Ventana aislada sin Node; navegación externa bloqueada; CSP; token efímero; micrófono solo para JARVIS.
- Clave maestra con DPAPI (Windows). Modo emergencia accesible desde la bandeja.

### Voz local y palabra de activación (Fase 5B)
- Whisper se ejecuta en el equipo; el audio no se envía a ningún servicio. Solo se descargan los pesos del modelo.
- Con la palabra de activación el micrófono queda abierto: indicador naranja permanente, activación y detección
  auditadas (`voice.wake_on/off`, `voice.wake_detected`), desactivable en un clic. Las frases que no empiezan por
  «Jarvis» se descartan sin guardarse.
- CSP: `wasm-unsafe-eval` (WebAssembly) y conexión a Hugging Face solo para descargar el modelo.

### Varios proveedores (0.7)
- Claves de Anthropic, OpenAI y Google en el almacén cifrado; ninguna ruta las devuelve.
- Nivel gratuito de Google: puede usar las conversaciones para mejorar sus productos. Desactivable; y los mensajes
  con datos sensibles (contraseñas, banco, salud, documentos de identidad…) nunca se le envían.
- OpenAI en modo sin estado (`store: false`): no se guardan respuestas en sus servidores.

## Pendiente (con fase prevista)
| Medida | Fase |
|---|---|
| Clave maestra en iOS (Keychain) | 10 |
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
