/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL pública da API FastAPI (ex.: http://localhost:8000). */
  readonly VITE_API_BASE_URL?: string;
  /** "mock" (padrão, dados de demonstração) ou "api". */
  readonly VITE_DATA_SOURCE?: "mock" | "api";
  /** "true" liga o login REAL com Google (somente no ambiente restrito de testes). */
  readonly VITE_AUTH_GOOGLE_ENABLED?: string;
  /** URL do projeto Supabase (ex.: https://<ref>.supabase.co). Pública. */
  readonly VITE_SUPABASE_URL?: string;
  /** Chave PUBLICÁVEL do Supabase (sb_publishable_… ou anon). Nunca a service_role. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
