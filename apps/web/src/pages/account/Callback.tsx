import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AlertIcon, Spinner, buttonClasses } from "@edusearch/ui";
import { useAuth } from "../../app/auth";
import { useSession } from "../../app/session";
import { AuthShell } from "../../components/AuthShell";
import { FAILURE_MESSAGES, type AuthFailure } from "../../lib/auth/oauth";

/**
 * Retorno do Google OAuth (via Supabase): /auth/callback?code=…&s=…
 *
 * 1. Valida a intenção de login gravada antes do redirecionamento.
 * 2. Troca o código pela sessão (PKCE).
 * 3. Encerra a sessão de demonstração da aba (sem migrar dados fictícios).
 * 4. Remove o código da barra de endereços e segue para a conta.
 */
export default function AuthCallback() {
  const { completeCallback } = useAuth();
  const { signOut: endDemo } = useSession();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  // Lê a URL uma única vez: depois ela é limpa.
  const initial = useRef({ search: window.location.search, hash: window.location.hash });

  useEffect(() => {
    let active = true;
    const { search, hash } = initial.current;
    // Tira código/erro da barra de endereços (e do histórico) imediatamente.
    window.history.replaceState(window.history.state, "", window.location.pathname);
    completeCallback(search, hash).then((result) => {
      if (!active) return;
      if (result.ok) {
        endDemo();
        navigate(result.next, { replace: true });
      } else {
        setFailure(result.failure);
      }
    });
    return () => {
      active = false;
    };
  }, [completeCallback, endDemo, navigate]);

  if (!failure) {
    return (
      <AuthShell>
        <div role="status" className="flex flex-col items-center gap-4 py-10 text-center">
          <Spinner className="h-8 w-8 text-link" />
          <p className="font-semibold text-fg-strong">Concluindo seu login…</p>
          <p className="text-sm text-fg-muted">Estamos validando o retorno do Google com segurança.</p>
        </div>
      </AuthShell>
    );
  }

  const msg = FAILURE_MESSAGES[failure];
  return (
    <AuthShell>
      <div role="alert" data-failure={failure}>
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger-text">
          <AlertIcon className="h-6 w-6" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-fg-strong">{msg.title}</h1>
        <p className="mt-2 leading-relaxed text-fg-muted">{msg.description}</p>
      </div>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        {failure !== "disabled" && (
          <Link to="/entrar" replace className={buttonClasses({ size: "lg" })}>
            Tentar novamente
          </Link>
        )}
        <Link to="/perfil-de-acesso" className={buttonClasses({ variant: "secondary", size: "lg" })}>
          Explorar a demonstração
        </Link>
      </div>
    </AuthShell>
  );
}
