import { FEATURES } from "../features";

/**
 * Métodos de acesso exibidos na entrada (`/`), conforme o estágio de cada um
 * (src/lib/features.ts). Configuração: docs/frontend/auth-integration.md
 *
 * `statusMessage` só explica recurso indisponível ("off"). O estágio "testing" não
 * exibe aviso fixo na tela de acesso: quem não está autorizado é barrado pelo controle de
 * admissão do servidor (Before User Created Hook) e só então vê o alerta de acesso
 * restrito (FAILURE_MESSAGES.not_allowed em src/lib/auth/oauth.ts).
 */
export const AUTH_PROVIDERS = {
  google: {
    available: FEATURES.googleAuth !== "off",
    statusMessage: FEATURES.googleAuth === "off" ? "O acesso com Google estará disponível em breve." : "",
  },
  email: {
    available: FEATURES.emailAuth !== "off",
    signup: FEATURES.emailSignup !== "off",
    statusMessage: FEATURES.emailAuth === "off" ? "O acesso por e-mail estará disponível em breve." : "",
  },
} as const;
