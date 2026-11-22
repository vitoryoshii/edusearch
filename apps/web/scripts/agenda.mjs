#!/usr/bin/env node
/**
 * Teste de navegador da AGENDA REAL (Fase 3A) — Google Agenda/Meet, disponibilidade e aulas de teste.
 *
 * Servidor com VITE_STAGE_PROFILE_PERSISTENCE=testing e VITE_STAGE_SCHEDULING=testing, Supabase/GIS
 * FICTÍCIOS e VITE_API_BASE_URL num host fictício. Mocks SOMENTE deste teste (DevTools/Fetch):
 *   - accounts.google.com/gsi/client  → GIS falso (login);
 *   - accounts.google.com/o/oauth2/v2/auth → "consentimento" falso que volta ao app com ?code&state;
 *   - *.supabase.co                    → Supabase falso (professor T e aluna S);
 *   - api.edusearch-ci.test            → API falsa em memória seguindo docs/api-contract.md.
 * Regras de verdade (RLS, conflitos, cifragem, Google) são testadas no backend (tests/db). Aqui:
 * o FRONTEND nunca guarda tokens/códigos do Google, só manda o código à API com a sessão atual,
 * respeita idempotência e conflitos, e as telas são acessíveis e responsivas.
 *
 *   node scripts/agenda.mjs http://localhost:5193 [pasta-de-capturas]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp.mjs";

const base = (process.argv[2] ?? "http://localhost:5193").replace(/\/$/, "");
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });
const origin = new URL(base).origin;
const API_HOST = "api.edusearch-ci.test";
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const USERS = {
  T: { id: "00000000-0000-4000-8000-0000000000c3", email: "prof.t@example.com", name: "Professora Teste T", roles: ["teacher"] },
  S: { id: "00000000-0000-4000-8000-0000000000d4", email: "aluna.s@example.com", name: "Aluna Teste S", roles: ["student"] },
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
  calendar: "not_connected",
  issuedState: null,
  windows: [{ weekday: "seg", start: "09:00", end: "12:00" }],
  lessons: [], // { id, key, sub, starts_at, status }
  forceConflict: false,
};
const err = (status, code, detail) => [status, { detail, code }];
const lessonOut = (l, sub) => ({
  id: l.id, role: sub === USERS.T.id ? "teacher" : "student",
  teacher: { id: USERS.T.id, display_name: USERS.T.name }, student: { id: USERS.S.id, display_name: USERS.S.name },
  subject: l.subject, starts_at: l.starts_at, ends_at: new Date(Date.parse(l.starts_at) + l.duration * 60000).toISOString(),
  status: l.status, is_test: true, calendar_sync_status: l.status === "cancelled" ? "removed" : "synced",
  meet_url: l.status === "cancelled" ? null : "https://meet.google.com/abc-defg-hij",
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
      id: sub, email: user.email, display_name: user.name, avatar_url: "https://lh3.googleusercontent.com/a/foto-ficticia=s96-c", status: "onboarding", roles: user.roles,
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
    return [200, { timezone: "America/Sao_Paulo", duration_minutes: 60, slots: SLOTS.filter((s) => !state.lessons.some((l) => l.status === "scheduled" && l.starts_at === s)) }];
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

/* ------------------------------ 1. Professor: Google Agenda ------------------------------ */
console.log("Professor");
b.setStep?.("professor");
await signIn("T");
await waitFor("!!document.querySelector('main h1')");
await shot("painel-professor", [320, 390, 768, 1440]);
await check(await waitFor("!!document.querySelector('[data-testid=teacher-overview]') && document.querySelector('[data-testid=next-lesson]')?.dataset.state === 'empty'"), "painel do professor: indicadores e próxima aula (vazia)");
await check(await waitFor("!!document.querySelector('[data-testid=teacher-checklist]')"), "painel do professor: o que falta para receber reservas");
await check(!(await b.evaluate("!!document.querySelector('[data-testid=student-shortcuts]')")), "professor não vê atalhos de aluno");
await axe("painel do professor");
await check(await b.evaluate(`[...document.querySelectorAll('nav a')].some((a) => a.getAttribute('href') === '/conta/agenda')`), "menu da conta tem \"Agenda\"");
await b.go(base + "/conta/agenda", 1500);
await check(await waitFor(`${calendarStatus} === 'not_connected' && !!document.querySelector('[data-testid=scheduling-test-notice]')`), "agenda: aviso de aulas de teste e Google Agenda não conectada");
await check(!(await b.evaluate(`!!document.querySelector('[data-testid=booking-card]')`)), "professor não vê o formulário de reserva de aluno");
await axe("agenda do professor");

