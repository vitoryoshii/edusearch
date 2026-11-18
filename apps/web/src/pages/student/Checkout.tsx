import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  AlertIcon,
  Avatar,
  Badge,
  Button,
  CalendarIcon,
  Card,
  CheckCircleIcon,
  ClockIcon,
  ErrorState,
  LoadingState,
  PaymentIcon,
  Spinner,
  buttonClasses,
  cn,
  useToast,
} from "@edusearch/ui";
import { DemoNotice } from "../../components/DemoNotice";
import { PageHeader } from "../../components/PageHeader";
import { PixCopyPaste, PixQrCode } from "../../components/Pix";
import { PaymentStatusBadge } from "../../components/StatusBadges";
import { describeError } from "../../lib/api/client";
import type { Checkout, Lesson } from "../../lib/api/types";
import { subjectName } from "../../lib/catalog";
import { dataSource, isDemo } from "../../lib/data/source";
import { formatDateLong, formatMinutes, formatMoney, formatTimeRange } from "../../lib/format";

const OPEN: Checkout["status"][] = ["creating", "pending", "processing"];

function useCountdown(expiresAt: string | null | undefined, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !expiresAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active, expiresAt]);
  if (!expiresAt) return null;
  const ms = Math.max(0, new Date(expiresAt).getTime() - now);
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return { ms, label: `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` };
}

/** Resumo da reserva: compacto no mobile, coluna lateral no desktop. */
function BookingSummaryCard({ lesson }: { lesson: Lesson }) {
  const duration = Math.round((new Date(lesson.end).getTime() - new Date(lesson.start).getTime()) / 60_000);
  return (
    <Card as="section" aria-labelledby="resumo-reserva" className="lg:sticky lg:top-6">
      <h2 id="resumo-reserva" className="text-sm font-medium text-fg-muted">
        Resumo da reserva
      </h2>
      <div className="mt-3 flex items-center gap-3">
        <Avatar name={lesson.teacherName} />
        <div className="min-w-0">
          <p className="font-semibold text-fg-strong">{lesson.teacherName}</p>
          <p className="text-sm text-fg-muted">{subjectName(lesson.subject)} · aula online</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2 text-sm text-fg-strong">
        <li className="flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 shrink-0 text-link" /> {formatDateLong(lesson.start)}
        </li>
        <li className="flex items-center gap-2">
          <ClockIcon className="h-4 w-4 shrink-0 text-link" /> {formatTimeRange(lesson.start, lesson.end)} · {formatMinutes(duration)}
        </li>
      </ul>
      <div className="mt-5 flex items-end justify-between gap-4 border-t border-line pt-4">
        <span className="text-sm text-fg-muted">Total</span>
        <span className="text-2xl font-semibold text-fg-strong tabular-nums">{formatMoney(lesson.priceCents)}</span>
      </div>
    </Card>
  );
}

