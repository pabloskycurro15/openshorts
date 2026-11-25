import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// SQLite integrado de Node 22 avisa de que es experimental; en Node 24/Electron ya es estable.
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --disable-warning=ExperimentalWarning`.trim();

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'core', include: ['packages/*/test/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'desktop', include: ['apps/desktop/test/**/*.test.ts'], environment: 'node' } },
      {
        plugins: [react()],
        test: { name: 'web', include: ['apps/web/test/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['apps/web/test/setup.ts'] },
      },
    ],
  },
});
