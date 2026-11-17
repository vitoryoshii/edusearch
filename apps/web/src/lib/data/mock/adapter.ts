/**
 * Adapter de DEMONSTRAÇÃO: simula a API em memória, com latência artificial.
 * Nada é enviado a servidores; o estado volta ao inicial ao recarregar a página.
 *
 * Para revisar estados de erro e vazio sem backend, adicione à URL:
 *   ?demo=erro   → todas as leituras falham
 *   ?demo=vazio  → listas retornam vazias
 */
import { ApiError } from "../../api/client";
import type {
  Lesson,
  MatchRequest,
  MatchResult,
  Specialty,
  Teacher,
  TeacherFilters,
  TeacherProfile,
  WeeklyAvailability,
} from "../../api/types";
import { LEVEL_LABELS, METHODOLOGY_LABELS, PERIOD_LABELS, formatMoney } from "../../format";
import type { DataSource } from "../source";
import * as fx from "./fixtures";

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
  await new Promise((r) => setTimeout(r, write ? 650 : 300 + Math.random() * 350));
  const mode = demoMode();
  if (mode === "erro") throw new ApiError("network", "Falha simulada (modo ?demo=erro).");
  const result = typeof value === "function" ? (value as () => T)() : value;
  if (mode === "vazio" && list && Array.isArray(result)) return [] as T;
  return clone(result);
}

/* ------------------------------ Estado em memória ------------------------------ */

