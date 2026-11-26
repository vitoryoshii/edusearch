/**
 * Credenciamento do professor (Trust Engine). Regras puras de apresentação — testadas em
 * scripts/unit.test.mjs. Nada aqui inventa progresso: o estado vem das evidências do servidor.
 */

export type CredentialStatus =
  | "draft"
  | "submitted"
  | "pending_external"
  | "under_review"
  | "changes_requested"
  | "approved"
  | "rejected"
  | "suspended";

export type EvidenceResult = "passed" | "failed" | "unavailable" | "inconclusive";

export const TEACHER_TERMS_VERSION = "teacher-terms-2026-11";
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_DOCUMENT_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;

export const STATUS_META: Record<
  CredentialStatus,
  { label: string; tone: "neutral" | "primary" | "success" | "warning" | "danger"; description: string }
> = {
  draft: { label: "Rascunho", tone: "neutral", description: "Preencha seus dados, envie os documentos e submeta para validação." },
  submitted: { label: "Em validação", tone: "primary", description: "Seus dados estão na fila de validação automática. Você pode sair desta página." },
  pending_external: {
    label: "Aguardando fonte oficial",
    tone: "warning",
    description:
      "Seus documentos foram verificados, mas identidade e formação só podem ser confirmadas por uma fonte oficial que ainda não está integrada. Seu perfil não é publicado enquanto isso.",
  },
  under_review: { label: "Em revisão", tone: "warning", description: "Uma pessoa da equipe vai revisar a decisão. Você será avisado por e-mail." },
  changes_requested: { label: "Correção necessária", tone: "danger", description: "Corrija os itens indicados abaixo e envie novamente." },
  approved: { label: "Credenciado", tone: "success", description: "Credenciamento aprovado. Seu perfil pode aparecer nas buscas e receber reservas." },
  rejected: { label: "Não aprovado", tone: "danger", description: "O credenciamento não foi aprovado após revisão." },
  suspended: { label: "Suspenso", tone: "danger", description: "O credenciamento está suspenso. Fale com o suporte." },
};

export const RESULT_META: Record<EvidenceResult, { label: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  passed: { label: "Comprovado", tone: "success" },
  failed: { label: "Precisa de correção", tone: "danger" },
  unavailable: { label: "Fonte indisponível", tone: "warning" },
  inconclusive: { label: "Informativo", tone: "neutral" },
};

const REQUIREMENT_LABELS: Record<string, string> = {
  "registration.terms_current": "Termos profissionais aceitos",
  "registration.profile_complete": "Dados profissionais completos",
  "registration.adult": "Maioridade declarada",
  "registration.tax_id_declared": "CPF/CNPJ informado (não comprova identidade)",
  "document.identity_valid": "Documento de identidade",
  "document.academic_valid": "Comprovante acadêmico",
  "document.curriculum_valid": "Currículo",
  "identity.verified": "Identidade confirmada em fonte oficial",
  "academic.issuer_verified": "Formação confirmada com a instituição emissora",
  "academic.digital_signature": "Assinatura digital do comprovante",
  "curriculum.experience_described": "Experiência descrita",
  "curriculum.summary_described": "Resumo do currículo",
  "fraud.no_duplicate_documents": "Documentos exclusivos da sua conta",
  "fraud.submission_velocity": "Frequência de envios",
};

const REASON_TEXT: Record<string, string> = {
  "registration.terms_outdated": "Aceite a versão atual dos termos profissionais.",
  "registration.profile_incomplete": "Complete instituição, formação, experiência e resumo do currículo.",
  "registration.underage": "É necessário ter 18 anos ou mais.",
  "document.identity_missing": "Envie um documento de identidade.",
  "document.academic_proof_missing": "Envie diploma, certificado ou comprovante de matrícula.",
  "document.inspection_unavailable": "Não foi possível verificar o arquivo. Envie-o novamente.",
  "document.content_mismatch": "O conteúdo do arquivo não corresponde ao tipo informado.",
  "document.reused_across_kinds": "Use arquivos diferentes para identidade e comprovante acadêmico.",
  "document.curriculum_not_provided": "Currículo opcional não enviado.",
  "identity.trusted_source_unavailable": "A confirmação em fonte oficial ainda não está disponível.",
  "identity.provider_error": "A fonte oficial não respondeu; tentaremos novamente.",
  "academic.trusted_source_unavailable": "A confirmação com a instituição ainda não está disponível.",
  "academic.provider_error": "A instituição não respondeu; tentaremos novamente.",
  "academic.signature_present_not_validated": "Assinatura digital encontrada (ainda não validada).",
  "academic.signature_absent": "Sem assinatura digital no comprovante.",
  "fraud.document_reused_by_other_account": "Um documento já foi usado por outra conta e será revisado pela equipe.",
  "fraud.high_submission_velocity": "Muitos envios em pouco tempo.",
  "curriculum.experience_brief": "Descreva sua experiência com mais detalhes (opcional).",
  "curriculum.summary_brief": "Detalhe melhor o resumo do currículo (opcional).",
  "verification.human_review": "Decisão tomada em revisão humana.",
  "verification.all_requirements_proven": "Todos os requisitos obrigatórios foram comprovados.",
  "verification.contestation_open": "Contestação aberta.",
  "verification.decision_upheld": "A decisão anterior foi mantida após revisão.",
  "verification.changes_requested_by_review": "A revisão pediu correções no dossiê.",
  "verification.rejected_after_review": "Não aprovado após revisão.",
  "verification.reprocess_requested": "Validação reiniciada.",
};

export function requirementLabel(code: string): string {
  return REQUIREMENT_LABELS[code] ?? code;
}

export function reasonText(code: string | null | undefined): string {
  if (!code) return "";
  return REASON_TEXT[code] ?? "Consulte os detalhes abaixo.";
}

/** Quando o professor pode editar dados e documentos. */
export function canEdit(status: CredentialStatus | null): boolean {
  return status === null || status === "draft" || status === "changes_requested";
}

export function hasRequiredDocuments(documents: { kind: string; status: string }[]): boolean {
  const ok = (kind: string) => documents.some((d) => d.kind === kind && d.status !== "rejected");
  return ok("identity") && ok("academic_proof");
}

/** Verifica o arquivo no navegador (o servidor confere o conteúdo real de novo). */
export function validateFile(file: { size: number; type: string }): string | null {
  if (file.size <= 0) return "O arquivo está vazio.";
  if (file.size > MAX_DOCUMENT_BYTES) return "O arquivo excede 10 MiB.";
  if (!(ACCEPTED_DOCUMENT_TYPES as readonly string[]).includes(file.type)) return "Envie PDF, PNG ou JPEG.";
  return null;
}

export function extensionFor(type: string): "pdf" | "png" | "jpg" {
  return type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : "jpg";
}

/** Etapas visíveis da jornada, derivadas apenas do estado real. */
export function journeySteps(status: CredentialStatus | null, documentsReady: boolean) {
  const submittedOrLater = status !== null && status !== "draft" && status !== "changes_requested";
  return [
    { key: "dados", label: "Dados e termos", done: status !== null },
    { key: "documentos", label: "Documentos", done: documentsReady || submittedOrLater },
    { key: "validacao", label: "Validação", done: status === "approved" || status === "rejected" || status === "pending_external" || status === "under_review" },
    { key: "resultado", label: "Resultado", done: status === "approved" },
  ];
}
