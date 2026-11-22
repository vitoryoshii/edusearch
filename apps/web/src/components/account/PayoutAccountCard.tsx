import { useState, type FormEvent } from "react";
import { Badge, Button, Card, InfoIcon, Input, useToast } from "@edusearch/ui";
import { QueryContent } from "../QueryContent";
import { describeError } from "../../lib/api/client";
import { usePayoutAccountQuery, useSavePayoutAccountMutation } from "../../lib/query/hooks";

/**
 * Recebimentos do professor (Fase 5): subconta na AbacatePay para o split automático (85%).
 * O CPF/CNPJ vai SÓ ao gateway (pela API); a EduSearch guarda apenas os 4 últimos dígitos.
 * Sem split habilitado na conta, nada é cadastrado nem simulado.
 */
export function PayoutAccountCard() {
  const toast = useToast();
  const account = usePayoutAccountQuery();
  const save = useSavePayoutAccountMutation();
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { legal_name: name.trim(), tax_id: taxId },
      {
        onSuccess: () => {
          setTaxId("");
          toast({ tone: "success", title: "Conta de recebimento cadastrada" });
        },
        onError: (err) => toast({ tone: "error", title: "Não foi possível cadastrar", description: describeError(err) }),
      },
    );
  };

  return (
    <Card className="space-y-4" data-testid="payout-card">
      <QueryContent query={account} loading="spinner" loadingLabel="Carregando recebimentos…">
        {(a) =>
          a.status === "split_unavailable" ? (
            <div className="flex items-start gap-3 text-sm" data-testid="payout-unavailable">
              <InfoIcon className="mt-0.5 h-5 w-5 shrink-0 text-link" />
              <p>
                O repasse automático para professores ainda não está habilitado. Os pagamentos das suas aulas ficam registrados
                em Pagamentos, com a sua parte (85%) calculada; nenhum repasse é feito por enquanto.
              </p>
            </div>
          ) : a.status === "active" ? (
            <div className="space-y-2 text-sm" data-testid="payout-active">
              <Badge tone="success">Conta de recebimento ativa</Badge>
              <p className="text-fg">
                Documento terminado em <strong>{a.tax_id_last4}</strong>
                {a.environment === "sandbox" ? " (ambiente de testes)" : ""}.
              </p>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit} data-testid="payout-form">
              <p className="text-sm text-fg-muted">
                Para receber 85% de cada aula direto na sua conta, cadastre o titular. O documento é enviado só ao gateway de
                pagamento; guardamos apenas os 4 últimos dígitos.
              </p>
              <Input label="Nome completo ou razão social" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={100} autoComplete="name" />
              <Input label="CPF ou CNPJ" value={taxId} onChange={(e) => setTaxId(e.target.value)} required inputMode="numeric" autoComplete="off" maxLength={18} />
              <Button type="submit" loading={save.isPending} disabled={name.trim().length < 3 || taxId.replace(/\D/g, "").length < 11}>
                Cadastrar conta de recebimento
              </Button>
            </form>
          )
        }
      </QueryContent>
    </Card>
  );
}
