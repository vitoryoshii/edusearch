import { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { LoadingState, useToast } from "@edusearch/ui";
import { describeError } from "../../lib/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { schedulingApi } from "../../lib/api/scheduling";
import { setCalendarConnection, useAccountUid } from "../../lib/query/hooks";
import { FEATURES } from "../../lib/features";
import { parseCalendarReturn } from "../../lib/scheduling";

/**
 * Retornos já tratados nesta aba (pela query inteira): o código do Google é de uso único e o
 * StrictMode roda efeitos duas vezes — sem isto, haveria dois envios ou dois avisos.
 */
const handled = new Set<string>();

/**
 * Retorno do consentimento do Google (URI cadastrada: /conta/agenda/google/retorno).
 *
 * O código vai direto para a API JUNTO com o token da sessão: a API confere que o `state` foi
 * emitido para ESTA conta antes de trocar o código. Nenhum token do Google fica no navegador; o
 * código é apagado da barra de endereço na hora.
 */
export default function GoogleCalendarReturn() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const uid = useAccountUid();

  useEffect(() => {
    if (FEATURES.scheduling === "off") return;
    if (handled.has(location.search)) return;
    handled.add(location.search);
    const result = parseCalendarReturn(location.search);
    // Remove ?code&state do histórico antes de qualquer outra coisa.
    window.history.replaceState(window.history.state, "", location.pathname);
    const done = () => navigate("/conta/agenda", { replace: true });

    if (result.kind === "denied") {
      toast({ tone: "info", title: "Google Agenda não conectada", description: "A permissão não foi concedida." });
      done();
      return;
    }
    if (result.kind === "invalid") {
      done();
      return;
    }
    schedulingApi
      .completeAuthorization({ code: result.code, state: result.state })
      .then((connection) => {
        if (uid) setCalendarConnection(qc, uid, connection); // painel/agenda já mostram "Conectada"
      })
      .then(() => toast({ tone: "success", title: "Google Agenda conectada", description: "As próximas aulas terão link do Google Meet." }))
      .catch((e: unknown) => toast({ tone: "error", title: "Não foi possível conectar", description: describeError(e) }))
      .finally(done);
  }, [location.pathname, location.search, navigate, toast]);

  if (FEATURES.scheduling === "off") return <Navigate to="/conta" replace />;
  return <LoadingState label="Conectando sua Google Agenda…" className="min-h-[50dvh]" />;
}
