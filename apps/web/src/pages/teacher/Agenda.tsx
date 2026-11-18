import { useMemo, useState } from "react";
import { AlertIcon, BanIcon, Button, ErrorState, LoadingState, SegmentedControl, useToast } from "@edusearch/ui";
import { useSession } from "../../app/session";
import { CalendarView, type CalendarMode, type DayInfo } from "../../components/CalendarView";
import { GoogleCalendarCard } from "../../components/Integrations";
import { LessonDetailsDialog, useLessonDialogs } from "../../components/LessonDetailsDialog";
import { PageHeader } from "../../components/PageHeader";
import { describeError } from "../../lib/api/client";
import type { Lesson } from "../../lib/api/types";
import { conflictReason, dateKey, todayKey, weekDays } from "../../lib/calendar";
import { dataSource } from "../../lib/data/source";
import { DEMO_TEACHER_ID } from "../../lib/demo";
import { useAsync } from "../../lib/hooks/useAsync";

const LEGEND = [
  { label: "Confirmada", className: "border-l-4 border-primary" },
  { label: "Aguardando pagamento", className: "border-l-4 border-warning-text" },
  { label: "Cancelada", className: "border-l-4 border-line-strong" },
  { label: "Horário livre", className: "border border-dashed border-line-strong rounded-full" },
];

export default function Agenda() {
  const { session } = useSession();
  const toast = useToast();
  const teacherId = session?.teacherId ?? DEMO_TEACHER_ID;
  const data = useAsync(
    () => Promise.all([dataSource.listTeacherLessons(), dataSource.getAvailability(), dataSource.listBlockedDates(), dataSource.listTeacherSlots(teacherId)]),
    [teacherId],
  );
  const [mode, setMode] = useState<CalendarMode>("week");
  const [focus, setFocus] = useState(todayKey());
  const [busyDay, setBusyDay] = useState<string | null>(null);
  const dialogs = useLessonDialogs();

  const derived = useMemo(() => {
    if (data.status !== "success") return null;
    const [lessons, weekly, blockedList, slots] = data.data;
    const blocked = new Set(blockedList);
    const conflicts = new Map<string, string>();
    for (const l of lessons) {
      const reason = conflictReason(l, weekly, blocked);
      if (reason) conflicts.set(l.id, reason);
    }
    return { lessons, blocked, slots, conflicts };
  }, [data.status, data.data]);

  if (data.status === "loading") return <LoadingState label="Carregando agenda…" />;
  if (data.status === "error" || !derived) return <ErrorState description={describeError(data.error)} onRetry={data.reload} />;

  const { lessons, blocked, slots, conflicts } = derived;
  const today = todayKey();

  const dayInfo = (key: string): DayInfo => ({
    blocked: blocked.has(key),
    freeSlots: slots.filter((s) => dateKey(s.start) === key),
    conflicts: new Map([...conflicts].filter(([id]) => lessons.find((l) => l.id === id && dateKey(l.start) === key))),
  });

  const toggleBlock = async (key: string) => {
    const willBlock = !blocked.has(key);
    setBusyDay(key);
    try {
      await dataSource.setDateBlocked(key, willBlock);
      toast({
        title: willBlock ? "Dia bloqueado" : "Dia desbloqueado",
        description: willBlock ? "Novos horários não serão oferecidos. Aulas já marcadas continuam ativas." : "Os horários da sua grade voltaram a ser oferecidos.",
      });
      data.reload();
    } catch (e) {
      toast({ tone: "error", title: "Não foi possível alterar o bloqueio", description: describeError(e) });
    } finally {
      setBusyDay(null);
    }
  };

  const visibleKeys = new Set(mode === "week" ? weekDays(focus) : [focus]);
  const visible = lessons.filter((l) => visibleKeys.has(dateKey(l.start)));
  const confirmed = visible.filter((l) => l.status === "scheduled").length;
  const pending = visible.filter((l) => l.status === "pending_payment").length;
  const visibleConflicts = visible.filter((l) => conflicts.has(l.id)).length;

  const replace = (updated: Lesson) => {
    data.setData([lessons.map((l) => (l.id === updated.id ? updated : l)), data.data![1], data.data![2], data.data![3]]);
    data.reload();
  };

  return (
    <>
      <PageHeader title="Agenda" description="Aulas reservadas, horários livres e bloqueios." />

      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SegmentedControl
            label="Período da agenda"
            options={[
              { value: "week", label: "Semana" },
              { value: "month", label: "Mês" },
            ]}
            value={mode}
            onChange={setMode}
          />
          <p className="text-sm text-fg" aria-live="polite">
            {confirmed} {confirmed === 1 ? "confirmada" : "confirmadas"} · {pending} aguardando pagamento
            {visibleConflicts > 0 && (
              <span className="ml-1 inline-flex items-center gap-1 font-medium text-warning-text">
                · <AlertIcon className="h-4 w-4" /> {visibleConflicts} {visibleConflicts === 1 ? "conflito" : "conflitos"}
              </span>
            )}
          </p>
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-fg-muted" aria-label="Legenda">
          {LEGEND.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className={`inline-block h-3 w-3 bg-surface-muted ${l.className}`} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>

        <CalendarView
          mode={mode}
          focus={focus}
          onFocusChange={setFocus}
          lessons={lessons}
          perspective="teacher"
          onSelectLesson={dialogs.setDetails}
          dayInfo={dayInfo}
          renderDayActions={(key) =>
            key > today ? (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<BanIcon className="h-4 w-4" />}
                loading={busyDay === key}
                aria-pressed={blocked.has(key)}
                onClick={() => toggleBlock(key)}
              >
                {blocked.has(key) ? "Desbloquear dia" : "Bloquear dia"}
              </Button>
            ) : null
          }
        />

        <GoogleCalendarCard perspective="teacher" compact />
      </div>

      <LessonDetailsDialog
        lesson={dialogs.details}
        perspective="teacher"
        onClose={() => dialogs.setDetails(null)}
        confirming={dialogs.confirming}
        setConfirming={dialogs.setConfirming}
        onChanged={replace}
      />
    </>
  );
}
