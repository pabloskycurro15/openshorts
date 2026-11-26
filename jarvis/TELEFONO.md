# Hablar con JARVIS por teléfono

JARVIS puede **llamarte** (buenos días, recordatorios, avisos si algo va mal) y **conversar** contigo, y tú
puedes **llamarle** a su número. Funciona con Twilio (telefonía) y un túnel HTTPS gratuito hacia tu PC.

## 1. Twilio (10 min, prueba gratis)
1. Crea una cuenta en twilio.com (trae unos 15 $ de saldo de prueba).
2. **Verified Caller IDs** → añade tu móvil y confirma el código que te llega por SMS.
3. **Phone Numbers → Buy a number** → coge el número gratuito de la prueba (con «Voice»).
4. Copia el **Account SID** y el **Auth Token** (Account Info, en la portada de la consola).

## 2. Túnel para poder conversar (5 min, gratis)
Sin túnel, JARVIS solo puede llamarte y decirte algo (sin escucharte).
1. Instala **Tailscale** en el PC e inicia sesión.
2. En una terminal del PC:
   `tailscale funnel --bg --https=8443 --set-path /phone http://127.0.0.1:7777/phone`
3. Tailscale te enseña una dirección como `https://tu-pc.tailxxxx.ts.net:8443`. Solo la parte del teléfono
   queda accesible desde Internet, y JARVIS comprueba la firma de Twilio en cada petición.

## 3. En JARVIS
1. **Conectores → Llamadas de teléfono**: Account SID, Auth Token, número de Twilio, tu móvil, la dirección
   del paso 2 y un **PIN** (para cuando le llames tú). Activar.
2. **Llamada de prueba** → contesta y pregúntale algo («¿qué tiempo hace hoy?»). Di «adiós» para colgar.
3. **Recibir mis llamadas** → a partir de ahí, llama al número de Twilio, marca el PIN y habla con él.
4. **Automatizaciones → «Buenos días por teléfono»** → cambia TU_CIUDAD → Guardar y activar (7:15 cada día).

## Costes y límites
- Prueba gratuita: las llamadas empiezan con un aviso de Twilio en inglés y solo llama a números verificados.
- Después: número ~1-3 $/mes, llamada ~0,02-0,10 $/min y reconocimiento de voz ~0,02 $ cada 15 s.
- Gemini responde gratis. Máximo 6 llamadas al día hechas por JARVIS.
- Cada respuesta tarda 2-4 segundos (Twilio transcribe, JARVIS piensa, Twilio habla).
- Lo que necesite tu confirmación (enviar, publicar, borrar…) no se hace por teléfono: queda pendiente en la app.
- El PC tiene que estar encendido con JARVIS abierto.
