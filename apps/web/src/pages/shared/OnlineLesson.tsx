import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  Badge,
  BookIcon,
  CalendarIcon,
  CameraIcon,
  CameraOffIcon,
  Card,
  CheckIcon,
  ClockIcon,
  Logo,
  MicIcon,
  MicOffIcon,
  SegmentedControl,
  buttonClasses,
  cn,
  type BadgeTone,
} from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { DemoNotice } from "../../components/DemoNotice";
import { GoogleCalendarCard, MeetJoinPanel } from "../../components/Integrations";
import { PageHeader, SectionTitle } from "../../components/PageHeader";
import { PaymentStatusBadge } from "../../components/StatusBadges";
import type { Lesson } from "../../lib/api/types";
import { subjectName } from "../../lib/catalog";
import { dataSource, isDemo } from "../../lib/data/source";
import { formatDateLong, formatMinutes, formatTimeRange } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";
import { ONLINE_STATE_LABELS, READY_WINDOW_MIN, onlineLessonState, type OnlineLessonState } from "../../lib/meeting";

const STATE_TONE: Record<OnlineLessonState, BadgeTone> = {
  awaiting_payment: "warning",
  scheduled: "primary",
  waiting: "primary",
  ready: "success",
  live: "success",
  finished: "neutral",
  cancelled: "neutral",
};

const STATE_HINT: Record<OnlineLessonState, string> = {
  awaiting_payment: "A aula será confirmada após o pagamento via Pix.",
  scheduled: "Tudo certo. Volte perto do horário para entrar na aula.",
  waiting: "A aula acontece em breve. Prepare-se com antecedência.",
  ready: `A aula começa em menos de ${READY_WINDOW_MIN} minutos.`,
  live: "A aula está acontecendo agora.",
  finished: "Esta aula foi finalizada.",
  cancelled: "Esta aula foi cancelada.",
};

const PREVIEW_OPTIONS = [
  { value: "scheduled", label: "Agendada" },
  { value: "waiting", label: "Aguardando" },
  { value: "ready", label: "Pronta" },
  { value: "live", label: "Em andamento" },
  { value: "finished", label: "Finalizada" },
  { value: "cancelled", label: "Cancelada" },
] as const;

const CHECKLIST = [
  "Teste fone de ouvido e microfone antes do horário.",
  "Escolha um lugar silencioso e com boa conexão.",
  "Deixe os materiais da aula e um caderno por perto.",
  "Entre alguns minutos antes para não perder o início.",
];

/** Painel pré-aula ILUSTRATIVO: os botões não acessam câmera nem microfone. */
function PreparationPreview() {
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  return (
    <div className="rounded-card border border-dashed border-line-strong p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg-strong">Pré-visualização do painel pré-aula</p>
        <Badge tone="demo">Ilustrativo · nenhum dispositivo é acessado</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={mic}
          onClick={() => setMic((v) => !v)}
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-control border px-4 text-sm font-medium transition-colors",
            mic ? "border-line-strong bg-surface text-fg-strong" : "border-transparent bg-surface-muted text-fg-muted",
          )}
        >
          {mic ? <MicIcon className="h-4.5 w-4.5" /> : <MicOffIcon className="h-4.5 w-4.5" />}
          Microfone {mic ? "ligado" : "desligado"}
        </button>
        <button
          type="button"
          aria-pressed={cam}
          onClick={() => setCam((v) => !v)}
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-control border px-4 text-sm font-medium transition-colors",
            cam ? "border-line-strong bg-surface text-fg-strong" : "border-transparent bg-surface-muted text-fg-muted",
          )}
        >
          {cam ? <CameraIcon className="h-4.5 w-4.5" /> : <CameraOffIcon className="h-4.5 w-4.5" />}
          Câmera {cam ? "ligada" : "desligada"}
        </button>
      </div>
      <p className="mt-2 text-xs text-fg-muted">A videochamada acontece no Google Meet, não no EduSearch.</p>
    </div>
  );
}

