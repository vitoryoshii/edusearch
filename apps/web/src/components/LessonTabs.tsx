import { useState } from "react";
import { Button, Dialog, EmptyState, Tabs, VideoIcon, useToast, type TabItem } from "@edusearch/ui";
import { describeError } from "../lib/api/client";
import type { Lesson } from "../lib/api/types";
import { subjectName } from "../lib/catalog";
import { dataSource } from "../lib/data/source";
import { formatDateShort, formatTime } from "../lib/format";
import { DemoNotice } from "./DemoNotice";
import { LessonCard } from "./LessonCard";

/**
 * Lista de aulas em abas (próximas / concluídas / canceladas), com
 * cancelamento confirmado em diálogo. Usada por aluno e professor.
 */
export function LessonTabs({
  lessons,
  perspective,
  onChange,
  emptyAction,
}: {
  lessons: Lesson[];
  perspective: "student" | "teacher";
  onChange: (lessons: Lesson[]) => void;
  emptyAction?: React.ReactNode;
}) {
  const toast = useToast();
  const [toCancel, setToCancel] = useState<Lesson | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const now = Date.now();

  const upcoming = lessons
    .filter((l) => l.status === "scheduled" && new Date(l.end).getTime() > now)
    .sort((a, b) => a.start.localeCompare(b.start));
  const done = lessons.filter((l) => l.status === "completed").sort((a, b) => b.start.localeCompare(a.start));
  const cancelled = lessons.filter((l) => l.status === "cancelled").sort((a, b) => b.start.localeCompare(a.start));

  const confirmCancel = async () => {
    if (!toCancel) return;
    setCancelling(true);
    try {
      const updated = await dataSource.cancelLesson(toCancel.id);
      onChange(lessons.map((l) => (l.id === updated.id ? updated : l)));
      toast({ title: "Aula cancelada", description: "Demonstração: ninguém foi notificado." });
      setToCancel(null);
    } catch (e) {
      toast({ tone: "error", title: "Não foi possível cancelar", description: describeError(e) });
    } finally {
      setCancelling(false);
    }
  };

  const list = (items: Lesson[], empty: { title: string; description: string }, withActions = false) =>
    items.length === 0 ? (
      <EmptyState {...empty} action={withActions ? emptyAction : undefined} />
    ) : (
      <ul className="grid gap-3">
        {items.map((l) => (
          <li key={l.id}>
            <LessonCard
              lesson={l}
              perspective={perspective}
              actions={
                withActions && (
                  <>
                    <Button
                      size="sm"
                      leftIcon={<VideoIcon className="h-4 w-4" />}
                      disabled={!l.meetingUrl}
                      title={l.meetingUrl ? undefined : "O link do Google Meet será gerado quando a integração estiver ativa."}
                    >
                      Entrar na aula
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setToCancel(l)}>
                      Cancelar
                    </Button>
                  </>
                )
              }
            />
          </li>
        ))}
      </ul>
    );

  const items: TabItem[] = [
    {
      id: "proximas",
      label: "Próximas",
      count: upcoming.length,
      content: (
        <>
          {upcoming.length > 0 && (
            <DemoNotice className="mb-4">
              O botão “Entrar na aula” será liberado quando a integração com o Google Meet gerar o link de cada aula.
            </DemoNotice>
          )}
          {list(upcoming, { title: "Nenhuma aula agendada", description: "As próximas aulas aparecerão aqui." }, true)}
        </>
      ),
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
      <Dialog
        open={toCancel !== null}
        onClose={() => !cancelling && setToCancel(null)}
        size="sm"
        title="Cancelar esta aula?"
        description={
          toCancel
            ? `${subjectName(toCancel.subject)} · ${formatDateShort(toCancel.start)}, ${formatTime(toCancel.start)}. Esta ação não pode ser desfeita.`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setToCancel(null)} disabled={cancelling}>
              Manter aula
            </Button>
            <Button variant="danger" loading={cancelling} onClick={confirmCancel}>
              Cancelar aula
            </Button>
          </>
        }
      />
    </>
  );
}
