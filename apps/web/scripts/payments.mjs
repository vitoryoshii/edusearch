#!/usr/bin/env node
/**
 * Teste de navegador do CHECKOUT PIX (Fase 5) — reserva paga, Pix (QR + copia e cola), contagem,
 * consulta em backoff, confirmação pelo SERVIDOR, expiração, conflito e histórico.
 *
 * Servidor com VITE_STAGE_PROFILE_PERSISTENCE=testing, VITE_STAGE_SCHEDULING=testing e
 * VITE_STAGE_PAYMENTS=sandbox; Supabase/GIS FICTÍCIOS e a API num host fictício. A API falsa segue
 * docs/payments.md. As regras de verdade (valor, comissão, webhook autenticado, RLS, concorrência)
 * são testadas no backend (tests/db/test_payments_db.py). Aqui: o FRONTEND não envia valor,
 * comissão nem recebedor, não marca nada como pago por conta própria, e as telas são acessíveis.
 *
 *   node scripts/payments.mjs http://localhost:5194 [pasta-de-capturas]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp.mjs";

const base = (process.argv[2] ?? "http://localhost:5194").replace(/\/$/, "");
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });
const origin = new URL(base).origin;
const API_HOST = "api.edusearch-ci.test";
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const USERS = {
  T: { id: "00000000-0000-4000-8000-0000000000c3", email: "prof.t@example.com", name: "Professora Teste T", roles: ["teacher"] },
  S: { id: "00000000-0000-4000-8000-0000000000d4", email: "aluna.s@example.com", name: "Aluna Teste S", roles: ["student"] },
  U: { id: "00000000-0000-4000-8000-0000000000e5", email: "aluna.u@example.com", name: "Aluna Teste U", roles: ["student"] },
};
let currentUser = "T";

const b = await launch();
const failures = [];
const apiLog = [];
async function check(ok, msg) {
  if (ok) return console.log(`  ✓ ${msg}`);
  let page = {};
  try {
    page = await b.evaluate(`({ caminho: location.pathname + location.search, alertas: [...document.querySelectorAll('[role=alert],[role=status]')].map((e) => e.innerText.slice(0, 120)), texto: document.querySelector('main')?.innerText.slice(0, 300) ?? null })`);
  } catch (e) {
    page = { erro: String(e.message ?? e).slice(0, 120) };
  }
  const info = JSON.stringify({ ...page, usuario: currentUser, api: apiLog.slice(-4).map((r) => `${r.method} ${r.path} → ${r.status}`) });
  failures.push(`${msg}\n      diagnóstico: ${info}`);
  console.log(`  ✗ ${msg}\n      diagnóstico: ${info}`);
}
async function waitFor(expression, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await b.evaluate(expression)) return true;
    } catch {
      /* navegação */
    }
    await sleep(150);
  }
  return false;
}

/* --------------------------------- Mocks --------------------------------- */
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const decode = (jwt) => JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString());

const FAKE_GIS = `(() => {
  let cfg = null;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  window.google = { accounts: { id: {
    initialize(c) { cfg = c; },
    renderButton(el, o) { const btn = document.createElement("button"); btn.type = "button"; btn.dataset.fakeGis = ""; btn.textContent = "Continuar com o Google";
      btn.style.cssText = "width:" + (o.width || 320) + "px;height:40px"; btn.onclick = () => {
        const claims = { iss: "https://accounts.google.com", aud: cfg.client_id, sub: "g", email: "x@example.com", exp: Math.floor(Date.now() / 1000) + 3600, nonce: cfg.nonce };
        cfg.callback({ credential: b64({ alg: "RS256" }) + "." + b64(claims) + ".assinatura-ficticia", select_by: "btn" }); };
      el.appendChild(btn); },
    disableAutoSelect() {}, cancel() {},
  } } };
})();`;

function makeUser(key) {
  const u = USERS[key];
  return {
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: "2026-11-20T10:00:00Z",
    app_metadata: { provider: "google", providers: ["google"] }, user_metadata: { full_name: u.name, avatar_url: "https://lh3.googleusercontent.com/a/foto-ficticia=s96-c" },
    identities: [], created_at: "2026-11-20T10:00:00Z", updated_at: "2026-11-20T10:00:00Z",
  };
}
function makeSession(key) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = makeUser(key);
  return {
    access_token: `${b64url({ alg: "ES256", kid: "ci" })}.${b64url({ iss: "https://edusearch-ci-fake.supabase.co/auth/v1", sub: user.id, role: "authenticated", aud: "authenticated", exp, email: user.email })}.assinatura-ficticia`,
    token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: `refresh-${key}`, user,
  };
}

