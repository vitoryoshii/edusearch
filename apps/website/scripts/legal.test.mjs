/**
 * Testes do renderizador e das páginas jurídicas (sem navegador).
 *   pnpm --filter @edusearch/website test:legal
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { escapeHtml, formatDateBR, inline, parseFrontMatter, renderMarkdown, safeHref, slugify } from "../src/legal/markdown.ts";
import { assertPublishable, renderLegalBody, renderLegalHead } from "../src/legal/page.ts";

const fm = (status = "rascunho") => `---\ntitle: Teste\nslug: termos-de-uso\nstatus: ${status}\nversion: 0.1\nupdated: 2026-11-18\ndescription: Documento de teste\n---\n`;
const doc = (body, status) => renderMarkdown(fm(status) + body);

describe("markdown jurídico: segurança", () => {
  test("todo HTML do documento é escapado", () => {
    const r = doc("Texto <script>alert(1)</script> e <img src=x onerror=alert(1)>");
    assert.ok(!r.html.includes("<script>") && !r.html.includes("<img"));
    assert.ok(r.html.includes("&lt;script&gt;"));
    assert.equal(escapeHtml(`"'<>&`), "&quot;&#39;&lt;&gt;&amp;");
  });
  test("links: só https, mailto, âncoras, caminhos do site e outros documentos", () => {
    assert.equal(safeHref("https://edusearch.com.br"), "https://edusearch.com.br");
    assert.equal(safeHref("politica-de-privacidade.md"), "/politica-de-privacidade");
    assert.equal(safeHref("termos-de-uso.md#13-comissao-do-edusearch"), "/termos-de-uso#13-comissao-do-edusearch");
    assert.equal(safeHref("mailto:contato@exemplo.com"), "mailto:contato@exemplo.com");
    for (const bad of ["javascript:alert(1)", "http://inseguro.com", "data:text/html,x", "//evil.com", "vbscript:x"]) assert.equal(safeHref(bad), null, bad);
    assert.ok(!inline("[clique](javascript:alert(1))").includes("<a "));
  });
});

describe("markdown jurídico: estrutura", () => {
  test("front matter obrigatório", () => {
    assert.equal(parseFrontMatter(fm()).meta.title, "Teste");
    assert.throws(() => parseFrontMatter("---\ntitle: X\n---\n"));
  });
  test("títulos com âncoras únicas e índice", () => {
    const r = doc("## 1. Quem somos\n\nTexto.\n\n### 1.1 Detalhe\n\n## 1. Quem somos\n");
    assert.deepEqual(r.toc.map((t) => [t.id, t.level]), [["1-quem-somos", 2], ["1-quem-somos-1-1-detalhe", 3], ["1-quem-somos-2", 2]]);
    assert.equal(slugify("13. Comissão do EduSearch"), "13-comissao-do-edusearch");
  });
  test("listas, tabelas, citações, negrito e código", () => {
    const r = doc("- um\n- **dois**\n\n1. a\n2. b\n\n| A | B |\n| --- | --- |\n| 1 | `x` |\n\n> Aviso\n");
    assert.match(r.html, /<ul[^>]*>.*<li[^>]*>um<\/li>.*<strong[^>]*>dois<\/strong>/s);
    assert.match(r.html, /<ol[^>]*>/);
    assert.match(r.html, /<th scope="col"[^>]*>A<\/th>/);
    assert.match(r.html, /<code[^>]*>x<\/code>/);
    assert.match(r.html, /<aside[^>]*role="note"/);
  });
  test("marcadores de revisão são destacados e contados", () => {
    const r = doc("CNPJ: [[REVISAR: CNPJ]]. Endereço: [[REVISAR: endereço]].");
    assert.equal(r.pending, 2);
    assert.match(r.html, /<mark[^>]*data-pendente>Pendente de revisão: CNPJ<\/mark>/);
    assert.ok(!r.html.includes("[[REVISAR"));
  });
  test("data em formato brasileiro", () => {
    assert.equal(formatDateBR("2026-11-18"), "18/11/2026");
  });
});

describe("páginas jurídicas: publicação", () => {
  test("rascunho: noindex, aviso de não vigente e sem bloqueio de build", () => {
    const r = doc("Texto [[REVISAR: x]].");
    assert.match(renderLegalHead(r), /noindex/);
    assert.match(renderLegalHead(r), /rel="canonical" href="https:\/\/edusearch\.com\.br\/termos-de-uso"/);
    assert.match(renderLegalBody(r), /não vigente/);
    assert.doesNotThrow(() => assertPublishable(r));
  });
  test("aprovado com pendências: o build falha", () => {
    assert.throws(() => assertPublishable(doc("Texto [[REVISAR: CNPJ]].", "aprovado")), /pendente/);
  });
  test("aprovado sem pendências: indexável e sem aviso de rascunho", () => {
    const r = doc("Texto final.", "aprovado");
    assert.match(renderLegalHead(r), /index, follow/);
    assert.ok(!renderLegalBody(r).includes("não vigente"));
    assert.doesNotThrow(() => assertPublishable(r));
  });
  test("cabeçalho: símbolo até 439 px, logo horizontal a partir de 440 px, dimensões reais das imagens", () => {
    const body = renderLegalBody(doc("## Seção\n\nTexto."));
    assert.match(body, /src="\/brand\/logo\.webp" alt="" width="498" height="96" class="hidden [^"]*min-\[440px\]:block/);
    assert.match(body, /src="\/brand\/symbol\.webp" alt="" width="152" height="120" class="[^"]*min-\[440px\]:hidden/);
    assert.ok(!body.includes("min-[360px]"), "breakpoint antigo (360 px) não pode voltar");
  });
  test("navegação entre Termos e Privacidade e um único h1", () => {
    const body = renderLegalBody(doc("## Seção\n\nTexto."));
    assert.equal((body.match(/<h1/g) ?? []).length, 1);
    assert.match(body, /href="\/politica-de-privacidade"/);
    assert.match(body, /aria-current="page"/);
  });
});

describe("documentos-fonte (docs/legal)", () => {
  const read = (slug) => renderMarkdown(readFileSync(new URL(`../../../docs/legal/${slug}.md`, import.meta.url), "utf8"));
  const terms = read("termos-de-uso");
  const privacy = read("politica-de-privacidade");

  test("continuam como rascunho enquanto houver pendências", () => {
    for (const d of [terms, privacy]) {
      assert.ok(d.pending > 0);
      assert.notEqual(d.meta.status, "aprovado");
    }
  });
  test("Termos cobrem os 25 temas exigidos (seções numeradas)", () => {
    assert.ok(terms.toc.filter((t) => t.level === 2).length >= 25);
    const all = terms.toc.map((t) => t.text).join(" | ");
    for (const k of ["Quem somos", "Crianças e adolescentes", "Comissão", "Cancelamento", "Repasses", "Aulas online", "indicações", "Condutas proibidas", "Propriedade intelectual", "foro"]) {
      assert.ok(all.toLowerCase().includes(k.toLowerCase()), `faltou a seção: ${k}`);
    }
  });
  test("comissão padrão de 15% e nenhuma regra de benefício inventada", () => {
    const html = terms.html;
    assert.match(html, /comissão padrão de 15% \(quinze por cento\)/);
    assert.ok(!/\b(10|12|12,5|13|14)%/.test(html), "percentuais de desconto não aprovados");
    assert.match(html, /ainda não têm regras definitivas/);
    assert.match(html, /Os pagamentos ainda não estão ativos/);
  });
  test("Política distingue tratamentos atuais e planejados e não inventa prazos", () => {
    const all = privacy.toc.map((t) => t.text).join(" | ");
    assert.match(all, /Dados que tratamos hoje/);
    assert.match(all, /\(planejad[oa]s\)/);
    assert.match(privacy.html, /não são aceitas contas reais de menores de 18 anos/);
    assert.ok(!/\b\d+\s*(dias|meses|anos)\b/.test(privacy.html.replace(/até 15 dias|(?:menor|menores|maior|maiores) de 18 anos/g, "")), "prazo de retenção não aprovado (só são aceitos idade e o prazo legal do art. 19 da LGPD)");
  });
  test("nenhum dado jurídico inventado: identificação sempre pendente", () => {
    for (const d of [terms, privacy]) {
      assert.ok(!/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(d.html), "CNPJ no texto");
      assert.match(d.html, /Pendente de revisão: (razão social|CNPJ)/);
      assert.ok(!/vytetech/i.test(d.html));
    }
  });
});
