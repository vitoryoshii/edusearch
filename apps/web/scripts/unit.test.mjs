/**
 * Testes unitários das regras determinísticas do frontend (sem navegador).
 * Rodam com `node --test` (Node 23.6+/22.18+ executa .ts com remoção de tipos).
 *
 *   pnpm --filter @edusearch/web test:unit
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { STANDARD_COMMISSION_BPS, commissionOf, formatBps, splitLessonAmount } from "../src/lib/commission.ts";
import { addDays, addMonths, conflictReason, dateKey, monthGrid, startOfWeek, weekDays } from "../src/lib/calendar.ts";
import { isTrustedMeetUrl, onlineLessonState } from "../src/lib/meeting.ts";

describe("comissão padrão de 15%", () => {
  test("a regra oficial é 15% (1500 basis points)", () => {
    assert.equal(STANDARD_COMMISSION_BPS, 1500);
    assert.equal(formatBps(STANDARD_COMMISSION_BPS), "15%");
    assert.equal(formatBps(1250), "12,5%");
  });

  test("aula de R$ 100,00 → R$ 15,00 de comissão e R$ 85,00 para o professor", () => {
    assert.deepEqual(splitLessonAmount(10000), { commissionCents: 1500, teacherShareCents: 8500 });
  });

  test("valores da demonstração (R$ 60 a R$ 110) somam exatamente o valor da aula", () => {
    for (const cents of [6000, 7000, 7500, 8000, 9500, 11000, 1, 333, 99999]) {
      const { commissionCents, teacherShareCents } = splitLessonAmount(cents);
      assert.ok(Number.isInteger(commissionCents) && Number.isInteger(teacherShareCents));
      assert.equal(commissionCents + teacherShareCents, cents);
    }
    assert.equal(commissionOf(8000), 1200);
    assert.equal(commissionOf(9500), 1425);
  });

  test("recusa valores não inteiros (sem ponto flutuante)", () => {
    assert.throws(() => commissionOf(80.5));
    assert.throws(() => commissionOf(8000, 15.5));
  });
});

describe("calendário", () => {
  test("semana começa na segunda-feira e tem 7 dias", () => {
    const days = weekDays("2026-11-19"); // quinta-feira
    assert.equal(days.length, 7);
    assert.equal(days[0], "2026-11-16");
    assert.equal(days[6], "2026-11-22");
    assert.equal(startOfWeek("2026-11-22"), "2026-11-16"); // domingo pertence à semana iniciada na segunda
  });

  test("grade do mês cobre semanas completas", () => {
    const grid = monthGrid("2026-11-10");
    assert.equal(grid.length % 7, 0);
    assert.equal(grid[0], "2026-10-26");
    assert.ok(grid.includes("2026-11-01") && grid.includes("2026-11-30"));
  });

  test("navegação de mês preserva o fim do mês", () => {
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  });

  test("conflito: aula ativa em dia bloqueado ou fora da grade", () => {
    const start = new Date(2026, 10, 19, 15, 0);
    const end = new Date(2026, 10, 19, 16, 0);
    const lesson = { status: "scheduled", start: start.toISOString(), end: end.toISOString() };
    const weekly = [{ weekday: 4, enabled: true, ranges: [{ start: "14:00", end: "17:00" }] }];
    assert.equal(conflictReason(lesson, weekly, new Set()), null);
    assert.equal(conflictReason(lesson, weekly, new Set([dateKey(start)])), "Aula marcada em um dia bloqueado");
    const reduced = [{ weekday: 4, enabled: true, ranges: [{ start: "14:00", end: "15:30" }] }];
    assert.equal(conflictReason(lesson, reduced, new Set()), "Aula fora da disponibilidade atual");
    assert.equal(conflictReason({ ...lesson, status: "cancelled" }, reduced, new Set()), null);
  });
});

describe("Google Meet", () => {
  test("só aceita URLs oficiais do Meet", () => {
    assert.equal(isTrustedMeetUrl("https://meet.google.com/abc-defg-hij"), true);
    for (const bad of [
      null,
      "",
      "http://meet.google.com/abc-defg-hij",
      "https://meet.google.com.evil.example/abc-defg-hij",
      "https://evil.example/meet.google.com/abc-defg-hij",
      "https://meet.google.com/abc-defg-hij?x=1",
      "https://meet.google.com/lookup/abc",
      "javascript:alert(1)",
    ]) {
      assert.equal(isTrustedMeetUrl(bad), false, String(bad));
    }
  });

  test("estados da aula online pelo horário e pela reserva", () => {
    const start = Date.UTC(2026, 10, 20, 22, 0);
    const lesson = (status) => ({ status, start: new Date(start).toISOString(), end: new Date(start + 3_600_000).toISOString() });
    const at = (minutesFromStart) => start + minutesFromStart * 60_000;
    assert.equal(onlineLessonState(lesson("scheduled"), at(-3 * 24 * 60)), "scheduled");
    assert.equal(onlineLessonState(lesson("scheduled"), at(-120)), "waiting");
    assert.equal(onlineLessonState(lesson("scheduled"), at(-10)), "ready");
    assert.equal(onlineLessonState(lesson("scheduled"), at(30)), "live");
    assert.equal(onlineLessonState(lesson("scheduled"), at(61)), "finished");
    assert.equal(onlineLessonState(lesson("completed"), at(-120)), "finished");
    assert.equal(onlineLessonState(lesson("cancelled"), at(-120)), "cancelled");
    assert.equal(onlineLessonState(lesson("pending_payment"), at(-10)), "awaiting_payment");
  });
});

/* ------------- Autenticação (Google Identity Services + Supabase) ------------- */
import { createHash, webcrypto } from "node:crypto";
import {
  ACCOUNT_HOME,
  GOOGLE_LOGIN_SCOPES,
  NONCE_MAX_AGE_MS,
  NonceVault,
  checkCredential,
  classifySupabaseError,
  createNonce,
  decodeJwtPayload,
  sanitizeNext,
  sha256Hex,
  stripProviderTokens,
} from "../src/lib/auth/oauth.ts";
import { googlePhoto, resolveAvatar, toAuthenticatedProfile, toSessionInfo } from "../src/lib/auth/profile.ts";

