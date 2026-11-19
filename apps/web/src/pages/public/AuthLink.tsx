import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { AlertIcon, Button, CheckCircleIcon, PasswordInput, Spinner, buttonClasses } from "@edusearch/ui";
import { useAuth, type EmailResult } from "../../app/auth";
import { useSession } from "../../app/session";
import { EntryFrame } from "../../components/EntryFrame";
import { EMAIL_MESSAGES, PASSWORD_MIN, newPasswordIssue, parseEmailLink, type EmailFailure } from "../../lib/auth/email";
import { AUTH_PROVIDERS } from "../../lib/auth/providers";

// StrictMode monta duas vezes: a troca de cada código acontece uma única vez.
const exchanges = new Map<string, Promise<EmailResult>>();

type Phase = "checking" | "ready" | "done" | "error";

/** Lê o link uma vez, remove o código da barra de endereços e troca pela sessão. */
function useEmailLink() {
  const { email } = useAuth();
  const { signOut: endDemo } = useSession();
  const initial = useRef({ search: window.location.search, hash: window.location.hash });
  const [phase, setPhase] = useState<Phase>("checking");
  const [failure, setFailure] = useState<EmailFailure | null>(null);

  useEffect(() => {
    let active = true;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    if (!AUTH_PROVIDERS.email.available) {
      setFailure("not_available");
      setPhase("error");
      return;
    }
    const link = parseEmailLink(initial.current.search, initial.current.hash);
    if (link.kind !== "code") {
      setFailure(link.kind === "error" ? link.failure : "link_invalid");
      setPhase("error");
      return;
    }
    let run = exchanges.get(link.code);
    if (!run) {
      run = email.exchangeLink(link.code);
      exchanges.set(link.code, run);
    }
    run.then((r) => {
      if (!active) return;
      if (r.ok) {
        endDemo();
        setPhase("ready");
      } else {
        setFailure(r.failure);
        setPhase("error");
      }
    });
    return () => {
      active = false;
    };
  }, [email, endDemo]);

  return { phase, setPhase, failure, setFailure };
}

function Checking({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-6 text-center">
      <Spinner className="h-7 w-7 text-link" />
      <p className="text-sm text-fg">{label}</p>
    </div>
  );
}

function LinkError({ failure }: { failure: EmailFailure }) {
  return (
    <div className="space-y-4" data-email-failure={failure}>
      <p role="alert" className="flex items-start gap-2.5 rounded-card bg-danger-soft px-4 py-3 text-sm text-fg">
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger-text" />
        {EMAIL_MESSAGES[failure]}
      </p>
      <Link to="/" replace className={buttonClasses({ variant: "secondary", shape: "pill", size: "lg", fullWidth: true })}>
        Voltar ao início
      </Link>
    </div>
  );
}

/** /auth/confirmacao — retorno do e-mail de confirmação de cadastro. */
export function EmailConfirmed() {
  const { phase, failure } = useEmailLink();
  return (
    <EntryFrame subtitle="Confirmação de e-mail">
      {phase === "checking" && <Checking label="Confirmando seu e-mail…" />}
      {phase === "error" && failure && <LinkError failure={failure} />}
      {phase === "ready" && (
        <div className="space-y-4" data-testid="email-confirmed">
          <p role="status" className="flex items-start gap-2.5 rounded-card bg-soft px-4 py-3 text-sm text-fg">
            <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-success-text" />
            E-mail confirmado. Sua conta está pronta para continuar o cadastro.
          </p>
          <Link to="/conta" replace className={buttonClasses({ shape: "pill", size: "lg", fullWidth: true })}>
            Continuar
          </Link>
        </div>
      )}
    </EntryFrame>
  );
}

/** /auth/nova-senha — retorno do e-mail de recuperação: define a nova senha. */
export function NewPassword() {
  const { email } = useAuth();
  const navigate = useNavigate();
  const { phase, setPhase, failure, setFailure } = useEmailLink();
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const issue = newPasswordIssue(password);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (issue) return;
    setBusy(true);
    const r = await email.updatePassword(password);
    setBusy(false);
    setPassword("");
    if (r.ok) setPhase("done");
    else setFailure(r.failure);
  };

  return (
    <EntryFrame subtitle="Criar nova senha">
      {phase === "checking" && <Checking label="Validando o link…" />}
      {phase === "error" && failure && <LinkError failure={failure} />}
      {phase === "ready" && (
        <form noValidate onSubmit={submit} className="space-y-4" data-testid="new-password">
          <PasswordInput
            name="password"
            label="Nova senha"
            autoComplete="new-password"
            minLength={PASSWORD_MIN}
            hint={`Pelo menos ${PASSWORD_MIN} caracteres.`}
            required
            value={password}
            error={submitted ? (issue ?? undefined) : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
          {failure && (
            <p role="alert" className="flex items-start gap-2 rounded-card bg-danger-soft px-4 py-3 text-sm text-fg" data-email-failure={failure}>
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger-text" />
              {EMAIL_MESSAGES[failure]}
            </p>
          )}
          <Button type="submit" shape="pill" size="lg" fullWidth loading={busy}>
            Salvar nova senha
          </Button>
        </form>
      )}
      {phase === "done" && (
        <div className="space-y-4" data-testid="password-updated">
          <p role="status" className="flex items-start gap-2.5 rounded-card bg-soft px-4 py-3 text-sm text-fg">
            <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-success-text" />
            Senha atualizada.
          </p>
          <Button shape="pill" size="lg" fullWidth onClick={() => navigate("/conta", { replace: true })}>
            Continuar
          </Button>
        </div>
      )}
    </EntryFrame>
  );
}
