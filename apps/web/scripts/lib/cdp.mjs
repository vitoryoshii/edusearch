/**
 * Utilitário mínimo para dirigir o Chrome headless pelo DevTools Protocol,
 * sem dependências. Usado por smoke.mjs e journey.mjs.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

export async function launch() {
  const chromePath = findChrome();
  if (!chromePath) throw new Error("Chrome não encontrado. Defina CHROME_PATH.");
  const profile = mkdtempSync(join(tmpdir(), "edusearch-cdp-"));
  const port = 9400 + Math.floor(Math.random() * 500);
  // Em CI (runners Linux), o sandbox do Chrome é bloqueado pelo AppArmor e /dev/shm é pequeno.
  const ciArgs = process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : [];
  const chrome = spawn(
    chromePath,
    ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", ...ciArgs, "about:blank"],
    { stdio: "ignore" },
  );

  let page;
  for (let i = 0; i < 75 && !page; i++) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    } catch {}
    if (!page) await sleep(200);
  }
  if (!page) throw new Error("Não foi possível conectar ao Chrome headless.");

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
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  /** Executa JS na página e devolve o valor (lança se a expressão lançar). */
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };

  /** Erros de console, exceções e falhas de carregamento, com a etapa em que ocorreram. */
  const errors = [];
  let step = "";
  listeners.add((m) => {
    if (m.method === "Runtime.exceptionThrown")
      errors.push(`${step}: exceção ${m.params.exceptionDetails.exception?.description?.split("\n")[0] ?? m.params.exceptionDetails.text}`);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      errors.push(`${step}: console.error ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0].slice(0, 200)}`);
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/favicon/.test(m.params.entry.url ?? ""))
      errors.push(`${step}: ${m.params.entry.text} ${m.params.entry.url ?? ""}`);
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");

  async function go(url, wait = 1200) {
    const loaded = new Promise((r) => {
      const l = (m) => m.method === "Page.loadEventFired" && (listeners.delete(l), r());
      listeners.add(l);
    });
    await send("Page.navigate", { url });
    await loaded;
    await sleep(wait);
  }

  async function viewport(width, { dark = false } = {}) {
    const height = width < 600 ? 812 : width < 1000 ? 1024 : 900;
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
  }

  async function screenshot(file, { full = true } = {}) {
    const { cssContentSize } = await send("Page.getLayoutMetrics");
    const params = { format: "png", captureBeyondViewport: full };
    if (full) params.clip = { x: 0, y: 0, width: cssContentSize.width, height: Math.min(cssContentSize.height, 3200), scale: 1 };
    const { data } = await send("Page.captureScreenshot", params);
    writeFileSync(file, Buffer.from(data, "base64"));
  }

  const KEYS = {
    Tab: { code: "Tab", vk: 9 },
    Enter: { code: "Enter", vk: 13, text: "\r" },
    Escape: { code: "Escape", vk: 27 },
    Space: { key: " ", code: "Space", vk: 32, text: " " },
    ArrowDown: { code: "ArrowDown", vk: 40 },
    ArrowUp: { code: "ArrowUp", vk: 38 },
    ArrowRight: { code: "ArrowRight", vk: 39 },
    ArrowLeft: { code: "ArrowLeft", vk: 37 },
    Home: { code: "Home", vk: 36 },
    End: { code: "End", vk: 35 },
  };

  /** Pressiona uma tecla de verdade (eventos de teclado do navegador, não JS sintético). */
  async function press(name, { shift = false } = {}) {
    const k = KEYS[name];
    const base = { key: k.key ?? name, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: shift ? 8 : 0 };
    await send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(120);
  }

  async function close() {
    ws.close();
    chrome.kill();
    await sleep(300);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  }

  return {
    send,
    evaluate,
    press,
    go,
    viewport,
    screenshot,
    close,
    errors,
    setStep: (s) => (step = s),
  };
}