const CLIENT_ID = "1234567890-abcdefghijklmnop.apps.googleusercontent.com";
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const fakeIdToken = (claims) => `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claims)}.assinatura`;
const NOW = 1_800_000_000_000;

describe("login Google: escopos e destino", () => {
  test("somente escopos básicos (sem Agenda, Meet, Drive ou Gmail)", () => {
    assert.deepEqual([...GOOGLE_LOGIN_SCOPES], ["openid", "email", "profile"]);
    assert.ok(!GOOGLE_LOGIN_SCOPES.some((s) => /calendar|meet|drive|gmail/i.test(s)));
  });

  test("destino pós-login aceita apenas caminhos internos da conta", () => {
    assert.equal(sanitizeNext("/conta"), "/conta");
    assert.equal(sanitizeNext("/conta/perfil"), "/conta/perfil");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "/conta/../aluno", "javascript:alert(1)", "/aluno", "/contas", "", null, 42]) {
      assert.equal(sanitizeNext(bad), ACCOUNT_HOME, `deveria recusar ${JSON.stringify(bad)}`);
    }
  });
});

describe("login Google: nonce (Web Crypto + SHA-256)", () => {
  test("nonce de 256 bits e hash SHA-256 em hexadecimal", async () => {
    const { raw, hashed } = await createNonce(webcrypto);
    assert.match(raw, /^[A-Za-z0-9_-]{43}$/);
    assert.match(hashed, /^[0-9a-f]{64}$/);
    assert.equal(hashed, createHash("sha256").update(raw).digest("hex"));
    assert.equal(await sha256Hex("abc", webcrypto), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("nonces não se repetem", async () => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) seen.add((await createNonce(webcrypto)).raw);
    assert.equal(seen.size, 50);
  });

  test("cofre entrega o nonce original uma única vez", async () => {
    const vault = new NonceVault();
    const pair = await createNonce(webcrypto);
    vault.remember(pair, NOW);
    assert.equal(vault.consume(pair.hashed, NOW + 1000), pair.raw);
    assert.equal(vault.consume(pair.hashed, NOW + 2000), null, "reutilização bloqueada");
  });

  test("nonce desconhecido ou expirado é recusado", async () => {
    const vault = new NonceVault();
    const pair = await createNonce(webcrypto);
    vault.remember(pair, NOW);
    assert.equal(vault.consume("f".repeat(64), NOW), null);
    assert.equal(vault.consume(pair.hashed, NOW + NONCE_MAX_AGE_MS + 1), null);
    assert.equal(vault.consume(undefined, NOW), null);
  });
});

describe("login Google: credencial (ID token)", () => {
  const hashed = "a".repeat(64);
  const valid = { iss: "https://accounts.google.com", aud: CLIENT_ID, exp: NOW / 1000 + 300, nonce: hashed, sub: "123" };

  test("credencial válida devolve o hash do nonce", () => {
    assert.deepEqual(checkCredential(fakeIdToken(valid), { clientId: CLIENT_ID, now: NOW }), { ok: true, hashedNonce: hashed });
  });

  test("token inválido: malformado, outro emissor, outro Client ID ou expirado", () => {
    const bad = (token) => checkCredential(token, { clientId: CLIENT_ID, now: NOW });
    assert.deepEqual(bad("nao-e-jwt"), { ok: false, failure: "invalid_token" });
    assert.deepEqual(bad(undefined), { ok: false, failure: "invalid_token" });
    assert.deepEqual(bad(fakeIdToken({ ...valid, iss: "https://evil.com" })), { ok: false, failure: "invalid_token" });
    assert.deepEqual(bad(fakeIdToken({ ...valid, aud: "outro.apps.googleusercontent.com" })), { ok: false, failure: "invalid_token" });
    assert.deepEqual(bad(fakeIdToken({ ...valid, exp: NOW / 1000 - 1 })), { ok: false, failure: "invalid_token" });
  });

  test("nonce inválido: ausente ou fora do formato SHA-256", () => {
    const { nonce: _n, ...noNonce } = valid;
    assert.deepEqual(checkCredential(fakeIdToken(noNonce), { clientId: CLIENT_ID, now: NOW }), { ok: false, failure: "invalid_nonce" });
    assert.deepEqual(checkCredential(fakeIdToken({ ...valid, nonce: "123" }), { clientId: CLIENT_ID, now: NOW }), { ok: false, failure: "invalid_nonce" });
  });

  test("decodificação recusa payloads que não são objetos", () => {
    assert.equal(decodeJwtPayload(`a.${Buffer.from("[1]").toString("base64url")}.c`), null);
    assert.equal(decodeJwtPayload("a.b"), null);
  });
});

describe("login Google: erros do Supabase", () => {
  test("classificação das falhas", () => {
    assert.equal(classifySupabaseError({ message: "Nonces mismatch" }), "invalid_nonce");
    assert.equal(classifySupabaseError({ message: "Bad ID token", code: "bad_jwt" }), "invalid_token");
    // Formato atual da API (x-supabase-api-version 2024-01-01), como o AuthApiError do SDK o expõe.
    assert.equal(classifySupabaseError({ name: "AuthApiError", code: "bad_oidc_token", message: "Bad ID token", status: 400 }), "invalid_token");
    assert.equal(classifySupabaseError({ name: "AuthApiError", message: "Bad ID token", status: 400 }), "invalid_token");
    assert.equal(classifySupabaseError({ name: "AuthApiError", code: "bad_oidc_token", message: "Nonces mismatch", status: 400 }), "invalid_nonce");
    assert.equal(classifySupabaseError({ message: "Signups not allowed for this instance", code: "signup_disabled" }), "not_allowed");
    assert.equal(classifySupabaseError({ message: "Error running hook URI" }), "not_allowed");
    assert.equal(classifySupabaseError({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }), "network");
    assert.equal(classifySupabaseError({ message: "Database error saving new user" }), "provider_error");
    assert.equal(classifySupabaseError(null), "provider_error");
  });
});

describe("conta autenticada: perfil de apresentação", () => {
  const base = { id: "u1", email: "ana@example.com", email_confirmed_at: "2026-11-18T10:00:00Z", app_metadata: { provider: "google" } };

  test("nome, e-mail e foto do Google", () => {
    const p = toAuthenticatedProfile({ ...base, user_metadata: { full_name: "Ana Souza", avatar_url: "https://lh3.googleusercontent.com/a/xyz=s96-c" } });
    assert.deepEqual(p, { id: "u1", displayName: "Ana Souza", email: "ana@example.com", avatarUrl: "https://lh3.googleusercontent.com/a/xyz=s96-c" });
  });

  test("usa name e picture quando full_name/avatar_url não existem", () => {
    const p = toAuthenticatedProfile({ ...base, user_metadata: { name: "Ana", picture: "https://lh3.googleusercontent.com/p" } });
    assert.equal(p.displayName, "Ana");
    assert.equal(p.avatarUrl, "https://lh3.googleusercontent.com/p");
  });

  test("avatar ausente → null (a interface mostra iniciais)", () => {
    assert.equal(toAuthenticatedProfile({ ...base, user_metadata: {} }).avatarUrl, null);
  });

  test("nome ausente → parte local do e-mail; sem e-mail → rótulo neutro", () => {
    assert.equal(toAuthenticatedProfile({ ...base, user_metadata: { full_name: "   " } }).displayName, "ana");
    assert.equal(toAuthenticatedProfile({ id: "u2", user_metadata: null }).displayName, "Sua conta");
    assert.equal(toAuthenticatedProfile({ id: "u2" }).email, null);
  });

  test("foto fora do domínio do Google é ignorada", () => {
    assert.equal(googlePhoto("http://lh3.googleusercontent.com/x"), null);
    assert.equal(googlePhoto("https://evil.com/x.png"), null);
    assert.equal(googlePhoto("https://lh3.googleusercontent.com.evil.com/x"), null);
  });

  test("foto personalizada tem prioridade e não é sobrescrita pela do Google", () => {
    assert.equal(resolveAvatar({ custom: "https://cdn.edusearch.com.br/u1.webp", google: "https://lh3.googleusercontent.com/a" }), "https://cdn.edusearch.com.br/u1.webp");
    assert.equal(resolveAvatar({ custom: null, google: "https://lh3.googleusercontent.com/a" }), "https://lh3.googleusercontent.com/a");
  });

  test("informações de sessão", () => {
    assert.deepEqual(toSessionInfo(base, 1_800_000_000), { provider: "google", emailVerified: true, expiresAt: 1_800_000_000_000 });
    assert.deepEqual(toSessionInfo({ id: "x" }), { provider: "desconhecido", emailVerified: false, expiresAt: null });
  });
});

describe("credenciais: nada de segredos ou tokens persistidos", () => {
  test("tokens de provedor são removidos antes de gravar a sessão", () => {
    const stored = JSON.parse(stripProviderTokens(JSON.stringify({ access_token: "a", provider_token: "g", provider_refresh_token: "gr" })));
    assert.deepEqual(stored, { access_token: "a" });
    assert.equal(stripProviderTokens('"verificador"'), '"verificador"');
  });
});
