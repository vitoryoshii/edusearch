import { useState } from "react";
import { Input, ShieldIcon, Textarea } from "@edusearch/ui";
import { useAuth } from "../../app/auth";
import { ProfileSummary } from "../../components/AccountProfile";
import { ChipGroup, OnboardingFlow, PreviewNotice, ReviewList, SaveBlocked, type FlowStep } from "../../components/Onboarding";
import type { DayPeriod, Methodology } from "../../lib/api/types";
import { SUBJECTS, subjectName } from "../../lib/catalog";
import { STANDARD_COMMISSION_BPS, formatBps, splitLessonAmount } from "../../lib/commission";
import { METHODOLOGY_LABELS, PERIOD_LABELS, formatMoney } from "../../lib/format";
import {
  EXPERIENCE_LABELS,
  LESSON_DURATIONS,
  LIMITS,
  MODALITY_LABELS,
  TEACHER_STEPS,
  WEEKDAYS,
  WELCOME_PATH,
  emptyTeacherDraft,
  parsePriceToCents,
  teacherStepIssue,
  toggle,
  type ExperienceRange,
  type Modality,
  type TeacherDraft,
  type TeacherStep,
} from "../../lib/onboarding";

const opts = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
const SUBJECT_OPTS = SUBJECTS.map((s) => ({ value: s.id, label: s.name }));
const DURATION_OPTS = LESSON_DURATIONS.map((m) => ({ value: m, label: `${m} min` }));
const list = (values: Array<string | number>, label: (v: string | number) => string) => values.map(label).join(", ");

/**
 * Cadastro do professor em etapas curtas. Prévia: nada é enviado nem salvo.
 * Sem upload de documentos e sem selo de "verificado" nesta fase.
 */
