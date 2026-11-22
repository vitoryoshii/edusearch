import { useCallback, useEffect, useState } from "react";
import { accountApi, type CatalogSubject } from "../lib/api/account";
import { ApiError } from "../lib/api/client";
import { SUBJECTS } from "../lib/catalog";
import { queryClient } from "../lib/query/client";
import { queryKeys } from "../lib/query/keys";
import { STALE_MS } from "../lib/query/policy";

export type Option = { value: string; label: string };

export type OnboardingLoad<D> =
  | { status: "loading" }
  | { status: "error"; error: unknown; retry: () => void }
  /** O servidor recusou por falta de papel: volta às boas-vindas. */
  | { status: "role_missing" }
  | { status: "ready"; initial: D | null; subjects: Option[] };

const catalogOptions = (list: CatalogSubject[]): Option[] => list.map((s) => ({ value: s.slug, label: s.name }));
const PREVIEW_SUBJECTS: Option[] = SUBJECTS.map((s) => ({ value: s.id, label: s.name }));

/**
 * Carrega o catálogo oficial e o cadastro já salvo (modo servidor). 404 = ainda não salvo
 * (rascunho vazio). No modo prévia não chama a API (catálogo provisório, sem rascunho).
 */
export function useOnboardingLoad<D>(
  server: boolean,
  fetchSaved: (signal: AbortSignal) => Promise<D>,
): OnboardingLoad<D> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<OnboardingLoad<D>>(() =>
    server ? { status: "loading" } : { status: "ready", initial: null, subjects: PREVIEW_SUBJECTS },
  );
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!server) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    Promise.all([
      queryClient.ensureQueryData({ queryKey: queryKeys.subjects(), queryFn: ({ signal }) => accountApi.subjects(signal), staleTime: STALE_MS.subjects }),
      fetchSaved(controller.signal).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404 && e.serverCode?.endsWith("_profile_not_found")) return null;
        throw e;
      }),
    ])
      .then(([subjects, saved]) => setState({ status: "ready", initial: saved, subjects: catalogOptions(subjects) }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.serverCode === "role_required") setState({ status: "role_missing" });
        else setState({ status: "error", error, retry });
      });
    return () => controller.abort();
  }, [server, attempt, retry, fetchSaved]);

  return state;
}
