#!/usr/bin/env node
/**
 * Teste de navegador do login Google (GIS + Supabase Auth) — roda no GitHub Actions.
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
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp.mjs";

const publicBase = (process.argv[2] ?? "http://localhost:5190").replace(/\/$/, "");
const testBase = (process.argv[3] ?? "http://localhost:5191").replace(/\/$/, "");
const shots = process.argv[4];
if (shots) mkdirSync(shots, { recursive: true });
const testOrigin = new URL(testBase).origin;
const CLIENT_ID = "1234567890-edusearchci.apps.googleusercontent.com";

const b = await launch();
const failures = [];
const check = (ok, msg) => {
  if (!ok) failures.push(msg);
  else console.log(`  ✓ ${msg}`);
};
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
async function shot(name, widths = [390, 1440]) {
  if (!shots) return;
  for (const w of widths) {
    for (const dark of [false, true]) {
      await b.viewport(w, { dark });
      await sleep(350);
      await b.screenshot(join(shots, `${name}-${w}-${dark ? "escuro" : "claro"}.png`));
    }
  }
  await b.viewport(1280);
}
const ignoreExpectedNetworkErrors = () => {
  for (let i = b.errors.length - 1; i >= 0; i--)
    if (/supabase\.co|googleusercontent|status of (400|401|404)|ERR_FAILED/.test(b.errors[i])) b.errors.splice(i, 1);
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

const seen = [];
const tokenRequests = [];
let tokenMode = "ok"; // ok | invalid | network
let userVariant = "full"; // full | broken-photo | minimal
let userEndpoint = "ok"; // ok | revoked
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
        { name: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
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
    tokenRequests.push({ body, nonceOk });
    if (tokenMode === "network") return b.send("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" });
    if (tokenMode === "invalid") return reply(400, JSON.stringify({ code: 400, error_code: "bad_oidc_token", msg: "Bad ID token" }));
    if (!nonceOk) return reply(400, JSON.stringify({ code: 400, error_code: "bad_oidc_token", msg: "Nonces mismatch" }));
    return reply(200, JSON.stringify(makeSession()));
  }
  if (url.pathname === "/auth/v1/user") {
    return userEndpoint === "revoked"
      ? reply(401, JSON.stringify({ code: 401, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" }))
      : reply(200, JSON.stringify(makeUser()));
  }
  if (url.pathname === "/auth/v1/logout") return reply(204, "");
  return reply(404, "{}");
});

const failureIs = (code) => `document.querySelector('[data-failure]')?.getAttribute('data-failure') === '${code}'`;
const text = (s) => `document.body.innerText.includes(${JSON.stringify(s)})`;
const storageHas = (needle) =>
  `(() => { const all = [localStorage, sessionStorage].flatMap((st) => Object.keys(st).map((k) => k + '=' + st.getItem(k))).join('\\n'); return all.includes(${needle}); })()`;

/* ------------------------------ 1. Versão pública ------------------------------ */
console.log(`Versão pública (${publicBase}) — login real desligado`);
b.setStep("público /entrar");
await b.go(publicBase + "/entrar", 1500);
check(await b.evaluate(`document.querySelector('[data-testid=google-signin-disabled]')?.getAttribute('aria-disabled') === 'true'`), "botão do Google desabilitado");
check(await b.evaluate(`!document.querySelector('script[src*="accounts.google.com"]')`), "GIS não é carregado sem configuração");
b.setStep("público /conta");
await b.go(publicBase + "/conta", 1200);
check(await waitFor(`location.pathname === '/entrar'`), "/conta exige login (rota protegida)");
check(seen.length === 0, "nenhuma requisição ao Google ou ao Supabase na versão pública");

/* --------------------------- 2. Ambiente de testes --------------------------- */
console.log(`Ambiente de testes (${testBase}) — GIS e Supabase falsos`);
b.setStep("inicialização do GIS");
await b.go(testBase + "/entrar", 1500);
check(await waitFor(`!!document.querySelector('[data-fake-gis]')`), "botão oficial do GIS renderizado");
const cfg = await b.evaluate(`window.__gis.config`);
check(cfg?.client_id === CLIENT_ID, "GIS inicializado com o Client ID público");
check(/^[0-9a-f]{64}$/.test(cfg?.nonce ?? ""), "GIS recebe o HASH SHA-256 (hex) do nonce");
check(cfg?.ux_mode === "popup" && cfg?.auto_select === false, "popup do Google, sem login automático");
check((await b.evaluate(`window.__gis.inits`)) === 1, "GIS inicializado uma única vez (React StrictMode)");
check((await b.evaluate(`document.querySelectorAll('script[src*="accounts.google.com/gsi/client"]').length`)) === 1, "script do GIS injetado uma única vez");
const opts = await b.evaluate(`window.__gis.opts`);
check(opts?.text === "continue_with" && opts?.locale === "pt-BR" && opts?.type === "standard", "botão \"Continuar com o Google\" em pt-BR");
check(await b.evaluate(text("Acesso real · ambiente de testes")), "sessão real identificada como ambiente de testes");
await shot("login-google");

