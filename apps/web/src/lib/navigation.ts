/**
 * Menu da conta REAL por papel (regra pura; testada em scripts/unit.test.mjs).
 *
 * - Aluno:     Início · Explorar · Aulas · Perfil
 * - Professor: Painel · Agenda · Aulas · Perfil profissional
 * - Os dois papéis: união, sem itens repetidos (Aulas aparece uma vez).
 * Sem a agenda real ligada (VITE_STAGE_SCHEDULING=off), só Início/Perfil/Configurações.
 * Com pagamentos ligados (VITE_STAGE_PAYMENTS≠off), "Pagamentos" entra no menu (não na barra do celular).
 */
export type NavIconKey = "home" | "search" | "calendar" | "clock" | "user" | "graduation" | "settings" | "wallet" | "shield";
export type AccountNavItem = { to: string; label: string; short?: string; icon: NavIconKey; end?: boolean; mobile: boolean };

export function accountNav(roles: readonly string[], schedulingOn: boolean, paymentsOn = false): AccountNavItem[] {
  const student = roles.includes("student");
  const teacher = roles.includes("teacher");
  const items: AccountNavItem[] = [
    { to: "/conta", label: teacher && !student ? "Painel" : "Início", icon: "home", end: true, mobile: true },
  ];
  if (schedulingOn && student) items.push({ to: "/conta/explorar", label: "Explorar", icon: "search", mobile: true });
  if (schedulingOn && teacher) items.push({ to: "/conta/agenda", label: "Agenda", icon: "clock", mobile: true });
  if (schedulingOn && (student || teacher)) items.push({ to: "/conta/aulas", label: "Aulas", icon: "calendar", mobile: true });
  if (schedulingOn && paymentsOn && (student || teacher)) items.push({ to: "/conta/pagamentos", label: "Pagamentos", icon: "wallet", mobile: false });
  if (teacher) items.push({ to: "/conta/perfil-profissional", label: "Perfil profissional", short: "Perfil", icon: "graduation", mobile: !student });
  if (teacher) items.push({ to: "/conta/credenciamento", label: "Credenciamento", icon: "shield", mobile: false });
  if (student || !teacher) items.push({ to: "/conta/perfil", label: "Meu perfil", short: "Perfil", icon: "user", mobile: true });
  items.push({ to: "/conta/configuracoes", label: "Configurações", short: "Ajustes", icon: "settings", mobile: false });
  // A barra inferior do celular comporta no máximo 5 atalhos; o resto fica no menu.
  let mobile = 0;
  return items.map((i) => (i.mobile && ++mobile > 5 ? { ...i, mobile: false } : i));
}

/**
 * URL legada da demonstração → tela REAL equivalente, para quem tem conta real e NÃO escolheu entrar
 * na demonstração. IDs da demonstração nunca são levados para a conta real (são fictícios).
 */
export function legacyRealPath(pathname: string): string {
  const p = pathname.replace(/\/+$/, "") || "/";
  const rules: Array<[RegExp, string]> = [
    [/^\/aluno\/(buscar|recomendados|assistente|professores(\/.*)?)$/, "/conta/explorar"],
    [/^\/aluno\/aulas(\/.*)?$/, "/conta/aulas"],
    [/^\/aluno\/perfil$/, "/conta/perfil"],
    [/^\/professor\/(agenda|disponibilidade)$/, "/conta/agenda"],
    [/^\/professor\/aulas(\/.*)?$/, "/conta/aulas"],
    [/^\/professor\/(perfil|especialidades)$/, "/conta/perfil-profissional"],
    [/^\/professor\/configuracoes$/, "/conta/configuracoes"],
  ];
  for (const [re, to] of rules) if (re.test(p)) return to;
  return "/conta";
}
