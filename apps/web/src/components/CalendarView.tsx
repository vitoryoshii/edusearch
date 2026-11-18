import { useEffect, useRef, type ReactNode } from "react";
import { AlertIcon, Badge, Button, ChevronLeftIcon, ChevronRightIcon, IconButton, VideoIcon, cn } from "@edusearch/ui";
import type { Lesson, TimeSlot } from "../lib/api/types";
import {
  WEEKDAY_HEADERS,
  addDays,
  addMonths,
  dateKey,
  dayLabelLong,
  fromKey,
  lessonsOn,
  monthGrid,
  monthLabel,
  sameMonth,
  todayKey,
  weekDays,
  weekLabel,
  weekdayShort,
} from "../lib/calendar";
import { subjectName } from "../lib/catalog";
import { STATUS_LABELS, formatTime, formatTimeRange } from "../lib/format";

export type CalendarMode = "week" | "month";

export type DayInfo = {
  blocked?: boolean;
  /** Horários livres (visão do professor). */
  freeSlots?: TimeSlot[];
  /** Conflitos por id de aula (visão do professor). */
  conflicts?: Map<string, string>;
};

const BAR: Record<Lesson["status"], string> = {
  scheduled: "border-primary",
  pending_payment: "border-warning-text",
  completed: "border-success",
  cancelled: "border-line-strong",
};

/** Um evento (aula) no calendário. Abre os detalhes ao ser acionado. */
function EventItem({
  lesson,
  perspective,
  conflict,
  onSelect,
}: {
  lesson: Lesson;
  perspective: "student" | "teacher";
  conflict?: string;
  onSelect: (l: Lesson) => void;
}) {
  const person = perspective === "student" ? lesson.teacherName : lesson.studentName;
  const cancelled = lesson.status === "cancelled";
  return (
    <button
      type="button"
      onClick={() => onSelect(lesson)}
      aria-label={`${subjectName(lesson.subject)}, ${formatTimeRange(lesson.start, lesson.end)}, com ${person}, ${STATUS_LABELS[lesson.status]}${conflict ? `, conflito: ${conflict}` : ""}. Abrir detalhes`}
      className={cn(
        "flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-control border-l-4 bg-surface-muted px-3 py-2.5 text-left transition-colors hover:bg-primary-soft",
        BAR[lesson.status],
        conflict && "ring-1 ring-warning-text",
      )}
    >
      <span className="min-w-0">
        <span className={cn("block text-sm font-semibold tabular-nums", cancelled ? "text-fg-muted line-through" : "text-fg-strong")}>
          {formatTimeRange(lesson.start, lesson.end)}
        </span>
        <span className="block truncate text-sm text-fg">
          {subjectName(lesson.subject)} · {person}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {lesson.status !== "scheduled" && (
          <Badge tone={lesson.status === "pending_payment" ? "warning" : lesson.status === "completed" ? "success" : "neutral"}>
            {STATUS_LABELS[lesson.status]}
          </Badge>
        )}
        {conflict && (
          <Badge tone="warning" icon={<AlertIcon />}>
            Conflito
          </Badge>
        )}
        {!cancelled && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted">
            <VideoIcon className="h-3.5 w-3.5" /> Online
          </span>
        )}
      </span>
    </button>
  );
}

