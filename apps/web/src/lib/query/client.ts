import { QueryClient } from "@tanstack/react-query";
import { GC_MS, retryDelay, shouldRetry } from "./policy";

/**
 * Cliente de consultas ÚNICO da aplicação (Fase 4B).
 *
 * - Só memória: nenhum persister (nada de localStorage, IndexedDB ou Service Worker).
 * - Deduplicação: consultas iguais e simultâneas viram uma requisição.
 * - Revalidação em segundo plano ao voltar à tela, ao focar a janela e ao reconectar, só quando o
 *   dado já passou do prazo de validade (STALE_MS por recurso, definido em cada consulta).
 * - Sem retry automático para 401/403/404/409/422; mutações nunca repetem sozinhas.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: GC_MS,
        retry: shouldRetry,
        retryDelay,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();
