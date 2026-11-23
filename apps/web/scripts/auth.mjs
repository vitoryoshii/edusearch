#!/usr/bin/env node
/**
 * Teste de navegador da entrada única, do login Google (GIS + Supabase Auth) e do
 * onboarding da conta real — roda no GitHub Actions.
 *
 * Dois servidores de desenvolvimento:
 *   1. "público" (sem variáveis de auth): login real DESLIGADO.
 *   2. "testes"  (VITE_SUPABASE_URL/PUBLISHABLE_KEY/GOOGLE_CLIENT_ID FICTÍCIOS).
 *
 * Mocks SOMENTE deste teste, injetados pelo DevTools Protocol (Fetch):
 *   - https://accounts.google.com/gsi/client → GIS falso que registra a
 *     configuração e emite um ID token fictício (não assinado) com o nonce recebido;
 *   - *.supabase.co → Supabase falso que confere SHA-256(nonce original) == claim
 *     `nonce` do token, como o Supabase real;
 *   - *.googleusercontent.com → foto de perfil fictícia (ou 404).
 * Nenhuma chamada real ao Google ou ao Supabase é feita.
 *
 *   node scripts/auth.mjs http://localhost:5190 http://localhost:5191 [pasta-de-capturas]
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp.mjs";

const publicBase = (process.argv[2] ?? "http://localhost:5190").replace(/\/$/, "");
const testBase = (process.argv[3] ?? "http://localhost:5191").replace(/\/$/, "");
const shots = process.argv[4];
if (shots) mkdirSync(shots, { recursive: true });
const testOrigin = new URL(testBase).origin;
const CLIENT_ID = "1234567890-edusearchci.apps.googleusercontent.com";
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const b = await launch();
const failures = [];
/** Estado da tela e do servidor falso para depurar falhas — nunca inclui tokens, nonces ou chaves. */
async function diagnose() {
  let page;
  try {
    page = await b.evaluate(`(() => ({
      caminho: location.pathname + location.search,
      etapa: document.querySelector('section[data-step]')?.dataset.step ?? null,
      email: document.querySelector('[data-testid=email-access]')?.dataset.view ?? null,
      falhaEmail: document.querySelector('[data-email-failure]')?.getAttribute('data-email-failure') ?? null,
      autenticacao: document.documentElement.dataset.auth ?? null,
      falha: document.querySelector('[data-failure]')?.getAttribute('data-failure') ?? null,
      fase: document.querySelector('[data-auth-phase]')?.getAttribute('data-auth-phase') ?? null,
      alertas: [...document.querySelectorAll('[role=alert]')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim().slice(0, 200)),
      sessaoGravada: localStorage.getItem('edusearch-auth') !== null,
      sessaoDemo: sessionStorage.getItem('edusearch-demo-session') !== null,
      perfilNome: document.querySelector('[data-testid=profile-name]')?.textContent ?? null,
      perfilEmailPresente: !!document.querySelector('[data-testid=profile-email]'),
      ctaCadastro: !!document.querySelector('[data-testid=completion-cta]'),
      carregando: !!document.querySelector('[role=status]'),
    }))()`);
  } catch (e) {
    page = { erro: String(e.message ?? e).slice(0, 200) };
  }
  const last = tokenRequests.at(-1);
  const servidor = {
    modoToken: tokenMode,
    trocasDeToken: tokenRequests.length,
    ultimaTroca: last ? { provider: last.body.provider, nonceConfere: last.nonceOk, status: last.status ?? null } : null,
    ultimaRequisicaoEmail: emailRequests.at(-1)?.kind ?? null,
  };
  return JSON.stringify({ ...page, servidor });
}
async function check(ok, msg) {
  if (ok) {
    console.log(`  ✓ ${msg}`);
    return;
  }
  const info = await diagnose();
  failures.push(`${msg}\n      diagnóstico: ${info}`);
  console.log(`  ✗ ${msg}\n      diagnóstico: ${info}`);
}
async function waitFor(expression, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await b.evaluate(expression)) return true;
    } catch {
      /* navegação em andamento */
    }
    await sleep(150);
  }
  return false;
}
const ignoreExpectedNetworkErrors = () => {
  for (let i = b.errors.length - 1; i >= 0; i--)
    if (/supabase\.co|googleusercontent|status of (400|401|403|404|422)|ERR_FAILED/.test(b.errors[i])) b.errors.splice(i, 1);
};

/* --------------------------------- Mocks --------------------------------- */
const FAKE_GIS = `(() => {
  let cfg = null;
  const g = (window.__gis = { inits: 0, renders: 0, disabled: false });
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  window.google = { accounts: { id: {
    initialize(c) { cfg = c; g.inits++; g.config = { client_id: c.client_id, nonce: c.nonce, ux_mode: c.ux_mode, auto_select: c.auto_select }; },
    renderButton(el, opts) {
      g.renders++; g.opts = opts;
      if (window.__gisVariant === "personalized") {
        // Mesma estrutura do botão PERSONALIZADO real: wrapper do tamanho pedido e iframe com
        // margens -2px -10px, cujo documento NÃO declara color-scheme e desenha um retângulo
        // arredondado "Continuar como …" (o GIS real ignora shape "pill" nessa variante).
        const w = opts.width || 320;
        const wrap = document.createElement("div");
        wrap.dataset.fakeGisPersonalized = "";
        wrap.style.cssText = "position:relative;width:" + w + "px;height:40px";
        const f = document.createElement("iframe");
        f.title = "Botão Fazer Login com o Google";
        f.style.cssText = "display:block;border:0;width:" + (w + 20) + "px;height:44px;margin:-2px -10px";
        f.srcdoc = "<body style='margin:0;padding:2px 10px'><div style='box-sizing:border-box;height:40px;border:1px solid #8e918f;border-radius:4px;background:#131314;color:#e3e3e3;font:500 13px sans-serif;display:flex;align-items:center;padding:0 12px'>Continuar como Ana</div></body>";
        wrap.appendChild(f);
        el.appendChild(wrap);
        return;
      }
      const btn = document.createElement("button");
      btn.type = "button"; btn.dataset.fakeGis = ""; btn.textContent = "Continuar com o Google";
      btn.style.cssText = "width:" + (opts.width || 320) + "px;height:40px;border:1px solid #747775;border-radius:4px;background:#fff;color:#1f1f1f;font:500 14px sans-serif";
      btn.onclick = () => g.click(window.__gisMode || "ok");
      el.appendChild(btn);
    },
    disableAutoSelect() { g.disabled = true; },
    cancel() {},
  } } };
  g.click = (mode) => {
    if (mode === "cancel") return; // seletor fechado: o GIS não chama o callback
    const claims = { iss: "https://accounts.google.com", aud: cfg.client_id, sub: "google-sub-123", email: "ana.teste@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600, nonce: cfg.nonce };
    if (mode === "badnonce") claims.nonce = "f".repeat(64);
    if (mode === "badaud") claims.aud = "outro-projeto.apps.googleusercontent.com";
    g.lastToken = b64({ alg: "RS256", typ: "JWT" }) + "." + b64(claims) + ".assinatura-ficticia";
    cfg.callback({ credential: g.lastToken, select_by: "btn" });
  };
  g.replay = () => cfg.callback({ credential: g.lastToken, select_by: "btn" });
})();`;

const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#146A7A"/><circle cx="48" cy="38" r="18" fill="#E8F5F3"/><rect x="18" y="62" width="60" height="34" rx="17" fill="#E8F5F3"/></svg>`;

