import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/auth.tsx", import.meta.url), "utf8");
test("admin session uses an isolated storage key", () => {
  assert.match(source, /edusearch-admin-auth/);
  assert.doesNotMatch(source, /edusearch-auth-session/);
});
test("authorization is checked by the API after Supabase authentication", () => {
  assert.match(source, /\/v1\/admin\/me/);
  assert.match(source, /response\.status === 401/);
  assert.match(source, /response\.status === 403/);
});
test("GIS login keeps the nonce in memory and sends it to Supabase", () => {
  assert.match(source, /crypto\.getRandomValues/);
  assert.match(source, /SHA-256/);
  assert.match(source, /signInWithIdToken/);
});
