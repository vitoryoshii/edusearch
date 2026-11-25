import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

const config = {
  api: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000",
  url: import.meta.env.VITE_SUPABASE_URL ?? "",
  key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "",
};
const storageKey = "edusearch-admin-auth";
let client: SupabaseClient | null = null;
let gisReady = false;
let nonce: { raw: string; hash: string; issuedAt: number } | null = null;
let callback: ((credential: string) => void) | null = null;

function getClient() {
  if (!config.url || !config.key) throw new Error("auth_unconfigured");
  client ??= createClient(config.url, config.key, { auth: { storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" } });
  return client;
}
async function nonceForAttempt() {
  if (nonce && Date.now() - nonce.issuedAt < 5 * 60_000) return nonce;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  nonce = { raw, hash, issuedAt: Date.now() };
  return nonce;
}
type Status = "loading" | "signed_out" | "checking" | "authorized" | "forbidden" | "error";
type AdminAuth = { status: Status; signOut: () => Promise<void>; renderGoogle: (node: HTMLElement) => Promise<void> };
const Ctx = createContext<AdminAuth | null>(null);

async function apiMe(session: Session) {
  const response = await fetch(`${config.api}/v1/admin/me`, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (response.status === 401) return "signed_out" as const;
  if (response.status === 403) return "forbidden" as const;
  if (!response.ok) return "error" as const;
  return "authorized" as const;
}
type Gis = { initialize: (config: { client_id: string; nonce: string; callback: (r: { credential?: string }) => void; auto_select: boolean; ux_mode: "popup" }) => void; renderButton: (node: HTMLElement, options: Record<string, string | number>) => void; disableAutoSelect: () => void };
function loadGis(): Promise<Gis> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  return new Promise<Gis>((resolve, reject) => {
    const old = document.querySelector<HTMLScriptElement>("script[data-admin-gis]");
    if (old) { old.addEventListener("load", () => window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("gis_unavailable")), { once: true }); return; }
    const script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.dataset.adminGis = "";
    script.onload = () => window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("gis_unavailable")); script.onerror = () => reject(new Error("gis_unavailable")); document.head.append(script);
  });
}
declare global { interface Window { google?: { accounts?: { id?: Gis } } } }

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const signing = useRef(false);
  const refresh = useCallback(async () => {
    try { const session = (await getClient().auth.getSession()).data.session; setStatus(session ? await apiMe(session) : "signed_out"); }
    catch { setStatus("error"); }
  }, []);
  useEffect(() => {
    if (!config.url || !config.key) { setStatus("error"); return; }
    void refresh();
    const { data } = getClient().auth.onAuthStateChange((_event, session) => {
      void (session ? apiMe(session).then(setStatus) : Promise.resolve(setStatus("signed_out")));
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);
  const signOut = useCallback(async () => { window.google?.accounts?.id?.disableAutoSelect(); await getClient().auth.signOut({ scope: "local" }); nonce = null; setStatus("signed_out"); }, []);
  const renderGoogle = useCallback(async (node: HTMLElement) => {
    if (!config.googleClientId) throw new Error("google_unconfigured");
    const pair = await nonceForAttempt(); const gis = await loadGis();
    callback = async (credential) => { if (signing.current || !nonce || Date.now() - nonce.issuedAt > 10 * 60_000) return; signing.current = true; setStatus("checking"); const raw = nonce.raw; nonce = null; const { data, error } = await getClient().auth.signInWithIdToken({ provider: "google", token: credential, nonce: raw }); setStatus(!error && data.session ? await apiMe(data.session) : "signed_out"); signing.current = false; };
    if (!gisReady) { gis.initialize({ client_id: config.googleClientId, nonce: pair.hash, callback: (result: { credential?: string }) => result.credential && callback?.(result.credential), auto_select: false, ux_mode: "popup" }); gisReady = true; }
    node.replaceChildren(); gis.renderButton(node, { theme: "outline", size: "large", text: "continue_with", shape: "pill", width: Math.max(220, Math.floor(node.clientWidth || 320)) });
  }, []);
  return <Ctx.Provider value={useMemo(() => ({ status, signOut, renderGoogle }), [status, signOut, renderGoogle])}>{children}</Ctx.Provider>;
}
export function useAdminAuth() { const value = useContext(Ctx); if (!value) throw new Error("AdminAuthProvider ausente"); return value; }
