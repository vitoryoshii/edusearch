#!/usr/bin/env node
/**
 * Capturas de tela das telas principais (Chrome headless, sem dependências).
 * Usado na validação visual contra o mockup aprovado e nas capturas de docs.
 *
 *   node scripts/screens.mjs <url> <pasta> [larguras=375,1440] [rotas=...] [temas=claro,escuro]
 *
 * Prepara antes uma reserva paga e uma pendente (pela interface de dados do
 * modo dev, `window.__edusearchDemo`), para checkout, calendário e aula online
 * terem conteúdo representativo.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp.mjs";

const [base = "http://localhost:5190", out = "screens", widthsArg = "375,1440", routesArg, themesArg = "claro,escuro"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const widths = widthsArg.split(",").map(Number);
const themes = themesArg.split(",");

const b = await launch();
const ds = "__edusearchDemo.dataSource";
const asStudent = `sessionStorage.setItem('edusearch-demo-session', JSON.stringify({ role: 'student', name: 'Ana' }))`;
const asTeacher = `sessionStorage.setItem('edusearch-demo-session', JSON.stringify({ role: 'teacher', name: 'Marina', teacherId: 't-marina' }))`;

// Prepara dados: uma aula paga (confirmada) e uma reserva aguardando pagamento.
await b.viewport(1440);
await b.go(base + "/", 400);
await b.evaluate(`sessionStorage.clear(); ${asStudent}`);
await b.go(base + "/aluno", 1200);
const prepared = await b.evaluate(`(async () => {
  const slots = await ${ds}.listTeacherSlots("t-marina");
  const paid = await ${ds}.createBooking({ teacherId: "t-marina", slotId: slots[0].id, subject: "matematica", topic: "Geometria analítica" });
  const c1 = await ${ds}.createCheckout(paid.id);
  await ${ds}.simulatePayment(c1.id, "confirmed");
  const pending = await ${ds}.createBooking({ teacherId: "t-marina", slotId: slots[2].id, subject: "matematica" });
  await ${ds}.createCheckout(pending.id);
  return { paid: paid.id, pending: pending.id };
})()`);

const ROUTES = routesArg
  ? routesArg.split(",").map((r) => r.split("|"))
  : [
      ["aluno", "/aluno"],
      ["aluno", "/aluno/assistente"],
      ["aluno", "/aluno/professores/t-marina"],
      ["aluno", "/aluno/aulas"],
      ["aluno", `/aluno/aulas/${prepared.paid}`],
      ["aluno", `/aluno/pagamento/${prepared.pending}`],
      ["professor", "/professor/agenda"],
      ["professor", "/professor/recebimentos"],
      ["professor", "/professor/beneficios"],
    ];

const slug = (r) => r.replace(/^\//, "").replace(/\//g, "_").replace(/l-[a-z0-9]+$/, "id");
for (const theme of themes) {
  for (const w of widths) {
    await b.viewport(w, { dark: theme === "escuro" });
    for (const [role, route] of ROUTES) {
      await b.evaluate(role === "professor" ? asTeacher : asStudent);
      await b.go(base + route, 1800);
      const file = join(out, `${w}${theme === "escuro" ? "-escuro" : ""}-${slug(route)}.png`);
      await b.screenshot(file);
      console.log("✓", file);
    }
  }
}
if (b.errors.length) console.log("Erros de console:\n  " + b.errors.join("\n  "));
await b.close();
await sleep(100);
