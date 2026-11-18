import { useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import {
  ArrowRightIcon,
  CalendarIcon,
  Card,
  ChevronRightIcon,
  PaymentIcon,
  ProgressRing,
  SegmentedControl,
  buttonClasses,
} from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { CalendarView, type CalendarMode } from "../../components/CalendarView";
import { GoogleCalendarCard } from "../../components/Integrations";
import { LessonDetailsDialog, useLessonDialogs } from "../../components/LessonDetailsDialog";
import { LessonTabs } from "../../components/LessonTabs";
import { PageHeader } from "../../components/PageHeader";
import type { Lesson } from "../../lib/api/types";
import { dateKey, todayKey } from "../../lib/calendar";
import { subjectName } from "../../lib/catalog";
import { dataSource } from "../../lib/data/source";
import { formatDateShort, formatTime } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";

type View = "calendario" | "lista";

/** Cartões de resumo, como no mockup aprovado: próxima aula, pagamento e progresso. */
function Overview({ lessons }: { lessons: Lesson[] }) {
  const progress = useAsync(() => dataSource.getStudentProgress(), []);
  const now = Date.now();
  const next = lessons
    .filter((l) => l.status === "scheduled" && new Date(l.end).getTime() > now)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  const pending = lessons.filter((l) => l.status === "pending_payment");
  const goal = progress.status === "success" ? progress.data.goals[0] : undefined;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card tone="soft" padding="md" as="section" aria-labelledby="proxima-aula-titulo" className="md:row-span-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-link">
          <CalendarIcon className="h-4 w-4" /> Próxima aula
        </p>
        {next ? (
          <>
            <h2 id="proxima-aula-titulo" className="mt-2 text-xl font-semibold text-fg-strong">
              {subjectName(next.subject)}
            </h2>
            <p className="text-sm text-fg">com {next.teacherName}</p>
            <p className="mt-3 text-sm font-medium text-fg-strong">
              <time dateTime={next.start}>{formatDateShort(next.start)}</time> · {formatTime(next.start)}
            </p>
            <Link
              to={`/aluno/aulas/${next.id}`}
              className="mt-4 flex min-h-12 items-center justify-between gap-3 rounded-control bg-surface px-4 text-sm font-semibold text-fg-strong shadow-card transition-colors hover:text-link"
            >
              Aula online · Google Meet
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </>
        ) : (
          <>
            <h2 id="proxima-aula-titulo" className="mt-2 font-semibold text-fg-strong">
              Nenhuma aula confirmada
            </h2>
            <Link to="/aluno/buscar" className={buttonClasses({ size: "sm", className: "mt-3" })}>
              Encontrar professor
            </Link>
          </>
        )}
      </Card>

      <Card padding="sm" as="section" aria-labelledby="pagamento-resumo" className="flex items-center gap-3 sm:px-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary-soft text-link">
          <PaymentIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="pagamento-resumo" className="text-sm font-semibold text-fg-strong">
            Pagamento (Pix)
          </h2>
          <p className="text-sm text-fg-muted">
            {pending.length
              ? `${pending.length} ${pending.length === 1 ? "reserva aguardando" : "reservas aguardando"} pagamento`
              : "Nenhum pagamento pendente"}
          </p>
        </div>
        {pending[0] && (
          <Link to={`/aluno/pagamento/${pending[0].id}`} className={buttonClasses({ size: "sm" })}>
            Pagar
          </Link>
        )}
      </Card>

      <Link
        to="/aluno/progresso"
        className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong sm:px-5"
      >
        {goal ? <ProgressRing value={goal.done} max={goal.total} label={`Progresso em ${goal.title}`} size={56} /> : <span className="h-14 w-14" />}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-fg-strong">Meu progresso</span>
          <span className="block truncate text-sm text-fg-muted">{goal ? `${goal.title} · ${goal.done} de ${goal.total} aulas` : "Carregando…"}</span>
        </span>
        <ChevronRightIcon className="h-5 w-5 text-fg-muted" />
      </Link>
    </div>
  );
}

export default function StudentLessons() {
  const lessons = useAsync(() => dataSource.listStudentLessons(), []);
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const highlightId = (location.state as { highlight?: string } | null)?.highlight;
  const focusLessonId = params.get("aula");
  const view: View = params.get("view") === "lista" ? "lista" : "calendario";
  const [mode, setMode] = useState<CalendarMode>("week");
  const [focus, setFocus] = useState<string | null>(null);
  const dialogs = useLessonDialogs();

  // Foco inicial: a aula indicada (?aula=) ou hoje.
  const initialFocus = useMemo(() => {
    const target = lessons.status === "success" && focusLessonId ? lessons.data.find((l) => l.id === focusLessonId) : undefined;
    return target ? dateKey(target.start) : todayKey();
  }, [lessons.status, lessons.data, focusLessonId]);
  const currentFocus = focus ?? initialFocus;

  const setView = (v: View) => {
    const p = new URLSearchParams(params);
    if (v === "lista") p.set("view", "lista");
    else p.delete("view");
    setParams(p, { replace: true });
  };

  const replace = (updated: Lesson) => {
    if (lessons.status === "success") lessons.setData(lessons.data.map((l) => (l.id === updated.id ? updated : l)));
  };

  return (
    <>
      <PageHeader title="Minhas aulas" description="Suas aulas, pagamentos e calendário em um só lugar." />
      <AsyncContent state={lessons} reload={lessons.reload}>
        {(data) => (
          <div className="space-y-6">
            <Overview lessons={data} />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SegmentedControl
                label="Forma de visualização"
                options={[
                  { value: "calendario", label: "Calendário" },
                  { value: "lista", label: "Lista" },
                ]}
                value={view}
                onChange={setView}
              />
              {view === "calendario" && (
                <SegmentedControl
                  label="Período do calendário"
                  size="sm"
                  options={[
                    { value: "week", label: "Semana" },
                    { value: "month", label: "Mês" },
                  ]}
                  value={mode}
                  onChange={setMode}
                />
              )}
            </div>

            {view === "calendario" ? (
              <>
                <CalendarView
                  mode={mode}
                  focus={currentFocus}
                  onFocusChange={setFocus}
                  lessons={data}
                  perspective="student"
                  onSelectLesson={dialogs.setDetails}
                />
                <GoogleCalendarCard perspective="student" compact />
                <LessonDetailsDialog
                  lesson={dialogs.details}
                  perspective="student"
                  onClose={() => dialogs.setDetails(null)}
                  confirming={dialogs.confirming}
                  setConfirming={dialogs.setConfirming}
                  onChanged={replace}
                />
              </>
            ) : (
              <LessonTabs
                lessons={data}
                perspective="student"
                highlightId={highlightId}
                onChange={lessons.setData}
                emptyAction={
                  <Link to="/aluno/buscar" className={buttonClasses({ size: "sm" })}>
                    Buscar professores
                  </Link>
                }
              />
            )}
          </div>
        )}
      </AsyncContent>
    </>
  );
}
