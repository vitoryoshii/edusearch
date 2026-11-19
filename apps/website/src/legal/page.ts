import { escapeHtml, formatDateBR, isApproved, type RenderedDoc } from "./markdown.ts";

/**
 * Página jurídica estática (HTML gerado no build). Puro e testado.
 * Cabeçalho com logo e navegação, aviso de versão, índice, texto e rodapé.
 */
export const SITE_URL = "https://edusearch.com.br";

export const LEGAL_PAGES = [
  { slug: "termos-de-uso", label: "Termos de Uso", short: "Termos" },
  { slug: "politica-de-privacidade", label: "Política de Privacidade", short: "Privacidade" },
] as const;

export type LegalSlug = (typeof LEGAL_PAGES)[number]["slug"];

/** Tags do <head>: título, descrição, canônica, robots e Open Graph. */
export function renderLegalHead(doc: RenderedDoc): string {
  const url = `${SITE_URL}/${doc.meta.slug}`;
  const title = `${doc.meta.title} — EduSearch`;
  const robots = isApproved(doc.meta) ? "index, follow" : "noindex, follow";
  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(doc.meta.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(doc.meta.description)}" />`,
  ].join("\n    ");
}

const NAV_LINK = "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium transition-colors";

export function renderLegalBody(doc: RenderedDoc): string {
  const approved = isApproved(doc.meta);
  const current = doc.meta.slug;
  const other = LEGAL_PAGES.find((p) => p.slug !== current)!;
  const nav = LEGAL_PAGES.map((p) =>
    p.slug === current
      ? `<a href="/${p.slug}" aria-current="page" class="${NAV_LINK} bg-primary-soft text-link"><span class="sm:hidden">${p.short}</span><span class="hidden sm:inline">${p.label}</span></a>`
      : `<a href="/${p.slug}" class="${NAV_LINK} text-fg hover:text-link"><span class="sm:hidden">${p.short}</span><span class="hidden sm:inline">${p.label}</span></a>`,
  ).join("");
  const toc = doc.toc
    .filter((t) => t.level === 2)
    .map((t) => `<li><a href="#${t.id}" class="block rounded-control px-2 py-1.5 text-sm leading-snug text-fg hover:bg-surface-muted hover:text-link">${escapeHtml(t.text)}</a></li>`)
    .join("");
  const status = approved
    ? `Versão ${escapeHtml(doc.meta.version)} · em vigor desde ${formatDateBR(doc.meta.updated)}`
    : `Versão preliminar ${escapeHtml(doc.meta.version)} · atualizada em ${formatDateBR(doc.meta.updated)} · <strong class="font-semibold">não vigente</strong>`;

  return `
<a href="#conteudo" class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-fg-strong focus:shadow-raised">Pular para o conteúdo</a>
<header class="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur-sm">
  <div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-8">
    <a href="/" aria-label="EduSearch — página inicial" class="shrink-0 rounded-md">
      <img src="/brand/logo.webp" alt="" width="160" height="40" class="h-7 w-auto sm:h-8 dark:hidden" />
      <img src="/brand/logo-dark.webp" alt="" width="160" height="40" class="hidden h-7 w-auto sm:h-8 dark:block" />
    </a>
    <nav aria-label="Documentos" class="flex items-center gap-1">
      <a href="/" class="${NAV_LINK} text-fg hover:text-link">Início</a>${nav}
    </nav>
  </div>
</header>
<div class="mx-auto max-w-6xl px-4 pt-8 pb-16 sm:px-8 sm:pt-12 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
  <aside class="lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto">
    <details data-toc class="rounded-card border border-line bg-surface p-3 lg:border-0 lg:bg-transparent lg:p-0">
      <summary class="cursor-pointer list-none rounded-control px-2 py-1.5 text-sm font-semibold text-fg-strong">Índice</summary>
      <nav aria-label="Índice do documento" class="mt-2"><ol class="space-y-0.5">${toc}</ol></nav>
    </details>
  </aside>
  <main id="conteudo" tabindex="-1" class="mt-8 max-w-3xl focus:outline-none lg:mt-0">
    <p class="text-sm font-medium text-link">Documentos do EduSearch</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight text-balance text-fg-strong sm:text-4xl">${escapeHtml(doc.meta.title)}</h1>
    <p class="mt-3 text-sm text-fg-muted" data-status="${approved ? "aprovado" : "rascunho"}">${status}</p>
    ${
      approved
        ? ""
        : `<p role="note" class="mt-6 rounded-card border border-warning-text/40 bg-warning-soft px-5 py-4 text-sm leading-relaxed text-fg"><strong class="font-semibold text-fg-strong">Documento em revisão.</strong> Esta versão é preliminar, ainda não está em vigor e contém pendências destacadas (${doc.pending}).</p>`
    }
    <article class="mt-4">
${doc.html}
    </article>
    <p class="mt-12 border-t border-line pt-6 text-sm text-fg">Leia também: <a href="/${other.slug}" class="font-medium text-link underline underline-offset-4 hover:no-underline">${other.label}</a>.</p>
  </main>
</div>
<footer class="border-t border-line bg-surface">
  <div class="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
    <p>© 2026 EduSearch</p>
    <nav aria-label="Rodapé" class="flex flex-wrap gap-x-4 gap-y-1">
      <a href="/" class="inline-flex min-h-11 items-center hover:text-link">Início</a>
      ${LEGAL_PAGES.map((p) => `<a href="/${p.slug}" class="inline-flex min-h-11 items-center hover:text-link"${p.slug === current ? ' aria-current="page"' : ""}>${p.label}</a>`).join("\n      ")}
    </nav>
  </div>
</footer>`;
}

/** Trava de publicação: documento aprovado não pode ter pendências. */
export function assertPublishable(doc: RenderedDoc): void {
  if (isApproved(doc.meta) && doc.pending > 0) {
    throw new Error(`"${doc.meta.title}" está com status "aprovado" mas tem ${doc.pending} marcador(es) [[REVISAR]] pendente(s).`);
  }
}
