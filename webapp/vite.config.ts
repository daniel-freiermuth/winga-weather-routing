import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dir, '../package.json'), 'utf-8')) as { version: string };
const commitHash = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return 'unknown'; }
})();

export default defineConfig(({ command }) => ({
  // Relative base for production so the app works when Signal K mounts it
  // under a subpath (e.g. /signalk-weather-routing/). Dev server keeps '/'
  // so Vite HMR and module resolution work correctly.
  root: __dir,


  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commitHash),
  },

  build: {
    outDir: '../dist/webapp',
    emptyOutDir: true,
    sourcemap: true,
  },

  worker: {
    format: 'es' as const,
  },

  server: {
    port: 5174,
    // Proxy SignalK API calls to a local SK server during development
    proxy: {
      '/signalk': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      '/plugins/signalk-weather-routing': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
}));
