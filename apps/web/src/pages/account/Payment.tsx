import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  ExternalIcon,
  InfoIcon,
  Spinner,
  VideoIcon,
  buttonClasses,
  useToast,
} from "@edusearch/ui";
import { useServerMe } from "../../app/account";
import { PageHeader } from "../../components/PageHeader";
import { QueryContent } from "../../components/QueryContent";
import { useSubjectNames } from "../../components/marketplace/LessonList";
import { describeError } from "../../lib/api/client";
import type { Payment } from "../../lib/api/payments";
import { FEATURES } from "../../lib/features";
import { isTrustedMeetUrl } from "../../lib/meeting";
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, formatBRL, formatCountdown, secondsLeft } from "../../lib/payments";
import { onPaymentSettled, useAccountUid, usePaymentQuery, useSimulatePaymentMutation } from "../../lib/query/hooks";
import { lessonWhen } from "../../lib/scheduling";

/**
 * Checkout Pix (Fase 5). A tela só MOSTRA o estado que o servidor informa: o pagamento é
 * confirmado pelo webhook autenticado da AbacatePay (ou pela conciliação do servidor), nunca
 * pelo navegador. Enquanto pendente, consulta em backoff (3 s → 20 s).
 */
export default function AccountPayment() {
  const me = useServerMe();
  const { id = "" } = useParams();
  if (FEATURES.payments === "off" || !me) return <Navigate to="/conta" replace />;
  return <PaymentPage id={id} />;
}

function useCountdown(expiresAt: string | undefined, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return expiresAt ? secondsLeft(expiresAt, now) : 0;
}

function PaymentPage({ id }: { id: string }) {
  const query = usePaymentQuery(id);
  const qc = useQueryClient();
  const uid = useAccountUid();
  const status = query.data?.status;
  // Mudou de "pendente" para um estado final: aulas, histórico e horários livres ficam velhos.
  const last = useRef(status);
  useEffect(() => {
    if (last.current === "pending" && status && status !== "pending") onPaymentSettled(qc, uid);
    last.current = status;
  }, [status, qc, uid]);

  return (
    <>
      <PageHeader title="Pagamento da aula" back={{ to: "/conta/pagamentos", label: "Meus pagamentos" }} />
      <QueryContent query={query} loading="spinner" loadingLabel="Carregando pagamento…">
        {(p) => <PaymentView payment={p} refreshing={query.isFetching} />}
      </QueryContent>
    </>
  );
}

function PaymentView({ payment: p, refreshing }: { payment: Payment; refreshing: boolean }) {
  const subjectName = useSubjectNames();
  const pending = p.status === "pending";
  const left = useCountdown(p.expires_at, pending);
  const sandbox = p.environment === "sandbox";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start" data-testid="payment" data-status={p.status}>
      <div className="min-w-0 space-y-6">
        {sandbox && (
          <Card tone="muted" className="flex items-start gap-3 text-sm" data-testid="sandbox-notice">
            <InfoIcon className="mt-0.5 h-5 w-5 shrink-0 text-link" />
            <p>
              <strong>Ambiente de testes.</strong> Este Pix é do Modo Teste da AbacatePay: nenhum dinheiro real é cobrado ou
              transferido.
            </p>
          </Card>
        )}
        {p.role === "student" && pending ? (
          <PixCard payment={p} secondsLeft={left} refreshing={refreshing} />
        ) : (
          <StatusCard payment={p} />
        )}
      </div>
      <Card className="order-first space-y-4 lg:sticky lg:top-6 lg:order-none" data-testid="payment-summary">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-fg-strong">Resumo</h2>
          <Badge tone={PAYMENT_STATUS_TONE[p.status]} data-testid="payment-status">
            {PAYMENT_STATUS_LABEL[p.status]}
          </Badge>
        </div>
        <dl className="space-y-2 text-sm">
          {p.lesson.subject && <Row label="Disciplina" value={subjectName(p.lesson.subject)} />}
          {p.lesson.starts_at && p.lesson.ends_at && (
            <Row label="Quando" value={<span className="first-letter:uppercase">{lessonWhen(p.lesson.starts_at, p.lesson.ends_at)}</span>} />
          )}
          <Row label={p.role === "student" ? "Professor" : "Aluno"} value={(p.role === "student" ? p.lesson.teacher_name : p.lesson.student_name) ?? "—"} />
        </dl>
        <div className="border-t border-line pt-4">
          <dl className="space-y-2 text-sm">
            <Row label="Valor da aula" value={<strong className="text-fg-strong" data-testid="payment-amount">{formatBRL(p.amount_cents)}</strong>} />
            {p.role === "teacher" && (
              <>
                <Row label={`Comissão EduSearch (${p.commission_bps / 100}%)`} value={`- ${formatBRL(p.commission_cents)}`} />
                <Row label="Sua parte (antes da tarifa do gateway)" value={formatBRL(p.teacher_share_cents)} />
              </>
            )}
          </dl>
          <p className="mt-3 text-xs text-fg-muted">Valor definido pelo professor e calculado pelo servidor no momento da reserva.</p>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right text-fg">{value}</dd>
    </div>
  );
}

