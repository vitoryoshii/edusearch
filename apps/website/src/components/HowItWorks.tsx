import Section from "./Section";
import { CalendarIcon, ChatIcon, SearchIcon, TrendIcon } from "./icons";

const steps = [
  {
    icon: ChatIcon,
    title: "Conte o que deseja aprender.",
    text: "Descreva seu objetivo, seu nível atual, sua disponibilidade e quanto pode investir.",
  },
  {
    icon: SearchIcon,
    title: "Descubra professores compatíveis.",
    text: "Receba recomendações de professores alinhados às suas necessidades e ao seu jeito de aprender.",
  },
  {
    icon: CalendarIcon,
    title: "Agende sua aula.",
    text: "Escolha o melhor horário e participe da aula online, sem complicação.",
  },
  {
    icon: TrendIcon,
    title: "Evolua no seu ritmo.",
    text: "Acompanhe seu progresso e ajuste a jornada conforme você avança.",
  },
];

export default function HowItWorks() {
  return (
    <Section
      id="como-funciona"
      eyebrow="Como funciona"
      title="Do objetivo à aula em quatro passos"
      description="Uma jornada simples, pensada para quem quer aprender com o professor certo."
      className="bg-white"
    >
      <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-2xl border border-slate-200 bg-gelo p-6">
            <div className="flex items-center justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-petroleo text-white">
                <s.icon className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold text-slate-400" aria-hidden="true">
                0{i + 1}
              </span>
            </div>
            <h3 className="mt-6 text-lg font-semibold text-profundo">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.text}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
