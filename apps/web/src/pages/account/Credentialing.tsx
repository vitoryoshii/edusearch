import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CheckCircleIcon,
  Checkbox,
  Input,
  Select,
  ShieldIcon,
  Textarea,
  buttonClasses,
  useToast,
} from "@edusearch/ui";
import { hasRole, useServerMe } from "../../app/account";
import { PageHeader } from "../../components/PageHeader";
import { ApiError, describeError } from "../../lib/api/client";
import {
  credentialingApi,
  type DocumentKind,
  type Progress,
  type Verification,
  type VerificationPayload,
} from "../../lib/api/credentialing";
import {
  RESULT_META,
  STATUS_META,
  TEACHER_TERMS_VERSION,
  canEdit,
  hasRequiredDocuments,
  journeySteps,
  reasonText,
  requirementLabel,
  validateFile,
} from "../../lib/credentialing";
import { useAccountUid } from "../../lib/query/hooks";
import { queryKeys } from "../../lib/query/keys";

const QUALIFICATIONS = [
  { value: "graduated", label: "Graduado(a)" },
  { value: "specialist", label: "Especialista / pós-graduado(a)" },
  { value: "university_student", label: "Estudante universitário(a)" },
  { value: "tutor", label: "Tutor(a) / monitor(a)" },
] as const;

const DOCUMENTS: { kind: DocumentKind; label: string; hint: string; required: boolean }[] = [
  { kind: "identity", label: "Documento de identidade", hint: "RG, CNH ou passaporte. PDF, PNG ou JPEG, até 10 MiB.", required: true },
  { kind: "academic_proof", label: "Diploma, certificado ou comprovante de matrícula", hint: "PDF sem senha, PNG ou JPEG, até 10 MiB.", required: true },
  { kind: "curriculum", label: "Currículo (opcional)", hint: "PDF, até 10 MiB.", required: false },
];

function notFound(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

/** Jornada de credenciamento do professor: dados, documentos, validação, resultado e contestação. */
export default function Credentialing() {
  const me = useServerMe();
  const uid = useAccountUid();
  const isTeacher = hasRole(me, "teacher");
  const verification = useQuery({
    queryKey: queryKeys.credential(uid),
    queryFn: ({ signal }) => credentialingApi.get(signal).catch((e) => (notFound(e) ? null : Promise.reject(e))),
    enabled: !!uid && isTeacher,
  });
  const progress = useQuery({
    queryKey: queryKeys.credentialProgress(uid),
    queryFn: ({ signal }) => credentialingApi.progress(signal).catch((e) => (notFound(e) ? null : Promise.reject(e))),
    enabled: !!uid && isTeacher,
    // Atualiza enquanto a validação automática está na fila; sem percentuais estimados.
    refetchInterval: (q) => ((q.state.data as Progress | null | undefined)?.processing ? 15_000 : false),
  });
  if (!me) return null;
  if (!isTeacher) return <Navigate to="/conta" replace />;

  const status = verification.data?.status ?? null;
  const documents = progress.data?.documents ?? [];
  const steps = journeySteps(status, hasRequiredDocuments(documents));
  const meta = status ? STATUS_META[status] : STATUS_META.draft;

  return (
    <>
      <PageHeader
        eyebrow="Professor"
        title="Credenciamento"
        description="Validamos sua identidade e formação antes de publicar seu perfil. Seus documentos ficam privados e nunca aparecem no perfil público."
      />
      <div className="space-y-6" data-testid="credentialing" data-status={status ?? "none"}>
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <ShieldIcon className="h-6 w-6 text-primary" />
            <h2 className="font-semibold text-fg-strong">Situação</h2>
            <Badge tone={meta.tone} data-testid="credential-status">{status ? meta.label : "Não iniciado"}</Badge>
            {progress.data?.processing && <Badge tone="primary">Validação na fila</Badge>}
          </div>
          <p className="mt-2 text-sm text-fg">{meta.description}</p>
          {progress.data?.review_reason && status !== "approved" && (
            <p className="mt-1 text-sm text-fg-muted">{reasonText(progress.data.review_reason)}</p>
          )}
          <ol className="mt-4 grid gap-2 sm:grid-cols-4" aria-label="Etapas do credenciamento">
            {steps.map((s, i) => (
              <li key={s.key} className="flex items-center gap-2 text-sm" data-done={s.done}>
                {s.done ? (
                  <CheckCircleIcon className="h-5 w-5 text-success" />
                ) : (
                  <span className="grid h-5 w-5 place-items-center rounded-full border border-line text-xs text-fg-muted">{i + 1}</span>
                )}
                <span className={s.done ? "text-fg-strong" : "text-fg-muted"}>{s.label}</span>
              </li>
            ))}
          </ol>
        </Card>

        {verification.isError && <Card><p className="text-sm text-danger">{describeError(verification.error)}</p></Card>}

        {canEdit(status) && !verification.isLoading && (
          <DossierForm initial={verification.data ?? null} uid={uid} />
        )}
        {status !== null && canEdit(status) && <DocumentsCard uid={uid} documents={documents} />}
        {status !== null && canEdit(status) && (
          <SubmitCard uid={uid} ready={hasRequiredDocuments(documents)} />
        )}
        {progress.data && progress.data.evidence.length > 0 && <EvidenceCard progress={progress.data} />}
        {progress.data && <ContestCard uid={uid} progress={progress.data} />}
      </div>
    </>
  );
}

function useRefresh(uid: string) {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.credential(uid) }),
      client.invalidateQueries({ queryKey: queryKeys.credentialProgress(uid) }),
      client.invalidateQueries({ queryKey: queryKeys.me(uid) }),
    ]);
}