/* API falsa */
const NOW = new Date().toISOString();
const SUBJECTS = [{ slug: "matematica", name: "Matemática" }, { slug: "fisica", name: "Física" }];
const day = new Date(Date.now() + 2 * 86400000);
const slotAt = (h) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h + 3, 0)).toISOString(); // h:00 em SP
const SLOTS = [slotAt(9), slotAt(10), slotAt(14)];
const state = {
  noPhoto: false,
  calendar: "not_connected",
  issuedState: null,
  windows: [{ weekday: "seg", start: "09:00", end: "12:00" }],
  lessons: [], // { id, key, sub, starts_at, status }
  forceConflict: false,
  delay: {}, // caminho → ms
  fail: {}, // caminho → status
  payments: [], // { id, lessonId, key, sub, status, expires_at, polls, chargeReady }
  payOnPoll: null, // { id, after } → a "AbacatePay" confirma depois de N consultas
};
const PRICE = 8000;
const paymentOut = (p, sub) => {
  const l = state.lessons.find((x) => x.id === p.lessonId);
  const student = sub !== USERS.T.id;
  const pending = p.status === "pending";
  return {
    id: p.id, role: student ? "student" : "teacher", status: p.status, environment: "sandbox",
    amount_cents: PRICE, commission_bps: 1500, commission_cents: 1200, teacher_share_cents: 6800, currency: "BRL",
    br_code: student && pending && p.chargeReady ? "00020126580014br.gov.bcb.pix0136ficticio-" + p.id.slice(0, 8) + "5204000053039865406" : null,
    br_code_image: student && pending && p.chargeReady ? QR : null,
    expires_at: p.expires_at, paid_at: p.status === "paid" ? NOW : null, split_status: "not_applicable",
    charge_pending: pending && !p.chargeReady,
    lesson: { id: l.id, subject: l.subject, starts_at: l.starts_at, ends_at: new Date(Date.parse(l.starts_at) + l.duration * 60000).toISOString(), status: l.status,
      teacher_name: USERS.T.name, student_name: USERS.S.name, meet_url: l.status === "scheduled" ? "https://meet.google.com/abc-defg-hij" : null, calendar_sync_status: l.status === "scheduled" ? "synced" : "pending" },
    refund: null, created_at: NOW,
  };
};
// PNG 1×1 válido (o QR real vem da AbacatePay como data URI PNG).
const QR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const err = (status, code, detail) => [status, { detail, code }];
const lessonOut = (l, sub) => ({
  id: l.id, role: sub === USERS.T.id ? "teacher" : "student",
  teacher: { id: USERS.T.id, display_name: USERS.T.name }, student: { id: USERS.S.id, display_name: USERS.S.name },
  subject: l.subject, starts_at: l.starts_at, ends_at: new Date(Date.parse(l.starts_at) + l.duration * 60000).toISOString(),
  status: l.status, is_test: !l.paid, calendar_sync_status: l.status === "scheduled" ? "synced" : "pending",
  meet_url: l.status === "scheduled" ? "https://meet.google.com/abc-defg-hij" : null,
  payment: l.paid ? (({ id, status }) => ({ id, status, amount_cents: PRICE }))(state.payments.find((p) => p.lessonId === l.id)) : null,
  cancelled_at: l.status === "cancelled" ? NOW : null, cancelled_by_role: l.status === "cancelled" ? "student" : null, created_at: NOW,
});
/* Catálogo falso: T (real, logável) + Física + 14 extras, todos PUBLICADOS (o RLS real é testado no backend). */
const CATALOG = [
  { id: USERS.T.id, display_name: USERS.T.name, avatar_url: null, headline: "Matemática para ENEM com listas comentadas", subjects: ["matematica"], lesson_durations_minutes: [60, 45], modality: "online", experience: "3-5" },
  { id: "00000000-0000-4000-8000-0000000000f1", display_name: "Bruno Física", avatar_url: null, headline: "Física do básico ao vestibular", subjects: ["fisica"], lesson_durations_minutes: [60], modality: "presencial", experience: "1-3" },
  ...Array.from({ length: 14 }, (_, n) => ({ id: "00000000-0000-4000-8000-0000000001" + String(n).padStart(2, "0"), display_name: "Professora Extra " + String(n).padStart(2, "0"), avatar_url: null, headline: null, subjects: ["matematica"], lesson_durations_minutes: [60], modality: "hibrido", experience: null })),
].sort((a, b) => a.display_name.localeCompare(b.display_name));
const profileOf = (t) => ({ ...t, bio: "Professora fictícia de teste com foco em ENEM e vestibulares.", specialties: "ENEM, cálculo I", academic_background: "Licenciatura em Matemática", teaching_methods: ["exercicios", "pratica"], methodology: "Aulas com listas comentadas.", is_published: true, timezone: "America/Sao_Paulo" });
const catalogLog = [];

