import { GithubIcon, Logo } from "@edusearch/ui";
import { GITHUB_URL, NAV_LINKS } from "../constants";

export default function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1.2fr_1fr]">
        <div>
          <Logo className="h-8" />
          <p className="mt-4 max-w-xs text-fg">Encontre o professor certo para você.</p>
          <p className="mt-4 text-sm text-fg-muted">
            Projeto independente · HackBrasil 2026 · Trilha 03 — Acesso à Educação
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-2">
          <nav aria-label="Rodapé">
            <p className="text-sm font-semibold text-fg-strong">Navegação</p>
            <ul className="mt-3 space-y-1">
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="inline-flex min-h-9 items-center text-sm text-fg hover:text-link">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <p className="text-sm font-semibold text-fg-strong">Projeto</p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex min-h-9 items-center gap-2 text-sm text-fg hover:text-link"
            >
              <GithubIcon className="h-4 w-4" />
              Código no GitHub
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
          </div>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-5 py-5 text-sm text-fg-muted sm:px-8">
          © 2026 EduSearch · Licença MIT
        </p>
      </div>
    </footer>
  );
}
