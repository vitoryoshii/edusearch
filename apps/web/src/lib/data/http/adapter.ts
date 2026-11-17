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
  listStudentLessons: pending("aulas do aluno"),
  cancelLesson: pending("cancelamento de aula"),
  getStudentProgress: pending("acompanhamento do aprendizado"),

  getTeacherDashboard: pending("dashboard do professor"),
  getTeacherProfile: pending("perfil profissional"),
  saveTeacherProfile: pending("perfil profissional"),
  listSpecialties: pending("especialidades"),
  saveSpecialties: pending("especialidades"),
  getAvailability: pending("disponibilidade"),
  saveAvailability: pending("disponibilidade"),
  listTeacherLessons: pending("aulas do professor"),
  getEarnings: pending("recebimentos (AbacatePay)"),
};
