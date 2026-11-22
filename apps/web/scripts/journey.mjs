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

/** Reserva o primeiro horário livre do professor pela interface e devolve o id do horário. */
async function bookFirstSlot(tag, teacherId = "t-marina") {
  await b.go(base + `/aluno/professores/${teacherId}`, 1200);
  await until(`document.querySelectorAll('a[href*="agendar?horario="]').length > 0`, "horários no perfil");
  const slotId = await run(`decodeURIComponent(document.querySelector('a[href*="agendar?horario="]').getAttribute("href").split("horario=")[1])`);
  await run(`document.querySelector('a[href*="agendar?horario="]').click()`);
  await until(`location.pathname.endsWith("/agendar") && ${textHas("Selecionado:")}`, "horário pré-selecionado");
  if (tag) await shot(`5-${tag}-horario`);
  await clickText("button", "Continuar");
  await until(`location.pathname === "/aluno/agendamento/resumo" && ${textHas("Reservar e pagar com Pix")}`, "resumo");
  if (tag) await shot(`5-${tag}-resumo`);
  await clickText("button", "Reservar e pagar com Pix");
  await payCurrentCheckout(tag);
  // Lista de Minhas aulas para as verificações seguintes.
  await b.go(base + "/aluno/aulas?view=lista", 1200);
  await until(`document.querySelectorAll("main article").length > 0`, "lista de aulas");
  return slotId;
}

/** No checkout: gera a cobrança e simula a confirmação (somente demonstração). */
async function payCurrentCheckout(tag) {
  await until(`location.pathname.startsWith("/aluno/pagamento/") && ${textHas("Gerar cobrança Pix")}`, "checkout: reserva solicitada");
  if (tag) await shot(`6-${tag}-checkout-solicitada`);
  await clickText("button", "Gerar cobrança Pix");
  await until(`${textHas("QR Code simulado")} && ${textHas("Simular confirmação de pagamento")}`, "checkout: aguardando pagamento");
  if (tag) await shot(`6-${tag}-checkout-pix`);
  await clickText("button", "Simular confirmação de pagamento");
  await until(`${textHas("Pagamento confirmado (simulação)")}`, "pagamento confirmado (simulado)", 8000);
  await until(`__t.toasts().some((t) => t.includes("Pagamento confirmado"))`, "feedback de sucesso");
  if (tag) await shot(`6-${tag}-checkout-confirmado`);
}

let bookedSlot;
const slotStart = (slotId) => slotId.slice(slotId.indexOf("-", 2) + 1);

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
    await until(textHas("Reservar e pagar com Pix"), "resumo");
    // Simula outra aba reservando o mesmo horário antes da confirmação.
    await b.evaluate(`__edusearchDemo.dataSource.createBooking({ teacherId: "t-marina", slotId: ${JSON.stringify(slot)}, subject: "matematica" })`);
    await clickText("button", "Reservar e pagar com Pix");
    await until(textHas("acabou de ser reservado"), "mensagem de conflito");
    if (!(await run(`__t.has("a", "Escolher outro horário")`))) throw new Error("sem atalho para escolher outro horário");
    if (!(await run(`[...document.querySelectorAll("main button")].find((x) => x.textContent.includes("Reservar e pagar com Pix")).disabled`)))
      throw new Error("botão de confirmar deveria ficar desabilitado após conflito");
    await shot("5-conflito");
    // Limpa a reserva simulada para não interferir nas próximas etapas.
    await b.evaluate(`__edusearchDemo.dataSource.listStudentLessons().then((ls) => { const l = ls.find((x) => ["scheduled", "pending_payment"].includes(x.status) && x.teacherId === "t-marina" && x.start === ${JSON.stringify(slot)}.slice(9)); return l && __edusearchDemo.dataSource.cancelLesson(l.id); })`);
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
    await b.go(base + "/aluno/aulas?view=lista", 1200);
    await until(`document.querySelectorAll("main article").length > 0`, "lista de aulas");
    // Abre os detalhes da aula reservada (a de horário = bookedSlot).
    const start = slotStart(bookedSlot);
    const idx = await run(`[...document.querySelectorAll("main article")].findIndex((a) => a.querySelector("time")?.getAttribute("datetime") === ${JSON.stringify(start)})`);
    if (idx < 0) throw new Error("aula reservada não encontrada em Minhas aulas");
    await run(`[...document.querySelectorAll("main article")][${idx}].querySelector("button[aria-label^='Detalhes']").click()`);
    await until(`!!document.querySelector("dialog[open]") && ${textHas("Código da reserva")} && ${textHas("Pagamento confirmado (simulado)")}`, "detalhes da aula");
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
    start = slotStart(slot);
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
    await clickText("[role=radio]", "Lista");
    await clickText("[role=tab]", "Canceladas");
    await until(`[...document.querySelectorAll("main article time")].some((t) => t.getAttribute("datetime") === ${JSON.stringify(start)})`, "aula cancelada visível para o aluno");
  });

  await step("Persistência — reservas sobrevivem ao recarregar (sessionStorage)", async () => {
    const before = await b.evaluate(`__edusearchDemo.dataSource.listStudentLessons().then((l) => l.length)`);
    await b.go(base + "/aluno/aulas?view=lista", 1200);
    const after = await b.evaluate(`__edusearchDemo.dataSource.listStudentLessons().then((l) => l.length)`);
    if (before !== after) throw new Error(`perdeu dados ao recarregar (${before} → ${after})`);
  });
}

