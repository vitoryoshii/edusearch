/**
 * Adapter de DEMONSTRAÇÃO: simula a API no navegador, com latência artificial.
 * Nada é enviado a servidores. Nenhuma cobrança, reunião ou evento real é criado.
 *
 * Estado: um único "banco" em memória (aulas, cobranças, dados por professor,
 * bloqueios e conexão de agenda simulada), espelhado no sessionStorage.
 *
 * Visão do professor: o professor "logado" vem da sessão de demonstração
 * (`teacherId`), do mesmo jeito que a API real vai identificá-lo pelo JWT.
 *
 * Regras (ver docs/frontend/demo-journey.md):
 *   - Horários = grade do professor (sem dias bloqueados) − aulas ativas.
 *     Aulas ativas = confirmadas ou com reserva aguardando pagamento.
 *   - Reserva cria a aula em "pending_payment"; só a confirmação do Pix
 *     (simulada) a torna "scheduled". Expirar/cancelar a cobrança libera o horário.
 *   - Uma cobrança só pode ser confirmada uma vez (409 na repetição).
 *   - Comissão padrão de 15% (src/lib/commission.ts), em centavos inteiros.
 *
 * Para revisar estados sem backend, adicione à URL:
 *   ?demo=erro   → todas as operações falham
 *   ?demo=vazio  → listas retornam vazias
 */
import { ApiError } from "../../api/client";
import type {
  CalendarConnection,
  Checkout,
  CommissionProgram,
  Difficulty,
  EarningsSummary,
  FinancialStatus,
  Lesson,
  MatchRequest,
  MatchResult,
  Methodology,
  ReferralProgram,
  Specialty,
  Teacher,
  TeacherEarning,
  TeacherProfile,
  WeeklyAvailability,
} from "../../api/types";
import { STANDARD_COMMISSION_BPS, splitLessonAmount } from "../../commission";
import { DEMO_SESSION_KEY, firstName } from "../../demo";
import { DIFFICULTY_LABELS, LEVEL_LABELS, METHODOLOGY_LABELS, PERIOD_LABELS, formatMoney } from "../../format";
import type { DataSource } from "../source";
import * as fx from "./fixtures";

/* --------------------------------- Infra --------------------------------- */

type DemoMode = "normal" | "erro" | "vazio";

function demoMode(): DemoMode {
  try {
    const v = new URLSearchParams(window.location.search).get("demo");
    return v === "erro" || v === "vazio" ? v : "normal";
  } catch {
    return "normal";
  }
}

const clone = <T,>(v: T): T => structuredClone(v);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

async function respond<T>(value: T | (() => T), { list = false, write = false } = {}): Promise<T> {
  await sleep(write ? 600 : 250 + Math.random() * 300);
  const mode = demoMode();
  if (mode === "erro") throw new ApiError("network", "Falha simulada (modo ?demo=erro).");
  const result = typeof value === "function" ? (value as () => T)() : value;
  if (mode === "vazio" && list && Array.isArray(result)) return [] as T;
  return clone(result);
}

const conflict = (message: string) => new ApiError("http", message, { status: 409 });

/* ------------------------------ Estado + persistência ------------------------------ */

const STORAGE_KEY = "edusearch-demo-data";
const STORAGE_VERSION = 4;
/** Validade simulada de uma cobrança Pix na demonstração. */
export const DEMO_CHECKOUT_MINUTES = 15;

type DemoDb = {
  version: number;
  lessons: Lesson[];
  checkouts: Checkout[];
  /** Dados editáveis por professor (chave = id do professor). */
  profiles: Record<string, TeacherProfile>;
  specialties: Record<string, Specialty[]>;
  availability: Record<string, WeeklyAvailability>;
  /** Dias bloqueados por professor (YYYY-MM-DD, horário local). */
  blockedDates: Record<string, string[]>;
  calendar: CalendarConnection;
};

