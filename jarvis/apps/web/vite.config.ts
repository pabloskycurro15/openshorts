import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

/** Copia el motor ONNX (WebAssembly) a public/ort para servirlo localmente (sin CDN). */
function copyOrt() {
  const src = path.resolve(__dirname, '../../node_modules/onnxruntime-web/dist');
  const dst = path.resolve(__dirname, 'public/ort');
  const files = ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];
  return {
    name: 'jarvis-copy-ort',
    buildStart() {
      fs.mkdirSync(dst, { recursive: true });
      for (const f of files) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
    },
  };
}

const CORE = process.env.JARVIS_CORE_URL ?? 'http://127.0.0.1:7777';

export default defineConfig({
  plugins: [react(), tailwindcss(), copyOrt()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  server: {
    host: '127.0.0.1',
    port: 5180,
    // El navegador habla con Vite y Vite reenvía al núcleo: sin CORS ni puertos expuestos.
    proxy: { '/api': { target: CORE, ws: true, changeOrigin: true } },
  },
  build: { target: 'es2022', sourcemap: true },
});