b.setStep("login cancelado");
await b.evaluate(`window.__gisMode = 'cancel'; document.querySelector('[data-fake-gis]').click()`);
await sleep(800);
check(
  (await b.evaluate(`location.pathname === '/entrar' && !document.querySelector('[data-failure]') && !document.querySelector('[role=alert]')`)) &&
    tokenRequests.length === 0,
  "cancelar o seletor não gera erro nem sessão",
);

b.setStep("token inválido (cliente)");
await b.evaluate(`window.__gisMode = 'badaud'; document.querySelector('[data-fake-gis]').click()`);
check(await waitFor(failureIs("invalid_token")), "token de outro Client ID é recusado antes do Supabase");
b.setStep("nonce inválido (cliente)");
await waitFor(`!!document.querySelector('[data-fake-gis]')`);
await b.evaluate(`window.__gisMode = 'badnonce'; document.querySelector('[data-fake-gis]').click()`);
check(await waitFor(failureIs("invalid_nonce")), "token com nonce desconhecido é recusado");
check(tokenRequests.length === 0, "credenciais inválidas não chegam ao Supabase");
await shot("login-erro", [390]);

b.setStep("token inválido (servidor)");
tokenMode = "invalid";
const nonceBefore = await b.evaluate(`window.__gis.config.nonce`);
await waitFor(`!!document.querySelector('[data-fake-gis]')`);
await b.evaluate(`window.__gisMode = 'ok'; document.querySelector('[data-fake-gis]').click()`);
check(await waitFor(failureIs("invalid_token")), "Supabase recusa o ID token → mensagem de token inválido");
check(tokenRequests.at(-1)?.nonceOk === true, "Supabase recebe o nonce ORIGINAL (SHA-256 confere com o claim)");
check(tokenRequests.at(-1)?.body.provider === "google" && !("access_token" in tokenRequests.at(-1).body), "signInWithIdToken com provider google, sem access token do Google");
await waitFor(`window.__gis.config.nonce !== ${JSON.stringify(nonceBefore)}`);
check((await b.evaluate(`window.__gis.config.nonce`)) !== nonceBefore, "nova tentativa recebe um novo nonce");

b.setStep("reutilização de token");
const before = tokenRequests.length;
await b.evaluate(`window.__gis.replay()`);
check(await waitFor(failureIs("invalid_nonce")), "reenviar um ID token já usado é bloqueado (nonce de uso único)");
check(tokenRequests.length === before, "token reutilizado não chega ao Supabase");

b.setStep("erro de rede");
tokenMode = "network";
await waitFor(`!!document.querySelector('[data-fake-gis]')`);
await b.evaluate(`document.querySelector('[data-fake-gis]').click()`);
check(await waitFor(failureIs("network")), "falha de rede tratada com mensagem acessível");
check(await b.evaluate(`!!document.querySelector('[role=alert]')`), "erros anunciados com role=alert");
ignoreExpectedNetworkErrors();

b.setStep("login com sucesso");
tokenMode = "ok";
userVariant = "full";
await b.evaluate(`sessionStorage.setItem('edusearch-demo-session', JSON.stringify({ role: 'student', name: 'Ana' }))`);
await waitFor(`!!document.querySelector('[data-fake-gis]')`);
await b.evaluate(`document.querySelector('[data-fake-gis]').click()`);
check(await waitFor(`location.pathname === '/conta' && ${text("Ana Teste")}`), "login bem-sucedido abre a conta com o nome do usuário");
check(await b.evaluate(text("ana.teste@example.com")), "e-mail exibido");
check(await waitFor(`[...document.querySelectorAll('img')].some((i) => i.src.includes('googleusercontent.com') && i.complete && i.naturalWidth > 0)`), "foto do Google exibida (avatar presente)");
check(await b.evaluate(`[...document.querySelectorAll('img[src*="googleusercontent"]')].every((i) => i.referrerPolicy === 'no-referrer' && getComputedStyle(i).borderRadius !== '0px')`), "foto circular e sem Referer");
check(await b.evaluate(`${text("Sessão autenticada")} && !${text("Modo demonstração")}`), "sessão autenticada diferenciada da demonstração");
check(await b.evaluate(`!!document.querySelector('[data-testid=completion-cta]')`), "usuário sem perfil concluído vê \"Concluir cadastro\"");
check(await b.evaluate(`sessionStorage.getItem('edusearch-demo-session') === null`), "sessão demonstrativa encerrada ao entrar com a conta real");
check(await b.evaluate(`!/Profa\\. Marina|Ana \\(demonstração\\)/.test(document.body.innerText)`), "nenhum dado fictício na conta real");
const lastToken = JSON.stringify(await b.evaluate(`window.__gis.lastToken`));
check(!(await b.evaluate(storageHas(lastToken))), "ID token do Google não é armazenado (localStorage/sessionStorage)");
check(!(await b.evaluate(storageHas(JSON.stringify(tokenRequests.at(-1).body.nonce)))), "nonce original não é armazenado");
check(!seen.some((r) => r.url.includes(JSON.parse(lastToken))), "ID token nunca aparece em URLs");
check(!(await b.evaluate(`location.href.includes('token') || location.href.includes('code=')`)), "URL do app sem tokens");
check(!seen.some((r) => r.method === "GET" && r.host.endsWith("supabase.co") && r.path === "/auth/v1/authorize"), "nenhum redirecionamento para *.supabase.co");
await shot("conta-inicio");

