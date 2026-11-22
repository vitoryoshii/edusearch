import { dateParts } from "../../lib/scheduling";

/** Bloco de data (dia da semana, dia, mês) no fuso de Brasília. Decorativo: a data completa vem em texto ao lado. */
export function DateBlock({ iso, tone = "default" }: { iso: string; tone?: "default" | "muted" }) {
  const d = dateParts(iso);
  return (
    <div
      aria-hidden="true"
      className={
        "flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-control border text-center leading-none " +
        (tone === "muted" ? "border-line bg-surface-muted text-fg-muted" : "border-transparent bg-primary-soft text-link")
      }
    >
      <span className="text-[0.6875rem] font-semibold tracking-wide uppercase">{d.weekday}</span>
      <span className="mt-1 text-xl font-semibold text-fg-strong tabular-nums">{d.day}</span>
      <span className="mt-0.5 text-[0.6875rem] font-medium uppercase">{d.month}</span>
    </div>
  );
}
