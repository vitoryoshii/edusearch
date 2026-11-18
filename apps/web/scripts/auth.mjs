#!/usr/bin/env node
/**
 * Teste de navegador do login Google (Supabase Auth) — roda no GitHub Actions.
 *
 * Usa DOIS servidores de desenvolvimento:
 *   1. "público"  (sem variáveis de auth): o login real precisa ficar DESLIGADO.
 *   2. "testes"   (VITE_AUTH_GOOGLE_ENABLED=true e um Supabase FALSO):
 *      todas as requisições a *.supabase.co são interceptadas pelo DevTools
 *      Protocol e respondidas localmente. Nenhuma chamada real ao Supabase
 *      ou ao Google é feita.
 *
 *   node scripts/auth.mjs http://localhost:5190 http://localhost:5191
 *
 * Cobre: botão oficial, escopos (sem Agenda), PKCE, estado (nonce), callback
 * com erros (cancelado, sem código, estado inválido/expirado, não autorizado,
 * troca falhou), sucesso, remoção do provider_token, restauração da sessão,
 * escolha de papel, logout, proteção de rota e separação da demonstração.
 */
import { launch, sleep } from "./lib/cdp.mjs";

const publicBase = (process.argv[2] ?? "http://localhost:5190").replace(/\/$/, "");
const testBase = (process.argv[3] ?? "http://localhost:5191").replace(/\/$/, "");
const testOrigin = new URL(testBase).origin;

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

/* ------------------------- Supabase falso (interceptado) ------------------------- */
const seen = [];
let tokenMode = "ok"; // "ok" | "fail"
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "ana.teste@example.com",
  email_confirmed_at: "2026-11-18T10:00:00Z",
  app_metadata: { provider: "google", providers: ["google"] },
  user_metadata: { full_name: "Ana Teste", avatar_url: "https://evil.example.com/foto.png" },
  identities: [],
  created_at: "2026-11-18T10:00:00Z",
  updated_at: "2026-11-18T10:00:00Z",
};
const session = {
  access_token: `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: user.id, role: "authenticated", exp, aud: "authenticated" })}.assinatura-falsa`,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: exp,
  refresh_token: "refresh-falso",
  provider_token: "google-token-falso",
  provider_refresh_token: "google-refresh-falso",
  user,
};

await b.send("Fetch.enable", { patterns: [{ urlPattern: "*supabase.co*", requestStage: "Request" }] });
b.on(async (m) => {
  if (m.method !== "Fetch.requestPaused") return;
  const { requestId, request } = m.params;
  const url = new URL(request.url);
  seen.push({ method: request.method, url });
  const headers = [
    { name: "Access-Control-Allow-Origin", value: testOrigin },
    { name: "Access-Control-Allow-Headers", value: "authorization, apikey, content-type, x-client-info, x-supabase-api-version" },
    { name: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
    { name: "Access-Control-Expose-Headers", value: "x-supabase-api-version" },
  ];
  let status = 200;
  let body = "";
  let type = "application/json";
  if (request.method === "OPTIONS") status = 204;
  else if (url.pathname === "/auth/v1/authorize") {
    type = "text/html; charset=utf-8";
    body = "<!doctype html><title>Google (falso)</title><p>Tela de consentimento simulada</p>";
  } else if (url.pathname === "/auth/v1/token") {
    if (tokenMode === "fail") {
      status = 400;
      body = JSON.stringify({ code: 400, error_code: "bad_code_verifier", msg: "invalid flow state, no valid flow state found" });
    } else body = JSON.stringify(session);
  } else if (url.pathname === "/auth/v1/user") body = JSON.stringify(user);
  else if (url.pathname === "/auth/v1/logout") status = 204;
  else status = 404;
  headers.push({ name: "Content-Type", value: type });
  await b.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: status,
    responseHeaders: headers,
    body: Buffer.from(body).toString("base64"),
  });
});

const failureShown = (code) => `document.querySelector('[data-failure]')?.getAttribute('data-failure') === '${code}'`;

/* ------------------------------ 1. Versão pública ------------------------------ */
console.log(`Versão pública (${publicBase}) — login real desligado`);
b.setStep("público /entrar");
await b.go(publicBase + "/entrar", 1200);
check(
  await b.evaluate(`document.querySelector('[data-testid=google-signin]')?.getAttribute('aria-disabled') === 'true'`),
  "botão do Google desabilitado na versão pública",
);
check(await b.evaluate(`!document.body.innerText.includes('ambiente de testes')`), "sem selo de ambiente de testes");

