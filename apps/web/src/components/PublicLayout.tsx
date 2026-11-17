import { Suspense, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { LoadingState, Logo } from "@edusearch/ui";

/** Layout das telas públicas (apresentação, login, cadastro, escolha de perfil). */
export function PublicLayout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-5 sm:px-8">
        <Link to="/" aria-label="EduSearch — início" className="rounded-md">
          <Logo className="h-8" />
        </Link>
      </header>
      <main id="conteudo-principal" className="flex flex-1 flex-col">
        <Suspense fallback={<LoadingState label="Carregando…" />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="px-5 py-6 text-center text-xs text-fg-muted">
        EduSearch · Projeto HackBrasil 2026 · Versão de demonstração
      </footer>
    </div>
  );
}

/** Contêiner centralizado para formulários públicos. */
export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-start justify-center px-4 pt-4 pb-12 sm:items-center sm:pt-0">
      <div className="w-full max-w-md rounded-panel border border-line bg-surface p-6 shadow-raised sm:p-8">{children}</div>
    </div>
  );
}
