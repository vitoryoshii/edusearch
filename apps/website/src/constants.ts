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
