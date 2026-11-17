import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { IconButton } from "./Button";
import { CloseIcon } from "./icons";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** "sheet" encaixa na base da tela no mobile (filtros, ações). */
  variant?: "center" | "sheet";
  size?: "sm" | "md" | "lg";
}

const widths = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl" } as const;

/**
 * Diálogo modal baseado no <dialog> nativo: foco preso, Esc fecha e o
 * conteúdo de fundo fica inerte sem dependências extras. O foco volta ao
 * elemento que abriu o diálogo ao fechar.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = "center",
  size = "md",
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      const opener = document.activeElement as HTMLElement | null;
      el.showModal();
      document.documentElement.style.overflow = "hidden";
      return () => {
        if (el.open) el.close();
        document.documentElement.style.overflow = "";
        opener?.focus?.();
      };
    }
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={cn(
        "m-0 max-h-[100dvh] w-full max-w-none bg-transparent p-0 text-fg backdrop:animate-fade-in open:flex",
        variant === "sheet" ? "mt-auto sm:m-auto" : "m-auto px-4",
        "sm:mx-auto sm:px-0",
        widths[size],
      )}
    >
      {open && (
        <div
          className={cn(
            "flex max-h-[90dvh] w-full animate-slide-up flex-col border border-line bg-surface shadow-overlay",
            variant === "sheet" ? "rounded-t-panel sm:rounded-panel" : "rounded-panel",
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div>
              <h2 id={titleId} className="text-lg font-semibold text-fg-strong">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-1 text-sm text-fg-muted">
                  {description}
                </p>
              )}
            </div>
            <IconButton label="Fechar" size="sm" onClick={onClose} className="-mr-2">
              <CloseIcon className="h-5 w-5" />
            </IconButton>
          </header>
          {children && <div className="overflow-y-auto px-5 py-5 sm:px-6">{children}</div>}
          {footer && (
            <footer className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
