import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, ErrorState, LoadingState } from "@edusearch/ui";

type Request = (path: string, init?: RequestInit) => Promise<Response>;
type Row = Record<string, unknown>;
type Overview = {
  counts: Record<string, number>;
  jobs: Row[];
  decisions: Row[];
  contestations: Row[];
  validator_failures: Row[];
};

const COUNT_LABELS: Record<string, string> = {
  processing: "Em processamento",
  failed_jobs: "Falhas do motor",
  pending_external: "Aguardando fonte oficial",
  under_review: "Em revisão humana",
  auto_approved: "Aprovações automáticas",
  pending_documents: "Documentos em quarentena",
  open_contestations: "Contestações abertas",
  legacy_unpublished: "Aprovados legados despublicados",
};
const DECISION_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "primary"> = {
  approved: "success",
  pending_external: "warning",
  changes_requested: "danger",
  manual_review: "primary",
  rejected: "danger",
  upheld: "neutral",
};
const when = (value: unknown) => (typeof value === "string" ? new Date(value).toLocaleString("pt-BR") : "—");
// Revisão humana nunca aprova: somente reprocessar, pedir correção, não aprovar ou manter.
const RESOLUTIONS = [
  ["reprocess", "Reprocessar"],
  ["request_changes", "Pedir correção"],
  ["reject", "Não aprovar"],
  ["uphold", "Manter decisão"],
] as const;

/** Monitoramento do Trust Engine. Atuação humana é excepcional (auditoria e contestações). */
export function TrustMonitor({ request }: { request: Request }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [action, setAction] = useState<{ kind: "resolve" | "reprocess"; id: string; resolution?: string } | null>(null);
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void request("/v1/admin/trust", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) {
          setError(r.status === 403 ? "Você não possui permissão para este módulo." : "Não foi possível carregar os dados.");
          return;
        }
        setData((await r.json()) as Overview);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Não foi possível carregar os dados.");
      });
    return () => controller.abort();
  }, [request, refresh]);

  const openTeacher = useCallback(
    async (teacherId: unknown) => {
      const r = await request(`/v1/admin/trust/teachers/${String(teacherId)}`);
      if (r.ok) setDetail((await r.json()) as Row);
      else setError("Não foi possível abrir o dossiê.");
    },
    [request],
  );

  const run = async () => {
    if (!action || busy || justification.trim().length < 3) return;
    setBusy(true);
    try {
      const path =
        action.kind === "resolve" ? `/v1/admin/trust/contestations/${action.id}/resolve` : `/v1/admin/trust/teachers/${action.id}/reprocess`;
      const body = action.kind === "resolve" ? { resolution: action.resolution, justification } : { justification };
      const r = await request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        setError(r.status === 403 ? "Você não possui permissão para esta ação." : "A ação não foi concluída.");
        return;
      }
      setAction(null);
      setJustification("");
      setDetail(null);
      setRefresh((v) => v + 1);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState title="Dados indisponíveis" description={error} />;
  if (!data) return <LoadingState label="Carregando Trust Engine" />;
  return (
    <div className="trust" data-testid="trust-monitor">
      <div className="metrics">
        {Object.entries(data.counts).map(([key, value]) => (
          <Card key={key}>
            <small>{COUNT_LABELS[key] ?? key}</small>
            <strong>{value}</strong>
          </Card>
        ))}
      </div>

      <h2>Contestações</h2>
      <Table
        rows={data.contestations}
        columns={["teacher_name", "status", "reason", "resolution", "created_at"]}
        render={(row) => (
          <>
            <Button size="sm" variant="secondary" onClick={() => void openTeacher(row.teacher_id)}>Evidências</Button>
            {row.status === "open" &&
              RESOLUTIONS.map(([value, label]) => (
                <Button key={value} size="sm" variant="secondary" onClick={() => setAction({ kind: "resolve", id: String(row.id), resolution: value })}>
                  {label}
                </Button>
              ))}
          </>
        )}
      />

      <h2>Processamento e falhas</h2>
      <Table
        rows={data.jobs}
        columns={["teacher_name", "status", "attempts", "error_code", "created_at"]}
        render={(row) => (
          <>
            <Button size="sm" variant="secondary" onClick={() => void openTeacher(row.teacher_id)}>Evidências</Button>
            {row.status === "failed" && (
              <Button size="sm" variant="secondary" onClick={() => setAction({ kind: "reprocess", id: String(row.teacher_id) })}>Reprocessar</Button>
            )}
          </>
        )}
      />

      <h2>Falhas de validadores (30 dias)</h2>
      <Table rows={data.validator_failures} columns={["validator", "requirement", "result", "reason_code", "occurrences"]} />

      <h2>Histórico de decisões</h2>
      <Table
        rows={data.decisions}
        columns={["teacher_name", "decision", "actor_kind", "rules_version", "decided_at"]}
        render={(row) => <Button size="sm" variant="secondary" onClick={() => void openTeacher(row.teacher_id)}>Evidências</Button>}
      />

      {detail && <Dossier detail={detail} onClose={() => setDetail(null)} onReprocess={() => setAction({ kind: "reprocess", id: String(detail.teacher_id) })} />}
      {action && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Confirmar ação do Trust Engine">
          <Card>
            <h2>{action.kind === "reprocess" ? "Reprocessar validação" : RESOLUTIONS.find(([v]) => v === action.resolution)?.[1]}</h2>
            <p>A justificativa fica registrada na auditoria. A revisão humana não aprova credenciamentos.</p>
            <textarea value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Justificativa obrigatória" minLength={3} />
            <Button onClick={() => void run()} disabled={busy || justification.trim().length < 3}>{busy ? "Enviando…" : "Confirmar"}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setAction(null)}>Cancelar</Button>
          </Card>
        </div>
      )}
    </div>
  );
}

