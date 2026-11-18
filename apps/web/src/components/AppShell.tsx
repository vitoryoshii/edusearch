import { Suspense, useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  Avatar,
  BookIcon,
  CalendarIcon,
  ChartIcon,
  ClockIcon,
  Dropdown,
  GiftIcon,
  GraduationIcon,
  HomeIcon,
  LockIcon,
  LoadingState,
  Logo,
  LogoutIcon,
  MoreIcon,
  SearchIcon,
  SettingsIcon,
  SparkleIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
  cn,
  type IconComponent,
} from "@edusearch/ui";
import { useAuth } from "../app/auth";
import { homeFor, studentSession, teacherSession, useSession } from "../app/session";
import type { Role } from "../lib/api/types";
import { dataSource } from "../lib/data/source";
import { DemoBanner } from "./DemoNotice";

type NavItem = { to: string; label: string; icon: IconComponent; end?: boolean; mobile?: boolean; short?: string };

/** "account" = conta REAL (Supabase); "student"/"teacher" = demonstração. */
export type ShellMode = Role | "account";

const NAV: Record<ShellMode, NavItem[]> = {
  account: [
    { to: "/conta", label: "Início", icon: HomeIcon, end: true, mobile: true },
    { to: "/conta/perfil", label: "Meu perfil", short: "Perfil", icon: UserIcon, mobile: true },
    { to: "/conta/configuracoes", label: "Configurações", short: "Ajustes", icon: SettingsIcon, mobile: true },
  ],
  student: [
    { to: "/aluno", label: "Início", icon: HomeIcon, end: true, mobile: true },
    { to: "/aluno/buscar", label: "Buscar", icon: SearchIcon, mobile: true },
    { to: "/aluno/assistente", label: "Assistente IA", icon: SparkleIcon },
    { to: "/aluno/aulas", label: "Minhas aulas", short: "Aulas", icon: CalendarIcon, mobile: true },
    { to: "/aluno/progresso", label: "Progresso", icon: ChartIcon },
    { to: "/aluno/perfil", label: "Perfil", icon: UserIcon, mobile: true },
  ],
  teacher: [
    { to: "/professor", label: "Início", icon: HomeIcon, end: true, mobile: true },
    { to: "/professor/agenda", label: "Agenda", icon: CalendarIcon, mobile: true },
    { to: "/professor/aulas", label: "Aulas", icon: BookIcon, mobile: true },
    { to: "/professor/recebimentos", label: "Recebimentos", icon: WalletIcon, mobile: true },
    { to: "/professor/beneficios", label: "Benefícios", icon: GiftIcon },
    { to: "/professor/perfil", label: "Perfil profissional", icon: UserIcon },
    { to: "/professor/especialidades", label: "Especialidades", icon: GraduationIcon },
    { to: "/professor/disponibilidade", label: "Disponibilidade", icon: ClockIcon },
    { to: "/professor/configuracoes", label: "Configurações", icon: SettingsIcon },
  ],
};

const homeOf = (mode: ShellMode) => (mode === "account" ? "/conta" : homeFor(mode));

/**
 * Layout das áreas logadas: barra lateral no desktop e barra inferior no mobile.
 * Na conta real (mode "account"), nome e foto vêm do perfil autenticado e não
 * há faixa nem ações da demonstração.
 */
