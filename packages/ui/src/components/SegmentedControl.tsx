import { useId, useRef } from "react";
import { cn } from "../lib/cn";

export type SegmentOption<T extends string> = { value: T; label: string; icon?: React.ReactNode };

/**
 * Controle segmentado (padrão ARIA "radio group"): uma opção ativa por vez.
 * Setas esquerda/direita mudam a seleção; Tab entra e sai do grupo.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const name = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (delta: number) => {
    const i = options.findIndex((o) => o.value === value);
    const next = (i + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex max-w-full gap-1 rounded-control bg-surface-muted p-1", className)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            name={name}
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-[0.5rem] font-medium whitespace-nowrap transition-colors [&>svg]:h-4 [&>svg]:w-4",
              size === "sm" ? "min-h-9 px-3 text-sm" : "min-h-10 px-4 text-sm",
              checked ? "bg-surface text-fg-strong shadow-card" : "text-fg-muted hover:text-fg-strong",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
