/**
 * Estágios por recurso (regra pura, testada em scripts/unit.test.mjs).
 *
 * Cada recurso tem o próprio estágio — não existe um indicador único que
 * libere autenticação, cadastros, pagamentos e documentos ao mesmo tempo.
 *
 * - "off":        recurso indisponível (a interface explica, sem simular).
 * - "testing":    disponível só para contas autorizadas (ambiente de testes).
 * - "production": aprovado para o público.
 *
 * Travas que o frontend consegue verificar:
 * - sem configuração técnica (Supabase/Google), o recurso fica "off";
 * - "production" exige documentos jurídicos publicados; sem eles, o estágio
 *   cai para "testing" (e o aviso de fase de testes continua visível).
 * Itens que só o backend/operação comprovam (SMTP, confirmação de e-mail,
 * rate limiting, controle de admissão) estão no checklist de publicação.
 */
export type Stage = "off" | "testing" | "production";

export function parseStage(value: unknown, fallback: Stage): Stage {
  return value === "off" || value === "testing" || value === "production" ? value : fallback;
}

export type FeatureEnv = {
  VITE_STAGE_GOOGLE_AUTH?: string;
  VITE_STAGE_EMAIL_AUTH?: string;
  VITE_STAGE_EMAIL_SIGNUP?: string;
  VITE_STAGE_PROFILE_PERSISTENCE?: string;
  VITE_STAGE_SCHEDULING?: string;
  VITE_STAGE_PAYMENTS?: string;
};

export type PaymentsStage = "off" | "sandbox" | "production";

export function parsePaymentsStage(value: unknown): PaymentsStage {
  return value === "sandbox" || value === "production" ? value : "off";
}

export type FeatureInputs = {
  supabaseReady: boolean;
  googleReady: boolean;
  legalPublished: boolean;
};

export type Features = {
  /** Login com Google (GIS + Supabase). Padrão "testing" quando configurado. */
  googleAuth: Stage;
  /** Entrar com e-mail e senha (Supabase). Padrão "off". */
  emailAuth: Stage;
  /** Criar conta com e-mail e senha. Padrão "off"; nunca acima do estágio do login por e-mail. */
  emailSignup: Stage;
  /**
   * Persistência real do perfil/onboarding na API (Fase 2.6B). Padrão "off" (deployments
   * públicos). Exige login real; sem ele fica "off". "off" = prévia sem envio (comportamento
   * anterior); "testing"/"production" = papel e cadastro salvos e lidos do servidor.
   */
  profilePersistence: Stage;
  /**
   * Agenda real (Fase 3A): Google Agenda/Meet do professor, disponibilidade e aulas de TESTE.
   * Padrão "off". Exige a persistência real do perfil. Nunca passa de "testing" nesta fase
   * (aulas comerciais e pagamentos seguem desligados). A API tem o próprio interruptor.
   */
  scheduling: "off" | "testing";
  /**
   * Pagamentos Pix reais (Fase 5): "off" (padrão) | "sandbox" (Modo Teste da AbacatePay, sem
   * dinheiro real) | "production". Exige a agenda real. "production" exige documentos publicados;
   * sem eles cai para "off" (nunca cobra de verdade sem termos). A flag só mostra a interface: quem
   * decide se cobra é o backend (API_PAYMENTS_STAGE + chave do ambiente correto).
   */
  payments: PaymentsStage;
  /** Há algum login real disponível neste build. */
  realAuth: boolean;
};

const rank: Record<Stage, number> = { off: 0, testing: 1, production: 2 };
const min = (a: Stage, b: Stage): Stage => (rank[a] <= rank[b] ? a : b);
/** "production" só com documentos publicados. */
const guard = (stage: Stage, legalPublished: boolean): Stage => (stage === "production" && !legalPublished ? "testing" : stage);

export function resolveFeatures(env: FeatureEnv, inputs: FeatureInputs): Features {
  const googleAuth = inputs.googleReady ? guard(parseStage(env.VITE_STAGE_GOOGLE_AUTH, "testing"), inputs.legalPublished) : "off";
  const emailAuth = inputs.supabaseReady ? guard(parseStage(env.VITE_STAGE_EMAIL_AUTH, "off"), inputs.legalPublished) : "off";
  const emailSignup = min(guard(parseStage(env.VITE_STAGE_EMAIL_SIGNUP, "off"), inputs.legalPublished), emailAuth);
  const realAuth = googleAuth !== "off" || emailAuth !== "off";
  const profilePersistence = realAuth ? guard(parseStage(env.VITE_STAGE_PROFILE_PERSISTENCE, "off"), inputs.legalPublished) : "off";
  const schedulingStage = profilePersistence !== "off" ? parseStage(env.VITE_STAGE_SCHEDULING, "off") : "off";
  const scheduling = schedulingStage === "off" ? "off" : "testing";
  const paymentsStage = scheduling === "off" ? "off" : parsePaymentsStage(env.VITE_STAGE_PAYMENTS);
  const payments = paymentsStage === "production" && !inputs.legalPublished ? "off" : paymentsStage;
  return {
    googleAuth,
    emailAuth,
    emailSignup,
    profilePersistence,
    scheduling,
    payments,
    realAuth,
  };
}