export function AppShell({ role }: { role: ShellMode }) {
  const { session, switchRole, signOut } = useSession();
  const auth = useAuth();
  const isAccount = role === "account";
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const items = NAV[role];
  const mobileItems = items.filter((i) => i.mobile);
  const overflow = items.filter((i) => !i.mobile);
  const name = isAccount ? (auth.profile?.displayName ?? "Sua conta") : (session?.name ?? "Visitante");
  const avatarSrc = isAccount ? (auth.profile?.avatarUrl ?? undefined) : undefined;
  const subtitle = isAccount ? "Conta Google · testes" : `${role === "student" ? "Aluno" : "Professor"} · demo`;

  // Ao trocar de tela: volta ao topo e move o foco para o conteúdo (leitores de tela).
  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const other: Role = role === "student" ? "teacher" : "student";
  const accountMenu = [
    { id: "profile", label: "Meu perfil", icon: <UserIcon />, onSelect: () => navigate("/conta/perfil") },
    { id: "settings", label: "Configurações", icon: <SettingsIcon />, onSelect: () => navigate("/conta/configuracoes") },
    { id: "demo", label: "Explorar a demonstração", icon: <UsersIcon />, onSelect: () => navigate("/perfil-de-acesso") },
    {
      id: "logout",
      label: "Sair da conta",
      icon: <LogoutIcon />,
      tone: "danger" as const,
      onSelect: () => {
        void auth.signOut().then(() => navigate("/entrar", { replace: true }));
      },
    },
  ];
  const demoMenu = [
    {
      id: "switch",
      label: other === "teacher" ? "Ver como professor (demo)" : "Ver como aluno (demo)",
      icon: <UsersIcon />,
      onSelect: () => {
        switchRole(other === "student" ? studentSession() : teacherSession());
      },
    },
    {
      id: "settings",
      label: role === "student" ? "Perfil e configurações" : "Configurações",
      icon: <SettingsIcon />,
      onSelect: () => navigate(role === "student" ? "/aluno/perfil" : "/professor/configuracoes"),
    },
    {
      id: "logout",
      label: "Sair da demonstração",
      icon: <LogoutIcon />,
      tone: "danger" as const,
      onSelect: () => {
        signOut();
        void dataSource.resetDemoData?.();
        navigate("/", { replace: true });
      },
    },
  ];
  const userMenu = isAccount ? accountMenu : demoMenu;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a
        href="#conteudo-principal"
        className="sr-only z-[70] focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:shadow-raised"
      >
        Pular para o conteúdo
      </a>

      {/* Barra lateral (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        <div className="px-6 pt-6 pb-4">
          <NavLink to={homeOf(role)} aria-label="EduSearch — início" className="inline-block rounded-md">
            <Logo className="h-8" />
          </NavLink>
          <p className="mt-2 text-xs font-medium text-fg-muted">
            {isAccount ? "Minha conta" : role === "student" ? "Área do aluno" : "Área do professor"}
          </p>
        </div>
        <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto px-3">
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors",
                      isActive ? "bg-primary-soft text-link" : "text-fg hover:bg-surface-muted hover:text-fg-strong",
                    )
                  }
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-line p-3">
          <Dropdown
            label="Menu da conta"
            align="start"
            triggerHasText
            items={userMenu}
            triggerClassName="w-full justify-start px-2 py-2"
            trigger={
              <>
                <Avatar name={name} src={avatarSrc} size="sm" />
                <span className="min-w-0 text-left">
                  <span className="block truncate text-sm font-semibold text-fg-strong">{name}</span>
                  <span className="block text-xs text-fg-muted">{subtitle}</span>
                </span>
              </>
            }
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {isAccount ? <AccountBanner /> : <DemoBanner />}

        {/* Barra superior (mobile/tablet) */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/95 px-4 backdrop-blur-sm sm:px-6 lg:hidden">
          <NavLink to={homeOf(role)} aria-label="EduSearch — início" className="rounded-md">
            <Logo className="h-7" />
          </NavLink>
          <div className="flex items-center gap-1">
            {overflow.length > 0 && (
              <Dropdown
                label="Mais opções"
                items={overflow.map((i) => ({
                  id: i.to,
                  label: i.label,
                  icon: <i.icon />,
                  onSelect: () => navigate(i.to),
                }))}
                trigger={<MoreIcon className="h-6 w-6" />}
              />
            )}
            <Dropdown label="Menu da conta" items={userMenu} trigger={<Avatar name={name} src={avatarSrc} size="sm" />} />
          </div>
        </header>

        <main
          id="conteudo-principal"
          ref={mainRef}
          tabIndex={-1}
          className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-28 outline-none sm:px-6 lg:px-10 lg:pt-10 lg:pb-16"
        >
          <Suspense fallback={<LoadingState label="Carregando tela…" />}>
            <div key={location.pathname} className="animate-fade-in">
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>

      {/* Barra inferior (mobile/tablet) */}
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
      >
        <ul className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${mobileItems.length}, minmax(0, 1fr))` }}>
          {mobileItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors",
                    isActive ? "text-link" : "text-fg-muted hover:text-fg-strong",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cn("flex h-7 w-12 items-center justify-center rounded-full", isActive && "bg-primary-soft")}>
                      <item.icon className="h-5 w-5" />
                    </span>
                    {item.short ?? item.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** Faixa da conta real: deixa claro que é uma sessão autenticada em fase de testes. */
function AccountBanner() {
  return (
    <div className="flex items-center justify-center gap-1.5 border-b border-line bg-primary-soft px-4 py-2 text-center text-xs text-fg sm:px-6">
      <LockIcon className="h-3.5 w-3.5 shrink-0 text-link" />
      <span>
        <strong className="font-semibold text-fg-strong">Sessão autenticada</strong> · ambiente de testes. Aulas e pagamentos
        reais ainda não estão habilitados.
      </span>
    </div>
  );
}
