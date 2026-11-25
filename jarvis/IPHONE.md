# JARVIS en el iPhone

El cerebro de JARVIS (núcleo) vive en tu PC. El iPhone es otra pantalla para el mismo JARVIS: misma memoria,
conversaciones, tareas y automatizaciones, sin copias ni sincronización (todo se guarda en el PC).

## Opción recomendada: app web instalable (PWA) — gratis, sin Mac
1. **Conexión segura (HTTPS) con Tailscale** (gratis para uso personal; no expone nada a Internet):
   - Instala Tailscale en el PC y en el iPhone e inicia sesión con la misma cuenta.
   - En el PC, abre una terminal y ejecuta `tailscale serve --bg 7777` (el puerto del núcleo).
   - Tailscale te da una dirección como `https://mi-pc.tailxxxx.ts.net`. Pégala en JARVIS → Seguridad y
     permisos → Dispositivos → «Fuera de casa, con HTTPS».
2. En JARVIS (PC) → Seguridad y permisos → Dispositivos → **Vincular un dispositivo**.
3. Escanea el QR con la cámara del iPhone → se abre JARVIS con el código ya puesto → «Vincular».
4. En Safari: Compartir → **Añadir a pantalla de inicio**. Ábrelo desde el icono.
5. Dentro de la app: Seguridad → Dispositivos → Notificaciones → **Activar** (iOS 16.4 o superior).

Solo en casa y sin HTTPS: activa «Acceso desde la red local» y usa la dirección `http://IP-del-PC:7778`.
Funciona en Safari, pero iOS no permite instalarla ni recibir notificaciones sin HTTPS.

## Opción app nativa (Capacitor) — necesita un Mac con Xcode
El proyecto está en `apps/mobile` (Capacitor 8, plataforma iOS ya generada).
```bash
npm install
npm run ios:sync          # compila la interfaz y la copia al proyecto de Xcode
npm run open -w @jarvis/mobile   # abre Xcode
```
En Xcode: elige tu equipo (Signing & Capabilities) y ejecuta en tu iPhone. Con una cuenta de Apple gratuita la
app caduca a los 7 días; para TestFlight/App Store hace falta el Apple Developer Program (99 $/año) — no se ha
contratado nada. Al abrirla pide la dirección del núcleo (p. ej. `http://192.168.1.20:7778` en casa o la de
Tailscale) y el código de vinculación. Por ahora la app nativa no recibe notificaciones push (necesitaría APNs);
la PWA sí.

## Seguridad
- Vincular exige un código de 8 caracteres que solo se ve en un dispositivo ya autorizado (10 min, un solo uso,
  5 intentos). Cada dispositivo tiene su propia llave; puedes retirarla en cualquier momento.
- Tras 10 fallos de autenticación desde una IP, se bloquea 10 minutos.
- Las acciones de riesgo siguen pidiendo confirmación, también desde el móvil.
