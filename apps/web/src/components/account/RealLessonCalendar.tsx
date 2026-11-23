import { useMemo, useRef, useState } from "react";
import { Badge, Button, Dialog, RefreshIcon, SegmentedControl, VideoIcon, cn, useToast } from "@edusearch/ui";
import type { Lesson } from "../../lib/api/scheduling";
import { describeError } from "../../lib/api/client";
import { addDays, addMonths, fromKey, monthGrid, sameMonth, startOfWeek, weekDays } from "../../lib/calendar";
import { isTrustedMeetUrl } from "../../lib/meeting";
import { PLATFORM_TZ, dayKeyOf, dayLabelOf, timeOf } from "../../lib/scheduling";
import { useCancelLessonMutation, useResyncLessonMutation } from "../../lib/query/hooks";

type Mode = "day" | "week" | "month";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const WEEKDAY_KEYS = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"] as const;
const STATUS: Record<Lesson["status"], { label: string; tone: "success" | "warning" | "neutral" | "danger" }> = {
  scheduled: { label: "Confirmada", tone: "success" },
  awaiting_payment: { label: "Aguardando Pix", tone: "warning" },
  cancelled: { label: "Cancelada", tone: "danger" },
  expired: { label: "Pix expirado", tone: "neutral" },
};
const SYNC: Record<Lesson["calendar_sync_status"], string> = {
  synced: "Sincronizada",
  pending: "Sincronizando",
  failed: "Falha ao sincronizar",
  not_connected: "Google Agenda desconectada",
  removed: "Evento removido",
};

const dateForKey = (key: string) => new Date(`${key}T12:00:00-03:00`);
const monthName = (key: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: PLATFORM_TZ, month: "long", year: "numeric" }).format(dateForKey(key)).replace(/^./, (x) => x.toUpperCase());
const dayName = (key: string) => dayLabelOf(dateForKey(key).toISOString()).replace(/^./, (x) => x.toUpperCase());
const dayOfWeek = (key: string) => (dateForKey(key).getUTCDay() + 6) % 7;
const today = () => dayKeyOf(new Date().toISOString());
const isCancellable = (lesson: Lesson) =>
  (lesson.status === "scheduled" || lesson.status === "awaiting_payment") && new Date(lesson.starts_at).getTime() > Date.now();

/**
 * Agenda autenticada: o único inventário de aulas é GET /v1/me/lessons. As janelas exibidas
 * vêm de GET /v1/me/availability e são declaradamente recorrentes, não slots reserváveis.
 */
