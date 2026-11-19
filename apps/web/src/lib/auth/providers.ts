import { FEATURES } from "../features";

/**
 * Métodos de acesso exibidos na entrada (`/`), conforme o estágio de cada um
 * (src/lib/features.ts). Configuração: docs/frontend/auth-integration.md
 */
const testing = "Fase de testes: somente contas autorizadas.";

export const AUTH_PROVIDERS = {
  google: {
    available: FEATURES.googleAuth !== "off",
    statusMessage:
      FEATURES.googleAuth === "testing" ? testing : FEATURES.googleAuth === "off" ? "O acesso com Google estará disponível em breve." : "",
  },
  email: {
    available: FEATURES.emailAuth !== "off",
    signup: FEATURES.emailSignup !== "off",
    statusMessage:
      FEATURES.emailAuth === "testing" ? testing : FEATURES.emailAuth === "off" ? "O acesso por e-mail estará disponível em breve." : "",
  },
} as const;
