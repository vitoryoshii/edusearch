import { Link, Navigate } from "react-router";
import { ArrowRightIcon, Card, ShieldIcon, buttonClasses } from "@edusearch/ui";
import { useAuth } from "../../app/auth";
import { ProfileSummary, ProvisionalBadge, ROLE_LABEL, useRoleIntent } from "../../components/AccountProfile";
import { PageHeader } from "../../components/PageHeader";
import { firstNameOf } from "../../lib/auth/profile";
import { ONBOARDING_PATH, WELCOME_PATH } from "../../lib/onboarding";

/** Início da conta real: identidade, conclusão do cadastro e limites da fase de testes. */
export default function AccountDashboard() {
  const { profile } = useAuth();
  if (!profile) return null; // RequireAuth garante a sessão.
  return <DashboardContent key={profile.id} profile={profile} />;
}

function DashboardContent({ profile }: { profile: NonNullable<ReturnType<typeof useAuth>["profile"]> }) {
  const [role] = useRoleIntent(profile.id);
  // Primeiro acesso (nenhum papel escolhido): boas-vindas com as duas opções.
  if (role === null) return <Navigate to={WELCOME_PATH} replace />;

  return (
    <>
      <PageHeader title={`Olá, ${firstNameOf(profile)}!`} description="Esta é a sua conta EduSearch, conectada com o Google." />

      <div className="space-y-5">
        <Card>
          <ProfileSummary profile={profile} />
        </Card>

        <Card tone="soft" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-testid="completion-cta">
          <div>
            <p className="flex flex-wrap items-center gap-2 font-semibold text-fg-strong">
              Conclua seu cadastro de {ROLE_LABEL[role].toLowerCase()} <ProvisionalBadge />
            </p>
            <p className="mt-1 text-sm text-fg-muted">
              Seu perfil ainda não foi salvo no servidor. A escolha de papel fica só neste navegador.
            </p>
          </div>
          <Link to={ONBOARDING_PATH[role]} className={buttonClasses({ className: "shrink-0" })}>
            Continuar cadastro
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </Card>

        <Card tone="muted" className="flex items-start gap-3 text-sm">
          <ShieldIcon className="mt-0.5 h-5 w-5 shrink-0 text-link" />
          <div>
            <p className="font-semibold text-fg-strong">Conta ainda não habilitada para uso comercial</p>
            <p className="mt-1 leading-relaxed text-fg">
              Nesta fase de testes não é possível agendar aulas nem fazer pagamentos reais. A demonstração continua
              disponível com dados fictícios, separados da sua conta — nada dela é copiado para cá.
            </p>
            <Link
              to="/perfil-de-acesso"
              className="mt-2 inline-flex min-h-11 items-center font-semibold text-link underline-offset-4 hover:underline"
            >
              Explorar a demonstração
            </Link>
          </div>
        </Card>
      </div>
    </>
  );
}
