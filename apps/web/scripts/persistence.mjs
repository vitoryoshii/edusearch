#!/usr/bin/env node
/**
 * Teste de navegador da PERSISTÊNCIA REAL do perfil (Fase 2.6B) — roda no GitHub Actions.
 *
 * Servidor de desenvolvimento com VITE_STAGE_PROFILE_PERSISTENCE=testing, Supabase/GIS
 * FICTÍCIOS e VITE_API_BASE_URL apontando para um host fictício. Mocks SOMENTE deste teste,
 * injetados pelo DevTools Protocol (Fetch):
 *   - accounts.google.com → GIS falso (ID token não assinado, com o nonce recebido);
 *   - *.supabase.co       → Supabase falso com DOIS usuários (A e B);
 *   - api.edusearch-ci.test → API falsa EM MEMÓRIA que segue docs/api-contract.md: papéis,
 *     cadastros por usuário (chave = "sub" do Bearer), 401/403/404/422/503.
 * O isolamento verdadeiro (RLS) é testado no backend; aqui se verifica que o FRONTEND só envia
 * o token da sessão atual, usa o papel do servidor, salva só após sucesso, recupera os dados
 * depois de recarregar/logout e mantém a demonstração separada.
 *
 *   node scripts/persistence.mjs http://localhost:5192 [pasta-de-capturas]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp.mjs";

const base = (process.argv[2] ?? "http://localhost:5192").replace(/\/$/, "");
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });
const origin = new URL(base).origin;
const API_HOST = "api.edusearch-ci.test";
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const USERS = {
  A: { id: "00000000-0000-4000-8000-0000000000a1", email: "aluna.a@example.com", name: "Aluna Teste A" },
  B: { id: "00000000-0000-4000-8000-0000000000b2", email: "prof.b@example.com", name: "Professor Teste B" },
};
let currentUser = "A";

const b = await launch();
const failures = [];
const apiLog = []; // { method, path, sub, iss, body }
async function check(ok, msg) {
  if (ok) return console.log(`  ✓ ${msg}`);
  let page = {};
  try {
    page = await b.evaluate(`({ caminho: location.pathname, etapa: document.querySelector('section[data-step]')?.dataset.step ?? null,
      alertas: [...document.querySelectorAll('[role=alert]')].map((e) => e.innerText.slice(0, 160)), texto: document.querySelector('main')?.innerText.slice(0, 300) ?? null })`);
  } catch (e) {
    page = { erro: String(e.message ?? e).slice(0, 120) };
  }
  const info = JSON.stringify({ ...page, usuario: currentUser, ultimasChamadasApi: apiLog.slice(-4).map((r) => `${r.method} ${r.path} → ${r.status}`) });
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
  const g = (window.__gis = {});
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  window.google = { accounts: { id: {
    initialize(c) { cfg = c; },
    renderButton(el) { const btn = document.createElement("button"); btn.type = "button"; btn.dataset.fakeGis = ""; btn.textContent = "Continuar com o Google";
      btn.style.cssText = "width:320px;height:40px"; btn.onclick = () => g.click(); el.appendChild(btn); },
    disableAutoSelect() {}, cancel() {},
  } } };
  g.click = () => {
    const claims = { iss: "https://accounts.google.com", aud: cfg.client_id, sub: "google-sub", email: "x@example.com", exp: Math.floor(Date.now() / 1000) + 3600, nonce: cfg.nonce };
    cfg.callback({ credential: b64({ alg: "RS256" }) + "." + b64(claims) + ".assinatura-ficticia", select_by: "btn" });
  };
})();`;

function makeUser(key) {
  const u = USERS[key];
  return {
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: "2026-11-20T10:00:00Z",
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: { full_name: u.name, avatar_url: "https://lh3.googleusercontent.com/a/foto-ficticia=s96-c" },
    identities: [], created_at: "2026-11-20T10:00:00Z", updated_at: "2026-11-20T10:00:00Z",
  };
}
function makeSession(key) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = makeUser(key);
  const iss = "https://edusearch-ci-fake.supabase.co/auth/v1";
  return {
    access_token: `${b64url({ alg: "ES256", typ: "JWT", kid: "ci" })}.${b64url({ iss, sub: user.id, role: "authenticated", aud: "authenticated", exp, email: user.email })}.assinatura-ficticia`,
    token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: `refresh-${key}`, user,
  };
}

/* API falsa, em memória, por "sub" (como o RLS no banco real). */
const SUBJECTS = [
  ["matematica", "Matemática"], ["fisica", "Física"], ["quimica", "Química"], ["biologia", "Biologia"],
  ["redacao", "Redação"], ["ingles", "Inglês"], ["historia", "História"], ["programacao", "Programação"],
].map(([slug, name]) => ({ slug, name }));
const store = new Map(); // sub → { display_name, avatar_url, roles:Set, student, teacher }
let apiMode = "ok"; // ok | down | expired
let failNextSave = null; // null | 422 | 503
const STUDENT_KEYS = ["learning_goal", "education_level", "subjects", "difficulty_areas", "preferred_weekdays", "preferred_periods", "preferred_modality", "budget_min_cents", "budget_max_cents"];
const TEACHER_KEYS = ["headline", "bio", "subjects", "specialties", "academic_background", "experience", "teaching_methods", "methodology", "price_cents", "lesson_durations_minutes", "modality", "available_weekdays", "available_periods"];
const NOW = "2026-11-20T12:00:00Z";
function account(sub) {
  if (!store.has(sub)) {
    const u = Object.values(USERS).find((x) => x.id === sub);
    if (!u) return null;
    store.set(sub, { display_name: u.name, avatar_url: "https://lh3.googleusercontent.com/a/foto-ficticia=s96-c", roles: new Set(), student: null, teacher: null });
  }
  return store.get(sub);
}
function meOf(sub) {
  const a = account(sub);
  const roles = [...a.roles].sort();
  return {
    id: sub, email: Object.values(USERS).find((x) => x.id === sub).email, display_name: a.display_name, avatar_url: a.avatar_url,
    status: "onboarding", roles,
    onboarding: {
      student: a.roles.has("student") ? { status: a.student ? "completed" : "pending" } : null,
      teacher: a.roles.has("teacher")
        ? { status: a.teacher ? "completed" : "pending", verification_status: a.teacher ? "pending" : null, is_published: false }
        : null,
    },
    created_at: NOW, updated_at: NOW,
  };
}
const err = (status, code, detail) => [status, { detail, code }];
function api(method, path, sub, body) {
  if (path === "/v1/subjects" && method === "GET") return apiMode === "down" ? err(503, "database_unavailable", "Serviço temporariamente indisponível. Tente novamente.") : [200, SUBJECTS];
  if (!sub) return err(401, "not_authenticated", "Faça login para continuar.");
  if (apiMode === "expired") return err(401, "token_expired", "Sua sessão expirou. Entre novamente.");
  if (apiMode === "down") return err(503, "database_unavailable", "Serviço temporariamente indisponível. Tente novamente.");
  const a = account(sub);
  if (!a) return err(404, "profile_not_found", "Perfil não encontrado para esta conta.");
  const strict = (keys, required) => {
    const extra = Object.keys(body ?? {}).filter((k) => !keys.includes(k));
    const missing = required.filter((k) => body?.[k] === undefined);
    return extra.length || missing.length ? err(422, "validation_error", "Dados inválidos.") : null;
  };
  const failure = () => {
    if (!failNextSave) return null;
    const s = failNextSave;
    failNextSave = null;
    return s === 422 ? err(422, "unknown_subject", "Disciplina inválida: teste.") : err(503, "database_unavailable", "Serviço temporariamente indisponível. Tente novamente.");
  };
  if (path === "/v1/me" && method === "GET") return [200, meOf(sub)];
  if (path === "/v1/me/roles" && method === "POST") {
    if (!["student", "teacher"].includes(body?.role) || Object.keys(body).length !== 1) return err(422, "validation_error", "Dados inválidos.");
    const created = !a.roles.has(body.role);
    a.roles.add(body.role);
    return [created ? 201 : 200, meOf(sub)];
  }
  if (path === "/v1/me/profile" && method === "PUT") {
    const bad = strict(["display_name", "avatar_url"], ["display_name"]);
    if (bad) return bad;
    a.display_name = body.display_name;
    a.avatar_url = body.avatar_url ?? null;
    return [200, meOf(sub)];
  }
  for (const [kind, keys, required] of [
    ["student", STUDENT_KEYS, ["learning_goal", "education_level", "subjects", "preferred_weekdays", "preferred_periods", "preferred_modality"]],
    ["teacher", TEACHER_KEYS, ["bio", "subjects", "academic_background", "experience", "teaching_methods", "price_cents", "lesson_durations_minutes", "modality", "available_weekdays", "available_periods"]],
  ]) {
    if (path !== `/v1/me/${kind}-profile`) continue;
    if (!a.roles.has(kind)) return err(403, "role_required", "Escolha o perfil antes de continuar.");
    if (method === "GET") return a[kind] ? [200, a[kind]] : err(404, `${kind}_profile_not_found`, "Cadastro ainda não salvo.");
    if (method === "PUT") {
      const bad = strict(keys, required) ?? failure();
      if (bad) return bad;
      a[kind] =
        kind === "student"
          ? { ...body, created_at: NOW, updated_at: NOW }
          : { headline: null, ...body, lesson_duration_minutes: Math.min(...body.lesson_durations_minutes), verification_status: "pending", is_published: false, published_at: null, created_at: NOW, updated_at: NOW };
      return [200, a[kind]];
    }
  }
  return err(404, "not_found", "Recurso não encontrado.");
}