const API_VERSION = [{ name: "x-supabase-api-version", value: "2024-01-01" }];
const seen = [];
const tokenRequests = [];
let tokenMode = "ok"; // ok | invalid | network | not_allowed
let tokenDelayMs = 0; // atraso artificial da resposta do Supabase (teste de corrida)
let userVariant = "full"; // full | broken-photo | minimal
let userEndpoint = "ok"; // ok | revoked
const emailRequests = []; // { kind, email?, pkce?, redirect?, hasPassword? } — nunca a senha
const EMAIL_USER_ID = "00000000-0000-4000-8000-000000000002";
function makeEmailUser() {
  return {
    id: EMAIL_USER_ID, aud: "authenticated", role: "authenticated", email: "ana.email@example.com",
    email_confirmed_at: "2026-11-18T10:00:00Z", app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {}, identities: [], created_at: "2026-11-18T10:00:00Z", updated_at: "2026-11-18T10:00:00Z",
  };
}
function makeEmailSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: EMAIL_USER_ID, role: "authenticated", aud: "authenticated", exp })}.assinatura-ficticia`,
    token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "refresh-ficticio-email", user: makeEmailUser(),
  };
}
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const decode = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

function makeUser() {
  const meta =
    userVariant === "full"
      ? { full_name: "Ana Teste", avatar_url: "https://lh3.googleusercontent.com/a/foto-ficticia=s96-c" }
      : userVariant === "broken-photo"
        ? { full_name: "Ana Teste", avatar_url: "https://lh3.googleusercontent.com/a/quebrada" }
        : {};
  return {
    id: "00000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "ana.teste@example.com",
    email_confirmed_at: "2026-11-18T10:00:00Z",
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: meta,
    identities: [],
    created_at: "2026-11-18T10:00:00Z",
    updated_at: "2026-11-18T10:00:00Z",
  };
}
function makeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = makeUser();
  return {
    access_token: `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: user.id, role: "authenticated", aud: "authenticated", exp })}.assinatura-ficticia`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: "refresh-ficticio",
    user,
  };
}

await b.send("Fetch.enable", {
  patterns: [
    { urlPattern: "*accounts.google.com/gsi/client*", requestStage: "Request" },
    { urlPattern: "*supabase.co*", requestStage: "Request" },
    { urlPattern: "*googleusercontent.com*", requestStage: "Request" },
  ],
});
b.on(async (m) => {
  if (m.method !== "Fetch.requestPaused") return;
  const { requestId, request } = m.params;
  const url = new URL(request.url);
  seen.push({ method: request.method, url: request.url, host: url.host, path: url.pathname });
  const reply = (status, body, type = "application/json", extra = []) =>
    b.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: status,
      responseHeaders: [
        { name: "Content-Type", value: type },
        { name: "Access-Control-Allow-Origin", value: testOrigin },
        { name: "Access-Control-Allow-Headers", value: "authorization, apikey, content-type, x-client-info, x-supabase-api-version" },
        { name: "Access-Control-Allow-Methods", value: "GET, POST, PUT, PATCH, DELETE, OPTIONS" }, // como o Supabase real (updateUser usa PUT)
        { name: "Access-Control-Expose-Headers", value: "x-supabase-api-version" },
        ...extra,
      ],
      body: Buffer.from(body).toString("base64"),
    });

  if (url.host === "accounts.google.com") return reply(200, FAKE_GIS, "text/javascript");
  if (url.host.endsWith("googleusercontent.com")) {
    return url.pathname.includes("quebrada") ? reply(404, "", "text/plain") : reply(200, AVATAR_SVG, "image/svg+xml");
  }
  // Supabase falso
  if (request.method === "OPTIONS") return reply(204, "");
  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "id_token") {
    const body = JSON.parse(request.postData ?? "{}");
    const nonceOk = typeof body.nonce === "string" && createHash("sha256").update(body.nonce).digest("hex") === decode(body.id_token).nonce;
    const entry = { body, nonceOk, status: null };
    tokenRequests.push(entry);
    if (tokenDelayMs) await sleep(tokenDelayMs);
    if (tokenMode === "network") {
      entry.status = "falha-de-rede";
      return b.send("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" });
    }
    if (tokenMode === "not_allowed") {
      // Cadastro desativado/recusado (ex.: hook de allowlist) — formato atual da API.
      entry.status = 422;
      return reply(422, JSON.stringify({ code: "signup_disabled", message: "Signups not allowed for this instance" }), "application/json", API_VERSION);
    }
    if (tokenMode === "invalid" || !nonceOk) {
      entry.status = 400;
      const message = tokenMode === "invalid" ? "Bad ID token" : "Nonces mismatch";
      return reply(400, JSON.stringify({ code: "bad_oidc_token", message }), "application/json", API_VERSION);
    }
    entry.status = 200;
    return reply(200, JSON.stringify(makeSession()), "application/json", API_VERSION);
  }
  const bodyOf = () => {
    try {
      return JSON.parse(request.postData ?? "{}");
    } catch {
      return {};
    }
  };
  const q = url.searchParams;
  if (url.pathname === "/auth/v1/token" && q.get("grant_type") === "password") {
    const body = bodyOf();
    emailRequests.push({ kind: "password", email: body.email });
    if (body.email === "ana.email@example.com" && body.password === "senha-correta-123") return reply(200, JSON.stringify(makeEmailSession()), "application/json", API_VERSION);
    if (body.email === "pendente@example.com") return reply(400, JSON.stringify({ code: "email_not_confirmed", message: "Email not confirmed" }), "application/json", API_VERSION);
    return reply(400, JSON.stringify({ code: "invalid_credentials", message: "Invalid login credentials" }), "application/json", API_VERSION);
  }
  if (url.pathname === "/auth/v1/token" && q.get("grant_type") === "pkce") {
    const body = bodyOf();
    emailRequests.push({ kind: "exchange", hasVerifier: Boolean(body.code_verifier) });
    if (["codigo-recuperacao-ok", "codigo-confirmacao-ok"].includes(body.auth_code)) return reply(200, JSON.stringify(makeEmailSession()), "application/json", API_VERSION);
    return reply(404, JSON.stringify({ code: "flow_state_not_found", message: "invalid flow state, no valid flow state found" }), "application/json", API_VERSION);
  }
  if (url.pathname === "/auth/v1/signup") {
    const body = bodyOf();
    emailRequests.push({ kind: "signup", email: body.email, pkce: Boolean(body.code_challenge), redirect: q.get("redirect_to") });
    // Resposta idêntica para e-mail novo ou existente (o Supabase ofusca contas existentes).
    return reply(200, JSON.stringify({ id: "00000000-0000-4000-8000-0000000000ff", aud: "authenticated", role: "", email: body.email, identities: [], user_metadata: {}, app_metadata: { provider: "email" }, created_at: "2026-11-18T10:00:00Z", updated_at: "2026-11-18T10:00:00Z", confirmation_sent_at: "2026-11-18T10:00:00Z" }), "application/json", API_VERSION);
  }
  if (url.pathname === "/auth/v1/recover") {
    const body = bodyOf();
    emailRequests.push({ kind: "recover", email: body.email, pkce: Boolean(body.code_challenge), redirect: q.get("redirect_to") });
    return reply(200, "{}", "application/json", API_VERSION);
  }
  if (url.pathname === "/auth/v1/resend") {
    emailRequests.push({ kind: "resend" });
    return reply(200, "{}", "application/json", API_VERSION);
  }
  if (url.pathname === "/auth/v1/user" && request.method === "PUT") {
    const body = bodyOf();
    emailRequests.push({ kind: "update", hasPassword: typeof body.password === "string" && body.password.length > 0 });
    return reply(200, JSON.stringify(makeEmailUser()), "application/json", API_VERSION);
  }
  const bearerSub = (() => {
    try {
      return decode(String(request.headers.Authorization ?? request.headers.authorization ?? "").replace(/^Bearer /, "")).sub;
    } catch {
      return null;
    }
  })();
  if (url.pathname === "/auth/v1/user" && bearerSub === EMAIL_USER_ID && userEndpoint === "ok") return reply(200, JSON.stringify(makeEmailUser()));
  if (url.pathname === "/auth/v1/user") {
    return userEndpoint === "revoked"
      ? reply(403, JSON.stringify({ code: "session_not_found", message: "Session from session_id claim in JWT does not exist" }), "application/json", API_VERSION)
      : reply(200, JSON.stringify(makeUser()));
  }
  if (url.pathname === "/auth/v1/logout") return reply(204, "");
  return reply(404, "{}");
});

/* ------------------------------- Auxiliares ------------------------------- */
const WIDTHS = [320, 375, 390, 768, 1440];
const failureIs = (code) => `document.querySelector('[data-failure]')?.getAttribute('data-failure') === '${code}'`;
/** innerText com espaços Unicode (U+00A0, U+202F) normalizados — só para comparação. */
const PAGE_TEXT = `document.body.innerText.replace(/[\\u00a0\\u202f]/g, ' ')`;
const text = (s) => `${PAGE_TEXT}.includes(${JSON.stringify(s)})`;
const stepIs = (id) => `document.querySelector('section[data-step]')?.dataset.step === '${id}'`;
const storageHas = (needle) =>
  `(() => { const all = [localStorage, sessionStorage].flatMap((st) => Object.keys(st).map((k) => k + '=' + st.getItem(k))).join('\\n'); return all.includes(${needle}); })()`;
const ctaVisible = (roleLabel, path) =>
  `(() => { const el = document.querySelector('[data-testid=completion-cta]'); if (!el || !el.offsetParent) return false; const t = el.innerText; return t.includes('Conclua seu cadastro de ${roleLabel}') && t.includes('Continuar cadastro') && !!el.querySelector('a[href="${path}"]'); })()`;
const ROLE_KEY = "edusearch-account-role:00000000-0000-4000-8000-000000000001";

/** Ação de interface que precisa encontrar o elemento; falha vira verificação com diagnóstico. */
async function act(label, expression) {
  const ok = await b.evaluate(expression).catch(() => false);
  if (!ok) await check(false, `ação: ${label}`);
  await sleep(120);
}
const clickChip = (group, chip) =>
  act(
    `${group} → ${chip}`,
    `(() => {
      const g = [...document.querySelectorAll('[role=group]')].find((el) => document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.trim() === ${JSON.stringify(group)});
      const btn = g && [...g.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(chip)});
      if (!btn) return false; btn.click(); return true; })()`,
  );
const setField = (label, value) =>
  act(
    `preencher ${label}`,
    `(() => {
      const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)}));
      const el = l && (l.control || document.getElementById(l.htmlFor));
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true; })()`,
  );
const continueStep = () =>
  act("Continuar", `(() => { const x = [...document.querySelectorAll('section[data-step] button')].find((y) => y.textContent.trim() === 'Continuar'); if (!x) return false; x.click(); return true; })()`);
const clickButton = (label) =>
  act(`botão ${label}`, `(() => { const x = [...document.querySelectorAll('button')].find((y) => y.textContent.trim() === ${JSON.stringify(label)}); if (!x) return false; x.click(); return true; })()`);
const signOutFromSettings = async () => {
  await b.go(testBase + "/conta/configuracoes", 1200);
  await waitFor(text("Conta e sessão"));
  await clickButton("Sair da conta");
  await waitFor(`location.pathname === '/'`);
};

/** axe-core (WCAG 2.2 AA) na tela atual. */
async function axe(label) {
  const settled = await waitFor(
    `document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)`,
    4000,
  );
  if (!settled) await check(false, `animações não estabilizaram antes do axe: ${label}`);
  if (!(await b.evaluate("!!window.axe"))) await b.evaluate(`${AXE};1`);
  const v = await b.evaluate(
    `axe.run(document, { runOnly: { type: "tag", values: ["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"] } })
       .then((r) => r.violations.map((v) => v.id + " (" + v.nodes.length + "): " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")))`,
  );
  await check(v.length === 0, `acessibilidade (axe): ${label}${v.length ? " — " + v.join("; ") : ""}`);
}

