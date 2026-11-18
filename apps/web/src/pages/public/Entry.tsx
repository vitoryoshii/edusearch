import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AlertIcon, ArrowRightIcon, Avatar, Logo, buttonClasses } from "@edusearch/ui";
import { readRoleIntent, useAuth } from "../../app/auth";
import { homeFor, useSession } from "../../app/session";
import { EntryBackdrop } from "../../components/EntryBackdrop";
import { GoogleSignIn } from "../../components/GoogleSignIn";
import { FAILURE_MESSAGES } from "../../lib/auth/oauth";
import { firstNameOf } from "../../lib/auth/profile";
import { LEGAL_LINKS, legalPublished } from "../../lib/legal";
import { nextAccountStep } from "../../lib/onboarding";

/**
 * Entrada única do EduSearch (substitui boas-vindas, login e cadastro).
 *
 * - Método principal: botão OFICIAL do Google Identity Services (GIS + Supabase).
 *   Não existe login por e-mail e senha.
 * - Ação secundária: demonstração com dados fictícios, sem login.
 * - /entrar e /cadastro redirecionam para cá, preservando um `next` seguro.
 */
export default function Entry() {
  const { status, profile, notice } = useAuth();
  const { session } = useSession();
  const [params] = useSearchParams();
  const next = params.get("next") ?? undefined;

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <EntryBackdrop />

      <main id="conteudo-principal" className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-20 sm:py-24">
        <div className="w-full max-w-[22rem] animate-slide-up">
          <div className="text-center">
            <Logo className="mx-auto h-12 sm:h-14" />
            <h1 className="mt-6 text-xl font-semibold tracking-tight text-balance text-fg-strong sm:text-2xl">
              Conectando alunos e professores.
            </h1>
          </div>

          <div className="mt-10 space-y-4">
            {notice === "session_expired" && <ExpiredNotice />}
            {status === "signedIn" && profile ? <ContinueAccount /> : <GoogleSignIn next={next} />}
          </div>

          <div className="mt-4">
            <Link
              to={session ? homeFor(session.role) : "/perfil-de-acesso"}
              className={buttonClasses({ variant: "secondary", size: "lg", fullWidth: true })}
              aria-describedby="demo-hint"
            >
              {session ? "Continuar demonstração" : "Explorar demonstração"}
            </Link>
            <p id="demo-hint" className="mt-2 text-center text-xs text-fg-muted">
              Dados fictícios, sem login. Separada da sua conta.
            </p>
          </div>
        </div>
      </main>

      <footer className="relative z-10 px-4 pb-5 text-center text-xs leading-relaxed text-fg-muted">
        {/* Fundo sólido: o texto continua legível sobre as curvas decorativas. */}
        <div className="mx-auto w-fit max-w-full rounded-2xl bg-bg px-4 py-2">
        {legalPublished ? (
          <p>
            <a href={LEGAL_LINKS.terms!} className="underline-offset-4 hover:text-link hover:underline" target="_blank" rel="noreferrer">
              Termos de Uso
            </a>
            <span aria-hidden="true"> · </span>
            <a href={LEGAL_LINKS.privacy!} className="underline-offset-4 hover:text-link hover:underline" target="_blank" rel="noreferrer">
              Política de Privacidade
            </a>
          </p>
        ) : (
          <p data-testid="legal-pending">Termos de Uso e Política de Privacidade em elaboração.</p>
        )}
        <p className="mt-1">EduSearch · HackBrasil 2026 · Acesso real em fase de testes</p>
        </div>
      </footer>
    </div>
  );
}

/** Sessão real já ativa: segue para a próxima etapa disponível. */
function ContinueAccount() {
  const { profile, signOut } = useAuth();
  const [leaving, setLeaving] = useState(false);
  if (!profile) return null;
  const to = nextAccountStep(readRoleIntent(profile.id));

  return (
    <div className="space-y-3" data-testid="continue-account">
      <Link to={to} className={buttonClasses({ size: "lg", fullWidth: true, className: "justify-between gap-3 pl-2" })}>
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={profile.displayName} src={profile.avatarUrl ?? undefined} size="sm" />
          <span className="truncate">Continuar como {firstNameOf(profile)}</span>
        </span>
        <ArrowRightIcon className="h-5 w-5 shrink-0" />
      </Link>
      <p className="text-center text-xs text-fg-muted">
        Não é você?{" "}
        <button
          type="button"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            void signOut().finally(() => setLeaving(false));
          }}
          className="min-h-11 font-semibold text-link underline-offset-4 hover:underline disabled:opacity-60"
        >
          Sair da conta
        </button>
      </p>
    </div>
  );
}

function ExpiredNotice() {
  const msg = FAILURE_MESSAGES.session_expired;
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-card bg-warning-soft px-4 py-3 text-sm">
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" />
      <span>
        <strong className="block font-semibold text-fg-strong">{msg.title}</strong>
        <span className="text-fg">{msg.description}</span>
      </span>
    </div>
  );
}