await b.send("Fetch.enable", {
  patterns: [
    { urlPattern: "*accounts.google.com/gsi/client*", requestStage: "Request" },
    { urlPattern: "*supabase.co*", requestStage: "Request" },
    { urlPattern: "*googleusercontent.com*", requestStage: "Request" },
    { urlPattern: `*${API_HOST}*`, requestStage: "Request" },
  ],
});
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
        // A API real libera só GET, POST, PUT e OPTIONS (o Supabase falso aceita os mesmos).
        { name: "Access-Control-Allow-Methods", value: "GET, POST, PUT, OPTIONS" },
      ],
      body: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)).toString("base64"),
    });
  if (url.host === "accounts.google.com") return reply(200, FAKE_GIS, "text/javascript");
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
    const [status, payload] = api(request.method, url.pathname, claims?.sub ?? null, body);
    apiLog.push({ method: request.method, path: url.pathname, sub: claims?.sub ?? null, iss: claims?.iss ?? null, body, status });
    return reply(status, status === 204 ? "" : payload);
  }

  // Supabase falso
  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "id_token") return reply(200, makeSession(currentUser));
  if (url.pathname === "/auth/v1/user") {
    const key = Object.keys(USERS).find((k) => USERS[k].id === claims?.sub) ?? currentUser;
    return reply(200, makeUser(key));
  }
  if (url.pathname === "/auth/v1/logout") return reply(204, "");
  return reply(404, "{}");
});

