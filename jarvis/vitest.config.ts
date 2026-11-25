import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'core', include: ['packages/*/test/**/*.test.ts'], environment: 'node' } },
      {
        plugins: [react()],
        test: { name: 'web', include: ['apps/web/test/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['apps/web/test/setup.ts'] },
      },
    ],
  },
});
