/**
 * Credenciamento (Trust Engine) — chamadas da conta REAL. Documentos vão direto ao bucket privado
 * do Supabase Storage, na pasta do próprio usuário; a API baixa com o token do titular e inspeciona
 * o conteúdo real antes de registrar. Nenhuma URL pública é gerada.
 */
import { getSupabase } from "../auth/supabase";
import { extensionFor, type CredentialStatus, type EvidenceResult } from "../credentialing";
import { apiRequest } from "./client";

export type QualificationKind = "graduated" | "specialist" | "university_student" | "tutor";
export type DocumentKind = "identity" | "academic_proof" | "curriculum";

export type VerificationPayload = {
  qualification_kind: QualificationKind;
  birth_date: string;
  institution: string;
  qualification: string;
  professional_experience: string;
  curriculum_summary: string;
  financial_tax_id_kind: "cpf" | "cnpj";
  financial_tax_id_last4: string;
  terms_version: string;
};

export type VerificationDocument = {
  document_kind: DocumentKind;
  version: number;
  status: "quarantined" | "accepted" | "rejected";
  uploaded_at: string;
};

export type Verification = {
  status: CredentialStatus;
  qualification_kind: QualificationKind;
  institution: string;
  qualification: string;
  submitted_at: string | null;
  review_reason: string | null;
  terms_version: string;
  terms_accepted_at: string;
  documents: VerificationDocument[];
};

export type Evidence = {
  validator: string;
  requirement: string;
  mandatory: boolean;
  result: EvidenceResult;
  source: string;
  reason_code: string;
  observed_at: string;
};

export type Progress = {
  status: CredentialStatus;
  review_reason: string | null;
  submitted_at: string | null;
  processing: boolean;
  decision: {
    id: string;
    decision: string;
    reasons: string[];
    actor_kind: "service" | "human";
    rules_version: string | null;
    decided_at: string;
    contestable: boolean;
  } | null;
  evidence: Evidence[];
  contestation: { status: "open" | "resolved"; created_at: string; resolution: string | null; resolved_at: string | null } | null;
  documents: {
    kind: DocumentKind;
    version: number;
    status: "quarantined" | "accepted" | "rejected";
    inspection_status: "pending" | "passed" | "failed";
    inspection_code: string | null;
    review_reason: string | null;
    uploaded_at: string;
  }[];
};

const BUCKET = "teacher-verification";

export const credentialingApi = {
  get: (signal?: AbortSignal) => apiRequest<Verification>("/v1/me/teacher-verification", { signal }),
  save: (body: VerificationPayload) => apiRequest<Verification>("/v1/me/teacher-verification", { method: "PUT", body }),
  progress: (signal?: AbortSignal) => apiRequest<Progress>("/v1/me/teacher-verification/progress", { signal }),
  submit: () => apiRequest<Verification>("/v1/me/teacher-verification/submit", { method: "POST" }),
  contest: (reason: string) =>
    apiRequest<Progress>("/v1/me/teacher-verification/contest", { method: "POST", body: { reason } }),
  async upload(userId: string, kind: DocumentKind, file: File): Promise<VerificationDocument> {
    const path = `${userId}/${crypto.randomUUID()}.${extensionFor(file.type)}`;
    const supabase = await getSupabase();
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error("Não foi possível enviar o arquivo. Tente novamente.");
    return apiRequest<VerificationDocument>("/v1/me/teacher-verification/documents", {
      method: "POST",
      body: { document_kind: kind, storage_path: path },
      timeoutMs: 30_000,
    });
  },
};
