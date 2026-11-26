import assert from "node:assert/strict";
import { test } from "node:test";

import {
  configError,
  createSingleFlight,
  DISPATCH_PATH,
  dispatchTrust,
  sanitizeSummary,
} from "../src/dispatch.ts";
import worker from "../src/index.ts";

const SECRET = "s".repeat(40);
const ENV = { EDUSEARCH_API_URL: "https://api.edusearch.com.br", TRUST_DISPATCH_SECRET: SECRET };

test("chama somente o endpoint interno com o segredo dedicado", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ claimed: 2, approved: 0, pending_external: 2 }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
  const outcome = await dispatchTrust(ENV, fetcher);
  assert.deepEqual(outcome, {
    ok: true,
    status: 200,
    summary: { claimed: 2, approved: 0, pending_external: 2 },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.edusearch.com.br${DISPATCH_PATH}`);
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.deepEqual(Object.keys(headers), ["X-Trust-Dispatch-Secret"]);
  assert.equal(headers["X-Trust-Dispatch-Secret"], SECRET);
  assert.equal(calls[0].init.redirect, "manual");
});

test("não faz rede sem configuração válida", async () => {
  let called = false;
  const fetcher = (async () => {
    called = true;
    return new Response("{}");
  }) as unknown as typeof fetch;
  for (const env of [
    {},
    { ...ENV, TRUST_DISPATCH_SECRET: "curto" },
    { ...ENV, EDUSEARCH_API_URL: "http://api.edusearch.com.br" },
    { ...ENV, EDUSEARCH_API_URL: "https://user:pass@api.edusearch.com.br" },
    { ...ENV, EDUSEARCH_API_URL: "não é url" },
  ]) {
    const outcome = await dispatchTrust(env, fetcher);
    assert.equal(outcome.ok, false);
  }
  assert.equal(called, false);
  assert.equal(configError(ENV), null);
});

test("erros HTTP, JSON inválido e rede viram códigos sanitizados", async () => {
  const status = (async () => new Response("detalhe interno", { status: 503 })) as unknown as typeof fetch;
  assert.deepEqual(await dispatchTrust(ENV, status), { ok: false, reason: "http_503" });
  const badJson = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await dispatchTrust(ENV, badJson), { ok: false, reason: "invalid_json" });
  const network = (async () => {
    throw new TypeError("fetch failed: " + SECRET);
  }) as unknown as typeof fetch;
  const outcome = await dispatchTrust(ENV, network);
  assert.deepEqual(outcome, { ok: false, reason: "network_error" });
  assert.ok(!JSON.stringify(outcome).includes(SECRET));
});

test("respeita o timeout", async () => {
  const hanging = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    })) as unknown as typeof fetch;
  assert.deepEqual(await dispatchTrust(ENV, hanging, 20), { ok: false, reason: "timeout" });
});

test("o resumo só aceita contadores inteiros", () => {
  assert.deepEqual(
    sanitizeSummary({ claimed: 1, leaked: "segredo", "bad key": 3, nested: { a: 1 }, failed: 1.5 }),
    { claimed: 1 },
  );
  assert.deepEqual(sanitizeSummary(null), {});
});

test("impede execuções concorrentes no mesmo isolate", async () => {
  let release!: () => void;
  let runs = 0;
  const guarded = createSingleFlight(async () => {
    runs += 1;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return "done";
  });
  const first = guarded();
  assert.equal(await guarded(), "skipped");
  release();
  assert.equal(await first, "done");
  assert.equal(runs, 1);
});

test("não expõe endpoint HTTP de processamento", async () => {
  const response = await worker.fetch();
  assert.equal(response.status, 404);
});
