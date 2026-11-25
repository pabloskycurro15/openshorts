# Hoja de ruta

Cada fase solo se da por terminada cuando cumple sus criterios de aceptación **verificados**.

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Arquitectura, núcleo, seguridad base, API, documentación | ✅ Completada |
| 2 | Interfaz: identidad naranja/azul oscuro, núcleo visual, navegación, 15 secciones, temas | ⏳ Siguiente |
| 3 | Cerebro IA: proveedores, conversación, contexto, uso de herramientas | Pendiente |
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

### Fase 2 (propuesta)
- App `apps/web` con React + Vite + Tailwind, tokens de color naranja/azul oscuro.
- Núcleo visual animado (Canvas/WebGL ligero) con los 8 estados, conectado al WebSocket.
- Navegación con las 15 secciones; las que dependen de fases futuras muestran claramente "disponible en la Fase N".
- Secciones ya funcionales con datos reales: Inicio (estado y monitor), Monitor del ordenador, Seguridad y
  permisos (aprobaciones, concesiones, emergencia), Historial (auditoría).
- Diseño adaptable (escritorio y móvil), `prefers-reduced-motion`, pausa en segundo plano.
- Pruebas de componentes y captura visual verificada.
