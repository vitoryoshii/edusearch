import { Badge, Card, EmptyState, WalletIcon } from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { DemoNotice } from "../../components/DemoNotice";
import { PageHeader, SectionTitle } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
import type { EarningStatus } from "../../lib/api/types";
import { subjectName } from "../../lib/catalog";
import { dataSource } from "../../lib/data/source";
import { formatDayMonth, formatMoney } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";

const STATUS: Record<EarningStatus, { label: string; tone: "success" | "neutral" }> = {
  transferred: { label: "Repassado", tone: "success" },
  expected: { label: "Previsto", tone: "neutral" },
};

export default function Earnings() {
  const data = useAsync(() => dataSource.getEarnings(), []);

  return (
    <>
      <PageHeader title="Recebimentos" description="Visão dos valores por aula, comissão e repasses." />
      <DemoNotice className="mb-6">
        Valores fictícios. Pagamentos via Pix, split e repasse (AbacatePay) ainda não estão integrados. A comissão de 10% é
        uma hipótese em validação.
      </DemoNotice>

      <AsyncContent state={data} reload={data.reload}>
        {(e) => (
          <div className="space-y-8">
            <div>
              <p className="mb-3 text-sm text-fg-muted">Período: {e.periodLabel}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard label="Valor bruto das aulas" value={formatMoney(e.grossCents)} />
                <StatCard label={`Comissão (${Math.round(e.feeRate * 100)}%)`} value={formatMoney(e.feeCents)} />
                <StatCard icon={WalletIcon} label="Valor líquido" value={formatMoney(e.netCents)} />
              </div>
            </div>

            <section aria-labelledby="detalhamento">
              <SectionTitle id="detalhamento">Detalhamento por aula</SectionTitle>
              {e.items.length === 0 ? (
                <EmptyState icon={<WalletIcon />} title="Nenhum recebimento no período" description="Os valores aparecerão após as primeiras aulas." />
              ) : (
                <>
                  {/* Tabela no desktop */}
                  <Card padding="none" className="hidden overflow-hidden md:block">
                    <table className="w-full text-left text-sm">
                      <caption className="sr-only">Recebimentos por aula</caption>
                      <thead className="bg-surface-muted text-fg-muted">
                        <tr>
                          <th scope="col" className="px-5 py-3 font-medium">Data</th>
                          <th scope="col" className="px-5 py-3 font-medium">Aluno</th>
                          <th scope="col" className="px-5 py-3 font-medium">Disciplina</th>
                          <th scope="col" className="px-5 py-3 text-right font-medium">Bruto</th>
                          <th scope="col" className="px-5 py-3 text-right font-medium">Comissão</th>
                          <th scope="col" className="px-5 py-3 text-right font-medium">Líquido</th>
                          <th scope="col" className="px-5 py-3 font-medium">Situação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {e.items.map((i) => (
                          <tr key={i.id}>
                            <td className="px-5 py-3 tabular-nums">{formatDayMonth(i.date)}</td>
                            <td className="px-5 py-3 text-fg-strong">{i.studentName}</td>
                            <td className="px-5 py-3">{subjectName(i.subject)}</td>
                            <td className="px-5 py-3 text-right tabular-nums">{formatMoney(i.grossCents)}</td>
                            <td className="px-5 py-3 text-right tabular-nums">−{formatMoney(i.feeCents)}</td>
                            <td className="px-5 py-3 text-right font-semibold text-fg-strong tabular-nums">{formatMoney(i.netCents)}</td>
                            <td className="px-5 py-3">
                              <Badge tone={STATUS[i.status].tone} dot>
                                {STATUS[i.status].label}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>

                  {/* Lista no mobile */}
                  <ul className="grid gap-3 md:hidden">
                    {e.items.map((i) => (
                      <li key={i.id}>
                        <Card padding="sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-fg-strong">{i.studentName}</p>
                              <p className="text-sm text-fg-muted">
                                {formatDayMonth(i.date)} · {subjectName(i.subject)}
                              </p>
                            </div>
                            <Badge tone={STATUS[i.status].tone} dot>
                              {STATUS[i.status].label}
                            </Badge>
                          </div>
                          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                            <div>
                              <dt className="text-xs text-fg-muted">Bruto</dt>
                              <dd className="tabular-nums">{formatMoney(i.grossCents)}</dd>
                            </div>
                            <div>
                              <dt className="text-xs text-fg-muted">Comissão</dt>
                              <dd className="tabular-nums">−{formatMoney(i.feeCents)}</dd>
                            </div>
                            <div>
                              <dt className="text-xs text-fg-muted">Líquido</dt>
                              <dd className="font-semibold text-fg-strong tabular-nums">{formatMoney(i.netCents)}</dd>
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
        )}
      </AsyncContent>
    </>
  );
}
