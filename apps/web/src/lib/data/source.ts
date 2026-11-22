import type {
  BookingInput,
  CalendarConnection,
  Checkout,
  CommissionProgram,
  ReferralProgram,
  EarningsSummary,
  HealthResponse,
  LearningProgress,
  Lesson,
  MatchRequest,
  MatchResult,
  Specialty,
  Subject,
  Teacher,
  TeacherDashboard,
  TeacherFilters,
  TeacherProfile,
  TimeSlot,
  WeeklyAvailability,
} from "../api/types";
import { mockDataSource } from "./mock/adapter";

/**
 * Contrato interno entre as telas e a origem dos dados.
 * As telas dependem SOMENTE desta interface — nunca de fixtures ou do fetch.
 */
export interface DataSource {
  readonly kind: "mock" | "api";

  /** Somente na demonstração: volta os dados fictícios ao estado inicial. */
  resetDemoData?(): Promise<void>;

  health(): Promise<HealthResponse>;

  // Aluno
  listSubjects(): Promise<Subject[]>;
  searchTeachers(filters: TeacherFilters): Promise<Teacher[]>;
  getTeacher(id: string): Promise<Teacher>;
  listTeacherSlots(teacherId: string): Promise<TimeSlot[]>;
  matchTeachers(request: MatchRequest): Promise<MatchResult[]>;
  /** Solicita a reserva: a aula nasce "aguardando pagamento". */
  createBooking(input: BookingInput): Promise<Lesson>;
  /** Aula visível ao usuário atual (aluno ou professor). */
  getLesson(id: string): Promise<Lesson>;
  listStudentLessons(): Promise<Lesson[]>;
  cancelLesson(id: string): Promise<Lesson>;
  getStudentProgress(): Promise<LearningProgress>;

  // Pagamentos (Pix via AbacatePay, orquestrado pela API)
  /** Cobrança mais recente da aula, ou null se ainda não existir. */
  getCheckout(lessonId: string): Promise<Checkout | null>;
  /** Cria (ou devolve a aberta) cobrança Pix da reserva. Idempotente. */
  createCheckout(lessonId: string): Promise<Checkout>;
  /** Somente demonstração: simula o retorno do gateway (sem chamada externa). */
  simulatePayment?(checkoutId: string, outcome: "confirmed" | "failed" | "expired"): Promise<Checkout>;

  // Google Agenda (OAuth e eventos ficam no backend)
  getCalendarConnection(): Promise<CalendarConnection>;
  /** Somente demonstração: alterna uma conexão simulada. Na API real, o fluxo OAuth será outro. */
  setCalendarConnection?(connected: boolean): Promise<CalendarConnection>;
  syncLessonToCalendar(lessonId: string, opts?: { simulateFailure?: boolean }): Promise<Lesson>;

  // Professor
  getTeacherDashboard(): Promise<TeacherDashboard>;
  getTeacherProfile(): Promise<TeacherProfile>;
  saveTeacherProfile(profile: TeacherProfile): Promise<TeacherProfile>;
  listSpecialties(): Promise<Specialty[]>;
  saveSpecialties(items: Specialty[]): Promise<Specialty[]>;
  getAvailability(): Promise<WeeklyAvailability>;
  saveAvailability(value: WeeklyAvailability): Promise<WeeklyAvailability>;
  listTeacherLessons(): Promise<Lesson[]>;
  /** Dias bloqueados (YYYY-MM-DD) do professor atual. */
  listBlockedDates(): Promise<string[]>;
  setDateBlocked(date: string, blocked: boolean): Promise<string[]>;
  getEarnings(): Promise<EarningsSummary>;
  /** Comissão e incentivos (cálculo oficial no backend; regras de desconto ainda não aprovadas). */
  getCommissionProgram(): Promise<CommissionProgram>;
  getReferralProgram(): Promise<ReferralProgram>;
}

/**
 * Origem de dados da DEMONSTRAÇÃO (/aluno, /professor): SEMPRE dados fictícios, isolados da conta
 * real. O produto real (/conta) usa os clientes da API (lib/api/account.ts e lib/api/scheduling.ts),
 * nunca esta interface.
 *
 * Antes (até a Fase 3A), VITE_DATA_SOURCE=api ligava aqui um adapter HTTP sem nenhum método
 * implementado: em produção a demonstração inteira mostrava "recurso indisponível" e não exibia o
 * aviso de dados fictícios. A variável não tem mais efeito.
 */
export const dataSource: DataSource = mockDataSource;

export const isDemo = dataSource.kind === "mock";
