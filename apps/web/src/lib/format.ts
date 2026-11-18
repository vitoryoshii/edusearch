import type { DayPeriod, LessonStatus, Level, Methodology } from "./api/types";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatMoney = (cents: number) => brl.format(cents / 100);

const dateLong = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });
const dateShort = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
const dayMonth = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const formatDateLong = (iso: string) => cap(dateLong.format(new Date(iso)));
export const formatDateShort = (iso: string) => cap(dateShort.format(new Date(iso)).replace(/\./g, ""));
export const formatDayMonth = (iso: string) => dayMonth.format(new Date(iso));
export const formatTime = (iso: string) => time.format(new Date(iso));
export const formatTimeRange = (start: string, end: string) => `${formatTime(start)} – ${formatTime(end)}`;

export function formatMinutes(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const LEVEL_LABELS: Record<Level, string> = {
  fundamental: "Ensino fundamental",
  medio: "Ensino médio",
  "pre-vestibular": "Pré-vestibular / ENEM",
  graduacao: "Graduação",
  concursos: "Concursos",
  livre: "Curso livre",
};

export const METHODOLOGY_LABELS: Record<Methodology, string> = {
  pratica: "Aulas práticas",
  teorica: "Base teórica",
  exercicios: "Resolução de exercícios",
  conversacao: "Conversação",
  projetos: "Projetos",
};

export const PERIOD_LABELS: Record<DayPeriod, string> = {
  manha: "Manhã",
  tarde: "Tarde",
  noite: "Noite",
};

export const STATUS_LABELS: Record<LessonStatus, string> = {
  scheduled: "Agendada",
  completed: "Concluída",
  cancelled: "Cancelada",
};

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

export const options = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
