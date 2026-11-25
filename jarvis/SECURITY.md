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

### Memoria (Fase 6)
- Todo en local (SQLite y modelo de significado); los textos no salen del equipo salvo cuando el modelo de IA los
  recibe al buscar (y lo personal solo con permiso explícito cada vez).
- El usuario ve, edita y borra todo lo que JARVIS recuerda; las deducciones quedan como sugerencias.
- Detección de datos sensibles al guardar; auditoría sin contenido.

### Multiagente (Fase 7)
- Identidad propia por agente, herramientas acotadas, permisos independientes y sin escalada.
- Herramienta fuera de la lista de un agente → denegada aunque el modelo la pida.
- Emergencia: cancela tareas en curso y bloquea la creación de nuevas.

### Conectores (Fase 8)
- Apagados por defecto; solo el usuario los configura y activa (la activación prueba las credenciales).
  Los no oficiales (WhatsApp) exigen además marcar «Entiendo los riesgos».
- Credenciales en el almacén cifrado (`connector.<id>.<campo>`); nunca salen por la API (solo «configurado»).
- Sus herramientas no existen (ni se ofrecen a la IA) mientras el conector está apagado.
- Riesgos: leer = bajo/medio (pide permiso), publicar una issue o una web = alto (confirma cada vez), enviar un
  WhatsApp = crítico (confirma siempre, aunque se haya «aprobado siempre») con máximo 15 por hora.
- Netlify solo publica carpetas autorizadas; la ruta se valida antes de pedir confirmación.
- Órdenes remotas: Telegram solo desde el chat autorizado por el usuario; WhatsApp solo desde «Mensaje a ti mismo»
  y nunca desde mensajes de otras personas. Las respuestas de JARVIS llevan prefijo y se ignoran (sin bucles).
  Las acciones con efectos siguen necesitando confirmación en la app. En emergencia no se ejecutan órdenes remotas.
- WhatsApp: los mensajes recibidos solo se guardan en memoria (no en disco); la sesión de vinculación está en
  `dataDir/whatsapp-session` (permisos 0700) y se borra al desvincular.
- Registro de actividad por conector (`connector_log`) además de la auditoría encadenada.
- Google: OAuth con cliente propio del usuario, PKCE S256 y «state» aleatorio de un solo uso (10 min); la vuelta
  (`/oauth/google/callback`) es la única ruta sin token de JARVIS y solo acepta un «state» emitido por el núcleo;
  página de respuesta con CSP `default-src 'none'`. Permisos mínimos (Gmail lectura + redactar, eventos de
  Calendar, Drive lectura + archivos creados por JARVIS). Token de actualización cifrado; el de acceso solo en
  memoria; «Desconectar» lo revoca en Google. Enviar correo = crítico (siempre confirma, 20/h); por defecto JARVIS
  prepara borradores.

### Dispositivos y acceso remoto (Fase 10)
- Sin contraseñas: vincular requiere un código de 8 caracteres (alfabeto sin ambigüedades, ~40 bits) generado en
  un dispositivo ya autorizado; válido 10 min, un solo uso, 5 intentos. Cada dispositivo recibe un token de
  256 bits; en la base de datos solo se guarda su SHA-256. Revocación individual inmediata.
- Freno de fuerza bruta: 10 fallos (token o código) desde una IP en 10 min → 429 durante 10 min.
- El núcleo solo escucha en 127.0.0.1. «Red local» abre un segundo puerto en 0.0.0.0 (HTTP sin cifrar; aviso al
  activarlo). Para fuera de casa se recomienda Tailscale (`tailscale serve`): HTTPS y red privada, nada expuesto.
- CORS solo para la app nativa (`capacitor://localhost`); la web la sirve el propio núcleo (mismo origen).
- Push: claves VAPID propias (privada cifrada en el almacén); solo título y texto breve; solo servicios push de
  navegadores (Apple, Google, Mozilla, Microsoft); las suscripciones caducadas se borran.
- El service worker nunca guarda en caché la API ni datos: solo los archivos de la interfaz.
- App iOS: ATS solo permite HTTP hacia la red local (`NSAllowsLocalNetworking`).

### Automatizaciones (Fase 9)
- Solo el usuario crea, edita, activa, ejecuta y borra; JARVIS y los agentes solo proponen (quedan desactivadas).
- Identidad `automation:<id>`; al activar, el usuario ve y concede exactamente los permisos de las herramientas
  elegidas (y los del disparador). Editar retira los permisos; borrar los revoca.
- Riesgo alto o crítico: la ejecución se detiene, avisa y espera la confirmación (caduca a los 10 min).
- Una automatización no puede crear automatizaciones ni encargar tareas a agentes (sin escalada encadenada).
- Con IA: intervalo mínimo 30 min y límite diario de ejecuciones (coste acotado; además del presupuesto mensual).
- Reintentos solo si la ejecución fallida no llegó a hacer nada con efectos.
- Emergencia: cancela las ejecuciones en curso y omite las nuevas.

## Pendiente (con fase prevista)
| Medida | Fase |
|---|---|
| Clave maestra en iOS (Keychain) | 10 |
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
