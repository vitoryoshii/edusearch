import { useState } from "react";
import { Badge, Card, buttonClasses } from "@edusearch/ui";
import { Link } from "react-router";
import { QueryContent } from "../QueryContent";
import { formatBRL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from "../../lib/payments";
import { useTeacherFinanceQuery } from "../../lib/query/hooks";
import type { TeacherFinancePeriod } from "../../lib/api/payments";
import { CommissionLevelCard, GoalsAndAchievementsCard, NextCommissionTierCard, QualifiedReferralsCard } from "./TeacherGrowth";

const PERIODS: Array<{ value: TeacherFinancePeriod; label: string }> = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
];

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-fg-strong tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-fg-muted">{note}</p>}
    </div>
  );
}

/** Painel de leitura: não contém saldo, saque, split manual nem qualquer ação financeira. */
export function TeacherFinancePanel() {
  const [period, setPeriod] = useState<TeacherFinancePeriod>("30d");
  const finance = useTeacherFinanceQuery(period);
  return (
    <section className="space-y-5" aria-labelledby="finance-title" data-testid="teacher-finance">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wide text-link uppercase">Visão financeira</p>
          <h2 id="finance-title" className="mt-1 text-xl font-semibold text-fg-strong">Acompanhamento das suas aulas</h2>
          <p className="mt-1 text-sm text-fg-muted">Valores calculados pela plataforma. A parcela do professor não é saldo disponível.</p>
        </div>
        <div className="flex rounded-control border border-line bg-surface-muted p-1" role="group" aria-label="Período financeiro">
          {PERIODS.map((item) => (
            <button key={item.value} type="button" onClick={() => setPeriod(item.value)} className={buttonClasses({ variant: period === item.value ? "secondary" : "ghost", size: "sm", className: "min-w-0" })} aria-pressed={period === item.value}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <QueryContent
        query={finance}
        loading="skeleton"
        loadingLabel="Carregando dados financeiros…"
        isEmpty={() => false}
        empty={{ title: "" }}
      >
        {(data) => {
          const s = data.summary;
          const sandbox = data.environment === "sandbox";
          const payout = data.payout_account;
          return (
            <div className="space-y-5">
              {sandbox && <Card tone="soft" className="text-sm text-fg"><Badge tone="warning">Sandbox</Badge><p className="mt-2">Todas as cifras abaixo são simuladas. Nenhuma representa saldo, repasse ou dinheiro disponível.</p></Card>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Faturamento bruto" value={formatBRL(s.gross_cents)} note={`${s.paid_lessons} aula${s.paid_lessons === 1 ? "" : "s"} paga${s.paid_lessons === 1 ? "" : "s"}`} />
                <Metric label="Comissão EduSearch" value={formatBRL(s.commission_cents)} note="Retida pela plataforma" />
                <Metric label="Parcela atribuída" value={formatBRL(s.teacher_share_cents)} note="Não é saldo disponível" />
                <Metric label="Tarifas do gateway" value={formatBRL(s.gateway_fee_cents)} note="Quando informadas pelo gateway" />
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,.7fr)]">
                <Card>
                  <h3 className="font-semibold text-fg-strong">Histórico financeiro</h3>
                  {data.payments.length === 0 ? <p className="mt-3 text-sm text-fg-muted">Nenhuma aula paga ou cobrança neste período.</p> : (
                    <ul className="mt-3 divide-y divide-line" data-testid="teacher-finance-history">
                      {data.payments.slice(0, 8).map((payment) => (
                        <li key={payment.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                          <span className="min-w-0"><span className="block truncate font-medium text-fg-strong">{payment.lesson.subject ?? "Aula"}</span><span className="block text-xs text-fg-muted">{payment.lesson.student_name ?? "Aluno"}</span></span>
                          <span className="flex shrink-0 items-center gap-2"><span className="font-semibold tabular-nums text-fg-strong">{formatBRL(payment.teacher_share_cents)}</span><Badge tone={PAYMENT_STATUS_TONE[payment.status]}>{PAYMENT_STATUS_LABEL[payment.status]}</Badge></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <div className="space-y-3">
                  <Card>
                    <h3 className="font-semibold text-fg-strong">Conta de recebimentos</h3>
                    <p className="mt-2 text-sm text-fg-muted">{payout.status === "active" ? `Conta configurada (final ${payout.tax_id_last4 ?? "—"}).` : payout.status === "split_unavailable" ? "Split e repasses automáticos ainda não estão habilitados." : "Conta de recebimentos ainda não configurada."}</p>
                  </Card>
                  <Card>
                    <h3 className="font-semibold text-fg-strong">Situação das aulas</h3>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm"><div><p className="text-fg-muted">Pendentes</p><p className="mt-1 font-semibold tabular-nums">{s.pending_lessons}</p></div><div><p className="text-fg-muted">Canceladas</p><p className="mt-1 font-semibold tabular-nums">{s.cancelled_lessons}</p></div><div><p className="text-fg-muted">Reembolsadas</p><p className="mt-1 font-semibold tabular-nums">{s.refunded_lessons}</p></div></div>
                  </Card>
                </div>
              </div>
              <section aria-labelledby="teacher-growth-title"><h3 id="teacher-growth-title" className="mb-3 text-base font-semibold text-fg-strong">Evolução profissional</h3><div className="grid gap-3 sm:grid-cols-2"><CommissionLevelCard commissionBps={data.commission_bps} /><NextCommissionTierCard /><GoalsAndAchievementsCard /><QualifiedReferralsCard /></div><Link to="/conta/configuracoes" className="mt-3 inline-flex text-sm font-semibold text-link underline-offset-4 hover:underline">Ver configurações de recebimento</Link></section>
            </div>
          );
        }}
      </QueryContent>
    </section>
  );
}
