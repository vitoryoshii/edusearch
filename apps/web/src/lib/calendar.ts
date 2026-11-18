/**
 * Utilitários de calendário (datas locais, semana começando na segunda-feira).
 * Puros e sem dependências: usados pelas telas de agenda do aluno e do professor.
 */
import type { Lesson, WeeklyAvailability } from "./api/types";

/** YYYY-MM-DD no horário local. */
export function dateKey(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

/** Converte "YYYY-MM-DD" em Date ao meio-dia local (evita problemas de fuso). */
export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export const todayKey = () => dateKey(new Date());

export function addDays(key: string, days: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

export function addMonths(key: string, months: number): string {
  const d = fromKey(key);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return dateKey(d);
}

/** Segunda-feira da semana da data. */
export function startOfWeek(key: string): string {
  const d = fromKey(key);
  const diff = (d.getDay() + 6) % 7;
  return addDays(key, -diff);
}

export const weekDays = (key: string) => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(key), i));

/** Grade do mês: semanas completas (seg–dom) que cobrem o mês da data. */
export function monthGrid(key: string): string[] {
  const d = fromKey(key);
  const first = dateKey(new Date(d.getFullYear(), d.getMonth(), 1, 12));
  const last = dateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
  const days: string[] = [];
  for (let k = startOfWeek(first); k <= last || days.length % 7 !== 0; k = addDays(k, 1)) days.push(k);
  return days;
}

export const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", opts);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const monthLabel = (key: string) => cap(fmt({ month: "long", year: "numeric" }).format(fromKey(key)));
export const weekLabel = (key: string) => {
  const days = weekDays(key);
  const f = fmt({ day: "numeric", month: "short" });
  return `${f.format(fromKey(days[0])).replace(".", "")} – ${f.format(fromKey(days[6])).replace(".", "")}`;
};
export const dayLabelLong = (key: string) => cap(fmt({ weekday: "long", day: "numeric", month: "long" }).format(fromKey(key)));
export const weekdayShort = (key: string) => cap(fmt({ weekday: "short" }).format(fromKey(key)).replace(".", ""));
export const WEEKDAY_HEADERS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"] as const;

/** Aulas de um dia, ordenadas por horário. */
export const lessonsOn = (lessons: Lesson[], key: string) =>
  lessons.filter((l) => dateKey(l.start) === key).sort((a, b) => a.start.localeCompare(b.start));

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Conflito de reserva: aula ativa em um dia bloqueado ou fora da grade semanal
 * atual do professor (ex.: a grade foi reduzida depois da reserva).
 */
export function conflictReason(lesson: Lesson, weekly: WeeklyAvailability | undefined, blocked: Set<string>): string | null {
  if (lesson.status !== "scheduled" && lesson.status !== "pending_payment") return null;
  const key = dateKey(lesson.start);
  if (blocked.has(key)) return "Aula marcada em um dia bloqueado";
  if (!weekly) return null;
  const s = new Date(lesson.start);
  const e = new Date(lesson.end);
  const day = weekly.find((w) => w.weekday === s.getDay());
  const startMin = s.getHours() * 60 + s.getMinutes();
  const endMin = e.getHours() * 60 + e.getMinutes();
  const fits = day?.enabled && day.ranges.some((r) => minutes(r.start) <= startMin && endMin <= minutes(r.end));
  return fits ? null : "Aula fora da disponibilidade atual";
}
