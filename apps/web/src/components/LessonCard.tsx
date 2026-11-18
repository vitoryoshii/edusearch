import type { ReactNode } from "react";
import { Badge, CalendarIcon, Card, type BadgeTone } from "@edusearch/ui";
import type { Lesson } from "../lib/api/types";
import { subjectName } from "../lib/catalog";
import { STATUS_LABELS, formatDateShort, formatTimeRange } from "../lib/format";

const statusTone: Record<Lesson["status"], BadgeTone> = {
  scheduled: "primary",
  completed: "success",
  cancelled: "neutral",
};

/** Aula do aluno (mostra o professor) ou do professor (mostra o aluno). */
export function LessonCard({
  lesson,
  perspective,
  actions,
  highlight = false,
  badge,
}: {
  lesson: Lesson;
  perspective: "student" | "teacher";
  actions?: ReactNode;
  highlight?: boolean;
  badge?: ReactNode;
}) {
  const person = perspective === "student" ? `com ${lesson.teacherName}` : `com ${lesson.studentName}`;
  return (
    <Card as="article" padding="none" tone={highlight ? "soft" : "default"}>
      <div className="flex items-start gap-4 p-4 sm:p-5">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-control bg-primary-soft text-link"
        >
          <CalendarIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-fg-strong">{subjectName(lesson.subject)}</h3>
            <Badge tone={statusTone[lesson.status]} dot>
              {STATUS_LABELS[lesson.status]}
            </Badge>
            {badge}
          </div>
          <p className="mt-0.5 text-sm text-fg-muted">{person}</p>
          <p className="mt-2 text-sm font-medium text-fg-strong">
            <time dateTime={lesson.start}>{formatDateShort(lesson.start)}</time> · {formatTimeRange(lesson.start, lesson.end)}
          </p>
          {lesson.topic && <p className="mt-1 text-sm text-fg">Tema: {lesson.topic}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3 sm:px-5">{actions}</div>}
    </Card>
  );
}