function Table({ rows, columns, render }: { rows: Row[]; columns: string[]; render?: (row: Row) => React.ReactNode }) {
  if (!rows.length) return <Card><p>Nenhum registro.</p></Card>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => <th key={c}>{c.replaceAll("_", " ")}</th>)}
            {render && <th>Ações</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(row.id ?? i)}>
              {columns.map((c) => (
                <td key={c}>
                  {c === "decision" ? (
                    <Badge tone={DECISION_TONE[String(row[c])] ?? "neutral"}>{String(row[c])}</Badge>
                  ) : c.endsWith("_at") ? (
                    when(row[c])
                  ) : (
                    String(row[c] ?? "—")
                  )}
                </td>
              ))}
              {render && <td className="actions">{render(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dossier({ detail, onClose, onReprocess }: { detail: Row; onClose: () => void; onReprocess: () => void }) {
  const jobs = (detail.jobs as Row[]) ?? [];
  const evidence = (jobs[0]?.evidence as Row[]) ?? [];
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Dossiê de credenciamento">
      <Card className="dossier">
        <h2>{String(detail.teacher_name)} — {String(detail.status)}</h2>
        <p>{String(detail.qualification ?? "")} · {String(detail.institution ?? "")}</p>
        <h3>Documentos (sem conteúdo nem link)</h3>
        <Table rows={(detail.documents as Row[]) ?? []} columns={["kind", "version", "status", "inspection_status", "detected_content_type", "signature_present", "sha256_prefix"]} />
        <h3>Evidências da última execução</h3>
        <Table rows={evidence} columns={["requirement", "mandatory", "result", "source", "reason_code", "observed_at"]} />
        <h3>Decisões</h3>
        <Table rows={(detail.decisions as Row[]) ?? []} columns={["decision", "actor_kind", "justification", "decided_at"]} />
        {detail.status === "pending_external" && <Button variant="secondary" onClick={onReprocess}>Reprocessar</Button>}
        <Button variant="secondary" onClick={onClose}>Fechar</Button>
      </Card>
    </div>
  );
}