function api(method, path, sub, body, query = new URLSearchParams()) {
  const user = Object.values(USERS).find((u) => u.id === sub);
  if (path === "/v1/subjects") return [200, SUBJECTS];
  if (!user) return err(401, "not_authenticated", "Faça login para continuar.");
  const teacher = user.roles.includes("teacher");
  if (path === "/v1/me" && method === "GET")
    return [200, {
      id: sub, email: user.email, display_name: user.name, avatar_url: state.noPhoto ? null : "https://lh3.googleusercontent.com/a/foto-ficticia=s96-c", status: "onboarding", roles: user.roles,
      onboarding: { student: user.roles.includes("student") ? { status: "completed" } : null, teacher: teacher ? { status: "completed", verification_status: "approved", is_published: true } : null },
      created_at: NOW, updated_at: NOW,
    }];
  if (path === "/v1/me/student-profile" && method === "GET" && user.roles.includes("student"))
    return [200, { learning_goal: "ENEM", education_level: "medio", subjects: ["fisica", "matematica"], difficulty_areas: [], preferred_weekdays: ["seg"], preferred_periods: ["noite"], preferred_modality: "online", budget_min_cents: 5000, budget_max_cents: 8000, created_at: NOW, updated_at: NOW }];
  if (path === "/v1/scheduling/status") return [200, { stage: "testing", calendar_configured: true, payments_enabled: false, commercial_lessons_enabled: false }];
  if (path.startsWith("/v1/me/google-calendar") || path === "/v1/me/availability") {
    if (!teacher) return err(403, "role_required", "Disponível apenas para contas de professor.");
  }
  if (path === "/v1/me/google-calendar" && method === "GET") return [200, { status: state.calendar, connected_at: null, revoked_at: null }];
  if (path === "/v1/me/google-calendar/authorization" && method === "POST") {
    state.issuedState = `st-${"x".repeat(40)}`;
    return [200, { authorization_url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=ci&scope=calendar.events.owned&state=${state.issuedState}` }];
  }
  if (path === "/v1/me/google-calendar/connection" && method === "POST") {
    if (body?.state !== state.issuedState || body?.code !== "4/codigo-ficticio-123") return err(400, "invalid_state", "A autorização expirou ou é inválida.");
    state.calendar = "connected";
    return [200, { status: "connected", connected_at: NOW, revoked_at: null }];
  }
  if (path === "/v1/me/google-calendar" && method === "DELETE") {
    state.calendar = "not_connected";
    return [200, { status: "not_connected", connected_at: null, revoked_at: null }];
  }
  if (path === "/v1/me/availability" && method === "GET") return [200, { timezone: "America/Sao_Paulo", windows: state.windows }];
  if (path === "/v1/me/availability" && method === "PUT") {
    state.windows = body.windows;
    return [200, { timezone: "America/Sao_Paulo", windows: state.windows }];
  }
  if (path === "/v1/teachers" && method === "GET") {
    if (!user.roles.includes("student")) return err(403, "role_required", "Disponível apenas para contas de aluno.");
    catalogLog.push(Object.fromEntries(query));
    const q = (query.get("q") ?? "").toLowerCase();
    let list = CATALOG.filter((t) => t.id !== sub)
      .filter((t) => !q || t.display_name.toLowerCase().includes(q) || t.subjects.some((x) => x.includes(q)))
      .filter((t) => !query.get("subject") || t.subjects.includes(query.get("subject")))
      .filter((t) => !query.get("modality") || t.modality === query.get("modality") || t.modality === "hibrido");
    const limit = Number(query.get("limit") ?? 20);
    const offset = Number(query.get("offset") ?? 0);
    list = list.slice(offset, offset + limit).map((t) => ({ ...t, next_slot: t.id === USERS.T.id ? SLOTS[0] : null }));
    return [200, list];
  }
  const prof = path.match(/^\/v1\/teachers\/([^/]+)$/);
  if (prof && method === "GET") {
    const t = CATALOG.find((x) => x.id === prof[1]);
    if (!t) return err(404, "teacher_not_found", "Professor não encontrado.");
    return [200, { ...profileOf(t), is_own_profile: t.id === sub }];
  }
  if (path.startsWith("/v1/teachers/") && path.endsWith("/slots"))
    return [200, { timezone: "America/Sao_Paulo", duration_minutes: 60, slots: SLOTS.filter((s) => !state.lessons.some((l) => (l.status === "scheduled" || l.status === "awaiting_payment") && l.starts_at === s)) }];
  if (path === "/v1/lessons" && method === "POST") {
    const same = state.lessons.find((l) => l.key === body.idempotency_key && l.sub === sub);
    if (same) return [200, lessonOut(same, sub)];
    if (state.forceConflict || state.lessons.some((l) => l.status === "scheduled" && l.starts_at === body.starts_at)) {
      state.forceConflict = false;
      return err(409, "slot_unavailable", "Este horário acabou de ser reservado.");
    }
    const l = { id: crypto.randomUUID(), key: body.idempotency_key, sub, subject: body.subject, starts_at: body.starts_at, duration: body.duration_minutes, status: "scheduled" };
    state.lessons.push(l);
    return [201, lessonOut(l, sub)];
  }
  if (path === "/v1/me/lessons") return [200, state.lessons.filter((l) => sub === USERS.T.id || l.sub === sub).map((l) => lessonOut(l, sub))];
  const cancel = path.match(/^\/v1\/lessons\/([^/]+)\/cancel$/);
  if (cancel && method === "POST") {
    const l = state.lessons.find((x) => x.id === cancel[1] && (x.sub === sub || sub === USERS.T.id));
    if (!l) return err(404, "lesson_not_found", "Aula não encontrada.");
    l.status = "cancelled";
    return [200, lessonOut(l, sub)];
  }
  /* ---------------- Pagamentos (Fase 5) ---------------- */
  if (path === "/v1/payments/status") return [200, { stage: "sandbox", configured: true, commission_bps: 1500, split_enabled: false, hold_minutes: 15 }];
  if (path === "/v1/payments/checkout" && method === "POST") {
    const allowed = ["teacher_id", "subject", "starts_at", "duration_minutes", "idempotency_key"];
    if (Object.keys(body ?? {}).some((k) => !allowed.includes(k))) return err(422, "validation_error", "Campo não permitido.");
    const same = state.payments.find((p) => p.key === body.idempotency_key && p.sub === sub);
    if (same) return [200, paymentOut(same, sub)];
    if (state.forceConflict || state.lessons.some((l) => (l.status === "scheduled" || l.status === "awaiting_payment") && l.starts_at === body.starts_at)) {
      state.forceConflict = false;
      return err(409, "slot_unavailable", "Este horário acabou de ser reservado.");
    }
    const l = { id: crypto.randomUUID(), key: body.idempotency_key, sub, subject: body.subject, starts_at: body.starts_at, duration: body.duration_minutes, status: "awaiting_payment", paid: true };
    state.lessons.push(l);
    const p = { id: crypto.randomUUID(), lessonId: l.id, key: body.idempotency_key, sub, status: "pending", expires_at: new Date(Date.now() + 15 * 60000).toISOString(), polls: 0, chargeReady: !state.chargeSlow };
    state.chargeSlow = false;
    state.payments.push(p);
    return [201, paymentOut(p, sub)];
  }
  const pay = path.match(/^\/v1\/payments\/([^/]+)(\/simulate)?$/);
  if (pay && !["status", "checkout", "webhooks"].includes(pay[1])) {
    const p = state.payments.find((x) => x.id === pay[1] && (x.sub === sub || sub === USERS.T.id));
    if (!p) return err(404, "payment_not_found", "Pagamento não encontrado.");
    const l = state.lessons.find((x) => x.id === p.lessonId);
    if (pay[2] && method === "POST") {
      if (p.status !== "pending") return err(409, "payment_not_pending", "Este pagamento não está aguardando Pix.");
      p.status = "paid";
      l.status = "scheduled";
      return [200, paymentOut(p, sub)];
    }
    if (method === "GET" && p.status === "pending") {
      p.polls += 1;
      p.chargeReady = true;
      if (Date.parse(p.expires_at) <= Date.now()) {
        p.status = "expired";
        l.status = "expired";
      } else if (state.payOnPoll?.id === p.id && p.polls >= state.payOnPoll.after) {
        // O servidor recebeu o webhook (ou conciliou): só ele muda o estado.
        p.status = "paid";
        l.status = "scheduled";
      }
    }
    return [200, paymentOut(p, sub)];
  }
  if (path === "/v1/me/payments") return [200, state.payments.filter((p) => sub === USERS.T.id || p.sub === sub).map((p) => paymentOut(p, sub)).reverse()];
  return err(404, "not_found", "Recurso não encontrado.");
}

await b.send("Fetch.enable", {
  patterns: [
    { urlPattern: "*accounts.google.com*", requestStage: "Request" },
    { urlPattern: "*supabase.co*", requestStage: "Request" },
    { urlPattern: "*googleusercontent.com*", requestStage: "Request" },
    { urlPattern: `*${API_HOST}*`, requestStage: "Request" },
  ],
});
let googleConsentMode = "grant"; // grant | deny
b.on(async (m) => {
  if (m.method !== "Fetch.requestPaused") return;
  const { requestId, request } = m.params;
  const url = new URL(request.url);
  const reply = (status, body, type = "application/json") =>
    b.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: status,
      responseHeaders: [
        { name: "Content-Type", value: type },
        { name: "Access-Control-Allow-Origin", value: origin },
        { name: "Access-Control-Allow-Headers", value: "authorization, apikey, content-type, x-client-info, x-supabase-api-version" },
        // A API real libera GET, POST, PUT, DELETE (desconectar a agenda) e OPTIONS.
        { name: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
      ],
      body: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)).toString("base64"),
    });
  if (url.host === "accounts.google.com" && url.pathname === "/o/oauth2/v2/auth") {
    const st = url.searchParams.get("state");
    const back = googleConsentMode === "deny" ? `${base}/conta/agenda/google/retorno?error=access_denied&state=${st}` : `${base}/conta/agenda/google/retorno?code=4/codigo-ficticio-123&state=${st}`;
    return reply(200, `<!doctype html><title>Google</title><script>location.replace(${JSON.stringify(back)})</script>`, "text/html");
  }
  if (url.host === "accounts.google.com") return reply(200, FAKE_GIS, "text/javascript");
  // Usuários COM foto, como em persistence.mjs. (Sem foto, o avatar do menu do cabeçalho mostra
  // iniciais e o axe acusa label-content-name-mismatch — problema anterior, fora da agenda.)
  if (url.host.endsWith("googleusercontent.com"))
    return reply(200, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#146A7A"/></svg>`, "image/svg+xml");
  if (request.method === "OPTIONS") return reply(204, "");
  const bearer = String(request.headers.Authorization ?? request.headers.authorization ?? "").replace(/^Bearer /, "");
  let claims = null;
  try {
    claims = bearer ? decode(bearer) : null;
  } catch {
    claims = null;
  }
  if (url.host === API_HOST) {
    let body = null;
    try {
      body = request.postData ? JSON.parse(request.postData) : null;
    } catch {
      body = null;
    }
    if (state.delay[url.pathname]) await sleep(state.delay[url.pathname]);
    if (state.fail[url.pathname] && request.method === "GET") {
      apiLog.push({ method: request.method, path: url.pathname, sub: claims?.sub ?? null, body, status: state.fail[url.pathname] });
      return reply(state.fail[url.pathname], { detail: "Serviço temporariamente indisponível. Tente novamente.", code: "database_unavailable" });
    }
    const [status, payload] = api(request.method, url.pathname, claims?.sub ?? null, body, url.searchParams);
    apiLog.push({ method: request.method, path: url.pathname, sub: claims?.sub ?? null, body, status });
    return reply(status, payload);
  }
  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "id_token") return reply(200, makeSession(currentUser));
  if (url.pathname === "/auth/v1/user") return reply(200, makeUser(Object.keys(USERS).find((k) => USERS[k].id === claims?.sub) ?? currentUser));
  if (url.pathname === "/auth/v1/logout") return reply(204, "");
  return reply(404, "{}");
});

