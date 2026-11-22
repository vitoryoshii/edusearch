import { lazy } from "react";
import { Navigate, createBrowserRouter, useSearchParams, type RouteObject } from "react-router";
import { AppShell } from "../components/AppShell";
import { OnboardingLayout } from "../components/Onboarding";
import { sanitizeNext } from "../lib/auth/oauth";
import { PublicLayout, SuspenseOutlet } from "../components/PublicLayout";
import { ErrorScreen, RouteError } from "../components/RouteError";
import { RequireAccount } from "./account";
import { RequireAuth } from "./auth";
import { RequireRole } from "./session";

// Cada tela vira um chunk separado: o aluno não baixa o código do professor e vice-versa.
const Entry = lazy(() => import("../pages/public/Entry"));
const EmailConfirmed = lazy(() => import("../pages/public/AuthLink").then((m) => ({ default: m.EmailConfirmed })));
const NewPassword = lazy(() => import("../pages/public/AuthLink").then((m) => ({ default: m.NewPassword })));
const ChooseRole = lazy(() => import("../pages/public/ChooseRole"));
// Conta real (Google Identity Services + Supabase Auth). Separada da demonstração.
const AccountDashboard = lazy(() => import("../pages/account/Dashboard"));
const AccountProfile = lazy(() => import("../pages/account/Profile"));
const AccountSettings = lazy(() => import("../pages/account/Settings"));
const AccountWelcome = lazy(() => import("../pages/account/Welcome"));
const StudentOnboarding = lazy(() => import("../pages/account/StudentOnboarding"));
const TeacherOnboarding = lazy(() => import("../pages/account/TeacherOnboarding"));
const AccountAgenda = lazy(() => import("../pages/account/Agenda"));
const AccountExplore = lazy(() => import("../pages/account/Explore"));
const AccountTeacherDetails = lazy(() => import("../pages/account/TeacherDetails"));
const AccountProfessionalProfile = lazy(() => import("../pages/account/TeacherDetails").then((m) => ({ default: m.OwnProfessionalProfile })));
const AccountLessons = lazy(() => import("../pages/account/Lessons"));
// Pagamentos Pix (Fase 5): redirecionam para /conta se VITE_STAGE_PAYMENTS=off.
const AccountPayment = lazy(() => import("../pages/account/Payment"));
const AccountPayments = lazy(() => import("../pages/account/Payments"));
const GoogleCalendarReturn = lazy(() => import("../pages/account/GoogleCalendarReturn"));

const StudentHome = lazy(() => import("../pages/student/Home"));
const Search = lazy(() => import("../pages/student/Search"));
const Matching = lazy(() => import("../pages/student/Matching"));
const Recommendations = lazy(() => import("../pages/student/Recommendations"));
const TeacherProfile = lazy(() => import("../pages/student/TeacherProfile"));
const Schedule = lazy(() => import("../pages/student/Schedule"));
const BookingSummary = lazy(() => import("../pages/student/BookingSummary"));
const StudentLessons = lazy(() => import("../pages/student/Lessons"));
const Checkout = lazy(() => import("../pages/student/Checkout"));
const StudentOnlineLesson = lazy(() => import("../pages/shared/OnlineLesson").then((m) => ({ default: m.StudentOnlineLesson })));
const TeacherOnlineLesson = lazy(() => import("../pages/shared/OnlineLesson").then((m) => ({ default: m.TeacherOnlineLesson })));
const Benefits = lazy(() => import("../pages/teacher/Benefits"));
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
  "/": "Entrar",
  "/auth/confirmacao": "Confirmação de e-mail",
  "/auth/nova-senha": "Nova senha",
  "/perfil-de-acesso": "Escolha seu perfil",
  "/conta": "Minha conta",
  "/conta/perfil": "Meu perfil",
  "/conta/configuracoes": "Configurações da conta",
  "/conta/boas-vindas": "Boas-vindas",
  "/conta/cadastro/aluno": "Cadastro de aluno",
  "/conta/cadastro/professor": "Cadastro de professor",
  "/aluno": "Início do aluno",
  "/aluno/buscar": "Buscar professores",
  "/aluno/assistente": "Assistente EduSearch",
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
  "/professor/beneficios": "Comissão e benefícios",
  "/professor/configuracoes": "Configurações",
};

