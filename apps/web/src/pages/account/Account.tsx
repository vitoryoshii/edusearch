import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CheckCircleIcon,
  ClockIcon,
  GoogleGLogo,
  GraduationIcon,
  LockIcon,
  LogoutIcon,
  Logo,
  ShieldIcon,
  UsersIcon,
  cn,
  useToast,
} from "@edusearch/ui";
import { readRoleIntent, useAuth, writeRoleIntent, type RoleIntent } from "../../app/auth";

const ROLES: Array<{ value: RoleIntent; title: string; text: string; icon: typeof UsersIcon }> = [
  { value: "student", title: "Quero aprender", text: "Encontrar professores, agendar e acompanhar minhas aulas.", icon: GraduationIcon },
  { value: "teacher", title: "Quero ensinar", text: "Criar meu perfil profissional e receber alunos.", icon: UsersIcon },
];

type Step = { label: string; detail: string; done: boolean };

/**
 * Área da CONTA REAL (sessão autenticada pelo Google via Supabase).
 *
 * - Mostra os dados básicos devolvidos pelo Google (nome, e-mail, foto).
 * - Permite indicar o papel pretendido (aluno/professor). É só uma
 *   preferência local: o papel efetivo e as permissões virão da API.
 * - Não usa dados da demonstração e não habilita aulas nem pagamentos reais.
 */
export default function Account() {
  const { identity, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [role, setRole] = useState<RoleIntent | null>(() => (identity ? readRoleIntent(identity.id) : null));
  const [leaving, setLeaving] = useState(false);

  if (!identity) return null; // RequireAuth garante a sessão.

  const choose = (r: RoleIntent) => {
    setRole(r);
    writeRoleIntent(identity.id, r);
  };

  const exit = async () => {
    setLeaving(true);
    await signOut();
    toast({ tone: "success", title: "Você saiu da sua conta", description: "A sessão foi encerrada neste dispositivo." });
    navigate("/entrar", { replace: true });
  };

  const steps: Step[] = [
    { label: "Conta Google conectada", detail: identity.email ?? "E-mail não informado pelo provedor", done: true },
    {
      label: "Papel escolhido",
      detail: role ? (role === "student" ? "Aluno (preferência local)" : "Professor (preferência local)") : "Escolha abaixo como quer usar o EduSearch",
      done: role !== null,
    },
    { label: "Perfil salvo no servidor", detail: "Depende da API de perfis (FastAPI) — ainda não disponível", done: false },
    { label: "Termos de Uso e Política de Privacidade", detail: "Documentos jurídicos em elaboração", done: false },
  ];

  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between gap-4 px-5 sm:h-20 sm:px-8">
        <Link to="/" aria-label="EduSearch — início" className="rounded-md">
          <Logo className="h-8" />
        </Link>
        <Button variant="ghost" onClick={exit} loading={leaving}>
          <LogoutIcon className="h-4 w-4" />
          Sair
        </Button>
      </header>

      <main id="conteudo-principal" className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-5 pb-12 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="primary" icon={<LockIcon />}>
            Sessão autenticada
          </Badge>
          <Badge tone="warning">Ambiente de testes</Badge>
        </div>
        <h1 className="text-2xl font-semibold text-balance text-fg-strong sm:text-3xl">Olá, {identity.name.split(/\s+/)[0]}!</h1>

        <Card className="flex items-center gap-4">
          {identity.avatarUrl ? (
            <img
              src={identity.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-16 w-16 shrink-0 rounded-full object-cover"
            />
          ) : (
            <Avatar name={identity.name} size="lg" />
          )}
          <dl className="min-w-0 flex-1 text-sm">
            <dt className="sr-only">Nome</dt>
            <dd className="truncate text-lg font-semibold text-fg-strong">{identity.name}</dd>
            <dt className="sr-only">E-mail</dt>
            <dd className="truncate text-fg-muted">{identity.email ?? "E-mail não informado"}</dd>
            <dt className="sr-only">Provedor</dt>
            <dd className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span className="inline-flex items-center gap-1.5">
                <GoogleGLogo className="h-3.5 w-3.5" /> Conectado com o Google
              </span>
              {identity.emailVerified && <Badge tone="success">E-mail verificado</Badge>}
            </dd>
          </dl>
        </Card>

        <section aria-labelledby="papel">
          <h2 id="papel" className="text-lg font-semibold text-fg-strong">
            Como você quer usar o EduSearch?
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Esta escolha ajuda a preparar seu cadastro. Ela fica salva só neste navegador e não concede permissões: o
            perfil efetivo será confirmado pelo servidor.
          </p>
          <fieldset className="mt-4">
            <legend className="sr-only">Papel pretendido</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {ROLES.map((r) => {
                const selected = role === r.value;
                return (
                  <label
                    key={r.value}
                    className={cn(
                      "relative flex cursor-pointer items-start gap-4 rounded-panel border-2 bg-surface p-5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-link",
                      selected ? "border-primary" : "border-line hover:border-line-strong",
                    )}
                  >
                    <input
                      type="radio"
                      name="papel"
                      value={r.value}
                      checked={selected}
                      onChange={() => choose(r.value)}
                      className="sr-only"
                    />
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-control",
                        selected ? "bg-primary text-primary-fg" : "bg-primary-soft text-link",
                      )}
                    >
                      <r.icon className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block font-semibold text-fg-strong">{r.title}</span>
                      <span className="mt-0.5 block text-sm leading-relaxed text-fg-muted">{r.text}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </section>

        <section aria-labelledby="conclusao">
          <h2 id="conclusao" className="text-lg font-semibold text-fg-strong">
            Conclusão do cadastro
          </h2>
          <ol className="mt-4 space-y-3">
            {steps.map((s) => (
              <li key={s.label} className="flex items-start gap-3">
                {s.done ? (
                  <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-success-text" />
                ) : (
                  <ClockIcon className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted" />
                )}
                <span>
                  <span className="block font-medium text-fg-strong">
                    {s.label}
                    <span className="sr-only">{s.done ? " (concluído)" : " (pendente)"}</span>
                  </span>
                  <span className="block text-sm text-fg-muted">{s.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <Button className="mt-5" size="lg" aria-describedby="perfil-indisponivel" disabled>
            Concluir perfil
          </Button>
          <p id="perfil-indisponivel" className="mt-2 text-sm text-fg-muted">
            Disponível quando a API de perfis, as autorizações do servidor e os documentos jurídicos estiverem publicados.
          </p>
        </section>

        <Card tone="muted" className="flex items-start gap-3 text-sm">
          <ShieldIcon className="mt-0.5 h-5 w-5 shrink-0 text-link" />
          <div>
            <p className="font-semibold text-fg-strong">Conta ainda não habilitada para uso comercial</p>
            <p className="mt-1 leading-relaxed text-fg">
              Nesta fase de testes não é possível agendar aulas nem fazer pagamentos reais com a sua conta. A
              demonstração continua disponível, com dados fictícios separados da sua conta — nada dela é copiado para
              cá.
            </p>
            <Link
              to="/perfil-de-acesso"
              className="mt-2 inline-flex min-h-11 items-center font-semibold text-link underline-offset-4 hover:underline"
            >
              Explorar a demonstração
            </Link>
          </div>
        </Card>
      </main>
    </div>
  );
}
