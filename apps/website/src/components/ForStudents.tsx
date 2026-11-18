import { CheckIcon, GraduationIcon } from "@edusearch/ui";
import Section from "./Section";

const benefits = [
  "Conte seu objetivo com as suas palavras: ENEM, concurso, reforço escolar ou um novo idioma.",
  "Receba recomendações explicadas, com os motivos de cada professor combinar com você.",
  "Compare perfis, metodologias, disponibilidade e valores antes de decidir.",
  "Agende em poucos passos e participe da aula online, de onde estiver.",
  "Acompanhe sua evolução ao longo das aulas.",
];

const audiences = [
  "Ensino fundamental e médio",
  "Pré-vestibular e ENEM",
  "Graduação",
  "Concursos públicos",
  "Requalificação profissional",
  "Responsáveis em busca de apoio para filhos",
];

export default function ForStudents() {
  return (
    <Section
      id="estudantes"
      eyebrow="Para estudantes"
      title="Aprenda com quem entende o seu objetivo"
      description="Em vez de escolher só pela disciplina ou pelo preço, você encontra quem ensina do jeito que você aprende."
      className="bg-surface"
    >
      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <ul className="grid gap-3">
          {benefits.map((b) => (
            <li key={b} className="flex items-start gap-3 rounded-card border border-line bg-bg p-5 text-fg-strong">
              <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-success-text" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <div className="rounded-panel bg-soft p-6 sm:p-8">
          <span className="flex h-11 w-11 items-center justify-center rounded-control bg-surface text-link">
            <GraduationIcon className="h-6 w-6" />
          </span>
          <h3 className="mt-5 text-lg font-semibold text-fg-strong">Para quem é</h3>
          <ul className="mt-4 flex flex-wrap gap-2">
            {audiences.map((a) => (
              <li key={a} className="rounded-full bg-surface px-3 py-1.5 text-sm font-medium text-fg-strong">
                {a}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm leading-relaxed text-fg">
            Os recursos descritos fazem parte do escopo planejado e ainda estão em desenvolvimento.
          </p>
        </div>
      </div>
    </Section>
  );
}
