import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { ErrorState, Input, LoadingState, ShieldIcon, Textarea, useToast } from "@edusearch/ui";
import { hasRole, useAccount, useDisplayProfile, useServerMe } from "../../app/account";
import { useOnboardingLoad, type Option } from "../../app/onboarding-data";
import { ProfileSummary } from "../../components/AccountProfile";
import { ChipGroup, OnboardingFlow, PreviewNotice, ReviewList, SaveBlocked, SaveNotice, SaveProfile, type FlowStep } from "../../components/Onboarding";
import { accountApi } from "../../lib/api/account";
import { describeError } from "../../lib/api/client";
import type { DayPeriod, Methodology } from "../../lib/api/types";
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
  firstIncomplete,
  parsePriceToCents,
  teacherDraftToPayload,
  teacherPayloadToDraft,
  teacherStepIssue,
  toggle,
  type ExperienceRange,
  type Modality,
  type TeacherDraft,
  type TeacherStep,
} from "../../lib/onboarding";

const opts = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
const DURATION_OPTS = LESSON_DURATIONS.map((m) => ({ value: m, label: `${m} min` }));
const list = (values: Array<string | number>, label: (v: string | number) => string) => values.map(label).join(", ");

/**
 * Cadastro do professor em etapas curtas.
 * - Modo servidor: carrega (GET) e salva ao final (PUT /v1/me/teacher-profile). Salvar NÃO
 *   aprova nem publica: a verificação continua pendente e é feita pelo servidor/equipe.
 * - Modo prévia: nada é enviado nem salvo.
 * Sem upload de documentos e sem selo de "verificado" nesta fase.
 */
export default function TeacherOnboarding() {
  const account = useAccount();
  const me = useServerMe();
  if (account.mode === "server" && !hasRole(me, "teacher")) return <Navigate to={WELCOME_PATH} replace />;
  return <TeacherLoader server={account.mode === "server"} />;
}

function TeacherLoader({ server }: { server: boolean }) {
  const load = useOnboardingLoad(server, accountApi.getTeacherProfile);
  if (load.status === "loading") return <LoadingState label="Carregando seu cadastro…" className="py-16" />;
  if (load.status === "role_missing") return <Navigate to={WELCOME_PATH} replace />;
  if (load.status === "error")
    return (
      <div className="py-10" data-testid="onboarding-load-error">
        <ErrorState title="Não foi possível carregar seu cadastro" description={describeError(load.error)} onRetry={load.retry} />
      </div>
    );
  return (
    <TeacherForm
      server={server}
      subjects={load.subjects}
      initial={load.initial ? teacherPayloadToDraft(load.initial) : null}
      verification={load.initial?.verification_status ?? null}
    />
  );
}

const VERIFICATION_LABEL = { pending: "Pendente (análise pela equipe)", approved: "Aprovada", rejected: "Não aprovada" } as const;

function TeacherForm({
  server,
  subjects,
  initial,
  verification,
}: {
  server: boolean;
  subjects: Option[];
  initial: TeacherDraft | null;
  verification: keyof typeof VERIFICATION_LABEL | null;
}) {
  const profile = useDisplayProfile();
  const account = useAccount();
  const navigate = useNavigate();
  const toast = useToast();
  // Somente em memória (estado do componente). Sem localStorage/sessionStorage.
  const [d, setD] = useState<TeacherDraft>(() => initial ?? emptyTeacherDraft());
  if (!profile) return null;
  const subjectName = (slug: string) => subjects.find((s) => s.value === slug)?.label ?? slug;
  const notice = server ? <SaveNotice saved={initial !== null} /> : <PreviewNotice />;

  const save = async () => {
    const pending = firstIncomplete(TEACHER_STEPS, d, teacherStepIssue);
    if (pending) throw new Error(teacherStepIssue(pending, d) ?? "Complete todas as etapas.");
    await accountApi.saveTeacherProfile(teacherDraftToPayload(d));
    if (account.mode === "server") {
      try {
        account.setMe(await accountApi.me());
      } catch {
        account.reload();
      }
    }
    toast({
      tone: "success",
      title: "Cadastro de professor salvo",
      description: "Seu perfil foi salvo e aguarda análise. Ele não fica público antes da aprovação.",
    });
    navigate("/conta", { replace: true });
  };
  const set = <K extends keyof TeacherDraft>(k: K, v: TeacherDraft[K]) => setD((s) => ({ ...s, [k]: v }));
  const weekday = (v: string | number) => WEEKDAYS.find((w) => w.value === v)?.label ?? String(v);
  const cents = parsePriceToCents(d.price);
  const split = cents !== null && cents >= LIMITS.priceCents.min && cents <= LIMITS.priceCents.max ? splitLessonAmount(cents) : null;

  const content: Record<TeacherStep, Omit<FlowStep, "id" | "issue">> = {
    voce: {
      title: "Apresente-se aos alunos",
      description: "Nome e foto vêm da sua conta. A foto não comprova formação ou credenciais.",
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
          {notice}
        </>
      ),
    },
    ensino: {
      title: "O que você ensina",
      content: (
        <>
          <ChipGroup label="Disciplinas" options={subjects} selected={d.subjects} onToggle={(v) => set("subjects", toggle(d.subjects, v))} />
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
      description: server
        ? "Confira suas respostas e salve. Salvar não publica o perfil: ele passa por análise."
        : "Confira suas respostas. O envio será liberado quando a API de perfis estiver disponível.",
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
              { label: "Verificação", value: verification ? VERIFICATION_LABEL[verification] : "Pendente (etapa futura)" },
            ]}
          />
          {notice}
        </>
      ),
    },
  };

  const steps: FlowStep[] = TEACHER_STEPS.map((id) => ({ id, ...content[id], issue: teacherStepIssue(id, d) }));

  return (
    <OnboardingFlow
      label="Cadastro de professor"
      steps={steps}
      backTo={{ to: server ? "/conta" : WELCOME_PATH, label: server ? "Minha conta" : "Trocar perfil" }}
      finish={server ? <SaveProfile onSave={save} /> : <SaveBlocked />}
    />
  );
}
