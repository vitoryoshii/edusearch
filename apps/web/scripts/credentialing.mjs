#!/usr/bin/env node
/**
 * Teste de navegador da JORNADA DE CREDENCIAMENTO (Trust Engine).
 *
 * Mesmo servidor do checkout (VITE_STAGE_PROFILE_PERSISTENCE=testing, API num host fictício);
 * Supabase/GIS/Storage FICTÍCIOS, interceptados no navegador. As regras reais (inspeção do conteúdo,
 * regras versionadas, aprovação só com evidência, RLS, elegibilidade comercial) são testadas no
 * backend (tests/db/test_trust_engine_db.py). Aqui: o FRONTEND não envia estado de aprovação, envia
 * arquivos só para a pasta do próprio usuário, mostra progresso real (sem percentuais) e é acessível.
 *
 *   node scripts/credentialing.mjs http://localhost:5194 [pasta-de-capturas]
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
const T = { id: "00000000-0000-4000-8000-0000000000c3", email: "prof.t@example.com", name: "Professora Teste T" };

const b = await launch();
const failures = [];
const apiLog = [];
const uploads = [];
async function check(ok, msg) {
  if (ok) return console.log(`  ✓ ${msg}`);
  const page = await b.evaluate(`({ caminho: location.pathname, texto: document.querySelector('main')?.innerText.slice(0, 300) ?? null })`).catch(() => ({}));
  const info = JSON.stringify({ ...page, api: apiLog.slice(-4).map((r) => `${r.method} ${r.path} → ${r.status}`) });
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
const user = {
  id: T.id, aud: "authenticated", role: "authenticated", email: T.email, email_confirmed_at: "2026-11-20T10:00:00Z",
  app_metadata: { provider: "google", providers: ["google"] }, user_metadata: { full_name: T.name, avatar_url: "https://lh3.googleusercontent.com/a/foto-ficticia=s96-c" },
  identities: [], created_at: "2026-11-20T10:00:00Z", updated_at: "2026-11-20T10:00:00Z",
};
const session = () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${b64url({ alg: "ES256", kid: "ci" })}.${b64url({ iss: "https://edusearch-ci-fake.supabase.co/auth/v1", sub: T.id, role: "authenticated", aud: "authenticated", exp, email: T.email })}.assinatura-ficticia`,
    token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "refresh-T", user,
  };
};

const NOW = new Date().toISOString();
const state = { dossier: null, documents: [], phase: "none", contestation: null };
const EVIDENCE = (identity) => [
  { validator: "registration_validator", requirement: "registration.terms_current", mandatory: true, result: "passed", source: "self_declared", reason_code: "registration.terms_accepted", observed_at: NOW },
  { validator: "document_validator", requirement: "document.identity_valid", mandatory: true, result: "passed", source: "file_analysis", reason_code: "document.content_verified", observed_at: NOW },
  { validator: "identity_validator", requirement: "identity.verified", mandatory: true, result: identity, source: "external_registry", reason_code: identity === "passed" ? "identity.verified_by_registry" : "identity.trusted_source_unavailable", observed_at: NOW },
  { validator: "curriculum_analyzer", requirement: "curriculum.experience_described", mandatory: false, result: "inconclusive", source: "self_declared", reason_code: "curriculum.experience_brief", observed_at: NOW },
];
const verificationOut = () => ({ ...state.dossier, documents: state.documents.map(({ kind, version, status, uploaded_at }) => ({ document_kind: kind, version, status, uploaded_at })) });
const progressOut = () => {
  const phase = state.phase;
  const decision = ["pending_external", "approved", "contested"].includes(phase)
    ? { id: "dec-1", decision: phase === "approved" ? "approved" : "pending_external", reasons: [], actor_kind: "service", rules_version: "trust-rules-2026.11-v1", decided_at: NOW, contestable: phase === "pending_external" }
    : null;
  return {
    status: state.dossier.status, review_reason: phase === "pending_external" ? "identity.trusted_source_unavailable" : null,
    submitted_at: state.dossier.submitted_at, processing: phase === "submitted", decision,
    evidence: decision ? EVIDENCE(phase === "approved" ? "passed" : "unavailable") : [],
    contestation: state.contestation,
    documents: state.documents.map(({ kind, version, status, uploaded_at }) => ({ kind, version, status, inspection_status: "passed", inspection_code: "inspection.content_verified", review_reason: null, uploaded_at })),
  };
};
const err = (status, code, detail) => [status, { detail, code }];

function api(method, path, sub, body) {
  if (path === "/v1/subjects") return [200, [{ slug: "matematica", name: "Matemática" }]];
  if (sub !== T.id) return err(401, "not_authenticated", "Faça login para continuar.");
  if (path === "/v1/me" && method === "GET")
    return [200, { id: T.id, email: T.email, display_name: T.name, avatar_url: "https://lh3.googleusercontent.com/a/foto-ficticia=s96-c", status: "active", roles: ["teacher"],
      onboarding: { student: null, teacher: { status: "completed", verification_status: state.phase === "approved" ? "approved" : "pending", is_published: state.phase === "approved" } }, created_at: NOW, updated_at: NOW }];
  if (path === "/v1/scheduling/status") return [200, { stage: "testing", calendar_configured: true, payments_enabled: false, commercial_lessons_enabled: false }];
  if (path === "/v1/me/teacher-verification" && method === "GET") return state.dossier ? [200, verificationOut()] : err(404, "teacher_verification_not_found", "Dossiê de credenciamento ainda não iniciado.");
  if (path === "/v1/me/teacher-verification" && method === "PUT") {
    if ("status" in body || "is_published" in body || "teacher_id" in body) return err(422, "validation_error", "Campo não permitido.");
    state.dossier = { status: "draft", qualification_kind: body.qualification_kind, institution: body.institution, qualification: body.qualification, submitted_at: null, review_reason: null, terms_version: body.terms_version, terms_accepted_at: NOW };
    return [200, verificationOut()];
  }
  if (path === "/v1/me/teacher-verification/progress") return state.dossier ? [200, progressOut()] : err(404, "teacher_verification_not_found", "Dossiê ainda não iniciado.");
  if (path === "/v1/me/teacher-verification/documents" && method === "POST") {
    if (!body.storage_path.startsWith(`${T.id}/`)) return err(422, "invalid_document_path", "Caminho de documento inválido.");
    const version = state.documents.filter((d) => d.kind === body.document_kind).length + 1;
    const doc = { kind: body.document_kind, version, status: "quarantined", uploaded_at: NOW };
    state.documents.push(doc);
    return [201, { document_kind: doc.kind, version, status: doc.status, uploaded_at: NOW }];
  }
  if (path === "/v1/me/teacher-verification/submit" && method === "POST") {
    state.dossier.status = "submitted";
    state.dossier.submitted_at = NOW;
    state.phase = "submitted";
    return [200, verificationOut()];
  }
  if (path === "/v1/me/teacher-verification/contest" && method === "POST") {
    if ((body.reason ?? "").length < 20) return err(422, "contestation_reason_invalid", "Explique a contestação com 20 a 2000 caracteres.");
    state.contestation = { status: "open", created_at: NOW, resolution: null, resolved_at: null };
    state.dossier.status = "under_review";
    state.phase = "contested";
    return [200, progressOut()];
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
        { name: "Access-Control-Allow-Headers", value: "authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-upsert, cache-control" },
        { name: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
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
    apiLog.push({ method: request.method, path: url.pathname, body, status });
    return reply(status, payload);
  }
  // Storage privado (fictício): só registra o caminho e o dono do token.
  const storage = url.pathname.match(/^\/storage\/v1\/object\/teacher-verification\/(.+)$/);
  if (storage && request.method === "POST") {
    uploads.push({ path: decodeURIComponent(storage[1]), sub: claims?.sub ?? null });
    return reply(200, { Key: `teacher-verification/${storage[1]}`, Id: crypto.randomUUID() });
  }
  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "id_token") return reply(200, session());
  if (url.pathname === "/auth/v1/user") return reply(200, user);
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
const setField = (label, value) =>
  act(`campo ${label}`, `(() => {
    const lab = [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(${JSON.stringify(label)}));
    const el = lab && (document.getElementById(lab.htmlFor) ?? lab.querySelector('input,select,textarea'));
    if (!el) return false;
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return true; })()`);
const chooseFile = (kind, name, type, content) =>
  act(`arquivo ${kind}`, `(() => {
    const input = document.querySelector('[data-testid="upload-${kind}"]');
    if (!input) return false;
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true; })()`);
const clickButton = (label) =>
  act(`botão ${label}`, `(() => { const x = [...document.querySelectorAll('button')].find((y) => y.textContent.trim() === ${JSON.stringify(label)} && !y.disabled); if (!x) return false; x.click(); return true; })()`);
async function axe(label) {
  await waitFor(`document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)`, 4000);
  if (!(await b.evaluate("!!window.axe"))) await b.evaluate(`${AXE};1`);
  const v = await b.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"] } }).then((r) => r.violations.map((v) => v.id + " (" + v.nodes.length + "): " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")))`);
  await check(v.length === 0, `acessibilidade (axe): ${label}${v.length ? " — " + v.join("; ") : ""}`);
}
const reload = async () => {
  await b.go(base + "/conta/credenciamento", 1200);
  await waitFor(`!!document.querySelector('[data-testid=credentialing]')`);
};

/* -------------------------------- Jornada -------------------------------- */
await b.go(base + "/", 1500);
await waitFor(`!!document.querySelector('[data-fake-gis]')`);
await act("botão do Google", `(() => { document.querySelector('[data-fake-gis]').click(); return true; })()`);
await waitFor(`location.pathname.startsWith('/conta')`);

