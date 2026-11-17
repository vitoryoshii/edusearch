import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Badge, Button, Checkbox, CheckIcon, GoogleButton, Input, PasswordInput, cn } from "@edusearch/ui";
import { useSession } from "../../app/session";
import { AuthShell } from "../../components/AuthShell";
import { AUTH_PROVIDERS } from "../../lib/auth/providers";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;

type FieldName = "name" | "email" | "password" | "terms";
type Values = { name: string; email: string; password: string; terms: boolean };
type Errors = Partial<Record<FieldName, string>>;

function validate(v: Values, signup: boolean): Errors {
  const e: Errors = {};
  if (signup && v.name.trim().length < 2) e.name = "Informe seu nome.";
  if (!v.email.trim()) e.email = "Informe seu e-mail.";
  else if (!EMAIL_RE.test(v.email.trim())) e.email = "Confira o e-mail. Exemplo: nome@email.com";
  if (!v.password) e.password = "Informe sua senha.";
  else if (signup && v.password.length < MIN_PASSWORD) e.password = `Use pelo menos ${MIN_PASSWORD} caracteres.`;
  if (signup && !v.terms) e.terms = "Aceite os termos para continuar.";
  return e;
}

/**
 * Login e cadastro em MODO DEMONSTRAÇÃO.
 * - Validação no navegador (ao sair do campo e ao enviar).
 * - Nada é enviado nem armazenado; a senha fica só no estado do formulário
 *   e é descartada ao navegar. Nenhuma conta é criada.
 * - O botão do Google aparece desabilitado até a integração real
 *   (Supabase Auth + Google OAuth, ver src/lib/auth/providers.ts).
 */
function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const signup = mode === "signup";
  const navigate = useNavigate();
  const { setPendingName } = useSession();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Values>({ name: "", email: "", password: "", terms: false });
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const errors = validate(values, signup);
  const visibleError = (f: FieldName) => (touched[f] || submitted ? errors[f] : undefined);
  const errorCount = Object.keys(errors).length;

  const set = <K extends keyof Values>(k: K, v: Values[K]) => setValues((s) => ({ ...s, [k]: v }));
  const blur = (f: FieldName) => () => setTouched((t) => ({ ...t, [f]: true }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const first = (["name", "email", "password", "terms"] as const).find((k) => errors[k]);
    if (first) {
      (formRef.current?.elements.namedItem(first) as HTMLElement | null)?.focus();
      return;
    }
    setSubmitting(true);
    setPendingName(signup ? values.name.trim().split(/\s+/)[0] : null);
    window.setTimeout(() => navigate("/perfil-de-acesso"), 350);
  };

  const passwordOk = values.password.length >= MIN_PASSWORD;

  return (
    <AuthShell>
      <Badge tone="demo">Modo demonstração</Badge>
      <h1 className="mt-4 text-[1.75rem] leading-tight font-semibold tracking-tight text-fg-strong">
        {signup ? "Crie sua conta" : "Entre na sua conta"}
      </h1>
      <p className="mt-2 text-fg-muted">
        {signup
          ? "Leva menos de um minuto para começar a encontrar professores."
          : "Bom ver você de novo. Continue de onde parou."}
      </p>

      <div className="mt-8">
        <GoogleButton available={AUTH_PROVIDERS.google.available} aria-describedby="google-status" />
        <p id="google-status" className="mt-2 text-center text-xs text-fg-muted">
          {AUTH_PROVIDERS.google.statusMessage}
        </p>
      </div>

      <div className="my-6 flex items-center gap-3 text-xs text-fg-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        ou continue com e-mail
        <span className="h-px flex-1 bg-line" />
      </div>

      <form ref={formRef} noValidate onSubmit={onSubmit} className="space-y-5" aria-describedby="aviso-demo">
        {signup && (
          <Input
            name="name"
            label="Nome"
            autoComplete="name"
            autoCapitalize="words"
            required
            value={values.name}
            error={visibleError("name")}
            onChange={(e) => set("name", e.target.value)}
            onBlur={blur("name")}
          />
        )}
        <Input
          name="email"
          type="email"
          label="E-mail"
          autoComplete={signup ? "email" : "username"}
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="nome@email.com"
          required
          value={values.email}
          error={visibleError("email")}
          onChange={(e) => set("email", e.target.value)}
          onBlur={blur("email")}
        />
        <div>
          <PasswordInput
            name="password"
            label="Senha"
            autoComplete={signup ? "new-password" : "current-password"}
            required
            minLength={signup ? MIN_PASSWORD : undefined}
            value={values.password}
            error={visibleError("password")}
            onChange={(e) => set("password", e.target.value)}
            onBlur={blur("password")}
          />
          {signup && !visibleError("password") && (
            <p className={cn("mt-1.5 flex items-center gap-1.5 text-sm transition-colors", passwordOk ? "text-success-text" : "text-fg-muted")}>
              <CheckIcon className={cn("h-4 w-4 transition-opacity", passwordOk ? "opacity-100" : "opacity-40")} />
              Pelo menos {MIN_PASSWORD} caracteres
              <span className="sr-only">{passwordOk ? "(atendido)" : "(pendente)"}</span>
            </p>
          )}
        </div>
        {signup && (
          <Checkbox
            name="terms"
            checked={values.terms}
            onChange={(e) => set("terms", e.target.checked)}
            error={visibleError("terms")}
            label="Li e aceito os Termos de Uso e a Política de Privacidade (documentos em elaboração)."
          />
        )}

        {submitted && errorCount > 0 && (
          <p role="alert" className="text-sm text-danger-text">
            {errorCount === 1 ? "Revise o campo destacado." : `Revise os ${errorCount} campos destacados.`}
          </p>
        )}

        <Button type="submit" fullWidth size="lg" loading={submitting}>
          Continuar
        </Button>
        <p id="aviso-demo" className="text-center text-xs leading-relaxed text-fg-muted">
          Demonstração: {signup ? "nenhuma conta é criada" : "não há verificação de senha"} e nenhum dado é enviado ou
          salvo.
        </p>
      </form>

      <div className="mt-8 space-y-3 border-t border-line pt-6 text-center text-sm">
        <p className="text-fg-muted">
          {signup ? "Já tem uma conta? " : "Ainda não tem conta? "}
          <Link to={signup ? "/entrar" : "/cadastro"} className="font-semibold text-link underline-offset-4 hover:underline">
            {signup ? "Entrar" : "Criar conta"}
          </Link>
        </p>
        <p>
          <Link to="/perfil-de-acesso" className="font-medium text-fg underline-offset-4 hover:text-link hover:underline">
            Explorar a demonstração sem cadastro
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

export function Login() {
  return <AuthForm mode="login" />;
}

export function Signup() {
  return <AuthForm mode="signup" />;
}
