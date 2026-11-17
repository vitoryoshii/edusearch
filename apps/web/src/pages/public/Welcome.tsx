import { Link } from "react-router";
import { ArrowRightIcon, Badge, CalendarIcon, SearchIcon, SparkleIcon, TrendIcon, buttonClasses } from "@edusearch/ui";
import { homeFor, useSession } from "../../app/session";

const highlights = [
  { icon: SparkleIcon, title: "Matching pedagógico", text: "Recomendações a partir do seu objetivo, nível e jeito de aprender." },
  { icon: SearchIcon, title: "Busca com filtros", text: "Disciplina, nível, metodologia, horários e orçamento." },
  { icon: CalendarIcon, title: "Agendamento simples", text: "Escolha o horário e confirme em poucos passos." },
  { icon: TrendIcon, title: "Evolução visível", text: "Metas e anotações dos professores em um só lugar." },
];

export default function Welcome() {
  const { session } = useSession();

  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-5 py-8 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:py-16">
      <div>
        <Badge tone="demo">Versão de demonstração</Badge>
        <h1 className="mt-5 text-4xl leading-tight font-bold tracking-tight text-balance text-fg-strong sm:text-5xl">
          Encontre o professor certo para você.
        </h1>
        <p className="mt-5 max-w-lg text-lg leading-relaxed text-fg">
          O EduSearch conecta estudantes e professores com recomendações personalizadas. Explore as telas do produto com
          dados fictícios.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          {session ? (
            <Link to={homeFor(session.role)} className={buttonClasses({ size: "lg" })}>
              Continuar como {session.name}
              <ArrowRightIcon className="h-5 w-5" />
            </Link>
          ) : (
            <>
              <Link to="/cadastro" className={buttonClasses({ size: "lg" })}>
                Criar conta
              </Link>
              <Link to="/entrar" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                Já tenho conta
              </Link>
            </>
          )}
        </div>
        {!session && (
          <p className="mt-4 text-sm text-fg-muted">
            Prefere só explorar?{" "}
            <Link to="/perfil-de-acesso" className="font-medium text-link underline-offset-4 hover:underline">
              Entrar direto na demonstração
            </Link>
          </p>
        )}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {highlights.map((h) => (
          <li key={h.title} className="rounded-card border border-line bg-surface p-5 shadow-card">
            <span className="flex h-10 w-10 items-center justify-center rounded-control bg-primary-soft text-link">
              <h.icon className="h-5 w-5" />
            </span>
            <p className="mt-4 font-semibold text-fg-strong">{h.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-fg-muted">{h.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
