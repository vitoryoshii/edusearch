import Section from "./Section";
import { ShieldIcon, SparkIcon, UserIcon, VideoIcon } from "./icons";

const items = [
  {
    icon: SparkIcon,
    title: "Matching pedagógico inteligente",
    text: "Inteligência artificial para recomendar professores considerando objetivo, disponibilidade, orçamento e metodologia de ensino.",
  },
  {
    icon: ShieldIcon,
    title: "Segurança e transparência",
    text: "Perfis com informações e credenciais dos professores, e pagamentos via Pix com regras claras de repasse.",
  },
  {
    icon: VideoIcon,
    title: "Aulas online",
    text: "Aulas por videochamada, com agendamento integrado ao calendário, de qualquer lugar.",
  },
  {
    icon: UserIcon,
    title: "Aprendizado personalizado",
    text: "Cada estudante tem necessidades diferentes. A experiência se adapta a elas, e não o contrário.",
  },
];

export default function Differentials() {
  return (
    <Section
      id="diferenciais"
      eyebrow="Diferenciais"
      title="Conexões baseadas em necessidades reais"
      description="O diferencial do EduSearch é ir além da busca por disciplina e entender o contexto de cada estudante."
    >
      <div className="grid gap-6 md:grid-cols-2">
        {items.map((d) => (
          <article
            key={d.title}
            className="flex gap-5 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-verde-claro text-esmeralda">
              <d.icon className="h-6 w-6" />
            </span>
            <div>
              <h3 className="text-lg font-semibold text-profundo">{d.title}</h3>
              <p className="mt-2 leading-relaxed text-slate-600">{d.text}</p>
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}
