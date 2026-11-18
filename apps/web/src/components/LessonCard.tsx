import type { ReactNode } from "react";
import { CalendarIcon, Card, VideoIcon } from "@edusearch/ui";
import type { Lesson } from "../lib/api/types";
import { subjectName } from "../lib/catalog";
import { isDemo } from "../lib/data/source";
import { formatDateShort, formatTimeRange } from "../lib/format";
import { LessonStatusBadge, PaymentStatusBadge } from "./StatusBadges";

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
  const showPayment = lesson.status === "pending_payment" && lesson.payment;
  return (
    <Card as="article" padding="none" tone={highlight ? "soft" : "default"}>
      <div className="flex items-start gap-4 p-4 sm:p-5">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-primary-soft text-link">
          <CalendarIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-fg-strong">{subjectName(lesson.subject)}</h3>
            <LessonStatusBadge status={lesson.status} />
            {showPayment && <PaymentStatusBadge status={lesson.payment!.status} simulated={isDemo} />}
            {badge}
          </div>
          <p className="mt-0.5 text-sm text-fg-muted">{person}</p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-fg-strong">
            <span>
              <time dateTime={lesson.start}>{formatDateShort(lesson.start)}</time> · {formatTimeRange(lesson.start, lesson.end)}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted">
              <VideoIcon className="h-3.5 w-3.5" /> Online
            </span>
          </p>
          {lesson.topic && <p className="mt-1 text-sm text-fg">Tema: {lesson.topic}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3 sm:px-5">{actions}</div>}
    </Card>
  );
}
