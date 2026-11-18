import { CheckIcon, GithubIcon } from "@edusearch/ui";
import Section from "./Section";
import { GITHUB_URL } from "../constants";

const benefits = [
  "Perfil profissional com suas informações, credenciais e metodologia.",
  "Alunos recomendados de acordo com seu estilo e sua especialidade.",
  "Agenda de aulas com link de videochamada gerado automaticamente.",
  "Recebimento via Pix, com repasse conforme as condições do provedor de pagamento.",
  "Cadastro gratuito: a plataforma será remunerada por comissão nas aulas realizadas.",
];

export default function ForTeachers() {
  return (
    <Section
      id="professores"
      eyebrow="Para professores"
      title="Mais tempo ensinando, menos tempo procurando alunos"
      description="O EduSearch está sendo pensado para que professores encontrem estudantes que realmente combinam com sua forma de ensinar."
      dark
    >
      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <ul className="grid gap-3">
          {benefits.map((b) => (
            <li key={b} className="flex items-start gap-3 rounded-card border border-white/10 bg-white/5 p-5 text-slate-100">
              <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-verde-claro" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <div className="rounded-panel border border-white/10 bg-white/5 p-6 sm:p-8">
          <h3 className="text-lg font-semibold text-white">Recursos planejados</h3>
          <p className="mt-3 leading-relaxed text-slate-300">
            Os itens ao lado fazem parte do escopo planejado do EduSearch e ainda estão em
            desenvolvimento. Acompanhe a evolução do projeto no GitHub.
          </p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-control border border-white/25 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-white"
          >
            <GithubIcon className="h-4 w-4" />
            Acompanhar no GitHub
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
        </div>
      </div>
    </Section>
  );
}
