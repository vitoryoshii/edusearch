import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { AlertIcon, Button, EmptyState, ErrorState, LoadingState, RefreshIcon, Spinner } from "@edusearch/ui";
import { describeError } from "../lib/api/client";

type QueryLike<T> = Pick<UseQueryResult<T>, "data" | "error" | "isPending" | "isFetching" | "isError" | "refetch">;

/**
 * Estados de uma consulta com cache (Fase 4B):
 * - sem dados: carregando (bloqueante) ou erro com "Tentar novamente";
 * - COM dados: o conteúdo aparece na hora; a revalidação em segundo plano mostra só um aviso discreto;
 *   se ela falhar, os dados continuam na tela com o alerta de que podem estar desatualizados.
 */
export function QueryContent<T>({
  query,
  isEmpty,
  empty,
  loading = "skeleton",
  loadingLabel,
  children,
}: {
  query: QueryLike<T>;
  isEmpty?: (data: T) => boolean;
  empty?: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode };
  loading?: "skeleton" | "spinner";
  loadingLabel?: string;
  children: (data: T) => ReactNode;
}) {
  const retry = () => void query.refetch();
  if (query.data === undefined) {
    if (query.isError) return <ErrorState description={describeError(query.error)} onRetry={retry} />;
    return <LoadingState variant={loading} label={loadingLabel} />;
  }
  return (
    <>
      <RefreshStatus query={query} />
      {empty && isEmpty?.(query.data) ? <EmptyState {...empty} /> : children(query.data)}
    </>
  );
}

/** Linha discreta: "Atualizando…" durante a revalidação; alerta se ela falhar com dados na tela. */
export function RefreshStatus({ query }: { query: QueryLike<unknown> }) {
  if (query.data !== undefined && query.isError) {
    return (
      <div role="alert" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control bg-warning-soft px-3 py-2 text-sm" data-testid="query-stale">
        <AlertIcon className="h-4 w-4 shrink-0 text-warning-text" />
        <span className="text-fg">Não foi possível atualizar agora. Os dados exibidos podem estar desatualizados.</span>
        <Button variant="ghost" size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
          Tentar novamente
        </Button>
      </div>
    );
  }
  const refreshing = query.isFetching && !query.isPending;
  // A região existe sempre (aria-live precisa estar no DOM antes da mudança); só aparece ao atualizar.
  return (
    <p aria-live="polite" className={refreshing ? "mb-2 text-xs text-fg-muted" : "sr-only"} data-testid={refreshing ? "query-refreshing" : undefined}>
      {refreshing ? (
        <span className="inline-flex items-center gap-1.5">
          <Spinner className="h-3 w-3" /> Atualizando…
        </span>
      ) : null}
    </p>
  );
}

/** Botão "Atualizar" para listas (revalida na hora, sem esconder o que já está na tela). */
export function RefreshButton({ query, label = "Atualizar" }: { query: QueryLike<unknown>; label?: string }) {
  return (
    <Button variant="ghost" size="sm" leftIcon={<RefreshIcon className="h-4 w-4" />} loading={query.isFetching && !query.isPending} onClick={() => void query.refetch()}>
      {label}
    </Button>
  );
}
