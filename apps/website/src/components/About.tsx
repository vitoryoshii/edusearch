import Section from "./Section";

const facts = [
  { label: "Evento", value: "HackBrasil 2026" },
  { label: "Trilha", value: "03 — Acesso à Educação" },
  { label: "Status", value: "Em desenvolvimento" },
];

export default function About() {
  return (
    <Section id="sobre" eyebrow="Sobre o EduSearch" title="Tornar o professor certo acessível a mais pessoas">
      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5 text-lg leading-relaxed text-pretty text-fg">
          <p>
            O <strong className="font-semibold text-fg-strong">EduSearch</strong> é um marketplace
            educacional que conecta estudantes a professores por meio de recomendações
            personalizadas. Em vez de escolher apenas por disciplina ou preço, a proposta é
            considerar a necessidade real de aprendizagem, a disponibilidade, o orçamento e a
            metodologia de ensino.
          </p>
          <p>
            O projeto está sendo desenvolvido para o{" "}
            <strong className="font-semibold text-fg-strong">HackBrasil 2026</strong>, na{" "}
            <strong className="font-semibold text-fg-strong">Trilha 03 — Acesso à Educação</strong>.
            Esta página apresenta a proposta; o aplicativo está em construção.
          </p>
        </div>
        <dl className="grid gap-3 self-start">
          {facts.map((f) => (
            <div key={f.label} className="rounded-card border border-line bg-surface p-5 shadow-card">
              <dt className="text-sm text-fg-muted">{f.label}</dt>
              <dd className="mt-1 font-semibold text-fg-strong">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