function PixCard({ payment: p, secondsLeft: left, refreshing }: { payment: Payment; secondsLeft: number; refreshing: boolean }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const simulate = useSimulatePaymentMutation();
  const copy = async () => {
    if (!p.br_code) return;
    try {
      await navigator.clipboard.writeText(p.br_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast({ tone: "error", title: "Não foi possível copiar", description: "Selecione o código e copie manualmente." });
    }
  };

  if (p.charge_pending || !p.br_code) {
    return (
      <Card className="flex flex-col items-center gap-3 py-10 text-center" data-testid="pix-generating">
        <Spinner />
        <p className="font-medium text-fg-strong">Gerando o Pix…</p>
        <p className="max-w-sm text-sm text-fg-muted">Seu horário já está reservado. Se demorar, esta tela tenta de novo sozinha.</p>
      </Card>
    );
  }

  return (
    <Card className="space-y-6" data-testid="pix-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-fg-strong">Pague com Pix</h2>
          <p className="text-sm text-fg-muted">Escaneie o QR Code ou use o Pix copia e cola no app do seu banco.</p>
        </div>
        <p
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums ${left < 120 ? "bg-danger-soft text-danger-text" : "bg-surface-muted text-fg-strong"}`}
          data-testid="pix-countdown"
          aria-live="off"
        >
          <ClockIcon className="h-4 w-4" />
          {left > 0 ? formatCountdown(left) : "Expirando…"}
        </p>
      </div>
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        {p.br_code_image?.startsWith("data:image/png;base64,") && (
          <img
            src={p.br_code_image}
            alt="QR Code do Pix"
            width={220}
            height={220}
            className="h-[220px] w-[220px] shrink-0 rounded-xl border border-line bg-white p-2"
            data-testid="pix-qr"
          />
        )}
        <div className="w-full min-w-0 space-y-3">
          <label htmlFor="pix-code" className="text-sm font-medium text-fg-strong">
            Pix copia e cola
          </label>
          <textarea
            id="pix-code"
            readOnly
            value={p.br_code}
            rows={4}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full resize-none rounded-lg border border-line bg-surface-muted p-3 font-mono text-xs break-all text-fg"
            data-testid="pix-code"
          />
          <Button className="w-full sm:w-auto" leftIcon={copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />} onClick={() => void copy()} data-testid="pix-copy">
            {copied ? "Código copiado" : "Copiar código Pix"}
          </Button>
        </div>
      </div>
      <p className="flex items-center gap-2 text-sm text-fg-muted" role="status" data-testid="pix-waiting">
        {refreshing ? <Spinner className="h-4 w-4" /> : <ClockIcon className="h-4 w-4" />}
        Aguardando a confirmação do banco. Esta tela atualiza sozinha; você pode fechá-la.
      </p>
      {p.environment === "sandbox" && FEATURES.payments === "sandbox" && (
        <div className="rounded-lg border border-dashed border-line p-4" data-testid="sandbox-simulate">
          <p className="text-sm text-fg">Teste: peça ao Modo Teste da AbacatePay para simular o pagamento deste Pix.</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            loading={simulate.isPending}
            onClick={() =>
              simulate.mutate(p.id, {
                onError: (e) => toast({ tone: "error", title: "Não foi possível simular", description: describeError(e) }),
              })
            }
            data-testid="pix-simulate"
          >
            Simular pagamento (sandbox)
          </Button>
        </div>
      )}
    </Card>
  );
}

function StatusCard({ payment: p }: { payment: Payment }) {
  const meet = p.lesson.meet_url;
  if (p.status === "paid") {
    const lessonOk = p.lesson.status === "scheduled";
    return (
      <Card className="space-y-4" data-testid="payment-paid">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-success-soft text-success-text">
            <CheckIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-fg-strong">{lessonOk ? "Pagamento confirmado" : "Pagamento recebido"}</h2>
            <p className="text-sm text-fg-muted">{lessonOk ? "Sua aula está confirmada." : "A aula não pôde ser mantida."}</p>
          </div>
        </div>
        {lessonOk && isTrustedMeetUrl(meet) && (
          <a href={meet ?? undefined} target="_blank" rel="noopener noreferrer" className={buttonClasses({})} data-testid="payment-meet">
            <VideoIcon className="h-4 w-4" /> Entrar no Google Meet <ExternalIcon className="h-3.5 w-3.5" />
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
        )}
        {lessonOk && !isTrustedMeetUrl(meet) && (
          <p className="text-sm text-fg-muted">O link do Google Meet aparece em Minhas aulas assim que o evento for criado na agenda do professor.</p>
        )}
        {p.refund && (
          <p className="rounded-lg bg-surface-muted p-3 text-sm text-fg" data-testid="payment-refund">
            Reembolso solicitado ({p.refund.reason === "late_payment_slot_taken" ? "o Pix foi pago depois de expirar e o horário já estava ocupado" : "aula cancelada"}). A equipe EduSearch vai devolver o valor integral.
          </p>
        )}
        <Link to="/conta/aulas" className={buttonClasses({ variant: "secondary" })}>
          Ver em Minhas aulas
        </Link>
      </Card>
    );
  }
  const messages: Record<string, { title: string; text: string }> = {
    pending: { title: "Aguardando pagamento do aluno", text: "A aula é confirmada assim que o Pix for pago." },
    expired: { title: "O Pix expirou", text: "O horário foi liberado. Você pode reservar de novo e gerar um novo Pix." },
    cancelled: { title: "Reserva cancelada", text: "Nenhum valor foi cobrado." },
    failed: { title: "Não foi possível gerar o Pix", text: "O horário foi liberado. Tente reservar de novo." },
    refunded: { title: "Pagamento reembolsado", text: "O valor foi devolvido." },
    under_dispute: { title: "Pagamento em contestação", text: "A equipe EduSearch está acompanhando." },
  };
  const m = messages[p.status] ?? messages.failed;
  return (
    <Card className="space-y-3" data-testid={`payment-${p.status}`}>
      <h2 className="text-lg font-semibold text-fg-strong">{m.title}</h2>
      <p className="text-sm text-fg-muted">{m.text}</p>
      {p.role === "student" && (p.status === "expired" || p.status === "failed" || p.status === "cancelled") && (
        <Link to="/conta/explorar" className={buttonClasses({ variant: "secondary" })}>
          Reservar outro horário
        </Link>
      )}
    </Card>
  );
}
