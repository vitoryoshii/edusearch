import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

export type AsyncState<T> =
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "error"; data: undefined; error: unknown }
  | { status: "success"; data: T; error: undefined };

/**
 * Leitura assíncrona com estados explícitos (loading / error / success),
 * descarte de respostas obsoletas e `reload` para "Tentar novamente".
 * Simples de propósito; pode ser trocado por TanStack Query se o app crescer.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading", data: undefined, error: undefined });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let active = true;
    setState({ status: "loading", data: undefined, error: undefined });
    fnRef.current().then(
      (data) => active && setState({ status: "success", data, error: undefined }),
      (error: unknown) => active && setState({ status: "error", data: undefined, error }),
    );
    return () => {
      active = false;
    };
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  /** Atualiza os dados localmente (ex.: após salvar), sem novo carregamento. */
  const setData = useCallback((data: T) => setState({ status: "success", data, error: undefined }), []);

  return { ...state, reload, setData };
}

/** Executa uma ação de escrita controlando `pending`. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async (...args: A) => {
      setPending(true);
      try {
        return await fn(...args);
      } finally {
        setPending(false);
      }
    },
    [fn],
  );
  return { run, pending };
}
