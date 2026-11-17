#!/usr/bin/env node
/**
 * Smoke test de navegação (sem dependências): abre todas as rotas no Chrome
 * headless via DevTools Protocol e falha se houver erro no console, exceção
 * não tratada ou a tela "Algo deu errado".
 *
 * Rode contra o SERVIDOR DE DESENVOLVIMENTO para pegar regressões que só
 * aparecem com React StrictMode (efeitos montados/desmontados duas vezes):
 *
 *   pnpm dev:web -- --port 5190        # em outro terminal
 *   pnpm --filter @edusearch/web smoke # usa http://localhost:5190
 *   node scripts/smoke.mjs http://localhost:4173   # outra URL
 *
 * Chrome: usa CHROME_PATH ou os caminhos padrão do Windows/macOS/Linux.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = (process.argv[2] ?? "http://localhost:5190").replace(/\/$/, "");
const candidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const chromePath = candidates.find((p) => existsSync(p));
if (!chromePath) {
  console.error("Chrome não encontrado. Defina CHROME_PATH.");
  process.exit(2);
}

const ROUTES = {
  public: ["/", "/entrar", "/cadastro", "/perfil-de-acesso"],
  student: [
    "/aluno", "/aluno/buscar", "/aluno/assistente", "/aluno/recomendados", "/aluno/professores/t-marina",
    "/aluno/professores/t-marina/agendar", "/aluno/agendamento/resumo", "/aluno/aulas", "/aluno/progresso",
    "/aluno/perfil", "/aluno/buscar?demo=erro", "/aluno/aulas?demo=vazio",
  ],
  teacher: [
    "/professor", "/professor/perfil", "/professor/especialidades", "/professor/disponibilidade",
    "/professor/agenda", "/professor/aulas", "/professor/recebimentos", "/professor/configuracoes",
  ],
};
// Telas em que o estado de erro é esperado (não contam como falha).
const EXPECTED_ERROR_SCREEN = new Set(["/aluno/buscar?demo=erro"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "edusearch-smoke-"));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });

let page;
for (let i = 0; i < 60 && !page; i++) {
  try {
    page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
  } catch {}
  if (!page) await sleep(200);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
const listeners = new Set();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else listeners.forEach((l) => l(m));
});
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

const failures = [];
let current = "";
listeners.add((m) => {
  if (m.method === "Runtime.exceptionThrown") failures.push(`${current}: exceção ${m.params.exceptionDetails.exception?.description?.split("\n")[0] ?? m.params.exceptionDetails.text}`);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    failures.push(`${current}: console.error ${text.split("\n")[0].slice(0, 200)}`);
  }
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/favicon/.test(m.params.entry.url ?? "")) {
    failures.push(`${current}: ${m.params.entry.text} ${m.params.entry.url ?? ""}`);
  }
});
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");

async function go(path) {
  current = path;
  const loaded = new Promise((r) => {
    const l = (m) => m.method === "Page.loadEventFired" && (listeners.delete(l), r());
    listeners.add(l);
  });
  await send("Page.navigate", { url: base + path });
  await loaded;
  await sleep(1500); // latência simulada do mock + StrictMode
}

let checked = 0;
for (const [group, routes] of Object.entries(ROUTES)) {
  await go("/");
  await evaluate(
    group === "public"
      ? "sessionStorage.clear()"
      : `sessionStorage.setItem('edusearch-demo-session', JSON.stringify({ role: '${group}', name: 'Teste' }))`,
  );
  for (const r of routes) {
    await go(r);
    const text = (await evaluate("document.body.innerText")) ?? "";
    if (/Algo deu errado|Página não encontrada/.test(text)) failures.push(`${r}: tela de erro de rota`);
    if (!EXPECTED_ERROR_SCREEN.has(r) && /Não foi possível carregar/.test(text)) failures.push(`${r}: estado de erro inesperado`);
    const overflow = await evaluate("document.documentElement.scrollWidth > innerWidth + 1");
    if (overflow) failures.push(`${r}: rolagem horizontal`);
    checked++;
  }
}

ws.close();
chrome.kill();
await sleep(300);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}

if (failures.length) {
  console.error(`✗ smoke: ${failures.length} problema(s) em ${checked} rotas (${base})\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log(`✓ smoke: ${checked} rotas sem erros (${base})`);
