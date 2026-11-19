import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { AlertIcon, ArrowLeftIcon, Button, CheckCircleIcon, Input, PasswordInput, SegmentedControl } from "@edusearch/ui";
import { useAuth } from "../app/auth";
import { useSession } from "../app/session";
import {
  EMAIL_MESSAGES,
  GENERIC_SENT,
  PASSWORD_MIN,
  RESEND_COOLDOWN_MS,
  emailIssue,
  newPasswordIssue,
  type EmailFailure,
} from "../lib/auth/email";
import { AUTH_PROVIDERS } from "../lib/auth/providers";

type View = "signin" | "signup" | "reset" | "sent";
type SentKind = keyof typeof GENERIC_SENT;

/**
 * Acesso secundário por e-mail e senha (Supabase Auth), na mesma tela da entrada.
 * - Só aparece quando o estágio do login por e-mail não é "off".
 * - Senha só no estado do formulário (limpa ao trocar de tela); nunca em storage ou log.
 * - Cadastro e recuperação respondem sempre de forma genérica (sem enumerar contas).
 */
export function EmailAccess({ next, onBack }: { next: string; onBack: () => void }) {
  const { email: api } = useAuth();
  const { signOut: endDemo } = useSession();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("signin");
  const [sentKind, setSentKind] = useState<SentKind>("signup");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<EmailFailure | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Relógio só enquanto houver espera para reenviar.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [cooldownUntil]);

  const go = (v: View) => {
    setView(v);
    setPassword(""); // nunca carregar a senha entre telas
    setSubmitted(false);
    setFailure(null);
    window.setTimeout(() => heading.current?.focus(), 0);
  };

  const signup = view === "signup";
  const needsPassword = view === "signin" || view === "signup";
  const errors = {
    email: emailIssue(address),
    password: !needsPassword ? null : signup ? newPasswordIssue(password) : password ? null : "Informe sua senha.",
  };
  const show = (k: keyof typeof errors) => (submitted ? (errors[k] ?? undefined) : undefined);
  const waitSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFailure(null);
    const first = (["email", "password"] as const).find((k) => errors[k]);
    if (first) {
      (form.current?.elements.namedItem(first) as HTMLElement | null)?.focus();
      return;
    }
    setBusy(true);
    const result =
      view === "signin" ? await api.signIn(address, password) : view === "signup" ? await api.signUp(address, password) : await api.requestReset(address);
    if (!mounted.current) return;
    setBusy(false);
    if (!result.ok) {
      setFailure(result.failure);
      return;
    }
    if (view === "signin") {
      setPassword("");
      endDemo(); // a conta real não herda a sessão fictícia da aba
      navigate(next, { replace: true });
      return;
    }
    setSentKind(view === "signup" ? "signup" : "reset");
    setCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
    setNow(Date.now());
    go("sent");
  };

  const resend = async () => {
    if (waitSeconds > 0 || emailIssue(address)) return;
    setBusy(true);
    const result = sentKind === "reset" ? await api.requestReset(address) : await api.resendConfirmation(address);
    if (!mounted.current) return;
    setBusy(false);
    setCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
    setNow(Date.now());
    setFailure(result.ok ? null : result.failure);
    if (result.ok && view !== "sent") {
      setSentKind("resend");
      go("sent");
    }
  };

  const titles: Record<View, string> = {
    signin: "Entrar com e-mail",
    signup: "Criar conta com e-mail",
    reset: "Recuperar senha",
    sent: "Verifique seu e-mail",
  };

  return (
    <section aria-labelledby="email-titulo" data-testid="email-access" data-view={view}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full text-sm font-medium text-fg-muted transition-colors hover:text-link"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar ao Google
        </button>
      </div>

      <h2 id="email-titulo" ref={heading} tabIndex={-1} className="mt-2 text-lg font-semibold text-fg-strong outline-none">
        {titles[view]}
      </h2>

      {(view === "signin" || view === "signup") && AUTH_PROVIDERS.email.signup && (
        <SegmentedControl
          className="mt-4 w-full"
          label="Tipo de acesso"
          size="sm"
          options={[
            { value: "signin", label: "Entrar" },
            { value: "signup", label: "Criar conta" },
          ]}
          value={view}
          onChange={(v) => go(v)}
        />
      )}

      {view === "sent" ? (
        <div className="mt-4 space-y-4" role="status" data-testid="email-sent">
          <p className="flex items-start gap-2.5 rounded-card bg-soft px-4 py-3 text-sm text-fg">
            <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-success-text" />
            <span>{GENERIC_SENT[sentKind]}</span>
          </p>
          <p className="text-xs text-fg-muted">Confira também a caixa de spam. O link vale por tempo limitado e deve ser aberto neste navegador.</p>
          <Button variant="secondary" shape="pill" fullWidth onClick={resend} disabled={waitSeconds > 0} loading={busy}>
            {waitSeconds > 0 ? `Reenviar em ${waitSeconds} s` : "Reenviar e-mail"}
          </Button>
          <Button variant="ghost" shape="pill" fullWidth onClick={() => go("signin")}>
            Voltar para entrar
          </Button>
        </div>
      ) : (
        <form ref={form} noValidate onSubmit={submit} className="mt-4 space-y-4">
          <Input
            name="email"
            type="email"
            label="E-mail"
            autoComplete={signup ? "email" : "username"}
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={address}
            error={show("email")}
            onChange={(e) => setAddress(e.target.value)}
          />
          {needsPassword && (
            <PasswordInput
              name="password"
              label="Senha"
              autoComplete={signup ? "new-password" : "current-password"}
              required
              minLength={signup ? PASSWORD_MIN : undefined}
              hint={signup ? `Pelo menos ${PASSWORD_MIN} caracteres. Evite senhas usadas em outros sites.` : undefined}
              value={password}
              error={show("password")}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          {view === "reset" && (
            <p className="text-sm text-fg-muted">Enviaremos um link para você criar uma nova senha.</p>
          )}

          {failure && (
            <div role="alert" className="flex items-start gap-2 rounded-card bg-danger-soft px-4 py-3 text-sm" data-email-failure={failure}>
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger-text" />
              <span className="text-fg">
                {EMAIL_MESSAGES[failure]}
                {failure === "email_not_confirmed" && (
                  <>
                    {" "}
                    <button type="button" onClick={resend} disabled={waitSeconds > 0} className="font-semibold text-link underline-offset-4 hover:underline disabled:opacity-60">
                      {waitSeconds > 0 ? `Reenviar em ${waitSeconds} s` : "Reenviar confirmação"}
                    </button>
                  </>
                )}
              </span>
            </div>
          )}

          <Button type="submit" shape="pill" size="lg" fullWidth loading={busy}>
            {view === "signin" ? "Entrar" : view === "signup" ? "Criar conta" : "Enviar link"}
          </Button>

          {view === "signin" && (
            <p className="text-center">
              <button type="button" onClick={() => go("reset")} className="min-h-11 text-sm font-medium text-link underline-offset-4 hover:underline">
                Esqueci minha senha
              </button>
            </p>
          )}
          {view === "reset" && (
            <p className="text-center">
              <button type="button" onClick={() => go("signin")} className="min-h-11 text-sm font-medium text-link underline-offset-4 hover:underline">
                Lembrei a senha
              </button>
            </p>
          )}
          {view === "signin" && !AUTH_PROVIDERS.email.signup && (
            <p className="text-center text-xs text-fg-muted">Novos cadastros por e-mail ainda não estão abertos.</p>
          )}
        </form>
      )}

      {AUTH_PROVIDERS.email.statusMessage && <p className="mt-4 text-center text-xs text-fg-muted">{AUTH_PROVIDERS.email.statusMessage}</p>}
    </section>
  );
}
