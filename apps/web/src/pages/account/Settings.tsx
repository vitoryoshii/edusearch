import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
  AlertIcon,
  Avatar,
  Badge,
  Button,
  Card,
  Input,
  LogoutIcon,
  MonitorIcon,
  MoonIcon,
  SegmentedControl,
  SunIcon,
  useToast,
  type ThemePreference,
} from "@edusearch/ui";
import { useAccount, useDisplayProfile, useServerMe } from "../../app/account";
import { useAuth } from "../../app/auth";
import { accountApi, type Me } from "../../lib/api/account";
import { describeError } from "../../lib/api/client";
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
  const { session, signOut } = useAuth();
  const profile = useDisplayProfile();
  const account = useAccount();
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
        {account.mode === "server" && <NameAndPhoto />}

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

/** Nome e foto exibidos (modo servidor): PUT /v1/me/profile. Sem upload nesta fase. */
function NameAndPhoto() {
  const me = useServerMe();
  if (!me) return null;
  return <NameAndPhotoForm key={me.updated_at} me={me} />;
}

function NameAndPhotoForm({ me }: { me: Me }) {
  const account = useAccount();
  const { profile: google } = useAuth(); // foto do Google (somente *.googleusercontent.com)
  const toast = useToast();
  const googlePhoto = google?.avatarUrl ?? null;
  const [name, setName] = useState(me.display_name);
  const [photo, setPhoto] = useState<"google" | "none">(me.avatar_url ? "google" : "none");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = name.replace(/\s+/g, " ").trim();
    if (clean.length < 1 || clean.length > 80) {
      setNameError("Informe um nome com até 80 caracteres.");
      return;
    }
    setNameError(null);
    setError(null);
    setSaving(true);
    try {
      const avatar = photo === "google" ? (me.avatar_url ?? googlePhoto) : null;
      const updated = await accountApi.updateProfile({ display_name: clean, avatar_url: avatar });
      if (account.mode === "server") account.setMe(updated);
      toast({ tone: "success", title: "Perfil atualizado", description: "Nome e foto salvos na sua conta." });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const preview = photo === "google" ? (me.avatar_url ?? googlePhoto) : null;
  const canUsePhoto = Boolean(me.avatar_url ?? googlePhoto);

  return (
    <section aria-labelledby="nome-foto">
      <SectionTitle id="nome-foto">Nome e foto</SectionTitle>
      <Card>
        <form className="space-y-5" onSubmit={(e) => void submit(e)} noValidate data-testid="name-photo-form">
          <div className="flex items-center gap-4">
            <Avatar name={name.trim() || me.display_name} src={preview ?? undefined} size="lg" />
            <p className="text-sm text-fg-muted">Assim seu nome e sua foto aparecem no EduSearch.</p>
          </div>
          <Input
            label="Nome exibido"
            maxLength={80}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={nameError ?? undefined}
          />
          <SegmentedControl
            label="Foto"
            options={
              canUsePhoto
                ? [
                    { value: "google", label: "Foto da conta Google" },
                    { value: "none", label: "Sem foto (iniciais)" },
                  ]
                : [{ value: "none", label: "Sem foto (iniciais)" }]
            }
            value={photo}
            onChange={(v) => setPhoto(v as "google" | "none")}
          />
          {error && (
            <p role="alert" className="flex items-start gap-2 text-sm text-danger-text" data-testid="profile-save-error">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              Não foi possível salvar. {error}
            </p>
          )}
          <Button type="submit" loading={saving}>
            Salvar nome e foto
          </Button>
        </form>
      </Card>
    </section>
  );
}