function initialDb(): DemoDb {
  const byTeacher = <T,>(fn: (t: Teacher) => T) => Object.fromEntries(fx.teachers.map((t) => [t.id, fn(t)]));
  const lessons = fx.seedLessons();
  // Aulas confirmadas/concluídas do seed têm uma cobrança confirmada (simulada).
  const checkouts: Checkout[] = lessons
    .filter((l) => l.payment)
    .map((l) => ({
      id: l.payment!.checkoutId,
      lessonId: l.id,
      status: "confirmed",
      method: "pix",
      gateway: "abacatepay",
      amountCents: l.priceCents,
      createdAt: new Date(new Date(l.start).getTime() - 3 * 86_400_000).toISOString(),
      expiresAt: null,
      confirmedAt: new Date(new Date(l.start).getTime() - 3 * 86_400_000 + 600_000).toISOString(),
      pix: { qrCodeImageUrl: null, copyPasteCode: null },
      simulated: true,
    }));
  return {
    version: STORAGE_VERSION,
    lessons,
    checkouts,
    profiles: byTeacher(fx.profileOf),
    specialties: byTeacher(fx.specialtiesOf),
    availability: byTeacher(fx.availabilityOf),
    blockedDates: byTeacher(() => [] as string[]),
    calendar: { status: "disconnected", simulated: true },
  };
}

function loadDb(): DemoDb {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoDb;
      if (parsed?.version === STORAGE_VERSION && Array.isArray(parsed.lessons)) return parsed;
    }
  } catch {
    /* armazenamento indisponível ou corrompido: recomeça */
  }
  return initialDb();
}

let db = loadDb();

function persist() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* sem armazenamento: o estado fica só em memória */
  }
}

/* ------------------------------- Sessão ------------------------------- */

function readSession(): { role?: string; teacherId?: string } | null {
  try {
    return JSON.parse(window.sessionStorage.getItem(DEMO_SESSION_KEY) ?? "null");
  } catch {
    return null;
  }
}

/** Professor "logado" na visão de professor da demonstração. */
function actingTeacherId(): string {
  const s = readSession();
  if (s?.role === "teacher" && s.teacherId && fx.teachers.some((t) => t.id === s.teacherId)) return s.teacherId;
  return fx.DEMO_TEACHER_ID;
}

/* ------------------------------- Professores ------------------------------- */

/** Professor como o aluno o vê, refletindo o perfil, as especialidades e a grade editados. */
function teacherView(t: Teacher): Teacher {
  const p = db.profiles[t.id];
  const specs = db.specialties[t.id] ?? [];
  if (!p) return t;
  const subjects = specs.map((s) => s.subject);
  const levels = [...new Set(specs.flatMap((s) => s.levels))];
  return {
    ...t,
    name: p.name,
    headline: p.headline,
    bio: p.bio,
    priceCents: p.priceCents,
    lessonMinutes: p.lessonMinutes,
    methodologies: p.methodologies,
    education: p.education.split("\n").map((l) => l.trim()).filter(Boolean),
    subjects: subjects.length ? subjects : t.subjects,
    levels: levels.length ? levels : t.levels,
  };
}

const allTeachers = () => fx.teachers.map(teacherView);

