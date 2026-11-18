import { useState } from "react";
import { teacherSession, useSession } from "../app/session";
import { Badge, Button, Dialog, EmptyState, Tabs, VideoIcon, useToast, type TabItem } from "@edusearch/ui";
import { describeError } from "../lib/api/client";
import type { Lesson } from "../lib/api/types";
import { subjectName } from "../lib/catalog";
import { dataSource } from "../lib/data/source";
import { STATUS_LABELS, formatDateLong, formatDateShort, formatMoney, formatTime, formatTimeRange } from "../lib/format";
import { DemoNotice } from "./DemoNotice";
import { LessonCard } from "./LessonCard";

const canCancel = (l: Lesson) => l.status === "scheduled" && new Date(l.start).getTime() > Date.now();

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
  const toast = useToast();
  const { switchRole } = useSession();
  const [toCancel, setToCancel] = useState<Lesson | null>(null);
  const [details, setDetails] = useState<Lesson | null>(null);
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
      toast({
        title: "Aula cancelada",
        description: "O horário voltou a ficar disponível. Demonstração: ninguém foi notificado.",
      });
      setToCancel(null);
      setDetails(null);
    } catch (e) {
      toast({ tone: "error", title: "Não foi possível cancelar", description: describeError(e) });
    } finally {
      setCancelling(false);
    }
  };

  const person = (l: Lesson) => (perspective === "student" ? l.teacherName : l.studentName);

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
                    {upcomingList && (
                      <Button
                        size="sm"
                        leftIcon={<VideoIcon className="h-4 w-4" />}
                        disabled={!l.meetingUrl}
                        title={l.meetingUrl ? undefined : "O link será gerado após a integração com o Google Meet."}
                      >
                        Entrar na aula
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => setDetails(l)} aria-label={`Detalhes da aula de ${subjectName(l.subject)} em ${formatDateShort(l.start)}`}>
                      Detalhes
                    </Button>
                    {canCancel(l) && (
                      <Button size="sm" variant="ghost" onClick={() => setToCancel(l)}>
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
        open={details !== null}
        onClose={() => setDetails(null)}
        title={details ? `${subjectName(details.subject)} · ${STATUS_LABELS[details.status]}` : "Detalhes da aula"}
        variant="sheet"
        footer={
          details && (
            <>
              {canCancel(details) && (
                <Button
                  variant="danger"
                  onClick={() => {
                    setToCancel(details);
                    setDetails(null);
                  }}
                >
                  Cancelar aula
                </Button>
              )}
              {perspective === "student" && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    // Demonstração: abre a visão do professor desta aula para conferir a reserva.
                    setDetails(null);
                    switchRole(teacherSession({ id: details.teacherId, name: details.teacherName }), "/professor/aulas");
                  }}
                >
                  Ver na agenda do professor
                </Button>
              )}
              <Button variant="secondary" onClick={() => setDetails(null)}>
                Fechar
              </Button>
            </>
          )
        }
      >
        {details && (
          <dl className="divide-y divide-line text-sm">
            {[
              [perspective === "student" ? "Professor" : "Aluno", person(details)],
              ["Data", formatDateLong(details.start)],
              ["Horário", formatTimeRange(details.start, details.end)],
              ["Tema", details.topic || "Não informado"],
              ["Valor", formatMoney(details.priceCents)],
              ["Videochamada", details.meetingUrl ? details.meetingUrl : "Link pendente (integração com o Google Meet)"],
              ["Pagamento", "Não cobrado (demonstração)"],
              ["Código da reserva", details.id],
            ].map(([k, v]) => (
              <div key={k} className="grid gap-0.5 py-2.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-fg-muted">{k}</dt>
                <dd className="font-medium break-words text-fg-strong">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Dialog>

      <Dialog
        open={toCancel !== null}
        onClose={() => !cancelling && setToCancel(null)}
        size="sm"
        title="Cancelar esta aula?"
        description={
          toCancel
            ? `${subjectName(toCancel.subject)} · ${formatDateShort(toCancel.start)}, ${formatTime(toCancel.start)}. O horário volta a ficar disponível.`
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
