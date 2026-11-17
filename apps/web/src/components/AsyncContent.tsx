import type { ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState } from "@edusearch/ui";
import { describeError } from "../lib/api/client";
import type { AsyncState } from "../lib/hooks/useAsync";

/**
 * Renderiza os estados padrão de uma leitura assíncrona:
 * carregando → erro (com "Tentar novamente") → vazio → conteúdo.
 */
export function AsyncContent<T>({
  state,
  reload,
  isEmpty,
  empty,
  loading = "skeleton",
  loadingLabel,
  children,
}: {
  state: AsyncState<T>;
  reload: () => void;
  isEmpty?: (data: T) => boolean;
  empty?: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode };
  loading?: "skeleton" | "spinner";
  loadingLabel?: string;
  children: (data: T) => ReactNode;
}) {
  if (state.status === "loading") return <LoadingState variant={loading} label={loadingLabel} />;
  if (state.status === "error") return <ErrorState description={describeError(state.error)} onRetry={reload} />;
  if (empty && isEmpty?.(state.data)) return <EmptyState {...empty} />;
  return <>{children(state.data)}</>;
}