const db = {
  studentLessons: fx.initialStudentLessons(),
  teacherLessons: fx.initialTeacherLessons(),
  profile: clone(fx.teacherProfile),
  specialties: clone(fx.specialties),
  availability: clone(fx.availability),
  bookedSlots: new Set<string>(),
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function findTeacher(id: string): Teacher {
  const t = fx.teachers.find((x) => x.id === id);
  if (!t) throw new ApiError("http", "Professor não encontrado.", { status: 404 });
  return t;
}

function filterTeachers(f: TeacherFilters): Teacher[] {
  return fx.teachers.filter((t) => {
    if (f.q) {
      const hay = norm([t.name, t.headline, ...t.subjects.map(fx.subjectName)].join(" "));
      if (!norm(f.q).split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    if (f.subject && !t.subjects.includes(f.subject)) return false;
    if (f.level && !t.levels.includes(f.level)) return false;
    if (f.methodologies?.length && !f.methodologies.some((m) => t.methodologies.includes(m))) return false;
    if (f.periods?.length && !f.periods.some((p) => t.periods.includes(p))) return false;
    if (f.maxPriceCents && t.priceCents > f.maxPriceCents) return false;
    return true;
  });
}

/** Pontuação heurística local. Substitui o Gemini apenas na demonstração. */
function scoreTeacher(t: Teacher, r: MatchRequest): MatchResult | null {
  if (!t.subjects.includes(r.subject)) return null;
  let score = 45;
  const reasons = [`Ensina ${fx.subjectName(r.subject)}`];

  if (t.levels.includes(r.level)) {
    score += 20;
    reasons.push(`Experiência com ${LEVEL_LABELS[r.level].toLowerCase()}`);
  }
  const meth = r.methodologies.filter((m) => t.methodologies.includes(m));
  if (meth.length) {
    score += 15;
    reasons.push(`Metodologia: ${meth.map((m) => METHODOLOGY_LABELS[m].toLowerCase()).join(", ")}`);
  }
  const per = r.periods.filter((p) => t.periods.includes(p));
  if (per.length) {
    score += 10;
    reasons.push(`Horários de ${per.map((p) => PERIOD_LABELS[p].toLowerCase()).join(" e ")}`);
  }
  if (!r.maxPriceCents || t.priceCents <= r.maxPriceCents) {
    score += 10;
    reasons.push(`${formatMoney(t.priceCents)} por aula, dentro do orçamento`);
  }
  return { teacher: t, score: Math.min(score, 98), reasons };
}

export const mockDataSource: DataSource = {
  kind: "mock",

  health: () => respond({ status: "ok" as const, service: "edusearch-demo", version: "demo" }),

  listSubjects: () => respond(fx.subjects, { list: true }),
  searchTeachers: (filters) => respond(() => filterTeachers(filters), { list: true }),
  getTeacher: (id) => respond(() => findTeacher(id)),
  listTeacherSlots: (teacherId) =>
    respond(() => fx.generateSlots(findTeacher(teacherId)).filter((s) => !db.bookedSlots.has(s.id)), { list: true }),

  matchTeachers: (request) =>
    respond(
      () =>
        fx.teachers
          .map((t) => scoreTeacher(t, request))
          .filter((m): m is MatchResult => m !== null)
          .sort((a, b) => b.score - a.score),
      { list: true },
    ),

  createBooking: (input) =>
    respond(
      () => {
        const teacher = findTeacher(input.teacherId);
        const slot = fx.generateSlots(teacher).find((s) => s.id === input.slotId);
        if (!slot || db.bookedSlots.has(slot.id)) {
          throw new ApiError("http", "Este horário não está mais disponível.", { status: 409 });
        }
        db.bookedSlots.add(slot.id);
        const created: Lesson = {
          id: `l-${Date.now()}`,
          teacherId: teacher.id,
          teacherName: teacher.name,
          studentName: fx.DEMO_STUDENT_NAME,
          subject: input.subject,
          topic: input.topic,
          start: slot.start,
          end: slot.end,
          status: "scheduled",
          priceCents: teacher.priceCents,
          meetingUrl: null,
        };
        db.studentLessons.unshift(created);
        return created;
      },
      { write: true },
    ),

  listStudentLessons: () => respond(() => db.studentLessons, { list: true }),

  cancelLesson: (id) =>
    respond(
      () => {
        const l = db.studentLessons.find((x) => x.id === id) ?? db.teacherLessons.find((x) => x.id === id);
        if (!l) throw new ApiError("http", "Aula não encontrada.", { status: 404 });
        l.status = "cancelled";
        return l;
      },
      { write: true },
    ),

  getStudentProgress: () => respond(fx.studentProgress),

  getTeacherDashboard: () =>
    respond(() => {
      const now = Date.now();
      const weekAhead = now + 7 * 86_400_000;
      const upcoming = db.teacherLessons
        .filter((l) => l.status === "scheduled" && new Date(l.end).getTime() > now)
        .sort((a, b) => a.start.localeCompare(b.start));
      return {
        lessonsThisWeek: upcoming.filter((l) => new Date(l.start).getTime() < weekAhead).length,
        nextLesson: upcoming[0] ?? null,
        expectedMonthCents: fx.buildEarnings(db.teacherLessons).netCents,
        profileChecklist: [
          { id: "profile" as const, label: "Perfil profissional", done: Boolean(db.profile.bio) },
          { id: "specialties" as const, label: "Especialidades", done: db.specialties.length > 0 },
          { id: "availability" as const, label: "Disponibilidade semanal", done: db.availability.some((d) => d.enabled) },
        ],
      };
    }),

  getTeacherProfile: () => respond(() => db.profile),
  saveTeacherProfile: (profile: TeacherProfile) =>
    respond(
      () => {
        db.profile = clone(profile);
        return db.profile;
      },
      { write: true },
    ),

  listSpecialties: () => respond(() => db.specialties, { list: true }),
  saveSpecialties: (items: Specialty[]) =>
    respond(
      () => {
        db.specialties = clone(items);
        return db.specialties;
      },
      { write: true },
    ),

  getAvailability: () => respond(() => db.availability),
  saveAvailability: (value: WeeklyAvailability) =>
    respond(
      () => {
        db.availability = clone(value);
        return db.availability;
      },
      { write: true },
    ),

  listTeacherLessons: () => respond(() => db.teacherLessons, { list: true }),
  getEarnings: () =>
    respond(() => {
      const e = fx.buildEarnings(db.teacherLessons);
      return demoMode() === "vazio" ? { ...e, items: [], grossCents: 0, feeCents: 0, netCents: 0 } : e;
    }),
};
