export interface Env {
  EDUSEARCH_API_URL: string;
  NOTIFICATIONS_DISPATCH_SECRET: string;
}

export async function dispatch(env: Env, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${env.EDUSEARCH_API_URL}/v1/internal/notifications/dispatch`, {
    method: "POST",
    headers: { "X-Notifications-Dispatch-Secret": env.NOTIFICATIONS_DISPATCH_SECRET },
  });
  if (!response.ok) throw new Error(`dispatcher_http_${response.status}`);
}

export default {
  async scheduled(_: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatch(env).catch((error: unknown) => console.warn("dispatch_failed", String(error))));
  },
};