/** Capturas (quando há pasta) e verificação de rolagem horizontal em cada largura e tema. */
async function shot(name, widths = WIDTHS) {
  const overflow = [];
  for (const w of widths) {
    for (const dark of [false, true]) {
      await b.viewport(w, { dark });
      await sleep(350);
      // innerWidth > largura emulada = o celular "diminuiu o zoom" para caber um elemento largo demais.
      if (await b.evaluate(`document.documentElement.scrollWidth > innerWidth + 1 || innerWidth > ${w} + 1`)) overflow.push(`${w}px ${dark ? "escuro" : "claro"}`);
      if (shots) await b.screenshot(join(shots, `${name}-${w}-${dark ? "escuro" : "claro"}.png`));
    }
  }
  await b.viewport(1280);
  await sleep(200);
  await check(overflow.length === 0, `${name}: sem rolagem horizontal em ${widths.join("/")} px, claro e escuro${overflow.length ? " — " + overflow.join(", ") : ""}`);
}

/**
 * CTAs da entrada (Google e e-mail) com a MESMA caixa — largura, altura e borda esquerda
 * (±1px) — e sem encostar nas laterais, nas larguras de celular e no desktop, claro e escuro.
 * Mudar o viewport também exercita o redesenho do botão do GIS na nova largura.
 */
async function ctaParity(googleSelector, label) {
  const bad = [];
  for (const w of [360, 390, 430, 1440]) {
    for (const dark of [false, true]) {
      await b.viewport(w, { dark });
      await sleep(350);
      const r = await b.evaluate(`(() => {
        const g = document.querySelector(${JSON.stringify(googleSelector)});
        const e = document.querySelector('[data-testid=email-open]');
        if (!g || !e) return "CTA ausente";
        const a = g.getBoundingClientRect(), c = e.getBoundingClientRect();
        const near = (x, y) => Math.abs(x - y) <= 1;
        if (!near(a.width, c.width) || !near(a.height, c.height) || !near(a.left, c.left))
          return "google " + Math.round(a.width) + "x" + Math.round(a.height) + " / e-mail " + Math.round(c.width) + "x" + Math.round(c.height);
        if (a.left < 16 || innerWidth - a.right < 16) return "encosta na borda";
        return "";
      })()`);
      if (r) bad.push(`${w}px ${dark ? "escuro" : "claro"}: ${r}`);
    }
  }
  await b.viewport(1280);
  await sleep(200);
  await check(bad.length === 0, `${label}: CTAs do Google e do e-mail com a mesma largura e altura${bad.length ? " — " + bad.join("; ") : ""}`);
}

/* ------------------------------ 1. Versão pública ------------------------------ */
console.log(`Versão pública (${publicBase}) — login real desligado`);
b.setStep("público /");
await b.go(publicBase + "/", 1500);
await check(
  await waitFor(`!!document.querySelector('h1 img[alt="EduSearch"]') && document.querySelectorAll('h1').length === 1 && ${text("Conectando alunos e professores.")}`),
  "título EduSearch (logo oficial) e subtítulo \"Conectando alunos e professores.\"",
);
await check(
  await b.evaluate(`(() => { const x = document.querySelector('[data-testid=email-open]'); return !!x && x.textContent.trim() === 'Continuar com e-mail' && x.getAttribute('aria-disabled') === 'true' && parseFloat(getComputedStyle(x).borderRadius) >= 999; })()`),
  "\"Continuar com e-mail\" em pílula e desabilitado sem configuração",
);
await act("clicar no e-mail desabilitado", `(() => { document.querySelector('[data-testid=email-open]').click(); return true; })()`);
await check(await b.evaluate(`!document.querySelector('[data-testid=email-access]') && ${text("O acesso por e-mail estará disponível em breve.")}`), "e-mail desabilitado não abre formulário e explica o motivo");
await check(await b.evaluate(`parseFloat(getComputedStyle(document.querySelector('[data-testid=google-signin-disabled]')).borderRadius) >= 999`), "botão do Google em pílula");
await check(await b.evaluate(`!/HackBrasil/.test(document.body.innerText)`), "sem mensagens de marketing na tela de acesso");
await check(await b.evaluate(`!!document.querySelector('main img[alt="EduSearch"]')`), "logo oficial centralizado");
await check(await b.evaluate(`document.querySelector('[data-testid=google-signin-disabled]')?.getAttribute('aria-disabled') === 'true'`), "botão do Google desabilitado sem configuração");
await ctaParity("[data-testid=google-signin-disabled]", "versão pública");
await check(await b.evaluate(`!document.querySelector('script[src*="accounts.google.com"]')`), "GIS não é carregado sem configuração");
await check(
  await b.evaluate(`[...document.querySelectorAll('a')].some((a) => a.textContent.trim() === 'Explorar demonstração' && a.getAttribute('href') === '/perfil-de-acesso')`),
  "ação secundária \"Explorar demonstração\"",
);
await check(
  await b.evaluate(`!document.querySelector('input[type=password], input[type=email]') && !/Criar conta|Já tenho uma conta|Começar agora|continue com e-mail/i.test(document.body.innerText)`),
  "sem login/cadastro por e-mail e senha nem botões separados",
);
await check(
  await b.evaluate(`!!document.querySelector('[data-testid=legal-pending]') && ${text("Ao continuar, você poderá consultar nossos Termos de Uso e nossa Política de Privacidade.")} && !document.querySelector('footer a') && !/aceito|concordo|li e aceito/i.test(document.body.innerText) && !document.querySelector('input[type=checkbox]')`),
  "texto jurídico sem links (documentos não publicados) e sem aceite fictício",
);
await axe("entrada (versão pública)");
await shot("entrada-publica");