async function otherTeachers() {
  await step("Consistência — reserva com outro professor vai para a agenda dele (não da Marina)", async () => {
    await b.go(base + "/", 300);
    await b.evaluate(`sessionStorage.setItem('edusearch-demo-session', JSON.stringify({ role: 'student', name: 'Ana' }))`);
    const slot = await bookFirstSlot(null, "t-rafael");
    const start = slotStart(slot);
    const idx = await run(`[...document.querySelectorAll("main article")].findIndex((a) => a.querySelector("time")?.getAttribute("datetime") === ${JSON.stringify(start)})`);
    if (idx < 0) throw new Error("reserva com o Prof. Rafael não aparece em Minhas aulas");
    if (!(await run(`[...document.querySelectorAll("main article")][${idx}].innerText.includes("Prof. Rafael Nogueira")`))) throw new Error("aula sem o nome do professor reservado");
    await run(`[...document.querySelectorAll("main article")][${idx}].querySelector("button[aria-label^='Detalhes']").click()`);
    await clickText("button", "Ver na agenda do professor");
    await until(`location.pathname === "/professor/aulas" && [...document.querySelectorAll("main article")].some((a) => a.querySelector("time")?.getAttribute("datetime") === ${JSON.stringify(start)} && a.innerText.includes("Ana (demonstração)"))`, "reserva na agenda do Rafael");
    await clickText("nav a", "Início");
    await until(`${textHas("Olá, Rafael")} && ${textHas("Próximas aulas")}`, "visão do Prof. Rafael carregada");
    await shot("8-professor-rafael");

    // Troca para a Profa. Marina em Configurações: a reserva do Rafael não pode aparecer lá.
    await clickText("nav a", "Configurações");
    await fill("Professor exibido", "t-marina");
    await until(`location.pathname === "/professor" && ${textHas("Olá, Marina")}`, "visão da Profa. Marina");
    await clickText("nav a", "Aulas");
    await until(`document.querySelectorAll("main article").length > 0`, "aulas da Marina");
    if (await run(`[...document.querySelectorAll("main article")].some((a) => a.querySelector("time")?.getAttribute("datetime") === ${JSON.stringify(start)})`))
      throw new Error("reserva do Rafael apareceu na agenda da Marina");

    // Limpa: cancela a reserva com o Rafael para não afetar as próximas etapas.
    await b.evaluate(`__edusearchDemo.dataSource.listStudentLessons().then((ls) => { const l = ls.find((x) => x.status === "scheduled" && x.teacherId === "t-rafael" && x.start === ${JSON.stringify(start)}); return l && __edusearchDemo.dataSource.cancelLesson(l.id); })`);
  });

  await step("Acesso — escolher outro professor fictício na tela de perfil", async () => {
    await b.go(base + "/", 300);
    await b.evaluate("sessionStorage.removeItem('edusearch-demo-session')");
    await b.go(base + "/perfil-de-acesso", 900);
    await clickText("label", "Quero ensinar");
    await fill("Ver a demonstração como", "t-luiza");
    await clickText("button", "Continuar como professor");
    await until(`location.pathname === "/professor" && ${textHas("Olá, Luiza")}`, "visão da Profa. Luiza");
    await clickText("nav a", "Aulas");
    await until(`${textHas("Igor S. (fictício)")} && !${textHas("Ana (demonstração)")}`, "aulas da Luiza (sem as da Marina)");
  });
}

