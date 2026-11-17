import { useId, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type TabItem = { id: string; label: string; count?: number; content: ReactNode };

/**
 * Abas acessíveis (padrão ARIA "tabs", ativação automática).
 * Setas esquerda/direita, Home e End alternam entre as abas.
 */
export function Tabs({
  items,
  value,
  defaultValue,
  onChange,
  label,
  className,
}: {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  /** Rótulo acessível do conjunto de abas. */
  label: string;
  className?: string;
}) {
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.id);
  const current = value ?? internal;
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (id: string, focus = false) => {
    if (value === undefined) setInternal(id);
    onChange?.(id);
    if (focus) tabRefs.current[items.findIndex((t) => t.id === id)]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = items.length - 1;
    const map: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    if (e.key in map) {
      e.preventDefault();
      select(items[map[e.key]].id, true);
    }
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className="inline-flex max-w-full gap-1 overflow-x-auto rounded-control bg-surface-muted p-1"
      >
        {items.map((t, i) => {
          const selected = t.id === current;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              id={`${baseId}-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "inline-flex min-h-10 items-center gap-2 rounded-[0.5rem] px-4 text-sm font-medium whitespace-nowrap transition-colors",
                selected ? "bg-surface text-fg-strong shadow-card" : "text-fg-muted hover:text-fg-strong",
              )}
            >
              {t.label}
              {t.count !== undefined && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs tabular-nums",
                    selected ? "bg-primary-soft text-link" : "bg-surface text-fg-muted",
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {items.map((t) => (
        <div
          key={t.id}
          id={`${baseId}-panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${t.id}`}
          hidden={t.id !== current}
          tabIndex={0}
          className="mt-5 focus-visible:outline-offset-4"
        >
          {t.id === current && t.content}
        </div>
      ))}
    </div>
  );
}