function CheckoutFlow({ initialLesson, initialCheckout }: { initialLesson: Lesson; initialCheckout: Checkout | null }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [lesson, setLesson] = useState(initialLesson);
  const [checkout, setCheckout] = useState<Checkout | null>(initialCheckout);
  const [creating, setCreating] = useState(false);
  const [acting, setActing] = useState<"confirmed" | "failed" | "expired" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status = creating ? "creating" : checkout?.status ?? null;
  const open = status !== null && OPEN.includes(status);
  const countdown = useCountdown(checkout?.expiresAt, status === "pending");

  // Enquanto a cobrança está aberta, consulta o status periodicamente
  // (é assim que a confirmação chegará da API/gateway no sistema real).
  useEffect(() => {
    if (!open || creating) return;
    const t = window.setInterval(async () => {
      try {
        const [c, l] = await Promise.all([dataSource.getCheckout(lesson.id), dataSource.getLesson(lesson.id)]);
        if (c) setCheckout(c);
        setLesson(l);
      } catch {
        /* falha transitória: tenta de novo no próximo ciclo */
      }
    }, 3000);
    return () => window.clearInterval(t);
  }, [open, creating, lesson.id]);

  // Ao zerar o contador, busca o status (a cobrança expira no servidor).
  useEffect(() => {
    if (countdown && countdown.ms === 0 && status === "pending") {
      void Promise.all([dataSource.getCheckout(lesson.id), dataSource.getLesson(lesson.id)]).then(([c, l]) => {
        if (c) setCheckout(c);
        setLesson(l);
      });
    }
  }, [countdown?.ms, status, lesson.id]);

  const createCharge = async () => {
    setCreating(true);
    setError(null);
    try {
      const c = await dataSource.createCheckout(lesson.id);
      setCheckout(c);
      setLesson(await dataSource.getLesson(lesson.id));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setCreating(false);
    }
  };

  const simulate = async (outcome: "confirmed" | "failed" | "expired") => {
    if (!checkout || !dataSource.simulatePayment || acting) return;
    setActing(outcome);
    setError(null);
    if (outcome === "confirmed") setCheckout({ ...checkout, status: "processing" });
    try {
      const c = await dataSource.simulatePayment(checkout.id, outcome);
      setCheckout(c);
      setLesson(await dataSource.getLesson(lesson.id));
      if (c.status === "confirmed") toast({ tone: "success", title: "Pagamento confirmado (simulação)", description: "Sua aula está confirmada." });
    } catch (e) {
      setError(describeError(e));
      const fresh = await dataSource.getCheckout(lesson.id).catch(() => null);
      if (fresh) setCheckout(fresh);
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
      <BookingSummaryCard lesson={lesson} />

      <Card as="section" aria-labelledby="pagamento-titulo" padding="lg" className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="pagamento-titulo" className="text-lg font-semibold text-fg-strong">
            Pagamento
          </h2>
          {status && <PaymentStatusBadge status={status} simulated={isDemo} />}
        </div>

        {/* Método: Pix é o único meio planejado */}
        <fieldset>
          <legend className="text-sm font-medium text-fg-strong">Forma de pagamento</legend>
          <label className="mt-2 flex cursor-pointer items-center gap-3 rounded-control border-2 border-primary bg-primary-soft px-4 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-link">
            <input type="radio" name="metodo" value="pix" checked readOnly className="h-4 w-4 accent-[var(--es-primary)]" />
            <PaymentIcon className="h-5 w-5 text-link" />
            <span className="flex-1">
              <span className="block font-semibold text-fg-strong">Pix</span>
              <span className="block text-xs text-fg-muted">Processado pela AbacatePay (integração planejada)</span>
            </span>
          </label>
        </fieldset>

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2.5 text-sm text-danger-text">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {/* Reserva solicitada: ainda sem cobrança */}
        {status === null && lesson.status === "pending_payment" && (
          <div className="space-y-3">
            <p className="text-sm text-fg">
              Sua reserva está <strong className="font-semibold text-fg-strong">solicitada</strong>: o horário fica guardado para você enquanto a
              cobrança estiver válida.
            </p>
            <Button size="lg" fullWidth onClick={createCharge}>
              Gerar cobrança Pix
            </Button>
          </div>
        )}

        {status === "creating" && <LoadingState label="Aguardando criação da cobrança…" />}

        {checkout && (status === "pending" || status === "processing") && (
          <div className="space-y-5">
            <PixQrCode checkout={checkout} />
            {countdown && status === "pending" && (
              <p className="text-center text-sm text-fg" aria-live="off">
                Expira em <strong className="font-semibold text-fg-strong tabular-nums">{countdown.label}</strong>
                {checkout.simulated && " (prazo simulado)"}
              </p>
            )}
            <PixCopyPaste checkout={checkout} />
            {status === "processing" && (
              <p role="status" className="flex items-center justify-center gap-2 text-sm font-medium text-link">
                <Spinner className="h-4 w-4" /> Pagamento em processamento{checkout.simulated && " (simulação)"}…
              </p>
            )}
          </div>
        )}

        {/* Ações exclusivas da demonstração — nunca apresentadas como pagamento real */}
        {checkout?.simulated && status === "pending" && dataSource.simulatePayment && (
          <div className="rounded-card border border-dashed border-line-strong p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-fg-strong">Teste local</p>
              <Badge tone="demo">Simulação · sem chamada externa</Badge>
            </div>
            <p className="mt-1 text-sm text-fg-muted">Simule a resposta do gateway para revisar cada estado. Nenhum valor é cobrado.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button loading={acting === "confirmed"} disabled={acting !== null} onClick={() => simulate("confirmed")}>
                Simular confirmação de pagamento
              </Button>
              <Button variant="secondary" loading={acting === "failed"} disabled={acting !== null} onClick={() => simulate("failed")}>
                Simular falha
              </Button>
              <Button variant="ghost" loading={acting === "expired"} disabled={acting !== null} onClick={() => simulate("expired")}>
                Simular expiração
              </Button>
            </div>
          </div>
        )}

        {status === "confirmed" && (
          <div className="space-y-4 text-center" role="status">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success-text">
              <CheckCircleIcon className="h-7 w-7" />
            </span>
            <div>
              <p className="text-lg font-semibold text-fg-strong">Pagamento confirmado{checkout?.simulated && " (simulação)"}</p>
              <p className="mt-1 text-sm text-fg">Sua aula está confirmada. Nenhum valor real foi cobrado.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link to={`/aluno/aulas?aula=${lesson.id}`} className={buttonClasses()}>
                Ver no calendário
              </Link>
              <Link to={`/aluno/aulas/${lesson.id}`} className={buttonClasses({ variant: "secondary" })}>
                Detalhes da aula online
              </Link>
            </div>
          </div>
        )}

        {status === "failed" && (
          <div className="space-y-3">
            <p role="status" className="flex items-start gap-2 text-sm text-danger-text">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {checkout?.failureReason ?? "O pagamento não foi concluído."} Sua reserva continua aguardando pagamento.
            </p>
            <Button fullWidth onClick={createCharge} loading={creating}>
              Gerar nova cobrança
            </Button>
          </div>
        )}

        {(status === "expired" || status === "cancelled") && (
          <div className="space-y-3 text-center" role="status">
            <p className="font-semibold text-fg-strong">{status === "expired" ? "Cobrança expirada" : "Cobrança cancelada"}</p>
            <p className="text-sm text-fg">A reserva foi cancelada e o horário voltou a ficar disponível. Nada foi cobrado.</p>
            {checkout && <PixCopyPaste checkout={checkout} />}
            <button
              type="button"
              className={cn(buttonClasses({ variant: "secondary" }))}
              onClick={() => navigate(`/aluno/professores/${lesson.teacherId}/agendar`)}
            >
              Escolher novo horário
            </button>
          </div>
        )}

        {status === null && lesson.status !== "pending_payment" && (
          <p className="text-sm text-fg">Esta aula não está aguardando pagamento.</p>
        )}
      </Card>
    </div>
  );
}

/** Checkout Pix (demonstração). Rota: /aluno/pagamento/:lessonId */
export default function CheckoutPage() {
  const { lessonId = "" } = useParams();
  const [state, setState] = useState<{ lesson: Lesson; checkout: Checkout | null } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setState(null);
    setError(null);
    Promise.all([dataSource.getLesson(lessonId), dataSource.getCheckout(lessonId)]).then(
      ([lesson, checkout]) => {
        if (alive) setState({ lesson, checkout });
      },
      (e: unknown) => {
        if (alive) setError(e);
      },
    );
    return () => {
      alive = false;
    };
  }, [lessonId, nonce]);

  return (
    <>
      <PageHeader back={{ to: "/aluno/aulas", label: "Minhas aulas" }} title="Pagamento da aula" description="Confira a reserva e pague com Pix." />
      {isDemo && (
        <DemoNotice className="mb-6">
          Checkout de demonstração. Nenhuma cobrança é criada na AbacatePay: o QR Code e o código Pix não são válidos e os
          estados são simulados.
        </DemoNotice>
      )}
      {error ? (
        <ErrorState description={describeError(error)} onRetry={() => setNonce((n) => n + 1)} />
      ) : !state ? (
        <LoadingState label="Carregando pagamento…" />
      ) : (
        <CheckoutFlow initialLesson={state.lesson} initialCheckout={state.checkout} />
      )}
    </>
  );
}
