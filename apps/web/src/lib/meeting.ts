/**
 * Regras da aula online (Google Meet) no frontend.
 *
 * - O link NUNCA é gerado pelo frontend. Só é exibido quando a API devolver
 *   uma URL do Google Meet válida (https://meet.google.com/xxx-xxxx-xxx).
 * - O estado da aula é derivado do horário e do status da reserva.
 */
import type { Lesson } from "./api/types";

/** Formato oficial dos códigos de reunião do Google Meet. */
const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

export const isTrustedMeetUrl = (url: string | null | undefined): url is string => !!url && MEET_URL.test(url);

export type OnlineLessonState = "awaiting_payment" | "scheduled" | "waiting" | "ready" | "live" | "finished" | "cancelled";

/** Janela antes do início em que a aula fica "pronta para iniciar". */
export const READY_WINDOW_MIN = 15;
/** A partir de 24h antes, a aula passa a "aguardando horário". */
const WAITING_WINDOW_MIN = 24 * 60;

export function onlineLessonState(lesson: Lesson, now = Date.now()): OnlineLessonState {
  if (lesson.status === "cancelled") return "cancelled";
  if (lesson.status === "completed") return "finished";
  if (lesson.status === "pending_payment") return "awaiting_payment";
  const start = new Date(lesson.start).getTime();
  const end = new Date(lesson.end).getTime();
  if (now >= end) return "finished";
  if (now >= start) return "live";
  const minutesToStart = (start - now) / 60_000;
  if (minutesToStart <= READY_WINDOW_MIN) return "ready";
  if (minutesToStart <= WAITING_WINDOW_MIN) return "waiting";
  return "scheduled";
}

export const ONLINE_STATE_LABELS: Record<OnlineLessonState, string> = {
  awaiting_payment: "Aguardando pagamento",
  scheduled: "Agendada",
  waiting: "Aguardando horário",
  ready: "Pronta para iniciar",
  live: "Em andamento",
  finished: "Finalizada",
  cancelled: "Cancelada",
};

/** Mensagem exibida no lugar do botão quando não há link confiável. */
export function meetingUnavailableMessage(lesson: Lesson): string {
  if (lesson.status === "pending_payment") return "Link disponível após a confirmação do pagamento.";
  if (lesson.meeting.status === "awaiting_link") return "Link disponível após a confirmação da aula pelo EduSearch.";
  return "Google Meet ainda não conectado.";
}