function DossierForm({ initial, uid }: { initial: Verification | null; uid: string }) {
  const toast = useToast();
  const refresh = useRefresh(uid);
  const [form, setForm] = useState({
    qualification_kind: initial?.qualification_kind ?? "graduated",
    birth_date: "",
    institution: initial?.institution ?? "",
    qualification: initial?.qualification ?? "",
    professional_experience: "",
    curriculum_summary: "",
    financial_tax_id_kind: "cpf" as "cpf" | "cnpj",
    financial_tax_id_last4: "",
    terms: false,
  });
  const save = useMutation({
    mutationFn: (body: VerificationPayload) => credentialingApi.save(body),
    onSuccess: async () => {
      toast({ tone: "success", title: "Dados salvos", description: "Agora envie seus documentos." });
      await refresh();
    },
    onError: (e) => toast({ tone: "error", title: "Não foi possível salvar", description: describeError(e) }),
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      qualification_kind: form.qualification_kind,
      birth_date: form.birth_date,
      institution: form.institution,
      qualification: form.qualification,
      professional_experience: form.professional_experience,
      curriculum_summary: form.curriculum_summary,
      financial_tax_id_kind: form.financial_tax_id_kind,
      financial_tax_id_last4: form.financial_tax_id_last4,
      terms_version: TEACHER_TERMS_VERSION,
    });
  };
  return (
    <Card aria-labelledby="dados-titulo">
      <form onSubmit={onSubmit} data-testid="dossier-form">
      <h2 id="dados-titulo" className="font-semibold text-fg-strong">Dados profissionais e formação</h2>
      <p className="mt-1 text-sm text-fg-muted">
        {initial ? "Por segurança, dados sensíveis não são exibidos de volta: preencha-os novamente para atualizar." : "Usados somente para validar seu credenciamento."}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Select label="Formação" required options={QUALIFICATIONS} value={form.qualification_kind} onChange={set("qualification_kind")} />
        <Input label="Data de nascimento" type="date" required value={form.birth_date} onChange={set("birth_date")} />
        <Input label="Instituição de ensino" required minLength={2} maxLength={160} value={form.institution} onChange={set("institution")} />
        <Input label="Curso / titulação" required minLength={2} maxLength={200} value={form.qualification} onChange={set("qualification")} />
        <Textarea
          className="sm:col-span-2"
          label="Experiência profissional"
          required
          minLength={10}
          maxLength={2000}
          value={form.professional_experience}
          onChange={set("professional_experience")}
        />
        <Textarea
          className="sm:col-span-2"
          label="Resumo do currículo"
          required
          minLength={10}
          maxLength={4000}
          value={form.curriculum_summary}
          onChange={set("curriculum_summary")}
        />
        <Select
          label="Documento fiscal"
          options={[{ value: "cpf", label: "CPF" }, { value: "cnpj", label: "CNPJ" }]}
          value={form.financial_tax_id_kind}
          onChange={set("financial_tax_id_kind")}
        />
        <Input
          label="Últimos 4 dígitos"
          hint="Não comprova identidade; serve apenas para conferência."
          required
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          value={form.financial_tax_id_last4}
          onChange={set("financial_tax_id_last4")}
        />
      </div>
      <Checkbox
        className="mt-4"
        required
        checked={form.terms}
        onChange={(e) => setForm((f) => ({ ...f, terms: e.target.checked }))}
        label={`Declaro que as informações são verdadeiras e aceito os termos profissionais (versão ${TEACHER_TERMS_VERSION}).`}
      />
      <div className="mt-4">
        <Button type="submit" loading={save.isPending} disabled={!form.terms}>Salvar dados</Button>
      </div>
      </form>
    </Card>
  );
}

