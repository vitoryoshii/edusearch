#!/usr/bin/env node
/**
 * Teste de navegador das páginas jurídicas — roda no GitHub Actions contra o
 * build servido como estático (vite preview, sem fallback de SPA, como o
 * Cloudflare Pages):
 *
 *   pnpm --filter @edusearch/website build
 *   pnpm --filter @edusearch/website exec vite preview --port 4174 --strictPort &
 *   node apps/website/scripts/legal-browser.mjs http://localhost:4174 [pasta-de-capturas]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { launch, sleep } from "../../web/scripts/lib/cdp.mjs";

const base = (process.argv[2] ?? "http://localhost:4174").replace(/\/$/, "");
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });
const require = createRequire(new URL("../../web/package.json", import.meta.url));
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const b = await launch();
const failures = [];
const check = (cond, msg) => (cond ? console.log(`  ✓ ${msg}`) : failures.push(msg));

async function axe(label) {
  await b.evaluate(`${AXE};1`);
  const v = await b.evaluate(
    `axe.run(document, { runOnly: { type: "tag", values: ["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"] } })
       .then((r) => r.violations.map((v) => v.id + " (" + v.nodes.length + "): " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")))`,
  );
  check(v.length === 0, `axe: ${label}${v.length ? " — " + v.join("; ") : ""}`);
}

/** Larguras verificadas (440 = primeiro ponto com o logo horizontal no cabeçalho). */
const WIDTHS = [320, 375, 390, 440, 768, 1440];

/**
 * Geometria do viewport e do cabeçalho, registrada quando a verificação de
 * largura falha: innerWidth, clientWidth, scrollWidth, dimensões do cabeçalho
 * e da navegação, logo visível e os elementos que ultrapassam a tela.
 */
const GEOMETRY = `(() => {
  const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
  const header = document.querySelector('body > header');
  const inner = header?.firstElementChild;
  const nav = header?.querySelector('nav');
  const img = [...(header?.querySelectorAll('a[href="/"] img') ?? [])].find(vis);
  const cw = document.documentElement.clientWidth;
  const offenders = [...document.querySelectorAll('body *')]
    .filter((el) => vis(el) && el.getBoundingClientRect().right > cw + 1)
    .slice(0, 4)
    .map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '') + ' →' + Math.round(el.getBoundingClientRect().right));
  return {
    innerWidth, clientWidth: cw, scrollWidth: document.documentElement.scrollWidth,
    visualScale: window.visualViewport ? Number(visualViewport.scale.toFixed(3)) : null,
    headerWidth: Math.round(inner?.clientWidth ?? 0), headerScroll: Math.round(inner?.scrollWidth ?? 0),
    navWidth: Math.round(nav?.getBoundingClientRect().width ?? 0),
    logo: img ? (img.src.includes('symbol') ? 'symbol' : 'logo') : 'nenhum',
    logoWidth: Math.round(img?.getBoundingClientRect().width ?? 0),
    offenders,
  };
})()`;

const PAGES = [
  ["termos-de-uso", "Termos de Uso"],
  ["politica-de-privacidade", "Política de Privacidade"],
];

for (const [slug, title] of PAGES) {
  console.log(`/${slug}`);
  b.setStep(slug);
  await b.go(`${base}/${slug}`, 900);
  check(await b.evaluate(`document.querySelector('h1')?.textContent.trim() === ${JSON.stringify(title)}`), "acesso direto pela URL");
  await b.go(`${base}/${slug}`, 900);
  check(await b.evaluate(`document.querySelector('h1')?.textContent.trim() === ${JSON.stringify(title)} && document.querySelectorAll('article h2').length >= 15`), "recarregar mantém a página e o texto completo");
  check(await b.evaluate(`document.querySelector('nav[aria-label="Documentos"] [aria-current="page"]')?.getAttribute('href') === '/${slug}'`), "navegação indica a página atual");
  check(await b.evaluate(`document.title.endsWith('— EduSearch') && document.querySelector('link[rel=canonical]')?.href === 'https://edusearch.com.br/${slug}'`), "título e URL canônica");

  // Índice: link leva à seção.
  const target = await b.evaluate(`(() => { const a = document.querySelector('nav[aria-label="Índice do documento"] a'); a.click(); return a.getAttribute('href').slice(1); })()`);
  await sleep(300);
  check(await b.evaluate(`location.hash === '#${target}' && !!document.getElementById('${target}')`), "índice navega até a seção");

  for (const dark of [false, true]) {
    await b.viewport(1280, { dark });
    await sleep(300);
    check(await b.evaluate(`document.documentElement.dataset.theme === '${dark ? "dark" : "light"}'`), `tema ${dark ? "escuro" : "claro"} do sistema aplicado`);
    await axe(`${slug} (${dark ? "escuro" : "claro"})`);
  }
  const overflow = [];
  const logoMismatch = [];
  for (const w of WIDTHS) {
    for (const dark of [false, true]) {
      await b.viewport(w, { dark });
      await sleep(250);
      const g = await b.evaluate(GEOMETRY);
      const label = `${w}px ${dark ? "escuro" : "claro"}`;
      // innerWidth > largura emulada = o celular "diminuiu o zoom" para caber um elemento largo demais.
      if (g.scrollWidth > g.innerWidth + 1 || g.innerWidth > w + 1 || g.headerScroll > g.headerWidth + 1) {
        overflow.push(`${label} ${JSON.stringify(g)}`);
      }
      const expected = w >= 440 ? "logo" : "symbol";
      if (g.logo !== expected) logoMismatch.push(`${label}: esperado ${expected}, visível ${g.logo}`);
      if (shots) await b.screenshot(join(shots, `${slug}-${w}-${dark ? "escuro" : "claro"}.png`), { full: false });
    }
  }
  check(overflow.length === 0, `sem rolagem horizontal nem zoom reduzido em ${WIDTHS.join("/")} px, claro e escuro${overflow.length ? "\n      geometria: " + overflow.join("\n      geometria: ") : ""}`);
  check(logoMismatch.length === 0, `cabeçalho: símbolo até 439 px e logo horizontal a partir de 440 px${logoMismatch.length ? " — " + logoMismatch.join("; ") : ""}`);
  await b.viewport(1280);
}

console.log("rotas");
const status = async (path) => (await fetch(base + path)).status;
check((await status("/termos-de-uso")) === 200 && (await status("/politica-de-privacidade")) === 200, "rotas jurídicas respondem 200");
check((await status("/pagina-que-nao-existe")) === 404, "rota inexistente responde 404 (sem fallback de SPA)");
await b.go(`${base}/404.html`, 900);
check(
  await b.evaluate(`document.querySelector('h1')?.textContent.trim() === 'Página não encontrada' && !!document.querySelector('a[href="/"]')`),
  "página 404 com atalhos",
);
await axe("página 404");
await b.go(`${base}/`, 1200);
check(await b.evaluate(`!!document.querySelector('#root') && document.body.innerText.length > 200`), "landing page continua funcionando");

await b.close();
const all = [...failures, ...b.errors];
if (all.length) {
  console.error(`✗ legal-browser: ${all.length} problema(s)\n  ` + all.join("\n  "));
  process.exit(1);
}
console.log("✓ legal-browser: páginas jurídicas acessíveis, responsivas e com URLs públicas válidas");
