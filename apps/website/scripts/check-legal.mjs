#!/usr/bin/env node
/**
 * Verificação estática do build do website (sem navegador):
 *   pnpm --filter @edusearch/website build && pnpm --filter @edusearch/website check:legal
 *
 * - Cloudflare Pages: termos-de-uso.html e politica-de-privacidade.html na raiz
 *   do dist são servidos em /termos-de-uso e /politica-de-privacidade.
 * - Sem _redirects de SPA que mascarem 404.
 * - Cada página: um h1, canônica correta, robots coerente com o status,
 *   âncoras do índice existentes, links internos válidos, sem marcadores crus.
 * - Rodapé do site só linka documentos aprovados.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const failures = [];
const ok = (cond, msg) => (cond ? console.log(`  ✓ ${msg}`) : failures.push(msg));

const pages = ["termos-de-uso", "politica-de-privacidade"];
const routes = new Set(["/", ...pages.map((p) => `/${p}`)]);

ok(existsSync(join(dist, "index.html")), "landing page preservada (index.html)");
ok(!existsSync(join(dist, "_redirects")) || !/\/\*\s+\/index\.html\s+200/.test(readFileSync(join(dist, "_redirects"), "utf8")), "sem fallback de SPA que esconda 404");

const approved = {};
for (const slug of pages) {
  const file = join(dist, `${slug}.html`);
  if (!existsSync(file)) {
    failures.push(`${slug}.html ausente no dist`);
    continue;
  }
  const html = readFileSync(file, "utf8");
  const status = /data-status="(aprovado|rascunho)"/.exec(html)?.[1];
  approved[slug] = status === "aprovado";
  ok((html.match(/<h1[\s>]/g) ?? []).length === 1, `${slug}: exatamente um h1`);
  ok(html.includes(`<link rel="canonical" href="https://edusearch.com.br/${slug}" />`), `${slug}: URL canônica`);
  ok(html.includes(`<html lang="pt-BR"`), `${slug}: idioma pt-BR`);
  ok(/<title>[^<]+ — EduSearch<\/title>/.test(html) && /<meta name="description" content="[^"]{20,}"/.test(html), `${slug}: título e descrição (SEO)`);
  ok(
    approved[slug] ? html.includes('content="index, follow"') : html.includes('content="noindex, follow"') && html.includes("não vigente"),
    `${slug}: robots e aviso coerentes com o status (${status})`,
  );
  ok(!html.includes("[[REVISAR"), `${slug}: nenhum marcador cru`);
  ok(!/<script(?![^>]*type="module")[^>]*>[^<]*alert/i.test(html), `${slug}: sem scripts injetados pelo conteúdo`);

  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  const missing = anchors.filter((a) => !ids.has(a));
  ok(anchors.length >= 15 && missing.length === 0, `${slug}: ${anchors.length} âncoras do índice válidas${missing.length ? ` (faltando: ${missing.join(", ")})` : ""}`);

  const internal = [...html.matchAll(/href="(\/[^"#]*)(#[^"]*)?"/g)].map((m) => m[1]).filter((h) => !/\.(ico|png|webp|svg|css|js)$/.test(h) && !h.startsWith("/assets/"));
  const broken = internal.filter((h) => !routes.has(h));
  ok(broken.length === 0, `${slug}: links internos válidos${broken.length ? ` (quebrados: ${[...new Set(broken)].join(", ")})` : ""}`);
  ok(html.includes(`href="/${pages.find((p) => p !== slug)}"`), `${slug}: link para o outro documento`);
}

// O rodapé do site (React) só recebe links se ambos estiverem aprovados.
const assets = join(dist, "assets");
const js = readdirSync(assets).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(assets, f), "utf8")).join("\n");
const bothApproved = pages.every((p) => approved[p]);
ok(bothApproved || !/"\/termos-de-uso"|"\/politica-de-privacidade"/.test(js), "rodapé do site não linka documentos em rascunho");

if (failures.length) {
  console.error(`✗ check-legal: ${failures.length} problema(s)\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log("✓ check-legal: páginas jurídicas prontas para o Cloudflare Pages");
