import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { legalPages } from "./legal-plugin.ts";

export default defineConfig({
  // Várias páginas HTML estáticas (sem fallback de SPA): /termos-de-uso e
  // /politica-de-privacidade funcionam por acesso direto e após recarregar.
  appType: "mpa",
  plugins: [react(), tailwindcss(), legalPages()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        "termos-de-uso": "termos-de-uso.html",
        "politica-de-privacidade": "politica-de-privacidade.html",
        // 404 real: sem ele, o Cloudflare Pages trata o site como SPA e responde 200 com a landing.
        "404": "404.html",
      },
    },
  },
});