/* ------------------------------- Auxiliares ------------------------------- */
const PAGE_TEXT = `document.body.innerText.replace(/[\\u00a0\\u202f]/g, ' ')`;
const text = (s) => `${PAGE_TEXT}.includes(${JSON.stringify(s)})`;
const stepIs = (id) => `document.querySelector('section[data-step]')?.dataset.step === '${id}'`;
async function act(label, expression) {
  const ok = await b.evaluate(expression).catch(() => false);
  if (!ok) await check(false, `ação: ${label}`);
  await sleep(150);
}
const clickChip = (group, chip) =>
  act(
    `${group} → ${chip}`,
    `(() => { const g = [...document.querySelectorAll('[role=group]')].find((el) => document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.trim() === ${JSON.stringify(group)});
      const btn = g && [...g.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(chip)}); if (!btn) return false; btn.click(); return true; })()`,
  );
const setField = (label, value) =>
  act(
    `preencher ${label}`,
    `(() => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)}));
      const el = l && (l.control || document.getElementById(l.htmlFor)); if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  );
const fieldValue = (label) =>
  b.evaluate(`(() => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})); return (l && (l.control || document.getElementById(l.htmlFor)))?.value ?? null; })()`);
const clickButton = (label, scope = "") =>
  act(`botão ${label}`, `(() => { const x = [...document.querySelectorAll('${scope} button')].find((y) => y.textContent.trim() === ${JSON.stringify(label)}); if (!x) return false; x.click(); return true; })()`);
const continueStep = () => clickButton("Continuar", "section[data-step]");
const storageDump = `[localStorage, sessionStorage].flatMap((st) => Object.keys(st).map((k) => k + '=' + st.getItem(k))).join('\\n')`;
const ROLE_KEY_PREFIX = "edusearch-account-role:";

async function signIn(key) {
  currentUser = key;
  await b.go(base + "/", 1500);
  await waitFor(`!!document.querySelector('[data-fake-gis]')`);
  await act("botão do Google", `(() => { document.querySelector('[data-fake-gis]').click(); return true; })()`);
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
  const v = await b.evaluate(
    `axe.run(document, { runOnly: { type: "tag", values: ["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"] } }).then((r) => r.violations.map((v) => v.id + " (" + v.nodes.length + "): " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")))`,
  );
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
  await check(overflow.length === 0, `${name}: sem rolagem horizontal em ${widths.join("/")} px${overflow.length ? " — " + overflow.join(", ") : ""}`);
}

