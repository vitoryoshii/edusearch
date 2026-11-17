import { cn } from "../lib/cn";

/**
 * Logotipo horizontal do EduSearch.
 *
 * Cada app serve os arquivos em `public/brand/`:
 * - logo.webp       → derivado de assets/branding/logo-horizontal.png (referência temporária)
 * - logo-dark.webp  → derivado de assets/branding/logos/logo-dark.png (provisório)
 *
 * As duas versões ficam no DOM e o tema decide qual aparece, evitando
 * o logotipo escuro sobre fundo escuro (proibido em docs/branding.md).
 * Proporção oficial preservada: 498×96.
 */
export function Logo({
  className = "h-8",
  surface = "auto",
}: {
  className?: string;
  /** "auto" segue o tema; "dark" força a versão para fundos escuros. */
  surface?: "auto" | "light" | "dark";
}) {
  const common = cn("w-auto", className);
  if (surface === "light") return <img src="/brand/logo.webp" alt="EduSearch" width={498} height={96} className={common} />;
  if (surface === "dark") return <img src="/brand/logo-dark.webp" alt="EduSearch" width={498} height={96} className={common} />;
  return (
    <>
      <img src="/brand/logo.webp" alt="EduSearch" width={498} height={96} className={cn(common, "dark:hidden")} />
      <img
        src="/brand/logo-dark.webp"
        alt="EduSearch"
        width={498}
        height={96}
        loading="lazy"
        className={cn(common, "hidden dark:block")}
      />
    </>
  );
}
