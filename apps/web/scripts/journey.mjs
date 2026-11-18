#!/usr/bin/env node
/**
 * Teste de jornada ponta a ponta do marketplace (modo demonstração).
 *
 * Dirige a interface como um avaliador: clica, digita e confere o resultado.
 * Executa a jornada completa em 1440px (desktop) e a jornada essencial em
 * 375px e 768px, em tema claro e escuro, falhando em qualquer asserção ou
 * erro de console.
 *
 * Use contra o SERVIDOR DE DESENVOLVIMENTO (React StrictMode + gancho de teste
 * `window.__edusearchDemo`, que só existe em dev):
 *
 *   pnpm --filter @edusearch/web dev -- --port 5190
 *   pnpm --filter @edusearch/web journey                 # http://localhost:5190
 *   node scripts/journey.mjs <url> [pasta-de-capturas]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp.mjs";

const base = (process.argv[2] ?? "http://localhost:5190").replace(/\/$/, "");
const shotsDir = process.argv[3];
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const b = await launch();
const results = [];
let currentWidth = 0;
let theme = "claro";

/* ------------------------------ Ajudantes na página ------------------------------ */

// Funções injetadas na página. Encontram elementos pelo texto visível/rótulo,
// como um usuário faria, e disparam eventos compatíveis com o React.
const H = `(() => {
  if (window.__t) return;
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const scope = () => document.querySelector("dialog[open]") || document;
  const byText = (selector, text, root) =>
    [...(root || scope()).querySelectorAll(selector)].filter(visible).find((el) => norm(el.textContent).includes(text) || el.getAttribute("aria-label") === text);
  const control = (label) => {
    const l = [...scope().querySelectorAll("label")].filter(visible).find((x) => norm(x.textContent).replace(/ \\*$/, "") === label || norm(x.textContent).startsWith(label));
    return l && (l.htmlFor ? document.getElementById(l.htmlFor) : l.querySelector("input,select,textarea"));
  };
  const setValue = (el, value) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  };
  window.__t = {
    text: () => norm((document.querySelector("dialog[open]") || document.querySelector("main") || document.body).innerText),
    click(selector, text) { const el = byText(selector, text); if (!el) throw new Error("Não encontrado: " + selector + " «" + text + "»"); el.click(); return true; },
    has(selector, text) { return !!byText(selector, text); },
    fill(label, value) { const el = control(label); if (!el) throw new Error("Campo não encontrado: " + label); setValue(el, value); return true; },
    openAccountMenu() { const btns = [...document.querySelectorAll('button[aria-haspopup="menu"]')].filter(visible); btns[btns.length - 1].click(); return true; },
    toasts: () => [...document.querySelectorAll('[role="status"] .shadow-overlay')].map((t) => norm(t.textContent)),
  };
})();`;

const run = async (js) => b.evaluate(`${H}; (${js})`);
const path = () => b.evaluate("location.pathname + location.search");

/** Espera uma condição ficar verdadeira na página (polling). */
async function until(js, label, timeout = 6000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await run(js);
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(120);
  }
  throw new Error(`Tempo esgotado esperando: ${label}${last ? ` (último: ${String(last).slice(0, 160)})` : ""}`);
}

async function step(name, fn) {
  const label = `[${currentWidth}px ${theme}] ${name}`;
  b.setStep(label);
  const before = b.errors.length;
  try {
    await fn();
    const consoleErrs = b.errors.slice(before);
    if (consoleErrs.length) throw new Error(`erros de console: ${consoleErrs.join(" | ")}`);
    if (await b.evaluate("document.documentElement.scrollWidth > innerWidth + 1")) throw new Error("rolagem horizontal");
    results.push({ ok: true, label });
    console.log(`  ✓ ${label}`);
  } catch (e) {
    results.push({ ok: false, label, error: e.message });
    console.log(`  ✗ ${label}\n      ${e.message}`);
    throw e;
  }
}

