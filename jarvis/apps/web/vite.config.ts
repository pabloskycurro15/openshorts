import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const CORE = process.env.JARVIS_CORE_URL ?? 'http://127.0.0.1:7777';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    // El navegador habla con Vite y Vite reenvía al núcleo: sin CORS ni puertos expuestos.
    proxy: { '/api': { target: CORE, ws: true, changeOrigin: true } },
  },
  build: { target: 'es2022', sourcemap: true },
});
