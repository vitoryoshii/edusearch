/**
 * Modelos de dados do FRONTEND (view models).
 *
 * IMPORTANTE: não são o contrato oficial da API. Ainda não existe
 * docs/api-contract.md; quando existir, os adapters em src/lib/data/http
 * devem converter as respostas da API para estes tipos (ou estes tipos
 * devem ser ajustados). Ver docs/frontend/api-integration.md.
 *
 * Convenções: datas em ISO 8601 (UTC); valores monetários em centavos (BRL).
 */

export type Role = "student" | "teacher";

export type Level = "fundamental" | "medio" | "pre-vestibular" | "graduacao" | "concursos" | "livre";

export type Methodology = "pratica" | "teorica" | "exercicios" | "conversacao" | "projetos";

export type DayPeriod = "manha" | "tarde" | "noite";

/** Dificuldades declaradas pelo aluno no matching (lista fechada, explicável). */
export type Difficulty = "base" | "exercicios" | "pratica" | "fala" | "organizacao";

export type Subject = { id: string; name: string };

export type Teacher = {
  id: string;
  name: string;
  headline: string;
  bio: string;
  subjects: string[]; // ids de Subject
  levels: Level[];
  methodologies: Methodology[];
  periods: DayPeriod[];
  priceCents: number;
  lessonMinutes: number;
  education: string[];
  languages: string[];
};

export type TeacherFilters = {
  q?: string;
  subject?: string;
  level?: Level | "";
  methodologies?: Methodology[];
  periods?: DayPeriod[];
  maxPriceCents?: number;
};

export type TimeSlot = { id: string; teacherId: string; start: string; end: string };

export type LessonStatus = "scheduled" | "completed" | "cancelled";

export type Lesson = {
  id: string;
  teacherId: string;
  teacherName: string;
  studentId: string;
  studentName: string;
  subject: string; // id de Subject
  topic?: string;
  start: string;
  end: string;
  status: LessonStatus;
  priceCents: number;
  /** Link da videochamada (Google Meet) — será gerado pela API no futuro. */
  meetingUrl: string | null;
};

export type BookingInput = { teacherId: string; slotId: string; subject: string; topic?: string };

export type MatchRequest = {
  goal: string;
  subject: string;
  level: Level;
  methodologies: Methodology[];
  difficulties: Difficulty[];
  periods: DayPeriod[];
  maxPriceCents?: number;
};

export type MatchResult = {
  teacher: Teacher;
  /** 0–100. Na demonstração é calculado localmente, sem IA. */
  score: number;
  reasons: string[];
  /** Pontos de atenção (ex.: acima do orçamento). */
  cautions: string[];
};

export type LearningGoal = { id: string; title: string; done: number; total: number };

export type LearningProgress = {
  lessonsCompleted: number;
  minutesStudied: number;
  goals: LearningGoal[];
  notes: Array<{ id: string; date: string; teacherName: string; subject: string; text: string }>;
};

export type WeeklyAvailability = Array<{
  weekday: number; // 0 = domingo
  enabled: boolean;
  ranges: Array<{ start: string; end: string }>; // "HH:MM"
}>;

export type TeacherProfile = {
  name: string;
  headline: string;
  bio: string;
  education: string;
  priceCents: number;
  lessonMinutes: number;
  methodologies: Methodology[];
};

export type Specialty = { subject: string; levels: Level[] };

export type TeacherDashboard = {
  lessonsThisWeek: number;
  nextLesson: Lesson | null;
  expectedMonthCents: number;
  profileChecklist: Array<{ id: "profile" | "specialties" | "availability"; label: string; done: boolean }>;
};

export type EarningStatus = "expected" | "transferred";

export type EarningsSummary = {
  periodLabel: string;
  /** Hipótese de comissão da plataforma (10%), ainda não validada. */
  feeRate: number;
  grossCents: number;
  feeCents: number;
  netCents: number;
  items: Array<{
    id: string;
    date: string;
    studentName: string;
    subject: string;
    grossCents: number;
    feeCents: number;
    netCents: number;
    status: EarningStatus;
  }>;
};

export type HealthResponse = { status: "ok"; service: string; version: string };
