export const GITHUB_URL = "https://github.com/vitoryoshii/edusearch";

/** URL pública do aplicativo de demonstração (opcional). Sem valor, o link não aparece. */
export const APP_URL: string | undefined = import.meta.env.VITE_APP_URL || undefined;

export const NAV_LINKS = [
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#diferenciais", label: "Diferenciais" },
  { href: "#estudantes", label: "Para estudantes" },
  { href: "#professores", label: "Para professores" },
  { href: "#sobre", label: "Sobre" },
] as const;

/**
 * Termos de Uso e Política de Privacidade (gerados de docs/legal no build).
 * Só aparecem no rodapé quando os dois documentos estão com status "aprovado";
 * rascunhos continuam acessíveis pela URL, marcados como não vigentes.
 */
export const LEGAL_LINKS: ReadonlyArray<{ href: string; label: string }> = __LEGAL_DOCS_APPROVED__
  ? [
      { href: "/termos-de-uso", label: "Termos de Uso" },
      { href: "/politica-de-privacidade", label: "Política de Privacidade" },
    ]
  : [];
