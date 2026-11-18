import { useMemo, useState } from "react";
import { Badge, Card, ChevronLeftIcon, ChevronRightIcon, IconButton, cn } from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { PageHeader } from "../../components/PageHeader";
import type { Lesson } from "../../lib/api/types";
import { subjectName } from "../../lib/catalog";
import { dataSource } from "../../lib/data/source";
import { STATUS_LABELS, formatDateShort, formatTimeRange } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";

function startOfWeek(offset: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() + 6) % 7; // segunda-feira
  d.setDate(d.getDate() - diff + offset * 7);
  return d;
}

const rangeFmt = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" });

function Week({ lessons, offset }: { lessons: Lesson[]; offset: number }) {
  const days = useMemo(() => {
    const start = startOfWeek(offset);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [offset]);
  const today = new Date().toDateString();

  return (
    <ol className="grid gap-3">
      {days.map((d) => {
        const items = lessons
          .filter((l) => new Date(l.start).toDateString() === d.toDateString())
          .sort((a, b) => a.start.localeCompare(b.start));
        const isToday = d.toDateString() === today;
        return (
          <li key={d.toISOString()}>
            <Card padding="none" className={cn(isToday && "border-primary")}>
              <div className="flex flex-col sm:flex-row">
                <div className="flex items-center gap-2 border-b border-line px-4 py-3 sm:w-40 sm:shrink-0 sm:flex-col sm:items-start sm:border-r sm:border-b-0 sm:py-4">
                  <p className="font-semibold text-fg-strong">{formatDateShort(d.toISOString())}</p>
                  {isToday && <Badge tone="primary">Hoje</Badge>}
                </div>
                <div className="flex-1 p-3 sm:p-4">
                  {items.length === 0 ? (
                    <p className="px-1 py-1 text-sm text-fg-muted">Sem aulas</p>
                  ) : (
                    <ul className="grid gap-2">
                      {items.map((l) => (
                        <li
                          key={l.id}
                          className={cn(
                            "flex flex-wrap items-center justify-between gap-2 rounded-control border-l-4 bg-surface-muted px-3 py-2.5",
                            l.status === "cancelled" ? "border-line-strong opacity-70" : "border-primary",
                          )}
                        >
                          <div>
                            <p className="text-sm font-semibold text-fg-strong tabular-nums">{formatTimeRange(l.start, l.end)}</p>
                            <p className="text-sm text-fg">
                              {subjectName(l.subject)} · {l.studentName}
                            </p>
                          </div>
                          {l.status !== "scheduled" && <Badge tone={l.status === "completed" ? "success" : "neutral"}>{STATUS_LABELS[l.status]}</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}

export default function Agenda() {
  const lessons = useAsync(() => dataSource.listTeacherLessons(), []);
  const [offset, setOffset] = useState(0);
  const start = startOfWeek(offset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  return (
    <>
      <PageHeader title="Agenda" description="Suas aulas organizadas por semana." />
      <div className="mb-5 flex items-center justify-between gap-3">
        <IconButton label="Semana anterior" variant="secondary" onClick={() => setOffset((o) => o - 1)}>
          <ChevronLeftIcon className="h-5 w-5" />
        </IconButton>
        <div className="text-center" aria-live="polite">
          <p className="font-semibold text-fg-strong">
            {rangeFmt.format(start)} – {rangeFmt.format(end)}
          </p>
          {offset !== 0 && (
            <button type="button" onClick={() => setOffset(0)} className="text-sm font-medium text-link hover:underline">
              Voltar para esta semana
            </button>
          )}
        </div>
        <IconButton label="Próxima semana" variant="secondary" onClick={() => setOffset((o) => o + 1)}>
          <ChevronRightIcon className="h-5 w-5" />
        </IconButton>
      </div>
      <AsyncContent state={lessons} reload={lessons.reload}>
        {(data) => <Week lessons={data} offset={offset} />}
      </AsyncContent>
    </>
  );
}
