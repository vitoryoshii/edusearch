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

/* ------------------------- Onboarding da conta real ------------------------- */
import {
  LIMITS,
  ONBOARDING_PATH,
  STUDENT_STEPS,
  TEACHER_STEPS,
  WELCOME_PATH,
  emptyStudentDraft,
  emptyTeacherDraft,
  firstIncomplete,
  nextAccountStep,
  parsePriceToCents,
  studentStepIssue,
  teacherStepIssue,
  toggle,
  BUDGET_RANGE_CENTS,
  budgetRangeFromCents,
  centsToPriceInput,
  studentDraftToPayload,
  studentPayloadToDraft,
  teacherDraftToPayload,
  teacherPayloadToDraft,
} from "../src/lib/onboarding.ts";

describe("onboarding ↔ API (Fase 2.6B): nenhuma resposta descartada", () => {
  const student = {
    goal: "  Passar no ENEM  ",
    level: "medio",
    subjects: ["matematica", "fisica"],
    difficulties: ["exercicios", "base"],
    days: ["seg", "qua"],
    periods: ["noite"],
    modality: "online",
    budget: "50-80",
  };
  const teacher = {
    bio: "Professora fictícia de matemática com foco em ENEM.",
    subjects: ["matematica"],
    specialties: "  ",
    education: "Licenciatura em Matemática",
    experience: "3-5",
    methodologies: ["exercicios", "pratica"],
    methodologyNotes: "Listas comentadas",
    price: "80,50",
    durations: [60, 30],
    modality: "hibrido",
    days: ["ter"],
    periods: ["tarde", "noite"],
  };

  test("aluno: todos os campos do formulário vão para a API", () => {
    const p = studentDraftToPayload(student);
    assert.deepEqual(p, {
      learning_goal: "Passar no ENEM",
      education_level: "medio",
      subjects: ["matematica", "fisica"],
      difficulty_areas: ["exercicios", "base"],
      preferred_weekdays: ["seg", "qua"],
      preferred_periods: ["noite"],
      preferred_modality: "online",
      budget_min_cents: 5000,
      budget_max_cents: 8000,
    });
    assert.deepEqual(studentPayloadToDraft(p), { ...student, goal: "Passar no ENEM" });
  });

  test("aluno: as 4 faixas de valor ida e volta, sem perda", () => {
    for (const [range, { min, max }] of Object.entries(BUDGET_RANGE_CENTS)) assert.equal(budgetRangeFromCents(min, max), range);
    assert.deepEqual(BUDGET_RANGE_CENTS["ate-50"], { min: null, max: 5000 });
    assert.deepEqual(BUDGET_RANGE_CENTS["120-mais"], { min: 12000, max: null });
    assert.equal(budgetRangeFromCents(1, 2), null);
  });

  test("professor: todos os campos, durações ordenadas, texto vazio vira null", () => {
    const p = teacherDraftToPayload(teacher);
    assert.equal(p.price_cents, 8050);
    assert.deepEqual(p.lesson_durations_minutes, [30, 60]);
    assert.equal(p.specialties, null);
    assert.equal(p.methodology, "Listas comentadas");
    assert.deepEqual(p.teaching_methods, ["exercicios", "pratica"]);
    assert.deepEqual([p.available_weekdays, p.available_periods], [["ter"], ["tarde", "noite"]]);
    const back = teacherPayloadToDraft(p);
    assert.equal(back.price, "80,50");
    assert.equal(parsePriceToCents(back.price), 8050);
    assert.deepEqual(back.durations, [30, 60]);
    assert.equal(back.specialties, "");
  });

  test("valor em centavos ↔ campo de texto", () => {
    for (const c of [2000, 8050, 100000, 2005]) assert.equal(parsePriceToCents(centsToPriceInput(c)), c);
    assert.equal(centsToPriceInput(2005), "20,05");
  });

  test("rascunho incompleto não é convertido (nunca envia cadastro pela metade)", () => {
    assert.throws(() => studentDraftToPayload({ ...student, budget: null }));
    assert.throws(() => teacherDraftToPayload({ ...teacher, price: "abc" }));
  });
});

