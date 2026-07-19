// Webapp main thread entry point — Phase 4 will build this out.
// For now, just verify the worker loads and responds.

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

worker.addEventListener('message', (event: MessageEvent) => {
  console.log('[main] worker message:', event.data);
});

worker.addEventListener('error', (event: ErrorEvent) => {
  console.error('[main] worker error:', event.message);
});

console.log('[main] Weather routing webapp loaded');