b.setStep("público /conta");
await b.go(publicBase + "/conta", 1200);
check(await waitFor(`location.pathname === '/entrar' && location.search === '?next=%2Fconta'`), "/conta sem sessão leva ao login");

b.setStep("público /auth/callback");
await b.go(publicBase + "/auth/callback?code=abcdefgh12345&s=" + "a".repeat(32), 1200);
check(await waitFor(failureShown("disabled")), "callback informa que o login real está indisponível");
check(await b.evaluate(`location.search === ''`), "código removido da barra de endereços");
check(seen.length === 0, "nenhuma requisição ao Supabase na versão pública");

/* --------------------------- 2. Ambiente de testes --------------------------- */
console.log(`Ambiente de testes (${testBase}) — Supabase falso`);
b.setStep("testes /entrar");
await b.go(testBase + "/entrar", 1200);
check(
  await b.evaluate(`(() => { const g = document.querySelector('[data-testid=google-signin]'); return g && !g.hasAttribute('aria-disabled') && g.textContent.includes('Continuar com o Google'); })()`),
  "botão oficial \"Continuar com o Google\" habilitado",
);
check(await b.evaluate(`document.body.innerText.includes('Acesso real · ambiente de testes')`), "sessão real identificada como ambiente de testes");

// Estados de erro do callback (nenhum chega ao Supabase).
const errorCases = [
  ["?error=access_denied&error_description=The+user+denied", "access_denied", "usuário cancelou no Google"],
  ["?error=access_denied&error_code=signup_disabled", "not_allowed", "conta fora da lista de testes"],
  ["?error=server_error&error_description=Unable+to+exchange+external+code", "provider_error", "erro do provedor"],
  ["", "missing_code", "retorno sem código"],
  ["?code=abcdefgh12345&s=" + "b".repeat(32), "invalid_state", "retorno sem login iniciado neste navegador"],
];
for (const [query, code, label] of errorCases) {
  b.setStep(`callback ${code}`);
  await b.go(testBase + "/auth/callback" + query, 800);
  check(await waitFor(failureShown(code)), `callback: ${label} (${code})`);
}
b.setStep("callback expired_state");
await b.evaluate(
  `sessionStorage.setItem('edusearch-auth-intent', JSON.stringify({ nonce: '${"c".repeat(32)}', next: '/conta', createdAt: Date.now() - 11 * 60 * 1000 }))`,
);
await b.go(testBase + "/auth/callback?code=abcdefgh12345&s=" + "c".repeat(32), 800);
check(await waitFor(failureShown("expired_state")), "callback: login expirado (expired_state)");
check(await b.evaluate(`sessionStorage.getItem('edusearch-auth-intent') === null`), "intenção de login é de uso único");
check(!seen.some((r) => r.url.pathname === "/auth/v1/token"), "erros de estado não chegam a trocar o código");

b.setStep("testes /conta sem sessão");
await b.go(testBase + "/conta", 1000);
check(await waitFor(`location.pathname === '/entrar'`), "rota real protegida sem sessão");

/** Clica no botão do Google e devolve a URL de /authorize interceptada. */
async function startLogin() {
  await b.go(testBase + "/entrar", 1000);
  const before = seen.length;
  await b.evaluate(`document.querySelector('[data-testid=google-signin]').click()`);
  const end = Date.now() + 8000;
  while (Date.now() < end && !seen.slice(before).some((r) => r.url.pathname === "/auth/v1/authorize")) await sleep(100);
  await sleep(400);
  return seen.slice(before).find((r) => r.url.pathname === "/auth/v1/authorize")?.url;
}

b.setStep("início do OAuth");
const authorize = await startLogin();
check(Boolean(authorize), "redireciona para /auth/v1/authorize do Supabase");
const p = authorize?.searchParams ?? new URLSearchParams();
check(p.get("provider") === "google", "provedor Google");
const scopes = (p.get("scopes") ?? "").split(/\s+/);
check(["openid", "email", "profile"].every((s) => scopes.includes(s)) && !/calendar/i.test(p.get("scopes") ?? ""), "escopos openid, email, profile (sem Google Agenda)");
check(Boolean(p.get("code_challenge")) && /^s256$/i.test(p.get("code_challenge_method") ?? ""), "PKCE (code_challenge S256)");
check(p.get("access_type") !== "offline", "sem refresh token do Google (access_type offline)");
const redirectTo = new URL(p.get("redirect_to") ?? "about:blank");
const nonce = redirectTo.searchParams.get("s") ?? "";
check(redirectTo.origin === testOrigin && redirectTo.pathname === "/auth/callback" && /^[0-9a-f]{32}$/.test(nonce), "redirect_to = /auth/callback da própria origem, com nonce");

