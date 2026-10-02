// Service worker do Força de Vendas.
// Estratégia: network-first com fallback em cache, para páginas e arquivos
// do próprio app (mesma origem). Isso permite reabrir o app mesmo sem
// internet, desde que ele já tenha sido carregado alguma vez antes com
// conexão. Chamadas de API (Supabase, BrasilAPI etc.) não são
// interceptadas — seguem direto para a rede, como sempre. Fotos de
// produtos (armazenamento de imagens da Supabase) são guardadas à parte,
// à medida que vão sendo vistas online, para poderem aparecer offline.

const CACHE_NAME = "fv-shell-v1";
const IMAGE_CACHE_NAME = "fv-images-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== IMAGE_CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isProductImage(url) {
  // URLs públicas de imagem do storage da Supabase
  return url.pathname.includes("/storage/v1/object/public/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const productImage = !sameOrigin && isProductImage(url);

  if (!sameOrigin && !productImage) return; // outras chamadas de API: não mexe

  if (productImage) {
    // Fotos de produto: cache-first (elas praticamente não mudam, e assim
    // evita baixar de novo toda vez, funcionando bem offline depois de
    // vistas uma vez online).
    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          throw err;
        }
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        const cached = await cache.match(request, { ignoreSearch: false });
        if (cached) return cached;

        // Navegação (abrir uma tela) sem internet e sem cópia salva dessa
        // URL específica: tenta servir a última cópia da home como app
        // shell, para o roteador do lado do cliente assumir a partir daí.
        if (request.mode === "navigate") {
          const shell = await cache.match("/");
          if (shell) return shell;
        }
        throw err;
      }
    })
  );
});
