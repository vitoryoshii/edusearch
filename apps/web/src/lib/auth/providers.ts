import { AUTH_CONFIG } from "./config";

/**
 * Provedores de autenticação exibidos nas telas de entrada.
 *
 * Google (Supabase Auth): implementado em src/app/auth.tsx, ativo somente
 * quando VITE_AUTH_GOOGLE_ENABLED=true e as variáveis públicas do Supabase
 * estão configuradas (ambiente restrito de testes). Na versão pública, o botão
 * continua desabilitado e o app funciona apenas como demonstração.
 *
 * Configuração manual (Google Cloud e Supabase): docs/frontend/auth-integration.md
 */
export const AUTH_PROVIDERS = {
  google: {
    available: AUTH_CONFIG.enabled,
    statusMessage: AUTH_CONFIG.enabled
      ? "Acesso real em fase de testes: somente contas autorizadas pela equipe."
      : "O acesso com Google estará disponível após a integração.",
  },
} as const;
