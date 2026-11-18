import { Link } from "react-router";
import { EmptyState, Skeleton, cn } from "@edusearch/ui";
import { describeError } from "../lib/api/client";
import { dataSource } from "../lib/data/source";
import { formatDateShort, formatTime } from "../lib/format";
import { useAsync } from "../lib/hooks/useAsync";
import { SectionTitle } from "./PageHeader";

/** Próximos horários livres de um professor, com atalho para reservar. */
export function NextSlots({ teacherId, limit = 6 }: { teacherId: string; limit?: number }) {
  const slots = useAsync(() => dataSource.listTeacherSlots(teacherId), [teacherId]);
  const base = `/aluno/professores/${teacherId}/agendar`;

  return (
    <section aria-labelledby="proximos-horarios">
      <SectionTitle
        id="proximos-horarios"
        action={
          slots.status === "success" && slots.data.length > 0 ? (
            <Link to={base} className="text-sm font-medium text-link hover:underline">
              Ver todos
            </Link>
          ) : undefined
        }
      >
        Próximos horários disponíveis
      </SectionTitle>
      {slots.status === "loading" && (
        <div role="status" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <span className="sr-only">Carregando horários…</span>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      )}
      {slots.status === "error" && (
        <p role="alert" className="text-sm text-danger-text">
          {describeError(slots.error)}{" "}
          <button type="button" onClick={slots.reload} className="font-medium underline">
            Tentar novamente
          </button>
        </p>
      )}
      {slots.status === "success" &&
        (slots.data.length === 0 ? (
          <EmptyState compact title="Sem horários livres nos próximos 7 dias" description="Volte mais tarde ou procure outro professor." />
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {slots.data.slice(0, limit).map((s) => (
              <li key={s.id}>
                <Link
                  to={`${base}?horario=${encodeURIComponent(s.id)}`}
                  className={cn(
                    "flex min-h-14 flex-col justify-center rounded-control border border-line-strong bg-surface px-3 py-2 transition-colors",
                    "hover:border-link hover:bg-primary-soft",
                  )}
                >
                  <span className="text-xs text-fg-muted">{formatDateShort(s.start)}</span>
                  <span className="font-semibold text-fg-strong tabular-nums">{formatTime(s.start)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
