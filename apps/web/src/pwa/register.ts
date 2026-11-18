/**
 * Registra o Service Worker somente no build de produção, para não
 * interferir no desenvolvimento (HMR do Vite).
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* sem SW o app continua funcionando normalmente, apenas sem modo offline */
    });
  });
}