await act("Conectar Google Agenda", `(() => { document.querySelector('[data-testid=calendar-connect]').click(); return true; })()`);
await check(await waitFor(`location.pathname === '/conta/agenda' && ${calendarStatus} === 'connected'`, 12000), "consentimento → retorno → API conecta a agenda");
const conn = apiLog.find((r) => r.path === "/v1/me/google-calendar/connection");
await check(conn?.sub === USERS.T.id && conn?.body?.code === "4/codigo-ficticio-123" && conn?.body?.state === state.issuedState, "código e state enviados à API com o token da sessão do professor");
await check(apiLog.filter((r) => r.path === "/v1/me/google-calendar/connection").length === 1, "código de uso único enviado UMA vez (StrictMode)");
await check(!(await b.evaluate(`location.search.includes('code') || ${storageDump}.includes('codigo-ficticio')`)), "código do Google fora da URL e do armazenamento do navegador");

googleConsentMode = "deny";
await b.go(base + "/conta/agenda/google/retorno?error=access_denied&state=x", 1500);
await check(await waitFor(`location.pathname === '/conta/agenda'`), "recusa no Google volta para a agenda sem chamar a API");
await check(apiLog.filter((r) => r.path === "/v1/me/google-calendar/connection").length === 1, "recusa não envia código");
await check((await b.evaluate(`[...document.querySelectorAll('[role=status],[role=alert]')].filter((e) => e.innerText.includes('A permissão não foi concedida.')).length`)) === 1, "recusa mostra o aviso UMA vez (StrictMode)");
googleConsentMode = "grant";