export function titleFor(pathname: string) {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  if (/^\/aluno\/professores\/[^/]+\/agendar$/.test(pathname)) return "Escolher horário";
  if (/^\/aluno\/professores\/[^/]+$/.test(pathname)) return "Perfil do professor";
  if (/^\/(aluno|professor)\/aulas\/[^/]+$/.test(pathname)) return "Aula online";
  if (/^\/aluno\/pagamento\/[^/]+$/.test(pathname)) return "Pagamento da aula";
  return "Página não encontrada";
}

/**
 * /entrar e /cadastro (links antigos) levam à entrada única, preservando
 * somente um `next` interno e seguro (ver sanitizeNext).
 */
function LegacyEntryRedirect() {
  const [params] = useSearchParams();
  const next = params.get("next");
  return <Navigate to={next ? `/?next=${encodeURIComponent(sanitizeNext(next))}` : "/"} replace />;
}

const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    children: [
      {
        // Entrada única (Google + demonstração). /entrar e /cadastro são rotas legadas.
        element: <SuspenseOutlet />,
        children: [
          { index: true, element: <Entry /> },
          { path: "entrar", element: <LegacyEntryRedirect /> },
          { path: "cadastro", element: <LegacyEntryRedirect /> },
          // Retorno dos links enviados por e-mail (Supabase, PKCE).
          { path: "auth/confirmacao", element: <EmailConfirmed /> },
          { path: "auth/nova-senha", element: <NewPassword /> },
        ],
      },
      {
        // Primeiro acesso e cadastro em etapas (sem menu lateral).
        path: "conta",
        element: (
          <RequireAuth>
            <RequireAccount>
              <OnboardingLayout />
            </RequireAccount>
          </RequireAuth>
        ),
        children: [
          { path: "boas-vindas", element: <AccountWelcome /> },
          { path: "cadastro/aluno", element: <StudentOnboarding /> },
          { path: "cadastro/professor", element: <TeacherOnboarding /> },
        ],
      },
      {
        path: "conta",
        element: (
          <RequireAuth>
            <RequireAccount>
              <AppShell role="account" />
            </RequireAccount>
          </RequireAuth>
        ),
        children: [
          { index: true, element: <AccountDashboard /> },
          { path: "perfil", element: <AccountProfile /> },
          { path: "configuracoes", element: <AccountSettings /> },
          // Agenda real (Fase 3A): as páginas redirecionam para /conta se VITE_STAGE_SCHEDULING=off.
          { path: "agenda", element: <AccountAgenda /> },
          // Marketplace real (Fase 4A): catálogo, perfil público + reserva e aulas.
          { path: "explorar", element: <AccountExplore /> },
          { path: "professores/:id", element: <AccountTeacherDetails /> },
          { path: "aulas", element: <AccountLessons /> },
          { path: "pagamentos", element: <AccountPayments /> },
          { path: "pagamentos/:id", element: <AccountPayment /> },
          { path: "perfil-profissional", element: <AccountProfessionalProfile /> },
          { path: "agenda/google/retorno", element: <GoogleCalendarReturn /> },
        ],
      },
      {
        element: <PublicLayout />,
        children: [{ path: "perfil-de-acesso", element: <ChooseRole /> }],
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
          { path: "aulas/:id", element: <StudentOnlineLesson /> },
          { path: "pagamento/:lessonId", element: <Checkout /> },
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
          { path: "aulas/:id", element: <TeacherOnlineLesson /> },
          { path: "beneficios", element: <Benefits /> },
          { path: "recebimentos", element: <Earnings /> },
          { path: "configuracoes", element: <TeacherSettings /> },
        ],
      },
      { path: "*", element: <ErrorScreen notFound /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
