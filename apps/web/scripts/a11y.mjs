#!/usr/bin/env node
/**
 * Teste de acessibilidade dos componentes interativos (leve, ~1 min).
 *
 * 1. axe-core (WCAG 2.0/2.1/2.2 A e AA) em estados que a varredura de rotas
 *    não alcança: diálogos abertos, menu da conta, painel de filtros,
 *    recomendações com critérios expandidos e seletor de professor.
 * 2. Teclado de verdade (eventos do navegador): foco ao abrir, Escape fecha,
 *    foco volta ao gatilho, setas no menu e nas abas, Enter no <summary>.
 * 3. Leitores de tela: nome acessível de diálogos/menus e regiões aria-live.
 *
 * Uso: node scripts/a11y.mjs [url]   (padrão http://localhost:5190, rode contra o dev)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { launch, sleep } from "./lib/cdp.mjs";

const base = (process.argv[2] ?? "http://localhost:5190").replace(/\/$/, "");
const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const b = await launch();
const failures = [];
let checks = 0;

const session = (role, extra = "") =>
  `sessionStorage.setItem('edusearch-demo-session', JSON.stringify({ role: '${role}', name: 'Teste'${extra} }))`;

async function axe(label) {
  checks++;
  if (!(await b.evaluate("!!window.axe"))) await b.evaluate(`${AXE};1`);
  const v = await b.evaluate(
    `axe.run(document, { runOnly: { type: "tag", values: ["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"] } })
       .then((r) => r.violations.map((v) => v.id + " (" + v.nodes.length + "): " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")))`,
  );
  if (v.length) failures.push(`[axe] ${label}: ${v.join("; ")}`);
}

async function expect(label, js) {
  checks++;
  const ok = await b.evaluate(js);
  if (!ok) failures.push(`[teclado/leitor] ${label}`);
}

/** Aguarda uma condição (telas e dados carregam sob demanda). */
async function until(js, label, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await b.evaluate(js).catch(() => false)) return;
    await sleep(120);
  }
  throw new Error(`Tempo esgotado: ${label}`);
}

const focusOn = (js) => b.evaluate(`(() => { const el = ${js}; el.focus(); return document.activeElement === el; })()`);
const activeText = () => b.evaluate(`(document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").trim()`);
const inDialog = `!!document.activeElement?.closest("dialog[open]")`;
const btn = (text, scope = "document") => `[...${scope}.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)}) && x.getClientRects().length)`;