/** Conteúdo de um dia: aulas, horários livres e ações (ex.: bloquear o dia). */
function DayContent({
  dayKey,
  lessons,
  perspective,
  info,
  onSelectLesson,
  actions,
}: {
  dayKey: string;
  lessons: Lesson[];
  perspective: "student" | "teacher";
  info?: DayInfo;
  onSelectLesson: (l: Lesson) => void;
  actions?: ReactNode;
}) {
  const items = lessonsOn(lessons, dayKey);
  const free = info?.freeSlots ?? [];
  return (
    <div className="space-y-2">
      {items.length === 0 && free.length === 0 && !info?.blocked && <p className="py-1 text-sm text-fg-muted">Sem aulas</p>}
      {info?.blocked && (
        <p className="flex items-center gap-2 text-sm font-medium text-fg-muted">
          <span className="inline-block h-2 w-2 rounded-full bg-fg-muted" aria-hidden="true" />
          Dia bloqueado — sem novos horários
        </p>
      )}
      {items.length > 0 && (
        <ul className="grid gap-2">
          {items.map((l) => (
            <li key={l.id}>
              <EventItem lesson={l} perspective={perspective} conflict={info?.conflicts?.get(l.id)} onSelect={onSelectLesson} />
            </li>
          ))}
        </ul>
      )}
      {free.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-fg-muted">Horários livres</p>
          <ul className="flex flex-wrap gap-1.5" aria-label={`Horários livres em ${dayLabelLong(dayKey)}`}>
            {free.map((s) => (
              <li key={s.id} className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs font-medium text-fg tabular-nums">
                {formatTime(s.start)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {actions}
    </div>
  );
}

/**
 * Calendário semanal e mensal compartilhado por aluno e professor.
 * - Semana: lista vertical de 7 dias (boa leitura no celular).
 * - Mês: grade navegável por teclado (setas, Home/End, PageUp/PageDown) e
 *   painel com os eventos do dia selecionado.
 */
export function CalendarView({
  mode,
  focus,
  onFocusChange,
  lessons,
  perspective,
  onSelectLesson,
  dayInfo,
  renderDayActions,
}: {
  mode: CalendarMode;
  /** Dia em foco (YYYY-MM-DD): define a semana/mês exibidos e o dia selecionado no mês. */
  focus: string;
  onFocusChange: (key: string) => void;
  lessons: Lesson[];
  perspective: "student" | "teacher";
  onSelectLesson: (l: Lesson) => void;
  dayInfo?: (key: string) => DayInfo | undefined;
  renderDayActions?: (key: string) => ReactNode;
}) {
  const today = todayKey();
  const gridRef = useRef<HTMLDivElement>(null);
  const focusGridDay = useRef(false);

  // Após navegar pelo teclado na grade, leva o foco ao novo dia selecionado.
  useEffect(() => {
    if (!focusGridDay.current) return;
    focusGridDay.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus]);

  const step = mode === "week" ? (n: number) => addDays(focus, 7 * n) : (n: number) => addMonths(focus, n);
  const title = mode === "week" ? weekLabel(focus) : monthLabel(focus);
  const unit = mode === "week" ? "semana" : "mês";

  const onGridKey = (e: React.KeyboardEvent) => {
    const moves: Record<string, () => string> = {
      ArrowRight: () => addDays(focus, 1),
      ArrowLeft: () => addDays(focus, -1),
      ArrowDown: () => addDays(focus, 7),
      ArrowUp: () => addDays(focus, -7),
      Home: () => addDays(focus, -((fromKey(focus).getDay() + 6) % 7)),
      End: () => addDays(focus, 6 - ((fromKey(focus).getDay() + 6) % 7)),
      PageUp: () => addMonths(focus, -1),
      PageDown: () => addMonths(focus, 1),
    };
    const fn = moves[e.key];
    if (!fn) return;
    e.preventDefault();
    focusGridDay.current = true;
    onFocusChange(fn());
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <IconButton label={`${mode === "week" ? "Semana" : "Mês"} anterior`} variant="secondary" onClick={() => onFocusChange(step(-1))}>
          <ChevronLeftIcon className="h-5 w-5" />
        </IconButton>
        <div className="text-center">
          <p className="font-semibold text-fg-strong" aria-live="polite">
            {title}
          </p>
          {(mode === "week" ? !weekDays(focus).includes(today) : !sameMonth(focus, today)) && (
            <button type="button" onClick={() => onFocusChange(today)} className="text-sm font-medium text-link hover:underline">
              Voltar para {mode === "week" ? "esta semana" : "este mês"}
            </button>
          )}
        </div>
        <IconButton label={`${mode === "week" ? "Próxima semana" : "Próximo mês"}`} variant="secondary" onClick={() => onFocusChange(step(1))}>
          <ChevronRightIcon className="h-5 w-5" />
        </IconButton>
      </div>

      {mode === "week" ? (
        <ol className="grid gap-2.5" aria-label={`Dias da ${unit}`}>
          {weekDays(focus).map((key) => {
            const isToday = key === today;
            const info = dayInfo?.(key);
            return (
              <li key={key}>
                <div
                  className={cn(
                    "flex flex-col rounded-card border bg-surface shadow-card sm:flex-row",
                    isToday ? "border-primary" : "border-line",
                    info?.blocked && "bg-surface-muted",
                  )}
                >
                  <div className="flex items-center gap-2 border-b border-line px-4 py-3 sm:w-36 sm:shrink-0 sm:flex-col sm:items-start sm:border-r sm:border-b-0">
                    <p className="font-semibold text-fg-strong">
                      {weekdayShort(key)}, {fromKey(key).getDate()}
                    </p>
                    {isToday && <Badge tone="primary">Hoje</Badge>}
                  </div>
                  <div className="flex-1 p-3 sm:p-4">
                    <DayContent
                      dayKey={key}
                      lessons={lessons}
                      perspective={perspective}
                      info={info}
                      onSelectLesson={onSelectLesson}
                      actions={renderDayActions?.(key)}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <div className="mb-1 grid grid-cols-7 text-center text-xs font-medium text-fg-muted" aria-hidden="true">
              {WEEKDAY_HEADERS.map((d) => (
                <span key={d} className="py-1">
                  {d}
                </span>
              ))}
            </div>
            <div ref={gridRef} role="group" aria-label={`Dias de ${monthLabel(focus)}. Use as setas para navegar.`} className="grid grid-cols-7 gap-1" onKeyDown={onGridKey}>
              {monthGrid(focus).map((key) => {
                const inMonth = sameMonth(key, focus);
                const count = lessonsOn(lessons, key).filter((l) => l.status !== "cancelled").length;
                const info = dayInfo?.(key);
                const selected = key === focus;
                const isToday = key === today;
                const label = [
                  dayLabelLong(key),
                  count ? `${count} ${count === 1 ? "aula" : "aulas"}` : "sem aulas",
                  isToday ? "hoje" : "",
                  info?.blocked ? "dia bloqueado" : "",
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <button
                    key={key}
                    type="button"
                    data-day={key}
                    tabIndex={selected ? 0 : -1}
                    aria-pressed={selected}
                    aria-label={label}
                    onClick={() => onFocusChange(key)}
                    className={cn(
                      "flex min-h-12 flex-col items-center justify-center gap-1 rounded-control text-sm tabular-nums transition-colors sm:min-h-16",
                      selected ? "bg-primary text-primary-fg" : "hover:bg-surface-muted",
                      !selected && (inMonth ? "text-fg-strong" : "text-fg-muted"),
                      !selected && isToday && "ring-2 ring-primary ring-inset",
                      !selected && info?.blocked && "bg-surface-muted line-through",
                    )}
                  >
                    <span className="font-semibold">{fromKey(key).getDate()}</span>
                    <span className="flex h-1.5 gap-0.5" aria-hidden="true">
                      {Array.from({ length: Math.min(count, 3) }, (_, i) => (
                        <span key={i} className={cn("h-1.5 w-1.5 rounded-full", selected ? "bg-primary-fg" : "bg-primary")} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <section aria-labelledby="dia-selecionado" className="rounded-card border border-line bg-surface p-4 shadow-card">
            <h3 id="dia-selecionado" className="mb-3 font-semibold text-fg-strong">
              {dayLabelLong(focus)}
              {focus === today && <span className="ml-2 text-sm font-medium text-link">· Hoje</span>}
            </h3>
            <DayContent
              dayKey={focus}
              lessons={lessons}
              perspective={perspective}
              info={dayInfo?.(focus)}
              onSelectLesson={onSelectLesson}
              actions={renderDayActions?.(focus)}
            />
          </section>
        </div>
      )}
    </div>
  );
}

/** Hoje como foco inicial do calendário. */
export const initialCalendarFocus = () => dateKey(new Date());

/** Botão discreto "Hoje" para cabeçalhos de página. */
export function TodayButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick}>
      Hoje
    </Button>
  );
}
