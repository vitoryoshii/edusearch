import { Link, Navigate } from "react-router";
import { ArrowRightIcon, Badge, Card, CheckCircleIcon, ClockIcon, ShieldIcon, buttonClasses } from "@edusearch/ui";
import { useAccount, useDisplayProfile, useServerMe } from "../../app/account";
import { ProfileSummary, ProvisionalBadge, ROLE_LABEL, useRoleIntent } from "../../components/AccountProfile";
import { PageHeader } from "../../components/PageHeader";
import type { Me } from "../../lib/api/account";
import { firstNameOf, type AuthenticatedProfile } from "../../lib/auth/profile";
import { ONBOARDING_PATH, WELCOME_PATH } from "../../lib/onboarding";

/** Início da conta real: identidade, conclusão do cadastro e limites da fase de testes. */
export default function AccountDashboard() {
  const profile = useDisplayProfile();
  const account = useAccount();
  if (!profile) return null; // RequireAuth garante a sessão.
  return account.mode === "server" ? <ServerDashboard profile={profile} /> : <PreviewDashboard key={profile.id} profile={profile} />;
}

/* ------------------------------- Modo servidor ------------------------------- */

function ServerDashboard({ profile }: { profile: AuthenticatedProfile }) {
  const me = useServerMe();
  if (!me) return null; // RequireAccount garante o carregamento.
  // Primeiro acesso: nenhum papel PERSISTIDO no servidor → boas-vindas.
  if (me.roles.length === 0) return <Navigate to={WELCOME_PATH} replace />;

  return (
    <>
      <PageHeader title={`Olá, ${firstNameOf(profile)}!`} description="Esta é a sua conta EduSearch." />
      <div className="space-y-5">
        <Card>
          <ProfileSummary profile={profile} />
        </Card>
        {me.onboarding.student && <StudentStatus status={me.onboarding.student.status} />}
        {me.onboarding.teacher && <TeacherStatus teacher={me.onboarding.teacher} />}
        <CommercialNotice />
      </div>
    </>
  );
}

function StatusIcon({ done }: { done: boolean }) {
  return done ? <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-success-text" /> : <ClockIcon className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted" />;
}

function StudentStatus({ status }: { status: "pending" | "completed" }) {
  const done = status === "completed";
  return (
    <Card tone={done ? undefined : "soft"} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-testid="student-status" data-status={status}>
      <div className="flex items-start gap-3">
        <StatusIcon done={done} />
        <div>
          <p className="flex flex-wrap items-center gap-2 font-semibold text-fg-strong">
            Cadastro de aluno {done ? <Badge tone="success">Concluído</Badge> : <Badge tone="warning">Pendente</Badge>}
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            {done ? "Suas preferências de estudo estão salvas na sua conta." : "Conte o que você quer aprender para concluir seu cadastro."}
          </p>
        </div>
      </div>
      <Link to={ONBOARDING_PATH.student} className={buttonClasses({ variant: done ? "secondary" : "primary", className: "shrink-0" })}>
        {done ? "Revisar cadastro" : "Continuar cadastro"}
        <ArrowRightIcon className="h-4 w-4" />
      </Link>
    </Card>
  );
}

function TeacherStatus({ teacher }: { teacher: NonNullable<Me["onboarding"]["teacher"]> }) {
  const done = teacher.status === "completed";
  const verification =
    teacher.verification_status === "approved" ? "Aprovado" : teacher.verification_status === "rejected" ? "Não aprovado" : "Em análise";
  return (
    <Card tone={done ? undefined : "soft"} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-testid="teacher-status" data-status={teacher.status}>
      <div className="flex items-start gap-3">
        <StatusIcon done={done} />
        <div>
          <p className="flex flex-wrap items-center gap-2 font-semibold text-fg-strong">
            Cadastro de professor {done ? <Badge tone="success">Salvo</Badge> : <Badge tone="warning">Pendente</Badge>}
          </p>
          {done ? (
            <p className="mt-1 text-sm text-fg-muted" data-testid="teacher-visibility">
              Verificação: <strong className="font-semibold text-fg-strong">{verification}</strong> ·{" "}
              {teacher.is_published ? "Perfil publicado para alunos." : "Perfil não publicado: ele só aparece para alunos depois da aprovação."}
            </p>
          ) : (
            <p className="mt-1 text-sm text-fg-muted">Apresente suas aulas para concluir seu cadastro.</p>
          )}
        </div>
      </div>
      <Link to={ONBOARDING_PATH.teacher} className={buttonClasses({ variant: done ? "secondary" : "primary", className: "shrink-0" })}>
        {done ? "Revisar cadastro" : "Continuar cadastro"}
        <ArrowRightIcon className="h-4 w-4" />
      </Link>
    </Card>
  );
}

function CommercialNotice() {
  return (
    <Card tone="muted" className="flex items-start gap-3 text-sm">
      <ShieldIcon className="mt-0.5 h-5 w-5 shrink-0 text-link" />
      <div>
        <p className="font-semibold text-fg-strong">Conta ainda não habilitada para uso comercial</p>
        <p className="mt-1 leading-relaxed text-fg">
          Nesta fase de testes não é possível agendar aulas nem fazer pagamentos reais. A demonstração continua disponível com
          dados fictícios, separados da sua conta — nada dela é copiado para cá.
        </p>
        <Link to="/perfil-de-acesso" className="mt-2 inline-flex min-h-11 items-center font-semibold text-link underline-offset-4 hover:underline">
          Explorar a demonstração
        </Link>
      </div>
    </Card>
  );
}

/* ------------------------------- Modo prévia (persistência desligada) ------------------------------- */

function PreviewDashboard({ profile }: { profile: AuthenticatedProfile }) {
  const [role] = useRoleIntent(profile.id);
  // Primeiro acesso (nenhum papel escolhido): boas-vindas com as duas opções.
  if (role === null) return <Navigate to={WELCOME_PATH} replace />;

  return (
    <>
      <PageHeader title={`Olá, ${firstNameOf(profile)}!`} description="Esta é a sua conta EduSearch, conectada com o Google." />

      <div className="space-y-5">
        <Card>
          <ProfileSummary profile={profile} />
        </Card>

        <Card tone="soft" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-testid="completion-cta">
          <div>
            <p className="flex flex-wrap items-center gap-2 font-semibold text-fg-strong">
              Conclua seu cadastro de {ROLE_LABEL[role].toLowerCase()} <ProvisionalBadge />
            </p>
            <p className="mt-1 text-sm text-fg-muted">
              Seu perfil ainda não foi salvo no servidor. A escolha de papel fica só neste navegador.
            </p>
          </div>
          <Link to={ONBOARDING_PATH[role]} className={buttonClasses({ className: "shrink-0" })}>
            Continuar cadastro
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </Card>

        <CommercialNotice />
      </div>
    </>
  );
}