async function shot(name) {
  if (shotsDir) await b.screenshot(join(shotsDir, `${currentWidth}${theme === "escuro" ? "-escuro" : ""}-${name}.png`));
}

// Clique e preenchimento aguardam o elemento existir (telas carregam sob demanda).
const clickText = (selector, text) => until(`__t.click(${JSON.stringify(selector)}, ${JSON.stringify(text)})`, `clicar em ${selector} «${text}»`);
const fill = (label, value) => until(`__t.fill(${JSON.stringify(label)}, ${JSON.stringify(value)})`, `preencher «${label}»`);
const textHas = (t) => `__t.text().includes(${JSON.stringify(t)})`;
const resultCount = () => run(`(() => { const m = __t.text().match(/(\\d+) professor(?:es)? encontrados?/); return m ? Number(m[1]) : -1; })()`);
const resultNames = () => run(`[...document.querySelectorAll('main article h3')].map((h) => h.textContent.trim())`);

/* ----------------------------------- Jornadas ----------------------------------- */

async function access() {
  await step("Etapa 1 — acesso em modo demonstração como aluno", async () => {
    await b.go(base + "/", 300);
    await b.evaluate("sessionStorage.clear(); localStorage.removeItem('edusearch-theme')");
    await b.go(base + "/", 800);
    await clickText("a", "Explorar demonstração");
    await until(`location.pathname === "/perfil-de-acesso"`, "tela de perfil");
    await clickText("label", "Quero aprender");
    await clickText("button", "Continuar como aluno");
    await until(`location.pathname === "/aluno" && ${textHas("Olá, Ana")}`, "dashboard do aluno");
    await until(`__t.has("a", "Usar o assistente") && __t.has("button", "Buscar")`, "ações principais de busca");
    await shot("1-dashboard");
  });
}

async function searchDesktop() {
  await step("Etapa 2 — busca por disciplina, orçamento e disponibilidade", async () => {
    await clickText("nav a", "Buscar");
    await until(`location.pathname === "/aluno/buscar" && /\\d+ professores encontrados/.test(__t.text())`, "resultados iniciais");
    const total = await resultCount();
    if (total !== 6) throw new Error(`esperava 6 professores sem filtros, veio ${total}`);

    await fill("Disciplina", "matematica");
    await until(`/^3 professores/.test(__t.text().match(/\\d+ professor(?:es)? encontrados?/)?.[0] ?? "")`, "3 professores de Matemática");
    await fill("Valor por aula", "8000");
    await until(`(__t.text().match(/(\\d+) professor(?:es)? encontrados?/)?.[1]) === "2"`, "2 professores até R$ 80");
    let names = await resultNames();
    if (!(names.includes("Profa. Marina Duarte") && names.includes("Prof. João Pereira"))) throw new Error(`orçamento: ${names}`);

    await clickText("aside button[aria-pressed]", "Noite");
    await until(`(__t.text().match(/(\\d+) professor(?:es)? encontrados?/)?.[1]) === "1"`, "1 professor à noite");
    names = await resultNames();
    if (names[0] !== "Profa. Marina Duarte") throw new Error(`disponibilidade: ${names}`);
    await shot("2-busca-filtrada");

    await fill("Nível", "graduacao");
    await until(textHas("Nenhum professor encontrado"), "estado vazio");
    await shot("2-busca-vazia");
    await clickText("button", "Limpar busca e filtros");
    await until(`(__t.text().match(/(\\d+) professor(?:es)? encontrados?/)?.[1]) === "6"`, "filtros limpos");
  });
}

