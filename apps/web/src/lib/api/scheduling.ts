/**
 * Agenda real (Fase 3A) — contrato em docs/api-contract.md ("Agenda e Google Agenda/Meet").
 *
 * Nenhum token do Google passa pelo navegador: o app só recebe a URL de consentimento, repassa o
 * código de autorização à API e mostra o estado da conexão. Aulas são sempre de TESTE (sem preço).
 */
import { apiRequest } from "./client";
import type { AvailabilityWindow } from "../scheduling";

export type CalendarStatus = "not_configured" | "not_connected" | "connected" | "revoked";
export type SyncStatus = "not_connected" | "pending" | "synced" | "failed" | "removed";

export type SchedulingStatus = {
  stage: "off" | "testing";
  calendar_configured: boolean;
  payments_enabled: false;
  commercial_lessons_enabled: false;
};

export type CalendarConnection = { status: CalendarStatus; connected_at: string | null; revoked_at: string | null };

export type BookableTeacher = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  headline: string | null;
  subjects: string[];
  lesson_durations_minutes: number[];
  modality: string | null;
};

export type Lesson = {
  id: string;
  role: "teacher" | "student";
  teacher: { id: string; display_name: string | null };
  student: { id: string; display_name: string | null };
  subject: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "cancelled";
  is_test: true;
  calendar_sync_status: SyncStatus;
  meet_url: string | null;
  cancelled_at: string | null;
  cancelled_by_role: "teacher" | "student" | null;
  created_at: string;
};

export type LessonRequest = {
  teacher_id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  idempotency_key: string;
};

export const schedulingApi = {
  status: (signal?: AbortSignal) => apiRequest<SchedulingStatus>("/v1/scheduling/status", { signal }),
  calendar: (signal?: AbortSignal) => apiRequest<CalendarConnection>("/v1/me/google-calendar", { signal }),
  startAuthorization: () => apiRequest<{ authorization_url: string }>("/v1/me/google-calendar/authorization", { method: "POST" }),
  completeAuthorization: (body: { code: string; state: string }) =>
    apiRequest<CalendarConnection>("/v1/me/google-calendar/connection", { method: "POST", body }),
  disconnect: () => apiRequest<CalendarConnection>("/v1/me/google-calendar", { method: "DELETE" }),
  availability: (signal?: AbortSignal) =>
    apiRequest<{ timezone: string; windows: AvailabilityWindow[] }>("/v1/me/availability", { signal }),
  saveAvailability: (windows: AvailabilityWindow[]) =>
    apiRequest<{ timezone: string; windows: AvailabilityWindow[] }>("/v1/me/availability", { method: "PUT", body: { windows } }),
  teachers: (signal?: AbortSignal) => apiRequest<BookableTeacher[]>("/v1/teachers", { signal }),
  slots: (teacherId: string, duration: number, signal?: AbortSignal) =>
    apiRequest<{ duration_minutes: number; slots: string[] }>(`/v1/teachers/${encodeURIComponent(teacherId)}/slots`, {
      query: { duration, days: 14 },
      signal,
    }),
  book: (body: LessonRequest) => apiRequest<Lesson>("/v1/lessons", { method: "POST", body }),
  lessons: (signal?: AbortSignal) => apiRequest<Lesson[]>("/v1/me/lessons", { signal }),
  cancel: (id: string) => apiRequest<Lesson>(`/v1/lessons/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  resync: (id: string) => apiRequest<Lesson>(`/v1/lessons/${encodeURIComponent(id)}/calendar-sync`, { method: "POST" }),
};
