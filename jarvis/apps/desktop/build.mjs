// Empaqueta el proceso principal y el preload (incluye el núcleo: sin node_modules en la app).
import { build } from 'esbuild';
import fs from 'node:fs';

const common = { bundle: true, platform: 'node', target: 'node24', format: 'cjs', sourcemap: true, logLevel: 'warning', external: ['electron', 'bufferutil', 'utf-8-validate'] };
await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' });
fs.copyFileSync('build/icon.png', 'dist/icon.png');
console.log('Escritorio compilado en dist/');
