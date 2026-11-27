# JARVIS en Mac (Apple Silicon: M1…M5)

La versión de Mac es la misma app que la de Windows, con lo propio de macOS: claves en el **Llavero**, icono en
la **barra de menús**, atajo **⌘⌥J**, control de ventanas con AppleScript y programas con **Homebrew**.

## 1. Conseguir la app (una vez)
La genera GitHub en un Mac de los suyos (gratis, el repositorio es público):
1. En github.com/pabloskycurro15/openshorts → pestaña **Actions** → «I understand my workflows, go ahead and
   enable them» (solo la primera vez).
2. Abre la última ejecución de **JARVIS** → al final, en **Artifacts**, descarga **JARVIS-Mac** (contiene el
   `.dmg`).
3. Abre el `.dmg` y arrastra **JARVIS** a **Aplicaciones**.

## 2. Abrirla la primera vez
La app no está firmada por Apple (eso cuesta 99 $/año y no se ha contratado):
- **Clic derecho sobre JARVIS → Abrir → Abrir.** Solo la primera vez.
- Si macOS dice que «está dañada» (pasa con apps descargadas sin firma de Apple): abre **Terminal** y escribe
  `xattr -cr /Applications/JARVIS.app`, y vuelve a abrirla.
- Permisos que pedirá (acepta los que vayas a usar): **Micrófono** (hablarle), **Accesibilidad** y
  **Automatización** (Ajustes del Sistema → Privacidad y seguridad), solo si quieres que maneje ventanas y apps.

## 3. Pasar todo desde el PC (5 minutos)
En el **PC**, antes de cambiar:
1. JARVIS → Configuración → Copias de seguridad → marca «Incluir la sesión de WhatsApp» → **Hacer una copia
   ahora**.
2. Copia el archivo `.jarvisbak` (la carpeta aparece en ese panel) a un USB o a tu nube.

En el **Mac**:
1. Abre JARVIS una vez y ciérralo (crea sus carpetas).
2. JARVIS → Configuración → Copias de seguridad: ahí verás la **carpeta de copias**; pon dentro el `.jarvisbak`.
3. Pulsa **Restaurar** en esa copia, escribe tu **frase** y reinicia JARVIS.
   Vuelven conversaciones, memoria, automatizaciones, claves (cifradas), dispositivos y WhatsApp.
4. Vuelve a autorizar las **carpetas** con rutas de Mac (`/Users/tú/...`) en Archivos y proyectos: las de
   Windows (`C:\...`) no existen en el Mac.

## 4. Que funcione siempre (buenos días a las 7:15, WhatsApp…)
- Menú de JARVIS en la barra de menús → **Abrir al iniciar sesión** y **Mantener el equipo despierto** (activado
  por defecto en Mac).
- **Un portátil con la tapa cerrada se duerme** y JARVIS se para. Opciones:
  - Dejarlo enchufado y abierto por la noche (o con monitor externo, en modo «tapa cerrada»).
  - **Recomendado:** dejar el PC de Windows encendido en casa como «servidor» de JARVIS y usar el Mac y el iPhone
    como pantallas vinculadas (Seguridad → Dispositivos → Vincular). Así funciona 24 h.

## 5. Lo que cambia respecto a Windows
| | Windows | Mac |
|---|---|---|
| Atajo para mostrarlo | Ctrl+Alt+J | ⌘⌥J |
| Dónde vive | Bandeja junto al reloj | Barra de menús (arriba) |
| Claves cifradas con | DPAPI | Llavero |
| Abrir una app autorizada | `notepad.exe` | comando `open`, argumentos `-a` y `Safari` |
| Cerrar una app | por proceso (`notepad.exe`) | por nombre (`Safari`), cierre ordenado |
| Ventanas | todas | una por aplicación (traer al frente, minimizar) |
| Instalar FFmpeg, VLC, OBS… | winget | Homebrew (brew.sh, gratis) |
| Llamadas (Twilio + Tailscale) | igual | igual (`tailscale funnel` desde Terminal) |

## 6. Bonus: la app nativa de iPhone
Con el Mac ya puedes compilarla (necesitas Xcode, gratis en la App Store):
```bash
cd jarvis && npm install && npm run ios:sync && npm run open -w @jarvis/mobile
```
En Xcode elige tu iPhone y pulsa ▶. Con tu Apple ID gratuito dura 7 días (luego se vuelve a instalar igual).

## Estado
Preparado y probado con un macOS **simulado** (AppleScript, Homebrew, rutas de Mac). Las pruebas reales en
macOS y el `.dmg` los hace GitHub Actions cuando lo actives. Si algo falla en tu Mac, una captura y se arregla.
