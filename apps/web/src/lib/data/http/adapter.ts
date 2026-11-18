import { ApiError, apiRequest } from "../../api/client";
import type { HealthResponse } from "../../api/types";
import type { DataSource } from "../source";

/**
 * Adapter para a API FastAPI real.
 *
 * Hoje o backend expõe apenas GET /health. Os demais métodos lançam
 * `not_implemented` de propósito: os contratos (rotas, payloads, erros)
 * serão definidos pela equipe de backend em docs/api-contract.md.
 * NÃO invente rotas aqui. Ver docs/frontend/api-integration.md.
 */
const pending = (feature: string) => () =>
  Promise.reject(new ApiError("not_implemented", `Integração pendente: ${feature}. Aguardando contrato da API.`));

export const httpDataSource: DataSource = {
  kind: "api",

  health: () => apiRequest<HealthResponse>("/health", { timeoutMs: 8_000 }),

  listSubjects: pending("disciplinas"),
  searchTeachers: pending("busca de professores"),
  getTeacher: pending("perfil do professor"),
  listTeacherSlots: pending("horários do professor"),
  matchTeachers: pending("matching pedagógico (Gemini)"),
  createBooking: pending("agendamento"),
  getLesson: pending("detalhes da aula"),
  listStudentLessons: pending("aulas do aluno"),
  cancelLesson: pending("cancelamento de aula"),
  getStudentProgress: pending("acompanhamento do aprendizado"),

  getCheckout: pending("cobrança Pix (AbacatePay)"),
  createCheckout: pending("cobrança Pix (AbacatePay)"),
  // simulatePayment e setCalendarConnection não existem na API real (somente demonstração).

  getCalendarConnection: pending("conexão com o Google Agenda"),
  syncLessonToCalendar: pending("sincronização com o Google Agenda"),

  getTeacherDashboard: pending("dashboard do professor"),
  getTeacherProfile: pending("perfil profissional"),
  saveTeacherProfile: pending("perfil profissional"),
  listSpecialties: pending("especialidades"),
  saveSpecialties: pending("especialidades"),
  getAvailability: pending("disponibilidade"),
  saveAvailability: pending("disponibilidade"),
  listTeacherLessons: pending("aulas do professor"),
  listBlockedDates: pending("bloqueios de agenda"),
  setDateBlocked: pending("bloqueios de agenda"),
  getEarnings: pending("recebimentos (AbacatePay)"),
  getCommissionProgram: pending("comissão e incentivos"),
  getReferralProgram: pending("indicações"),
};
