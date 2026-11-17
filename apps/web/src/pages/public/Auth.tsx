import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button, Divider, Input, LockIcon, MailIcon, UserIcon } from "@edusearch/ui";
import { useSession } from "../../app/session";
import { AuthCard } from "../../components/PublicLayout";
import { DemoNotice } from "../../components/DemoNotice";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Errors = Partial<Record<"name" | "email" | "password" | "terms", string>>;

function GoogleButton() {
  return (
    <Button variant="secondary" fullWidth disabled aria-describedby="google-em-breve">
      Continuar com Google
      <span id="google-em-breve" className="text-xs font-normal text-fg-muted">
        (em breve)
      </span>
    </Button>
  );
}

/**
 * Login e cadastro de DEMONSTRAÇÃO: validam o formulário no navegador e
 * seguem para a escolha de perfil. Nenhum dado é enviado ou armazenado;
 * senhas são descartadas. Autenticação real: Supabase Auth + Google (futuro).
 */
function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const navigate = useNavigate();
  const { setPendingName } = useSession();
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const signup = mode === "signup";

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const next: Errors = {};
    if (signup && name.length < 2) next.name = "Informe seu nome.";
    if (!EMAIL_RE.test(email)) next.email = "Informe um e-mail válido.";
    if (signup ? password.length < 8 : password.length === 0)
      next.password = signup ? "A senha precisa ter pelo menos 8 caracteres." : "Informe sua senha.";
    if (signup && !form.get("terms")) next.terms = "É preciso aceitar os termos para continuar.";
    setErrors(next);
    const firstInvalid = (["name", "email", "password", "terms"] as const).find((k) => next[k]);
    if (firstInvalid) {
      (e.currentTarget.elements.namedItem(firstInvalid) as HTMLElement | null)?.focus();
      return;
    }
    setSubmitting(true);
    setPendingName(signup ? name.split(" ")[0] : null);
    window.setTimeout(() => navigate("/perfil-de-acesso"), 400);
  };

  return (
    <AuthCard>
      <h1 className="text-2xl font-semibold text-fg-strong">{signup ? "Crie sua conta" : "Entre no EduSearch"}</h1>
      <p className="mt-1.5 text-sm text-fg-muted">
        {signup ? "Leva menos de um minuto." : "Bom ver você de novo."}
      </p>

      <div className="mt-6">
        <GoogleButton />
      </div>
      <div className="my-6 flex items-center gap-3 text-xs text-fg-muted">
        <Divider className="flex-1" />
        ou com e-mail
        <Divider className="flex-1" />
      </div>

      <form noValidate onSubmit={onSubmit} className="space-y-4">
        {signup && (
          <Input name="name" label="Nome" autoComplete="name" leftIcon={<UserIcon />} required error={errors.name} />
        )}
        <Input
          name="email"
          type="email"
          label="E-mail"
          autoComplete="email"
          inputMode="email"
          leftIcon={<MailIcon />}
          required
          error={errors.email}
        />
        <Input
          name="password"
          type="password"
          label="Senha"
          autoComplete={signup ? "new-password" : "current-password"}
          leftIcon={<LockIcon />}
          required
          hint={signup ? "Mínimo de 8 caracteres." : undefined}
          error={errors.password}
        />
        {signup && (
          <div>
            <label className="flex items-start gap-3 text-sm text-fg">
              <input
                type="checkbox"
                name="terms"
                aria-invalid={errors.terms ? true : undefined}
                aria-describedby={errors.terms ? "termos-erro" : undefined}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--es-primary)]"
              />
              Li e aceito os Termos de Uso e a Política de Privacidade (em elaboração).
            </label>
            {errors.terms && (
              <p id="termos-erro" className="mt-1.5 text-sm text-danger-text">
                {errors.terms}
              </p>
            )}
          </div>
        )}
        <Button type="submit" fullWidth size="lg" loading={submitting}>
          {signup ? "Criar conta" : "Entrar"}
        </Button>
      </form>

      <DemoNotice className="mt-6">
        Demonstração: os dados digitados não são enviados nem salvos. A autenticação real (Google) será integrada em
        breve.
      </DemoNotice>

      <p className="mt-6 text-center text-sm text-fg-muted">
        {signup ? "Já tem conta? " : "Ainda não tem conta? "}
        <Link to={signup ? "/entrar" : "/cadastro"} className="font-medium text-link underline-offset-4 hover:underline">
          {signup ? "Entrar" : "Criar conta"}
        </Link>
      </p>
    </AuthCard>
  );
}

export function Login() {
  return <AuthForm mode="login" />;
}

export function Signup() {
  return <AuthForm mode="signup" />;
}