b.setStep("rotas legadas");
const legacy = [
  ["/entrar", "/", ""],
  ["/cadastro", "/", ""],
  ["/entrar?next=%2Fconta%2Fperfil", "/", "?next=%2Fconta%2Fperfil"],
  ["/cadastro?next=https%3A%2F%2Fevil.example.com", "/", "?next=%2Fconta"],
  ["/conta", "/", "?next=%2Fconta"],
  ["/conta/cadastro/aluno", "/", "?next=%2Fconta%2Fcadastro%2Faluno"],
  ["/conta/boas-vindas", "/", "?next=%2Fconta%2Fboas-vindas"],
];
for (const [from, path, search] of legacy) {
  await b.go(publicBase + from, 900);
  await check(await waitFor(`location.pathname === '${path}' && location.search === '${search}'`), `${from} → ${path}${search} (rota legada/protegida, next seguro)`);
}

b.setStep("público: links de e-mail");
await b.go(publicBase + "/auth/nova-senha?code=codigo-qualquer-1", 1200);
await check(await waitFor(`document.querySelector('[data-email-failure]')?.getAttribute('data-email-failure') === 'not_available' && location.search === ''`), "links de e-mail indisponíveis quando o recurso está desligado");

b.setStep("público → demonstração");
await b.go(publicBase + "/", 1000);
await act("Explorar demonstração", `(() => { const a = [...document.querySelectorAll('a')].find((x) => x.textContent.trim() === 'Explorar demonstração'); a.click(); return true; })()`);
await check(await waitFor(`location.pathname === '/perfil-de-acesso'`), "demonstração acessível sem login");
await check(seen.length === 0, "nenhuma requisição ao Google ou ao Supabase na versão pública");

/* --------------------------- 2. Ambiente de testes --------------------------- */
console.log(`Ambiente de testes (${testBase}) — GIS e Supabase falsos`);
b.setStep("inicialização do GIS");
await b.go(testBase + "/", 1500);
await check(await waitFor(`!!document.querySelector('[data-fake-gis]')`), "botão oficial do GIS renderizado na entrada única");
const cfg = await b.evaluate(`window.__gis.config`);
await check(cfg?.client_id === CLIENT_ID, "GIS inicializado com o Client ID público");
await check(/^[0-9a-f]{64}$/.test(cfg?.nonce ?? ""), "GIS recebe o HASH SHA-256 (hex) do nonce");
await check(cfg?.ux_mode === "popup" && cfg?.auto_select === false, "popup do Google, sem login automático");
await check((await b.evaluate(`window.__gis.inits`)) === 1, "GIS inicializado uma única vez (React StrictMode)");
await check((await b.evaluate(`document.querySelectorAll('script[src*="accounts.google.com/gsi/client"]').length`)) === 1, "script do GIS injetado uma única vez");
const opts = await b.evaluate(`window.__gis.opts`);
await check(opts?.text === "continue_with" && opts?.locale === "pt-BR" && opts?.type === "standard", "botão \"Continuar com o Google\" em pt-BR");
await check(opts?.shape === "pill", "botão oficial do GIS com shape \"pill\" (sem CSS no iframe)");
{
  // Tema do botão oficial acompanha o app: "outline" no claro, "outline_dark" no escuro
  // ("filled_black" deixava o botão personalizado com contorno claro destoando do e-mail).
  // Opções efetivamente ENVIADAS ao GIS; a aparência real foi conferida no GIS de verdade.
  const seen = {};
  for (const dark of [false, true]) {
    await b.viewport(390, { dark });
    await sleep(500);
    seen[dark ? "escuro" : "claro"] = await b.evaluate(
      `(() => { const o = window.__gis.opts; const box = document.querySelector('[data-testid=google-signin]')?.parentElement; return o && [o.theme, o.shape, o.size, o.width === Math.floor(box.clientWidth)].join("/"); })()`,
    );
  }
  await b.viewport(1280);
  await sleep(200);
  await check(
    seen.claro === "outline/pill/large/true" && seen.escuro === "outline_dark/pill/large/true",
    `tema do GIS: "outline" no claro e "outline_dark" no escuro, pill, large, largura do contêiner (${JSON.stringify(seen)})`,
  );
}
await check(!(await b.evaluate(text("Fase de testes"))), "sem aviso fixo de \"Fase de testes\" na tela de acesso");
await ctaParity("[data-testid=google-signin] [data-fake-gis]", "login Google ativo");
{
  /*
   * Variante PERSONALIZADA ("Continuar como …"): no tema escuro o documento do iframe do GIS não
   * declara o color-scheme da página e o navegador pinta o iframe com fundo opaco (moldura branca
   * de 372×44 px). O contêiner precisa resolver color-scheme "light" nos dois temas para o fundo
   * do iframe continuar transparente — sem recorte e sem CSS dentro do iframe.
   */
  await b.evaluate(`window.__gisVariant = "personalized"`);
  const bad = [];
  for (const w of [320, 360, 390, 430, 1440]) {
    for (const dark of [false, true]) {
      await b.viewport(w, { dark }); // largura/tema novos → o app redesenha o botão
      await sleep(450);
      const r = await b.evaluate(`(() => {
        const wrap = document.querySelector('[data-testid=google-signin] [data-fake-gis-personalized]');
        const f = wrap?.querySelector('iframe');
        const e = document.querySelector('[data-testid=email-open]');
        if (!wrap || !f || !e) return "variante personalizada não desenhada";
        if (getComputedStyle(f).colorScheme !== "light") return "iframe herda color-scheme " + getComputedStyle(f).colorScheme + " (fundo opaco no escuro)";
        const a = wrap.getBoundingClientRect(), c = e.getBoundingClientRect();
        const near = (x, y) => Math.abs(x - y) <= 1;
        if (!near(a.width, c.width) || !near(a.height, c.height) || !near(a.left, c.left))
          return "google " + Math.round(a.width) + "x" + Math.round(a.height) + " / e-mail " + Math.round(c.width) + "x" + Math.round(c.height);
        if (document.documentElement.scrollWidth > innerWidth + 1) return "rolagem horizontal";
        return "";
      })()`);
      if (r) bad.push(`${w}px ${dark ? "escuro" : "claro"}: ${r}`);
    }
  }
  await b.evaluate(`delete window.__gisVariant`);
  // 1440 → 1280 não muda a largura do contêiner (352 px): passa por 390 px para redesenhar.
  await b.viewport(390);
  await sleep(400);
  await b.viewport(1280);
  await sleep(400);
  await check(
    bad.length === 0,
    `botão Google personalizado: sem fundo opaco no iframe (color-scheme), mesma caixa do e-mail, 320–1440 px, claro e escuro${bad.length ? " — " + bad.join("; ") : ""}`,
  );
  await check(
    await waitFor(`!!document.querySelector('[data-testid=google-signin] [data-fake-gis]')`),
    "botão genérico volta a ser desenhado após a variante personalizada",
  );
}
await axe("entrada com login Google ativo");
await shot("entrada-google");

