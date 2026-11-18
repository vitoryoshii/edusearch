/**
 * Links dos documentos jurídicos PÚBLICOS.
 *
 * Os Termos de Uso e a Política de Privacidade ainda estão em elaboração.
 * Quando forem publicados (ex.: no website https://edusearch.com.br), defina
 * VITE_LEGAL_TERMS_URL e VITE_LEGAL_PRIVACY_URL para exibir os links. Sem as
 * variáveis, a interface informa que os documentos estão em elaboração — e
 * nunca simula aceite.
 */
const httpsUrl = (value: string | undefined) => {
  const v = (value ?? "").trim();
  return /^https:\/\/[^\s"'<>]+$/.test(v) ? v : null;
};

export const LEGAL_LINKS = {
  terms: httpsUrl(import.meta.env.VITE_LEGAL_TERMS_URL),
  privacy: httpsUrl(import.meta.env.VITE_LEGAL_PRIVACY_URL),
} as const;

export const legalPublished = Boolean(LEGAL_LINKS.terms && LEGAL_LINKS.privacy);
