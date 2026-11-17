import { Suspense, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { ArrowLeftIcon, LoadingState, Logo } from "@edusearch/ui";

/** Suspense para telas carregadas sob demanda sem layout próprio. */
export function SuspenseOutlet() {
  return (
    <Suspense fallback={<LoadingState label="Carregando…" className="min-h-dvh" />}>
      <Outlet />
    </Suspense>
  );
}

/** Layout simples para telas públicas intermediárias (ex.: escolha de perfil). */
export function PublicLayout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-5 sm:h-20 sm:px-8">
        <Link to="/" aria-label="EduSearch — início" className="rounded-md">
          <Logo className="h-8" />
        </Link>
        <Link
          to="/"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-sm font-medium text-fg-muted transition-colors hover:text-link"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Início
        </Link>
      </header>
      <main id="conteudo-principal" className="flex flex-1 flex-col">
        <Suspense fallback={<LoadingState label="Carregando…" />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="px-5 py-6 text-center text-xs text-fg-muted">HackBrasil 2026 · Versão de demonstração</footer>
    </div>
  );
}
