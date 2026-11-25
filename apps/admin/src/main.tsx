import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, Card, ErrorState, LoadingState } from "@edusearch/ui";
import "@fontsource-variable/inter";
import { AdminAuthProvider, useAdminAuth } from "./auth";
import "./styles.css";

const api = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
function Login() {
  const { renderGoogle } = useAdminAuth(); const slot = useRef<HTMLDivElement>(null); const [error, setError] = useState(false);
  useEffect(() => { if (slot.current) void renderGoogle(slot.current).catch(() => setError(true)); }, [renderGoogle]);
  return <main className="gate"><Card><p>EduSearch Admin</p><h1>Acesso administrativo</h1><p>Entre com sua conta Google autorizada. A permissão é conferida no servidor.</p><div ref={slot} className="google-slot" />{error && <ErrorState title="Login indisponível" description="Não foi possível carregar o Google. Atualize a página e tente novamente." />}</Card></main>;
}
function Dashboard() {
  const { signOut } = useAdminAuth(); const [data, setData] = useState<Record<string, number>>({});
  useEffect(() => { void fetch(`${api}/v1/admin/dashboard`).then(() => undefined); }, []);
  return <main className="shell"><aside><strong>EduSearch Admin</strong><nav aria-label="Navegação administrativa"><a href="#overview">Visão geral</a><a href="#teachers">Professores</a></nav><Button variant="secondary" onClick={() => void signOut()}>Sair</Button></aside><section><header><p>Central de operações</p><h1 id="overview">Visão geral</h1><span>Dados reais são carregados por endpoints protegidos.</span></header><Card><h2>Sessão autorizada</h2><p>O dashboard completo será exibido conforme as permissões administrativas persistidas.</p></Card><div className="metrics">{Object.entries(data).map(([key, value]) => <Card key={key}><small>{key}</small><strong>{value}</strong></Card>)}</div></section></main>;
}
function Protected() {
  const { status } = useAdminAuth();
  if (status === "loading" || status === "checking") return <LoadingState label="Validando acesso administrativo" />;
  if (status === "signed_out") return <Login />;
  if (status === "forbidden") return <main className="gate"><ErrorState title="Acesso restrito" description="Sua conta foi autenticada, mas não possui uma função administrativa ativa." /></main>;
  if (status === "error") return <main className="gate"><ErrorState title="Não foi possível validar o acesso" description="Tente novamente. Nenhum acesso é concedido enquanto a validação falhar." /></main>;
  return <Dashboard />;
}
createRoot(document.getElementById("root")!).render(<StrictMode><AdminAuthProvider><Protected /></AdminAuthProvider></StrictMode>);
