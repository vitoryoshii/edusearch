import { useNavigate } from "react-router";
import { CheckIcon, ChevronRightIcon, GraduationIcon, UsersIcon } from "@edusearch/ui";
import { useAuth, writeRoleIntent } from "../../app/auth";
import { firstNameOf } from "../../lib/auth/profile";
import { ONBOARDING_PATH, type AccountRole } from "../../lib/onboarding";

const OPTIONS: Array<{ role: AccountRole; title: string; points: string[]; icon: typeof UsersIcon }> = [
  { role: "student", title: "Quero aprender", points: ["Encontrar professores", "Agendar aulas", "Acompanhar meu aprendizado"], icon: GraduationIcon },
  { role: "teacher", title: "Quero ensinar", points: ["Apresentar especialidades", "Disponibilizar horários", "Receber solicitações de alunos"], icon: UsersIcon },
];

/**
 * Primeiro acesso da conta real: escolha entre aprender e ensinar.
 * A escolha é só uma preferência de interface (neste navegador) até a API de
 * perfis existir — não concede permissões nem conclui o cadastro.
 */
export default function AccountWelcome() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  if (!profile) return null;

  const choose = (role: AccountRole) => {
    writeRoleIntent(profile.id, role);
    navigate(ONBOARDING_PATH[role]);
  };

  return (
    <div className="pt-4 sm:pt-8">
      <h1 className="text-2xl font-semibold tracking-tight text-balance text-fg-strong sm:text-3xl">
        Olá, {firstNameOf(profile)}! Como você quer usar o EduSearch?
      </h1>
      <p className="mt-2 text-fg-muted">Você pode mudar essa escolha depois.</p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <li key={o.role}>
            <button
              type="button"
              onClick={() => choose(o.role)}
              aria-describedby={`pontos-${o.role}`}
              data-role={o.role}
              className="group flex h-full w-full flex-col rounded-panel border-2 border-line bg-surface p-6 text-left transition-[border-color,box-shadow] duration-150 hover:border-primary hover:shadow-card"
            >
              <span className="flex w-full items-center justify-between">
                <span className="flex h-12 w-12 items-center justify-center rounded-control bg-primary-soft text-link transition-colors group-hover:bg-primary group-hover:text-primary-fg">
                  <o.icon className="h-6 w-6" />
                </span>
                <ChevronRightIcon className="h-5 w-5 text-fg-muted transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="mt-5 text-lg font-semibold text-fg-strong">{o.title}</span>
              <span id={`pontos-${o.role}`} className="mt-3 block space-y-2">
                {o.points.map((p) => (
                  <span key={p} className="flex items-center gap-2 text-sm text-fg">
                    <CheckIcon className="h-4 w-4 shrink-0 text-success-text" />
                    {p}
                  </span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-sm leading-relaxed text-fg-muted">
        Esta escolha prepara as próximas etapas e fica salva só neste navegador. Ela não é um cadastro concluído: o perfil
        será confirmado pelo servidor quando a API de perfis estiver disponível.
      </p>
    </div>
  );
}
