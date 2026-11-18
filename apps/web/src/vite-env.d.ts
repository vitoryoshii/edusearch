/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL pública da API FastAPI (ex.: http://localhost:8000). */
  readonly VITE_API_BASE_URL?: string;
  /** "mock" (padrão, dados de demonstração) ou "api". */
  readonly VITE_DATA_SOURCE?: "mock" | "api";
  /** URL do projeto Supabase (ex.: https://<ref>.supabase.co). Pública. */
  readonly VITE_SUPABASE_URL?: string;
  /** Chave PUBLICÁVEL do Supabase (sb_publishable_… ou anon). Nunca a service_role. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Client ID OAuth (Web) do Google — público. NUNCA o Client Secret. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
