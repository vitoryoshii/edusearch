import { cn } from "../lib/cn";

/**
 * Marca EduSearch.
 *
 * Cada app serve os arquivos em `public/brand/` (gerados só por escala, sem redesenho):
 * - logo.webp         ← assets/branding/logo-horizontal.png (referência temporária)
 * - logo-dark.webp    ← assets/branding/logos/logo-dark.png (provisório)
 * - symbol.webp       ← assets/branding/logos/symbol-primary.png (provisório)
 * - symbol-dark.webp  ← assets/branding/logos/symbol-white.png (provisório)
 *
 * `surface="auto"` mantém as duas versões no DOM e o tema decide qual aparece,
 * evitando a versão escura sobre fundo escuro (proibido em docs/branding.md).
 */
const ASSETS = {
  full: { light: "/brand/logo.webp", dark: "/brand/logo-dark.webp", w: 498, h: 96 },
  symbol: { light: "/brand/symbol.webp", dark: "/brand/symbol-dark.webp", w: 152, h: 120 },
} as const;

export function Logo({
  className = "h-8",
  surface = "auto",
  variant = "full",
  decorative = false,
}: {
  className?: string;
  /** "auto" segue o tema; "light"/"dark" fixam a versão pelo fundo onde o logo está. */
  surface?: "auto" | "light" | "dark";
  /** "full" = símbolo + nome; "symbol" = somente o símbolo, para espaços compactos. */
  variant?: "full" | "symbol";
  /** Use quando o nome "EduSearch" já está visível ao lado. */
  decorative?: boolean;
}) {
  const a = ASSETS[variant];
  const common = { alt: decorative ? "" : "EduSearch", width: a.w, height: a.h, decoding: "async" as const };
  const cls = cn("w-auto select-none", className);

  if (surface !== "auto") {
    return <img src={a[surface]} {...common} className={cls} draggable={false} />;
  }
  return (
    <>
      <img src={a.light} {...common} className={cn(cls, "dark:hidden")} draggable={false} />
      <img src={a.dark} {...common} loading="lazy" className={cn(cls, "hidden dark:block")} draggable={false} />
    </>
  );
}
