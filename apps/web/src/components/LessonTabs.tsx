import { Link } from "react-router";
import { Badge, Button, EmptyState, Tabs, type TabItem, buttonClasses } from "@edusearch/ui";
import type { Lesson } from "../lib/api/types";
import { subjectName } from "../lib/catalog";
import { formatDateShort } from "../lib/format";
import { LessonCard } from "./LessonCard";
import { LessonDetailsDialog, canCancelLesson, useLessonDialogs } from "./LessonDetailsDialog";

/**
 * Lista de aulas em abas (próximas / concluídas / canceladas), com detalhes e
 * cancelamento confirmado em diálogo. Usada por aluno e professor.
 * `highlightId` destaca uma aula recém-reservada.
 */
export function LessonTabs({
  lessons,
  perspective,
  onChange,
  emptyAction,
  highlightId,
}: {
  lessons: Lesson[];
  perspective: "student" | "teacher";
  onChange: (lessons: Lesson[]) => void;
  emptyAction?: React.ReactNode;
  highlightId?: string;
}) {
  const dialogs = useLessonDialogs();
  const now = Date.now();
  const active = (l: Lesson) => l.status === "scheduled" || l.status === "pending_payment";

  const upcoming = lessons.filter((l) => active(l) && new Date(l.end).getTime() > now).sort((a, b) => a.start.localeCompare(b.start));
  const done = lessons.filter((l) => l.status === "completed").sort((a, b) => b.start.localeCompare(a.start));
  const cancelled = lessons.filter((l) => l.status === "cancelled").sort((a, b) => b.start.localeCompare(a.start));

  const base = perspective === "student" ? "/aluno" : "/professor";

  const list = (items: Lesson[], empty: { title: string; description: string }, upcomingList = false) =>
    items.length === 0 ? (
      <EmptyState {...empty} action={upcomingList ? emptyAction : undefined} />
    ) : (
      <ul className="grid gap-3">
        {items.map((l) => {
          const isNew = l.id === highlightId;
          return (
            <li key={l.id} className={isNew ? "animate-slide-up" : undefined}>
              <LessonCard
                lesson={l}
                perspective={perspective}
                highlight={isNew}
                badge={isNew ? <Badge tone="success">Nova reserva</Badge> : undefined}
                actions={
                  <>
                    {perspective === "student" && l.status === "pending_payment" ? (
                      <Link to={`/aluno/pagamento/${l.id}`} className={buttonClasses({ size: "sm" })}>
                        Pagar com Pix
                      </Link>
                    ) : (
                      upcomingList && (
                        <Link to={`${base}/aulas/${l.id}`} className={buttonClasses({ size: "sm" })}>
                          Aula online
                        </Link>
                      )
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => dialogs.setDetails(l)}
                      aria-label={`Detalhes da aula de ${subjectName(l.subject)} em ${formatDateShort(l.start)}`}
                    >
                      Detalhes
                    </Button>
                    {canCancelLesson(l) && (
                      <Button size="sm" variant="ghost" onClick={() => dialogs.setConfirming(l)}>
                        Cancelar
                      </Button>
                    )}
                  </>
                }
              />
            </li>
          );
        })}
      </ul>
    );

  const items: TabItem[] = [
    {
      id: "proximas",
      label: "Próximas",
      count: upcoming.length,
      content: list(upcoming, { title: "Nenhuma aula agendada", description: "As próximas aulas aparecerão aqui." }, true),
    },
    {
      id: "concluidas",
      label: "Concluídas",
      count: done.length,
      content: list(done, { title: "Nenhuma aula concluída", description: "O histórico aparecerá após as primeiras aulas." }),
    },
    {
      id: "canceladas",
      label: "Canceladas",
      count: cancelled.length,
      content: list(cancelled, { title: "Nenhuma aula cancelada", description: "Tudo certo por aqui." }),
    },
  ];

  return (
    <>
      <Tabs label="Filtrar aulas por situação" items={items} />
      <LessonDetailsDialog
        lesson={dialogs.details}
        perspective={perspective}
        onClose={() => dialogs.setDetails(null)}
        confirming={dialogs.confirming}
        setConfirming={dialogs.setConfirming}
        onChanged={(updated) => onChange(lessons.map((l) => (l.id === updated.id ? updated : l)))}
      />
    </>
  );
}