await check(await b.evaluate(`[...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/conta/credenciamento')`), "menu do professor leva ao credenciamento");
await reload();
await check(await waitFor(text("Não iniciado")), "dossiê não iniciado");
await check(await b.evaluate(`!!document.querySelector('[data-testid=dossier-form]')`), "formulário de dados profissionais");
await axe("credenciamento — dados");
if (shots) await b.screenshot(join(shots, "credenciamento-dados.png"));

await setField("Data de nascimento", "1990-01-02");
await setField("Instituição de ensino", "Universidade Fictícia");
await setField("Curso / titulação", "Licenciatura em Matemática");
await setField("Experiência profissional", "Cinco anos de aulas particulares e reforço escolar para o ensino médio.");
await setField("Resumo do currículo", "Planejamento didático, listas comentadas e acompanhamento de aprendizagem.");
await setField("Últimos 4 dígitos", "1234");
await act("aceite dos termos", `(() => { const c = document.querySelector('[data-testid=dossier-form] input[type=checkbox]'); if (!c) return false; c.click(); return c.checked; })()`);
await clickButton("Salvar dados");
await check(await waitFor(`!!document.querySelector('[data-testid=documents-card]')`), "dados salvos liberam o envio de documentos");
const put = apiLog.find((r) => r.method === "PUT" && r.path === "/v1/me/teacher-verification");
await check(!!put && !("status" in put.body) && !("is_published" in put.body) && put.body.terms_version === "teacher-terms-2026-11", "dossiê não envia estado/publicação e usa a versão vigente dos termos");