async function searchMobile() {
  await step("Etapa 2 — busca com filtros no painel mobile", async () => {
    await b.go(base + "/aluno/buscar", 1200);
    await until(`/\\d+ professores encontrados/.test(__t.text())`, "resultados");
    await clickText("button", "Filtros");
    await until(`!!document.querySelector("dialog[open]")`, "painel de filtros aberto");
    await fill("Disciplina", "matematica");
    await fill("Valor por aula", "8000");
    await clickText("button[aria-pressed]", "Noite");
    await shot("2-filtros-mobile");
    await clickText("button", "Ver resultados");
    await until(`!document.querySelector("dialog[open]") && (__t.text().match(/(\\d+) professor(?:es)? encontrados?/)?.[1]) === "1"`, "1 resultado após filtros");
  });
}

async function matching() {
  await step("Etapa 3 — matching pedagógico com dificuldades e preferências", async () => {
    await b.go(base + "/aluno/assistente", 900);
    await until(textHas("O que você quer aprender?"), "assistente");
    await fill("Seu objetivo", "Quero melhorar em funções e geometria para o ENEM deste ano.");
    await fill("Disciplina", "matematica");
    await fill("Seu nível", "pre-vestibular");
    await clickText("button", "Continuar");
    await until(textHas("Escolha pelo menos uma dificuldade."), "validação de dificuldades");
    await clickText("button[aria-pressed]", "Resolver exercícios e provas");
    await clickText("button", "Continuar");
    await until(textHas("Como você prefere estudar?"), "etapa de preferências");
    await clickText("button[aria-pressed]", "Resolução de exercícios");
    await clickText("button[aria-pressed]", "Noite");
    await fill("Orçamento", "8000");
    await clickText("button", "Continuar");
    await until(`${textHas("Confira antes de buscar")} && ${textHas("Resolver exercícios e provas")}`, "revisão");
    await clickText("button", "Ver professores recomendados");
    await until(`location.pathname === "/aluno/recomendados" && document.querySelectorAll("main article").length > 0`, "recomendações");

    const first = await run(`(() => { const a = document.querySelector("main article"); return { name: a.querySelector("h3").textContent.trim(), text: a.innerText }; })()`);
    if (first.name !== "Profa. Marina Duarte") throw new Error(`1ª recomendação inesperada: ${first.name}`);
    if (!/Compatibilidade estimada: 100%/.test(first.text)) throw new Error("compatibilidade da 1ª recomendação deveria ser 100%");
    if (!/Pode ajudar com: resolver exercícios e provas/.test(first.text)) throw new Error("motivo de dificuldade ausente");
    if (!(await run(textHas("Não é uma análise de IA")))) throw new Error("aviso de matching demonstrativo ausente");
    if (!(await run(`__t.text().includes("Acima do orçamento")`))) throw new Error("ponto de atenção de orçamento ausente");
    await clickText("summary", "Como a compatibilidade é calculada");
    await until(textHas("Disciplina (obrigatória): 40 pontos"), "explicação dos critérios");
    await shot("3-recomendados");
  });
}

async function profile() {
  await step("Etapa 4 — perfil do professor com horários disponíveis", async () => {
    await clickText("main article h3 a", "Profa. Marina Duarte");
    await until(`location.pathname === "/aluno/professores/t-marina" && document.querySelectorAll('a[href*="agendar?horario="]').length > 0`, "perfil com horários");
    for (const t of ["Matemática para ENEM", "Metodologia", "R$ 80,00", "Próximos horários disponíveis", "Ainda sem avaliações", "Perfil fictício"])
      if (!(await run(textHas(t)))) throw new Error(`perfil sem «${t}»`);
    if (await run(`/verificad/i.test(__t.text())`)) throw new Error("perfil não deve exibir credenciais verificadas");
    await shot("4-perfil");
  });
}

