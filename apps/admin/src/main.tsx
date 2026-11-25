import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import { Card, ErrorState, LoadingState } from "@edusearch/ui";
import "@fontsource-variable/inter";
import "./styles.css";

const api = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
type Dashboard = Record<string, number>;

async function adminFetch<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${api}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(response.status === 403 ? "Acesso administrativo não autorizado." : "Não foi possível carregar os dados.");
  return response.json() as Promise<T>;
}
function App() {
  const [state, setState] = useState<"loading" | "denied" | "ready" | "error">("loading");
  const [data, setData] = useState<Dashboard>({});
  useEffect(() => { void (async () => {
    const session = (await supabase?.auth.getSession())?.data.session;
    if (!session) { setState("denied"); return; }
    try { setData(await adminFetch<Dashboard>("/v1/admin/dashboard", session.access_token)); setState("ready"); }
    catch (error) { setState(error instanceof Error && error.message.includes("não autorizado") ? "denied" : "error"); }
  })(); }, []);
  if (state === "loading") return <LoadingState label="Validando acesso administrativo" />;
  if (state === "denied") return <main className="gate"><ErrorState title="Acesso restrito" description="Esta conta não possui uma função administrativa ativa." /></main>;
  if (state === "error") return <main className="gate"><ErrorState title="Dados indisponíveis" description="Tente novamente em alguns instantes." /></main>;
  return <main className="shell"><aside><strong>EduSearch Admin</strong><nav aria-label="Navegação administrativa"><a href="#overview">Visão geral</a><a href="#teachers">Professores</a><a aria-disabled="true">Financeiro</a><a aria-disabled="true">Notificações</a><a aria-disabled="true">Auditoria</a></nav></aside><section><header><p>Central de operações</p><h1 id="overview">Visão geral</h1><span>Dados reais do backend · últimos 30 dias</span></header><div className="metrics">{Object.entries(data).map(([key, value]) => <Card key={key}><small>{key.replaceAll("_", " ")}</small><strong>{typeof value === "number" ? value.toLocaleString("pt-BR") : String(value)}</strong></Card>)}</div><Card className="notice"><h2>Operações protegidas</h2><p>Aprovações, suspensão e dados financeiros dependem de permissões verificadas no servidor. Recursos sem contrato operacional permanecem indisponíveis.</p></Card></section></main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