b.setStep("login cancelado");
await b.evaluate(`window.__gisMode = 'cancel'; document.querySelector('[data-fake-gis]').click()`);
await sleep(800);
await check(
  (await b.evaluate(`location.pathname === '/' && !document.querySelector('[data-failure]') && !document.querySelector('[role=alert]')`)) && tokenRequests.length === 0,
  "cancelar o seletor não gera erro nem sessão",
);

b.setStep("token inválido (cliente)");
await b.evaluate(`window.__gisMode = 'badaud'; document.querySelector('[data-fake-gis]').click()`);
await check(await waitFor(failureIs("invalid_token")), "token de outro Client ID é recusado antes do Supabase");
b.setStep("nonce inválido (cliente)");
await waitFor(`!!document.querySelector('[data-fake-gis]')`);
await b.evaluate(`window.__gisMode = 'badnonce'; document.querySelector('[data-fake-gis]').click()`);
await check(await waitFor(failureIs("invalid_nonce")), "token com nonce desconhecido é recusado");
await check(tokenRequests.length === 0, "credenciais inválidas não chegam ao Supabase");
await shot("entrada-erro", [390]);

b.setStep("token inválido (servidor)");
tokenMode = "invalid";
tokenDelayMs = 1500;
const nonceBefore = await b.evaluate(`window.__gis.config.nonce`);
await waitFor(`!!document.querySelector('[data-fake-gis]')`);
await b.evaluate(`window.__gisMode = 'ok'; document.querySelector('[data-fake-gis]').click()`);
await check(await waitFor(`document.querySelector('[data-auth-phase]')?.getAttribute('data-auth-phase') === 'signing' && !!document.querySelector('[role=status]')`, 1400), "estado acessível \"Entrando com sua conta Google…\" durante a validação");
// O tema do sistema muda enquanto o Supabase responde (o botão é redesenhado).
await b.viewport(1280, { dark: true });
await check(await waitFor(failureIs("invalid_token")), "Supabase recusa o ID token → mensagem de token inválido");
await check(await b.evaluate(`document.querySelector('[role=alert]')?.innerText.includes('Não foi possível validar sua conta Google')`), "alerta de token inválido com texto visível");
await check(await b.evaluate(`document.querySelector('[data-auth-phase]')?.getAttribute('data-auth-phase') === 'ready'`), "trocar o tema durante a validação não descarta o resultado do login");
await b.viewport(1280);
tokenDelayMs = 0;
await check(tokenRequests.at(-1)?.nonceOk === true, "Supabase recebe o nonce ORIGINAL (SHA-256 confere com o claim)");
await check(tokenRequests.at(-1)?.body.provider === "google" && !("access_token" in tokenRequests.at(-1).body), "signInWithIdToken com provider google, sem access token do Google");
await check((await b.evaluate(`window.__gis.config.nonce`)) === nonceBefore, "falha não reinicializa o GIS nem troca nonce no mesmo documento");
await act("reiniciar tentativa de login", `(() => { const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Atualizar página e tentar novamente')); button?.click(); return !!button; })()`);
await b.go(testBase + "/", 1200); // nova página = nova tentativa/nonce, sem reutilização insegura
await check(await waitFor(`!!document.querySelector('[data-fake-gis]')`), "nova tentativa segura carrega uma nova página");

b.setStep("reutilização de token");
const before = tokenRequests.length;
await b.evaluate(`window.__gis.replay()`);
await check(await waitFor(failureIs("invalid_nonce")), "reenviar um ID token já usado é bloqueado (nonce de uso único)");
await check(tokenRequests.length === before, "token reutilizado não chega ao Supabase");

b.setStep("erro de rede");
tokenMode = "network";
await waitFor(`!!document.querySelector('[data-fake-gis]')`);
await b.evaluate(`document.querySelector('[data-fake-gis]').click()`);
await check(await waitFor(failureIs("network")), "falha de rede tratada com mensagem acessível");
await check(await b.evaluate(`!!document.querySelector('[role=alert]')`), "erros anunciados com role=alert");
ignoreExpectedNetworkErrors();
await b.go(testBase + "/", 1200);
await check(await waitFor(`!!document.querySelector('[data-fake-gis]')`), "falha de rede reinicia a tentativa com nova página");

b.setStep("usuário não autorizado");
tokenMode = "not_allowed";
await waitFor(`!!document.querySelector('[data-fake-gis]')`);
await b.evaluate(`document.querySelector('[data-fake-gis]').click()`);
await check(await waitFor(failureIs("not_allowed")), "conta fora da lista de testes: cadastro recusado pelo Supabase");
await check(await b.evaluate(`document.querySelector('[role=alert]')?.innerText.includes('Conta não liberada para testes')`), "mensagem \"Conta não liberada para testes\"");
await check(await b.evaluate(`localStorage.getItem('edusearch-auth') === null && location.pathname === '/'`), "nenhuma sessão criada para usuário não autorizado");
await shot("entrada-nao-autorizado", [390]);
ignoreExpectedNetworkErrors();

/* ------------------------- Acesso por e-mail (estágio testing) ------------------------- */
b.setStep("e-mail: formulário");
const EMAIL_OK = "ana.email@example.com";
const PASSWORD_OK = "senha-correta-123";
const openEmail = async () => {
  await b.go(testBase + "/", 1200);
  await act("abrir e-mail", `(() => { const x = document.querySelector('[data-testid=email-open]'); if (!x || x.getAttribute('aria-disabled') === 'true') return false; x.click(); return true; })()`);
  return waitFor(`document.querySelector('[data-testid=email-access]')?.dataset.view === 'signin'`);
};
const emailView = (v) => `document.querySelector('[data-testid=email-access]')?.dataset.view === '${v}'`;
const emailFailure = (code) => `document.querySelector('[data-email-failure]')?.getAttribute('data-email-failure') === '${code}'`;
/** Envia o formulário pelo botão type=submit (as abas "Entrar"/"Criar conta" têm o mesmo texto). */
const submitEmail = (label) =>
  act(`enviar: ${label}`, `(() => { const x = [...document.querySelectorAll('form button[type=submit]')].find((y) => y.textContent.trim() === ${JSON.stringify(label)}); if (!x) return false; x.click(); return true; })()`);

await check(await openEmail(), "\"Continuar com e-mail\" abre o formulário na mesma tela");
await check(
  await b.evaluate(`document.querySelector('input[name=email]')?.autocomplete === 'username' && document.querySelector('input[name=password]')?.autocomplete === 'current-password'`),
  "campos com autocomplete adequado (gerenciadores de senha)",
);
await check(!(await b.evaluate(text("Fase de testes"))), "formulário de e-mail sem aviso fixo de \"Fase de testes\"");
await axe("acesso por e-mail — entrar");
await shot("email-entrar", [320, 390, 1440]);

await act("mostrar senha", `(() => { const t = document.querySelector('button[aria-label="Mostrar senha"]'); t.click(); return true; })()`);
await check(await waitFor(`document.querySelector('input[name=password]')?.type === 'text' && document.querySelector('button[aria-label="Ocultar senha"]')?.getAttribute('aria-pressed') === 'true'`), "mostrar senha");
await act("ocultar senha", `(() => { document.querySelector('button[aria-label="Ocultar senha"]').click(); return true; })()`);
await check(await waitFor(`document.querySelector('input[name=password]')?.type === 'password'`), "ocultar senha");

await submitEmail("Entrar");
await check(
  await waitFor(`document.querySelector('input[name=email]')?.getAttribute('aria-invalid') === 'true' && document.activeElement?.name === 'email'`),
  "envio vazio: erro no campo e foco no primeiro campo inválido",
);

b.setStep("e-mail: credenciais incorretas");
await setField("E-mail", EMAIL_OK);
await setField("Senha", "senha-errada-1");
await submitEmail("Entrar");
await check(await waitFor(emailFailure("invalid_credentials")), "credenciais incorretas: erro acessível");
await check(await b.evaluate(`document.querySelector('[role=alert]')?.innerText.includes('E-mail ou senha incorretos.')`), "mensagem não revela se o erro é do e-mail ou da senha");
await check(emailRequests.some((r) => r.kind === "password" && r.email === EMAIL_OK), "login enviado ao Supabase (signInWithPassword)");
await check(!(await b.evaluate(storageHas(JSON.stringify("senha-errada-1")))) && !seen.some((r) => r.url.includes("senha-errada")), "senha nunca vai para storage ou URL");
ignoreExpectedNetworkErrors();

