# Manual de JARVIS

## 1. Instalar y abrir
- **Windows:** ejecuta `JARVIS-Setup-x.y.z.exe` (o descomprime la versión portátil y abre `JARVIS.exe`). Al no
  estar firmado, Windows puede avisar: «Más información» → «Ejecutar de todas formas». JARVIS queda en la bandeja
  del sistema; **Ctrl+Alt+J** lo muestra.
- **iPhone:** ver [IPHONE.md](IPHONE.md).

## 2. Primeros pasos
1. **Configuración → Cerebro:** pega una clave de IA. Gemini es gratis (aistudio.google.com/apikey). Deja el modo
   «Automático»: reparte cada tarea al modelo más barato que la resuelva bien. Fija el límite de gasto mensual.
2. **Archivos y proyectos:** autoriza las carpetas con las que JARVIS puede trabajar (solo lectura o escritura).
3. **Configuración → Copias de seguridad:** define una frase y activa la copia diaria.
4. Habla («Jarvis…») o escribe en **Inicio** o **Conversación**.

## 3. Qué puede hacer
| Pídele… | Cómo lo hace |
|---|---|
| «Resúmeme el correo de hoy» / «¿Qué tengo mañana?» | Gmail y Calendar (conector Google) |
| «Pon música para concentrarme» | Spotify |
| «Crea un Short con estas fotos y súbelo a YouTube como privado» | Estudio de vídeo (FFmpeg) + YouTube |
| «Diseña una miniatura» | Conectores → Adobe Express → Abrir editor (lo diseñas tú; se guarda en tu carpeta) |
| «Mira si me han escrito en Vinted» | Vinted (experimental) o avisos por correo |
| «Busca bares en Nerja sin web y prepara una propuesta» | Centro de tareas: varios agentes |
| «Cada mañana a las 8 mándame un resumen por Telegram» | JARVIS lo propone en Automatizaciones; tú lo activas |
| «Abre Spotify», «Cierra el Bloc de notas», «¿Cuánta CPU uso?» | Control del equipo (lista blanca) |
| «Recuerda que mi cliente X prefiere llamadas» | Memoria |

## 4. Seguridad: lo que conviene saber
- Todo lo que tenga efectos (enviar, publicar, borrar, instalar) **te pide confirmación**; lo crítico, siempre.
- **Modo emergencia** (Seguridad y permisos): corta todo al instante. Se activa solo ante actividad sospechosa.
- Cada agente, automatización y dispositivo tiene **sus propios permisos**; puedes revocarlos en Seguridad.
- Las claves se guardan **cifradas** en tu PC; nunca salen por la API ni se suben a ningún sitio.
- **Historial:** todo queda en un registro de auditoría que no se puede alterar sin que se note.

## 5. Mantenimiento
- **Configuración → Diagnóstico:** 12 comprobaciones; «Copiar informe» no incluye claves.
- **Restaurar una copia:** Copias → Restaurar → reinicia JARVIS. Para otro PC, copia el `.jarvisbak` a la carpeta
  de copias y usa tu frase.
- **Actualizaciones:** Diagnóstico → «Buscar actualizaciones».

## 6. Costes
JARVIS no contrata nada por su cuenta. Lo único que puede costar dinero: la IA de pago (con tu límite mensual),
ElevenLabs (desactivado), Spotify Premium (tuyo), y opcionalmente Apple Developer o un certificado de firma.
