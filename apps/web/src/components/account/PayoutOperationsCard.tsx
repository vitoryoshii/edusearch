import { Badge, Card, LockIcon } from "@edusearch/ui";
import { QueryContent } from "../QueryContent";
import { formatBRL } from "../../lib/payments";
import { dayLabelOf, timeOf } from "../../lib/scheduling";
import { usePayoutAccountQuery, usePayoutBalanceQuery, useWithdrawalsQuery } from "../../lib/query/hooks";

const STATUS: Record<"pending" | "completed" | "failed", { label: string; tone: "warning" | "success" | "danger" }> = {
  pending: { label: "Em processamento", tone: "warning" },
  completed: { label: "Concluído", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
};

/**
 * Mostra somente saldos e saques confirmados pelo gateway/API. Nenhum valor atribuído por aula
 * é convertido em saldo e o saque permanece indisponível até a flag operacional do servidor.
 */
export function PayoutOperationsCard() {
  const account = usePayoutAccountQuery();
  const active = account.data?.status === "active";
  const balance = usePayoutBalanceQuery(active);
  const withdrawals = useWithdrawalsQuery(active);

  if (account.data && !active) return null;
  return (
    <Card className="space-y-4" data-testid="payout-operations">
      <div>
        <h3 className="font-semibold text-fg-strong">Saldo e saques</h3>
        <p className="mt-1 text-sm text-fg-muted">Saldos vêm diretamente da subconta AbacatePay; não incluem valores apenas atribuídos às aulas.</p>
      </div>
      <QueryContent query={balance} loading="spinner" loadingLabel="Consultando saldo da subconta…">
        {(data) => (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Disponível" value={formatBRL(data.available_cents)} />
              <Metric label="Bloqueado" value={formatBRL(data.blocked_cents)} />
            </div>
            {!data.withdrawals_enabled && <p className="flex items-start gap-2 rounded-control bg-surface-muted px-3 py-2 text-sm text-fg-muted"><LockIcon className="mt-0.5 h-4 w-4 shrink-0" />Saques permanecem desabilitados até aprovação operacional, mesmo quando houver saldo.</p>}
          </>
        )}
      </QueryContent>
      {active && <QueryContent query={withdrawals} loading="spinner" loadingLabel="Carregando histórico de saques…">
        {(items) => items.length === 0 ? <p className="text-sm text-fg-muted">Nenhuma solicitação de saque neste ambiente.</p> : <ul className="divide-y divide-line">{items.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="min-w-0"><span className="block font-medium text-fg-strong">{dayLabelOf(item.created_at)} · {timeOf(item.created_at)}</span><span className="block text-xs text-fg-muted">Solicitação {item.id.slice(0, 8)}</span></span><span className="flex shrink-0 items-center gap-2"><span className="font-semibold tabular-nums">{formatBRL(item.amount_cents)}</span><Badge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge></span></li>)}</ul>}
      </QueryContent>}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-control border border-line bg-surface-muted px-3 py-2.5"><p className="text-xs text-fg-muted">{label}</p><p className="mt-1 font-semibold tabular-nums text-fg-strong">{value}</p></div>;
}