/* ------------------------------ 1. Login e /v1/me ------------------------------ */
console.log(`Persistência real (${base}) — API falsa em ${API_HOST}`);
b.setStep("login A");
await signIn("A");
await check(await waitFor(`location.pathname === '/conta/boas-vindas'`), "1. login com sessão Supabase válida → primeiro acesso (sem papel no servidor) leva às boas-vindas");
const meCall = apiLog.find((r) => r.path === "/v1/me");
await check(meCall?.sub === USERS.A.id && meCall?.iss?.endsWith(".supabase.co/auth/v1"), "2. GET /v1/me com o access token do SUPABASE do usuário A (nunca o ID token do Google)");
await check(!apiLog.some((r) => r.iss === "https://accounts.google.com"), "ID token do Google nunca é enviado à API");

b.setStep("503 e nova tentativa");
apiMode = "down";
await b.go(base + "/conta", 1500);
await check(await waitFor(`!!document.querySelector('[data-testid=account-error]') && ${text("O servidor encontrou um problema")}`), "11. 503: estado de erro com mensagem genérica e nova tentativa");
await axe("conta — erro 503");
apiMode = "ok";
await clickButton("Tentar novamente");
await check(await waitFor(`location.pathname === '/conta/boas-vindas'`), "nova tentativa recupera a conta");

/* ------------------------------ 3. Papel ------------------------------ */
b.setStep("papel");
await axe("boas-vindas (persistência real)");
await shot("persist-boas-vindas", [320, 1440]);
await act("Quero aprender", `(() => { document.querySelector('[data-role=student]').click(); return true; })()`);
await check(await waitFor(`location.pathname === '/conta/cadastro/aluno' && ${stepIs("voce")}`), "3. \"Quero aprender\" grava o papel (POST /v1/me/roles) e abre o cadastro");
await check(apiLog.some((r) => r.method === "POST" && r.path === "/v1/me/roles" && r.body?.role === "student" && r.sub === USERS.A.id), "papel enviado ao servidor com o token de A");
await check(!(await b.evaluate(`${storageDump}.includes('${ROLE_KEY_PREFIX}')`)), "papel NÃO é guardado no localStorage (o servidor é a fonte)");
await check(await b.evaluate(`!!document.querySelector('[data-testid=onboarding-save-notice]') && !document.querySelector('[data-testid=onboarding-preview-notice]')`), "aviso de salvamento real (não de prévia)");

