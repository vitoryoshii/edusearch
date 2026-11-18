/**
 * Modelo de APRESENTAÇÃO do usuário autenticado (Supabase Auth + Google).
 *
 * Somente exibição: nada aqui concede permissão. `user_metadata` é editável
 * pelo próprio usuário no Supabase e não pode embasar autorização — papéis e
 * privilégios virão da API (FastAPI) a partir do JWT validado no servidor.
 */
export type AuthenticatedProfile = {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
};

/** Metadados da sessão exibidos em Configurações. */
export type SessionInfo = {
  provider: string;
  emailVerified: boolean;
  /** Expiração do JWT de acesso (ms desde a época), renovado automaticamente. */
  expiresAt: number | null;
};

export type UserLike = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  app_metadata?: { provider?: unknown } | null;
  user_metadata?: Record<string, unknown> | null;
};

const text = (meta: Record<string, unknown>, key: string) => {
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/** Foto do Google: somente HTTPS em *.googleusercontent.com. */
export function googlePhoto(url: string | null): string | null {
  return url && /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\/[^\s"'<>]*$/i.test(url) ? url : null;
}

/**
 * Escolhe a foto exibida. Uma foto personalizada (futura, enviada pelo
 * usuário) SEMPRE tem prioridade e nunca é sobrescrita pela foto do Google.
 */
export function resolveAvatar(sources: { custom?: string | null; google?: string | null }): string | null {
  if (sources.custom && /^https:\/\//.test(sources.custom)) return sources.custom;
  return googlePhoto(sources.google ?? null);
}

export function toAuthenticatedProfile(user: UserLike, opts: { customAvatarUrl?: string | null } = {}): AuthenticatedProfile {
  const meta = user.user_metadata ?? {};
  const email = user.email ?? text(meta, "email");
  const displayName = (text(meta, "full_name") ?? text(meta, "name") ?? (email ? email.split("@")[0] : null) ?? "Sua conta").slice(0, 80);
  return {
    id: user.id,
    displayName,
    email,
    avatarUrl: resolveAvatar({ custom: opts.customAvatarUrl, google: text(meta, "avatar_url") ?? text(meta, "picture") }),
  };
}

export function toSessionInfo(user: UserLike, expiresAtSeconds?: number | null): SessionInfo {
  const provider = user.app_metadata?.provider;
  return {
    provider: typeof provider === "string" ? provider : "desconhecido",
    emailVerified: Boolean(user.email_confirmed_at),
    expiresAt: typeof expiresAtSeconds === "number" ? expiresAtSeconds * 1000 : null,
  };
}

/** Primeiro nome para saudações ("Ana Souza" → "Ana"). */
export const firstNameOf = (profile: AuthenticatedProfile) => profile.displayName.split(/\s+/)[0] ?? profile.displayName;
