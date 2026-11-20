import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AlertIcon, Button, GoogleButton, Skeleton, Spinner } from "@edusearch/ui";
import { useAuth } from "../app/auth";
import { useAppTheme } from "../app/theme";
import { useSession } from "../app/session";
import { AUTH_CONFIG } from "../lib/auth/config";
import { initializeGis, loadGis, setCredentialListener, type GisId } from "../lib/auth/gis";
import { ACCOUNT_HOME, FAILURE_MESSAGES, sanitizeNext, type AuthFailure } from "../lib/auth/oauth";
import { AUTH_PROVIDERS } from "../lib/auth/providers";

type Phase = "loading" | "ready" | "signing";

/**
 * Medidas comuns dos CTAs da tela de acesso (Google e e-mail).
 *
 * O botão oficial do GIS (size "large") tem 40px de altura e largura fixa em px, definida
 * ao desenhar. Os demais CTAs seguem essa medida: 40px visíveis, largura total do mesmo
 * contêiner. O pseudo-elemento estende a área de toque para 44px sem mudar o visual.
 * Use com <Button size="sm"> (min-h-9 não conflita com h-10).
 */
export const AUTH_CTA_CLASS =
  "relative h-10 w-full text-sm before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-['']";

/** Largura do botão do GIS: a do contêiner de ações, nos limites aceitos pelo Google (px inteiros). */
const gisWidth = (box: HTMLElement | null | undefined) => Math.floor(Math.min(400, Math.max(220, box?.clientWidth ?? 320)));

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
      <div className="flex min-h-11 w-full flex-col justify-center">
        {/* h-10!: o GoogleButton tem h-11 fixo; aqui ele segue a medida dos CTAs da entrada. */}
        <GoogleButton
          available={false}
          shape="pill"
          aria-describedby="google-status"
          data-testid="google-signin-disabled"
          className="h-10! before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-['']"
        />
        {AUTH_PROVIDERS.google.statusMessage && (
          <p id="google-status" className="mt-2 text-center text-xs text-fg-muted">
            {AUTH_PROVIDERS.google.statusMessage}
          </p>
        )}
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

  /*
   * O resultado de um login em andamento pertence ao COMPONENTE, não a uma
   * renderização do botão. Redesenhar o botão (troca de tema, nova tentativa)
   * não pode descartar a resposta do Supabase — só a desmontagem descarta.
   */
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    return setCredentialListener((response) => {
      if (!mounted.current) return; // resposta atrasada após desmontagem: descartada
      setPhase("signing");
      setFailure(null);
      signInWithGoogleCredential(response.credential).then((result) => {
        if (!mounted.current) return;
        if (result.ok) {
          endDemo(); // a conta real não herda a sessão fictícia da aba
          navigate(next, { replace: true });
          return;
        }
        setFailure(result.failure);
        setPhase("ready");
        setAttempt((n) => n + 1); // novo nonce para a próxima tentativa
      });
    });
  }, [signInWithGoogleCredential, endDemo, navigate, next]);

  // GIS já inicializado (para redesenhar só o botão ao mudar a largura) e a última largura usada.
  const gisRef = useRef<GisId | null>(null);
  const drawnWidth = useRef(0);

  /** Desenha o botão oficial com a largura atual do contêiner de ações. */
  const draw = useCallback(
    (gis: GisId) => {
      const el = slot.current;
      if (!el) return;
      const width = gisWidth(el.parentElement);
      el.replaceChildren();
      gis.renderButton(el, {
        type: "standard",
        /*
         * Tema escuro: "outline_dark" (fundo escuro + contorno discreto), o par do "outline"
         * claro — mesmo desenho do CTA de e-mail (fundo da superfície + borda). O
         * "filled_black" deixava o botão personalizado ("Continuar como …") com contorno
         * claro de alto contraste, destoando do e-mail.
         */
        theme: resolved === "dark" ? "outline_dark" : "outline",
        size: "large",
        text: "continue_with",
        /*
         * Formato oficial do GIS; nenhum CSS é aplicado ao iframe do Google.
         * LIMITAÇÃO (verificada no GIS real, nov/2026): só o botão GENÉRICO respeita "pill".
         * O botão PERSONALIZADO ("Continuar como <nome>", com avatar e e-mail), exibido a quem
         * já tem sessão Google e usou este Client ID, é sempre um retângulo de cantos
         * arredondados, qualquer que seja o "shape". O tema é respeitado nos dois.
         */
        shape: "pill",
        logo_alignment: "left",
        width,
        locale: "pt-BR",
      });
      drawnWidth.current = width;
    },
    [resolved],
  );

  // Inicializa e desenha o botão oficial: primeira carga, nova tentativa ou troca de tema.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const gis = await loadGis();
        const hashedNonce = await prepareNonce();
        if (!active || !slot.current) return;
        initializeGis(gis, { clientId: AUTH_CONFIG.googleClientId, hashedNonce });
        gisRef.current = gis;
        draw(gis);
        // Se um login estiver em andamento, continua mostrando "Entrando…".
        setPhase((p) => (p === "signing" ? p : "ready"));
      } catch {
        if (!active) return;
        setFailure("gis_unavailable");
        setPhase("ready");
      }
    })();

    return () => {
      active = false;
    };
  }, [attempt, prepareNonce, draw]);

  /*
   * O iframe do Google tem largura FIXA em px. Quando o contêiner muda (rotação, teclado,
   * barra de endereço, janela standalone/PWA que assenta o viewport depois da 1ª pintura),
   * redesenha só o botão — sem novo initialize nem novo nonce — para continuar com a
   * mesma largura do botão de e-mail.
   */
  useEffect(() => {
    const box = slot.current?.parentElement;
    if (!box || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const gis = gisRef.current;
        if (gis && gisWidth(box) !== drawnWidth.current) draw(gis);
      });
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [draw]);

  if (status === "signedIn") {
    return (
      <div className="rounded-card border border-line bg-surface-muted p-4 text-sm" role="status">
        <p className="text-fg">Você já está conectado com o Google.</p>
        <Link to={next} className="mt-1 inline-flex min-h-11 items-center font-semibold text-link underline-offset-4 hover:underline">
          Ir para minha conta
        </Link>
      </div>
    );
  }

  const msg = failure ? FAILURE_MESSAGES[failure] : null;

  return (
    <div data-auth-phase={phase} data-failure={failure ?? undefined}>
      {/* Linha de 44px (iframe do GIS: botão de 40px + 2px de margem) com o CTA centralizado. */}
      <div className="relative flex min-h-11 w-full items-center justify-center">
        {/* Contêiner do botão oficial (iframe do Google). */}
        <div ref={slot} data-testid="google-signin" className={phase === "ready" && failure !== "gis_unavailable" ? "flex w-full justify-center" : "hidden"} />
        {phase === "loading" && <Skeleton className="h-10 w-full rounded-full" />}
        {phase === "signing" && (
          <div role="status" className="flex h-10 w-full items-center justify-center gap-2.5 rounded-full border border-line text-sm font-medium text-fg">
            <Spinner className="h-4 w-4 text-link" />
            Entrando com sua conta Google…
          </div>
        )}
        {failure === "gis_unavailable" && (
          <Button
            variant="secondary"
            shape="pill"
            size="sm"
            className={AUTH_CTA_CLASS}
            onClick={() => { setFailure(null); setPhase("loading"); setAttempt((n) => n + 1); }}
          >
            Tentar carregar novamente
          </Button>
        )}
      </div>

      {AUTH_PROVIDERS.google.statusMessage && (
        <p id="google-status" className="mt-2 text-center text-xs text-fg-muted">
          {AUTH_PROVIDERS.google.statusMessage}
        </p>
      )}

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
