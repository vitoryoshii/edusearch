import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Badge,
  Button,
  Card,
  CheckCircleIcon,
  Dialog,
  LogoutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  Switch,
  cn,
  useToast,
  type ThemePreference,
} from "@edusearch/ui";
import { studentSession, teacherSession, useSession } from "../app/session";
import { DEMO_TEACHER_ID } from "../lib/demo";
import { TeacherPicker } from "./TeacherPicker";
import { useAppTheme } from "../app/theme";
import { API_BASE_URL, describeError } from "../lib/api/client";
import type { Role } from "../lib/api/types";
import { dataSource } from "../lib/data/source";
import { SectionTitle } from "./PageHeader";

const THEMES: Array<{ value: ThemePreference; label: string; icon: typeof SunIcon }> = [
  { value: "system", label: "Sistema", icon: MonitorIcon },
  { value: "light", label: "Claro", icon: SunIcon },
  { value: "dark", label: "Escuro", icon: MoonIcon },
];

/** Preferências comuns a aluno e professor: tema, notificações, conexão e sessão. */
export function SettingsPanel({ role }: { role: Role }) {
  const { preference, setPreference } = useAppTheme();
  const { session, signIn, switchRole, signOut } = useSession();
  const navigate = useNavigate();
  const [notify, setNotify] = useState({ reminders: true, updates: false });
  const [api, setApi] = useState<{ status: "idle" | "checking" | "ok" | "error"; message?: string }>({ status: "idle" });
  const [confirmExit, setConfirmExit] = useState(false);
  const [resetting, setResetting] = useState(false);
  const toast = useToast();

  const resetDemo = async () => {
    if (!dataSource.resetDemoData) return;
    setResetting(true);
    await dataSource.resetDemoData();
    setResetting(false);
    toast({ tone: "success", title: "Demonstração restaurada", description: "Aulas, perfil e disponibilidade voltaram ao estado inicial." });
  };
  const other: Role = role === "student" ? "teacher" : "student";

  const checkApi = async () => {
    setApi({ status: "checking" });
    try {
      const h = await dataSource.health();
      setApi({ status: "ok", message: `${h.service} · versão ${h.version}` });
    } catch (e) {
      setApi({ status: "error", message: describeError(e) });
    }
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="aparencia">
        <SectionTitle id="aparencia">Aparência</SectionTitle>
        <Card>
          <fieldset>
            <legend className="text-sm font-medium text-fg-strong">Tema</legend>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {THEMES.map((t) => (
                <label
                  key={t.value}
                  className={cn(
                    "flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-control border text-sm font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-link",
                    preference === t.value
                      ? "border-primary bg-primary-soft text-link"
                      : "border-line-strong text-fg hover:border-link",
                  )}
                >
                  <input
                    type="radio"
                    name="tema"
                    value={t.value}
                    checked={preference === t.value}
                    onChange={() => setPreference(t.value)}
                    className="sr-only"
                  />
                  <t.icon className="h-5 w-5" />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
        </Card>
      </section>

      <section aria-labelledby="notificacoes">
        <SectionTitle id="notificacoes">Notificações</SectionTitle>
        <Card className="space-y-5">
          <Switch
            label="Lembretes de aula"
            description="Aviso antes de cada aula agendada."
            checked={notify.reminders}
            onChange={(v) => setNotify((n) => ({ ...n, reminders: v }))}
          />
          <Switch
            label="Novidades do EduSearch"
            description="Atualizações sobre novos recursos."
            checked={notify.updates}
            onChange={(v) => setNotify((n) => ({ ...n, updates: v }))}
          />
          <p className="text-xs text-fg-muted">Demonstração: as preferências não são salvas nem enviadas.</p>
        </Card>
      </section>

      <section aria-labelledby="conexao">
        <SectionTitle id="conexao">Conexão com a API</SectionTitle>
        <Card className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-fg-muted">Origem dos dados</dt>
              <dd className="mt-0.5 font-medium text-fg-strong">
                {dataSource.kind === "mock" ? "Dados de demonstração (mock)" : "API EduSearch"}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Endereço configurado</dt>
              <dd className="mt-0.5 font-medium break-all text-fg-strong">{API_BASE_URL}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" loading={api.status === "checking"} onClick={checkApi}>
              Verificar conexão
            </Button>
            <span aria-live="polite" className="text-sm">
              {api.status === "ok" && (
                <Badge tone="success" icon={<CheckCircleIcon />}>
                  Conectado · {api.message}
                </Badge>
              )}
              {api.status === "error" && <span className="text-danger-text">{api.message}</span>}
            </span>
          </div>
        </Card>
      </section>

      <section aria-labelledby="sessao">
        <SectionTitle id="sessao">Sessão de demonstração</SectionTitle>
        {role === "teacher" && (
          <Card className="mb-3">
            <TeacherPicker
              value={session?.teacherId ?? DEMO_TEACHER_ID}
              label="Professor exibido"
              hint="Troque para ver a agenda, as aulas e os recebimentos de outro professor fictício."
              onChange={(t) => {
                signIn(teacherSession(t));
                toast({ title: `Visão de ${t.name}`, description: "Dados de demonstração." });
                navigate("/professor");
              }}
            />
          </Card>
        )}
        <Card className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <p className="min-w-0 text-sm text-fg">
            Explore a outra visão do produto sem sair da demonstração. As reservas da Ana aparecem na agenda do
            professor reservado.
          </p>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Button
              variant="secondary"
              onClick={() => {
                switchRole(other === "student" ? studentSession() : teacherSession());
              }}
            >
              Ver como {other === "student" ? "aluno" : "professor"}
            </Button>
            <Button variant="danger" leftIcon={<LogoutIcon className="h-4 w-4" />} onClick={() => setConfirmExit(true)}>
              Sair
            </Button>
          </div>
        </Card>
      </section>

      {dataSource.resetDemoData && (
        <section aria-labelledby="dados-demo">
          <SectionTitle id="dados-demo">Dados da demonstração</SectionTitle>
          <Card className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <p className="min-w-0 text-sm text-fg">
              As reservas e edições ficam salvas nesta aba do navegador enquanto ela estiver aberta. Restaure para recomeçar.
            </p>
            <Button variant="secondary" loading={resetting} onClick={resetDemo}>
              Restaurar dados
            </Button>
          </Card>
        </section>
      )}

      <Dialog
        open={confirmExit}
        onClose={() => setConfirmExit(false)}
        title="Sair da demonstração?"
        description={`Você sairá como ${session?.name ?? "visitante"}. Suas reservas de demonstração serão descartadas.`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmExit(false)}>
              Continuar aqui
            </Button>
            <Button
              onClick={() => {
                signOut();
                void dataSource.resetDemoData?.();
                navigate("/", { replace: true });
              }}
            >
              Sair
            </Button>
          </>
        }
      />
    </div>
  );
}