b.setStep("e-mail: não confirmado");
await setField("E-mail", "pendente@example.com");
await setField("Senha", "qualquer-senha-1");
await submitEmail("Entrar");
await check(await waitFor(emailFailure("email_not_confirmed")), "e-mail não confirmado: orientação para confirmar");
await act("reenviar confirmação", `(() => { const x = [...document.querySelectorAll('button')].find((y) => y.textContent.trim() === 'Reenviar confirmação'); x.click(); return true; })()`);
await check(await waitFor(`${emailView("sent")} && ${text("Se houver um cadastro pendente")}`), "reenvio de confirmação com resposta genérica");
await check(emailRequests.some((r) => r.kind === "resend"), "reenvio enviado ao Supabase (resend)");
await check(await b.evaluate(`[...document.querySelectorAll('button')].some((x) => /^Reenviar em \\d+ s$/.test(x.textContent.trim()) && x.disabled)`), "reenvio com intervalo de espera (anti-abuso)");
ignoreExpectedNetworkErrors();

b.setStep("e-mail: criar conta");
await check(await openEmail(), "reabrir o formulário");
await act("aba Criar conta", `(() => { const r = [...document.querySelectorAll('[role=radio]')].find((x) => x.textContent.trim() === 'Criar conta'); r.click(); return true; })()`);
await check(await waitFor(`${emailView("signup")} && document.querySelector('input[name=password]')?.autocomplete === 'new-password'`), "criar conta usa senha nova (autocomplete new-password)");
await setField("E-mail", "existente@example.com");
await setField("Senha", "curta");
await submitEmail("Criar conta");
await check(await waitFor(`document.querySelector('input[name=password]')?.getAttribute('aria-invalid') === 'true'`), "senha fraca recusada antes do envio");
await setField("Senha", "senha-nova-segura-1");
await submitEmail("Criar conta");
await check(await waitFor(`${emailView("sent")} && ${text("Se este e-mail puder ser usado")}`), "cadastro com e-mail existente: resposta genérica");
const sentExisting = await b.evaluate(`document.querySelector('[data-testid=email-sent]')?.innerText`);
await check(await openEmail(), "reabrir para novo cadastro");
await act("aba Criar conta", `(() => { const r = [...document.querySelectorAll('[role=radio]')].find((x) => x.textContent.trim() === 'Criar conta'); r.click(); return true; })()`);
await waitFor(emailView("signup"));
await setField("E-mail", "nova.pessoa@example.com");
await setField("Senha", "senha-nova-segura-2");
await submitEmail("Criar conta");
await waitFor(emailView("sent"));
await check((await b.evaluate(`document.querySelector('[data-testid=email-sent]')?.innerText`)) === sentExisting, "mesma resposta para e-mail novo e existente (sem enumeração)");
const signup = emailRequests.filter((r) => r.kind === "signup").at(-1);
await check(Boolean(signup?.pkce) && signup?.redirect?.endsWith("/auth/confirmacao"), "cadastro com PKCE e retorno para /auth/confirmacao");
await axe("acesso por e-mail — verifique seu e-mail");
await shot("email-verifique", [390]);

b.setStep("e-mail: recuperar senha");
await check(await openEmail(), "reabrir para recuperar senha");
await act("esqueci minha senha", `(() => { const x = [...document.querySelectorAll('button')].find((y) => y.textContent.trim() === 'Esqueci minha senha'); x.click(); return true; })()`);
await check(await waitFor(`${emailView("reset")} && !document.querySelector('input[name=password]')`), "recuperar senha pede só o e-mail");
await setField("E-mail", "ninguem@example.com");
await submitEmail("Enviar link");
await check(await waitFor(`${emailView("sent")} && ${text("Se houver uma conta com este e-mail")}`), "recuperação com resposta genérica");
const recover = emailRequests.filter((r) => r.kind === "recover").at(-1);
await check(recover?.redirect?.endsWith("/auth/nova-senha") && Boolean(recover?.pkce), "recuperação com PKCE e retorno para /auth/nova-senha");

b.setStep("e-mail: nova senha");
await b.go(testBase + "/auth/nova-senha?code=codigo-recuperacao-ok", 1500);
await check(await waitFor(`!!document.querySelector('[data-testid=new-password]') && location.search === ''`), "link de recuperação válido abre o formulário e o código sai da URL");
await setField("Nova senha", "curta");
await submitEmail("Salvar nova senha");
await check(await waitFor(`document.querySelector('input[name=password]')?.getAttribute('aria-invalid') === 'true'`), "nova senha fraca recusada");
await setField("Nova senha", "senha-nova-segura-3");
await submitEmail("Salvar nova senha");
await check(await waitFor(`!!document.querySelector('[data-testid=password-updated]')`), "senha atualizada (updateUser)");
await check(emailRequests.some((r) => r.kind === "update" && r.hasPassword), "nova senha enviada ao Supabase");
await check(!(await b.evaluate(storageHas(JSON.stringify("senha-nova-segura-3")))), "nova senha não fica no navegador");
await shot("email-nova-senha", [390]);
await signOutFromSettings();

b.setStep("e-mail: links inválidos");
await b.go(testBase + "/auth/confirmacao?code=codigo-invalido-1", 1500);
await check(await waitFor(`document.querySelector('[data-email-failure]')?.getAttribute('data-email-failure') === 'link_invalid'`), "link de confirmação inválido ou de outro navegador");
await b.go(testBase + "/auth/confirmacao?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", 1200);
await check(await waitFor(`document.querySelector('[data-email-failure]')?.getAttribute('data-email-failure') === 'link_invalid' && location.search === ''`), "link expirado: mensagem e URL limpa");
ignoreExpectedNetworkErrors();

b.setStep("e-mail: confirmação e login");
// PKCE: o link só é trocado no navegador que pediu o e-mail — como um usuário real, cadastra antes.
await check(await openEmail(), "reabrir para cadastrar antes de confirmar");
await act("aba Criar conta", `(() => { const r = [...document.querySelectorAll('[role=radio]')].find((x) => x.textContent.trim() === 'Criar conta'); r.click(); return true; })()`);
await waitFor(emailView("signup"));
await setField("E-mail", EMAIL_OK);
await setField("Senha", PASSWORD_OK);
await submitEmail("Criar conta");
await waitFor(emailView("sent"));
await b.go(testBase + "/auth/confirmacao?code=codigo-confirmacao-ok", 1500);
await check(await waitFor(`!!document.querySelector('[data-testid=email-confirmed]')`), "e-mail confirmado pelo link");
await signOutFromSettings();
await check(await openEmail(), "reabrir para entrar");
await setField("E-mail", EMAIL_OK);
await setField("Senha", PASSWORD_OK);
await submitEmail("Entrar");
await check(await waitFor(`location.pathname === '/conta/boas-vindas' && ${text("Olá, ana.email!")}`), "login por e-mail: primeiro acesso leva às boas-vindas");
await check(await b.evaluate(`!/senha-correta/.test(localStorage.getItem('edusearch-auth') ?? '')`), "senha não é gravada na sessão");
await check(!seen.some((r) => /\/user\/identities|link_identity|linkIdentity/.test(r.url)), "nenhuma vinculação automática de identidades");
await signOutFromSettings();
await check(await b.evaluate(`localStorage.getItem('edusearch-auth') === null`), "logout da conta de e-mail");