const ds = "__edusearchDemo.dataSource";
const asStudent = `sessionStorage.setItem('edusearch-demo-session', JSON.stringify({ role: 'student', name: 'Ana' }))`;
const asTeacher = `sessionStorage.setItem('edusearch-demo-session', JSON.stringify({ role: 'teacher', name: 'Marina', teacherId: 't-marina' }))`;

/** Solicita uma reserva com a Marina pela camada de dados (sem pagar) e devolve { lesson, slot }. */
const requestBooking = (index = 0) =>
  b.evaluate(`(async () => {
    const slots = await ${ds}.listTeacherSlots("t-marina");
    const lesson = await ${ds}.createBooking({ teacherId: "t-marina", slotId: slots[${index}].id, subject: "matematica" });
    return { lesson, slot: slots[${index}] };
  })()`);

async function checkoutStates() {
  let paidLessonId;
  await step("Checkout — reserva solicitada → aguardando pagamento (placeholders seguros)", async () => {
    await b.go(base + "/", 300);
    await b.evaluate(`sessionStorage.removeItem("edusearch-demo-data"); ${asStudent}`);
    await b.go(base + "/aluno", 900);
    const { lesson } = await requestBooking(0);
    paidLessonId = lesson.id;
    if (lesson.status !== "pending_payment") throw new Error(`reserva deveria nascer aguardando pagamento, veio ${lesson.status}`);
    await b.go(base + `/aluno/pagamento/${lesson.id}`, 1200);
    await until(`${textHas("Resumo da reserva")} && ${textHas("Gerar cobrança Pix")} && ${textHas("reserva está solicitada")}`, "reserva solicitada");
    await clickText("button", "Gerar cobrança Pix");
    await until(`${textHas("Aguardando pagamento (simulado)")} && ${textHas("QR Code simulado")} && ${textHas("Expira em")}`, "aguardando pagamento");
    const copyDisabled = await run(`[...document.querySelectorAll("main button")].find((x) => x.textContent.trim() === "Copiar").disabled`);
    if (!copyDisabled) throw new Error("copiar código Pix deveria estar desabilitado sem código real");
    if (await run(`!!document.querySelector('main img[alt*="QR"]')`)) throw new Error("não deveria haver imagem de QR Code na demonstração");
    // Idempotência: criar a cobrança de novo devolve a mesma
    const again = await b.evaluate(`Promise.all([${ds}.getCheckout(${JSON.stringify(lesson.id)}), ${ds}.createCheckout(${JSON.stringify(lesson.id)})]).then(([a, c]) => a.id === c.id)`);
    if (!again) throw new Error("criar a cobrança duas vezes gerou cobranças diferentes");
  });

  await step("Checkout — falha simulada e nova cobrança", async () => {
    await clickText("button", "Simular falha");
    await until(`${textHas("Falha no pagamento (simulado)")} && ${textHas("Gerar nova cobrança")}`, "estado de falha");
    await clickText("button", "Gerar nova cobrança");
    await until(`${textHas("Aguardando pagamento (simulado)")}`, "nova cobrança aguardando pagamento");
  });

  await step("Checkout — confirmação simulada, processamento e bloqueio de confirmação repetida", async () => {
    await clickText("button", "Simular confirmação de pagamento");
    await until(`${textHas("Pagamento em processamento")}`, "em processamento", 3000).catch(() => {}); // transitório
    await until(`${textHas("Pagamento confirmado (simulação)")} && ${textHas("Ver no calendário")}`, "confirmado", 8000);
    await shot("6-checkout-confirmado");
    const dup = await b.evaluate(`(async () => {
      const c = await ${ds}.getCheckout(${JSON.stringify(paidLessonId)});
      try { await ${ds}.simulatePayment(c.id, "confirmed"); return "CONFIRMOU DE NOVO"; } catch (e) { return e.message; }
    })()`);
    if (!/já foi confirmado/.test(dup)) throw new Error(`confirmação repetida deveria ser recusada: ${dup}`);
    const lesson = await b.evaluate(`${ds}.getLesson(${JSON.stringify(paidLessonId)})`);
    if (lesson.status !== "scheduled" || lesson.payment?.status !== "confirmed") throw new Error(`aula deveria estar confirmada: ${lesson.status}/${lesson.payment?.status}`);
  });

  await step("Checkout — cobrança expirada cancela a reserva e libera o horário", async () => {
    const { lesson, slot } = await requestBooking(1);
    await b.go(base + `/aluno/pagamento/${lesson.id}`, 1200);
    await clickText("button", "Gerar cobrança Pix");
    await until(textHas("Simular expiração"), "cobrança aberta");
    await clickText("button", "Simular expiração");
    await until(`${textHas("Cobrança expirada")} && ${textHas("horário voltou a ficar disponível")}`, "expirada");
    await shot("6-checkout-expirado");
    const state = await b.evaluate(`Promise.all([${ds}.getLesson(${JSON.stringify(lesson.id)}), ${ds}.listTeacherSlots("t-marina")]).then(([l, s]) => ({ status: l.status, free: s.some((x) => x.id === ${JSON.stringify(slot.id)}) }))`);
    if (state.status !== "cancelled" || !state.free) throw new Error(`expiração incoerente: ${JSON.stringify(state)}`);
  });

  await step("Calendário — aula confirmada, mudança de semana e mês, teclado", async () => {
    await clickText("a", "Minhas aulas");
    await until(`location.pathname === "/aluno/aulas" && document.querySelectorAll("main ol > li").length === 7`, "calendário semanal");
    const before = await run(`document.querySelector('main [aria-live="polite"]').textContent`);
    await clickText("button[aria-label]", "Próxima semana");
    await until(`document.querySelector('main [aria-live="polite"]').textContent !== ${JSON.stringify(before)}`, "semana mudou");
    await clickText("button", "Voltar para esta semana");
    await clickText("[role=radio]", "Mês");
    await until(`!!document.querySelector('[role="group"][aria-label^="Dias de"]')`, "grade do mês");
    await shot("7-calendario-mes");
    // Teclado: seta para a direita seleciona o dia seguinte
    const sel = await run(`document.querySelector('[data-day][aria-pressed="true"]').dataset.day`);
    await run(`document.querySelector('[data-day][aria-pressed="true"]').focus()`);
    await b.press("ArrowRight");
    await until(`document.activeElement?.dataset.day && document.activeElement.dataset.day !== ${JSON.stringify(sel)} && document.activeElement.getAttribute("aria-pressed") === "true"`, "seta muda o dia");
    await b.press("PageDown");
    await until(`document.activeElement?.getAttribute("aria-pressed") === "true" && document.activeElement.dataset.day.slice(0, 7) !== ${JSON.stringify(sel)}.slice(0, 7)`, "PageDown muda o mês");
    // Abre os detalhes da aula confirmada: o link ?aula= foca o dia da aula
    await b.go(base + `/aluno/aulas?aula=${paidLessonId}`, 1400);
    await clickText("[role=radio]", "Semana");
    await until(`!!document.querySelector('main button[data-lesson-id="${paidLessonId}"]')`, "evento confirmado no calendário");
    if (!(await run(`document.querySelector('main button[data-lesson-id="${paidLessonId}"]').textContent.includes("Confirmada")`))) throw new Error("evento confirmado sem o status no nome acessível");
    await run(`document.querySelector('main button[data-lesson-id="${paidLessonId}"]').click()`);
    await until(`!!document.querySelector("dialog[open]") && ${textHas("Abrir aula online")} && ${textHas("Pagamento confirmado (simulado)")}`, "detalhes pelo calendário");
    await shot("7-calendario-detalhes");
  });

  await step("Aula online — sem link Meet, sem link inventado, estados e Google Agenda simulado", async () => {
    await b.go(base + `/aluno/aulas/${paidLessonId}`, 1400);
    await until(`${textHas("EduSearch · Aula online")} && ${textHas("Google Meet")} && ${textHas("Link indisponível")}`, "aula online sem link");
    if (await run(`[...document.querySelectorAll("a[href]")].some((a) => a.href.includes("meet.google.com"))`)) throw new Error("não pode haver link do Meet inventado");
    if (await run(`[...document.querySelectorAll("main a, main button")].some((x) => x.textContent.includes("Entrar no Google Meet"))`)) throw new Error("botão de entrada não deveria aparecer sem URL confiável");
    await shot("8-aula-online");
    for (const [label, badge] of [["Pronta", "Pronta para iniciar"], ["Em andamento", "Em andamento"], ["Finalizada", "Finalizada"], ["Cancelada", "Cancelada"]]) {
      await clickText("[role=radio]", label);
      await until(textHas(`${badge} (pré-visualização)`), `estado ${badge}`);
    }
    await clickText("[role=radio]", "Agendada");
    const addDisabled = await run(`[...document.querySelectorAll("main button")].find((x) => x.textContent.includes("Adicionar ao Google Agenda")).disabled`);
    if (!addDisabled) throw new Error("Adicionar ao Google Agenda deveria exigir conexão");
    await clickText("button", "Simular conexão");
    await until(textHas("Conectado (simulação)"), "conexão simulada");
    await clickText("button", "Adicionar ao Google Agenda");
    await until(textHas("Aula adicionada ao Google Agenda (simulação)"), "sincronização simulada", 6000);
    // Exportação .ics local válida (gerada pelo módulo do app, sem rede)
    const ics = await b.evaluate(`import("/src/lib/ics.ts").then(async (m) => m.buildLessonIcs(await ${ds}.getLesson(${JSON.stringify(paidLessonId)}), "student"))`);
    for (const line of ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:", "DTEND:", "STATUS:CONFIRMED", "END:VCALENDAR"]) if (!ics.includes(line)) throw new Error(`.ics sem ${line}`);
    if (ics.includes("meet.google.com")) throw new Error(".ics não pode conter link de reunião");
  });

  await step("Professor — recebimento com comissão de 15% e reserva pendente não recebida", async () => {
    const pending = await requestBooking(2);
    await b.evaluate(asTeacher);
    await b.go(base + "/professor/recebimentos", 1500);
    await until(`${textHas("Comissão EduSearch (15%)")} && ${textHas("Detalhamento por aula")}`, "recebimentos 15%");
    const e = await b.evaluate(`${ds}.getEarnings()`);
    if (e.commissionBps !== 1500) throw new Error(`comissão deveria ser 1500 bps, veio ${e.commissionBps}`);
    for (const i of e.items) {
      if (i.commissionCents !== Math.floor((i.grossCents * 1500 + 5000) / 10000) || i.commissionCents + i.teacherShareCents !== i.grossCents)
        throw new Error(`comissão inconsistente: ${JSON.stringify(i)}`);
    }
    const paid = e.items.find((i) => i.lessonId === paidLessonId);
    if (!paid || paid.status !== "confirmed" || paid.commissionCents !== 1200 || paid.teacherShareCents !== 6800) throw new Error(`aula paga (R$ 80) deveria render 12,00/68,00: ${JSON.stringify(paid)}`);
    const pend = e.items.find((i) => i.lessonId === pending.lesson.id);
    if (!pend || pend.status !== "awaiting_payment" || pend.estimatedBalanceCents !== 0) throw new Error(`reserva pendente não pode contar como recebida: ${JSON.stringify(pend)}`);
    if (e.confirmed.grossCents !== e.items.filter((i) => i.status === "confirmed").reduce((a, i) => a + i.grossCents, 0)) throw new Error("total confirmado inclui itens não pagos");
    if (await run(`/Repassad/.test(__t.text())`)) throw new Error("não pode haver repasse apresentado como concluído");
    await shot("9-recebimentos");
  });

  await step("Professor — comissão e incentivos (15%, sem faixas aprovadas)", async () => {
    await clickText("a", "Comissão e benefícios");
    await until(`${textHas("Comissão padrão")} && ${textHas("Comissão atual")} && ${textHas("nenhuma faixa foi aprovada")}`, "comissão");
    const p = await b.evaluate(`${ds}.getCommissionProgram()`);
    if (p.standardBps !== 1500 || p.currentBps !== 1500 || p.activeBenefits.length || p.savingsCents !== 0) throw new Error(`programa incoerente: ${JSON.stringify(p)}`);
    for (const t of ["DEMO-MARINA", "Link de indicação disponível após a integração", "Nenhuma recompensa liberada", "Cadastros não geram recompensa", "Exemplo com dados da demonstração"])
      if (!(await run(textHas(t)))) throw new Error(`benefícios sem «${t}»`);
    const copyLink = await run(`[...document.querySelectorAll("main button")].find((x) => x.textContent.includes("Copiar link")).disabled`);
    if (!copyLink) throw new Error("link de indicação não pode ser operacional sem backend");
    await shot("9-beneficios");
  });

  await step("Professor — bloqueio de dia remove horários e mostra conflito", async () => {
    const lesson = await b.evaluate(`${ds}.getLesson(${JSON.stringify(paidLessonId)})`);
    const day = await b.evaluate(`import("/src/lib/calendar.ts").then((m) => m.dateKey(${JSON.stringify(lesson.start)}))`);
    await b.evaluate(`${ds}.setDateBlocked(${JSON.stringify(day)}, true)`);
    const slotsThatDay = await b.evaluate(`import("/src/lib/calendar.ts").then(async (m) => (await ${ds}.listTeacherSlots("t-marina")).filter((s) => m.dateKey(s.start) === ${JSON.stringify(day)}).length)`);
    if (slotsThatDay !== 0) throw new Error("dia bloqueado ainda oferece horários");
    await b.go(base + "/professor/agenda", 1500);
    for (let i = 0; i < 2 && !(await run(`__t.text().includes("Dia bloqueado")`)); i++) await clickText("button[aria-label]", "Próxima semana");
    await until(`${textHas("Dia bloqueado")} && [...document.querySelectorAll("main button[data-lesson-id]")].some((x) => x.textContent.includes("Conflito") && /Conflito:/.test(document.getElementById(x.getAttribute("aria-describedby"))?.textContent ?? ""))`, "conflito visível");
    await shot("10-agenda-professor-conflito");
    await clickText("button", "Desbloquear dia");
    await until(`!${textHas("Dia bloqueado")}`, "desbloqueio");
  });

  await step("Coerência — cancelar aula paga atualiza aluno, professor e financeiro", async () => {
    await b.evaluate(asStudent);
    const cancelled = await b.evaluate(`${ds}.cancelLesson(${JSON.stringify(paidLessonId)})`);
    if (cancelled.status !== "cancelled" || cancelled.payment?.status !== "confirmed") throw new Error("cancelamento deveria manter o pagamento registrado (sem reembolso real)");
    await b.evaluate(asTeacher);
    const e = await b.evaluate(`${ds}.getEarnings()`);
    const item = e.items.find((i) => i.lessonId === paidLessonId);
    if (!item || item.status !== "cancelled_after_payment" || item.estimatedBalanceCents !== 0) throw new Error(`financeiro incoerente após cancelamento: ${JSON.stringify(item)}`);
    const teacherLesson = (await b.evaluate(`${ds}.listTeacherLessons()`)).find((l) => l.id === paidLessonId);
    if (teacherLesson.status !== "cancelled") throw new Error("aula cancelada aparece ativa para o professor");
    await b.evaluate(asStudent);
  });
}

/** Critério de aceite: entrar, receber recomendação, reservar e ver a aula. */
async function essentialJourney() {
  await access();
  await matching();
  await profile();
  await step("Etapas 5 e 6 — reservar e ver em Minhas aulas", async () => {
    const slot = await bookFirstSlot("reserva");
    const start = slotStart(slot);
    if (!(await run(`[...document.querySelectorAll("main article time")].some((t) => t.getAttribute("datetime") === ${JSON.stringify(start)})`)))
      throw new Error("aula não aparece em Minhas aulas");
    await shot("6-minhas-aulas");
  });
}

/* ------------------------------------ Execução ------------------------------------ */

let failed = false;
const plans = [
  { width: 1440, dark: false, run: async () => { await access(); await searchDesktop(); await matching(); await profile(); await booking(); await lessons(); await teacherSync(); await otherTeachers(); await checkoutStates(); } },
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
