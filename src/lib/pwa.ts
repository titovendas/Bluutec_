// Único ponto de registro do service worker do app.
// Nunca registra em desenvolvimento nem dentro do preview do Lovable —
// nesses contextos um SW antigo pode servir telas desatualizadas.

function isPreviewHost(hostname: string) {
  return (
    hostname.startsWith("id-preview--") ||
    hostname.startsWith("preview--") ||
    hostname === "lovableproject.com" ||
    hostname.endsWith(".lovableproject.com") ||
    hostname === "lovableproject-dev.com" ||
    hostname.endsWith(".lovableproject-dev.com") ||
    hostname === "beta.lovable.dev" ||
    hostname.endsWith(".beta.lovable.dev")
  );
}

async function unregisterAppServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) => {
        const url =
          registration.active?.scriptURL ??
          registration.waiting?.scriptURL ??
          registration.installing?.scriptURL ??
          "";
        return url.endsWith("/sw.js");
      })
      .map((registration) => registration.unregister())
  );
}

export function registerAppServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const inIframe = window.self !== window.top;
  const swOff = new URL(window.location.href).searchParams.get("sw") === "off";
  const refused =
    !import.meta.env.PROD ||
    inIframe ||
    swOff ||
    isPreviewHost(window.location.hostname);

  if (refused) {
    unregisterAppServiceWorkers().catch(() => {});
    return;
  }

  navigator.serviceWorker
    .register("/sw.js")
    .then(() => warmUpRoutes())
    .catch(() => {
      /* sem suporte ou erro momentâneo — o app continua funcionando */
    });
}

// Rotas principais são baixadas em segundo plano enquanto há internet, para
// que possam ser abertas depois mesmo totalmente offline.
const ROUTES_TO_WARM = [
  "/",
  "/auth",
  "/clientes",
  "/produtos",
  "/pedidos",
  "/pedidos/novo",
  "/vendedores",
  "/configuracoes",
];

function warmUpRoutes() {
  if (!navigator.onLine) return;
  ROUTES_TO_WARM.forEach((route) => {
    fetch(route, { credentials: "same-origin" }).catch(() => {});
  });
}

