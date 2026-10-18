/* Debrief — service worker: funciona sem rede. Nenhum dado do utilizador passa por aqui. */
const VERSION = 'debrief-v1.6.3';
const SHELL = VERSION + '-shell';
const OCR = 'debrief-ocr-v6';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
  './vendor/supabase/supabase.js'
];

const OCR_FILES = [
  './vendor/ocr/tesseract.min.js',
  './vendor/ocr/worker.min.js',
  './vendor/ocr/core/tesseract-core-simd-lstm.wasm.js',
  './vendor/ocr/core/tesseract-core-lstm.wasm.js',
  './vendor/ocr/lang/eng.traineddata.gz',
  './vendor/ocr/lang/por.traineddata.gz'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES);
    // O leitor de cartões (~12 MB) é guardado logo, para funcionar offline à primeira.
    try {
      const ocr = await caches.open(OCR);
      const missing = [];
      for (const f of OCR_FILES) { if (!(await ocr.match(f))) missing.push(f); }
      if (missing.length) await ocr.addAll(missing);
    } catch (e) { /* tenta outra vez quando for usado */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL && k !== OCR).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isOcr = url.pathname.includes('/vendor/ocr/');
  const isPage = req.mode === 'navigate';

  if (isPage) {
    // Rede primeiro (para receber atualizações), cache se estiver offline.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(SHELL);
        c.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) {
      const c = await caches.open(isOcr ? OCR : SHELL);
      c.put(req, res.clone());
    }
    return res;
  })());
});
