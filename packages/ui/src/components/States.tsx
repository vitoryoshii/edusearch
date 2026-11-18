import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Button } from "./Button";
import { AlertIcon, InboxIcon, RefreshIcon } from "./icons";
import { Skeleton } from "./Display";
import { Spinner } from "./Spinner";

function StateFrame({
  icon,
  iconTone,
  title,
  description,
  action,
  compact,
  className,
  role,
}: {
  icon: ReactNode;
  iconTone: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "gap-3 px-4 py-8" : "gap-4 rounded-card border border-dashed border-line-strong px-6 py-12",
        className,
      )}
    >
      <span className={cn("flex h-12 w-12 items-center justify-center rounded-full [&>svg]:h-6 [&>svg]:w-6", iconTone)}>
        {icon}
      </span>
      <div className="max-w-sm">
        <p className="font-semibold text-fg-strong">{title}</p>
        {description && <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{description}</p>}
      </div>
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon = <InboxIcon />,
  action,
  compact,
  className,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <StateFrame
      icon={icon}
      iconTone="bg-primary-soft text-link"
      {...{ title, description, action, compact, className }}
    />
  );
}

export function ErrorState({
  title = "Não foi possível carregar",
  description = "Verifique sua conexão e tente novamente.",
  onRetry,
  compact,
  className,
}: {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <StateFrame
      role="alert"
      icon={<AlertIcon />}
      iconTone="bg-danger-soft text-danger-text"
      action={
        onRetry && (
          <Button variant="secondary" size="sm" leftIcon={<RefreshIcon className="h-4 w-4" />} onClick={onRetry}>
            Tentar novamente
          </Button>
        )
      }
      {...{ title, description, compact, className }}
    />
  );
}

/**
 * Carregamento com anúncio para leitores de tela.
 * `variant="skeleton"` mostra linhas de esqueleto no lugar do spinner.
 */
export function LoadingState({
  label = "Carregando…",
  variant = "spinner",
  rows = 3,
  className,
}: {
  label?: string;
  variant?: "spinner" | "skeleton";
  rows?: number;
  className?: string;
}) {
  if (variant === "skeleton") {
    return (
      <div role="status" aria-live="polite" className={cn("flex flex-col gap-3", className)}>
        <span className="sr-only">{label}</span>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-card border border-line bg-surface p-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" className={cn("flex items-center justify-center gap-3 py-12 text-fg-muted", className)}>
      <Spinner className="text-link" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