b.setStep("primeiro acesso");
tokenMode = "ok";
userVariant = "full";
await b.evaluate(`sessionStorage.setItem('edusearch-demo-session', JSON.stringify({ role: 'student', name: 'Ana' }))`);
await waitFor(`!!document.querySelector('[data-fake-gis]')`);
await b.evaluate(`document.querySelector('[data-fake-gis]').click()`);
await check(await waitFor(`location.pathname === '/conta/boas-vindas' && ${text("Olá, Ana! Como você quer usar o EduSearch?")}`), "usuário autorizado: primeiro acesso leva às boas-vindas");
await check(
  await b.evaluate(`(() => { const s = document.querySelector('[data-role=student]')?.innerText ?? ''; const t = document.querySelector('[data-role=teacher]')?.innerText ?? '';
    return s.includes('Quero aprender') && s.includes('Encontrar professores') && s.includes('Agendar aulas') && s.includes('Acompanhar meu aprendizado')
      && t.includes('Quero ensinar') && t.includes('Apresentar especialidades') && t.includes('Disponibilizar horários') && t.includes('Receber solicitações de alunos'); })()`),
  "duas opções: \"Quero aprender\" e \"Quero ensinar\"",
);
await check(await waitFor(`[...document.querySelectorAll('header img')].some((i) => i.src.includes('googleusercontent.com') && i.complete && i.naturalWidth > 0)`), "foto do Google exibida (avatar presente)");
await check(await b.evaluate(`[...document.querySelectorAll('img[src*="googleusercontent"]')].every((i) => i.referrerPolicy === 'no-referrer' && getComputedStyle(i).borderRadius !== '0px')`), "foto circular e sem Referer");
await check(await b.evaluate(`sessionStorage.getItem('edusearch-demo-session') === null`), "sessão demonstrativa encerrada ao entrar com a conta real");
await check(await b.evaluate(`!/Profa\\. Marina|Ana \\(demonstração\\)/.test(document.body.innerText)`), "nenhum dado fictício na conta real");
const lastToken = JSON.stringify(await b.evaluate(`window.__gis.lastToken`));
await check(!(await b.evaluate(storageHas(lastToken))), "ID token do Google não é armazenado (localStorage/sessionStorage)");
await check(!(await b.evaluate(storageHas(JSON.stringify(tokenRequests.at(-1).body.nonce)))), "nonce original não é armazenado");
await check(!seen.some((r) => r.url.includes(JSON.parse(lastToken))), "ID token nunca aparece em URLs");
await check(!(await b.evaluate(`location.href.includes('token') || location.href.includes('code=')`)), "URL do app sem tokens");
await check(!seen.some((r) => r.method === "GET" && r.host.endsWith("supabase.co") && r.path === "/auth/v1/authorize"), "nenhum redirecionamento para *.supabase.co");
await axe("boas-vindas (primeiro acesso)");
await shot("boas-vindas");

