/**
 * Chamadas da conta REAL à API FastAPI (contrato oficial: docs/api-contract.md, Fase 2.6B).
 *
 * Usa o cliente único (`apiRequest`), que envia o access token da sessão do Supabase.
 * Nada aqui é usado pela demonstração (que segue com o mockDataSource).
 */
import { apiRequest } from "./client";
import type { DayPeriod, Difficulty, Level, Methodology } from "./types";

export type AccountRole = "student" | "teacher";
export type Weekday = "seg" | "ter" | "qua" | "qui" | "sex" | "sab" | "dom";
export type ApiModality = "online" | "presencial" | "hibrido";
export type ExperienceRange = "menos-1" | "1-3" | "3-5" | "5-mais";
export type VerificationStatus = "pending" | "approved" | "rejected";

export type Me = {
  id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
  status: "onboarding" | "active" | "suspended";
  roles: AccountRole[];
  onboarding: {
    student: { status: "pending" | "completed" } | null;
    teacher: { status: "pending" | "completed"; verification_status: VerificationStatus | null; is_published: boolean } | null;
  };
  created_at: string;
  updated_at: string;
};

export type StudentProfilePayload = {
  learning_goal: string;
  education_level: Level;
  subjects: string[];
  difficulty_areas: Difficulty[];
  preferred_weekdays: Weekday[];
  preferred_periods: DayPeriod[];
  preferred_modality: ApiModality;
  budget_min_cents: number | null;
  budget_max_cents: number | null;
};
export type StudentProfile = StudentProfilePayload & { created_at: string; updated_at: string };

export type TeacherProfilePayload = {
  headline?: string | null;
  bio: string;
  subjects: string[];
  specialties: string | null;
  academic_background: string;
  experience: ExperienceRange;
  teaching_methods: Methodology[];
  methodology: string | null;
  price_cents: number;
  lesson_durations_minutes: number[];
  modality: ApiModality;
  available_weekdays: Weekday[];
  available_periods: DayPeriod[];
};
export type TeacherProfile = TeacherProfilePayload & {
  lesson_duration_minutes: number;
  verification_status: VerificationStatus;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CatalogSubject = { slug: string; name: string };

export const accountApi = {
  me: (signal?: AbortSignal) => apiRequest<Me>("/v1/me", { signal }),
  selectRole: (role: AccountRole) => apiRequest<Me>("/v1/me/roles", { method: "POST", body: { role } }),
  updateProfile: (body: { display_name: string; avatar_url: string | null }) =>
    apiRequest<Me>("/v1/me/profile", { method: "PUT", body }),
  getStudentProfile: (signal?: AbortSignal) => apiRequest<StudentProfile>("/v1/me/student-profile", { signal }),
  saveStudentProfile: (body: StudentProfilePayload) => apiRequest<StudentProfile>("/v1/me/student-profile", { method: "PUT", body }),
  getTeacherProfile: (signal?: AbortSignal) => apiRequest<TeacherProfile>("/v1/me/teacher-profile", { signal }),
  saveTeacherProfile: (body: TeacherProfilePayload) => apiRequest<TeacherProfile>("/v1/me/teacher-profile", { method: "PUT", body }),
  subjects: (signal?: AbortSignal) => apiRequest<CatalogSubject[]>("/v1/subjects", { signal }),
};