/* ------------------------------ 4. Cadastro do aluno ------------------------------ */
b.setStep("cadastro do aluno");
const GOAL = "Passar no ENEM com boa nota em matemática";
await continueStep();
await setField("Seu objetivo", GOAL);
await clickChip("Nível atual", "Ensino médio");
await continueStep();
await check(await waitFor(stepIs("materias")), "objetivo → disciplinas (catálogo do servidor)");
await check(apiLog.some((r) => r.path === "/v1/subjects"), "catálogo carregado de GET /v1/subjects");
await clickChip("Disciplinas de interesse", "Matemática");
await clickChip("Disciplinas de interesse", "Física");
await clickChip("Principais dificuldades", "Resolver exercícios e provas");
await continueStep();
await clickChip("Dias disponíveis", "Seg");
await clickChip("Dias disponíveis", "Qua");
await clickChip("Períodos", "Noite");
await clickChip("Modalidade", "Online");
await clickChip("Valor por aula", "R$ 50 a R$ 80");
await continueStep();
await check(await waitFor(`${stepIs("revisao")} && !!document.querySelector('[data-testid=save-profile]')`), "revisão com \"Salvar perfil\" habilitado");
await axe("cadastro do aluno — revisão (salvar)");
await shot("persist-aluno-revisao", [320, 390, 1440]);

failNextSave = 422;
await clickButton("Salvar perfil");
await check(await waitFor(`!!document.querySelector('[data-testid=save-error]') && ${text("Disciplina inválida")}`), "11. 422: erro visível (role=alert) com a mensagem da API");
await check(await b.evaluate(`location.pathname === '/conta/cadastro/aluno'`), "cadastro NÃO é considerado concluído sem sucesso da API");
failNextSave = 503;
await act("Tentar novamente (503)", `(() => { const x = [...document.querySelectorAll('[data-testid=save-error] button')][0]; if (!x) return false; x.click(); return true; })()`);
await check(await waitFor(`!!document.querySelector('[data-testid=save-error]') && ${text("O servidor encontrou um problema")}`), "11. 503 ao salvar: erro com nova tentativa");
await act("Tentar novamente", `(() => { const x = [...document.querySelectorAll('[data-testid=save-error] button')][0]; if (!x) return false; x.click(); return true; })()`);
await check(await waitFor(`location.pathname === '/conta' && document.querySelector('[data-testid=student-status]')?.dataset.status === 'completed'`), "4. cadastro salvo → início mostra \"Cadastro de aluno concluído\"");
await check(await waitFor(text("Cadastro de aluno salvo")), "confirmação de salvamento (toast)");
const put = apiLog.filter((r) => r.method === "PUT" && r.path === "/v1/me/student-profile" && r.status === 200).at(-1);
await check(
  put?.body?.learning_goal === GOAL && put.body.education_level === "medio" && JSON.stringify(put.body.subjects) === '["matematica","fisica"]' &&
    JSON.stringify(put.body.difficulty_areas) === '["exercicios"]' && JSON.stringify(put.body.preferred_weekdays) === '["seg","qua"]' &&
    put.body.preferred_modality === "online" && put.body.budget_min_cents === 5000 && put.body.budget_max_cents === 8000,
  "payload do aluno segue o contrato (faixa R$ 50–80 → 5000/8000 centavos; nada descartado)",
);
await check(!(await b.evaluate(`${storageDump}.includes(${JSON.stringify(GOAL)})`)), "respostas não ficam no localStorage/sessionStorage");
await axe("início da conta — aluno concluído");
await shot("persist-conta-aluno", [320, 390, 1440]);

