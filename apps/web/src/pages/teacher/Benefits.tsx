import { Badge, Card, CheckCircleIcon, ClockIcon, CopyIcon, EmptyState, GiftIcon, ProgressBar, TrophyIcon, cn } from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { DemoNotice } from "../../components/DemoNotice";
import { PageHeader, SectionTitle } from "../../components/PageHeader";
import { formatBps } from "../../lib/commission";
import { dataSource } from "../../lib/data/source";
import { formatDateShort, formatMoney } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";

function Rate({ label, bps, hint }: { label: string; bps: number; hint: string }) {
  return (
    <div className="rounded-card bg-surface-muted p-3 sm:p-4">
      <p className="text-xs text-fg-muted sm:text-sm">{label}</p>
      <p className="mt-1 text-xl font-semibold text-fg-strong tabular-nums sm:text-2xl">{formatBps(bps)}</p>
      <p className="mt-0.5 hidden text-xs text-fg-muted sm:block">{hint}</p>
    </div>
  );
}

export default function Benefits() {
  const data = useAsync(() => Promise.all([dataSource.getCommissionProgram(), dataSource.getReferralProgram()]), []);

  return (
    <>
      <PageHeader title="Comissão e benefícios" description="Sua comissão atual, metas e indicações." />
      <AsyncContent state={data} reload={data.reload}>
        {([program, referral]) => (
          <div className="space-y-10">
            {/* 1. Comissão */}
            <section aria-labelledby="sua-comissao">
              <SectionTitle id="sua-comissao">Sua comissão</SectionTitle>
              <Card className="space-y-5">
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <Rate label="Comissão padrão" bps={program.standardBps} hint="Regra oficial do EduSearch" />
                  <Rate label="Comissão atual" bps={program.currentBps} hint={program.activeBenefits.length ? "Com benefícios ativos" : "Sem benefícios ativos"} />
                  <div className="rounded-card bg-surface-muted p-3 sm:p-4">
                    <p className="text-xs text-fg-muted sm:text-sm">Economia acumulada</p>
                    <p className="mt-1 text-xl font-semibold text-fg-strong tabular-nums sm:text-2xl">{formatMoney(program.savingsCents)}</p>
                    <p className="mt-0.5 hidden text-xs text-fg-muted sm:block">Com benefícios de comissão</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-fg-strong">Benefícios ativos</p>
                  {program.activeBenefits.length ? (
                    <ul className="mt-2 space-y-2">
                      {program.activeBenefits.map((b) => (
                        <li key={b.id} className="text-sm text-fg">
                          <strong className="font-semibold text-fg-strong">{b.title}</strong> — {b.description}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-fg-muted">Nenhum benefício ativo no momento.</p>
                  )}
                </div>
                <DemoNotice>
                  Reduções de comissão por desempenho estão em definição: <strong className="font-semibold">nenhuma faixa foi aprovada</strong>. O
                  cálculo oficial será feito pelo EduSearch (backend), com base em metas verificáveis.
                </DemoNotice>
              </Card>
            </section>

            {/* 2. Metas e conquistas */}
            <section aria-labelledby="metas">
              <SectionTitle id="metas" action={program.illustrative ? <Badge tone="demo">Exemplo com dados da demonstração</Badge> : undefined}>
                Metas
              </SectionTitle>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {program.goals.map((g) => (
                  <Card key={g.id} padding="sm" className="sm:p-5">
                    <ProgressBar label={g.title} value={g.current} max={g.target} tone={g.current >= g.target ? "success" : "primary"} />
                    <p className="mt-2 text-xs text-fg-muted">
                      {g.current} de {g.target} {g.unit} · Recompensa: {g.reward}
                    </p>
                  </Card>
                ))}
              </div>

              <h3 className="mt-6 mb-3 text-sm font-semibold text-fg-strong">Histórico de conquistas</h3>
              <Card padding="none">
                <ul className="divide-y divide-line">
                  {program.achievements.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-5 py-3.5">
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                          a.achieved ? "bg-success-soft text-success-text" : "bg-surface-muted text-fg-muted",
                        )}
                      >
                        {a.achieved ? <TrophyIcon className="h-4.5 w-4.5" /> : <ClockIcon className="h-4.5 w-4.5" />}
                      </span>
                      <span className="min-w-0 flex-1 text-sm font-medium text-fg-strong">{a.title}</span>
                      <span className="text-sm text-fg-muted">{a.achieved ? (a.date ? formatDateShort(a.date) : "Concluída") : "Em andamento"}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>

            {/* 3. Indicações */}
            <section aria-labelledby="indicacoes">
              <SectionTitle id="indicacoes" action={referral.illustrative ? <Badge tone="demo">Exemplo · não funcional</Badge> : undefined}>
                Indicações
              </SectionTitle>
              <Card className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm text-fg-muted">Seu código de indicação</p>
                    <p className="mt-1 font-mono text-xl font-semibold tracking-wide text-fg-strong">{referral.code}</p>
                    <p className="mt-1 text-xs text-fg-muted">
                      {referral.shareUrl ? "Compartilhe o link com outros professores." : "Link de indicação disponível após a integração."}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!referral.shareUrl}
                    className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong px-4 text-sm font-semibold text-fg-strong disabled:pointer-events-none disabled:opacity-55"
                  >
                    <CopyIcon className="h-4 w-4" /> Copiar link
                  </button>
                </div>

                <dl className="grid grid-cols-2 gap-3">
                  <div className="rounded-card bg-surface-muted p-4">
                    <dt className="text-sm text-fg-muted">Indicações</dt>
                    <dd className="mt-1 text-2xl font-semibold text-fg-strong tabular-nums">{referral.invited}</dd>
                  </div>
                  <div className="rounded-card bg-surface-muted p-4">
                    <dt className="text-sm text-fg-muted">Qualificadas</dt>
                    <dd className="mt-1 text-2xl font-semibold text-fg-strong tabular-nums">{referral.qualified}</dd>
                  </div>
                </dl>

                {referral.goals.map((g) => (
                  <div key={g.id}>
                    <ProgressBar label={`Meta: ${g.title}`} value={g.current} max={g.target} />
                    <p className="mt-1.5 text-xs text-fg-muted">
                      {g.current} de {g.target} · Recompensa: {g.reward}
                    </p>
                  </div>
                ))}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-fg-strong">
                      <CheckCircleIcon className="h-4 w-4 text-success-text" /> Benefícios conquistados
                    </p>
                    {referral.rewardsEarned.length ? (
                      <ul className="mt-2 space-y-1 text-sm text-fg">
                        {referral.rewardsEarned.map((r) => (
                          <li key={r.id}>{r.title}</li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState compact icon={<GiftIcon />} title="Nenhuma recompensa liberada" description="As regras de recompensa ainda estão em definição." />
                    )}
                  </div>
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-fg-strong">
                      <ClockIcon className="h-4 w-4 text-link" /> Recompensas pendentes
                    </p>
                    <ul className="mt-2 space-y-2">
                      {referral.rewardsPending.map((r) => (
                        <li key={r.id} className="rounded-control bg-surface-muted px-3 py-2.5 text-sm">
                          <span className="font-medium text-fg-strong">{r.title}</span>
                          <span className="mt-0.5 block text-fg-muted">{r.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-fg-muted">
                  Cadastros não geram recompensa. Indicações serão validadas pelo EduSearch (sem autoindicação, com prevenção de fraude e
                  regras de estorno e elegibilidade) antes de qualquer benefício.
                </p>
              </Card>
            </section>
          </div>
        )}
      </AsyncContent>
    </>
  );
}
