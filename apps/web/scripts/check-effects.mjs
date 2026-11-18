#!/usr/bin/env node
/**
 * Proteção contra regressão: efeitos React não podem retornar valores.
 *
 * Um useEffect com corpo de expressão — `useEffect(() => algo(), deps)` —
 * devolve o resultado de `algo()` como "função de limpeza". Se for uma
 * Promise (ex.: window.scrollTo no Chrome atual) ou outro valor, o React
 * quebra com "destroy is not a function" (visível no StrictMode).
 *
 * Regras:
 *   1. use(Layout|Insertion)Effect(() => <expressão>)  → proibido; use chaves.
 *   2. use(Layout|Insertion)Effect(async ...)           → proibido.
 *
 * Uso: node scripts/check-effects.mjs   (pnpm --filter @edusearch/web lint)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const dirs = ["apps/web/src", "apps/website/src", "packages/ui/src"].map((d) => join(root, d));

const EFFECT = /\buse(?:Layout|Insertion)?Effect\(\s*/g;
const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(name)) check(p);
  }
}

function check(file) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(EFFECT)) {
    const rest = src.slice(m.index + m[0].length);
    const line = src.slice(0, m.index).split("\n").length;
    if (/^async\b/.test(rest)) {
      problems.push(`${relative(root, file)}:${line}  efeito async — declare a função async dentro do efeito`);
      continue;
    }
    // Arrow function sem parâmetros: () => ...
    const arrow = rest.match(/^\(\s*\)\s*=>\s*/);
    if (arrow && rest[arrow[0].length] !== "{") {
      problems.push(`${relative(root, file)}:${line}  efeito com corpo de expressão — use useEffect(() => { ... })`);
    }
  }
}

dirs.forEach(walk);

if (problems.length) {
  console.error("✗ Efeitos que retornam valor encontrados:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("✓ check-effects: nenhum efeito retorna valor inválido.");