// Troca do código recusada pelo servidor.
b.setStep("callback exchange_failed");
tokenMode = "fail";
await b.go(`${testBase}/auth/callback?code=codigo-falso-123&s=${nonce}`, 800);
check(await waitFor(failureShown("exchange_failed")), "callback: código inválido ou já usado (exchange_failed)");
// O 400 do Supabase falso aparece como erro de rede esperado no console.
for (let i = b.errors.length - 1; i >= 0; i--) if (/supabase\.co|status of 400/.test(b.errors[i])) b.errors.splice(i, 1);

// Sucesso.
b.setStep("login com sucesso");
tokenMode = "ok";
const nonce2 = new URL((await startLogin())?.searchParams.get("redirect_to") ?? "about:blank").searchParams.get("s");
await b.evaluate(`sessionStorage.setItem('edusearch-demo-session', JSON.stringify({ role: 'student', name: 'Ana' }))`);
await b.go(`${testBase}/auth/callback?code=codigo-falso-456&s=${nonce2}`, 800);
check(await waitFor(`location.pathname === '/conta' && document.body.innerText.includes('Ana Teste')`), "após o login, a conta mostra os dados do usuário");
check(await b.evaluate(`document.body.innerText.includes('Sessão autenticada') && !document.body.innerText.includes('Modo demonstração')`), "sessão autenticada diferenciada da demonstração");
check(await b.evaluate(`document.body.innerText.includes('ana.teste@example.com')`), "e-mail exibido");
check(await b.evaluate(`!document.querySelector('main img')`), "foto fora do domínio do Google não é carregada");
const stored = await b.evaluate(`localStorage.getItem('edusearch-auth')`);
check(Boolean(stored) && !/provider_token|google-token-falso|google-refresh-falso/.test(stored), "tokens do Google não são gravados no navegador");
check(await b.evaluate(`sessionStorage.getItem('edusearch-demo-session') === null`), "sessão de demonstração encerrada ao entrar com a conta real");
check(await b.evaluate(`!/Profa\\. Marina|Ana \\(demonstração\\)/.test(document.body.innerText)`), "nenhum dado fictício na conta real");

b.setStep("papel pretendido");
await b.evaluate(`document.querySelector('input[name=papel][value=teacher]').click()`);
await sleep(200);
check(await b.evaluate(`localStorage.getItem('edusearch-account-role:${user.id}') === 'teacher'`), "papel escolhido guardado como preferência local");
check(await b.evaluate(`document.body.innerText.includes('Professor (preferência local)')`), "conclusão do cadastro reflete o papel escolhido");
check(await b.evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.includes('Concluir perfil'))?.disabled === true`), "\"Concluir perfil\" bloqueado até existir backend e documentos jurídicos");

b.setStep("restauração da sessão");
await b.go(testBase + "/conta", 1500);
check(await waitFor(`document.body.innerText.includes('Ana Teste')`), "sessão restaurada após recarregar");
check(seen.some((r) => r.url.pathname === "/auth/v1/user"), "sessão restaurada é confirmada no servidor (getUser)");

b.setStep("logout");
await b.evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Sair').click()`);
check(await waitFor(`location.pathname === '/entrar'`), "logout volta para o login");
check(await b.evaluate(`localStorage.getItem('edusearch-auth') === null && localStorage.getItem('edusearch-account-role:${user.id}') === null`), "logout limpa sessão e papel local");
check(seen.some((r) => r.url.pathname === "/auth/v1/logout" && r.url.searchParams.get("scope") === "local"), "logout revoga a sessão deste dispositivo (scope=local)");
await b.go(testBase + "/conta", 1000);
check(await waitFor(`location.pathname === '/entrar'`), "após logout, /conta volta a exigir login");

b.setStep("demonstração preservada");
await b.go(testBase + "/perfil-de-acesso", 1000);
await b.evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.includes('Continuar como aluno')).click()`);
check(await waitFor(`location.pathname === '/aluno' && document.body.innerText.includes('Modo demonstração')`), "demonstração do aluno continua funcionando");

await b.close();

const all = [...failures, ...b.errors];
if (all.length) {
  console.error(`✗ auth: ${all.length} problema(s)\n  ` + all.join("\n  "));
  process.exit(1);
}
console.log("✓ auth: login Google (ambiente de testes) e versão pública verificados");