describe("onboarding: próxima etapa após o login", () => {
  test("primeiro acesso (sem papel) vai para as boas-vindas", () => {
    assert.equal(nextAccountStep(null), WELCOME_PATH);
    assert.equal(WELCOME_PATH, "/conta/boas-vindas");
  });
  test("com papel escolhido vai ao início da conta (cadastro ainda pendente)", () => {
    assert.equal(nextAccountStep("student"), "/conta");
    assert.equal(nextAccountStep("teacher"), "/conta");
    assert.deepEqual(ONBOARDING_PATH, { student: "/conta/cadastro/aluno", teacher: "/conta/cadastro/professor" });
  });
});

describe("onboarding: valor da aula sem ponto flutuante", () => {
  test("formatos aceitos", () => {
    assert.equal(parsePriceToCents("80"), 8000);
    assert.equal(parsePriceToCents("80,5"), 8050);
    assert.equal(parsePriceToCents("80,50"), 8050);
    assert.equal(parsePriceToCents("R$ 1.200,00"), 120000);
    assert.equal(parsePriceToCents(" 95,99 "), 9599);
  });
  test("formatos recusados", () => {
    for (const bad of ["", "abc", "80.5", "80,505", "-10", "1,2,3", "1.20,00", "R$"]) assert.equal(parsePriceToCents(bad), null, bad);
  });
});

describe("onboarding do aluno: etapas curtas", () => {
  test("cinco etapas, da identidade à revisão", () => {
    assert.deepEqual(STUDENT_STEPS, ["voce", "objetivo", "materias", "rotina", "revisao"]);
  });
  test("rascunho vazio: identidade e revisão livres, demais etapas pedem dados", () => {
    const d = emptyStudentDraft();
    assert.equal(studentStepIssue("voce", d), null);
    assert.ok(studentStepIssue("objetivo", d));
    assert.ok(studentStepIssue("materias", d));
    assert.ok(studentStepIssue("rotina", d));
    assert.equal(firstIncomplete(STUDENT_STEPS, d, studentStepIssue), "objetivo");
  });
  test("rascunho completo passa em todas as etapas; dificuldades são opcionais", () => {
    const d = { ...emptyStudentDraft(), goal: "Passar no ENEM", level: "medio", subjects: ["matematica"], days: ["seg"], periods: ["noite"], modality: "online", budget: "50-80" };
    assert.equal(firstIncomplete(STUDENT_STEPS, d, studentStepIssue), null);
  });
  test("objetivo muito longo é recusado", () => {
    const d = { ...emptyStudentDraft(), goal: "x".repeat(LIMITS.goal.max + 1), level: "medio" };
    assert.ok(studentStepIssue("objetivo", d));
  });
});

describe("onboarding do professor: etapas e regras", () => {
  const full = {
    ...emptyTeacherDraft(),
    bio: "Professora de matemática há oito anos, com foco em ENEM e vestibulares.",
    subjects: ["matematica"],
    education: "Licenciatura em Matemática",
    experience: "5-mais",
    methodologies: ["exercicios"],
    price: "80,00",
    durations: [60],
    modality: "online",
    days: ["ter"],
    periods: ["tarde"],
  };
  test("seis etapas, incluindo documentos (somente informativa)", () => {
    assert.deepEqual(TEACHER_STEPS, ["voce", "ensino", "aulas", "agenda", "documentos", "revisao"]);
    assert.equal(teacherStepIssue("documentos", emptyTeacherDraft()), null);
  });
  test("rascunho completo passa em todas as etapas", () => {
    assert.equal(firstIncomplete(TEACHER_STEPS, full, teacherStepIssue), null);
  });
  test("biografia curta, valor fora da faixa e falta de duração são recusados", () => {
    assert.ok(teacherStepIssue("voce", { ...full, bio: "Curta demais" }));
    assert.ok(teacherStepIssue("aulas", { ...full, price: "10" }));
    assert.ok(teacherStepIssue("aulas", { ...full, price: "1.000,01" }));
    assert.ok(teacherStepIssue("aulas", { ...full, price: "oitenta" }));
    assert.ok(teacherStepIssue("aulas", { ...full, durations: [] }));
    assert.equal(teacherStepIssue("aulas", { ...full, price: "1.000,00" }), null);
  });
});

