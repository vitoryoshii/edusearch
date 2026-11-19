/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_URL?: string;
}

/** Definido no build (legal-plugin.ts): Termos e Política com status "aprovado". */
declare const __LEGAL_DOCS_APPROVED__: boolean;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
