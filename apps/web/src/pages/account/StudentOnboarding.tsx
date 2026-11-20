import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { ErrorState, LoadingState, Textarea, useToast } from "@edusearch/ui";
import { hasRole, useAccount, useDisplayProfile, useServerMe } from "../../app/account";
import { useOnboardingLoad, type Option } from "../../app/onboarding-data";
import { ProfileSummary } from "../../components/AccountProfile";
import { ChipGroup, OnboardingFlow, PreviewNotice, ReviewList, SaveBlocked, SaveNotice, SaveProfile, type FlowStep } from "../../components/Onboarding";
import { accountApi } from "../../lib/api/account";
import { describeError } from "../../lib/api/client";
import type { DayPeriod, Difficulty, Level } from "../../lib/api/types";
import { DIFFICULTY_LABELS, LEVEL_LABELS, PERIOD_LABELS } from "../../lib/format";
import {
  BUDGET_LABELS,
  LIMITS,
  MODALITY_LABELS,
  STUDENT_STEPS,
  WEEKDAYS,
  WELCOME_PATH,
  emptyStudentDraft,
  firstIncomplete,
  studentDraftToPayload,
  studentPayloadToDraft,
  studentStepIssue,
  toggle,
  type BudgetRange,
  type Modality,
  type StudentDraft,
  type StudentStep,
} from "../../lib/onboarding";

const opts = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
const list = (values: string[], label: (v: string) => string) => values.map(label).join(", ");

/**
 * Cadastro do aluno em etapas curtas.
 * - Modo servidor: carrega o cadastro salvo (GET) e salva ao final (PUT /v1/me/student-profile).
 * - Modo prévia: nada é enviado nem salvo (comportamento anterior).
 */
export default function StudentOnboarding() {
  const account = useAccount();
  const me = useServerMe();
  if (account.mode === "server" && !hasRole(me, "student")) return <Navigate to={WELCOME_PATH} replace />;
  return <StudentLoader server={account.mode === "server"} />;
}

function StudentLoader({ server }: { server: boolean }) {
  const load = useOnboardingLoad(server, accountApi.getStudentProfile);
  if (load.status === "loading") return <LoadingState label="Carregando seu cadastro…" className="py-16" />;
  if (load.status === "role_missing") return <Navigate to={WELCOME_PATH} replace />;
  if (load.status === "error")
    return (
      <div className="py-10" data-testid="onboarding-load-error">
        <ErrorState title="Não foi possível carregar seu cadastro" description={describeError(load.error)} onRetry={load.retry} />
      </div>
    );
  return (
    <StudentForm
      server={server}
      subjects={load.subjects}
      initial={load.initial ? studentPayloadToDraft(load.initial) : null}
    />
  );
}

