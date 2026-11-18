import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Badge,
  Button,
  Card,
  LogoutIcon,
  MonitorIcon,
  MoonIcon,
  SegmentedControl,
  SunIcon,
  useToast,
  type ThemePreference,
} from "@edusearch/ui";
import { useAuth } from "../../app/auth";
import { useAppTheme } from "../../app/theme";
import { ProfileSummary } from "../../components/AccountProfile";
import { PageHeader, SectionTitle } from "../../components/PageHeader";

const THEMES = [
  { value: "system", label: "Sistema", icon: <MonitorIcon className="h-4 w-4" /> },
  { value: "light", label: "Claro", icon: <SunIcon className="h-4 w-4" /> },
  { value: "dark", label: "Escuro", icon: <MoonIcon className="h-4 w-4" /> },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string; icon: React.ReactNode }>;

/** Configurações da conta real: aparência, sessão e saída. */
export default function AccountSettings() {
  const { profile, session, signOut } = useAuth();
  const { preference, setPreference } = useAppTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const [leaving, setLeaving] = useState(false);

  if (!profile) return null;

  const exit = async () => {
    setLeaving(true);
    await signOut();
    toast({ tone: "success", title: "Você saiu da sua conta", description: "A sessão foi encerrada neste dispositivo." });
    navigate("/", { replace: true });
  };

  return (
    <>
      <PageHeader title="Configurações" description="Aparência do aplicativo e sessão da sua conta." />

      <div className="space-y-8">
        <section aria-labelledby="aparencia">
          <SectionTitle id="aparencia">Aparência</SectionTitle>
          <SegmentedControl label="Tema" options={THEMES} value={preference} onChange={setPreference} />
        </section>

        <section aria-labelledby="sessao">
          <SectionTitle id="sessao">Conta e sessão</SectionTitle>
          <Card className="space-y-4">
            <ProfileSummary profile={profile} />
            <div className="flex flex-wrap gap-2">
              <Badge tone="primary">Sessão autenticada</Badge>
              {session?.emailVerified && <Badge tone="success">E-mail verificado pelo Google</Badge>}
              <Badge tone="warning">Ambiente de testes</Badge>
            </div>
            <p className="text-sm leading-relaxed text-fg-muted">
              Sua sessão é renovada automaticamente enquanto o aplicativo estiver em uso. Se ela expirar, pediremos que
              você entre novamente com o Google. Nenhuma permissão de Agenda, Meet, Drive ou Gmail foi solicitada.
            </p>
            <Button variant="danger" onClick={exit} loading={leaving}>
              <LogoutIcon className="h-4 w-4" />
              Sair da conta
            </Button>
          </Card>
        </section>

        <section aria-labelledby="demo">
          <SectionTitle id="demo">Demonstração</SectionTitle>
          <p className="text-sm text-fg-muted">
            A demonstração usa dados fictícios e é independente da sua conta.{" "}
            <Link to="/perfil-de-acesso" className="font-semibold text-link underline-offset-4 hover:underline">
              Explorar a demonstração
            </Link>
          </p>
        </section>
      </div>
    </>
  );
}
