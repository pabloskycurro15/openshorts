# Guía de desarrollo

## Requisitos
Node.js ≥ 22.13 (usa el SQLite integrado; no hace falta compilar nada).

## Comandos (desde `jarvis/`)
| Comando | Acción |
|---|---|
| `npm install` | Instala todo el monorepo |
| `npm run dev` | Núcleo con recarga automática |
| `npm run typecheck` | TypeScript estricto |
| `npm run lint` | ESLint, 0 avisos permitidos |
| `npm test` | Vitest |
| `npm run check` | Las tres anteriores (obligatorio antes de cada commit) |
| `npm run desktop` | Compila y abre la app de escritorio |
| `npm run dist:win` | Genera el instalador de Windows (ejecutar en Windows; también lo hace la CI `.github/workflows/jarvis.yml`) |
| `npx -w @jarvis/desktop electron-builder --win dir` | Desde Linux: carpeta portátil de Windows (el instalador NSIS necesita Wine). Antes, instalar `@img/sharp-win32-x64` de la misma versión que `sharp` (npm solo instala el binario del sistema actual). |

## Convenciones
- TypeScript estricto (`noUncheckedIndexedAccess`), ESM, `import type` para tipos.
- Nombres de código en inglés; textos para el usuario, comentarios y documentación en español de España.
- Nada de `console.*` en el núcleo: usar el `logger` del contexto.
- Commits: `tipo(ámbito): descripción` (`feat(core): …`, `fix(security): …`, `docs: …`).
- Migraciones: añadir una nueva al final de `MIGRATIONS`; nunca editar las existentes.

## Cómo crear un módulo
```ts
import type { JarvisModule } from '@jarvis/core';

export const weatherModule: JarvisModule = {
  manifest: { id: 'weather', name: 'Tiempo', version: '0.1.0', description: '…', dependsOn: [] },
  async start(ctx) {
    ctx.tools.register(/* herramientas del módulo */);
    ctx.bus.on('assistant.state', ({ state }) => ctx.logger.debug({ state }));
  },
  async stop() { /* liberar recursos */ },
};
```
Regístralo en `createJarvis(config, { extraModules: [weatherModule] })` o en `app.ts` si es interno.

## Cómo crear una herramienta
```ts
import { z } from 'zod';
import { defineTool } from '@jarvis/core';

export const readFileTool = defineTool({
  name: 'fs.read_file',
  description: 'Lee un archivo de texto dentro de una carpeta autorizada.',
  parameters: z.object({ path: z.string() }),
  permissions: ({ path }) => [`fs.read:${normalize(path)}`], // normalizar SIEMPRE antes
  risk: 'low',
  sideEffects: false,
  risks: ['Puede exponer contenido del archivo al modelo de IA'],
  returns: 'El contenido del archivo como texto.',
  execute: async ({ path }, ctx) => { /* … */ },
});
```
Reglas: `risk` y `sideEffects` deben ser honestos; las acciones destructivas o irreversibles son `high` o
`critical` y siempre pedirán confirmación.