function StudentForm({ server, subjects, initial }: { server: boolean; subjects: Option[]; initial: StudentDraft | null }) {
  const profile = useDisplayProfile();
  const account = useAccount();
  const navigate = useNavigate();
  const toast = useToast();
  // Somente em memória (estado do componente). Sem localStorage/sessionStorage.
  const [d, setD] = useState<StudentDraft>(() => initial ?? emptyStudentDraft());
  if (!profile) return null;
  const set = <K extends keyof StudentDraft>(k: K, v: StudentDraft[K]) => setD((s) => ({ ...s, [k]: v }));
  const weekday = (v: string) => WEEKDAYS.find((w) => w.value === v)?.label ?? v;
  const subjectName = (slug: string) => subjects.find((s) => s.value === slug)?.label ?? slug;
  const notice = server ? <SaveNotice saved={initial !== null} /> : <PreviewNotice />;

  const save = async () => {
    const pending = firstIncomplete(STUDENT_STEPS, d, studentStepIssue);
    if (pending) throw new Error(studentStepIssue(pending, d) ?? "Complete todas as etapas.");
    await accountApi.saveStudentProfile(studentDraftToPayload(d));
    // Salvo. Atualiza o estado da conta (se falhar, a conta recarrega sozinha).
    if (account.mode === "server") {
      try {
        account.setMe(await accountApi.me());
      } catch {
        account.reload();
      }
    }
    toast({ tone: "success", title: "Cadastro de aluno salvo", description: "Suas respostas foram salvas na sua conta." });
    navigate("/conta", { replace: true });
  };

  const content: Record<StudentStep, Omit<FlowStep, "id" | "issue">> = {
    voce: {
      title: "Este é você?",
      description: "Usaremos o nome e a foto da sua conta no seu perfil de aluno.",
      content: (
        <>
          <ProfileSummary profile={profile} size="xl" />
          {notice}
        </>
      ),
    },
    objetivo: {
      title: "O que você quer aprender?",
      description: "Isso ajuda a recomendar professores compatíveis.",
      content: (
        <>
          <Textarea
            label="Seu objetivo"
            hint="Ex.: passar no ENEM, melhorar em cálculo, conversar em inglês no trabalho."
            rows={3}
            maxLength={LIMITS.goal.max}
            value={d.goal}
            onChange={(e) => set("goal", e.target.value)}
          />
          <ChipGroup<Level> label="Nível atual" options={opts(LEVEL_LABELS)} selected={d.level ? [d.level] : []} onToggle={(v) => set("level", v)} />
        </>
      ),
    },
    materias: {
      title: "Disciplinas e dificuldades",
      content: (
        <>
          <ChipGroup label="Disciplinas de interesse" options={subjects} selected={d.subjects} onToggle={(v) => set("subjects", toggle(d.subjects, v))} />
          <ChipGroup<Difficulty>
            label="Principais dificuldades"
            hint="Opcional."
            options={opts(DIFFICULTY_LABELS)}
            selected={d.difficulties}
            onToggle={(v) => set("difficulties", toggle(d.difficulties, v))}
          />
        </>
      ),
    },
    rotina: {
      title: "Quando e como estudar",
      content: (
        <>
          <ChipGroup label="Dias disponíveis" options={WEEKDAYS} selected={d.days} onToggle={(v) => set("days", toggle(d.days, v))} />
          <ChipGroup<DayPeriod> label="Períodos" options={opts(PERIOD_LABELS)} selected={d.periods} onToggle={(v) => set("periods", toggle(d.periods, v))} />
          <ChipGroup<Modality> label="Modalidade" options={opts(MODALITY_LABELS)} selected={d.modality ? [d.modality] : []} onToggle={(v) => set("modality", v)} />
          <ChipGroup<BudgetRange> label="Valor por aula" options={opts(BUDGET_LABELS)} selected={d.budget ? [d.budget] : []} onToggle={(v) => set("budget", v)} />
        </>
      ),
    },
    revisao: {
      title: "Revise seu perfil",
      description: server
        ? "Confira suas respostas e salve para concluir o cadastro."
        : "Confira suas respostas. O envio será liberado quando a API de perfis estiver disponível.",
      content: (
        <>
          <ReviewList
            items={[
              { label: "Nome", value: profile.displayName },
              { label: "Objetivo", value: d.goal.trim() },
              { label: "Nível", value: d.level ? LEVEL_LABELS[d.level] : "" },
              { label: "Disciplinas", value: list(d.subjects, subjectName) },
              { label: "Dificuldades", value: list(d.difficulties, (v) => DIFFICULTY_LABELS[v as Difficulty]) },
              { label: "Disponibilidade", value: [list(d.days, weekday), list(d.periods, (v) => PERIOD_LABELS[v as DayPeriod])].filter(Boolean).join(" · ") },
              { label: "Modalidade", value: d.modality ? MODALITY_LABELS[d.modality] : "" },
              { label: "Valor por aula", value: d.budget ? BUDGET_LABELS[d.budget] : "" },
            ]}
          />
          {notice}
        </>
      ),
    },
  };

  const steps: FlowStep[] = STUDENT_STEPS.map((id) => ({ id, ...content[id], issue: studentStepIssue(id, d) }));

  return (
    <OnboardingFlow
      label="Cadastro de aluno"
      steps={steps}
      backTo={{ to: server ? "/conta" : WELCOME_PATH, label: server ? "Minha conta" : "Trocar perfil" }}
      finish={server ? <SaveProfile onSave={save} /> : <SaveBlocked />}
    />
  );
}
