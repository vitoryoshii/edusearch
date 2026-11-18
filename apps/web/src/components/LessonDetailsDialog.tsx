import { useState } from "react";
import { Link } from "react-router";
import { ArrowRightIcon, Button, Dialog, DownloadIcon, buttonClasses, useToast } from "@edusearch/ui";
import { teacherSession, useSession } from "../app/session";
import { describeError } from "../lib/api/client";
import type { Lesson } from "../lib/api/types";
import { subjectName } from "../lib/catalog";
import { dataSource } from "../lib/data/source";
import { LEVEL_LABELS, PAYMENT_LABELS, STATUS_LABELS, formatDateLong, formatDateShort, formatMoney, formatTime, formatTimeRange } from "../lib/format";
import { downloadLessonIcs } from "../lib/ics";
import { meetingUnavailableMessage } from "../lib/meeting";

export const canCancelLesson = (l: Lesson) =>
  (l.status === "scheduled" || l.status === "pending_payment") && new Date(l.start).getTime() > Date.now();

const CALENDAR_SYNC_LABELS: Record<Lesson["calendarSync"], string> = {
  not_synced: "Sincronização Google pendente (integração futura)",
  pending: "Sincronizando…",
  synced: "Adicionada (simulação)",
  failed: "Falha ao sincronizar (simulação)",
};

/**
 * Detalhes de uma aula com as ações possíveis no estado atual.
 * Usado pela lista, pelo calendário do aluno e pela agenda do professor.
 */
export function LessonDetailsDialog({
  lesson,
  perspective,
  onClose,
  onChanged,
  confirming,
  setConfirming,
}: {
  lesson: Lesson | null;
  perspective: "student" | "teacher";
  onClose: () => void;
  onChanged: (lesson: Lesson) => void;
  /** Aula cuja confirmação de cancelamento está aberta (controlado pelo pai). */
  confirming: Lesson | null;
  setConfirming: (lesson: Lesson | null) => void;
}) {
  const toast = useToast();
  const { switchRole } = useSession();
  const [cancelling, setCancelling] = useState(false);
  const base = perspective === "student" ? "/aluno" : "/professor";

  const confirmCancel = async () => {
    if (!confirming) return;
    setCancelling(true);
    try {
      const updated = await dataSource.cancelLesson(confirming.id);
      onChanged(updated);
      toast({
        title: "Aula cancelada",
        description:
          confirming.status === "scheduled"
            ? "O horário voltou a ficar disponível. Reembolso não é processado na demonstração."
            : "A reserva e a cobrança Pix foram canceladas. O horário voltou a ficar disponível.",
      });
      setConfirming(null);
    } catch (e) {
      toast({ tone: "error", title: "Não foi possível cancelar", description: describeError(e) });
    } finally {
      setCancelling(false);
    }
  };

  const rows = (l: Lesson): Array<[string, string]> => [
    [perspective === "student" ? "Professor" : "Aluno", perspective === "student" ? l.teacherName : l.studentName],
    ...(perspective === "teacher" && l.studentLevel ? ([["Nível do aluno", LEVEL_LABELS[l.studentLevel]]] as Array<[string, string]>) : []),
    ...(perspective === "teacher" && l.studentGoal ? ([["Objetivo do aluno", l.studentGoal]] as Array<[string, string]>) : []),
    ["Data", formatDateLong(l.start)],
    ["Horário", formatTimeRange(l.start, l.end)],
    ["Situação", STATUS_LABELS[l.status]],
    ["Tema", l.topic || "Não informado"],
    ["Valor da aula", formatMoney(l.priceCents)],
    ["Pagamento", l.payment ? `${PAYMENT_LABELS[l.payment.status]} (simulado)` : "Cobrança ainda não criada"],
    ["Aula online", meetingUnavailableMessage(l)],
    ["Google Agenda", CALENDAR_SYNC_LABELS[l.calendarSync]],
    ["Código da reserva", l.id],
  ];

  return (
    <>
      <Dialog
        open={lesson !== null}
        onClose={onClose}
        title={lesson ? `${subjectName(lesson.subject)} · ${STATUS_LABELS[lesson.status]}` : "Detalhes da aula"}
        variant="sheet"
        footer={
          lesson && (
            <>
              {canCancelLesson(lesson) && (
                <Button
                  variant="danger"
                  onClick={() => {
                    setConfirming(lesson);
                    onClose();
                  }}
                >
                  Cancelar aula
                </Button>
              )}
              <Button variant="secondary" onClick={onClose}>
                Fechar
              </Button>
            </>
          )
        }
      >
        {lesson && (
          <div className="space-y-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {perspective === "student" && lesson.status === "pending_payment" && (
                <Link to={`/aluno/pagamento/${lesson.id}`} className={buttonClasses({ size: "sm" })}>
                  Pagar com Pix
                </Link>
              )}
              {lesson.status !== "pending_payment" && (
                <Link to={`${base}/aulas/${lesson.id}`} className={buttonClasses({ size: "sm", variant: lesson.status === "scheduled" ? "primary" : "secondary" })}>
                  Abrir aula online
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
              )}
              {lesson.status !== "cancelled" && (
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<DownloadIcon className="h-4 w-4" />}
                  onClick={() => {
                    downloadLessonIcs(lesson, perspective);
                    toast({ title: "Arquivo .ics gerado", description: "Exportação local. Não é a sincronização com o Google Agenda." });
                  }}
                >
                  Exportar .ics (arquivo local)
                </Button>
              )}
              {perspective === "student" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onClose();
                    switchRole(teacherSession({ id: lesson.teacherId, name: lesson.teacherName }), "/professor/aulas");
                  }}
                >
                  Ver na agenda do professor
                </Button>
              )}
            </div>
            <dl className="divide-y divide-line text-sm">
              {rows(lesson).map(([k, v]) => (
                <div key={k} className="grid gap-0.5 py-2.5 sm:grid-cols-[10rem_1fr]">
                  <dt className="text-fg-muted">{k}</dt>
                  <dd className="font-medium break-words text-fg-strong">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirming !== null}
        onClose={() => !cancelling && setConfirming(null)}
        size="sm"
        title="Cancelar esta aula?"
        description={
          confirming
            ? `${subjectName(confirming.subject)} · ${formatDateShort(confirming.start)}, ${formatTime(confirming.start)}. O horário volta a ficar disponível.`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)} disabled={cancelling}>
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

/** Estado dos dois diálogos (detalhes e confirmação de cancelamento). */
export function useLessonDialogs() {
  const [details, setDetails] = useState<Lesson | null>(null);
  const [confirming, setConfirming] = useState<Lesson | null>(null);
  return { details, setDetails, confirming, setConfirming };
}
