import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AlertIcon, ArrowRightIcon, Avatar, Button, MailIcon, buttonClasses } from "@edusearch/ui";
import { readRoleIntent, useAuth } from "../../app/auth";
import { homeFor, useSession } from "../../app/session";
import { EmailAccess } from "../../components/EmailAccess";
import { EntryFrame } from "../../components/EntryFrame";
import { GoogleSignIn } from "../../components/GoogleSignIn";
import { FAILURE_MESSAGES, sanitizeNext } from "../../lib/auth/oauth";
import { firstNameOf } from "../../lib/auth/profile";
import { AUTH_PROVIDERS } from "../../lib/auth/providers";
import { nextAccountStep } from "../../lib/onboarding";

/**
 * Entrada única do EduSearch.
 * - Principal: botão OFICIAL do Google Identity Services (pílula).
 * - Secundário: "Continuar com e-mail" (Supabase), conforme o estágio do recurso.
 * - Link: "Explorar demonstração" — identificada como dados fictícios.
 * - /entrar e /cadastro redirecionam para cá, preservando um `next` seguro.
 */
export default function Entry() {
  const { status, profile, notice } = useAuth();
  const { session } = useSession();
  const [params] = useSearchParams();
  const next = sanitizeNext(params.get("next") ?? undefined);
  const [emailOpen, setEmailOpen] = useState(false);
  const signedIn = status === "signedIn" && profile;

  return (
    <EntryFrame subtitle={emailOpen && !signedIn ? undefined : "Conectando alunos e professores."}>
      <div className="space-y-3">
        {notice === "session_expired" && <ExpiredNotice />}
        {signedIn ? (
          <ContinueAccount />
        ) : emailOpen ? (
          <EmailAccess next={next} onBack={() => setEmailOpen(false)} />
        ) : (
          <>
            <GoogleSignIn next={next} />
            <EmailButton onOpen={() => setEmailOpen(true)} />
          </>
        )}
      </div>

      {!emailOpen && (
        <p className="mt-8 text-center">
          <Link
            to={session ? homeFor(session.role) : "/perfil-de-acesso"}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-link underline-offset-4 hover:underline"
            aria-describedby="demo-hint"
          >
            {session ? "Continuar demonstração" : "Explorar demonstração"}
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <span id="demo-hint" className="block text-xs text-fg-muted">
            Dados fictícios, sem login.
          </span>
        </p>
      )}
    </EntryFrame>
  );
}

/** Botão secundário. Desligado (com explicação) enquanto o estágio do e-mail for "off". */
function EmailButton({ onOpen }: { onOpen: () => void }) {
  const available = AUTH_PROVIDERS.email.available;
  return (
    <div>
      <Button
        variant="secondary"
        shape="pill"
        size="lg"
        fullWidth
        leftIcon={<MailIcon className="h-5 w-5" />}
        onClick={available ? onOpen : undefined}
        aria-disabled={available ? undefined : true}
        aria-describedby={available ? undefined : "email-status"}
        data-testid="email-open"
        className={available ? undefined : "cursor-not-allowed"}
      >
        Continuar com e-mail
      </Button>
      {!available && (
        <p id="email-status" className="mt-2 text-center text-xs text-fg-muted">
          {AUTH_PROVIDERS.email.statusMessage}
        </p>
      )}
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
      <Link to={to} className={buttonClasses({ size: "lg", fullWidth: true, shape: "pill", className: "justify-between gap-3 pl-2" })}>
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
