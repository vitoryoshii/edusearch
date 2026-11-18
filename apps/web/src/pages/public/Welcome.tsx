import { Link } from "react-router";
import { ArrowRightIcon, ChevronRightIcon, SparkleIcon, buttonClasses } from "@edusearch/ui";
import { homeFor, useSession } from "../../app/session";
import { AuthShell, BrandPanel } from "../../components/AuthShell";

/**
 * Boas-vindas.
 * Desktop: o painel institucional carrega o título (h1); a coluna da direita
 * concentra as ações. Mobile: título curto + ações, sem introdução extensa.
 */
export default function Welcome() {
  const { session } = useSession();

  return (
    <AuthShell panel={<BrandPanel headingLevel="h1" />}>
      {/* Mensagem principal no mobile/tablet (no desktop ela está no painel) */}
      <div className="lg:hidden">
        <h1 className="text-[2rem] leading-[1.12] font-bold tracking-tight text-balance text-fg-strong sm:text-4xl">
          Encontre o professor certo para você.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-fg sm:text-lg">
          Aprenda no seu ritmo com professores compatíveis com seus objetivos.
        </p>
      </div>

      <div className="hidden lg:block">
        <h2 className="text-2xl font-semibold tracking-tight text-fg-strong">Comece por aqui</h2>
        <p className="mt-2 text-fg-muted">Crie sua conta ou explore o aplicativo com dados de demonstração.</p>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {session && (
          <Link to={homeFor(session.role)} className={buttonClasses({ size: "lg", fullWidth: true })}>
            Continuar como {session.name}
            <ArrowRightIcon className="h-5 w-5" />
          </Link>
        )}
        <Link
          to="/cadastro"
          className={buttonClasses({ size: "lg", fullWidth: true, variant: session ? "secondary" : "primary" })}
        >
          Começar agora
        </Link>
        <Link to="/entrar" className={buttonClasses({ size: "lg", fullWidth: true, variant: "secondary" })}>
          Já tenho uma conta
        </Link>
      </div>

      <div className="my-7 flex items-center gap-3 text-xs text-fg-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        ou
        <span className="h-px flex-1 bg-line" />
      </div>

      <Link
        to="/perfil-de-acesso"
        className="group flex min-h-16 items-center gap-4 rounded-card border border-line bg-surface px-4 py-3 transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-card"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary-soft text-link">
          <SparkleIcon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-fg-strong">Explorar demonstração</span>
          <span className="block text-sm text-fg-muted">Entre como aluno ou professor, sem cadastro.</span>
        </span>
        <ChevronRightIcon className="h-5 w-5 shrink-0 text-fg-muted transition-transform duration-150 group-hover:translate-x-0.5" />
      </Link>
    </AuthShell>
  );
}
