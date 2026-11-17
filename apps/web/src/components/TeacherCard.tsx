import type { ReactNode } from "react";
import { Link } from "react-router";
import { Avatar, Badge, Card, ChevronRightIcon } from "@edusearch/ui";
import type { Teacher } from "../lib/api/types";
import { subjectName } from "../lib/catalog";
import { formatMoney } from "../lib/format";

/**
 * Card de professor. O card inteiro é clicável (link estendido via ::after),
 * mantendo um único alvo de foco por item.
 */
export function TeacherCard({ teacher, footer, compact = false }: { teacher: Teacher; footer?: ReactNode; compact?: boolean }) {
  return (
    <Card as="article" interactive padding="none">
      <div className="flex items-start gap-4 p-4 sm:p-5">
        <Avatar name={teacher.name} size={compact ? "md" : "lg"} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-fg-strong">
            <Link
              to={`/aluno/professores/${teacher.id}`}
              className="after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-link"
            >
              {teacher.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-sm text-fg-muted">{teacher.headline}</p>
          {!compact && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {teacher.subjects.map((s) => (
                <Badge key={s} tone="primary">
                  {subjectName(s)}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <span className="text-sm font-semibold text-fg-strong tabular-nums">{formatMoney(teacher.priceCents)}</span>
          <span className="text-xs text-fg-muted">por aula</span>
          <ChevronRightIcon className="mt-2 hidden h-5 w-5 text-fg-muted sm:block" />
        </div>
      </div>
      {footer && <div className="relative z-10 border-t border-line px-4 py-3 sm:px-5">{footer}</div>}
    </Card>
  );
}
