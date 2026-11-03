import { readdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const apiTarget = process.env.MICHEL_DEV_API_TARGET ?? 'http://localhost:3000';
const DEMO_BASE = '/demo/';

/** The app names its public files by absolute path; under /demo/ they must carry the base. */
function demoPublicPaths(): Plugin {
  const names = readdirSync(fileURLToPath(new URL('./public', import.meta.url))).map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  const pattern = new RegExp(`(['"\`(])/(${names.join('|')})(?=[/'"\`)?#]|$)`, 'g');
  return {
    name: 'elise-demo-public-paths',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/src\/.*\.tsx?$/.test(id) || !pattern.test(code)) return null;
      pattern.lastIndex = 0;
      return { code: code.replace(pattern, `$1${DEMO_BASE}$2`), map: null };
    },
    writeBundle(options) {
      if (options.dir) renameSync(`${options.dir}/demo.html`, `${options.dir}/index.html`);
    },
  };
}

export default defineConfig(({ mode }) =>
  mode === 'demo'
    ? {
        base: DEMO_BASE,
        plugins: [react(), tailwindcss(), demoPublicPaths()],
        build: {
          outDir: process.env.ELISE_DEMO_OUT_DIR ?? '../../eliselanding/public/demo',
          emptyOutDir: true,
          rollupOptions: { input: fileURLToPath(new URL('./demo.html', import.meta.url)) },
        },
      }
    : {
        plugins: [react(), tailwindcss()],
        server: {
          port: 5173,
          proxy: { '/api': { target: apiTarget, changeOrigin: true } },
        },
      },
);
