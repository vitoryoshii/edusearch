import { useState } from "react";
import { Textarea } from "@edusearch/ui";
import { useAuth } from "../../app/auth";
import { ProfileSummary } from "../../components/AccountProfile";
import { ChipGroup, OnboardingFlow, PreviewNotice, ReviewList, SaveBlocked, type FlowStep } from "../../components/Onboarding";
import type { DayPeriod, Difficulty, Level } from "../../lib/api/types";
import { SUBJECTS, subjectName } from "../../lib/catalog";
import { DIFFICULTY_LABELS, LEVEL_LABELS, PERIOD_LABELS } from "../../lib/format";
import {
  BUDGET_LABELS,
  LIMITS,
  MODALITY_LABELS,
  STUDENT_STEPS,
  WEEKDAYS,
  WELCOME_PATH,
  emptyStudentDraft,
  studentStepIssue,
  toggle,
  type BudgetRange,
  type Modality,
  type StudentDraft,
  type StudentStep,
} from "../../lib/onboarding";

const opts = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
const SUBJECT_OPTS = SUBJECTS.map((s) => ({ value: s.id, label: s.name }));
const list = (values: string[], label: (v: string) => string) => values.map(label).join(", ");

/** Cadastro do aluno em etapas curtas. Prévia: nada é enviado nem salvo. */
export default function StudentOnboarding() {
  const { profile } = useAuth();
  // Somente em memória (estado do componente). Sem localStorage/sessionStorage.
  const [d, setD] = useState<StudentDraft>(emptyStudentDraft);
  if (!profile) return null;
  const set = <K extends keyof StudentDraft>(k: K, v: StudentDraft[K]) => setD((s) => ({ ...s, [k]: v }));
  const weekday = (v: string) => WEEKDAYS.find((w) => w.value === v)?.label ?? v;

  const content: Record<StudentStep, Omit<FlowStep, "id" | "issue">> = {
    voce: {
      title: "Este é você?",
      description: "Usaremos o nome e a foto da sua conta Google no seu perfil de aluno.",
      content: (
        <>
          <ProfileSummary profile={profile} size="xl" />
          <PreviewNotice />
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
          <ChipGroup label="Disciplinas de interesse" options={SUBJECT_OPTS} selected={d.subjects} onToggle={(v) => set("subjects", toggle(d.subjects, v))} />
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
      description: "Confira suas respostas. O envio será liberado quando a API de perfis estiver disponível.",
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
          <PreviewNotice />
        </>
      ),
    },
  };

  const steps: FlowStep[] = STUDENT_STEPS.map((id) => ({ id, ...content[id], issue: studentStepIssue(id, d) }));

  return (
    <OnboardingFlow
      label="Cadastro de aluno"
      steps={steps}
      backTo={{ to: WELCOME_PATH, label: "Trocar perfil" }}
      finish={<SaveBlocked />}
    />
  );
}
