import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { IconButton } from "./Button";
import { AlertIcon, CheckCircleIcon, CloseIcon, InfoIcon } from "./icons";

export type ToastTone = "info" | "success" | "error";
export type ToastInput = { title: string; description?: string; tone?: ToastTone; duration?: number };
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

const toneStyles: Record<ToastTone, { icon: ReactNode; className: string }> = {
  info: { icon: <InfoIcon />, className: "text-link" },
  success: { icon: <CheckCircleIcon />, className: "text-success-text" },
  error: { icon: <AlertIcon />, className: "text-danger-text" },
};

/**
 * Notificações temporárias. A região é anunciada por leitores de tela
 * (role="status"/aria-live) e cada aviso pode ser fechado manualmente.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      setItems((all) => [...all.slice(-2), { ...input, id }]);
      window.setTimeout(() => dismiss(id), input.duration ?? 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6"
      >
        {items.map((t) => {
          const tone = toneStyles[t.tone ?? "info"];
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-card border border-line bg-surface p-4 shadow-overlay"
            >
              <span className={cn("mt-0.5 shrink-0 [&>svg]:h-5 [&>svg]:w-5", tone.className)}>{tone.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg-strong">{t.title}</p>
                {t.description && <p className="mt-0.5 text-sm text-fg-muted">{t.description}</p>}
              </div>
              <IconButton label="Fechar aviso" size="sm" className="-mt-1.5 -mr-1.5" onClick={() => dismiss(t.id)}>
                <CloseIcon className="h-4 w-4" />
              </IconButton>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>.");
  return ctx;
}
