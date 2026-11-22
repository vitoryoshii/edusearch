import { useDisplayProfile, useServerMe } from "../app/account";
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
import { FEATURES } from "../lib/features";
import { accountNav, type NavIconKey } from "../lib/navigation";
import { DemoBanner } from "./DemoNotice";

type NavItem = { to: string; label: string; icon: IconComponent; end?: boolean; mobile?: boolean; short?: string };

/** "account" = conta REAL (Supabase); "student"/"teacher" = demonstração. */
export type ShellMode = Role | "account";

const NAV_ICONS: Record<NavIconKey, IconComponent> = {
  home: HomeIcon,
  search: SearchIcon,
  calendar: CalendarIcon,
  clock: ClockIcon,
  user: UserIcon,
  graduation: GraduationIcon,
  settings: SettingsIcon,
};

/** Menu da conta real: depende dos papéis PERSISTIDOS no servidor (lib/navigation.ts). */
function useAccountNav(): NavItem[] {
  const me = useServerMe();
  return accountNav(me?.roles ?? [], FEATURES.scheduling !== "off").map((i) => ({ ...i, icon: NAV_ICONS[i.icon] }));
}

const NAV: Record<Exclude<ShellMode, "account">, NavItem[]> = {
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
  const accountItems = useAccountNav();
  const items = role === "account" ? accountItems : NAV[role];
  const mobileItems = items.filter((i) => i.mobile);
  const overflow = items.filter((i) => !i.mobile);
  const display = useDisplayProfile();
  const name = isAccount ? (display?.displayName ?? "Sua conta") : (session?.name ?? "Visitante");
  const avatarSrc = isAccount ? (display?.avatarUrl ?? undefined) : undefined;
  const me = useServerMe();
  const accountRole = me?.roles.includes("student") && me?.roles.includes("teacher") ? "Aluno e professor" : me?.roles.includes("teacher") ? "Professor" : me?.roles.includes("student") ? "Aluno" : "Conta EduSearch";
  const subtitle = isAccount ? accountRole : `${role === "student" ? "Aluno" : "Professor"} · demonstração`;

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
        void auth.signOut().then(() => navigate("/", { replace: true }));
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
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]" data-shell={isAccount ? "account" : "demo"}>
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
        {/* Demonstração: faixa fixa (dados fictícios). Conta real: sem faixa — o piloto é informado onde importa. */}
        {!isAccount && <DemoBanner />}

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
            {/*
              Só o avatar no botão: sem foto, as iniciais seriam o "texto visível" do botão e não estão em
              "Menu da conta" (WCAG 2.5.3, axe label-content-name-mismatch). Sem foto → ícone, sem texto.
            */}
            <Dropdown
              label="Menu da conta"
              items={userMenu}
              trigger={
                avatarSrc ? (
                  <Avatar name={name} src={avatarSrc} size="sm" />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-link">
                    <UserIcon className="h-5 w-5" />
                  </span>
                )
              }
            />
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
        aria-label="Navegação rápida"
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
