/*
  Service Worker do EduSearch — política de cache segura.

  - Só intercepta GET da PRÓPRIA origem. Requisições à API (outra origem),
    POST/PUT/DELETE e qualquer requisição com Authorization passam direto
    para a rede e NUNCA são armazenadas.
  - Navegação: rede primeiro; sem conexão, usa o app shell (index.html) em cache.
  - /assets/* (arquivos com hash, imutáveis): cache primeiro.
  - Ícones, logos e manifest: cache com revalidação em segundo plano.
  - Respostas com erro, opacas ou com Cache-Control: no-store não são guardadas.

  Ao alterar este arquivo, incremente VERSION para descartar caches antigos.
*/
const VERSION = "v1";
const SHELL_CACHE = `edusearch-shell-${VERSION}`;
const ASSET_CACHE = `edusearch-assets-${VERSION}`;
const SHELL_URL = "/index.html";
const PRECACHE = [SHELL_URL, "/manifest.webmanifest", "/brand/logo.webp", "/brand/logo-dark.webp", "/icons/app-icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("edusearch-") && ![SHELL_CACHE, ASSET_CACHE].includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function cacheable(response) {
  if (!response || !response.ok || response.type !== "basic") return false;
  const cc = response.headers.get("Cache-Control") || "";
  return !/no-store|private/i.test(cc);
}

async function networkFirstShell(request) {
  try {
    const response = await fetch(request);
    if (cacheable(response)) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(SHELL_URL);
    return cached || new Response("Sem conexão.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) (await caches.open(ASSET_CACHE)).put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (cacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.headers.has("Authorization")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // API e serviços externos: sempre rede.

  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (/^\/(icons|brand)\//.test(url.pathname) || url.pathname === "/manifest.webmanifest" || /\.(png|ico|webp|svg)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