b.setStep("onboarding do aluno");
const requestsBeforeOnboarding = seen.length;
await act("Quero aprender", `(() => { document.querySelector('[data-role=student]').click(); return true; })()`);
await check(await waitFor(`location.pathname === '/conta/cadastro/aluno' && ${stepIs("voce")}`), "\"Quero aprender\" abre o cadastro do aluno");
await check(await b.evaluate(`localStorage.getItem('${ROLE_KEY}') === 'student'`), "escolha guardada só como preferência local");
await check(await waitFor(`document.querySelector('main [data-testid=profile-email]')?.textContent.trim() === 'ana.teste@example.com'`), "e-mail exibido");
await check(await b.evaluate(`document.querySelector('main [data-testid=profile-name]')?.textContent === 'Ana Teste' && !!document.querySelector('main img[src*="googleusercontent"]')`), "nome e foto vindos do Google");
await check(await b.evaluate(`!!document.querySelector('[data-testid=onboarding-preview-notice]')`), "aviso de prévia: nada é enviado nem salvo");
await axe("cadastro do aluno — etapa 1");
await shot("aluno-etapa-1", [320, 390, 1440]);
await continueStep();
await check(await waitFor(`${stepIs("objetivo")} && document.activeElement?.tagName === 'H1'`), "ao avançar, o foco vai para o título da etapa");
await continueStep();
await check(await waitFor(`${stepIs("objetivo")} && document.querySelector('section[data-step] [role=alert]')?.textContent.includes('Conte em poucas palavras')`), "etapa incompleta explica o que falta (role=alert)");
await setField("Seu objetivo", "Passar no ENEM com boa nota em matemática");
await clickChip("Nível atual", "Ensino médio");
await continueStep();
await check(await waitFor(stepIs("materias")), "objetivo e nível → disciplinas");
await clickChip("Disciplinas de interesse", "Matemática");
await clickChip("Principais dificuldades", "Resolver exercícios e provas");
await continueStep();
await check(await waitFor(stepIs("rotina")), "disciplinas → disponibilidade");
await clickChip("Dias disponíveis", "Seg");
await clickChip("Períodos", "Noite");
await clickChip("Modalidade", "Online");
await clickChip("Valor por aula", "R$ 50 a R$ 80");
await axe("cadastro do aluno — disponibilidade");
await continueStep();
await check(await waitFor(`${stepIs("revisao")} && ${text("Passar no ENEM com boa nota em matemática")} && ${text("R$ 50 a R$ 80")}`), "revisão mostra as respostas");
await check(await b.evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Salvar perfil')?.disabled === true`), "\"Salvar perfil\" bloqueado até existir a API de perfis");
await check(!(await b.evaluate(storageHas(JSON.stringify("Passar no ENEM")))), "respostas do onboarding não são gravadas no navegador");
await check(!seen.slice(requestsBeforeOnboarding).some((r) => r.method === "POST"), "respostas do onboarding não são enviadas a nenhum servidor");
await axe("cadastro do aluno — revisão");
await shot("aluno-revisao", [320, 390, 1440]);
await act("Voltar", `(() => { const x = [...document.querySelectorAll('section[data-step] button')].find((y) => y.textContent.trim() === 'Voltar'); x.click(); return true; })()`);
await check(await waitFor(`${stepIs("rotina")} && document.querySelector('[aria-pressed=true]')?.textContent.includes('Seg')`), "voltar preserva as respostas da etapa (em memória)");

b.setStep("início da conta (sessão existente)");
await b.go(testBase + "/conta", 1800);
await check(await waitFor(ctaVisible("aluno", "/conta/cadastro/aluno")), "usuário sem perfil concluído vê \"Continuar cadastro\"");
await check(await b.evaluate(`${text("Cadastro em análise")} && !/cadastro conclu[ií]do/i.test(document.body.innerText)`), "perfil provisório não aparece como cadastro concluído");
await check(await b.evaluate(`!!document.querySelector('[data-shell=account]') && !${text("Modo demonstração")}`), "sessão autenticada diferenciada da demonstração");
await check(await b.evaluate(`document.querySelector('main [data-testid=profile-email]')?.textContent.trim() === 'ana.teste@example.com'`), "início da conta mostra nome, e-mail e foto");
await axe("início da conta");
await shot("conta-inicio", [390, 1440]);
await b.go(testBase + "/conta/cadastro/aluno", 1200);
await check(await waitFor(`${stepIs("voce")} && ${text("Etapa 1 de 5")}`), "respostas não persistem: ao reabrir, o cadastro recomeça");

b.setStep("onboarding do professor");
await b.go(testBase + "/conta/boas-vindas", 1500);
await act("Quero ensinar", `(() => { document.querySelector('[data-role=teacher]').click(); return true; })()`);
await check(await waitFor(`location.pathname === '/conta/cadastro/professor' && ${stepIs("voce")}`), "\"Quero ensinar\" abre o cadastro do professor");
await check(await b.evaluate(`localStorage.getItem('${ROLE_KEY}') === 'teacher'`), "troca de papel atualiza a preferência local");
await continueStep();
await check(await waitFor(`document.querySelector('section[data-step] [role=alert]')?.textContent.includes('apresentação')`), "biografia obrigatória (mínimo de caracteres)");
await setField("Biografia profissional", "Professor de física há sete anos, com foco em vestibulares e aulas práticas.");
await continueStep();
await check(await waitFor(stepIs("ensino")), "biografia → disciplinas e formação");
await clickChip("Disciplinas", "Física");
await setField("Formação acadêmica", "Licenciatura em Física");
await clickChip("Experiência como professor", "3 a 5 anos");
await continueStep();
await check(await waitFor(stepIs("aulas")), "formação → aulas");
await clickChip("Metodologia", "Resolução de exercícios");
await setField("Valor da aula", "80");
await check(
  await waitFor(`(() => { const t = (document.querySelector('[data-testid=commission-preview]')?.textContent ?? '').replace(/[\\u00a0\\u202f]/g, ' '); return t.includes('15%') && t.includes('R$ 12,00') && t.includes('R$ 68,00'); })()`),
  "comissão padrão de 15%: R$ 80,00 → R$ 12,00 EduSearch e R$ 68,00 ao professor",
);
await check(await b.evaluate(text("ainda não se aplicam")), "descontos e premiações indicados como planejados, sem taxa reduzida");
await clickChip("Duração das aulas", "60 min");
await clickChip("Modalidade", "Online");
await axe("cadastro do professor — aulas");
await shot("professor-aulas", [320, 390, 1440]);
await continueStep();
await check(await waitFor(stepIs("agenda")), "aulas → disponibilidade");
await clickChip("Dias", "Ter");
await clickChip("Períodos", "Tarde");
await continueStep();
await check(await waitFor(`${stepIs("documentos")} && ${text("Não envie documentos agora.")}`), "documentos: etapa apenas informativa");
await check(await b.evaluate(`!document.querySelector('input[type=file]')`), "sem upload de documentos reais");
await check(
  await b.evaluate(`![...document.querySelectorAll('span, p, strong')].some((e) => /^(professor )?verificad[oa]$/i.test(e.textContent.trim()))`),
  "nenhum selo de professor verificado",
);
await continueStep();
await check(await waitFor(`${stepIs("revisao")} && ${text("Pendente (etapa futura)")} && ${text("R$ 80,00")}`), "revisão do professor com verificação pendente");
await check(await b.evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Salvar perfil')?.disabled === true`), "\"Salvar perfil\" do professor bloqueado");
await check(!(await b.evaluate(storageHas(JSON.stringify("Professor de física")))), "biografia não é gravada no navegador");
await axe("cadastro do professor — revisão");

b.setStep("perfil e configurações");
await b.go(testBase + "/conta/perfil", 1500);
await check(await waitFor(`${text("Meu perfil")} && document.querySelector('[data-testid=profile-name]')?.textContent === 'Ana Teste'`), "Meu perfil mostra nome, e-mail e foto");
await check(await b.evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.includes('Concluir perfil'))?.disabled === true`), "\"Concluir perfil\" bloqueado até existir backend");
await b.go(testBase + "/conta/configuracoes", 1500);
await check(await waitFor(text("Conta e sessão")), "configurações exibem a conta e a sessão");

b.setStep("restauração da sessão");
const userCalls = seen.filter((r) => r.path === "/auth/v1/user").length;
await b.go(testBase + "/conta", 2000);
await check(await waitFor(text("Ana Teste")), "sessão restaurada após recarregar a página");
await check(seen.filter((r) => r.path === "/auth/v1/user").length > userCalls, "sessão restaurada é confirmada no servidor (getUser)");
await b.go(testBase + "/", 1500);
await check(
  await waitFor(`(() => { const a = document.querySelector('[data-testid=continue-account] a'); return !!a && a.textContent.includes('Continuar como Ana') && a.getAttribute('href') === '/conta'; })()`),
  "sessão existente: a entrada oferece \"Continuar como Ana\" para a próxima etapa",
);
await shot("entrada-sessao-ativa", [390]);

b.setStep("demonstração independente");
await b.go(testBase + "/perfil-de-acesso", 1200);
await b.evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.includes('Continuar como aluno')).click()`);
await check(await waitFor(`location.pathname === '/aluno' && ${text("Modo demonstração")} && !${text("Ana Teste")}`), "demonstração continua funcionando, sem dados da conta real");
await b.go(testBase + "/", 1200);
await check(
  await waitFor(`[...document.querySelectorAll('a')].some((a) => a.textContent.trim() === 'Continuar demonstração' && a.getAttribute('href') === '/aluno') && !!document.querySelector('[data-testid=continue-account]')`),
  "entrada distingue a sessão real e a demonstração",
);
await b.go(testBase + "/conta", 1500);
await check(await waitFor(text("Ana Teste")), "conta real permanece separada da demonstração");

b.setStep("logout");
await signOutFromSettings();
await check(await waitFor(`location.pathname === '/' && !!document.querySelector('[data-fake-gis]')`), "logout volta para a entrada única");
await check(await b.evaluate(`location.search === ''`), "logout voluntário não guarda destino (?next) da área da conta");
await check(await b.evaluate(`localStorage.getItem('edusearch-auth') === null && localStorage.getItem('${ROLE_KEY}') === null`), "logout remove a sessão e a preferência local");
await check(seen.some((r) => r.path === "/auth/v1/logout" && r.url.includes("scope=local")), "logout revoga a sessão deste dispositivo");
await b.go(testBase + "/conta", 1200);
await check(await waitFor(`location.pathname === '/' && location.search === '?next=%2Fconta'`), "após logout, /conta exige login novamente");

b.setStep("entrar novamente sem foto e sem nome");
userVariant = "minimal";
await waitFor(`!!document.querySelector('[data-fake-gis]')`);
await b.evaluate(`window.__gisMode = 'ok'; document.querySelector('[data-fake-gis]').click()`);
await check(await waitFor(`location.pathname === '/conta/boas-vindas' && ${text("Olá, ana.teste!")}`), "entrar novamente funciona; nome ausente usa o e-mail; primeiro acesso de novo");
await check(
  await b.evaluate(`!document.querySelector('img[src*="googleusercontent"]') && !!document.querySelector('header [aria-hidden=true].rounded-full')`),
  "avatar ausente → iniciais",
);

b.setStep("foto quebrada");
await signOutFromSettings();
userVariant = "broken-photo";
await waitFor(`!!document.querySelector('[data-fake-gis]')`);
await b.evaluate(`document.querySelector('[data-fake-gis]').click()`);
await check(await waitFor(`location.pathname === '/conta/boas-vindas'`), "login com foto indisponível segue para as boas-vindas");
/** Avatares visíveis: nenhuma <img> do Google quebrada; iniciais no lugar. */
const AVATAR_FALLBACK = `(() => {
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const imgs = [...document.querySelectorAll('img[src*="googleusercontent"]')].filter(visible);
  const initials = [...document.querySelectorAll('span[aria-hidden=true].rounded-full')].filter((e) => visible(e) && /^[A-Z]{1,2}$/.test(e.textContent.trim()));
  const broken = [...document.querySelectorAll('img')].filter((i) => visible(i) && i.complete && i.naturalWidth === 0);
  return imgs.length === 0 && broken.length === 0 && initials.length > 0 && document.documentElement.scrollWidth <= innerWidth + 1;
})()`;
for (const [where, path] of [["onboarding", "/conta/boas-vindas"], ["conta", "/conta/configuracoes"]]) {
  if (where === "conta") await b.go(testBase + path, 1500);
  for (const w of [390, 1440]) {
    for (const dark of [false, true]) {
      await b.viewport(w, { dark });
      await check(await waitFor(AVATAR_FALLBACK), `foto indisponível → iniciais (${where}, ${w}px, ${dark ? "escuro" : "claro"})`);
    }
  }
}
await b.viewport(1280);
ignoreExpectedNetworkErrors();

b.setStep("sessão expirada/revogada");
userEndpoint = "revoked";
await b.go(testBase + "/conta", 2000);
await check(await waitFor(`location.pathname === '/' && ${text("Sua sessão expirou")}`), "sessão revogada no servidor leva à entrada com aviso de sessão expirada");
await check(await b.evaluate(`localStorage.getItem('edusearch-auth') === null`), "sessão expirada é removida do navegador");
userEndpoint = "ok";
ignoreExpectedNetworkErrors();

await b.close();

const all = [...failures, ...b.errors];
if (all.length) {
  console.error(`✗ auth: ${all.length} problema(s)\n  ` + all.join("\n  "));
  process.exit(1);
}
console.log("✓ auth: entrada única, login Google (GIS + Supabase), onboarding e versão pública verificados");
