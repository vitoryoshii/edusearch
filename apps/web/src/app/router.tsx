import { lazy } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { AppShell } from "../components/AppShell";
import { PublicLayout } from "../components/PublicLayout";
import { ErrorScreen, RouteError } from "../components/RouteError";
import { RequireRole } from "./session";

// Cada tela vira um chunk separado: o aluno não baixa o código do professor e vice-versa.
const Welcome = lazy(() => import("../pages/public/Welcome"));
const Login = lazy(() => import("../pages/public/Auth").then((m) => ({ default: m.Login })));
const Signup = lazy(() => import("../pages/public/Auth").then((m) => ({ default: m.Signup })));
const ChooseRole = lazy(() => import("../pages/public/ChooseRole"));

const StudentHome = lazy(() => import("../pages/student/Home"));
const Search = lazy(() => import("../pages/student/Search"));
const Matching = lazy(() => import("../pages/student/Matching"));
const Recommendations = lazy(() => import("../pages/student/Recommendations"));
const TeacherProfile = lazy(() => import("../pages/student/TeacherProfile"));
const Schedule = lazy(() => import("../pages/student/Schedule"));
const BookingSummary = lazy(() => import("../pages/student/BookingSummary"));
const StudentLessons = lazy(() => import("../pages/student/Lessons"));
const Progress = lazy(() => import("../pages/student/Progress"));
const StudentProfile = lazy(() => import("../pages/student/Profile"));

const TeacherDashboard = lazy(() => import("../pages/teacher/Dashboard"));
const ProfessionalProfile = lazy(() => import("../pages/teacher/ProfessionalProfile"));
const Specialties = lazy(() => import("../pages/teacher/Specialties"));
const Availability = lazy(() => import("../pages/teacher/Availability"));
const Agenda = lazy(() => import("../pages/teacher/Agenda"));
const TeacherLessons = lazy(() => import("../pages/teacher/Lessons"));
const Earnings = lazy(() => import("../pages/teacher/Earnings"));
const TeacherSettings = lazy(() => import("../pages/teacher/Settings"));

/** Títulos das páginas (document.title), em português. */
export const ROUTE_TITLES: Record<string, string> = {
  "/": "Início",
  "/entrar": "Entrar",
  "/cadastro": "Criar conta",
  "/perfil-de-acesso": "Escolha seu perfil",
  "/aluno": "Início do aluno",
  "/aluno/buscar": "Buscar professores",
  "/aluno/assistente": "Assistente de matching",
  "/aluno/recomendados": "Professores recomendados",
  "/aluno/agendamento/resumo": "Resumo do agendamento",
  "/aluno/aulas": "Minhas aulas",
  "/aluno/progresso": "Meu progresso",
  "/aluno/perfil": "Perfil e configurações",
  "/professor": "Painel do professor",
  "/professor/perfil": "Perfil profissional",
  "/professor/especialidades": "Especialidades",
  "/professor/disponibilidade": "Disponibilidade",
  "/professor/agenda": "Agenda",
  "/professor/aulas": "Aulas agendadas",
  "/professor/recebimentos": "Recebimentos",
  "/professor/configuracoes": "Configurações",
};

export function titleFor(pathname: string) {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  if (/^\/aluno\/professores\/[^/]+\/agendar$/.test(pathname)) return "Escolher horário";
  if (/^\/aluno\/professores\/[^/]+$/.test(pathname)) return "Perfil do professor";
  return "Página não encontrada";
}

const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { index: true, element: <Welcome /> },
          { path: "entrar", element: <Login /> },
          { path: "cadastro", element: <Signup /> },
          { path: "perfil-de-acesso", element: <ChooseRole /> },
        ],
      },
      {
        path: "aluno",
        element: (
          <RequireRole role="student">
            <AppShell role="student" />
          </RequireRole>
        ),
        children: [
          { index: true, element: <StudentHome /> },
          { path: "buscar", element: <Search /> },
          { path: "assistente", element: <Matching /> },
          { path: "recomendados", element: <Recommendations /> },
          { path: "professores/:id", element: <TeacherProfile /> },
          { path: "professores/:id/agendar", element: <Schedule /> },
          { path: "agendamento/resumo", element: <BookingSummary /> },
          { path: "aulas", element: <StudentLessons /> },
          { path: "progresso", element: <Progress /> },
          { path: "perfil", element: <StudentProfile /> },
        ],
      },
      {
        path: "professor",
        element: (
          <RequireRole role="teacher">
            <AppShell role="teacher" />
          </RequireRole>
        ),
        children: [
          { index: true, element: <TeacherDashboard /> },
          { path: "perfil", element: <ProfessionalProfile /> },
          { path: "especialidades", element: <Specialties /> },
          { path: "disponibilidade", element: <Availability /> },
          { path: "agenda", element: <Agenda /> },
          { path: "aulas", element: <TeacherLessons /> },
          { path: "recebimentos", element: <Earnings /> },
          { path: "configuracoes", element: <TeacherSettings /> },
        ],
      },
      { path: "*", element: <ErrorScreen notFound /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
