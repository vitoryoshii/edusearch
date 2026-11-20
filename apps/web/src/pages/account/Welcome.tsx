import { useState } from "react";
import { useNavigate } from "react-router";
import { AlertIcon, CheckIcon, ChevronRightIcon, GraduationIcon, Spinner, UsersIcon } from "@edusearch/ui";
import { useAccount, useDisplayProfile } from "../../app/account";
import { writeRoleIntent } from "../../app/auth";
import { accountApi } from "../../lib/api/account";
import { describeError } from "../../lib/api/client";
import { firstNameOf } from "../../lib/auth/profile";
import { ONBOARDING_PATH, type AccountRole } from "../../lib/onboarding";

const OPTIONS: Array<{ role: AccountRole; title: string; points: string[]; icon: typeof UsersIcon }> = [
  { role: "student", title: "Quero aprender", points: ["Encontrar professores", "Agendar aulas", "Acompanhar meu aprendizado"], icon: GraduationIcon },
  { role: "teacher", title: "Quero ensinar", points: ["Apresentar especialidades", "Disponibilizar horários", "Receber solicitações de alunos"], icon: UsersIcon },
];

/**
 * Primeiro acesso da conta real: escolha entre aprender e ensinar.
 * - Modo servidor (persistência ligada): o papel é gravado pela API (POST /v1/me/roles) e só
 *   depois do sucesso a tela avança. Nada é guardado no navegador.
 * - Modo prévia: preferência local de interface, sem permissões (comportamento anterior).
 */
export default function AccountWelcome() {
  const profile = useDisplayProfile();
  const account = useAccount();
  const navigate = useNavigate();
  const [saving, setSaving] = useState<AccountRole | null>(null);
  const [error, setError] = useState<{ role: AccountRole; message: string } | null>(null);
  if (!profile) return null;
  const server = account.mode === "server";

  const choose = async (role: AccountRole) => {
    if (!server) {
      writeRoleIntent(profile.id, role);
      navigate(ONBOARDING_PATH[role]);
      return;
    }
    if (saving) return;
    setSaving(role);
    setError(null);
    try {
      const me = await accountApi.selectRole(role);
      account.setMe(me);
      navigate(ONBOARDING_PATH[role]);
    } catch (e) {
      setError({ role, message: describeError(e) });
      setSaving(null);
    }
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
              onClick={() => void choose(o.role)}
              aria-describedby={`pontos-${o.role}`}
              aria-busy={saving === o.role}
              disabled={saving !== null}
              data-role={o.role}
              className="group flex h-full w-full flex-col rounded-panel border-2 border-line bg-surface p-6 text-left transition-[border-color,box-shadow] duration-150 hover:border-primary hover:shadow-card"
            >
              <span className="flex w-full items-center justify-between">
                <span className="flex h-12 w-12 items-center justify-center rounded-control bg-primary-soft text-link transition-colors group-hover:bg-primary group-hover:text-primary-fg">
                  <o.icon className="h-6 w-6" />
                </span>
                {saving === o.role ? (
                  <Spinner className="h-5 w-5 text-link" />
                ) : (
                  <ChevronRightIcon className="h-5 w-5 text-fg-muted transition-transform group-hover:translate-x-0.5" />
                )}
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

      <p className="sr-only" aria-live="polite">
        {saving ? "Salvando sua escolha…" : ""}
      </p>

      {error && (
        <p role="alert" className="mt-6 flex items-start gap-2 text-sm text-danger-text" data-testid="role-error">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Não foi possível salvar sua escolha. {error.message}{" "}
            <button type="button" className="font-semibold underline underline-offset-4" onClick={() => void choose(error.role)}>
              Tentar novamente
            </button>
          </span>
        </p>
      )}

      {server ? (
        <p className="mt-8 text-sm leading-relaxed text-fg-muted">
          Sua escolha é salva na sua conta. Depois você pode adicionar o outro perfil em Meu perfil.
        </p>
      ) : (
        <p className="mt-8 text-sm leading-relaxed text-fg-muted">
          Esta escolha prepara as próximas etapas e fica salva só neste navegador. Ela não é um cadastro concluído: o perfil
          será confirmado pelo servidor quando a API de perfis estiver disponível.
        </p>
      )}
    </div>
  );
}
