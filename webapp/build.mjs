// esbuild script for the browser webapp bundle.
//
// Produces two bundles in dist/webapp/:
//   main.js   — main thread: UI, Leaflet, SignalK client
//   worker.js — Web Worker: isochrone routing + tile providers
//
// Usage:
//   node webapp/build.mjs          — production build
//   node webapp/build.mjs --watch  — development with rebuild on change

import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
  outdir: 'dist/webapp',
};

// Worker bundle — self-contained except for Node.js builtins that exist only
// in dead-code server paths (e.g. parsePolarFile's conditional require('node:fs')).
const workerBuild = esbuild.build({
  ...shared,
  entryPoints: ['webapp/worker.ts'],
  outExtension: { '.js': '.js' },
  external: ['node:*'],
});

// Main thread bundle — will be created in Phase 4
// For now, just build the worker to validate it bundles correctly
const mainStub = esbuild.build({
  ...shared,
  entryPoints: ['webapp/main.ts'],
  outExtension: { '.js': '.js' },
  external: [],
});

try {
  await Promise.all([workerBuild, mainStub]);
  console.log('Build complete → dist/webapp/');
} catch {
  process.exit(1);
}
