import { ArrowRightIcon, Badge, GithubIcon, buttonClasses } from "@edusearch/ui";
import { GITHUB_URL } from "../constants";

const criteria = [
  { label: "Necessidade de aprendizagem", hint: "O que você quer aprender e por quê" },
  { label: "Disponibilidade", hint: "Os horários que funcionam para você" },
  { label: "Orçamento", hint: "Quanto você pode investir por aula" },
  { label: "Metodologia de ensino", hint: "O jeito de ensinar que combina com você" },
];

export default function Hero() {
  return (
    <section aria-labelledby="hero-titulo" className="relative isolate overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-soft/80 to-transparent"
      />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-12 pb-20 sm:px-8 sm:pt-20 sm:pb-28 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        <div>
          <Badge tone="primary" dot className="border border-primary/15 bg-surface">
            Em desenvolvimento · HackBrasil 2026
          </Badge>
          <h1
            id="hero-titulo"
            className="mt-6 text-4xl leading-[1.08] font-bold tracking-tight text-balance text-fg-strong sm:text-5xl lg:text-6xl"
          >
            Encontre o professor certo para você.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-pretty text-fg">
            Uma nova forma de conectar estudantes e professores, utilizando inteligência artificial
            para tornar o aprendizado mais acessível e personalizado.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <a href="#como-funciona" className={buttonClasses({ size: "lg" })}>
              Veja como funciona
              <ArrowRightIcon className="h-5 w-5" />
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses({ variant: "secondary", size: "lg" })}
            >
              <GithubIcon className="h-5 w-5" />
              Ver projeto no GitHub
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
          </div>
        </div>

        <aside
          aria-labelledby="criterios-titulo"
          className="rounded-panel border border-line bg-surface p-6 shadow-raised sm:p-8"
        >
          <p id="criterios-titulo" className="text-sm font-semibold text-fg-strong">
            O que o matching vai considerar
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            Mais do que a disciplina: o contexto real de quem quer aprender.
          </p>
          <ol className="mt-6 space-y-3">
            {criteria.map((c, i) => (
              <li key={c.label} className="flex items-start gap-4 rounded-card bg-bg p-4">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-primary-soft text-sm font-semibold text-link"
                >
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium text-fg-strong">{c.label}</p>
                  <p className="text-sm text-fg-muted">{c.hint}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}
