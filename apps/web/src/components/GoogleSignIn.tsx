import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AlertIcon, Badge, Button, GoogleButton, Skeleton, Spinner } from "@edusearch/ui";
import { useAuth } from "../app/auth";
import { useAppTheme } from "../app/theme";
import { useSession } from "../app/session";
import { AUTH_CONFIG } from "../lib/auth/config";
import { initializeGis, loadGis, setCredentialListener } from "../lib/auth/gis";
import { ACCOUNT_HOME, FAILURE_MESSAGES, sanitizeNext, type AuthFailure } from "../lib/auth/oauth";
import { AUTH_PROVIDERS } from "../lib/auth/providers";

type Phase = "loading" | "ready" | "signing";

/**
 * "Continuar com o Google" com o botão OFICIAL do Google Identity Services.
 *
 * Fluxo (sem sair do domínio do app):
 *   nonce (Web Crypto) → GIS recebe o hash → usuário escolhe a conta no seletor
 *   do Google → ID token volta a esta página → Supabase valida (signInWithIdToken)
 *   com o nonce original → sessão criada → /conta.
 *
 * Cancelar o seletor do Google não dispara callback: a tela simplesmente
 * continua como estava, sem erro. Sem configuração (versão pública), mostra o
 * botão no estado desabilitado do design system.
 */
export function GoogleSignIn({ next = ACCOUNT_HOME }: { next?: string }) {
  if (!AUTH_PROVIDERS.google.available) {
    return (
      <div className="mt-8">
        <GoogleButton available={false} aria-describedby="google-status" data-testid="google-signin-disabled" />
        <p id="google-status" className="mt-2 text-center text-xs text-fg-muted">
          {AUTH_PROVIDERS.google.statusMessage}
        </p>
      </div>
    );
  }
  return <GisButton next={sanitizeNext(next)} />;
}

function GisButton({ next }: { next: string }) {
  const { status, prepareNonce, signInWithGoogleCredential } = useAuth();
  const { signOut: endDemo } = useSession();
  const { resolved } = useAppTheme();
  const navigate = useNavigate();
  const slot = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  // Muda a cada nova tentativa: gera novo nonce e redesenha o botão.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const stopListening = setCredentialListener((response) => {
      if (!active) return; // resposta atrasada após desmontagem: descartada
      setPhase("signing");
      setFailure(null);
      signInWithGoogleCredential(response.credential).then((result) => {
        if (!active) return;
        if (result.ok) {
          endDemo(); // a conta real não herda a sessão fictícia da aba
          navigate(next, { replace: true });
          return;
        }
        setFailure(result.failure);
        setAttempt((n) => n + 1);
      });
    });

    (async () => {
      try {
        const gis = await loadGis();
        const hashedNonce = await prepareNonce();
        if (!active || !slot.current) return;
        initializeGis(gis, { clientId: AUTH_CONFIG.googleClientId, hashedNonce });
        const width = Math.round(Math.min(400, Math.max(220, slot.current.parentElement?.clientWidth ?? 320)));
        slot.current.replaceChildren();
        gis.renderButton(slot.current, {
          type: "standard",
          theme: resolved === "dark" ? "filled_black" : "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          width,
          locale: "pt-BR",
        });
        setPhase("ready");
      } catch {
        if (!active) return;
        setFailure("gis_unavailable");
        setPhase("ready");
      }
    })();

    return () => {
      active = false;
      stopListening();
    };
  }, [attempt, resolved, next, prepareNonce, signInWithGoogleCredential, endDemo, navigate]);

  if (status === "signedIn") {
    return (
      <div className="mt-8 rounded-card border border-line bg-surface-muted p-4 text-sm" role="status">
        <p className="text-fg">Você já está conectado com o Google.</p>
        <Link to={next} className="mt-1 inline-flex min-h-11 items-center font-semibold text-link underline-offset-4 hover:underline">
          Ir para minha conta
        </Link>
      </div>
    );
  }

  const msg = failure ? FAILURE_MESSAGES[failure] : null;

  return (
    <div className="mt-8" data-auth-phase={phase} data-failure={failure ?? undefined}>
      <p className="mb-3 flex justify-center">
        <Badge tone="primary">Acesso real · ambiente de testes</Badge>
      </p>

      <div className="relative flex min-h-11 justify-center">
        {/* Contêiner do botão oficial (iframe do Google). */}
        <div ref={slot} data-testid="google-signin" className={phase === "ready" && failure !== "gis_unavailable" ? "w-full" : "hidden"} />
        {phase === "loading" && <Skeleton className="h-11 w-full" />}
        {phase === "signing" && (
          <div role="status" className="flex h-11 w-full items-center justify-center gap-2.5 rounded-control border border-line text-sm font-medium text-fg">
            <Spinner className="h-4 w-4 text-link" />
            Entrando com sua conta Google…
          </div>
        )}
        {failure === "gis_unavailable" && (
          <Button variant="secondary" fullWidth onClick={() => { setFailure(null); setPhase("loading"); setAttempt((n) => n + 1); }}>
            Tentar carregar novamente
          </Button>
        )}
      </div>

      <p id="google-status" className="mt-2 text-center text-xs text-fg-muted">
        {AUTH_PROVIDERS.google.statusMessage}
      </p>

      {msg && (
        <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-card bg-danger-soft px-4 py-3 text-sm">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger-text" />
          <span>
            <strong className="block font-semibold text-fg-strong">{msg.title}</strong>
            <span className="text-fg">{msg.description}</span>
          </span>
        </div>
      )}
    </div>
  );
}
