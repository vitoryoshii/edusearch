/**
 * Adapter de DEMONSTRAÇÃO: simula a API no navegador, com latência artificial.
 * Nada é enviado a servidores.
 *
 * Estado: um único "banco" em memória (aulas + perfil, especialidades e
 * disponibilidade de CADA professor fictício), espelhado no sessionStorage
 * para sobreviver a recarregamentos durante a sessão. Somente dados fictícios.
 *
 * Visão do professor: o professor "logado" vem da sessão de demonstração
 * (`teacherId`), do mesmo jeito que a API real vai identificá-lo pelo JWT.
 * Por isso a interface DataSource não recebe o id do professor.
 *
 * Regras de reserva (ver docs/frontend/demo-journey.md):
 *   - Horários = grade do professor nos próximos 7 dias − aulas já agendadas.
 *   - Não é possível reservar um horário ocupado (409) nem duas aulas
 *     sobrepostas para o mesmo aluno (409).
 *   - Cancelar uma aula futura libera o horário imediatamente.
 *
 * Para revisar estados sem backend, adicione à URL:
 *   ?demo=erro   → todas as operações falham
 *   ?demo=vazio  → listas retornam vazias
 */
import { ApiError } from "../../api/client";
import type {
  Difficulty,
  Lesson,
  MatchRequest,
  MatchResult,
  Methodology,
  Specialty,
  Teacher,
  TeacherProfile,
  WeeklyAvailability,
} from "../../api/types";
import { LEVEL_LABELS, METHODOLOGY_LABELS, PERIOD_LABELS, DIFFICULTY_LABELS, formatMoney } from "../../format";
import { DEMO_SESSION_KEY } from "../../demo";
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

async function respond<T>(value: T | (() => T), { list = false, write = false } = {}): Promise<T> {
  await new Promise((r) => setTimeout(r, write ? 600 : 250 + Math.random() * 300));
  const mode = demoMode();
  if (mode === "erro") throw new ApiError("network", "Falha simulada (modo ?demo=erro).");
  const result = typeof value === "function" ? (value as () => T)() : value;
  if (mode === "vazio" && list && Array.isArray(result)) return [] as T;
  return clone(result);
}

/* ------------------------------ Estado + persistência ------------------------------ */

const STORAGE_KEY = "edusearch-demo-data";
const STORAGE_VERSION = 3;

type DemoDb = {
  version: number;
  lessons: Lesson[];
  /** Dados editáveis por professor (chave = id do professor). */
  profiles: Record<string, TeacherProfile>;
  specialties: Record<string, Specialty[]>;
  availability: Record<string, WeeklyAvailability>;
};

