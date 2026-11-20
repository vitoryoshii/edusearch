import type { ReactNode } from "react";
import { Logo } from "@edusearch/ui";
import { LEGAL_LINKS, legalPublished } from "../lib/legal";
import { EntryBackdrop } from "./EntryBackdrop";

/**
 * Moldura das telas de acesso: branco-gelo, curvas da marca, logo centralizado
 * (é o h1: nome acessível "EduSearch") e rodapé jurídico discreto.
 */
export function EntryFrame({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <EntryBackdrop />
      {/* Respiro lateral de 24px, ou a safe area (entalhe em paisagem no PWA), o que for maior. */}
      <main
        id="conteudo-principal"
        className="relative z-10 flex flex-1 flex-col items-center justify-center pr-[max(1.5rem,env(safe-area-inset-right))] pl-[max(1.5rem,env(safe-area-inset-left))] py-20 sm:py-24"
      >
        <div className="w-full max-w-[22rem] animate-slide-up">
          <div className="text-center">
            <h1>
              <Logo className="mx-auto h-12 sm:h-14" />
            </h1>
            {subtitle && <p className="mt-5 text-lg font-medium tracking-tight text-balance text-fg-strong sm:text-xl">{subtitle}</p>}
          </div>
          <div className="mt-10">{children}</div>
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}

/**
 * Texto jurídico. Os nomes só viram links quando os documentos estão
 * PUBLICADOS (VITE_LEGAL_TERMS_URL e VITE_LEGAL_PRIVACY_URL). Não há aceite
 * implícito nem caixa de seleção fictícia.
 */
export function LegalFooter() {
  const link = (href: string | null, label: string) =>
    href ? (
      <a href={href} className="font-medium text-fg underline underline-offset-4 hover:text-link" target="_blank" rel="noreferrer">
        {label}
        <span className="sr-only"> (abre em nova aba)</span>
      </a>
    ) : (
      <span className="font-medium text-fg">{label}</span>
    );
  return (
    <footer className="relative z-10 px-4 pb-5 text-center text-xs leading-relaxed text-fg-muted">
      {/* Fundo sólido: o texto continua legível sobre as curvas decorativas. */}
      <p className="mx-auto w-fit max-w-sm rounded-2xl bg-bg px-4 py-2" data-testid={legalPublished ? "legal-links" : "legal-pending"}>
        Ao continuar, você poderá consultar nossos {link(LEGAL_LINKS.terms, "Termos de Uso")} e nossa{" "}
        {link(LEGAL_LINKS.privacy, "Política de Privacidade")}.
      </p>
    </footer>
  );
}