/** Reserva o primeiro horário livre da Marina pela interface e devolve o id do horário. */
async function bookFirstSlot(tag) {
  await b.go(base + "/aluno/professores/t-marina", 1200);
  await until(`document.querySelectorAll('a[href*="agendar?horario="]').length > 0`, "horários no perfil");
  const slotId = await run(`decodeURIComponent(document.querySelector('a[href*="agendar?horario="]').getAttribute("href").split("horario=")[1])`);
  await run(`document.querySelector('a[href*="agendar?horario="]').click()`);
  await until(`location.pathname.endsWith("/agendar") && ${textHas("Selecionado:")}`, "horário pré-selecionado");
  if (tag) await shot(`5-${tag}-horario`);
  await clickText("button", "Continuar");
  await until(`location.pathname === "/aluno/agendamento/resumo" && ${textHas("Confirmar agendamento")}`, "resumo");
  if (tag) await shot(`5-${tag}-resumo`);
  await clickText("button", "Confirmar agendamento");
  await until(`location.pathname === "/aluno/aulas" && ${textHas("Nova reserva")}`, "aula em Minhas aulas");
  await until(`__t.toasts().some((t) => t.includes("Aula reservada"))`, "feedback de sucesso");
  return slotId;
}

let bookedSlot;

async function booking() {
  await step("Etapa 5 — agendamento com resumo e feedback de sucesso", async () => {
    bookedSlot = await bookFirstSlot("reserva");
    await shot("6-minhas-aulas");
  });

  await step("Etapa 5 — horário reservado some da agenda (sem reserva duplicada)", async () => {
    await b.go(base + "/aluno/professores/t-marina/agendar", 1200);
    await until(textHas("Escolha um horário"), "tela de horários");
    const stillThere = await run(`!![...document.querySelectorAll('a[href*="horario="]')].find((a) => a.href.includes(${JSON.stringify(encodeURIComponent(bookedSlot))}))`);
    if (stillThere) throw new Error("horário reservado ainda aparece como livre");
    const listed = await b.evaluate(`__edusearchDemo.dataSource.listTeacherSlots("t-marina").then((s) => s.some((x) => x.id === ${JSON.stringify(bookedSlot)}))`);
    if (listed) throw new Error("horário reservado ainda é listado como livre");
  });

  await step("Etapa 5 — conflito: mesmo horário reservado em outra aba é bloqueado", async () => {
    await b.go(base + "/aluno/professores/t-marina", 1200);
    await until(`document.querySelectorAll('a[href*="agendar?horario="]').length > 0`, "horários");
    const slot = await run(`decodeURIComponent(document.querySelector('a[href*="agendar?horario="]').getAttribute("href").split("horario=")[1])`);
    await run(`document.querySelector('a[href*="agendar?horario="]').click()`);
    await until(textHas("Selecionado:"), "horário selecionado");
    await clickText("button", "Continuar");
    await until(textHas("Confirmar agendamento"), "resumo");
    // Simula outra aba reservando o mesmo horário antes da confirmação.
    await b.evaluate(`__edusearchDemo.dataSource.createBooking({ teacherId: "t-marina", slotId: ${JSON.stringify(slot)}, subject: "matematica" })`);
    await clickText("button", "Confirmar agendamento");
    await until(textHas("acabou de ser reservado"), "mensagem de conflito");
    if (!(await run(`__t.has("a", "Escolher outro horário")`))) throw new Error("sem atalho para escolher outro horário");
    if (!(await run(`[...document.querySelectorAll("main button")].find((x) => x.textContent.includes("Confirmar agendamento")).disabled`)))
      throw new Error("botão de confirmar deveria ficar desabilitado após conflito");
    await shot("5-conflito");
    // Limpa a reserva simulada para não interferir nas próximas etapas.
    await b.evaluate(`__edusearchDemo.dataSource.listStudentLessons().then((ls) => { const l = ls.find((x) => x.status === "scheduled" && x.teacherId === "t-marina" && x.start === ${JSON.stringify(slot)}.slice(9)); return l && __edusearchDemo.dataSource.cancelLesson(l.id); })`);
  });

  await step("Etapa 5 — aluno não pode ter duas aulas no mesmo horário", async () => {
    const msg = await b.evaluate(`(async () => {
      const ds = __edusearchDemo.dataSource;
      const mine = (await ds.listStudentLessons()).filter((l) => l.status === "scheduled" && l.start > new Date().toISOString());
      for (const t of ["t-rafael", "t-luiza", "t-caio", "t-helena", "t-joao"]) {
        const slots = await ds.listTeacherSlots(t);
        const s = slots.find((x) => mine.some((l) => l.start === x.start));
        if (s) { try { await ds.createBooking({ teacherId: t, slotId: s.id, subject: (await ds.getTeacher(t)).subjects[0] }); return "RESERVOU"; } catch (e) { return e.message; } }
      }
      return "SEM-CASO";
    })()`);
    if (msg === "SEM-CASO") throw new Error("não foi possível montar o caso de sobreposição com os dados sintéticos");
    if (!/Você já tem uma aula neste horário/.test(msg)) throw new Error(`esperava bloqueio por sobreposição, veio: ${msg}`);
  });
}