b.setStep("perfil e configurações");
await b.go(testBase + "/conta/perfil", 1500);
check(await waitFor(`${text("Meu perfil")} && document.querySelector('[data-testid=profile-name]')?.textContent === 'Ana Teste'`), "Meu perfil mostra nome, e-mail e foto");
await shot("conta-perfil");
await b.evaluate(`document.querySelector('input[name=papel][value=teacher]').click()`);
await sleep(200);
check(await b.evaluate(`localStorage.getItem('edusearch-account-role:00000000-0000-4000-8000-000000000001') === 'teacher'`), "papel escolhido salvo como preferência provisória");
check(await b.evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.includes('Concluir perfil'))?.disabled === true`), "\"Concluir perfil\" bloqueado até existir backend");
await b.go(testBase + "/conta/configuracoes", 1500);
check(await waitFor(text("Conta e sessão")), "configurações exibem a conta e a sessão");
await shot("conta-configuracoes", [390]);

b.setStep("restauração da sessão");
const userCalls = seen.filter((r) => r.path === "/auth/v1/user").length;
await b.go(testBase + "/conta", 2000);
check(await waitFor(text("Ana Teste")), "sessão restaurada após recarregar a página");
check(seen.filter((r) => r.path === "/auth/v1/user").length > userCalls, "sessão restaurada é confirmada no servidor (getUser)");

b.setStep("demonstração independente");
await b.go(testBase + "/perfil-de-acesso", 1200);
await b.evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.includes('Continuar como aluno')).click()`);
check(await waitFor(`location.pathname === '/aluno' && ${text("Modo demonstração")} && !${text("Ana Teste")}`), "demonstração continua funcionando, sem dados da conta real");
await b.go(testBase + "/conta", 1500);
check(await waitFor(text("Ana Teste")), "conta real permanece separada da demonstração");

b.setStep("logout");
await b.go(testBase + "/conta/configuracoes", 1500);
await b.evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Sair da conta').click()`);
check(await waitFor(`location.pathname === '/entrar'`), "logout volta para o login");
check(await b.evaluate(`localStorage.getItem('edusearch-auth') === null`), "logout remove a sessão do navegador");
check(seen.some((r) => r.path === "/auth/v1/logout" && r.url.includes("scope=local")), "logout revoga a sessão deste dispositivo");
await b.go(testBase + "/conta", 1200);
check(await waitFor(`location.pathname === '/entrar' && location.search === '?next=%2Fconta'`), "após logout, /conta exige login novamente");

b.setStep("entrar novamente sem foto e sem nome");
userVariant = "minimal";
await waitFor(`!!document.querySelector('[data-fake-gis]')`);
await b.evaluate(`window.__gisMode = 'ok'; document.querySelector('[data-fake-gis]').click()`);
check(await waitFor(`location.pathname === '/conta' && document.querySelector('[data-testid=profile-name]')?.textContent === 'ana.teste'`), "entrar novamente funciona; nome ausente usa o e-mail");
check(await b.evaluate(`!document.querySelector('main img') && !!document.querySelector('main [aria-hidden=true].rounded-full')`), "avatar ausente → iniciais");
check(await b.evaluate(`!!document.querySelector('[data-testid=completion-cta]')`), "papel provisório foi limpo no logout (cadastro pendente de novo)");

b.setStep("foto quebrada");
await b.go(testBase + "/conta/configuracoes", 1200);
await b.evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Sair da conta')?.click()`);
await waitFor(`location.pathname === '/entrar'`);
userVariant = "broken-photo";
await waitFor(`!!document.querySelector('[data-fake-gis]')`);
await b.evaluate(`document.querySelector('[data-fake-gis]').click()`);
await waitFor(`location.pathname === '/conta'`);
check(await waitFor(`!document.querySelector('main img[src*="googleusercontent"]') && !!document.querySelector('main [aria-hidden=true].rounded-full')`), "foto que falha ao carregar cai para iniciais sem quebrar o layout");
check(await b.evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`), "sem rolagem horizontal");
ignoreExpectedNetworkErrors();

b.setStep("sessão expirada/revogada");
userEndpoint = "revoked";
await b.go(testBase + "/conta", 2000);
check(await waitFor(`location.pathname === '/entrar' && ${text("Sua sessão expirou")}`), "sessão revogada no servidor leva ao login com aviso de sessão expirada");
check(await b.evaluate(`localStorage.getItem('edusearch-auth') === null`), "sessão expirada é removida do navegador");
userEndpoint = "ok";
ignoreExpectedNetworkErrors();

await b.close();

const all = [...failures, ...b.errors];
if (all.length) {
  console.error(`✗ auth: ${all.length} problema(s)\n  ` + all.join("\n  "));
  process.exit(1);
}
console.log("✓ auth: login Google (GIS + Supabase) e versão pública verificados");
