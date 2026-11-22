import { Link, Navigate } from "react-router";
import { ArrowRightIcon, Badge, Card, CheckCircleIcon, ClockIcon, ErrorState, ShieldIcon, buttonClasses } from "@edusearch/ui";
import { hasRole, useAccount, useDisplayProfile, useServerMe } from "../../app/account";
import { NextLessonCard, StudentShortcuts, TeacherOverview } from "../../components/account/Overview";
import { ProfileSummary, ProvisionalBadge, ROLE_LABEL, useRoleIntent } from "../../components/AccountProfile";
import { PageHeader } from "../../components/PageHeader";
import type { Me } from "../../lib/api/account";
import { describeError } from "../../lib/api/client";
import { useLessonsQuery } from "../../lib/query/hooks";
import { firstNameOf, type AuthenticatedProfile } from "../../lib/auth/profile";
import { FEATURES } from "../../lib/features";
import { ONBOARDING_PATH, WELCOME_PATH } from "../../lib/onboarding";

/** Início da conta real: próxima aula, atalhos por papel e cadastro. */
export default function AccountDashboard() {
  const profile = useDisplayProfile();
  const account = useAccount();
  if (!profile) return null; // RequireAuth garante a sessão.
  return account.mode === "server" ? <ServerDashboard profile={profile} /> : <PreviewDashboard key={profile.id} profile={profile} />;
}

/* ------------------------------- Modo servidor ------------------------------- */

function ServerDashboard({ profile }: { profile: AuthenticatedProfile }) {
  const me = useServerMe();
  const scheduling = FEATURES.scheduling !== "off";
  // Mesma chave de "Minhas aulas": as duas telas compartilham uma requisição e o cache.
  const lessons = useLessonsQuery(scheduling);
  if (!me) return null; // RequireAccount garante o carregamento.
  // Primeiro acesso: nenhum papel PERSISTIDO no servidor → boas-vindas.
  if (me.roles.length === 0) return <Navigate to={WELCOME_PATH} replace />;

  const student = hasRole(me, "student");
  const teacher = hasRole(me, "teacher");
  const roleLabel = student && teacher ? "Aluno e professor" : student ? "Aluno" : "Professor";
  const lessonData = lessons.data;
  const pendingStudent = me.onboarding.student?.status === "pending";
  const pendingTeacher = me.onboarding.teacher?.status === "pending";

  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="primary">{roleLabel}</Badge>}
        title={`Olá, ${firstNameOf(profile)}!`}
        description={
          !scheduling
            ? "Esta é a sua conta EduSearch."
            : student && !teacher
              ? "Encontre professores e acompanhe suas aulas."
              : "Acompanhe suas aulas e mantenha sua agenda em dia."
        }
      />
      <div className="space-y-6">
        {(pendingStudent || (!scheduling && me.onboarding.student)) && <StudentStatus status={me.onboarding.student!.status} />}
        {(pendingTeacher || (!scheduling && me.onboarding.teacher)) && <TeacherStatus teacher={me.onboarding.teacher!} />}
        {scheduling &&
          (lessons.isError && !lessons.data ? (
            <ErrorState description={describeError(lessons.error)} onRetry={() => void lessons.refetch()} />
          ) : (
            <NextLessonCard lessons={lessonData} role={teacher && !student ? "teacher" : "student"} />
          ))}
        {scheduling && teacher && <TeacherOverview me={me} lessons={lessonData} />}
        {scheduling && student && <StudentShortcuts />}
        {scheduling && <RegistrationSummary me={me} />}
        <PilotNote />
      </div>
    </>
  );
}

/** Cadastros já concluídos, em uma linha cada (os pendentes ficam em destaque acima). */
function RegistrationSummary({ me }: { me: Me }) {
  const rows = [
    me.onboarding.student?.status === "completed" && { label: "Cadastro de aluno", to: ONBOARDING_PATH.student, detail: "Preferências de estudo salvas" },
    me.onboarding.teacher?.status === "completed" && {
      label: "Cadastro profissional",
      to: ONBOARDING_PATH.teacher,
      detail: me.onboarding.teacher.is_published ? "Publicado para alunos" : me.onboarding.teacher.verification_status === "rejected" ? "Não aprovado" : "Em análise",
    },
  ].filter(Boolean) as { label: string; to: string; detail: string }[];
  if (!rows.length) return null;
  return (
    <Card padding="sm" className="sm:p-5" data-testid="registration-summary">
      <h2 className="text-sm font-semibold text-fg-strong">Seu cadastro</h2>
      <ul className="mt-2 divide-y divide-line">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span className="flex min-w-0 items-start gap-2">
              <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-success-text" />
              <span className="min-w-0">
                <span className="block font-medium text-fg-strong">{r.label}</span>
                <span className="block text-xs text-fg-muted">{r.detail}</span>
              </span>
            </span>
            <Link to={r.to} className="font-semibold text-link underline-offset-4 hover:underline">
              Revisar
            </Link>
          </li>
        ))}
      </ul>
    </Card>
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

/** Uma linha sobre o piloto: aulas sem cobrança e pagamentos desligados (bloqueio comercial mantido). */
function PilotNote() {
  return (
    <p className="flex items-center gap-2 px-1 text-xs text-fg-muted" data-testid="pilot-note">
      <ShieldIcon className="h-3.5 w-3.5 shrink-0" />
      {FEATURES.scheduling !== "off"
        ? "Piloto EduSearch: aulas sem cobrança; pagamentos desativados."
        : "Piloto EduSearch: agendamento e pagamentos ainda não estão disponíveis."}
    </p>
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

        <PilotNote />
      </div>
    </>
  );
}