describe("onboarding: seleção por chips", () => {
  test("toggle adiciona e remove sem mutar a lista original", () => {
    const base = ["a"];
    assert.deepEqual(toggle(base, "b"), ["a", "b"]);
    assert.deepEqual(toggle(base, "a"), []);
    assert.deepEqual(base, ["a"]);
  });
});

/* -------------- Exemplo financeiro do onboarding do professor -------------- */
import { formatMoney } from "../src/lib/format.ts";

describe("onboarding do professor: exemplo da comissão padrão", () => {
  test("R$ 80,00 → R$ 12,00 EduSearch (1.500 bps) e R$ 68,00 ao professor, em centavos inteiros", () => {
    const cents = parsePriceToCents("80");
    assert.equal(cents, 8000);
    assert.equal(STANDARD_COMMISSION_BPS, 1500);
    assert.deepEqual(splitLessonAmount(cents), { commissionCents: 1200, teacherShareCents: 6800 });
  });
  test("formatação pt-BR usa espaço não separável (normalizado só na comparação)", () => {
    const shown = formatMoney(1200);
    assert.match(shown, /^R\$[   ]12,00$/);
    assert.equal(shown.replace(/[  ]/g, " "), "R$ 12,00");
    assert.equal(formatMoney(6800).replace(/[  ]/g, " "), "R$ 68,00");
  });
});

/* ------------------- Estágios por recurso e acesso por e-mail ------------------- */
import { parseStage, resolveFeatures } from "../src/lib/stages.ts";
import {
  EMAIL_MESSAGES,
  GENERIC_SENT,
  classifyEmailError,
  emailIssue,
  newPasswordIssue,
  normalizeEmail,
  parseEmailLink,
} from "../src/lib/auth/email.ts";

describe("estágios por recurso", () => {
  const ready = { supabaseReady: true, googleReady: true, legalPublished: false };
  test("padrões: Google em testes, e-mail e cadastro por e-mail desligados, pagamentos demonstrativos", () => {
    assert.deepEqual(resolveFeatures({}, ready), { googleAuth: "testing", emailAuth: "off", emailSignup: "off", profilePersistence: "off", scheduling: "off", payments: "demo", realAuth: true });
  });
  test("sem configuração técnica tudo fica desligado (versão pública)", () => {
    const f = resolveFeatures({ VITE_STAGE_GOOGLE_AUTH: "production", VITE_STAGE_EMAIL_AUTH: "production" }, { supabaseReady: false, googleReady: false, legalPublished: true });
    assert.equal(f.googleAuth, "off");
    assert.equal(f.emailAuth, "off");
    assert.equal(f.realAuth, false);
  });
  test("produção exige documentos jurídicos publicados", () => {
    const env = { VITE_STAGE_GOOGLE_AUTH: "production", VITE_STAGE_EMAIL_AUTH: "production", VITE_STAGE_EMAIL_SIGNUP: "production" };
    assert.deepEqual(
      [resolveFeatures(env, ready).googleAuth, resolveFeatures(env, ready).emailAuth, resolveFeatures(env, ready).emailSignup],
      ["testing", "testing", "testing"],
    );
    const pub = resolveFeatures(env, { ...ready, legalPublished: true });
    assert.deepEqual([pub.googleAuth, pub.emailAuth, pub.emailSignup], ["production", "production", "production"]);
  });
  test("cadastro por e-mail nunca acima do login por e-mail; indicadores independentes", () => {
    assert.equal(resolveFeatures({ VITE_STAGE_EMAIL_SIGNUP: "testing" }, ready).emailSignup, "off");
    assert.equal(resolveFeatures({ VITE_STAGE_EMAIL_AUTH: "testing", VITE_STAGE_EMAIL_SIGNUP: "production" }, { ...ready, legalPublished: true }).emailSignup, "testing");
    const onlyEmail = resolveFeatures({ VITE_STAGE_GOOGLE_AUTH: "off", VITE_STAGE_EMAIL_AUTH: "testing" }, ready);
    assert.deepEqual([onlyEmail.googleAuth, onlyEmail.emailAuth, onlyEmail.realAuth], ["off", "testing", true]);
  });
  test("persistência do perfil: desligada por padrão, exige login real e documentos para produção", () => {
    assert.equal(resolveFeatures({}, ready).profilePersistence, "off");
    assert.equal(resolveFeatures({ VITE_STAGE_PROFILE_PERSISTENCE: "testing" }, ready).profilePersistence, "testing");
    assert.equal(resolveFeatures({ VITE_STAGE_PROFILE_PERSISTENCE: "production" }, ready).profilePersistence, "testing");
    assert.equal(resolveFeatures({ VITE_STAGE_PROFILE_PERSISTENCE: "production" }, { ...ready, legalPublished: true }).profilePersistence, "production");
    const noAuth = resolveFeatures({ VITE_STAGE_PROFILE_PERSISTENCE: "testing" }, { supabaseReady: false, googleReady: false, legalPublished: true });
    assert.equal(noAuth.profilePersistence, "off");
    assert.equal(resolveFeatures({ VITE_STAGE_PROFILE_PERSISTENCE: "sim" }, ready).profilePersistence, "off");
  });
  test("agenda: desligada por padrão, exige persistência real e nunca passa de testes", () => {
    assert.equal(resolveFeatures({ VITE_STAGE_SCHEDULING: "testing" }, ready).scheduling, "off");
    const on = { VITE_STAGE_PROFILE_PERSISTENCE: "testing", VITE_STAGE_SCHEDULING: "testing" };
    assert.equal(resolveFeatures(on, ready).scheduling, "testing");
    const prod = { VITE_STAGE_PROFILE_PERSISTENCE: "production", VITE_STAGE_SCHEDULING: "production" };
    assert.equal(resolveFeatures(prod, { ...ready, legalPublished: true }).scheduling, "testing");
    assert.equal(resolveFeatures({ ...on, VITE_STAGE_SCHEDULING: "sim" }, ready).scheduling, "off");
  });
  test("valores inválidos caem no padrão", () => {
    assert.equal(parseStage("ligado", "off"), "off");
    assert.equal(parseStage(undefined, "testing"), "testing");
  });
});

