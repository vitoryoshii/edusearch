import { Badge, Card } from "@edusearch/ui";

/** Blocos reutilizáveis para Fases 6.3/6.4. Não calculam metas nem concedem benefício nesta fase. */
export function CommissionLevelCard({ commissionBps }: { commissionBps: number }) {
  return <Card><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-fg-strong">Nível de comissão</h3><p className="mt-1 text-sm text-fg-muted">Regra vigente aplicada às novas aulas pagas.</p></div><Badge tone="primary">{(commissionBps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</Badge></div></Card>;
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
