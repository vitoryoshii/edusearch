import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type DropdownItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
};

/**
 * Menu suspenso (padrão ARIA "menu button"): setas navegam, Home/End vão
 * às pontas, Esc fecha e devolve o foco ao botão.
 */
export function Dropdown({
  trigger,
  label,
  items,
  align = "end",
  triggerClassName,
  triggerHasText = false,
}: {
  trigger: ReactNode;
  /** Rótulo acessível do menu (e do botão, se ele não tiver texto visível). */
  label: string;
  /** Use quando o gatilho já mostra texto: o nome acessível vem do conteúdo visível (WCAG 2.5.3). */
  triggerHasText?: boolean;
  items: DropdownItem[];
  align?: "start" | "end";
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };
  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };
  const move = (delta: number) => {
    const pos = enabled.indexOf(active);
    const next = enabled[(pos + delta + enabled.length) % enabled.length];
    setActive(next);
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerHasText ? undefined : label}
        className={cn(
          "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control text-fg-strong transition-colors hover:bg-surface-muted",
          triggerClassName,
        )}
        onClick={() => (open ? close(false) : openAt(enabled[0] ?? 0))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            openAt(enabled[0] ?? 0);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            openAt(enabled[enabled.length - 1] ?? 0);
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={cn(
            "absolute top-full z-50 mt-2 min-w-52 animate-fade-in rounded-card border border-line bg-surface p-1.5 shadow-overlay",
            align === "end" ? "right-0" : "left-0",
          )}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            } else if (e.key === "Home") {
              e.preventDefault();
              setActive(enabled[0]);
            } else if (e.key === "End") {
              e.preventDefault();
              setActive(enabled[enabled.length - 1]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            } else if (e.key === "Tab") {
              setOpen(false);
            }
          }}
        >
          {items.map((it, i) => (
            <button
              key={it.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={i === active ? 0 : -1}
              disabled={it.disabled}
              className={cn(
                "flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-sm font-medium transition-colors focus-visible:outline-offset-0 disabled:opacity-50 [&>svg]:h-4.5 [&>svg]:w-4.5",
                it.tone === "danger" ? "text-danger-text hover:bg-danger-soft" : "text-fg-strong hover:bg-surface-muted",
              )}
              onClick={() => {
                close();
                it.onSelect();
              }}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
