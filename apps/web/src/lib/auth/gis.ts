/**
 * Google Identity Services (GIS) — carregamento e inicialização únicos.
 *
 * - O script oficial (https://accounts.google.com/gsi/client) é injetado uma
 *   única vez e só quando o login real está ativo.
 * - `initialize` é chamado uma vez por nonce: as montagens duplas do React
 *   StrictMode reaproveitam a mesma inicialização.
 * - O callback do GIS repassa a credencial apenas ao componente montado no
 *   momento. Respostas que chegam depois da desmontagem são descartadas.
 */
export type CredentialResponse = { credential?: string; select_by?: string };

export type GisButtonOptions = {
  type: "standard";
  theme: "outline" | "filled_blue" | "filled_black";
  size: "large" | "medium" | "small";
  text: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape: "rectangular" | "pill";
  logo_alignment: "left" | "center";
  width?: number;
  locale?: string;
};

export type GisId = {
  initialize(config: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    nonce: string;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    ux_mode?: "popup" | "redirect";
    itp_support?: boolean;
    context?: "signin" | "signup" | "use";
  }): void;
  renderButton(parent: HTMLElement, options: GisButtonOptions): void;
  disableAutoSelect(): void;
  cancel(): void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GisId } };
  }
}

export const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";

let loading: Promise<GisId> | null = null;

/** Carrega o GIS (uma vez). Em caso de falha, permite nova tentativa. */
export function loadGis(timeoutMs = 15_000): Promise<GisId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  loading ??= new Promise<GisId>((resolve, reject) => {
    const fail = () => {
      loading = null;
      document.querySelector(`script[data-gis]`)?.remove();
      reject(new Error("gis_unavailable"));
    };
    const timer = window.setTimeout(fail, timeoutMs);
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.dataset.gis = "";
    script.onload = () => {
      window.clearTimeout(timer);
      const id = window.google?.accounts?.id;
      if (id) resolve(id);
      else fail();
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      fail();
    };
    document.head.appendChild(script);
  });
  return loading;
}

let listener: ((response: CredentialResponse) => void) | null = null;
let initializedWith: string | null = null;

/** Inicializa o GIS para um nonce (hash). Repetir com o mesmo nonce não faz nada. */
export function initializeGis(gis: GisId, opts: { clientId: string; hashedNonce: string }) {
  if (initializedWith === opts.hashedNonce) return;
  initializedWith = opts.hashedNonce;
  gis.initialize({
    client_id: opts.clientId,
    nonce: opts.hashedNonce,
    callback: (response) => listener?.(response),
    auto_select: false,
    cancel_on_tap_outside: true,
    ux_mode: "popup",
    itp_support: true,
    context: "signin",
  });
}

/** Registra quem recebe a próxima credencial. Devolve o cancelamento. */
export function setCredentialListener(fn: (response: CredentialResponse) => void) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** Após sair: impede que o Google entre automaticamente na mesma conta. */
export function disableGisAutoSelect() {
  window.google?.accounts?.id?.disableAutoSelect();
}