/* ------------------------------ 6/7. Recarregar e novo login ------------------------------ */
b.setStep("recarregar");
await b.go(base + "/conta", 1800);
await check(await waitFor(`document.querySelector('[data-testid=student-status]')?.dataset.status === 'completed'`), "6. recarregar a página preserva o cadastro (estado vem do servidor)");
await b.go(base + "/conta/cadastro/aluno", 1800);
await waitFor(stepIs("voce"));
await continueStep();
await check(await waitFor(stepIs("objetivo")) && (await fieldValue("Seu objetivo")) === GOAL, "6. ao reabrir o cadastro, as respostas salvas são carregadas (GET)");

b.setStep("logout e novo login");
await signOut();
await signIn("A");
await check(await waitFor(`location.pathname === '/conta' && document.querySelector('[data-testid=student-status]')?.dataset.status === 'completed'`, 10000), "7. logout e novo login recuperam o cadastro de A");

/* ------------------------------ 8/5/9. Usuário B (professor) ------------------------------ */
b.setStep("usuário B");
await signOut();
const beforeB = apiLog.length;
await signIn("B");
await check(await waitFor(`location.pathname === '/conta/boas-vindas'`), "8. usuário B começa sem papel (não herda nada de A)");
await check(apiLog.slice(beforeB).every((r) => r.sub === null || r.sub === USERS.B.id), "8. todas as chamadas de B usam só o token de B");
await b.go(base + "/conta/cadastro/aluno", 1500);
await check(await waitFor(`location.pathname === '/conta/boas-vindas'`), "403: sem papel de aluno no servidor, o cadastro de aluno volta às boas-vindas");
await check(!(await b.evaluate(text(GOAL))), "8. B nunca vê os dados de A");

await act("Quero ensinar", `(() => { document.querySelector('[data-role=teacher]').click(); return true; })()`);
await check(await waitFor(`location.pathname === '/conta/cadastro/professor' && ${stepIs("voce")}`), "B escolhe \"Quero ensinar\" (papel gravado)");
await check(apiLog.some((r) => r.path === "/v1/me/teacher-profile" && r.method === "GET" && r.status === 404), "404 do cadastro ainda não salvo vira rascunho vazio");
const BIO = "Professor fictício de física com foco em vestibulares e experimentos.";
await setField("Biografia profissional", BIO);
await continueStep();
await clickChip("Disciplinas", "Física");
await setField("Especialidades", "Mecânica, ENEM");
await setField("Formação acadêmica", "Licenciatura em Física (fictícia)");
await clickChip("Experiência como professor", "3 a 5 anos");
await continueStep();
await clickChip("Metodologia", "Resolução de exercícios");
await clickChip("Metodologia", "Aulas práticas");
await setField("Valor da aula", "95,50");
await clickChip("Duração das aulas", "60 min");
await clickChip("Duração das aulas", "45 min");
await clickChip("Modalidade", "Online");
await continueStep();
await clickChip("Dias", "Ter");
await clickChip("Períodos", "Tarde");
await continueStep();
await check(await waitFor(stepIs("documentos")) && !(await b.evaluate(`!!document.querySelector('input[type=file]')`)), "verificação de formação sem upload de documentos");
await continueStep();
await check(await waitFor(`${stepIs("revisao")} && ${text("Pendente")}`), "revisão do professor: verificação pendente");
await clickButton("Salvar perfil");
await check(await waitFor(`location.pathname === '/conta' && document.querySelector('[data-testid=teacher-status]')?.dataset.status === 'completed'`), "5. cadastro de professor salvo");
await check(
  await b.evaluate(`(() => { const t = document.querySelector('[data-testid=teacher-visibility]')?.innerText ?? ''; return t.includes('Em análise') && t.includes('não publicado'); })()`),
  "9. professor pendente: \"Em análise\" e perfil NÃO publicado",
);
const tput = apiLog.filter((r) => r.method === "PUT" && r.path === "/v1/me/teacher-profile" && r.status === 200).at(-1);
await check(
  tput?.sub === USERS.B.id && tput.body.price_cents === 9550 && JSON.stringify(tput.body.lesson_durations_minutes) === "[45,60]" &&
    tput.body.specialties === "Mecânica, ENEM" && JSON.stringify(tput.body.teaching_methods) === '["exercicios","pratica"]' &&
    !("verification_status" in tput.body) && !("is_published" in tput.body),
  "payload do professor segue o contrato e nunca envia aprovação/publicação",
);
await axe("início da conta — professor em análise");
await shot("persist-conta-professor", [320, 1440]);