function DocumentsCard({ uid, documents }: { uid: string; documents: Progress["documents"] }) {
  const toast = useToast();
  const refresh = useRefresh(uid);
  const [busy, setBusy] = useState<DocumentKind | null>(null);
  const upload = async (kind: DocumentKind, file: File | undefined) => {
    if (!file) return;
    const invalid = validateFile(file);
    if (invalid) {
      toast({ tone: "error", title: "Arquivo não aceito", description: invalid });
      return;
    }
    setBusy(kind);
    try {
      await credentialingApi.upload(uid, kind, file);
      toast({ tone: "success", title: "Documento verificado e registrado" });
      await refresh();
    } catch (e) {
      toast({ tone: "error", title: "Documento não registrado", description: e instanceof ApiError ? describeError(e) : (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card aria-labelledby="docs-titulo" data-testid="documents-card">
      <h2 id="docs-titulo" className="font-semibold text-fg-strong">Documentos</h2>
      <p className="mt-1 text-sm text-fg-muted">Conferimos o conteúdo real de cada arquivo (tipo, integridade e duplicidade). Eles ficam em área privada.</p>
      <ul className="mt-4 divide-y divide-line">
        {DOCUMENTS.map((d) => {
          const latest = documents.filter((x) => x.kind === d.kind).at(-1);
          return (
            <li key={d.kind} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" data-kind={d.kind}>
              <div className="min-w-0">
                <p className="font-medium text-fg-strong">{d.label}</p>
                <p className="text-sm text-fg-muted">{d.hint}</p>
                {latest?.status === "rejected" && (
                  <p className="text-sm text-danger">Recusado: {reasonText(latest.review_reason) || "envie um novo arquivo."}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {latest && latest.status !== "rejected" && (
                  <Badge tone={latest.inspection_status === "passed" ? "success" : "warning"}>
                    {latest.inspection_status === "passed" ? `Verificado (v${latest.version})` : "Verificação pendente"}
                  </Badge>
                )}
                <label className={buttonClasses({ variant: "secondary", size: "sm", className: "cursor-pointer focus-within:ring-2 focus-within:ring-primary" })}>
                  {busy === d.kind ? "Enviando…" : latest ? "Reenviar" : "Enviar arquivo"}
                  <input
                    type="file"
                    className="sr-only"
                    accept="application/pdf,image/png,image/jpeg"
                    disabled={busy !== null}
                    data-testid={`upload-${d.kind}`}
                    onChange={(e) => {
                      void upload(d.kind, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function SubmitCard({ uid, ready }: { uid: string; ready: boolean }) {
  const toast = useToast();
  const refresh = useRefresh(uid);
  const submit = useMutation({
    mutationFn: () => credentialingApi.submit(),
    onSuccess: async () => {
      toast({ tone: "success", title: "Enviado para validação", description: "Você receberá um e-mail com o resultado." });
      await refresh();
    },
    onError: (e) => toast({ tone: "error", title: "Não foi possível enviar", description: describeError(e) }),
  });
  return (
    <Card>
      <h2 className="font-semibold text-fg-strong">Enviar para validação</h2>
      <p className="mt-1 text-sm text-fg-muted">
        {ready ? "Tudo pronto. A validação é automática e só aprova quando todos os requisitos forem comprovados." : "Envie a identidade e o comprovante acadêmico para continuar."}
      </p>
      <Button className="mt-4" onClick={() => submit.mutate()} loading={submit.isPending} disabled={!ready} data-testid="submit-credential">
        Enviar para validação
      </Button>
    </Card>
  );
}

function EvidenceCard({ progress }: { progress: Progress }) {
  const mandatory = progress.evidence.filter((e) => e.mandatory);
  const other = progress.evidence.filter((e) => !e.mandatory);
  const row = (e: Progress["evidence"][number]) => (
    <li key={e.requirement} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between" data-requirement={e.requirement} data-result={e.result}>
      <div className="min-w-0">
        <p className="font-medium text-fg-strong">{requirementLabel(e.requirement)}</p>
        {e.result !== "passed" && <p className="text-sm text-fg-muted">{reasonText(e.reason_code)}</p>}
      </div>
      <Badge tone={RESULT_META[e.result].tone}>{RESULT_META[e.result].label}</Badge>
    </li>
  );
  return (
    <Card aria-labelledby="evid-titulo" data-testid="evidence-card">
      <h2 id="evid-titulo" className="font-semibold text-fg-strong">Resultado das verificações</h2>
      {progress.decision && (
        <p className="mt-1 text-sm text-fg-muted">
          Decisão {progress.decision.actor_kind === "service" ? "automática" : "de revisão humana"} em{" "}
          {new Date(progress.decision.decided_at).toLocaleString("pt-BR")}.
        </p>
      )}
      <h3 className="mt-4 text-sm font-semibold text-fg-strong">Obrigatórios</h3>
      <ul className="divide-y divide-line">{mandatory.map(row)}</ul>
      {other.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold text-fg-strong">Informativos</h3>
          <ul className="divide-y divide-line">{other.map(row)}</ul>
        </>
      )}
    </Card>
  );
}

function ContestCard({ uid, progress }: { uid: string; progress: Progress }) {
  const toast = useToast();
  const refresh = useRefresh(uid);
  const [reason, setReason] = useState("");
  const contest = useMutation({
    mutationFn: () => credentialingApi.contest(reason),
    onSuccess: async () => {
      toast({ tone: "success", title: "Contestação enviada", description: "A equipe vai revisar e você será avisado." });
      setReason("");
      await refresh();
    },
    onError: (e) => toast({ tone: "error", title: "Não foi possível contestar", description: describeError(e) }),
  });
  if (progress.contestation?.status === "open") {
    return (
      <Card data-testid="contest-open">
        <h2 className="font-semibold text-fg-strong">Contestação em análise</h2>
        <p className="mt-1 text-sm text-fg-muted">Enviada em {new Date(progress.contestation.created_at).toLocaleString("pt-BR")}.</p>
      </Card>
    );
  }
  if (!progress.decision?.contestable) return null;
  return (
    <Card>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); contest.mutate(); }} data-testid="contest-form">
      <h2 className="font-semibold text-fg-strong">Discorda da decisão?</h2>
      <p className="mt-1 text-sm text-fg-muted">Explique o motivo. Uma pessoa da equipe revisará; a revisão não dispensa a comprovação dos requisitos.</p>
      <Textarea className="mt-3" label="Motivo da contestação" required minLength={20} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button className="mt-3" type="submit" variant="secondary" loading={contest.isPending} disabled={reason.trim().length < 20}>
        Enviar contestação
      </Button>
      </form>
    </Card>
  );
}
