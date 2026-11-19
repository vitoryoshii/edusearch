import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { isApproved, renderMarkdown, type RenderedDoc } from "./src/legal/markdown.ts";
import { LEGAL_PAGES, assertPublishable, renderLegalBody, renderLegalHead, type LegalSlug } from "./src/legal/page.ts";

/**
 * Gera as páginas jurídicas (termos-de-uso.html e politica-de-privacidade.html)
 * a partir de docs/legal/*.md, no build e no servidor de desenvolvimento.
 *
 * - O HTML final já contém o texto completo (SEO, sem JavaScript).
 * - Cloudflare Pages serve /termos-de-uso a partir de termos-de-uso.html.
 * - Documento "aprovado" com marcadores [[REVISAR]] faz o build falhar.
 * - Expõe __LEGAL_DOCS_APPROVED__ para o rodapé do site só linkar documentos aprovados.
 */
const docsDir = fileURLToPath(new URL("../../docs/legal/", import.meta.url));
const docPath = (slug: LegalSlug) => `${docsDir}${slug}.md`;

export function loadLegalDoc(slug: LegalSlug): RenderedDoc {
  const doc = renderMarkdown(readFileSync(docPath(slug), "utf8"));
  if (doc.meta.slug !== slug) throw new Error(`docs/legal/${slug}.md declara slug "${doc.meta.slug}".`);
  assertPublishable(doc);
  return doc;
}

export function legalPages(): Plugin {
  return {
    name: "edusearch-legal-pages",
    config() {
      const approved = LEGAL_PAGES.every((p) => isApproved(loadLegalDoc(p.slug).meta));
      return { define: { __LEGAL_DOCS_APPROVED__: JSON.stringify(approved) } };
    },
    configureServer(server) {
      for (const p of LEGAL_PAGES) server.watcher.add(docPath(p.slug));
      server.watcher.on("change", (file) => {
        if (file.replace(/\\/g, "/").includes("/docs/legal/")) server.ws.send({ type: "full-reload" });
      });
    },
    transformIndexHtml(html) {
      const marker = /<!--legal:([a-z-]+)-->/.exec(html);
      if (!marker) return html;
      const slug = marker[1] as LegalSlug;
      if (!LEGAL_PAGES.some((p) => p.slug === slug)) throw new Error(`Página jurídica desconhecida: ${slug}`);
      const doc = loadLegalDoc(slug);
      return html.replace("<!--legal-head-->", renderLegalHead(doc)).replace(marker[0], renderLegalBody(doc));
    },
  };
}