function initialDb(): DemoDb {
  const byTeacher = <T,>(fn: (t: Teacher) => T) => Object.fromEntries(fx.teachers.map((t) => [t.id, fn(t)]));
  return {
    version: STORAGE_VERSION,
    lessons: fx.seedLessons(),
    profiles: byTeacher(fx.profileOf),
    specialties: byTeacher(fx.specialtiesOf),
    availability: byTeacher(fx.availabilityOf),
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

/* ------------------------------- Professores ------------------------------- */

/** Professor "logado" na visão de professor da demonstração. */
function actingTeacherId(): string {
  try {
    const s = JSON.parse(window.sessionStorage.getItem(DEMO_SESSION_KEY) ?? "null") as { role?: string; teacherId?: string } | null;
    if (s?.role === "teacher" && s.teacherId && fx.teachers.some((t) => t.id === s.teacherId)) return s.teacherId;
  } catch {
    /* sessão ausente ou inválida */
  }
  return fx.DEMO_TEACHER_ID;
}

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

const isActive = (l: Lesson) => l.status === "scheduled";

/** Horários livres = candidatos futuros − aulas agendadas do professor. */
function freeSlots(teacher: Teacher) {
  const now = new Date().toISOString();
  const weekly = db.availability[teacher.id] ?? fx.availabilityOf(teacher);
  const busy = db.lessons.filter((l) => l.teacherId === teacher.id && isActive(l));
  return fx.candidateSlots(teacher, weekly).filter((s) => s.start > now && !busy.some((l) => fx.overlaps(l, s)));
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

/* --------------------------------- Adapter --------------------------------- */

const studentLessons = () => db.lessons.filter((l) => l.studentId === fx.DEMO_STUDENT_ID);
const teacherLessons = () => {
  const id = actingTeacherId();
  return db.lessons.filter((l) => l.teacherId === id);
};

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

  listTeacherSlots: (teacherId) => respond(() => freeSlots(findTeacher(teacherId)), { list: true }),

  matchTeachers: (request) =>
    respond(
      () =>
        allTeachers()
          .map((t) => scoreTeacher(t, request))
          .filter((m): m is MatchResult => m !== null)
          .sort((a, b) => b.score - a.score || a.teacher.priceCents - b.teacher.priceCents || a.teacher.name.localeCompare(b.teacher.name)),
      { list: true },
    ),

  createBooking: (input) =>
    respond(
      () => {
        const teacher = findTeacher(input.teacherId);
        if (!teacher.subjects.includes(input.subject)) {
          throw new ApiError("http", "Este professor não ensina a disciplina escolhida.", { status: 422 });
        }
        const slot = fx.candidateSlots(teacher, db.availability[teacher.id] ?? fx.availabilityOf(teacher)).find((s) => s.id === input.slotId);
        if (!slot || slot.start <= new Date().toISOString()) {
          throw new ApiError("http", "Este horário não está mais disponível. Escolha outro.", { status: 409 });
        }
        if (db.lessons.some((l) => isActive(l) && l.teacherId === teacher.id && fx.overlaps(l, slot))) {
          throw new ApiError("http", "Este horário acabou de ser reservado. Escolha outro.", { status: 409 });
        }
        const clash = studentLessons().find((l) => isActive(l) && fx.overlaps(l, slot));
        if (clash) {
          throw new ApiError("http", `Você já tem uma aula neste horário (${fx.subjectName(clash.subject)} com ${clash.teacherName}).`, { status: 409 });
        }
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
          status: "scheduled",
          priceCents: teacher.priceCents,
          meetingUrl: null,
        };
        db.lessons.push(created);
        persist();
        return created;
      },
      { write: true },
    ),

  listStudentLessons: () => respond(studentLessons, { list: true }),

  cancelLesson: (id) =>
    respond(
      () => {
        const l = db.lessons.find((x) => x.id === id);
        if (!l) throw new ApiError("http", "Aula não encontrada.", { status: 404 });
        if (l.status !== "scheduled" || l.start <= new Date().toISOString()) {
          throw new ApiError("http", "Esta aula não pode mais ser cancelada.", { status: 409 });
        }
        l.status = "cancelled";
        persist();
        return l;
      },
      { write: true },
    ),

  getStudentProgress: () => respond(fx.studentProgress),

  getTeacherDashboard: () =>
    respond(() => {
      const now = Date.now();
      const weekAhead = now + 7 * 86_400_000;
      const upcoming = teacherLessons()
        .filter((l) => isActive(l) && new Date(l.end).getTime() > now)
        .sort((a, b) => a.start.localeCompare(b.start));
      return {
        lessonsThisWeek: upcoming.filter((l) => new Date(l.start).getTime() < weekAhead).length,
        nextLesson: upcoming[0] ?? null,
        expectedMonthCents: fx.buildEarnings(teacherLessons()).netCents,
        profileChecklist: (() => {
          const id = actingTeacherId();
          return [
            { id: "profile" as const, label: "Perfil profissional", done: Boolean(db.profiles[id]?.bio) },
            { id: "specialties" as const, label: "Especialidades", done: (db.specialties[id] ?? []).length > 0 },
            { id: "availability" as const, label: "Disponibilidade semanal", done: (db.availability[id] ?? []).some((d) => d.enabled) },
          ];
        })(),
      };
    }),

  getTeacherProfile: () => respond(() => db.profiles[actingTeacherId()]),
  saveTeacherProfile: (profile) =>
    respond(
      () => {
        const id = actingTeacherId();
        db.profiles[id] = clone(profile);
        // Mantém o nome exibido nas aulas já existentes coerente com o perfil.
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

  listTeacherLessons: () => respond(teacherLessons, { list: true }),

  getEarnings: () =>
    respond(() => {
      const e = fx.buildEarnings(teacherLessons());
      return demoMode() === "vazio" ? { ...e, items: [], grossCents: 0, feeCents: 0, netCents: 0 } : e;
    }),
};
