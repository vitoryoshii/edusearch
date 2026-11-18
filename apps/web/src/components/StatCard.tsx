import type { ReactNode } from "react";
import { Card, type IconComponent } from "@edusearch/ui";

/** Indicador numérico simples. Sem gráficos decorativos. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: IconComponent;
}) {
  return (
    <Card padding="sm" className="flex items-start gap-3 sm:p-5">
      {Icon && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary-soft text-link">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-sm text-fg-muted">{label}</p>
        <p className="mt-0.5 text-xl font-semibold text-fg-strong tabular-nums">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
      </div>
    </Card>
  );
}
