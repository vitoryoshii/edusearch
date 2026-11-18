import { useCallback, useState } from "react";
import { Avatar, Badge, CheckCircleIcon, ClockIcon, GoogleGLogo, GraduationIcon, UsersIcon, cn } from "@edusearch/ui";
import { readRoleIntent, writeRoleIntent, type RoleIntent } from "../app/auth";
import type { AuthenticatedProfile } from "../lib/auth/profile";

/** Papel pretendido (provisório, só neste navegador) do usuário autenticado. */
export function useRoleIntent(userId: string) {
  const [role, setRole] = useState<RoleIntent | null>(() => readRoleIntent(userId));
  const choose = useCallback(
    (r: RoleIntent) => {
      setRole(r);
      writeRoleIntent(userId, r);
    },
    [userId],
  );
  return [role, choose] as const;
}

export const ROLE_LABEL: Record<RoleIntent, string> = { student: "Aluno", teacher: "Professor" };

/** Foto, nome e e-mail da conta Google (somente exibição). */
export function ProfileSummary({ profile, size = "lg" }: { profile: AuthenticatedProfile; size?: "lg" | "xl" }) {
  return (
    <div className="flex min-w-0 items-center gap-4">
      <Avatar name={profile.displayName} src={profile.avatarUrl ?? undefined} size={size} />
      <dl className="min-w-0 flex-1 text-sm">
        <dt className="sr-only">Nome</dt>
        <dd className="truncate text-lg font-semibold text-fg-strong" data-testid="profile-name">
          {profile.displayName}
        </dd>
        <dt className="sr-only">E-mail</dt>
        <dd className="truncate text-fg-muted" data-testid="profile-email">
          {profile.email ?? "E-mail não informado"}
        </dd>
        <dt className="sr-only">Provedor</dt>
        <dd className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-fg-muted">
          <GoogleGLogo className="h-3.5 w-3.5" /> Conectado com o Google
        </dd>
      </dl>
    </div>
  );
}

const ROLES: Array<{ value: RoleIntent; title: string; text: string; icon: typeof UsersIcon }> = [
  { value: "student", title: "Quero aprender", text: "Encontrar professores, agendar e acompanhar minhas aulas.", icon: GraduationIcon },
  { value: "teacher", title: "Quero ensinar", text: "Criar meu perfil profissional e receber alunos.", icon: UsersIcon },
];

/** Escolha de papel. Provisória: não concede permissões nem valida perfil profissional. */
export function RoleChoice({ value, onChange }: { value: RoleIntent | null; onChange: (r: RoleIntent) => void }) {
  return (
    <fieldset>
      <legend className="sr-only">Como você quer usar o EduSearch</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ROLES.map((r) => {
          const selected = value === r.value;
          return (
            <label
              key={r.value}
              className={cn(
                "relative flex cursor-pointer items-start gap-4 rounded-panel border-2 bg-surface p-5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-link",
                selected ? "border-primary" : "border-line hover:border-line-strong",
              )}
            >
              <input type="radio" name="papel" value={r.value} checked={selected} onChange={() => onChange(r.value)} className="sr-only" />
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
  );
}

/** Etapas para o cadastro ficar pronto (o que depende do backend fica pendente). */
export function CompletionSteps({ role }: { role: RoleIntent | null }) {
  const steps = [
    { label: "Conta Google conectada", detail: "Sessão validada pelo Supabase", done: true },
    {
      label: "Papel escolhido",
      detail: role ? `${ROLE_LABEL[role]} (provisório, só neste navegador)` : "Escolha se quer aprender ou ensinar",
      done: role !== null,
    },
    { label: "Perfil salvo e confirmado pelo servidor", detail: "Depende da API de perfis — ainda não disponível", done: false },
    { label: "Termos de Uso e Política de Privacidade", detail: "Documentos jurídicos em elaboração", done: false },
  ];
  return (
    <ol className="space-y-3">
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
  );
}

export function ProvisionalBadge() {
  return <Badge tone="warning">Cadastro em análise</Badge>;
}
