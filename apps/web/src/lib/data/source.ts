import type {
  BookingInput,
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
import { httpDataSource } from "./http/adapter";
import { mockDataSource } from "./mock/adapter";

/**
 * Contrato interno entre as telas e a origem dos dados.
 * As telas dependem SOMENTE desta interface — nunca de fixtures ou do fetch.
 */
export interface DataSource {
  readonly kind: "mock" | "api";

  health(): Promise<HealthResponse>;

  // Aluno
  listSubjects(): Promise<Subject[]>;
  searchTeachers(filters: TeacherFilters): Promise<Teacher[]>;
  getTeacher(id: string): Promise<Teacher>;
  listTeacherSlots(teacherId: string): Promise<TimeSlot[]>;
  matchTeachers(request: MatchRequest): Promise<MatchResult[]>;
  createBooking(input: BookingInput): Promise<Lesson>;
  listStudentLessons(): Promise<Lesson[]>;
  cancelLesson(id: string): Promise<Lesson>;
  getStudentProgress(): Promise<LearningProgress>;

  // Professor
  getTeacherDashboard(): Promise<TeacherDashboard>;
  getTeacherProfile(): Promise<TeacherProfile>;
  saveTeacherProfile(profile: TeacherProfile): Promise<TeacherProfile>;
  listSpecialties(): Promise<Specialty[]>;
  saveSpecialties(items: Specialty[]): Promise<Specialty[]>;
  getAvailability(): Promise<WeeklyAvailability>;
  saveAvailability(value: WeeklyAvailability): Promise<WeeklyAvailability>;
  listTeacherLessons(): Promise<Lesson[]>;
  getEarnings(): Promise<EarningsSummary>;
}

/**
 * VITE_DATA_SOURCE=mock (padrão) usa dados sintéticos de demonstração.
 * VITE_DATA_SOURCE=api usa a API real (somente o que já existe no backend).
 */
export const DATA_SOURCE_KIND: DataSource["kind"] = import.meta.env.VITE_DATA_SOURCE === "api" ? "api" : "mock";

export const dataSource: DataSource = DATA_SOURCE_KIND === "api" ? httpDataSource : mockDataSource;

export const isDemo = dataSource.kind === "mock";
