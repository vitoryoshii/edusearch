/**
 * Renderizador de Markdown RESTRITO para os documentos jurídicos (docs/legal).
 * Puro (sem DOM, sem dependências) e testado em scripts/legal.test.mjs.
 *
 * Suporta: front matter simples, ## e ### (com âncoras e índice), parágrafos,
 * listas (- e 1.), tabelas, citações (>), **negrito**, `código`, links seguros e
 * marcadores de revisão [[REVISAR: …]]. Todo texto é escapado: nenhum HTML do
 * documento é repassado à página.
 */

export type FrontMatter = {
  title: string;
  slug: string;
  status: string;
  version: string;
  updated: string;
  description: string;
};

export type TocItem = { id: string; text: string; level: 2 | 3 };

export type RenderedDoc = {
  meta: FrontMatter;
  html: string;
  toc: TocItem[];
  /** Quantidade de marcadores [[REVISAR: …]] pendentes. */
  pending: number;
};

const MARKER = /\[\[REVISAR:\s*([^\]]+?)\]\]/g;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function parseFrontMatter(source: string): { meta: FrontMatter; body: string } {
  const text = source.replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const data: Record<string, string> = {};
  if (m) {
    for (const line of m[1]!.split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  const required = ["title", "slug", "status", "version", "updated", "description"] as const;
  for (const k of required) if (!data[k]) throw new Error(`Front matter sem o campo obrigatório "${k}".`);
  return { meta: data as unknown as FrontMatter, body: m ? text.slice(m[0].length) : text };
}

/** Links permitidos: https, mailto, âncoras, caminhos do site e outros documentos (.md → página). */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  const doc = /^([a-z0-9-]+)\.md(#[a-z0-9-]+)?$/.exec(href);
  if (doc) return `/${doc[1]}${doc[2] ?? ""}`;
  if (/^https:\/\/[^\s"'<>]+$/.test(href)) return href;
  if (/^mailto:[^\s"'<>]+$/.test(href)) return href;
  if (/^#[a-z0-9-]+$/.test(href)) return href;
  if (/^\/[a-z0-9/_-]*$/.test(href)) return href;
  return null;
}

const MARK_CLASS = "rounded bg-warning-soft px-1 py-0.5 font-medium text-warning-text";
const LINK_CLASS = "font-medium text-link underline underline-offset-4 hover:no-underline";
const CODE_CLASS = "rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[0.9em] text-fg-strong";

/** Formatação inline sobre texto JÁ ESCAPADO. */
export function inline(text: string): string {
  let out = escapeHtml(text);
  const codes: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(`<code class="${CODE_CLASS}">${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out.replace(MARKER, (_m, note: string) => `<mark class="${MARK_CLASS}" data-pendente>Pendente de revisão: ${note.trim()}</mark>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-fg-strong">$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, href: string) => {
    const safe = safeHref(href.replace(/&amp;/g, "&"));
    return safe ? `<a class="${LINK_CLASS}" href="${escapeHtml(safe)}">${label}</a>` : m;
  });
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)]!);
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export function renderMarkdown(source: string): RenderedDoc {
  const { meta, body } = parseFrontMatter(source);
  const lines = body.split("\n");
  const toc: TocItem[] = [];
  const used = new Set<string>();
  const out: string[] = [];
  let currentH2 = "";

  const uniqueId = (base: string) => {
    let id = base || "secao";
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    if (h) {
      const level = h[1]!.length as 2 | 3;
      const text = h[2]!.trim();
      const id = uniqueId(level === 3 && currentH2 ? `${currentH2}-${slugify(text)}` : slugify(text));
      if (level === 2) currentH2 = id;
      toc.push({ id, text: text.replace(MARKER, "").trim(), level });
      out.push(
        level === 2
          ? `<h2 id="${id}" class="mt-12 scroll-mt-24 text-xl font-semibold tracking-tight text-fg-strong sm:text-2xl">${inline(text)}</h2>`
          : `<h3 id="${id}" class="mt-8 scroll-mt-24 text-lg font-semibold text-fg-strong">${inline(text)}</h3>`,
      );
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) buf.push(lines[i++]!.replace(/^>\s?/, ""));
      out.push(
        `<aside class="mt-6 rounded-card border border-line bg-surface-muted px-5 py-4 text-fg" role="note"><p>${inline(buf.join(" "))}</p></aside>`,
      );
      continue;
    }
    if (line.trim().startsWith("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(splitRow(lines[i++]!));
      out.push(
        `<div class="mt-6 overflow-x-auto rounded-card border border-line" role="region" tabindex="0" aria-label="Tabela">` +
          `<table class="w-full min-w-[36rem] border-collapse text-left text-sm">` +
          `<thead class="bg-surface-muted"><tr>${head.map((c) => `<th scope="col" class="px-4 py-3 font-semibold text-fg-strong">${inline(c)}</th>`).join("")}</tr></thead>` +
          `<tbody>${rows
            .map((r) => `<tr class="border-t border-line align-top">${r.map((c) => `<td class="px-4 py-3 text-fg">${inline(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table></div>`,
      );
      continue;
    }
    const ul = /^\s*-\s+(?:\[([ x])\]\s+)?(.*)$/;
    const ol = /^\s*\d+\.\s+(.*)$/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line) && !ul.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? ol : ul).test(lines[i]!)) {
        const m = (ordered ? ol : ul).exec(lines[i++]!)!;
        if (ordered) items.push(inline(m[1]!));
        else {
          const box = m[1];
          const label = inline(m[2]!);
          items.push(box === undefined ? label : `<span aria-hidden="true">${box === "x" ? "☑" : "☐"}</span> ${label}<span class="sr-only">${box === "x" ? " (concluído)" : " (pendente)"}</span>`);
        }
      }
      const tag = ordered ? "ol" : "ul";
      out.push(
        `<${tag} class="mt-4 space-y-2 ${ordered ? "list-decimal" : "list-disc"} pl-6 text-fg marker:text-fg-muted">${items.map((t) => `<li class="pl-1 leading-relaxed">${t}</li>`).join("")}</${tag}>`,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{2,3}\s|>|\s*-\s|\s*\d+\.\s|\s*\|)/.test(lines[i]!)) para.push(lines[i++]!.trim());
    if (para.length) out.push(`<p class="mt-4 leading-relaxed text-fg">${inline(para.join(" "))}</p>`);
    else i++;
  }

  const pending = (body.match(MARKER) ?? []).length;
  return { meta, html: out.join("\n"), toc, pending };
}

/** "2026-11-18" → "18/11/2026". */
export function formatDateBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export const isApproved = (meta: FrontMatter) => meta.status === "aprovado";
