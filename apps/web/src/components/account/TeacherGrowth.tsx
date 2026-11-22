import { Badge, Card } from "@edusearch/ui";
import type { CommissionProgress } from "../../lib/api/payments";
import { formatBRL } from "../../lib/payments";

/** Blocos reutilizáveis para Fases 6.3/6.4. Não calculam metas nem concedem benefício nesta fase. */
export function CommissionLevelCard({ commissionBps }: { commissionBps: number }) {
  return <Card><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-fg-strong">Nível de comissão</h3><p className="mt-1 text-sm text-fg-muted">Regra vigente aplicada às novas aulas pagas.</p></div><Badge tone="primary">{(commissionBps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</Badge></div></Card>;
}

/** Mostra somente a política devolvida pela API; não promete redução nem ganhos futuros. */
export function CommissionProgressCard({ progress }: { progress: CommissionProgress }) {
  const hasNext = progress.next_level_paid_lessons !== null && progress.lessons_remaining !== null;
  const nextThreshold = progress.next_level_paid_lessons ?? 0;
  const pct = hasNext && nextThreshold > 0
    ? Math.min(100, Math.round((progress.eligible_paid_lessons / nextThreshold) * 100))
    : 100;
  return <Card data-testid="commission-progress">
    <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-fg-strong">Evolução da comissão</h3><p className="mt-1 text-sm text-fg-muted">Política {progress.policy_version} · janela de {progress.evaluation_days} dias.</p></div><Badge tone="primary">Nível {progress.current_level + 1}</Badge></div>
    <p className="mt-3 text-sm text-fg">Comissão vigente nas novas cobranças: <strong>{(progress.current_rate_bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</strong>.</p>
    {hasNext ? <><div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-label="Progresso para a próxima faixa" aria-valuemin={0} aria-valuemax={nextThreshold} aria-valuenow={progress.eligible_paid_lessons}><div className="h-full rounded-full bg-link" style={{ width: `${pct}%` }} /></div><p className="mt-2 text-xs text-fg-muted">{progress.eligible_paid_lessons} de {nextThreshold} aulas pagas elegíveis. Faltam {progress.lessons_remaining}. Próxima taxa: {(progress.next_rate_bps! / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%.</p></> : <p className="mt-3 text-sm text-fg-muted">Não há próxima faixa ativa. As regras comerciais futuras dependem de aprovação e não alteram cobranças já criadas.</p>}
    <div className="mt-3 rounded-lg bg-surface-muted p-3 text-sm text-fg-muted"><strong className="text-fg">Simulação informativa:</strong> em uma aula de {formatBRL(progress.simulation_amount_cents)}, a comissão seria {formatBRL(progress.simulation_commission_cents)} e a parcela atribuída ao professor, {formatBRL(progress.simulation_teacher_share_cents)}. Não representa saldo, ganho prometido, repasse ou valor recebido.</div>
  </Card>;
}

export function NextCommissionTierCard() {
  return <Card tone="soft"><h3 className="font-semibold text-fg-strong">Próxima faixa</h3><p className="mt-1 text-sm text-fg-muted">Em desenvolvimento. Nenhuma faixa progressiva, progresso ou redução é calculada até a política ser aprovada e auditável.</p></Card>;
}

export function GoalsAndAchievementsCard() {
  return <Card tone="soft"><h3 className="font-semibold text-fg-strong">Metas e conquistas</h3><p className="mt-1 text-sm text-fg-muted">Em desenvolvimento. Esta etapa não cria metas, pontos ou recompensas fictícias.</p></Card>;
}

export function QualifiedReferralsCard() {
  return <Card tone="soft"><h3 className="font-semibold text-fg-strong">Indicações qualificadas</h3><p className="mt-1 text-sm text-fg-muted">Em desenvolvimento. Não há link de indicação, crédito ou recompensa antes das regras de qualificação.</p></Card>;
}
