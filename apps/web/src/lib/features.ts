import { AUTH_CONFIG } from "./auth/config";
import { legalPublished } from "./legal";
import { resolveFeatures } from "./stages";

/**
 * Estágios efetivos deste build (ver src/lib/stages.ts).
 *
 *   VITE_STAGE_GOOGLE_AUTH   off | testing | production   (padrão: testing, se configurado)
 *   VITE_STAGE_EMAIL_AUTH    off | testing | production   (padrão: off)
 *   VITE_STAGE_EMAIL_SIGNUP  off | testing | production   (padrão: off)
 *   VITE_STAGE_PROFILE_PERSISTENCE off | testing | production (padrão: off; exige login real)
 *
 *   VITE_STAGE_PAYMENTS      off | sandbox | production   (padrão: off; exige a agenda real)
 *
 * Demonstração: sempre disponível e identificada (pagamentos dela são sempre simulados).
 */
export const FEATURES = resolveFeatures(import.meta.env, {
  supabaseReady: AUTH_CONFIG.supabaseReady,
  googleReady: AUTH_CONFIG.googleReady,
  legalPublished,
});
