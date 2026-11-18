#!/usr/bin/env node
/**
 * Smoke test de navegação (sem dependências): abre todas as rotas no Chrome
 * headless e falha se houver erro no console, exceção não tratada, a tela
 * "Algo deu errado" ou rolagem horizontal.
 *
 * Rode contra o SERVIDOR DE DESENVOLVIMENTO para pegar regressões que só
 * aparecem com React StrictMode (efeitos montados/desmontados duas vezes):
 *
 *   pnpm --filter @edusearch/web dev -- --port 5190   # em outro terminal
 *   pnpm --filter @edusearch/web smoke                # usa http://localhost:5190
 *   node scripts/smoke.mjs http://localhost:4173      # outra URL
 */
import { launch } from "./lib/cdp.mjs";

const base = (process.argv[2] ?? "http://localhost:5190").replace(/\/$/, "");

const ROUTES = {
  public: ["/", "/entrar", "/cadastro", "/perfil-de-acesso", "/conta"],
  student: [
    "/aluno", "/aluno/buscar", "/aluno/assistente", "/aluno/recomendados", "/aluno/professores/t-marina",
    "/aluno/professores/t-marina/agendar", "/aluno/agendamento/resumo", "/aluno/aulas", "/aluno/progresso",
    "/aluno/perfil", "/aluno/buscar?demo=erro", "/aluno/aulas?demo=vazio",
    "/aluno/aulas?view=lista", "/aluno/aulas/l-1", "/aluno/pagamento/l-1",
  ],
  teacher: [
    "/professor", "/professor/perfil", "/professor/especialidades", "/professor/disponibilidade",
    "/professor/agenda", "/professor/aulas", "/professor/recebimentos", "/professor/configuracoes",
    "/professor/aulas/l-1", "/professor/beneficios",
  ],
};
// Telas em que o estado de erro é esperado (não contam como falha).
const EXPECTED_ERROR_SCREEN = new Set(["/aluno/buscar?demo=erro"]);

const b = await launch();
const failures = b.errors;
let checked = 0;

for (const [group, routes] of Object.entries(ROUTES)) {
  b.setStep(`/ (${group})`);
  await b.go(base + "/", 600);
  await b.evaluate(
    group === "public"
      ? "sessionStorage.clear()"
      : `sessionStorage.setItem('edusearch-demo-session', JSON.stringify({ role: '${group}', name: 'Teste' }))`,
  );
  for (const r of routes) {
    b.setStep(r);
    await b.go(base + r, 1500); // latência simulada do mock + StrictMode
    const text = (await b.evaluate("document.body.innerText")) ?? "";
    if (/Algo deu errado|Página não encontrada/.test(text)) failures.push(`${r}: tela de erro de rota`);
    if (!EXPECTED_ERROR_SCREEN.has(r) && /Não foi possível carregar/.test(text)) failures.push(`${r}: estado de erro inesperado`);
    if (await b.evaluate("document.documentElement.scrollWidth > innerWidth + 1")) failures.push(`${r}: rolagem horizontal`);
    checked++;
  }
}
await b.close();

if (failures.length) {
  console.error(`✗ smoke: ${failures.length} problema(s) em ${checked} rotas (${base})\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log(`✓ smoke: ${checked} rotas sem erros (${base})`);
