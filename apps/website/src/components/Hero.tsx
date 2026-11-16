import { GITHUB_URL } from "../constants";
import { GithubIcon } from "./icons";

const criteria = [
  { label: "Necessidade de aprendizagem", hint: "O que você quer aprender e por quê" },
  { label: "Disponibilidade", hint: "Os horários que funcionam para você" },
  { label: "Orçamento", hint: "Quanto você pode investir por aula" },
  { label: "Metodologia de ensino", hint: "O jeito de ensinar que combina com você" },
];

export default function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-verde-claro/70 to-transparent"
      />
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 pt-16 pb-20 sm:px-8 sm:pt-24 sm:pb-28 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-petroleo/20 bg-white px-3 py-1 text-xs font-medium text-petroleo">
            <span className="h-1.5 w-1.5 rounded-full bg-esmeralda" aria-hidden="true" />
            Em desenvolvimento · HackBrasil 2026
          </span>
          <h1 className="mt-6 text-4xl leading-[1.1] font-bold tracking-tight text-profundo sm:text-5xl lg:text-6xl">
            Encontre o professor certo para você.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
            Uma nova forma de conectar estudantes e professores, utilizando inteligência artificial
            para tornar o aprendizado mais acessível e personalizado.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <a
              href="#sobre"
              className="inline-flex items-center justify-center rounded-lg bg-petroleo px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-petroleo-dark"
            >
              Conheça o EduSearch
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-profundo transition-colors hover:border-petroleo hover:text-petroleo"
            >
              <GithubIcon className="h-5 w-5" />
              Ver projeto no GitHub
            </a>
          </div>
        </div>

        <aside
          aria-label="Critérios considerados no matching"
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
        >
          <p className="text-sm font-semibold text-profundo">O que o matching vai considerar</p>
          <p className="mt-1 text-sm text-slate-500">
            Mais do que a disciplina: o contexto real de quem quer aprender.
          </p>
          <ul className="mt-6 space-y-3">
            {criteria.map((c, i) => (
              <li
                key={c.label}
                className="flex items-start gap-4 rounded-xl border border-slate-100 bg-gelo p-4"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-petroleo/10 text-sm font-semibold text-petroleo">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium text-profundo">{c.label}</p>
                  <p className="text-sm text-slate-500">{c.hint}</p>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
