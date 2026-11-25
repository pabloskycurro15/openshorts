# Hoja de ruta

Cada fase solo se da por terminada cuando cumple sus criterios de aceptación **verificados**.

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Arquitectura, núcleo, seguridad base, API, documentación | ✅ Completada |
| 2 | Interfaz: identidad naranja/azul oscuro, núcleo visual, navegación, 15 secciones, temas | ✅ Completada |
| 3 | Cerebro IA: proveedores, conversación, contexto, uso de herramientas, control de presupuesto | ⏳ Siguiente |
| 4 | Voz: STT, TTS, palabra de activación local, interrupción, conversación continua | Pendiente |
| 5 | Control de Windows (Electron + PowerShell/UI Automation) | Pendiente |
| 6 | Memoria: categorías, búsqueda híbrida FTS5 + vectores, administración | Pendiente |
| 7 | Multiagente: coordinador, agentes especializados, supervisión | Pendiente |
| 8 | Conectores: extensiones, almacén de credenciales, integraciones prioritarias | Pendiente |
| 9 | Automatizaciones: motor, programador, rutinas, historial | Pendiente |
| 10 | iOS (Capacitor) y PWA, autenticación, sincronización | Pendiente |
| 11 | Seguridad avanzada y mantenimiento: cifrado, copias, diagnóstico, actualizaciones | Pendiente |
| 12 | Validación integral, instalador Windows, compilación iOS, despliegue PWA | Pendiente |

## Criterios de aceptación

### Fase 1 ✅
- [x] Monorepo con TypeScript estricto, ESLint (0 avisos) y Vitest.
- [x] Contratos compartidos con zod.
- [x] Registro de módulos con dependencias, detección de ciclos y aislamiento de fallos.
- [x] Motor de permisos con mínimo privilegio, confirmaciones y sin escalada.
- [x] Registro de herramientas con validación, aprobaciones y auditoría.
- [x] Auditoría de solo inserción con verificación de integridad.
- [x] API REST + WebSocket autenticada; modo emergencia.
- [x] Núcleo arrancado y probado con peticiones reales.
- [x] Documentación inicial completa.

### Fase 2 ✅
- [x] App `apps/web` con React + Vite + Tailwind, tokens de color naranja/azul oscuro.
- [x] Núcleo visual animado (Canvas 2D) con los 8 estados, conectado al WebSocket.
- [x] Navegación con las 15 secciones; las de fases futuras lo indican claramente, sin datos inventados.
- [x] Secciones con datos reales: Inicio, Monitor, Seguridad (aprobaciones, permisos, emergencia,
      verificación de auditoría), Historial, Notificaciones, Laboratorio, Centro de comandos, Configuración.
- [x] Personalización: color de acento, intensidad de animación, rejilla, partículas.
- [x] Diseño adaptable (escritorio y móvil, sin desbordamiento horizontal), `prefers-reduced-motion`,
      pausa en segundo plano y fuera de pantalla.
- [x] Pruebas de componentes y prueba en navegador real con capturas.

### Fase 3 (propuesta)
- Adaptador Anthropic (Claude Opus 5.5 por defecto) tras la interfaz `AIProvider`; Sonnet/Haiku seleccionables.
- Almacén de credenciales cifrado para la clave API (nunca en el código ni en texto plano).
- Conversación en streaming en la sección Conversación, con contexto y uso de herramientas vía `ToolRegistry`.
- Control de presupuesto: contador de gasto, aviso al 80 %, bloqueo al 100 % del límite mensual.
- Estados del núcleo visual dirigidos por la IA (pensando, respondiendo, ejecutando).
