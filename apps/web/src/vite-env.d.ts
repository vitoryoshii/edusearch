/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL pública da API FastAPI (ex.: http://localhost:8000). */
  readonly VITE_API_BASE_URL?: string;
  /** "mock" (padrão, dados de demonstração) ou "api". */
  /** Sem efeito desde a Fase 4B: a demonstração usa sempre dados fictícios. */
  readonly VITE_DATA_SOURCE?: "mock" | "api";
  /** URL do projeto Supabase (ex.: https://<ref>.supabase.co). Pública. */
  readonly VITE_SUPABASE_URL?: string;
  /** Chave PUBLICÁVEL do Supabase (sb_publishable_… ou anon). Nunca a service_role. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Client ID OAuth (Web) do Google — público. NUNCA o Client Secret. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Estágio do login Google: off | testing | production (padrão testing, se configurado). */
  readonly VITE_STAGE_GOOGLE_AUTH?: string;
  /** Estágio do login por e-mail e senha: off | testing | production (padrão off). */
  readonly VITE_STAGE_EMAIL_AUTH?: string;
  /** Estágio do cadastro por e-mail: off | testing | production (padrão off). */
  readonly VITE_STAGE_EMAIL_SIGNUP?: string;
  /** Persistência real do perfil na API (off | testing | production). Padrão: off. */
  readonly VITE_STAGE_PROFILE_PERSISTENCE?: string;
  /** off (padrão) | testing — agenda real com Google Agenda/Meet (Fase 3A). */
  readonly VITE_STAGE_SCHEDULING?: string;
  /** Fase 5: off | sandbox | production (padrão off). O backend tem o próprio interruptor. */
  readonly VITE_STAGE_PAYMENTS?: string;
  /** URL pública (https) dos Termos de Uso — definir só quando publicados. */
  readonly VITE_LEGAL_TERMS_URL?: string;
  /** URL pública (https) da Política de Privacidade — definir só quando publicada. */
  readonly VITE_LEGAL_PRIVACY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
