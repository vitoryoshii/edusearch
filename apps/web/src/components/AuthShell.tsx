import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { CalendarIcon, Logo, SparkleIcon, UserIcon, cn } from "@edusearch/ui";

const VALUE_POINTS = [
  { icon: SparkleIcon, text: "Recomendações a partir do seu objetivo e do seu jeito de aprender." },
  { icon: UserIcon, text: "Perfis com formação, metodologia e valores claros." },
  { icon: CalendarIcon, text: "Agendamento simples e aulas online." },
];

/**
 * Painel institucional (somente desktop). Fica sobre o azul profundo da marca
 * nos dois temas, por isso usa a variante do logo para fundo escuro.
 */
export function BrandPanel({ headingLevel = "p" }: { headingLevel?: "h1" | "p" }) {
  const Heading = headingLevel;
  return (
    <div className="flex h-full flex-col justify-between gap-12 p-10 xl:p-14">
      <Link to="/" aria-label="EduSearch — início" className="w-fit rounded-md focus-visible:outline-white">
        <Logo surface="dark" className="h-9" />
      </Link>
      <div className="max-w-md">
        <Heading className="text-4xl leading-[1.1] font-bold tracking-tight text-balance text-white xl:text-5xl">
          Encontre o professor certo para você.
        </Heading>
        <p className="mt-5 text-lg leading-relaxed text-slate-300">
          Aprenda no seu ritmo com professores compatíveis com seus objetivos.
        </p>
        <ul className="mt-10 space-y-4">
          {VALUE_POINTS.map((v) => (
            <li key={v.text} className="flex items-start gap-3 text-slate-200">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-white/10 text-verde-claro">
                <v.icon className="h-4.5 w-4.5" />
              </span>
              <span className="pt-1 text-[0.9375rem] leading-relaxed">{v.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-sm text-slate-400">HackBrasil 2026 · Trilha 03 — Acesso à Educação · Versão de demonstração</p>
    </div>
  );
}

/**
 * Layout das telas de entrada (boas-vindas, login, cadastro).
 * Desktop: painel institucional + coluna de acesso. Mobile: só a coluna,
 * com o logo no topo e respeito às safe areas do PWA.
 */
export function AuthShell({
  children,
  panel = <BrandPanel />,
  mobileLogo = true,
  width = "sm",
}: {
  children: ReactNode;
  panel?: ReactNode;
  mobileLogo?: boolean;
  width?: "sm" | "md";
}) {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="sticky top-0 hidden h-dvh bg-profundo lg:block">{panel}</aside>

      <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        {mobileLogo && (
          <header className="px-5 pt-6 sm:px-8 sm:pt-8 lg:hidden">
            <Link to="/" aria-label="EduSearch — início" className="inline-block rounded-md">
              <Logo className="h-8" />
            </Link>
          </header>
        )}
        <main id="conteudo-principal" className="flex flex-1 items-start justify-center px-5 py-8 sm:items-center sm:px-8 sm:py-12">
          <div className={cn("w-full animate-slide-up", width === "sm" ? "max-w-[25rem]" : "max-w-lg")}>{children}</div>
        </main>
        <footer className="px-5 pb-6 text-center text-xs text-fg-muted lg:hidden">
          HackBrasil 2026 · Versão de demonstração
        </footer>
      </div>
    </div>
  );
}
