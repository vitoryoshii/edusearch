import { Link } from "react-router";
import { ArrowRightIcon, Badge, Card, EmptyState, WalletIcon, type BadgeTone } from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { DemoNotice } from "../../components/DemoNotice";
import { PageHeader, SectionTitle } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
import type { FinancialStatus, TeacherEarning } from "../../lib/api/types";
import { subjectName } from "../../lib/catalog";
import { formatBps } from "../../lib/commission";
import { dataSource, isDemo } from "../../lib/data/source";
import { FINANCIAL_LABELS, formatDayMonth, formatMoney } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";

const TONE: Record<FinancialStatus, BadgeTone> = {
  awaiting_payment: "warning",
  confirmed: "success",
  cancelled: "neutral",
  cancelled_after_payment: "neutral",
};

const fee = (i: TeacherEarning) => (i.gatewayFeeCents === null ? "A informar" : `−${formatMoney(i.gatewayFeeCents)}`);
const balance = (i: TeacherEarning) =>
  i.status === "confirmed" ? formatMoney(i.estimatedBalanceCents) : i.status === "awaiting_payment" ? "Não recebido" : "Reembolso a definir";

export default function Earnings() {
  const data = useAsync(() => dataSource.getEarnings(), []);

  return (
    <>
      <PageHeader
        title="Recebimentos"
        description="Valores das suas aulas, comissão do EduSearch e saldo estimado."
        actions={
          <Link to="/professor/beneficios" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-link hover:underline">
            Comissão e benefícios <ArrowRightIcon className="h-4 w-4" />
          </Link>
        }
      />

      <AsyncContent state={data} reload={data.reload}>
        {(e) => {
          const rate = formatBps(e.commissionBps);
          const share = formatBps(10000 - e.commissionBps);
          return (
            <div className="space-y-8">
              <DemoNotice>
                Comissão padrão do EduSearch: <strong className="font-semibold">{rate}</strong> do valor de cada aula. Tarifas do
                gateway (AbacatePay) são contabilizadas à parte e ainda não foram informadas.
                {isDemo && " Valores fictícios: nenhum pagamento, repasse ou saque é realizado."}
              </DemoNotice>

              <div>
                <p className="mb-3 text-sm text-fg-muted">Período: {e.periodLabel} · somente pagamentos confirmados</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <StatCard label="Valor das aulas pagas" value={formatMoney(e.confirmed.grossCents)} />
                  <StatCard label={`Comissão EduSearch (${rate})`} value={formatMoney(e.confirmed.commissionCents)} />
                  <StatCard
                    icon={WalletIcon}
                    label={`Sua parcela (${share})`}
                    value={formatMoney(e.confirmed.teacherShareCents)}
                    hint={`Saldo estimado: ${formatMoney(e.confirmed.estimatedBalanceCents)} · sem tarifas`}
                  />
                </div>
                {e.awaitingPaymentCents > 0 && (
                  <p className="mt-3 text-sm text-fg">
                    Aguardando pagamento: <strong className="font-semibold tabular-nums">{formatMoney(e.awaitingPaymentCents)}</strong>{" "}
                    <span className="text-fg-muted">— ainda não recebido e fora dos totais acima.</span>
                  </p>
                )}
              </div>

              <section aria-labelledby="detalhamento">
                <SectionTitle id="detalhamento">Detalhamento por aula</SectionTitle>
                {e.items.length === 0 ? (
                  <EmptyState icon={<WalletIcon />} title="Nenhum recebimento no período" description="Os valores aparecerão após as primeiras aulas pagas." />
                ) : (
                  <>
                    {/* Tabela em telas largas */}
                    <Card padding="none" className="hidden overflow-x-auto xl:block">
                      <table className="w-full text-left text-sm">
                        <caption className="sr-only">Recebimentos por aula, com comissão de {rate}</caption>
                        <thead className="bg-surface-muted text-fg-muted">
                          <tr>
                            <th scope="col" className="px-4 py-3 font-medium">Data</th>
                            <th scope="col" className="px-4 py-3 font-medium">Aluno</th>
                            <th scope="col" className="px-4 py-3 text-right font-medium">Valor da aula</th>
                            <th scope="col" className="px-4 py-3 text-right font-medium">Comissão ({rate})</th>
                            <th scope="col" className="px-4 py-3 text-right font-medium">Sua parcela</th>
                            <th scope="col" className="px-4 py-3 text-right font-medium">Tarifas</th>
                            <th scope="col" className="px-4 py-3 text-right font-medium">Saldo estimado</th>
                            <th scope="col" className="px-4 py-3 font-medium">Situação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {e.items.map((i) => (
                            <tr key={i.id}>
                              <td className="px-4 py-3 tabular-nums">{formatDayMonth(i.date)}</td>
                              <td className="px-4 py-3 text-fg-strong">
                                {i.studentName}
                                <span className="block text-xs text-fg-muted">{subjectName(i.subject)}</span>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatMoney(i.grossCents)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">−{formatMoney(i.commissionCents)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatMoney(i.teacherShareCents)}</td>
                              <td className="px-4 py-3 text-right text-fg-muted">{fee(i)}</td>
                              <td className="px-4 py-3 text-right font-semibold text-fg-strong tabular-nums">{balance(i)}</td>
                              <td className="px-4 py-3">
                                <Badge tone={TONE[i.status]} dot>
                                  {FINANCIAL_LABELS[i.status]}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Card>

                    {/* Lista em telas menores */}
                    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:hidden">
                      {e.items.map((i) => (
                        <li key={i.id}>
                          <Card padding="sm">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold text-fg-strong">{i.studentName}</p>
                                <p className="text-sm text-fg-muted">
                                  {formatDayMonth(i.date)} · {subjectName(i.subject)}
                                </p>
                              </div>
                              <Badge tone={TONE[i.status]} dot>
                                {FINANCIAL_LABELS[i.status]}
                              </Badge>
                            </div>
                            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                              <div>
                                <dt className="text-xs text-fg-muted">Valor da aula</dt>
                                <dd className="tabular-nums">{formatMoney(i.grossCents)}</dd>
                              </div>
                              <div>
                                <dt className="text-xs text-fg-muted">Comissão ({rate})</dt>
                                <dd className="tabular-nums">−{formatMoney(i.commissionCents)}</dd>
                              </div>
                              <div>
                                <dt className="text-xs text-fg-muted">Tarifas</dt>
                                <dd className="text-fg-muted">{fee(i)}</dd>
                              </div>
                              <div>
                                <dt className="text-xs text-fg-muted">Saldo estimado</dt>
                                <dd className="font-semibold text-fg-strong tabular-nums">{balance(i)}</dd>
                              </div>
                            </dl>
                          </Card>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            </div>
          );
        }}
      </AsyncContent>
    </>
  );
}
