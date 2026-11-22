/**
 * Pagamentos Pix (Fase 5) — contrato em docs/payments.md.
 *
 * O app só envia professor, disciplina, horário, duração e a chave de idempotência. Valor,
 * comissão, recebedor e status vêm SEMPRE do servidor (campos extras são recusados com 422).
 */
import { apiRequest } from "./client";
import type { PaymentStatus } from "../payments";

export type PaymentsStatusInfo = {
  stage: "off" | "sandbox" | "production";
  configured: boolean;
  commission_bps: number;
  split_enabled: boolean;
  hold_minutes: number;
};

export type SplitStatus = "not_applicable" | "unavailable" | "pending" | "credited" | "failed";

export type Payment = {
  id: string;
  role: "student" | "teacher";
  status: PaymentStatus;
  environment: "sandbox" | "production";
  amount_cents: number;
  commission_policy_version: string;
  commission_bps: number;
  commission_cents: number;
  teacher_share_cents: number;
  currency: "BRL";
  /** Pix copia e cola e QR (data URI PNG): só para o aluno, só enquanto pendente. */
  br_code: string | null;
  br_code_image: string | null;
  expires_at: string;
  paid_at: string | null;
  split_status: SplitStatus;
  /** A cobrança ainda não foi criada no gateway (a próxima consulta tenta de novo). */
  charge_pending: boolean;
  lesson: {
    id: string | null;
    subject: string | null;
    starts_at: string | null;
    ends_at: string | null;
    status: string | null;
    teacher_name: string | null;
    student_name: string | null;
    meet_url: string | null;
    calendar_sync_status: string | null;
  };
  refund: { status: string; reason: string; created_at: string } | null;
  created_at: string;
};

export type CheckoutRequest = {
  teacher_id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  idempotency_key: string;
};

export type PayoutAccount = {
  status: "split_unavailable" | "not_configured" | "active";
  environment?: "sandbox" | "production" | null;
  tax_id_last4?: string | null;
  created_at?: string | null;
};

export type TeacherFinancePeriod = "7d" | "30d" | "90d";

/** Leitura do backend: parcela atribuída não significa saldo disponível ou repasse concluído. */
export type TeacherFinance = {
  period: TeacherFinancePeriod;
  environment: "sandbox" | "production";
  commission_bps: number;
  summary: {
    gross_cents: number;
    commission_cents: number;
    teacher_share_cents: number;
    gateway_fee_cents: number;
    paid_lessons: number;
    pending_lessons: number;
    cancelled_lessons: number;
    refunded_lessons: number;
  };
  payout_account: PayoutAccount;
  payments: Payment[];
};

/** Política aplicada pelo backend. Nenhuma regra comercial é recalculada no navegador. */
export type CommissionProgress = {
  environment: "sandbox" | "production";
  policy_version: string;
  progression_active: boolean;
  current_level: number;
  current_rate_bps: number;
  next_rate_bps: number | null;
  eligible_paid_lessons: number;
  next_level_paid_lessons: number | null;
  lessons_remaining: number | null;
  evaluation_days: number;
  eligibility: "eligible" | "no_next_level";
  simulation_amount_cents: number;
  simulation_commission_cents: number;
  simulation_teacher_share_cents: number;
};

export const paymentsApi = {
  status: (signal?: AbortSignal) => apiRequest<PaymentsStatusInfo>("/v1/payments/status", { signal }),
  checkout: (body: CheckoutRequest) => apiRequest<Payment>("/v1/payments/checkout", { method: "POST", body }),
  get: (id: string, signal?: AbortSignal) => apiRequest<Payment>(`/v1/payments/${encodeURIComponent(id)}`, { signal }),
  simulate: (id: string) => apiRequest<Payment>(`/v1/payments/${encodeURIComponent(id)}/simulate`, { method: "POST" }),
  history: (signal?: AbortSignal) => apiRequest<Payment[]>("/v1/me/payments", { signal }),
  teacherFinance: (period: TeacherFinancePeriod, signal?: AbortSignal) =>
    apiRequest<TeacherFinance>(`/v1/me/teacher-finance?period=${period}`, { signal }),
  commissionProgress: (signal?: AbortSignal) =>
    apiRequest<CommissionProgress>("/v1/me/commission-progress", { signal }),
  payoutAccount: (signal?: AbortSignal) => apiRequest<PayoutAccount>("/v1/me/payout-account", { signal }),
  savePayoutAccount: (body: { legal_name: string; tax_id: string }) =>
    apiRequest<PayoutAccount>("/v1/me/payout-account", { method: "PUT", body }),
};