function LessonView({ initial, perspective }: { initial: Lesson; perspective: "student" | "teacher" }) {
  const [lesson, setLesson] = useState(initial);
  const [preview, setPreview] = useState<OnlineLessonState | null>(null);
  const real = onlineLessonState(lesson);
  const state = preview ?? real;
  const person = perspective === "student" ? lesson.teacherName : lesson.studentName;
  const duration = Math.round((new Date(lesson.end).getTime() - new Date(lesson.start).getTime()) / 60_000);
  const canPreview = isDemo && lesson.status !== "pending_payment";

  return (
    <div className="space-y-6">
      {/* Cartão principal, como "Próxima aula" no mockup aprovado */}
      <Card tone="soft" padding="lg" as="section" aria-labelledby="aula-titulo">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-link">
            <Logo variant="symbol" className="h-5" decorative />
            EduSearch · Aula online
          </span>
          <Badge tone={STATE_TONE[state]} dot>
            {ONLINE_STATE_LABELS[state]}
            {preview && " (pré-visualização)"}
          </Badge>
        </div>
        <h2 id="aula-titulo" className="mt-4 text-2xl font-semibold tracking-tight text-fg-strong">
          {subjectName(lesson.subject)}
        </h2>
        <p className="mt-1 text-fg">
          {perspective === "student" ? "com" : "Aluno:"} {person}
          {perspective === "student" && <span className="text-fg-muted"> · Aluno: {lesson.studentName}</span>}
          {perspective === "teacher" && <span className="text-fg-muted"> · Professor: {lesson.teacherName}</span>}
        </p>
        <ul className="mt-4 flex flex-col gap-2 text-sm text-fg-strong sm:flex-row sm:flex-wrap sm:gap-x-6">
          <li className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-link" /> {formatDateLong(lesson.start)}
          </li>
          <li className="flex items-center gap-2">
            <ClockIcon className="h-4 w-4 text-link" /> {formatTimeRange(lesson.start, lesson.end)} · {formatMinutes(duration)}
          </li>
        </ul>
        <p className="mt-3 text-sm text-fg">{STATE_HINT[state]}</p>
        <div className="mt-5">
          {lesson.status === "pending_payment" && perspective === "student" ? (
            <div className="flex flex-col gap-3 rounded-card bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-fg">Pagamento:</span>
                {lesson.payment ? <PaymentStatusBadge status={lesson.payment.status} simulated={isDemo} /> : <Badge>Cobrança não criada</Badge>}
              </div>
              <Link to={`/aluno/pagamento/${lesson.id}`} className={buttonClasses()}>
                Pagar com Pix
              </Link>
            </div>
          ) : (
            <MeetJoinPanel lesson={lesson} canJoinNow={state === "ready" || state === "live"} />
          )}
        </div>
      </Card>

      {canPreview && (
        <section aria-labelledby="previa-estado">
          <SectionTitle id="previa-estado">Pré-visualizar estados (demonstração)</SectionTitle>
          <div>
            <SegmentedControl
              label="Pré-visualizar estado da aula"
              size="sm"
              className="flex w-full flex-wrap [&>button]:basis-[calc(33.333%-0.25rem)] sm:[&>button]:basis-auto"
              options={PREVIEW_OPTIONS}
              value={(preview ?? (PREVIEW_OPTIONS.some((o) => o.value === real) ? real : "scheduled")) as (typeof PREVIEW_OPTIONS)[number]["value"]}
              onChange={(v) => setPreview(v === real ? null : v)}
            />
          </div>
          <p className="mt-2 text-xs text-fg-muted">
            Muda só a aparência desta tela para revisão. O estado real vem do horário e da reserva: {ONLINE_STATE_LABELS[real].toLowerCase()}.
          </p>
        </section>
      )}

      {state !== "cancelled" && state !== "finished" && (
        <section aria-labelledby="preparacao">
          <SectionTitle id="preparacao">Antes de participar</SectionTitle>
          <Card className="space-y-4">
            <ul className="space-y-2">
              {CHECKLIST.map((c) => (
                <li key={c} className="flex items-start gap-2.5 text-sm text-fg">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success-text" />
                  {c}
                </li>
              ))}
            </ul>
            {isDemo && <PreparationPreview />}
          </Card>
        </section>
      )}

      {lesson.materials && lesson.materials.length > 0 && (
        <section aria-labelledby="materiais">
          <SectionTitle id="materiais">Materiais da aula</SectionTitle>
          <Card padding="none">
            <ul className="divide-y divide-line">
              {lesson.materials.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-5 py-3.5">
                  <BookIcon className="h-5 w-5 shrink-0 text-link" />
                  <span className="min-w-0 flex-1 text-sm font-medium text-fg-strong">{m.title}</span>
                  <Badge tone="demo">Sem arquivo</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <section aria-labelledby="agenda-google">
        <h2 id="agenda-google" className="sr-only">
          Agenda
        </h2>
        <GoogleCalendarCard lesson={lesson} perspective={perspective} onLessonChange={setLesson} />
      </section>

      {isDemo && (
        <DemoNotice>
          Demonstração: o link do Google Meet só aparece quando a API criar a reunião. Nenhum link é inventado e nenhuma
          videochamada acontece no EduSearch.
        </DemoNotice>
      )}
    </div>
  );
}

/** Detalhes da aula online — mesma tela para aluno e professor. */
export default function OnlineLesson({ perspective }: { perspective: "student" | "teacher" }) {
  const { id = "" } = useParams();
  const lesson = useAsync(() => dataSource.getLesson(id), [id]);
  const back = perspective === "student" ? { to: "/aluno/aulas", label: "Minhas aulas" } : { to: "/professor/agenda", label: "Agenda" };
  return (
    <>
      <PageHeader back={back} title="Aula online" />
      <AsyncContent state={lesson} reload={lesson.reload} loading="spinner">
        {(l) => <LessonView initial={l} perspective={perspective} />}
      </AsyncContent>
    </>
  );
}

export function StudentOnlineLesson() {
  return <OnlineLesson perspective="student" />;
}

export function TeacherOnlineLesson() {
  return <OnlineLesson perspective="teacher" />;
}