async function lessons() {
  await step("Etapa 6 — detalhes e cancelamento liberam o horário", async () => {
    await b.go(base + "/aluno/aulas", 1200);
    await until(`document.querySelectorAll("main article").length > 0`, "lista de aulas");
    // Abre os detalhes da aula reservada (a de horário = bookedSlot).
    const start = bookedSlot.slice("t-marina-".length);
    const idx = await run(`[...document.querySelectorAll("main article")].findIndex((a) => a.querySelector("time")?.getAttribute("datetime") === ${JSON.stringify(start)})`);
    if (idx < 0) throw new Error("aula reservada não encontrada em Minhas aulas");
    await run(`[...document.querySelectorAll("main article")][${idx}].querySelector("button[aria-label^='Detalhes']").click()`);
    await until(`!!document.querySelector("dialog[open]") && ${textHas("Código da reserva")} && ${textHas("Não cobrado (demonstração)")}`, "detalhes da aula");
    await shot("6-detalhes");
    await clickText("button", "Cancelar aula"); // no diálogo de detalhes
    await until(`${textHas("Cancelar esta aula?")}`, "confirmação de cancelamento");
    await clickText("button", "Cancelar aula"); // confirma
    await until(`__t.toasts().some((t) => t.includes("Aula cancelada"))`, "feedback de cancelamento");
    const free = await b.evaluate(`__edusearchDemo.dataSource.listTeacherSlots("t-marina").then((s) => s.some((x) => x.id === ${JSON.stringify(bookedSlot)}))`);
    if (!free) throw new Error("horário não voltou a ficar disponível após o cancelamento");
    await clickText("[role=tab]", "Canceladas");
    await until(`[...document.querySelectorAll("main article time")].some((t) => t.getAttribute("datetime") === ${JSON.stringify(start)})`, "aula na aba Canceladas");
  });
}

