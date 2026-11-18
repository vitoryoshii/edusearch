import { Badge, CheckCircleIcon, type BadgeTone } from "@edusearch/ui";
import type { LessonStatus, PaymentStatus } from "../lib/api/types";
import { PAYMENT_LABELS, STATUS_LABELS } from "../lib/format";

const LESSON_TONE: Record<LessonStatus, BadgeTone> = {
  pending_payment: "warning",
  scheduled: "primary",
  completed: "success",
  cancelled: "neutral",
};

/** Status da aula. Verde só para estado positivo (concluída). */
export function LessonStatusBadge({ status }: { status: LessonStatus }) {
  return (
    <Badge tone={LESSON_TONE[status]} dot>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = {
  creating: "neutral",
  pending: "warning",
  processing: "primary",
  confirmed: "success",
  expired: "neutral",
  cancelled: "neutral",
  failed: "danger",
};

/** Status do pagamento. Na demonstração, sempre com a marca "simulado". */
export function PaymentStatusBadge({ status, simulated = true }: { status: PaymentStatus; simulated?: boolean }) {
  return (
    <Badge tone={PAYMENT_TONE[status]} icon={status === "confirmed" ? <CheckCircleIcon /> : undefined} dot={status !== "confirmed"}>
      {PAYMENT_LABELS[status]}
      {simulated && " (simulado)"}
    </Badge>
  );
}
