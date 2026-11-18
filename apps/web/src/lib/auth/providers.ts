import { AUTH_CONFIG } from "./config";

/**
 * Provedores de autenticação exibidos nas telas de entrada.
 *
 * Google: Google Identity Services + Supabase Auth (src/app/auth.tsx e
 * src/components/GoogleSignIn.tsx). Ativo somente quando as três variáveis
 * públicas estão configuradas (ambiente restrito de testes). Sem elas, o botão
 * fica desabilitado e o app funciona apenas como demonstração.
 *
 * Configuração: docs/frontend/auth-integration.md
 */
export const AUTH_PROVIDERS = {
  google: {
    available: AUTH_CONFIG.enabled,
    statusMessage: AUTH_CONFIG.enabled
      ? "Fase de testes: somente contas autorizadas pela equipe EduSearch."
      : "O acesso com Google estará disponível após a integração.",
  },
} as const;