export default function TeacherOnboarding() {
  const { profile } = useAuth();
  // Somente em memória (estado do componente). Sem localStorage/sessionStorage.
  const [d, setD] = useState<TeacherDraft>(emptyTeacherDraft);
  if (!profile) return null;
  const set = <K extends keyof TeacherDraft>(k: K, v: TeacherDraft[K]) => setD((s) => ({ ...s, [k]: v }));
  const weekday = (v: string | number) => WEEKDAYS.find((w) => w.value === v)?.label ?? String(v);
  const cents = parsePriceToCents(d.price);
  const split = cents !== null && cents >= LIMITS.priceCents.min && cents <= LIMITS.priceCents.max ? splitLessonAmount(cents) : null;

  const content: Record<TeacherStep, Omit<FlowStep, "id" | "issue">> = {
    voce: {
      title: "Apresente-se aos alunos",
      description: "Nome e foto vêm da sua conta Google. A foto não comprova formação ou credenciais.",
      content: (
        <>
          <ProfileSummary profile={profile} size="xl" />
          <Textarea
            label="Biografia profissional"
            hint={`Conte sua trajetória e como você ajuda seus alunos (${d.bio.trim().length}/${LIMITS.bio.max}, mínimo ${LIMITS.bio.min}).`}
            rows={5}
            maxLength={LIMITS.bio.max}
            value={d.bio}
            onChange={(e) => set("bio", e.target.value)}
          />
          <PreviewNotice />
        </>
      ),
    },
    ensino: {
      title: "O que você ensina",
      content: (
        <>
          <ChipGroup label="Disciplinas" options={SUBJECT_OPTS} selected={d.subjects} onToggle={(v) => set("subjects", toggle(d.subjects, v))} />
          <Input
            label="Especialidades"
            hint="Opcional. Ex.: ENEM, cálculo I, inglês para negócios."
            maxLength={LIMITS.specialties.max}
            value={d.specialties}
            onChange={(e) => set("specialties", e.target.value)}
          />
          <Input
            label="Formação acadêmica"
            hint="Ex.: Licenciatura em Matemática — UFMG. A comprovação será pedida em etapa futura."
            maxLength={LIMITS.education.max}
            value={d.education}
            onChange={(e) => set("education", e.target.value)}
          />
          <ChipGroup<ExperienceRange>
            label="Experiência como professor"
            options={opts(EXPERIENCE_LABELS)}
            selected={d.experience ? [d.experience] : []}
            onToggle={(v) => set("experience", v)}
          />
        </>
      ),
    },
    aulas: {
      title: "Suas aulas",
      content: (
        <>
          <ChipGroup<Methodology>
            label="Metodologia"
            options={opts(METHODOLOGY_LABELS)}
            selected={d.methodologies}
            onToggle={(v) => set("methodologies", toggle(d.methodologies, v))}
          />
          <Textarea
            label="Como são suas aulas"
            hint="Opcional."
            rows={3}
            maxLength={LIMITS.methodology.max}
            value={d.methodologyNotes}
            onChange={(e) => set("methodologyNotes", e.target.value)}
          />
          <div>
            <Input
              label="Valor da aula (R$)"
              inputMode="decimal"
              autoComplete="off"
              placeholder="80,00"
              hint="Entre R$ 20,00 e R$ 1.000,00."
              value={d.price}
              onChange={(e) => set("price", e.target.value)}
            />
            {split && (
              <p className="mt-2 rounded-control bg-soft px-3 py-2 text-sm text-fg" data-testid="commission-preview" aria-live="polite">
                Comissão EduSearch ({formatBps(STANDARD_COMMISSION_BPS)}): {formatMoney(split.commissionCents)} · Você recebe{" "}
                <strong className="font-semibold text-fg-strong">{formatMoney(split.teacherShareCents)}</strong> por aula.
              </p>
            )}
            <p className="mt-2 text-xs text-fg-muted">
              Descontos progressivos e premiações por indicações qualificadas estão planejados e ainda não se aplicam. Nenhum
              pagamento real é processado nesta fase.
            </p>
          </div>
          <ChipGroup label="Duração das aulas" options={DURATION_OPTS} selected={d.durations} onToggle={(v) => set("durations", toggle(d.durations, v))} />
          <ChipGroup<Modality> label="Modalidade" options={opts(MODALITY_LABELS)} selected={d.modality ? [d.modality] : []} onToggle={(v) => set("modality", v)} />
        </>
      ),
    },
    agenda: {
      title: "Sua disponibilidade",
      description: "Uma visão geral. Os horários detalhados serão definidos na agenda.",
      content: (
        <>
          <ChipGroup label="Dias" options={WEEKDAYS} selected={d.days} onToggle={(v) => set("days", toggle(d.days, v))} />
          <ChipGroup<DayPeriod> label="Períodos" options={opts(PERIOD_LABELS)} selected={d.periods} onToggle={(v) => set("periods", toggle(d.periods, v))} />
        </>
      ),
    },
    documentos: {
      title: "Verificação de formação",
      description: "Etapa futura.",
      content: (
        <div className="flex items-start gap-3 rounded-card border border-line bg-surface p-5 text-sm" data-testid="documents-future">
          <ShieldIcon className="mt-0.5 h-5 w-5 shrink-0 text-link" />
          <div className="space-y-2 leading-relaxed text-fg">
            <p className="font-semibold text-fg-strong">Não envie documentos agora.</p>
            <p>
              O envio de diplomas e certificados será liberado quando houver armazenamento privado e um fluxo de tratamento de
              dados aprovado. A análise será feita por pessoas — não há aprovação automática.
            </p>
            <p>Enquanto isso, seu perfil não exibirá selo de professor verificado.</p>
          </div>
        </div>
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
              { label: "Biografia", value: d.bio.trim() },
              { label: "Disciplinas", value: list(d.subjects, (v) => subjectName(String(v))) },
              { label: "Especialidades", value: d.specialties.trim() },
              { label: "Formação", value: d.education.trim() },
              { label: "Experiência", value: d.experience ? EXPERIENCE_LABELS[d.experience] : "" },
              { label: "Metodologia", value: list(d.methodologies, (v) => METHODOLOGY_LABELS[v as Methodology]) },
              { label: "Valor da aula", value: cents !== null ? formatMoney(cents) : "" },
              { label: "Duração", value: list(d.durations, (v) => `${v} min`) },
              { label: "Modalidade", value: d.modality ? MODALITY_LABELS[d.modality] : "" },
              { label: "Disponibilidade", value: [list(d.days, weekday), list(d.periods, (v) => PERIOD_LABELS[v as DayPeriod])].filter(Boolean).join(" · ") },
              { label: "Verificação", value: "Pendente (etapa futura)" },
            ]}
          />
          <PreviewNotice />
        </>
      ),
    },
  };

  const steps: FlowStep[] = TEACHER_STEPS.map((id) => ({ id, ...content[id], issue: teacherStepIssue(id, d) }));

  return (
    <OnboardingFlow
      label="Cadastro de professor"
      steps={steps}
      backTo={{ to: WELCOME_PATH, label: "Trocar perfil" }}
      finish={<SaveBlocked />}
    />
  );
}