async function teacherSync() {
  let start;
  await step("Consistência — reserva do aluno aparece na agenda da professora", async () => {
    const slot = await bookFirstSlot(null);
    start = slot.slice("t-marina-".length);
    await run(`__t.openAccountMenu()`);
    await until(`__t.has("[role=menuitem]", "Ver como professor (demo)")`, "menu da conta");
    await clickText("[role=menuitem]", "Ver como professor (demo)");
    await until(`location.pathname === "/professor" && ${textHas("Olá, Marina")}`, "dashboard do professor");
    await clickText("nav a", "Aulas");
    await until(`[...document.querySelectorAll("main article")].some((a) => a.querySelector("time")?.getAttribute("datetime") === ${JSON.stringify(start)} && a.innerText.includes("Ana (demonstração)"))`, "reserva da Ana nas aulas da professora");
    await shot("7-professor-aulas");
    await clickText("nav a", "Agenda");
    await until(`location.pathname === "/professor/agenda" && document.querySelectorAll("main ol > li").length === 7`, "agenda semanal");
    for (let i = 0; i < 2; i++) {
      if (await run(`__t.text().includes("Ana (demonstração)")`)) break;
      await clickText("button", "Próxima semana");
      await sleep(300);
    }
    if (!(await run(`__t.text().includes("Ana (demonstração)")`))) throw new Error("reserva não aparece na agenda semanal");
    await shot("7-professor-agenda");
  });

  await step("Consistência — cancelamento pela professora reflete para o aluno", async () => {
    await clickText("nav a", "Aulas");
    await until(`document.querySelectorAll("main article").length > 0`, "aulas da professora");
    const idx = await run(`[...document.querySelectorAll("main article")].findIndex((a) => a.querySelector("time")?.getAttribute("datetime") === ${JSON.stringify(start)})`);
    if (idx < 0) throw new Error("reserva não encontrada nas aulas da professora");
    await run(`[...[...document.querySelectorAll("main article")][${idx}].querySelectorAll("button")].find((x) => x.textContent.trim() === "Cancelar").click()`);
    await until(textHas("Cancelar esta aula?"), "confirmação");
    await clickText("button", "Cancelar aula");
    await until(`__t.toasts().some((t) => t.includes("Aula cancelada"))`, "cancelada pela professora");
    await run(`__t.openAccountMenu()`);
    await clickText("[role=menuitem]", "Ver como aluno (demo)");
    await until(`location.pathname === "/aluno"`, "volta ao aluno");
    await clickText("nav a", "Minhas aulas");
    await clickText("[role=tab]", "Canceladas");
    await until(`[...document.querySelectorAll("main article time")].some((t) => t.getAttribute("datetime") === ${JSON.stringify(start)})`, "aula cancelada visível para o aluno");
  });

  await step("Persistência — reservas sobrevivem ao recarregar (sessionStorage)", async () => {
    const before = await b.evaluate(`__edusearchDemo.dataSource.listStudentLessons().then((l) => l.length)`);
    await b.go(base + "/aluno/aulas", 1200);
    const after = await b.evaluate(`__edusearchDemo.dataSource.listStudentLessons().then((l) => l.length)`);
    if (before !== after) throw new Error(`perdeu dados ao recarregar (${before} → ${after})`);
  });
}

/** Critério de aceite: entrar, receber recomendação, reservar e ver a aula. */
async function essentialJourney() {
  await access();
  await matching();
  await profile();
  await step("Etapas 5 e 6 — reservar e ver em Minhas aulas", async () => {
    const slot = await bookFirstSlot("reserva");
    const start = slot.slice("t-marina-".length);
    if (!(await run(`[...document.querySelectorAll("main article time")].some((t) => t.getAttribute("datetime") === ${JSON.stringify(start)})`)))
      throw new Error("aula não aparece em Minhas aulas");
    await shot("6-minhas-aulas");
  });
}

/* ------------------------------------ Execução ------------------------------------ */

let failed = false;
const plans = [
  { width: 1440, dark: false, run: async () => { await access(); await searchDesktop(); await matching(); await profile(); await booking(); await lessons(); await teacherSync(); } },
  { width: 768, dark: false, run: essentialJourney },
  { width: 375, dark: false, run: async () => { await essentialJourney(); await searchMobile(); } },
  { width: 375, dark: true, run: essentialJourney },
  { width: 1440, dark: true, run: essentialJourney },
];

for (const p of plans) {
  currentWidth = p.width;
  theme = p.dark ? "escuro" : "claro";
  console.log(`\n▶ ${p.width}px, tema ${theme}`);
  await b.viewport(p.width, { dark: p.dark });
  try {
    await p.run();
    const t = await b.evaluate("document.documentElement.dataset.theme");
    if (t !== (p.dark ? "dark" : "light")) throw new Error(`tema aplicado incorreto: ${t}`);
  } catch (e) {
    failed = true;
    if (!results.some((r) => !r.ok)) results.push({ ok: false, label: `${p.width}px ${theme}`, error: e.message });
  }
}

await b.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${failed ? "✗" : "✓"} journey: ${ok}/${results.length} etapas aprovadas (${base})`);
process.exit(failed ? 1 : 0);