describe("acesso por e-mail: validação", () => {
  test("e-mail", () => {
    assert.equal(emailIssue("nome@email.com"), null);
    assert.ok(emailIssue(""));
    assert.ok(emailIssue("nome@"));
    assert.ok(emailIssue("a b@c.com"));
    assert.equal(normalizeEmail("  Ana@Example.COM "), "ana@example.com");
  });
  test("nova senha: mínimo de 8, sem só espaços, até 72 bytes", () => {
    assert.equal(newPasswordIssue("segura123"), null);
    assert.ok(newPasswordIssue("curta"));
    assert.ok(newPasswordIssue("         "));
    assert.ok(newPasswordIssue("ç".repeat(37))); // 74 bytes
    assert.equal(newPasswordIssue("ç".repeat(36)), null); // 72 bytes
  });
});

describe("acesso por e-mail: respostas sem enumeração de contas", () => {
  test("login errado não diz se o problema é o e-mail ou a senha", () => {
    assert.equal(classifyEmailError({ code: "invalid_credentials", message: "Invalid login credentials" }, "signin"), "invalid_credentials");
    assert.equal(EMAIL_MESSAGES.invalid_credentials, "E-mail ou senha incorretos.");
  });
  test("cadastro de e-mail existente e recuperação de e-mail inexistente viram sucesso genérico", () => {
    assert.equal(classifyEmailError({ code: "user_already_exists", message: "User already registered" }, "signup"), null);
    assert.equal(classifyEmailError({ code: "email_exists" }, "signup"), null);
    assert.equal(classifyEmailError({ code: "user_not_found" }, "reset"), null);
    assert.ok(!/existe|cadastrad[oa] anteriormente/i.test(GENERIC_SENT.signup + GENERIC_SENT.reset));
  });
  test("outros erros classificados", () => {
    assert.equal(classifyEmailError({ code: "email_not_confirmed" }, "signin"), "email_not_confirmed");
    assert.equal(classifyEmailError({ status: 429, code: "over_email_send_rate_limit" }, "reset"), "rate_limited");
    assert.equal(classifyEmailError({ code: "weak_password" }, "signup"), "weak_password");
    assert.equal(classifyEmailError({ code: "same_password" }, "update"), "same_password");
    assert.equal(classifyEmailError({ code: "signup_disabled" }, "signup"), "not_available");
    assert.equal(classifyEmailError({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }, "signin"), "network");
    assert.equal(classifyEmailError(null, "signin"), null);
  });
  test("links de e-mail: código PKCE, erros e ausência", () => {
    assert.deepEqual(parseEmailLink("?code=abc12345-def", ""), { kind: "code", code: "abc12345-def" });
    assert.deepEqual(parseEmailLink("?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", ""), { kind: "error", failure: "link_invalid" });
    assert.deepEqual(parseEmailLink("", "#error=access_denied&error_code=otp_expired"), { kind: "error", failure: "link_invalid" });
    assert.deepEqual(parseEmailLink("?code=<script>", ""), { kind: "none" });
    assert.deepEqual(parseEmailLink("", ""), { kind: "none" });
  });
});