function findTeacher(id: string): Teacher {
  const t = allTeachers().find((x) => x.id === id);
  if (!t) throw new ApiError("http", "Professor não encontrado.", { status: 404 });
  return t;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/* --------------------------------- Horários -------------------------------- */

/** Aula que ocupa o horário: confirmada ou com reserva aguardando pagamento. */
const isActive = (l: Lesson) => l.status === "scheduled" || l.status === "pending_payment";

/** YYYY-MM-DD no horário local (mesma convenção da interface). */
const localDateKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function candidateSlots(teacher: Teacher) {
  const weekly = db.availability[teacher.id] ?? fx.availabilityOf(teacher);
  const blocked = new Set(db.blockedDates[teacher.id] ?? []);
  return fx.candidateSlots(teacher, weekly).filter((s) => !blocked.has(localDateKey(s.start)));
}

/** Horários livres = candidatos futuros − aulas ativas do professor. */
function freeSlots(teacher: Teacher) {
  const now = nowIso();
  const busy = db.lessons.filter((l) => l.teacherId === teacher.id && isActive(l));
  return candidateSlots(teacher).filter((s) => s.start > now && !busy.some((l) => fx.overlaps(l, s)));
}

/* --------------------------------- Pagamentos -------------------------------- */

const latestCheckout = (lessonId: string) =>
  db.checkouts.filter((c) => c.lessonId === lessonId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;

function syncLessonPayment(lesson: Lesson) {
  const c = latestCheckout(lesson.id);
  lesson.payment = c ? { checkoutId: c.id, status: c.status } : null;
}

function expireCheckout(c: Checkout) {
  c.status = "expired";
  const lesson = db.lessons.find((l) => l.id === c.lessonId);
  if (lesson && lesson.status === "pending_payment") {
    lesson.status = "cancelled";
    lesson.cancellationReason = "payment_expired";
  }
  if (lesson) syncLessonPayment(lesson);
}

/** Expira cobranças vencidas: a reserva é cancelada e o horário volta a ficar livre. */
function refreshExpirations() {
  const now = nowIso();
  let changed = false;
  for (const c of db.checkouts) {
    if ((c.status === "pending" || c.status === "creating") && c.expiresAt && c.expiresAt <= now) {
      expireCheckout(c);
      changed = true;
    }
  }
  if (changed) persist();
}

/* --------------------------------- Matching -------------------------------- */

/**
 * Dificuldade → metodologias que ajudam. Regra local e explicável;
 * a análise com IA (Gemini) será feita pela API no futuro.
 */
const DIFFICULTY_HELP: Record<Difficulty, Methodology[]> = {
  base: ["teorica"],
  exercicios: ["exercicios"],
  pratica: ["pratica", "projetos"],
  fala: ["conversacao"],
  organizacao: ["projetos", "teorica"],
};

/** Pesos (somam 100). Expostos na tela para explicar a compatibilidade. */
export const MATCH_WEIGHTS = { subject: 40, level: 20, methodology: 15, difficulties: 5, periods: 10, budget: 10 } as const;

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function scoreTeacher(t: Teacher, r: MatchRequest): MatchResult | null {
  if (!t.subjects.includes(r.subject)) return null; // disciplina é obrigatória
  const W = MATCH_WEIGHTS;
  let score = W.subject;
  const reasons = [`Ensina ${fx.subjectName(r.subject)}`];
  const cautions: string[] = [];

  if (t.levels.includes(r.level)) {
    score += W.level;
    reasons.push(`Atende ${lower(LEVEL_LABELS[r.level])}`);
  } else cautions.push(`Não lista ${lower(LEVEL_LABELS[r.level])} entre os níveis atendidos`);

  if (!r.methodologies.length) score += W.methodology;
  else {
    const m = r.methodologies.filter((x) => t.methodologies.includes(x));
    if (m.length) {
      score += W.methodology;
      reasons.push(`Metodologia: ${m.map((x) => lower(METHODOLOGY_LABELS[x])).join(", ")}`);
    }
  }

  if (!r.difficulties.length) score += W.difficulties;
  else {
    const helped = r.difficulties.filter((d) => DIFFICULTY_HELP[d].some((m) => t.methodologies.includes(m)));
    if (helped.length) {
      score += W.difficulties;
      reasons.push(`Pode ajudar com: ${helped.map((d) => lower(DIFFICULTY_LABELS[d])).join(", ")}`);
    }
  }

  if (!r.periods.length) score += W.periods;
  else {
    const p = r.periods.filter((x) => t.periods.includes(x));
    if (p.length) {
      score += W.periods;
      reasons.push(`Horários de ${p.map((x) => lower(PERIOD_LABELS[x])).join(" e ")}`);
    } else cautions.push(`Atende em outros períodos (${t.periods.map((x) => lower(PERIOD_LABELS[x])).join(", ")})`);
  }

  if (!r.maxPriceCents || t.priceCents <= r.maxPriceCents) {
    score += W.budget;
    reasons.push(`${formatMoney(t.priceCents)} por aula${r.maxPriceCents ? ", dentro do orçamento" : ""}`);
  } else cautions.push(`Acima do orçamento: ${formatMoney(t.priceCents)} por aula`);

  return { teacher: t, score, reasons, cautions };
}

/* --------------------------------- Finanças --------------------------------- */

function financialStatus(l: Lesson): FinancialStatus | null {
  const paid = l.payment?.status === "confirmed";
  if (l.status === "pending_payment") return "awaiting_payment";
  if (l.status === "cancelled") return paid ? "cancelled_after_payment" : null;
  return paid ? "confirmed" : null;
}

function buildEarnings(lessons: Lesson[]): EarningsSummary {
  const items: TeacherEarning[] = lessons
    .map((l) => ({ l, status: financialStatus(l) }))
    .filter((x): x is { l: Lesson; status: FinancialStatus } => x.status !== null)
    .sort((a, b) => b.l.start.localeCompare(a.l.start))
    .map(({ l, status }) => {
      const { commissionCents, teacherShareCents } = splitLessonAmount(l.priceCents);
      return {
        id: `e-${l.id}`,
        lessonId: l.id,
        date: l.start,
        studentName: l.studentName,
        subject: l.subject,
        grossCents: l.priceCents,
        commissionCents,
        teacherShareCents,
        gatewayFeeCents: null, // tarifas da AbacatePay ainda não informadas
        // Só pagamentos confirmados compõem saldo estimado; cancelamento após
        // pagamento depende da política de reembolso (não processada aqui).
        estimatedBalanceCents: status === "confirmed" ? teacherShareCents : 0,
        status,
      };
    });
  const confirmed = items.filter((i) => i.status === "confirmed");
  const sum = (arr: TeacherEarning[], k: "grossCents" | "commissionCents" | "teacherShareCents" | "estimatedBalanceCents") =>
    arr.reduce((a, i) => a + i[k], 0);
  const month = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date());
  return {
    periodLabel: month.charAt(0).toUpperCase() + month.slice(1),
    commissionBps: STANDARD_COMMISSION_BPS,
    confirmed: {
      grossCents: sum(confirmed, "grossCents"),
      commissionCents: sum(confirmed, "commissionCents"),
      teacherShareCents: sum(confirmed, "teacherShareCents"),
      gatewayFeesCents: null,
      estimatedBalanceCents: sum(confirmed, "estimatedBalanceCents"),
    },
    awaitingPaymentCents: items.filter((i) => i.status === "awaiting_payment").reduce((a, i) => a + i.grossCents, 0),
    items,
  };
}

/* --------------------------------- Adapter --------------------------------- */

const studentLessons = () => db.lessons.filter((l) => l.studentId === fx.DEMO_STUDENT_ID);
const teacherLessons = () => {
  const id = actingTeacherId();
  return db.lessons.filter((l) => l.teacherId === id);
};

/** Aula visível para a sessão atual (aluno: as próprias; professor: as suas). */
function visibleLesson(id: string): Lesson {
  const s = readSession();
  const l = db.lessons.find((x) => x.id === id);
  const visible = l && (s?.role === "teacher" ? l.teacherId === actingTeacherId() : l.studentId === fx.DEMO_STUDENT_ID);
  if (!l || !visible) throw new ApiError("http", "Aula não encontrada.", { status: 404 });
  return l;
}

export const mockDataSource: DataSource = {
  kind: "mock",

  resetDemoData: async () => {
    db = initialDb();
    persist();
  },

  health: () => respond({ status: "ok" as const, service: "edusearch-demo", version: "demo" }),

  listSubjects: () => respond(fx.subjects, { list: true }),

  searchTeachers: (f) =>
    respond(
      () =>
        allTeachers().filter((t) => {
          if (f.q) {
            const hay = norm([t.name, t.headline, ...t.subjects.map(fx.subjectName)].join(" "));
            if (!norm(f.q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
          }
          if (f.subject && !t.subjects.includes(f.subject)) return false;
          if (f.level && !t.levels.includes(f.level)) return false;
          if (f.methodologies?.length && !f.methodologies.some((m) => t.methodologies.includes(m))) return false;
          if (f.periods?.length && !f.periods.some((p) => t.periods.includes(p))) return false;
          if (f.maxPriceCents && t.priceCents > f.maxPriceCents) return false;
          return true;
        }),
      { list: true },
    ),

  getTeacher: (id) => respond(() => findTeacher(id)),

  listTeacherSlots: (teacherId) =>
    respond(
      () => {
        refreshExpirations();
        return freeSlots(findTeacher(teacherId));
      },
      { list: true },
    ),

  matchTeachers: (request) =>
    respond(
      () =>
        allTeachers()
          .map((t) => scoreTeacher(t, request))
          .filter((m): m is MatchResult => m !== null)
          .sort((a, b) => b.score - a.score || a.teacher.priceCents - b.teacher.priceCents || a.teacher.name.localeCompare(b.teacher.name)),
      { list: true },
    ),

  /** Solicita a reserva: a aula nasce "aguardando pagamento" e ocupa o horário. */
  createBooking: (input) =>
    respond(
      () => {
        refreshExpirations();
        const teacher = findTeacher(input.teacherId);
        if (!teacher.subjects.includes(input.subject)) {
          throw new ApiError("http", "Este professor não ensina a disciplina escolhida.", { status: 422 });
        }
        const slot = candidateSlots(teacher).find((s) => s.id === input.slotId);
        if (!slot || slot.start <= nowIso()) throw conflict("Este horário não está mais disponível. Escolha outro.");
        if (db.lessons.some((l) => isActive(l) && l.teacherId === teacher.id && fx.overlaps(l, slot))) {
          throw conflict("Este horário acabou de ser reservado. Escolha outro.");
        }
        const clash = studentLessons().find((l) => isActive(l) && fx.overlaps(l, slot));
        if (clash) {
          throw conflict(`Você já tem uma aula neste horário (${fx.subjectName(clash.subject)} com ${clash.teacherName}).`);
        }
        const student = fx.STUDENT_PROFILES[fx.DEMO_STUDENT_ID];
        const created: Lesson = {
          id: `l-${Date.now().toString(36)}`,
          teacherId: teacher.id,
          teacherName: teacher.name,
          studentId: fx.DEMO_STUDENT_ID,
          studentName: fx.DEMO_STUDENT_NAME,
          subject: input.subject,
          topic: input.topic,
          start: slot.start,
          end: slot.end,
          status: "pending_payment",
          priceCents: teacher.priceCents,
          meeting: { provider: "google_meet", joinUrl: null, status: "not_connected" },
          payment: null,
          calendarSync: "not_synced",
          studentLevel: student?.level,
          studentGoal: student?.goal,
        };
        db.lessons.push(created);
        persist();
        return created;
      },
      { write: true },
    ),

  getLesson: (id) =>
    respond(() => {
      refreshExpirations();
      return visibleLesson(id);
    }),

  listStudentLessons: () =>
    respond(
      () => {
        refreshExpirations();
        return studentLessons();
      },
      { list: true },
    ),

  cancelLesson: (id) =>
    respond(
      () => {
        refreshExpirations();
        const l = db.lessons.find((x) => x.id === id);
        if (!l) throw new ApiError("http", "Aula não encontrada.", { status: 404 });
        if (!isActive(l) || l.start <= nowIso()) throw conflict("Esta aula não pode mais ser cancelada.");
        if (l.status === "pending_payment") {
          // Sem pagamento: as cobranças abertas são canceladas.
          db.checkouts
            .filter((c) => c.lessonId === l.id && ["creating", "pending", "failed"].includes(c.status))
            .forEach((c) => (c.status = "cancelled"));
        }
        // Aula paga: o pagamento continua "confirmado"; reembolso não é processado na demonstração.
        l.status = "cancelled";
        l.cancellationReason = readSession()?.role === "teacher" ? "teacher" : "student";
        syncLessonPayment(l);
        persist();
        return l;
      },
      { write: true },
    ),

  getCheckout: (lessonId) =>
    respond(() => {
      refreshExpirations();
      visibleLesson(lessonId);
      return latestCheckout(lessonId);
    }),

  /** Cria a cobrança Pix da reserva. Idempotente: devolve a cobrança aberta, se houver. */
  createCheckout: (lessonId) =>
    respond(
      () => {
        refreshExpirations();
        const lesson = visibleLesson(lessonId);
        const current = latestCheckout(lessonId);
        if (current && ["creating", "pending", "processing"].includes(current.status)) return current;
        if (current?.status === "confirmed") throw conflict("Esta aula já está paga.");
        if (lesson.status !== "pending_payment") throw conflict("Esta reserva não está aguardando pagamento.");
        const created: Checkout = {
          id: `ck-${Date.now().toString(36)}`,
          lessonId,
          status: "pending",
          method: "pix",
          gateway: "abacatepay",
          amountCents: lesson.priceCents,
          createdAt: nowIso(),
          expiresAt: new Date(Date.now() + DEMO_CHECKOUT_MINUTES * 60_000).toISOString(),
          // Demonstração: sem QR Code nem Copia e Cola — nenhum payload Pix é inventado.
          pix: { qrCodeImageUrl: null, copyPasteCode: null },
          simulated: true,
        };
        db.checkouts.push(created);
        syncLessonPayment(lesson);
        persist();
        return created;
      },
      { write: true },
    ),

  /** Somente demonstração: simula o retorno do gateway. Nenhuma chamada externa. */
  simulatePayment: async (checkoutId, outcome) => {
    await sleep(300);
    if (demoMode() === "erro") throw new ApiError("network", "Falha simulada (modo ?demo=erro).");
    refreshExpirations();
    const c = db.checkouts.find((x) => x.id === checkoutId);
    if (!c) throw new ApiError("http", "Cobrança não encontrada.", { status: 404 });
    const lesson = db.lessons.find((l) => l.id === c.lessonId)!;
    if (c.status === "confirmed") throw conflict("Este pagamento já foi confirmado.");
    if (c.status === "processing") throw conflict("Este pagamento já está em processamento.");
    if (c.status !== "pending") throw conflict("Esta cobrança não pode mais ser paga.");

    if (outcome === "expired") {
      expireCheckout(c);
    } else if (outcome === "failed") {
      c.status = "failed";
      c.failureReason = "Pagamento não autorizado (simulação).";
      syncLessonPayment(lesson);
    } else {
      // Confirmação: passa por "em processamento" antes de confirmar.
      c.status = "processing";
      syncLessonPayment(lesson);
      persist();
      await sleep(1200);
      if (lesson.status !== "pending_payment") {
        c.status = "cancelled";
      } else {
        c.status = "confirmed";
        c.confirmedAt = nowIso();
        lesson.status = "scheduled";
        // Confirmada: aguarda o link que a API criará no Google Meet (nunca inventado aqui).
        lesson.meeting = { provider: "google_meet", joinUrl: null, status: "awaiting_link" };
      }
      syncLessonPayment(lesson);
    }
    persist();
    return clone(c);
  },

  getStudentProgress: () => respond(fx.studentProgress),

  getTeacherDashboard: () =>
    respond(() => {
      refreshExpirations();
      const now = Date.now();
      const weekAhead = now + 7 * 86_400_000;
      const mine = teacherLessons();
      const upcoming = mine
        .filter((l) => l.status === "scheduled" && new Date(l.end).getTime() > now)
        .sort((a, b) => a.start.localeCompare(b.start));
      const earnings = buildEarnings(mine);
      const id = actingTeacherId();
      return {
        lessonsThisWeek: upcoming.filter((l) => new Date(l.start).getTime() < weekAhead).length,
        nextLesson: upcoming[0] ?? null,
        estimatedBalanceCents: earnings.confirmed.estimatedBalanceCents,
        awaitingPaymentCents: earnings.awaitingPaymentCents,
        profileChecklist: [
          { id: "profile" as const, label: "Perfil profissional", done: Boolean(db.profiles[id]?.bio) },
          { id: "specialties" as const, label: "Especialidades", done: (db.specialties[id] ?? []).length > 0 },
          { id: "availability" as const, label: "Disponibilidade semanal", done: (db.availability[id] ?? []).some((d) => d.enabled) },
        ],
      };
    }),

  getTeacherProfile: () => respond(() => db.profiles[actingTeacherId()]),
  saveTeacherProfile: (profile) =>
    respond(
      () => {
        const id = actingTeacherId();
        db.profiles[id] = clone(profile);
        db.lessons.forEach((l) => l.teacherId === id && (l.teacherName = profile.name));
        persist();
        return db.profiles[id];
      },
      { write: true },
    ),

  listSpecialties: () => respond(() => db.specialties[actingTeacherId()] ?? [], { list: true }),
  saveSpecialties: (items) =>
    respond(
      () => {
        const id = actingTeacherId();
        db.specialties[id] = clone(items);
        persist();
        return db.specialties[id];
      },
      { write: true },
    ),

  getAvailability: () => respond(() => db.availability[actingTeacherId()]),
  saveAvailability: (value) =>
    respond(
      () => {
        const id = actingTeacherId();
        db.availability[id] = clone(value);
        persist();
        return db.availability[id];
      },
      { write: true },
    ),

  listBlockedDates: () => respond(() => db.blockedDates[actingTeacherId()] ?? []),
  setDateBlocked: (date, blocked) =>
    respond(
      () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError("http", "Data inválida.", { status: 422 });
        const id = actingTeacherId();
        const set = new Set(db.blockedDates[id] ?? []);
        if (blocked) set.add(date);
        else set.delete(date);
        db.blockedDates[id] = [...set].sort();
        persist();
        return db.blockedDates[id];
      },
      { write: true },
    ),

  listTeacherLessons: () =>
    respond(
      () => {
        refreshExpirations();
        return teacherLessons();
      },
      { list: true },
    ),

  getEarnings: () =>
    respond(() => {
      refreshExpirations();
      const e = buildEarnings(teacherLessons());
      return demoMode() === "vazio"
        ? { ...e, items: [], awaitingPaymentCents: 0, confirmed: { ...e.confirmed, grossCents: 0, commissionCents: 0, teacherShareCents: 0, estimatedBalanceCents: 0 } }
        : e;
    }),

  getCommissionProgram: () =>
    respond((): CommissionProgram => {
      const mine = teacherLessons();
      const completed = mine.filter((l) => l.status === "completed").sort((a, b) => a.start.localeCompare(b.start));
      const now = new Date();
      const completedThisMonth = completed.filter((l) => {
        const d = new Date(l.start);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length;
      const id = actingTeacherId();
      const profileDone = Boolean(db.profiles[id]?.bio) && (db.specialties[id] ?? []).length > 0;
      return {
        standardBps: STANDARD_COMMISSION_BPS,
        // Nenhuma faixa de desconto foi aprovada: a comissão atual é a padrão.
        currentBps: STANDARD_COMMISSION_BPS,
        activeBenefits: [],
        savingsCents: 0,
        illustrative: true,
        goals: [
          { id: "g-aulas", title: "Aulas concluídas no mês", current: completedThisMonth, target: 20, unit: "aulas", reward: "Benefício a definir" },
          { id: "g-perfil", title: "Perfil completo", current: profileDone ? 1 : 0, target: 1, unit: "etapa", reward: "Destaque a definir" },
        ],
        achievements: [
          { id: "a-primeira", title: "Primeira aula concluída", date: completed[0]?.start ?? null, achieved: completed.length > 0 },
          { id: "a-perfil", title: "Perfil profissional completo", date: null, achieved: profileDone },
          { id: "a-cinco", title: "5 aulas concluídas", date: completed[4]?.start ?? null, achieved: completed.length >= 5 },
        ],
      };
    }),

  getReferralProgram: () =>
    respond((): ReferralProgram => {
      const t = findTeacher(actingTeacherId());
      return {
        code: `DEMO-${norm(firstName(t.name)).toUpperCase()}`,
        shareUrl: null,
        // Números sintéticos de exemplo: não há indicações reais nem recompensa por cadastro.
        invited: 3,
        qualified: 1,
        goals: [{ id: "r-3", title: "Indicações qualificadas", current: 1, target: 3, reward: "Recompensa a definir" }],
        rewardsEarned: [],
        rewardsPending: [
          {
            id: "rp-1",
            title: "Indicação de exemplo",
            reason: "Aguardando validação: o critério de qualificação ainda será definido (ex.: primeira aula paga concluída).",
          },
        ],
        illustrative: true,
      };
    }),

  getCalendarConnection: () => respond(() => db.calendar),

  /** Somente demonstração: alterna uma conexão SIMULADA (nenhuma conta Google é acessada). */
  setCalendarConnection: (connected) =>
    respond(
      () => {
        db.calendar = { status: connected ? "connected" : "disconnected", simulated: true };
        if (!connected) db.lessons.forEach((l) => l.calendarSync === "synced" && (l.calendarSync = "not_synced"));
        persist();
        return db.calendar;
      },
      { write: true },
    ),

  /** Sincroniza a aula com o Google Agenda — na demonstração, apenas simulado. */
  syncLessonToCalendar: async (lessonId, opts) => {
    await sleep(900);
    if (demoMode() === "erro") throw new ApiError("network", "Falha simulada (modo ?demo=erro).");
    const lesson = visibleLesson(lessonId);
    if (db.calendar.status !== "connected") throw conflict("Conecte o Google Agenda antes de sincronizar.");
    if (lesson.status !== "scheduled") throw conflict("Só aulas confirmadas podem ser adicionadas à agenda.");
    lesson.calendarSync = opts?.simulateFailure ? "failed" : "synced";
    persist();
    return clone(lesson);
  },
};