/* Disponibilidade */
await waitFor(`!!document.querySelector('[data-testid=availability-card] input[type=time]')`);
await clickButton("Adicionar janela", "[data-testid=availability-card]");
await check(await waitFor(text("há janelas sobrepostas")), "janela sobreposta: aviso e salvar desabilitado");
await check(await b.evaluate(`[...document.querySelectorAll('[data-testid=availability-card] button')].find((x) => x.textContent.trim() === 'Salvar disponibilidade')?.disabled === true`), "salvar fica desabilitado com janelas inválidas");
await act("mudar dia da nova janela", `(() => { const s = [...document.querySelectorAll('[data-testid=availability-card] select')][1]; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'qua'); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await clickButton("Salvar disponibilidade", "[data-testid=availability-card]");
const put = apiLog.filter((r) => r.method === "PUT" && r.path === "/v1/me/availability").at(-1);
await check(put?.body?.windows?.length === 2 && put.body.windows[1].weekday === "qua", "disponibilidade salva com PUT /v1/me/availability");
await shot("agenda-professor");
await fitsInCards("agenda do professor");
await fitsInCards("agenda do professor com horário nativo largo (Chrome en-US)", { stress: true });
await check(
  await b.evaluate(`[...document.querySelectorAll('[data-testid=availability-row]')].every((row) => ['Dia', 'Início', 'Fim'].every((l) => [...row.querySelectorAll('label')].some((x) => x.textContent.trim() === l && x.offsetWidth > 0)))`),
  "cada janela tem rótulos visíveis (Dia, Início, Fim)",
);

/* Remover uma janela */
await act("remover a janela de quarta", `(() => { const x = document.querySelector('[aria-label="Remover janela de Quarta"]'); if (!x) return false; x.click(); return true; })()`);
await check(await waitFor(`document.querySelectorAll('[data-testid=availability-row]').length === 1`), "lixeira remove a janela da lista");
await clickButton("Salvar disponibilidade", "[data-testid=availability-card]");
await sleep(300);
const afterRemove = apiLog.filter((r) => r.method === "PUT" && r.path === "/v1/me/availability").at(-1);
await check(afterRemove?.body?.windows?.length === 1 && afterRemove.body.windows[0].weekday === "seg", "remoção salva (PUT com uma janela)");

/* Desconectar */
await clickButton("Desconectar", "[data-testid=calendar-card]");
await clickButton("Confirmar desconexão", "[data-testid=calendar-card]");
await check(await waitFor(`${calendarStatus} === 'not_connected'`) && apiLog.some((r) => r.method === "DELETE" && r.path === "/v1/me/google-calendar"), "desconectar: confirmação em dois passos e DELETE na API");

/* Menu e perfil profissional do professor */
await check(
  await b.evaluate(`JSON.stringify([...document.querySelector('nav[aria-label="Navegação principal"]').querySelectorAll('a')].map((a) => a.getAttribute('href'))) === JSON.stringify(['/conta','/conta/agenda','/conta/aulas','/conta/perfil-profissional','/conta/configuracoes'])`),
  "menu do professor: Painel, Agenda, Aulas, Perfil profissional, Configurações (sem Explorar)",
);
await b.go(base + "/conta/perfil-profissional", 1500);
await check(await waitFor(`!!document.querySelector('[data-testid=own-preview]') && !document.querySelector('[data-testid=booking-card]')`), "perfil profissional: pré-visualização do próprio perfil, sem reserva");
await b.go(base + "/conta/explorar", 1500);
await check(await waitFor(`location.pathname === '/conta'`), "professor não acessa Explorar (volta ao painel)");

/* ------------------------------ 2. Aluna: marketplace ------------------------------ */
console.log("Aluna");
await signOut();
await signIn("S");
await waitFor("!!document.querySelector('main h1')");
await shot("inicio-aluna", [320, 390, 768, 1440]);
await check(await waitFor("!!document.querySelector('[data-testid=student-shortcuts]') && !document.querySelector('[data-testid=teacher-overview]')"), "início da aluna: busca e atalhos, sem blocos de professor");
await check(await waitFor("[...document.querySelectorAll('[data-testid=student-shortcuts] a')].map((a) => a.getAttribute('href')).join(',') === '/conta/explorar?materia=fisica,/conta/explorar?materia=matematica'"), "atalhos com as disciplinas do PRÓPRIO cadastro do aluno");
await axe("início da aluna");

/* URLs legadas da demonstração → telas reais (sem levar IDs fictícios) */
await b.go(base + "/aluno/buscar", 1500);
await check(await waitFor("location.pathname === '/conta/explorar'"), "URL legada /aluno/buscar → /conta/explorar");
await b.go(base + "/aluno/professores/demo-1", 1500);
await check(await waitFor("location.pathname === '/conta/explorar'"), "URL legada de perfil da demo → Explorar (ID fictício descartado)");
await b.go(base + "/aluno/aulas", 1500);
await check(await waitFor("location.pathname === '/conta/aulas'"), "URL legada /aluno/aulas → /conta/aulas");
await b.go(base + "/conta", 1500);
await check(
  await waitFor(`JSON.stringify([...document.querySelector('nav[aria-label="Navegação principal"]').querySelectorAll('a')].map((a) => a.getAttribute('href'))) === JSON.stringify(['/conta','/conta/explorar','/conta/aulas','/conta/perfil','/conta/configuracoes'])`),
  "menu da aluna: Início, Explorar, Aulas, Perfil, Configurações (sem a Agenda do professor)",
);
await b.go(base + "/conta/agenda", 1500);
await check(await waitFor("location.pathname === '/conta/aulas'"), "URL antiga /conta/agenda leva a aluna para Minhas aulas");

/* Explorar: catálogo real, filtros na URL, paginação */
await b.go(base + "/conta/explorar", 1500);
await check(await waitFor("document.querySelectorAll('[data-testid=teacher-result]').length === 12"), "catálogo: primeira página com 12 professores");
await act("carregar mais", "(() => { document.querySelector('[data-testid=catalog-more]').click(); return true; })()");
await check(await waitFor("document.querySelectorAll('[data-testid=teacher-result]').length === 16 && !document.querySelector('[data-testid=catalog-more]')"), "\"Carregar mais\" traz a página 2 (16 no total) e some no fim");
await check(catalogLog.some((c) => c.offset === "12" && c.limit === "12"), "paginação por limit/offset na API");
const demoWords = ["fictíci", "R$", "avalia", "★", "certificad", "Pix"];
await check(!(await b.evaluate(`${JSON.stringify(demoWords)}.some((w) => document.querySelector('main').innerText.includes(w))`)), "jornada real sem dados de demonstração, preço, avaliação ou certificado");
await act("filtrar Física", "(() => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === 'Disciplina'); const s = document.getElementById(l.htmlFor); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'fisica'); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
await check(await waitFor("location.search.includes('materia=fisica') && document.querySelectorAll('[data-testid=teacher-result]').length === 1"), "filtro por disciplina reflete na URL e na lista");
await b.go(base + "/conta/explorar?materia=quimica", 1500);
await check(await waitFor("!!document.querySelector('[data-testid=catalog-empty]')"), "estado vazio quando nenhum professor atende");
await b.go(base + "/conta/explorar", 1500);
await waitFor("!!document.querySelector('[data-testid=catalog-filters] input')");
await act("buscar por nome", "(() => { const i = document.querySelector('[data-testid=catalog-filters] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Teste T'); i.dispatchEvent(new Event('input', { bubbles: true })); i.form.requestSubmit(); return true; })()");
await check(await waitFor("document.querySelectorAll('[data-testid=teacher-result]').length === 1 && location.search.includes('q=Teste')"), "busca por nome");
await check(await waitFor(text("Próximo horário:")), "card mostra o próximo horário livre");
await axe("explorar");
await shot("explorar", [320, 360, 390, 430, 768, 1440]);
await fitsInCards("explorar");

/* Perfil público + reserva */
await act("abrir perfil", "(() => { document.querySelector('[data-testid=teacher-result] h2 a').click(); return true; })()");
await check(await waitFor(`location.pathname === '/conta/professores/${USERS.T.id}' && !!document.querySelector('[data-testid=teacher-profile]')`), "perfil público do professor");
await check((await waitFor(text("Licenciatura em Matemática"))) && (await b.evaluate(text("Aulas com listas comentadas."))), "perfil mostra formação e metodologia do cadastro real");
await check(await waitFor("document.querySelectorAll('[data-testid=slot-list] button').length === 3"), "horários livres no perfil");
await act("escolher 09:00", "(() => { const x = [...document.querySelectorAll('[data-testid=slot-list] button')].find((y) => y.textContent.trim() === '09:00'); x.click(); return true; })()");
await act("reservar (clique duplo)", "(() => { const x = document.querySelector('[data-testid=book-lesson]'); x.click(); x.click(); return true; })()");
await check(await waitFor("[...document.querySelectorAll('a')].some((a) => a.textContent.trim() === 'Ver em Minhas aulas')"), "reserva confirmada com atalho para Minhas aulas");
const posts = apiLog.filter((r) => r.method === "POST" && r.path === "/v1/lessons");
await check(posts.length >= 1 && new Set(posts.map((p) => p.body.idempotency_key)).size === 1 && state.lessons.length === 1, "clique duplo não duplica a aula (mesma chave de idempotência)");
await check(posts[0]?.body?.subject === "matematica" && posts[0]?.body?.duration_minutes === 60 && posts[0]?.body?.starts_at === SLOTS[0] && !("price_cents" in posts[0].body), "reserva envia professor, disciplina, duração, horário e chave — sem preço");
await check((await b.evaluate("[...document.querySelectorAll('[role=status],[role=alert]')].filter((e) => e.innerText.includes('Aula reservada')).length")) === 1, "clique duplo: um único aviso de reserva");

/* Conflito 409 */
await act("escolher 10:00", "(() => { const x = [...document.querySelectorAll('[data-testid=slot-list] button')].find((y) => y.textContent.trim() === '10:00'); if (!x) return false; x.click(); return true; })()");
state.forceConflict = true;
const before = apiLog.filter((r) => r.path.endsWith("/slots")).length;
await act("reservar 10:00", "(() => { document.querySelector('[data-testid=book-lesson]').click(); return true; })()");
await check(await waitFor(text("Este horário acabou de ser reservado.")), "409: mensagem de horário ocupado");
await sleep(500);
await check(apiLog.filter((r) => r.path.endsWith("/slots")).length > before, "409: horários recarregados");
await axe("perfil do professor");
await shot("perfil-professor", [320, 360, 390, 430, 768, 1440]);
await fitsInCards("perfil do professor (reserva)");

/* Minhas aulas */
await act("ir para Minhas aulas", "(() => { [...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Ver em Minhas aulas').click(); return true; })()");
await check(await waitFor("location.pathname === '/conta/aulas' && document.querySelectorAll('[data-testid=lesson-row]').length === 1"), "Minhas aulas lista a reserva");
await check(await b.evaluate("[...document.querySelectorAll('[data-testid=lesson-row] a')].some((a) => a.href.startsWith('https://meet.google.com/') && a.rel.includes('noopener') && a.textContent.includes('Entrar no Meet'))"), "\"Entrar no Meet\" com link seguro");
await check(!(await b.evaluate(text(" De "))), "datas em português sem maiúsculas em todas as palavras");
await axe("minhas aulas");
await shot("minhas-aulas", [320, 360, 390, 430, 768, 1440]);
await fitsInCards("minhas aulas");
await b.go(base + "/conta", 1500);
await check(await waitFor("document.querySelector('[data-testid=next-lesson]')?.dataset.state === 'scheduled'"), "início: próxima aula em destaque");
await check(await b.evaluate("[...document.querySelectorAll('[data-testid=next-lesson] a')].some((a) => a.href.startsWith('https://meet.google.com/'))"), "início: \"Entrar no Meet\" na próxima aula");
await shot("inicio-aluna-com-aula", [320, 390, 768, 1440]);
await fitsInCards("início com aula");
await b.go(base + "/conta/aulas", 1500);
await waitFor("document.querySelectorAll('[data-testid=lesson-row]').length === 1");
await clickButton("Cancelar", "[data-testid=lesson-list]");
await clickButton("Confirmar cancelamento", "[data-testid=lesson-list]");
await check(await waitFor("document.querySelector('[data-testid=lesson-row]')?.dataset.status === 'cancelled'"), "cancelamento em dois passos marca a aula como cancelada");
await check(!(await b.evaluate("[...document.querySelectorAll('[data-testid=lesson-row] a')].some((a) => a.href.includes('meet.google.com'))")), "aula cancelada sem link do Meet");

/* Início da aluna com a aula reservada (antes do cancelamento acima, a aula existia) */
/* Persistência após novo login */
await signOut();
await signIn("S");
await b.go(base + "/conta/aulas", 1500);
await check(await waitFor("document.querySelector('[data-testid=lesson-row]')?.dataset.status === 'cancelled'"), "após novo login, Minhas aulas recupera o histórico");

/* ------------------------------ 3. Demonstração isolada ------------------------------ */
console.log("Demonstração");
await signOut();
const apiBefore = apiLog.length;
await b.go(base + "/perfil-de-acesso", 1500);
await act("Quero aprender (demo)", "(() => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.includes('Quero aprender')); if (!l) return false; l.click(); return true; })()");
await clickButton("Continuar como aluno");
await check(await waitFor("location.pathname.startsWith('/aluno')"), "demonstração acessível sem conta");
await check(await waitFor(text("Modo demonstração")), "demonstração SEMPRE identificada (aviso de dados fictícios)");
await b.go(base + "/aluno/buscar", 1500);
await check(await waitFor("document.querySelectorAll('main a[href^=\"/aluno/professores/\"]').length > 0"), "demonstração mostra professores FICTÍCIOS (não depende da API)");
await check(!(await b.evaluate(text("ainda não está disponível na API"))), "demonstração não cai em \"recurso indisponível\"");
await check(apiLog.length === apiBefore, "demonstração não chama a API real");

/* ------------------------------ Resultado ------------------------------ */
const errs = b.errors.filter((e) => !/status of (401|403|404|409|422|503)|ERR_FAILED|supabase\.co|edusearch-ci\.test|googleusercontent/.test(e));
await check(errs.length === 0, `sem erros de console inesperados${errs.length ? " — " + errs.slice(0, 3).join(" | ") : ""}`);
await check(!(await b.evaluate(`${storageDump}.includes('codigo-ficticio') || ${storageDump}.includes(${JSON.stringify(String(state.issuedState))})`)), "nenhum código/state do Google guardado no navegador");
await b.close();
if (failures.length) {
  console.log(`\n${failures.length} falha(s):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAgenda real: todas as verificações passaram.");