import {
  dayKeyOf,
  groupSlotsByDay,
  isGoogleAuthorizationUrl,
  lessonWhen,
  parseCalendarReturn,
  timeOf,
  windowsIssue,
} from "../src/lib/scheduling.ts";

describe("agenda real (Fase 3A)", () => {
  test("janelas: mesmas regras da API", () => {
    assert.equal(windowsIssue([{ weekday: "seg", start: "08:00", end: "12:00" }, { weekday: "seg", start: "12:00", end: "13:00" }]), null);
    assert.match(windowsIssue([{ weekday: "seg", start: "08:00", end: "10:00" }, { weekday: "seg", start: "09:00", end: "11:00" }]), /sobrepostas/);
    assert.match(windowsIssue([{ weekday: "ter", start: "10:00", end: "09:00" }]), /depois do início/);
    assert.match(windowsIssue([{ weekday: "qua", start: "10:10", end: "11:00" }]), /15 em 15/);
    assert.match(windowsIssue([{ weekday: "qui", start: "8h", end: "11:00" }]), /HH:MM/);
    assert.equal(windowsIssue([{ weekday: "dom", start: "22:00", end: "24:00" }]), null);
  });
  test("horários sempre em America/Sao_Paulo, qualquer que seja o fuso do aparelho", () => {
    const iso = "2026-12-02T17:00:00Z"; // 14:00 em São Paulo
    assert.equal(timeOf(iso), "14:00");
    assert.equal(dayKeyOf("2026-12-03T01:30:00Z"), "2026-12-02"); // ainda dia 2 em SP
    assert.match(lessonWhen(iso, "2026-12-02T18:00:00Z"), /2 de dezembro · 14:00–15:00$/);
  });
  test("agrupa horários livres por dia, em ordem", () => {
    const days = groupSlotsByDay(["2026-12-03T12:00:00Z", "2026-12-02T18:00:00Z", "2026-12-02T17:00:00Z"]);
    assert.deepEqual(days.map((d) => [d.key, d.slots.map((s) => s.time)]), [["2026-12-02", ["14:00", "15:00"]], ["2026-12-03", ["09:00"]]]);
  });
  test("retorno do Google: código, recusa ou inválido", () => {
    const state = "s".repeat(40);
    assert.deepEqual(parseCalendarReturn(`?code=4/abcdefghij&state=${state}`), { kind: "code", code: "4/abcdefghij", state });
    assert.deepEqual(parseCalendarReturn("?error=access_denied&state=x"), { kind: "denied" });
    assert.deepEqual(parseCalendarReturn("?code=curto&state=x"), { kind: "invalid" });
    assert.deepEqual(parseCalendarReturn(""), { kind: "invalid" });
  });
  test("só redireciona para o consentimento oficial do Google", () => {
    assert.ok(isGoogleAuthorizationUrl("https://accounts.google.com/o/oauth2/v2/auth?client_id=x"));
    assert.ok(!isGoogleAuthorizationUrl("https://accounts.google.com.evil.example/o/oauth2/v2/auth?x"));
    assert.ok(!isGoogleAuthorizationUrl("javascript:alert(1)"));
  });
});