await chooseFile("identity", "virus.exe", "application/x-msdownload", "MZ");
await check(await waitFor(text("Envie PDF, PNG ou JPEG.")), "tipo não permitido é recusado antes do envio");
await check(uploads.length === 0, "arquivo recusado não chega ao Storage");
await chooseFile("identity", "rg.pdf", "application/pdf", "%PDF-1.7\n%%EOF");
await check(await waitFor(`!!document.querySelector('[data-kind=identity]')?.innerText.includes('Verificado')`), "identidade verificada e registrada");
await chooseFile("academic_proof", "diploma.pdf", "application/pdf", "%PDF-1.7\n% diploma\n%%EOF");
await check(await waitFor(`!!document.querySelector('[data-kind=academic_proof]')?.innerText.includes('Verificado')`), "comprovante acadêmico verificado e registrado");
await check(uploads.length === 2 && uploads.every((u) => u.sub === T.id && u.path.startsWith(`${T.id}/`)), "uploads só na pasta do próprio usuário, com o token dele");
await axe("credenciamento — documentos");
if (shots) await b.screenshot(join(shots, "credenciamento-documentos.png"));

await clickButton("Enviar para validação");
await check(await waitFor(text("Em validação")), "submissão entra na fila de validação");

state.phase = "pending_external";
state.dossier.status = "pending_external";
await reload();
await check(await waitFor(text("Aguardando fonte oficial")), "sem fonte oficial, o credenciamento fica pendente");
await check(await waitFor(`!!document.querySelector('[data-requirement="identity.verified"][data-result=unavailable]')`), "evidência de identidade mostra fonte indisponível");
await check(!(await b.evaluate(`/\\d+\\s?%/.test(document.querySelector('[data-testid=credentialing]').innerText)`)), "nenhum percentual fictício de validação");
await check(await b.evaluate(`!document.querySelector('[data-testid=dossier-form]')`), "dossiê bloqueado para edição durante a validação");
await axe("credenciamento — resultado pendente");
if (shots) await b.screenshot(join(shots, "credenciamento-pendente.png"));

await act("motivo da contestação", `(() => { const t = document.querySelector('[data-testid=contest-form] textarea'); if (!t) return false; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Meu diploma é digital e pode ser validado no portal do emissor.'); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await clickButton("Enviar contestação");
await check(await waitFor(`!!document.querySelector('[data-testid=contest-open]')`), "contestação registrada e em análise");

state.phase = "approved";
state.dossier.status = "approved";
state.contestation = null;
await reload();
await check(await waitFor(text("Credenciado")), "credenciamento aprovado exibido");
await check(await waitFor(`!!document.querySelector('[data-requirement="identity.verified"][data-result=passed]')`), "aprovação mostra os requisitos comprovados");
for (const [width, dark] of [[1440, false], [390, true], [320, false]]) {
  await b.viewport(width, { dark });
  await reload();
  await check(await b.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), `sem overflow horizontal em ${width}px`);
  if (shots) await b.screenshot(join(shots, `credenciamento-aprovado-${width}-${dark ? "escuro" : "claro"}.png`));
}
await axe("credenciamento — aprovado");

/* ------------------------------ Resultado ------------------------------ */
const errs = b.errors.filter((e) => !/status of (401|403|404|409|422|503)|ERR_FAILED|supabase\.co|edusearch-ci\.test|googleusercontent/.test(e));
await check(errs.length === 0, `sem erros de console inesperados${errs.length ? " — " + errs.slice(0, 3).join(" | ") : ""}`);
await b.close();
if (failures.length) {
  console.log(`\n${failures.length} falha(s):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nCredenciamento: todas as verificações passaram.");