async function run() {
  await b.viewport(1440);
  await b.go(base + "/", 400);

  /* ---------- Escolha de perfil: seletor de professor ---------- */
  await b.evaluate("sessionStorage.clear()");
  await b.go(base + "/perfil-de-acesso", 1200);
  await b.evaluate(`[...document.querySelectorAll("input[name=perfil]")].find((i) => i.value === "teacher").click()`);
  await until(`!!document.querySelector("select")`, "seletor de professor");
  await axe("Escolha de perfil com seletor de professor");
  await expect("seletor de professor tem rótulo associado", `(() => { const s = document.querySelector("select"); return !!s.labels?.[0]?.textContent.trim(); })()`);

  /* ---------- Aluno: menu da conta (Dropdown) ---------- */
  await b.evaluate(session("student"));
  await b.go(base + "/aluno", 1500);
  await focusOn(`[...document.querySelectorAll('button[aria-haspopup="menu"]')].find((x) => x.getClientRects().length)`);
  await b.press("Enter");
  await until(`document.activeElement?.getAttribute("role") === "menuitem"`, "foco no 1º item do menu");
  await expect("menu tem nome acessível", `!!document.querySelector('[role="menu"]')?.getAttribute("aria-label")`);
  await expect("botão do menu informa aria-expanded=true", `!!document.querySelector('button[aria-haspopup="menu"][aria-expanded="true"]')`);
  const first = await activeText();
  await b.press("ArrowDown");
  await expect("seta para baixo move o foco no menu", `document.activeElement?.getAttribute("role") === "menuitem" && document.activeElement.textContent.trim() !== ${JSON.stringify(first)}`);
  await axe("Menu da conta aberto");
  await b.press("Escape");
  await expect("Escape fecha o menu e devolve o foco ao botão", `!document.querySelector('[role="menu"]') && document.activeElement?.getAttribute("aria-haspopup") === "menu"`);

  /* ---------- Aluno: recomendações com critérios expandidos ---------- */
  await b.evaluate(
    `sessionStorage.setItem("edusearch-match-request", JSON.stringify({ goal: "Melhorar em funções para o ENEM", subject: "matematica", level: "pre-vestibular", methodologies: ["exercicios"], difficulties: ["exercicios"], periods: ["noite"], maxPriceCents: 8000 }))`,
  );
  await b.go(base + "/aluno/recomendados", 1500);
  await until(`document.querySelectorAll("main article").length > 0`, "recomendações");
  await focusOn(`document.querySelector("summary")`);
  await b.press("Enter");
  await expect("Enter no <summary> expande os critérios", `document.querySelector("details")?.open === true`);
  await axe("Recomendações com critérios expandidos e pontos de atenção");
  await expect("motivos e pontos de atenção são listas (lidos como itens)", `document.querySelectorAll("main article ul li").length >= 4`);

  /* ---------- Aluno: abas e diálogos em Minhas aulas ---------- */
  await b.go(base + "/aluno/aulas?view=lista", 1500);
  await until(`document.querySelectorAll("main article").length > 0`, "aulas");
  await focusOn(`document.querySelector('[role="tab"][aria-selected="true"]')`);
  await b.press("ArrowRight");
  await expect("seta para a direita seleciona e foca a próxima aba", `document.activeElement?.getAttribute("role") === "tab" && document.activeElement.getAttribute("aria-selected") === "true" && document.activeElement.textContent.includes("Concluídas")`);
  await b.press("Home");
  await expect("Home volta para a primeira aba", `document.activeElement?.textContent.includes("Próximas")`);

  // Diálogo de detalhes
  await focusOn(`document.querySelector("main article button[aria-label^='Detalhes']")`);
  const opener = await activeText();
  await b.press("Enter");
  await until(`!!document.querySelector("dialog[open]")`, "diálogo de detalhes");
  await sleep(200);
  await expect("foco vai para dentro do diálogo ao abrir", inDialog);
  await expect("diálogo tem nome acessível (aria-labelledby)", `(() => { const d = document.querySelector("dialog[open]"); const id = d.getAttribute("aria-labelledby"); return !!id && !!document.getElementById(id)?.textContent.trim(); })()`);
  await axe("Diálogo de detalhes da aula");
  for (let i = 0; i < 8; i++) await b.press("Tab");
  await expect("Tab não leva o foco para o conteúdo de fundo", `!document.activeElement || document.activeElement === document.body || ${inDialog}`);
  await b.press("Escape");
  await until(`!document.querySelector("dialog[open]")`, "fechar com Escape");
  await expect("Escape fecha e o foco volta ao botão que abriu", `(document.activeElement?.getAttribute("aria-label") || "") === ${JSON.stringify(opener)}`);

  // Diálogo de confirmação de cancelamento
  await focusOn(btn("Cancelar", `document.querySelector("main article")`));
  await b.press("Enter");
  await until(`!!document.querySelector("dialog[open]")`, "diálogo de cancelamento");
  await sleep(200);
  await expect("confirmação de cancelamento recebe o foco", inDialog);
  await expect("confirmação tem descrição (aria-describedby)", `(() => { const d = document.querySelector("dialog[open]"); const id = d.getAttribute("aria-describedby"); return !!id && !!document.getElementById(id)?.textContent.trim(); })()`);
  await axe("Diálogo de confirmação de cancelamento");
  await b.press("Escape");
  await until(`!document.querySelector("dialog[open]")`, "fechar confirmação");
  await expect("cancelamento não acontece ao fechar com Escape", `document.querySelector("main article") && !document.querySelector("main").innerText.includes("Aula cancelada")`);

  await expect("região de avisos (toasts) é aria-live", `!!document.querySelector('[role="status"][aria-live="polite"]')`);

  /* ---------- Mobile: painel de filtros (Dialog sheet) ---------- */
  await b.viewport(375);
  await b.go(base + "/aluno/buscar", 1500);
  await focusOn(`[...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") || "").startsWith("Filtros"))`);
  await b.press("Enter");
  await until(`!!document.querySelector("dialog[open]")`, "painel de filtros");
  await sleep(200);
  await expect("painel de filtros recebe o foco", inDialog);
  await axe("Painel de filtros (mobile)");
  await b.press("Escape");
  await until(`!document.querySelector("dialog[open]")`, "fechar filtros");
  await expect("foco volta ao botão Filtros", `(document.activeElement?.getAttribute("aria-label") || "").startsWith("Filtros")`);

  /* ---------- Tema escuro: diálogo e recomendações ---------- */
  await b.viewport(1440, { dark: true });
  await b.go(base + "/aluno/recomendados", 1500);
  await until(`document.querySelectorAll("main article").length > 0`, "recomendações (escuro)");
  await b.evaluate(`document.querySelector("details").open = true`);
  await axe("Recomendações expandidas (tema escuro)");
  await b.go(base + "/aluno/aulas?view=lista", 1500);
  await until(`document.querySelectorAll("main article").length > 0`, "aulas (escuro)");
  await b.evaluate(`document.querySelector("main article button[aria-label^='Detalhes']").click()`);
  await until(`!!document.querySelector("dialog[open]")`, "detalhes (escuro)");
  await sleep(400); // espera a animação de entrada (opacidade) terminar antes de medir contraste
  await axe("Diálogo de detalhes (tema escuro)");

  /* ---------- Fase 2.3: calendário, checkout, aula online e benefícios ---------- */
  await b.viewport(1440);
  await b.go(base + "/aluno/aulas", 1500);
  await until(`!!document.querySelector('[role="radiogroup"]')`, "calendário");
  await axe("Calendário semanal do aluno");
  await expect(
    "eventos do calendário: nome vem do texto visível (sem aria-label) e há descrição",
    `(() => { const evs = [...document.querySelectorAll("main button[data-lesson-id]")]; return evs.length > 0 && evs.every((b) => !b.hasAttribute("aria-label") && b.textContent.includes(":") && document.getElementById(b.getAttribute("aria-describedby"))?.textContent.trim()); })()`,
  );
  // Controle segmentado: setas trocam a opção selecionada
  await focusOn(`document.querySelector('[role="radiogroup"][aria-label="Período do calendário"] [aria-checked="true"]')`);
  await b.press("ArrowRight");
  await expect("seta no controle segmentado seleciona Mês", `document.activeElement?.getAttribute("role") === "radio" && document.activeElement.textContent.includes("Mês") && document.activeElement.getAttribute("aria-checked") === "true"`);
  await until(`!!document.querySelector('[role="group"][aria-label^="Dias de"]')`, "grade do mês");
  await axe("Calendário mensal do aluno");
  await focusOn(`document.querySelector('[data-day][aria-pressed="true"]')`);
  const day = await b.evaluate(`document.activeElement.dataset.day`);
  await b.press("ArrowDown");
  await expect("seta para baixo na grade avança 7 dias e mantém o foco", `document.activeElement?.dataset.day !== ${JSON.stringify(day)} && document.activeElement.getAttribute("aria-pressed") === "true"`);
  await expect("dias da grade têm nome acessível com quantidade de aulas", `/aulas?|sem aulas/.test(document.activeElement?.getAttribute("aria-label") || "")`);

  await b.go(base + "/aluno/aulas/l-1", 1500);
  await until(`document.body.innerText.includes("Google Meet")`, "aula online");
  await axe("Aula online (sem link do Meet)");
  await expect("sem link do Meet não há botão de entrada", `![...document.querySelectorAll("a")].some((a) => a.href.includes("meet.google.com"))`);
  await expect("botões ilustrativos de microfone/câmera informam o estado (aria-pressed)", `document.querySelectorAll('main button[aria-pressed]').length >= 2`);

  await b.evaluate(`(async () => { const ds = window.__edusearchDemo.dataSource; const s = await ds.listTeacherSlots("t-marina"); const l = await ds.createBooking({ teacherId: "t-marina", slotId: s[0].id, subject: "matematica" }); await ds.createCheckout(l.id); window.__pendingLesson = l.id; })()`);
  const pendingId = await b.evaluate("window.__pendingLesson");
  await b.go(base + `/aluno/pagamento/${pendingId}`, 1800);
  await until(`document.body.innerText.includes("QR Code simulado")`, "checkout");
  await axe("Checkout Pix (aguardando pagamento)");
  await expect("QR Code simulado tem nome acessível de não pagável", `!!document.querySelector('[role="img"][aria-label*="não pagável"]')`);
  // Campo específico do Copia e Cola (id "pix-<cobrança>"); o rádio do método Pix também é readonly.
  await expect(
    "campo Pix Copia e Cola tem rótulo associado (label for = id)",
    `(() => { const i = document.querySelector('input[id^="pix-"]'); const l = i?.labels?.[0]; return !!i && !!l && l.htmlFor === i.id && l.textContent.trim() === "Pix Copia e Cola"; })()`,
  );

  await b.viewport(375, { dark: true });
  await b.go(base + `/aluno/pagamento/${pendingId}`, 1800);
  await until(`document.body.innerText.includes("QR Code simulado")`, "checkout escuro");
  await axe("Checkout Pix (mobile, tema escuro)");
  await b.viewport(1440);

  await b.evaluate(session("teacher", ", teacherId: 't-marina'"));
  for (const r of ["/professor/beneficios", "/professor/agenda", "/professor/recebimentos"]) {
    await b.go(base + r, 1800);
    await axe(`Professor ${r}`);
  }
  await b.evaluate(session("student"));

  /* ---------- Professor: seletor em Configurações ---------- */
  await b.viewport(1440);
  await b.evaluate(session("teacher", ", teacherId: 't-rafael'"));
  await b.go(base + "/professor/configuracoes", 1500);
  await until(`!!document.querySelector("select")`, "seletor em Configurações");
  await expect("Configurações mostram o professor da sessão (Rafael)", `document.querySelector("select").value === "t-rafael"`);
  await axe("Configurações do professor com seletor");
}

try {
  await run();
} catch (e) {
  failures.push(`[execução] ${e.message}`);
}
failures.push(...b.errors.map((e) => `[console] ${e}`));
await b.close();

if (failures.length) {
  console.error(`✗ a11y: ${failures.length} problema(s) em ${checks} verificações\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log(`✓ a11y: ${checks} verificações sem problemas (${base})`);
