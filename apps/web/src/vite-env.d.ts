/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL pública da API FastAPI (ex.: http://localhost:8000). */
  readonly VITE_API_BASE_URL?: string;
  /** "mock" (padrão, dados de demonstração) ou "api". */
  readonly VITE_DATA_SOURCE?: "mock" | "api";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
