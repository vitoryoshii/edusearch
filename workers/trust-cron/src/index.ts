import { createSingleFlight, dispatchTrust, type TrustCronEnv } from "./dispatch.ts";

// Tipos mínimos do runtime (evita dependência de @cloudflare/workers-types).
interface ScheduledEventLike {
  scheduledTime: number;
}
interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

let currentEnv: TrustCronEnv | undefined;
const runOnce = createSingleFlight(async () => {
  const outcome = await dispatchTrust(currentEnv ?? {});
  // Log sanitizado: só contadores ou um código de erro. Nunca segredo, URL completa ou corpo.
  if (outcome.ok) console.log("trust_dispatch_ok", JSON.stringify(outcome.summary));
  else console.warn("trust_dispatch_failed", outcome.reason);
  return outcome;
});

export default {
  async scheduled(
    _event: ScheduledEventLike,
    env: TrustCronEnv,
    ctx: ExecutionContextLike,
  ): Promise<void> {
    currentEnv = env;
    ctx.waitUntil(runOnce());
  },
  // Não existe endpoint HTTP público de processamento.
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
};