export function RealLessonCalendar({ lessons, windows }: { lessons: Lesson[]; windows: Array<{ weekday: string; start: string; end: string }> }) {
  const [mode, setMode] = useState<Mode>("week");
  const [focus, setFocus] = useState(today);
  const [selected, setSelected] = useState<Lesson | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const lessonsByDay = useMemo(() => {
    const grouped = new Map<string, Lesson[]>();
    for (const lesson of lessons) {
      const key = dayKeyOf(lesson.starts_at);
      grouped.set(key, [...(grouped.get(key) ?? []), lesson]);
    }
    for (const items of grouped.values()) items.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return grouped;
  }, [lessons]);
  const step = (amount: number) => setFocus((key) => (mode === "month" ? addMonths(key, amount) : addDays(key, mode === "week" ? amount * 7 : amount)));
  const currentToday = today();
  const availabilityFor = (key: string) => windows.filter((window) => window.weekday === WEEKDAY_KEYS[dayOfWeek(key)]);

  const eventList = (key: string) => {
    const events = lessonsByDay.get(key) ?? [];
    const available = availabilityFor(key);
    return (
      <div className="min-w-0 space-y-2">
        {events.length === 0 && available.length === 0 && <p className="py-1 text-sm text-fg-muted">Sem aulas ou disponibilidade cadastrada.</p>}
        {events.map((lesson) => (
          <button
            type="button"
            key={lesson.id}
            data-testid="real-calendar-lesson"
            onClick={() => setSelected(lesson)}
            className={cn(
              "flex w-full min-w-0 flex-wrap items-center justify-between gap-2 rounded-control border-l-4 bg-surface-muted px-3 py-2.5 text-left hover:bg-primary-soft",
              lesson.status === "scheduled" ? "border-success" : lesson.status === "awaiting_payment" ? "border-warning-text" : "border-line-strong",
            )}
          >
            <span className="min-w-0">
              <span className="block font-semibold tabular-nums text-fg-strong">{timeOf(lesson.starts_at)}–{timeOf(lesson.ends_at)}</span>
              <span className="block truncate text-sm text-fg">{lesson.subject} · {lesson.student.display_name ?? "Aluno"}</span>
            </span>
            <Badge tone={STATUS[lesson.status].tone}>{STATUS[lesson.status].label}</Badge>
          </button>
        ))}
        {available.length > 0 && (
          <p className="text-xs text-fg-muted" aria-label={`Disponibilidade recorrente em ${dayName(key)}`}>
            Disponibilidade: {available.map((window) => `${window.start}–${window.end}`).join(" · ")}
          </p>
        )}
      </div>
    );
  };

  const navigateMonthGrid = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, () => string> = {
      ArrowRight: () => addDays(focus, 1), ArrowLeft: () => addDays(focus, -1), ArrowDown: () => addDays(focus, 7), ArrowUp: () => addDays(focus, -7),
      Home: () => startOfWeek(focus), End: () => addDays(startOfWeek(focus), 6), PageUp: () => addMonths(focus, -1), PageDown: () => addMonths(focus, 1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const next = move();
    setFocus(next);
    queueMicrotask(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-calendar-day="${next}"]`)?.focus());
  };

  const title = mode === "month" ? monthName(focus) : mode === "week" ? `${dayName(weekDays(focus)[0]!)} – ${dayName(weekDays(focus)[6]!)}` : dayName(focus);
  return (
    <section aria-labelledby="agenda-real-title" className="space-y-4" data-testid="real-calendar">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 id="agenda-real-title" className="text-lg font-semibold text-fg-strong">Aulas e disponibilidade</h2><p className="text-sm text-fg-muted">Dados da sua conta · horários de Brasília.</p></div>
        <SegmentedControl label="Visualização da agenda" options={[{ value: "day", label: "Dia" }, { value: "week", label: "Semana" }, { value: "month", label: "Mês" }]} value={mode} onChange={setMode} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Button variant="secondary" size="sm" onClick={() => step(-1)} aria-label={`${mode === "month" ? "Mês" : mode === "week" ? "Semana" : "Dia"} anterior`}>Anterior</Button>
        <div className="min-w-0 text-center"><p className="truncate font-semibold text-fg-strong" aria-live="polite">{title}</p>{focus !== currentToday && <button type="button" className="text-sm font-medium text-link hover:underline" onClick={() => setFocus(currentToday)}>Hoje</button>}</div>
        <Button variant="secondary" size="sm" onClick={() => step(1)} aria-label={mode === "month" ? "Próximo mês" : mode === "week" ? "Próxima semana" : "Próximo dia"}>Próximo</Button>
      </div>
      {mode === "day" && <section className="rounded-card border border-line bg-surface p-4 shadow-card" aria-label={`Agenda de ${dayName(focus)}`}>{eventList(focus)}</section>}
      {mode === "week" && <ol className="grid gap-2.5" aria-label="Semana da agenda">{weekDays(focus).map((key) => <li key={key} className={cn("rounded-card border bg-surface shadow-card", key === currentToday ? "border-primary" : "border-line")}><div className="border-b border-line px-4 py-3"><p className="font-semibold text-fg-strong">{dayName(key)}{key === currentToday ? <span className="ml-2 text-sm text-link">· Hoje</span> : null}</p></div><div className="p-3 sm:p-4">{eventList(key)}</div></li>)}</ol>}
      {mode === "month" && <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"><div><div className="mb-1 grid grid-cols-7 text-center text-xs font-medium text-fg-muted" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day} className="py-1">{day}</span>)}</div><div ref={gridRef} role="group" aria-label={`Dias de ${monthName(focus)}. Use as setas para navegar.`} onKeyDown={navigateMonthGrid} className="grid grid-cols-7 gap-1">{monthGrid(focus).map((key) => { const count = (lessonsByDay.get(key) ?? []).filter((lesson) => lesson.status !== "cancelled").length; const selectedDay = key === focus; return <button type="button" key={key} data-calendar-day={key} tabIndex={selectedDay ? 0 : -1} aria-pressed={selectedDay} aria-label={`${dayName(key)}, ${count ? `${count} ${count === 1 ? "aula" : "aulas"}` : "sem aulas"}`} onClick={() => setFocus(key)} className={cn("flex min-h-12 flex-col items-center justify-center gap-1 rounded-control text-sm tabular-nums sm:min-h-16", selectedDay ? "bg-primary text-primary-fg" : "hover:bg-surface-muted", !selectedDay && !sameMonth(key, focus) && "text-fg-muted", !selectedDay && key === currentToday && "ring-2 ring-primary ring-inset")}><span className="font-semibold">{fromKey(key).getDate()}</span><span className="flex h-1.5 gap-0.5" aria-hidden="true">{Array.from({ length: Math.min(count, 3) }, (_, index) => <span key={index} className={cn("h-1.5 w-1.5 rounded-full", selectedDay ? "bg-primary-fg" : "bg-primary")} />)}</span></button>; })}</div></div><section className="rounded-card border border-line bg-surface p-4 shadow-card" aria-label={`Detalhes de ${dayName(focus)}`}><h3 className="mb-3 font-semibold text-fg-strong">{dayName(focus)}</h3>{eventList(focus)}</section></div>}
      <LessonDialog lesson={selected} onClose={() => setSelected(null)} />
    </section>
  );
}

function LessonDialog({ lesson, onClose }: { lesson: Lesson | null; onClose: () => void }) {
  const toast = useToast();
  const cancel = useCancelLessonMutation();
  const resync = useResyncLessonMutation();
  const [confirming, setConfirming] = useState(false);
  if (!lesson) return null;
  const fail = (error: unknown) => toast({ tone: "error", title: "Não foi possível concluir", description: describeError(error) });
  const doCancel = async () => { await cancel.mutateAsync(lesson.id); toast({ tone: "success", title: "Aula cancelada" }); onClose(); };
  const doResync = async () => { const updated = await resync.mutateAsync(lesson.id); toast(updated.calendar_sync_status === "synced" ? { tone: "success", title: "Evento sincronizado com Google Agenda" } : { tone: "info", title: "Ainda não foi possível sincronizar" }); };
  const rows: Array<[string, string]> = [["Aluno", lesson.student.display_name ?? "—"], ["Disciplina", lesson.subject], ["Data", dayLabelOf(lesson.starts_at)], ["Horário", `${timeOf(lesson.starts_at)}–${timeOf(lesson.ends_at)}`], ["Reserva", STATUS[lesson.status].label], ["Google Agenda", SYNC[lesson.calendar_sync_status]]];
  return <Dialog open onClose={onClose} title="Detalhes da aula" variant="sheet" footer={<><Button variant="secondary" onClick={onClose}>Fechar</Button>{isCancellable(lesson) && (confirming ? <Button variant="danger" loading={cancel.isPending} onClick={() => void doCancel().catch(fail)}>Confirmar cancelamento</Button> : <Button variant="danger" onClick={() => setConfirming(true)}>Cancelar aula</Button>)}</>}><div className="space-y-5">{lesson.meet_url && isTrustedMeetUrl(lesson.meet_url) && <a href={lesson.meet_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-medium text-link hover:underline"><VideoIcon className="h-4 w-4" /> Entrar no Google Meet <span className="sr-only">(abre em nova aba)</span></a>}<dl className="divide-y divide-line text-sm">{rows.map(([label, value]) => <div key={label} className="grid gap-0.5 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)]"><dt className="text-fg-muted">{label}</dt><dd className="break-words font-medium text-fg-strong">{value}</dd></div>)}</dl>{lesson.status === "scheduled" && lesson.calendar_sync_status !== "synced" && <Button variant="secondary" size="sm" leftIcon={<RefreshIcon className="h-4 w-4" />} loading={resync.isPending} onClick={() => void doResync().catch(fail)}>Tentar sincronizar agenda</Button>}</div></Dialog>;
}