/* ------------------------------- Auxiliares ------------------------------- */
const PAGE_TEXT = `document.body.innerText.replace(/[\\u00a0\\u202f]/g, ' ')`;
const text = (s) => `${PAGE_TEXT}.includes(${JSON.stringify(s)})`;
async function act(label, expression) {
  const ok = await b.evaluate(expression).catch(() => false);
  if (!ok) await check(false, `ação: ${label}`);
  await sleep(200);
}
const clickButton = (label, scope = "") =>
  act(`botão ${label}`, `(() => { const x = [...document.querySelectorAll('${scope} button')].find((y) => y.textContent.trim() === ${JSON.stringify(label)} && !y.disabled); if (!x) return false; x.click(); return true; })()`);
const storageDump = `[localStorage, sessionStorage].flatMap((st) => Object.keys(st).map((k) => k + '=' + st.getItem(k))).join('\\n')`;
async function signIn(key) {
  currentUser = key;
  await b.go(base + "/", 1500);
  await waitFor(`!!document.querySelector('[data-fake-gis]')`);
  await act("botão do Google", `(() => { document.querySelector('[data-fake-gis]').click(); return true; })()`);
  await waitFor(`location.pathname.startsWith('/conta')`);
}
async function signOut() {
  await b.go(base + "/conta/configuracoes", 1500);
  await waitFor(text("Conta e sessão"));
  await clickButton("Sair da conta");
  await waitFor(`location.pathname === '/' && localStorage.getItem('edusearch-auth') === null`);
}
async function axe(label) {
  await waitFor(`document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)`, 4000);
  if (!(await b.evaluate("!!window.axe"))) await b.evaluate(`${AXE};1`);
  const v = await b.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"] } }).then((r) => r.violations.map((v) => v.id + " (" + v.nodes.length + "): " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")))`);
  await check(v.length === 0, `acessibilidade (axe): ${label}${v.length ? " — " + v.join("; ") : ""}`);
}
async function shot(name, widths = [320, 390, 768, 1440]) {
  const overflow = [];
  for (const w of widths)
    for (const dark of [false, true]) {
      await b.viewport(w, { dark });
      await sleep(300);
      if (await b.evaluate(`document.documentElement.scrollWidth > innerWidth + 1 || innerWidth > ${w} + 1`)) overflow.push(`${w}px ${dark ? "escuro" : "claro"}`);
      if (shots) await b.screenshot(join(shots, `${name}-${w}-${dark ? "escuro" : "claro"}.png`));
    }
  await b.viewport(1280);
  await sleep(150);
  await check(overflow.length === 0, `${name}: sem rolagem horizontal em ${widths.join("/")} px, claro e escuro${overflow.length ? " — " + overflow.join(", ") : ""}`);
}
const calendarStatus = `document.querySelector('[data-testid=calendar-status]')?.dataset.status`;

/**
 * Nenhum elemento dos cartões da agenda passa da borda do PRÓPRIO cartão (mais rigoroso que "sem
 * rolagem": um campo pode vazar do cartão sem chegar à borda da tela). Com `stress`, simula o
 * controle nativo de horário largo do Chrome em inglês ("09:00 AM", CI Linux) em qualquer máquina.
 */
const CARDS = ["calendar-card", "availability-card", "booking-card", "lesson-list", "teacher-profile", "catalog-filters", "catalog-results"];
async function fitsInCards(label, { stress = false, widths = [320, 360, 390, 430, 768, 1440] } = {}) {
  if (stress) await b.evaluate(`(() => { const s = document.createElement('style'); s.id = 'stress-time'; s.textContent = 'input[type=time]{min-width:9.5rem}'; document.head.append(s); return true; })()`);
  const bad = [];
  for (const w of widths)
    for (const dark of [false, true]) {
      await b.viewport(w, { dark });
      await sleep(300);
      const r = await b.evaluate(`(() => {
        const out = [];
        if (document.documentElement.scrollWidth > innerWidth + 1) out.push('página ' + document.documentElement.scrollWidth + '>' + innerWidth);
        for (const id of ${JSON.stringify(CARDS)}) {
          const card = document.querySelector('[data-testid=' + id + ']');
          if (!card) continue;
          const c = card.getBoundingClientRect();
          for (const el of card.querySelectorAll('*')) {
            const e = el.getBoundingClientRect();
            if (e.width === 0 || e.height === 0 || getComputedStyle(el).position === 'fixed') continue;
            if (e.right > c.right + 0.5 || e.left < c.left - 0.5) {
              out.push(id + ' > ' + el.tagName.toLowerCase() + (el.getAttribute('type') ? '[' + el.getAttribute('type') + ']' : '') + ' ' + Math.round(e.left) + '–' + Math.round(e.right) + ' (cartão ' + Math.round(c.left) + '–' + Math.round(c.right) + ')');
              break;
            }
          }
        }
        return out.join('; ');
      })()`);
      if (r) bad.push(`${w}px ${dark ? "escuro" : "claro"}: ${r}`);
    }
  if (stress) await b.evaluate(`document.getElementById('stress-time')?.remove() || true`);
  await b.viewport(1280);
  await sleep(150);
  await check(bad.length === 0, `${label}: nada vaza dos cartões em 320/360/390/430/768/1440 px, claro e escuro${bad.length ? " — " + bad.slice(0, 4).join(" | ") : ""}`);
}


const CARDS2 = ["payment", "payment-summary", "pix-card", "booking-card", "payment-list"];
async function fitsPayment(label, widths = [320, 360, 390, 430, 768, 1440]) {
  const bad = [];
  for (const w of widths)
    for (const dark of [false, true]) {
      await b.viewport(w, { dark });
      await sleep(300);
      const r = await b.evaluate(`(() => {
        const out = [];
        if (document.documentElement.scrollWidth > innerWidth + 1) out.push('página ' + document.documentElement.scrollWidth + '>' + innerWidth);
        for (const id of ${JSON.stringify(CARDS2)}) {
          const card = document.querySelector('[data-testid=' + id + ']');
          if (!card) continue;
          const c = card.getBoundingClientRect();
          for (const el of card.querySelectorAll('*')) {
            const e = el.getBoundingClientRect();
            if (e.width === 0 || e.height === 0) continue;
            if (e.right > c.right + 0.5 || e.left < c.left - 0.5) { out.push(id + ' > ' + el.tagName.toLowerCase()); break; }
          }
        }
        return out.join('; ');
      })()`);
      if (r) bad.push(`${w}px ${dark ? "escuro" : "claro"}: ${r}`);
      if (shots) await b.screenshot(join(shots, `${label}-${w}-${dark ? "escuro" : "claro"}.png`));
    }
  await b.viewport(1280);
  await sleep(150);
  await check(bad.length === 0, `${label}: nada vaza dos cartões nem da tela (320→1440 px, claro e escuro)${bad.length ? " — " + bad.slice(0, 4).join(" | ") : ""}`);
}
const payStatus = `document.querySelector('[data-testid=payment]')?.dataset.status`;
const pick = (time) => act(`escolher ${time}`, `(() => { const x = [...document.querySelectorAll('[data-testid=slot-list] button')].find((y) => y.textContent.trim() === '${time}'); if (!x) return false; x.click(); return true; })()`);

/* ------------------------------ 1. Aluna: reserva paga ------------------------------ */
console.log("Checkout Pix");
await signIn("S");
await check(await b.evaluate(`[...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/conta/pagamentos')`), "menu da conta tem \"Pagamentos\"");
await b.go(base + `/conta/professores/${USERS.T.id}`, 1500);
await check(await waitFor("document.querySelectorAll('[data-testid=slot-list] button').length === 3"), "horários livres no perfil");
await check(await waitFor(text("Reservar e pagar com Pix") + " && " + text("sem dinheiro real")), "botão de reserva paga e aviso de ambiente de testes");
await pick("09:00");
await act("reservar e pagar (clique duplo)", "(() => { const x = document.querySelector('[data-testid=book-lesson]'); x.click(); x.click(); return true; })()");
await check(await waitFor(`location.pathname.startsWith('/conta/pagamentos/') && ${payStatus} === 'pending'`), "vai para o checkout com o Pix pendente");
const checkouts = apiLog.filter((r) => r.method === "POST" && r.path === "/v1/payments/checkout");
await check(checkouts.length >= 1 && new Set(checkouts.map((r) => r.body.idempotency_key)).size === 1 && state.payments.length === 1, "clique duplo: uma reserva e um Pix (mesma chave de idempotência)");
const sent = checkouts[0]?.body ?? {};
await check(Object.keys(sent).sort().join(",") === "duration_minutes,idempotency_key,starts_at,subject,teacher_id", "checkout envia só professor, disciplina, horário, duração e chave — sem valor, comissão ou recebedor");
await check(await waitFor("document.querySelector('[data-testid=pix-qr]')?.naturalWidth > 0 && document.querySelector('[data-testid=pix-code]')?.value.startsWith('000201')"), "QR Code (data URI PNG) e Pix copia e cola");
await check(await waitFor(`/^1[45]:\\d\\d$/.test(document.querySelector('[data-testid=pix-countdown]')?.innerText.trim() ?? '')`), "contagem regressiva do Pix (15 min)");
await check(await b.evaluate(text("R$ 80,00")) && !(await b.evaluate(text("R$ 68,00"))), "valor vindo do servidor; aluno não vê o repasse do professor");
await check(await b.evaluate("!!document.querySelector('[data-testid=sandbox-notice]') && !!document.querySelector('[data-testid=pix-simulate]')"), "sandbox: aviso e botão de simulação do Modo Teste");
await b.evaluate("navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; true");
await act("copiar código", "(() => { document.querySelector('[data-testid=pix-copy]').click(); return true; })()");
await check(await waitFor("String(window.__copied).startsWith('000201') && document.querySelector('[data-testid=pix-copy]').innerText.includes('copiado')"), "copiar o Pix copia e cola");
await axe("checkout Pix");
await fitsPayment("checkout-pix");

/* O navegador não decide: só o estado do servidor muda a tela. */
const pid = state.payments[0].id;
const pollsBefore = apiLog.filter((r) => r.path === `/v1/payments/${pid}`).length;
await b.go(base + `/conta/pagamentos/${pid}?status=paid&paid=true`, 1500);
await sleep(1000);
await check((await b.evaluate(payStatus)) === "pending", "parâmetros na URL não marcam a aula como paga");
state.payOnPoll = { id: pid, after: state.payments[0].polls + 2 };
await check(await waitFor(`${payStatus} === 'paid'`, 20000), "consulta periódica reflete a confirmação do servidor (webhook)");
const polls = apiLog.filter((r) => r.path === `/v1/payments/${pid}`).length - pollsBefore;
await check(polls >= 2 && polls <= 6, `consulta em backoff, sem martelar a API (${polls} consultas)`);
await check(await waitFor("!!document.querySelector('[data-testid=payment-meet]') && !document.querySelector('[data-testid=pix-code]')"), "pago: link do Meet aparece e o Pix some");
await sleep(3500);
const after = apiLog.filter((r) => r.path === `/v1/payments/${pid}`).length;
await sleep(4000);
await check(apiLog.filter((r) => r.path === `/v1/payments/${pid}`).length === after, "estado final: a consulta periódica para");
await axe("pagamento confirmado");
await fitsPayment("pagamento-confirmado", [320, 768, 1440]);

/* Minhas aulas: aula paga confirmada */
await b.go(base + "/conta/aulas", 1500);
await check(await waitFor("[...document.querySelectorAll('[data-testid=lesson-row]')].some((r) => r.dataset.status === 'scheduled' && r.querySelector('[data-testid=lesson-payment]'))"), "Minhas aulas: aula paga confirmada com atalho para o pagamento");

/* ------------------------------ 2. Simulação (sandbox) e expiração ------------------------------ */
await b.go(base + `/conta/professores/${USERS.T.id}`, 1500);
await check(await waitFor("document.querySelectorAll('[data-testid=slot-list] button').length === 2"), "horário pago saiu da lista de livres");
await pick("10:00");
await act("reservar 10:00", "(() => { document.querySelector('[data-testid=book-lesson]').click(); return true; })()");
await check(await waitFor(`${payStatus} === 'pending' && !!document.querySelector('[data-testid=pix-simulate]')`), "segundo checkout pendente");
await act("simular pagamento", "(() => { document.querySelector('[data-testid=pix-simulate]').click(); return true; })()");
await check(await waitFor(`${payStatus} === 'paid'`), "simulação do Modo Teste → servidor confirma");

await b.go(base + "/conta/aulas", 1500);
await b.go(base + `/conta/professores/${USERS.T.id}`, 1500);
await pick("14:00");
state.chargeSlow = true;
await act("reservar 14:00", "(() => { document.querySelector('[data-testid=book-lesson]').click(); return true; })()");
await check(await waitFor("!!document.querySelector('[data-testid=pix-generating]')"), "gateway lento: \"Gerando o Pix\" com o horário já reservado");
await check(await waitFor("!!document.querySelector('[data-testid=pix-code]')", 12000), "Pix aparece quando o servidor consegue gerá-lo");
const third = state.payments[2];
third.expires_at = new Date(Date.now() - 1000).toISOString();
await check(await waitFor(`${payStatus} === 'expired' && !!document.querySelector('[data-testid=payment-expired]')`, 20000), "Pix expirado: estado claro e convite para reservar de novo");
await axe("Pix expirado");

/* ------------------------------ 3. Conflito e histórico ------------------------------ */
await b.go(base + `/conta/professores/${USERS.T.id}`, 1500);
await check(await waitFor("document.querySelectorAll('[data-testid=slot-list] button').length >= 1"), "horário do Pix expirado volta a ficar livre");
await pick("14:00");
state.forceConflict = true;
await act("reservar com conflito", "(() => { document.querySelector('[data-testid=book-lesson]').click(); return true; })()");
await check(await waitFor(text("Este horário acabou de ser reservado.")), "409: horário tomado por outra pessoa");
await check((await b.evaluate("location.pathname.startsWith('/conta/professores/')")), "409: continua no perfil para escolher outro horário");

await b.go(base + "/conta/pagamentos", 1500);
await check(await waitFor("document.querySelectorAll('[data-testid=payment-row]').length === 3"), "histórico: três pagamentos");
await check(await b.evaluate("[...document.querySelectorAll('[data-testid=payment-row]')].map((r) => r.dataset.status).sort().join() === 'expired,paid,paid'"), "histórico: estados vindos do servidor");
await axe("histórico de pagamentos");
await fitsPayment("historico", [320, 768, 1440]);

/* ------------------------------ 4. Professor ------------------------------ */
await signOut();
await signIn("T");
await b.go(base + `/conta/pagamentos/${pid}`, 1500);
await check(await waitFor(`${payStatus} === 'paid'`), "professor vê o pagamento da aula dele");
await check(await waitFor(text("R$ 68,00") + " && " + text("R$ 12,00")), "professor vê comissão (15%) e a parte dele, calculadas pelo servidor");
await check(!(await b.evaluate("!!document.querySelector('[data-testid=pix-code]') || !!document.querySelector('[data-testid=pix-simulate]')")), "professor não vê Pix nem simulação");
await axe("pagamento (professor)");

/* ------------------------------ Resultado ------------------------------ */
const errs = b.errors.filter((e) => !/status of (401|403|404|409|422|503)|ERR_FAILED|supabase\.co|edusearch-ci\.test|googleusercontent/.test(e));
await check(errs.length === 0, `sem erros de console inesperados${errs.length ? " — " + errs.slice(0, 3).join(" | ") : ""}`);
await check(!(await b.evaluate(`${storageDump}.includes('000201')`)), "Pix copia e cola não fica guardado no navegador");
await b.close();
if (failures.length) {
  console.log(`\n${failures.length} falha(s):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nCheckout Pix: todas as verificações passaram.");
