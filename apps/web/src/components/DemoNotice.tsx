import type { ReactNode } from "react";
import { InfoIcon, cn } from "@edusearch/ui";
import { isDemo } from "../lib/data/source";

/** Faixa fixa no topo das áreas logadas indicando o modo demonstração. */
export function DemoBanner() {
  if (!isDemo) return null;
  return (
    <div className="border-b border-line bg-surface-muted px-4 py-2 text-center text-xs text-fg sm:px-6">
      <strong className="font-semibold text-fg-strong">Modo demonstração</strong> · dados fictícios. Nenhuma aula, pagamento
      ou mensagem é real.
    </div>
  );
}

/** Aviso contextual sobre uma funcionalidade que depende de integração futura. */
export function DemoNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-2.5 rounded-card bg-surface-muted px-4 py-3 text-sm text-fg", className)}>
      <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-link" />
      <span>{children}</span>
    </p>
  );
}
