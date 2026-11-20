import { useState } from "react";
import { Link } from "react-router";
import { AlertIcon, Badge, Button, Card, CheckCircleIcon, ClockIcon, buttonClasses, useToast } from "@edusearch/ui";
import { useAccount, useDisplayProfile, useServerMe } from "../../app/account";
import { CompletionSteps, ProfileSummary, ROLE_LABEL, RoleChoice, useRoleIntent } from "../../components/AccountProfile";
import { PageHeader, SectionTitle } from "../../components/PageHeader";
import { accountApi, type AccountRole, type Me } from "../../lib/api/account";
import { describeError } from "../../lib/api/client";
import type { AuthenticatedProfile } from "../../lib/auth/profile";
import { ONBOARDING_PATH } from "../../lib/onboarding";

/**
 * Meu perfil (conta real).
 * - Modo servidor: papéis e estado do cadastro vindos da API; adicionar o outro papel grava no servidor.
 * - Modo prévia: papel pretendido local e conclusão bloqueada (comportamento anterior).
 * A foto serve só para identificação visual — não comprova credencial profissional.
 */
export default function AccountProfile() {
  const profile = useDisplayProfile();
  const account = useAccount();
  if (!profile) return null;
  return account.mode === "server" ? <ServerProfile profile={profile} /> : <PreviewProfile key={profile.id} profile={profile} />;
}

function ServerProfile({ profile }: { profile: AuthenticatedProfile }) {
  const me = useServerMe();
  if (!me) return null;
  return (
    <>
      <PageHeader title="Meu perfil" description="Seus perfis no EduSearch e o estado do cadastro." />
      <div className="space-y-8">
        <Card>
          <ProfileSummary profile={profile} size="xl" />
          <p className="mt-4 text-xs leading-relaxed text-fg-muted">
            Você pode mudar o nome e a foto exibidos em{" "}
            <Link to="/conta/configuracoes" className="font-semibold text-link underline-offset-4 hover:underline">
              Configurações
            </Link>
            . A foto serve apenas para identificação visual e não comprova formação ou credenciais profissionais.
          </p>
        </Card>
        <section aria-labelledby="perfis">
          <SectionTitle id="perfis">Seus perfis</SectionTitle>
          <ServerRoles me={me} />
        </section>
      </div>
    </>
  );
}

const ROLE_TEXT: Record<AccountRole, string> = {
  student: "Encontrar professores, agendar e acompanhar minhas aulas.",
  teacher: "Criar meu perfil profissional e receber alunos.",
};

function ServerRoles({ me }: { me: Me }) {
  const account = useAccount();
  const toast = useToast();
  const [adding, setAdding] = useState<AccountRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async (role: AccountRole) => {
    if (adding || account.mode !== "server") return;
    setAdding(role);
    setError(null);
    try {
      account.setMe(await accountApi.selectRole(role));
      toast({ tone: "success", title: `Perfil de ${ROLE_LABEL[role].toLowerCase()} adicionado` });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="space-y-3">
      {(["student", "teacher"] as const).map((role) => {
        const held = me.roles.includes(role);
        const state = me.onboarding[role];
        const done = state?.status === "completed";
        return (
          <Card key={role} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`role-${role}`} data-held={held}>
            <div className="flex items-start gap-3">
              {done ? <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-success-text" /> : <ClockIcon className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted" />}
              <div>
                <p className="flex flex-wrap items-center gap-2 font-semibold text-fg-strong">
                  {ROLE_LABEL[role]}
                  {held ? <Badge tone={done ? "success" : "warning"}>{done ? "Cadastro salvo" : "Cadastro pendente"}</Badge> : <Badge>Não ativado</Badge>}
                </p>
                <p className="mt-1 text-sm text-fg-muted">{ROLE_TEXT[role]}</p>
              </div>
            </div>
            {held ? (
              <Link to={ONBOARDING_PATH[role]} className={buttonClasses({ variant: "secondary", className: "shrink-0" })}>
                {done ? "Revisar cadastro" : "Continuar cadastro"}
              </Link>
            ) : (
              <Button variant="secondary" className="shrink-0" loading={adding === role} onClick={() => void add(role)}>
                Adicionar perfil
              </Button>
            )}
          </Card>
        );
      })}
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger-text">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          Não foi possível adicionar o perfil. {error}
        </p>
      )}
    </div>
  );
}

function PreviewProfile({ profile }: { profile: AuthenticatedProfile }) {
  const [role, choose] = useRoleIntent(profile.id);

  return (
    <>
      <PageHeader title="Meu perfil" description="Dados básicos da sua conta Google e conclusão do cadastro." />

      <div className="space-y-8">
        <Card>
          <ProfileSummary profile={profile} size="xl" />
          <p className="mt-4 text-xs leading-relaxed text-fg-muted">
            Nome, e-mail e foto vêm da sua conta Google. A foto serve apenas para identificação visual e não comprova
            formação ou credenciais profissionais. Em breve será possível usar uma foto personalizada.
          </p>
        </Card>

        <section aria-labelledby="papel">
          <SectionTitle id="papel">Como você quer usar o EduSearch?</SectionTitle>
          <p className="-mt-1 mb-4 text-sm text-fg-muted">
            Escolha provisória: fica salva só neste navegador e não concede permissões. O perfil efetivo será confirmado
            pelo servidor.
          </p>
          <RoleChoice value={role} onChange={choose} />
        </section>

        <section aria-labelledby="conclusao">
          <SectionTitle id="conclusao">Conclusão do cadastro</SectionTitle>
          <CompletionSteps role={role} />
          <Button className="mt-5" size="lg" aria-describedby="perfil-indisponivel" disabled>
            Concluir perfil
          </Button>
          <p id="perfil-indisponivel" className="mt-2 text-sm text-fg-muted">
            Disponível quando a API de perfis, as autorizações do servidor e os documentos jurídicos estiverem publicados.
          </p>
        </section>
      </div>
    </>
  );
}