/* ------------------------------ Configurações: nome e foto ------------------------------ */
b.setStep("nome e foto");
await b.go(base + "/conta/configuracoes", 1500);
await check(await waitFor(`!!document.querySelector('[data-testid=name-photo-form]')`), "Configurações: formulário de nome e foto");
await setField("Nome exibido", "Prof. B Atualizado");
await act("Sem foto", `(() => { const r = [...document.querySelectorAll('[role=radio]')].find((x) => x.textContent.trim() === 'Sem foto (iniciais)'); if (!r) return false; r.click(); return true; })()`);
await clickButton("Salvar nome e foto");
await check(await waitFor(text("Perfil atualizado")), "nome e foto salvos (PUT /v1/me/profile)");
const pput = apiLog.filter((r) => r.path === "/v1/me/profile").at(-1);
await check(pput?.body?.display_name === "Prof. B Atualizado" && pput.body.avatar_url === null && Object.keys(pput.body).length === 2, "PUT /v1/me/profile envia só nome e foto");
await b.go(base + "/conta", 1500);
await check(await waitFor(`document.querySelector('[data-testid=profile-name]')?.textContent === 'Prof. B Atualizado'`), "nome salvo exibido após recarregar");
await axe("configurações — nome e foto");
await shot("persist-configuracoes", [320, 1440]);

/* ------------------------------ 401 ------------------------------ */
b.setStep("401");
apiMode = "expired";
await b.go(base + "/conta", 1500);
await check(await waitFor(`${text("Sua sessão expirou")} && [...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Entrar novamente')`), "11. 401: \"Sua sessão expirou\" com ação para entrar novamente");
apiMode = "ok";

/* ------------------------------ 10. Demonstração isolada ------------------------------ */
b.setStep("demonstração");
await signOut();
const beforeDemo = apiLog.length;
await b.go(base + "/perfil-de-acesso", 1500);
await act("Quero aprender (demo)", `(() => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.includes('Quero aprender')); if (!l) return false; l.click(); return true; })()`);
await clickButton("Continuar como aluno");
await check(await waitFor(`location.pathname.startsWith('/aluno')`), "demonstração acessível sem conta");
await b.go(base + "/aluno/perfil", 1500);
await check(apiLog.length === beforeDemo, "10. a demonstração não chama a API real (nenhuma requisição)");
await check(!(await b.evaluate(`${PAGE_TEXT}.includes('Prof. B Atualizado') || ${PAGE_TEXT}.includes(${JSON.stringify(GOAL)})`)), "10. a demonstração não mostra dados de contas reais");
await check(await b.evaluate(`localStorage.getItem('edusearch-auth') === null`), "10. a demonstração não cria sessão real");

/* ------------------------------ Resultado ------------------------------ */
const errs = b.errors.filter((e) => !/status of (401|403|404|422|503)|ERR_FAILED|supabase\.co|edusearch-ci\.test/.test(e));
await check(errs.length === 0, `sem erros de console inesperados${errs.length ? " — " + errs.slice(0, 3).join(" | ") : ""}`);
await b.close();
if (failures.length) {
  console.log(`\n${failures.length} falha(s):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nPersistência real: todas as verificações passaram.");
