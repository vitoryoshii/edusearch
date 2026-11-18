import { Button, Card } from "@edusearch/ui";
import { useAuth } from "../../app/auth";
import { CompletionSteps, ProfileSummary, RoleChoice, useRoleIntent } from "../../components/AccountProfile";
import { PageHeader, SectionTitle } from "../../components/PageHeader";
import type { AuthenticatedProfile } from "../../lib/auth/profile";

/**
 * Meu perfil (conta real): dados do Google, papel pretendido e conclusão do cadastro.
 * A foto do Google é só identificação visual — não comprova credencial profissional.
 */
export default function AccountProfile() {
  const { profile } = useAuth();
  if (!profile) return null;
  return <ProfileContent key={profile.id} profile={profile} />;
}

function ProfileContent({ profile }: { profile: AuthenticatedProfile }) {
  const [role, choose] = useRoleIntent(profile.id);

  return (
    <>
      <PageHeader title="Meu perfil" description="Dados básicos da sua conta Google e conclusão do cadastro." />

      <div className="space-y-8">
        <Card>
          <ProfileSummary profile={profile} size="xl" />
          <p className="mt-4 text-xs leading-relaxed text-fg-muted">
            Nome, e-mail e foto vêm da sua conta Google. A foto serve apenas para identificação visual e não comprova
            formação ou credenciais profissionais. Em breve será possível usar uma foto personalizada.
          </p>
        </Card>

        <section aria-labelledby="papel">
          <SectionTitle id="papel">Como você quer usar o EduSearch?</SectionTitle>
          <p className="-mt-1 mb-4 text-sm text-fg-muted">
            Escolha provisória: fica salva só neste navegador e não concede permissões. O perfil efetivo será confirmado
            pelo servidor.
          </p>
          <RoleChoice value={role} onChange={choose} />
        </section>

        <section aria-labelledby="conclusao">
          <SectionTitle id="conclusao">Conclusão do cadastro</SectionTitle>
          <CompletionSteps role={role} />
          <Button className="mt-5" size="lg" aria-describedby="perfil-indisponivel" disabled>
            Concluir perfil
          </Button>
          <p id="perfil-indisponivel" className="mt-2 text-sm text-fg-muted">
            Disponível quando a API de perfis, as autorizações do servidor e os documentos jurídicos estiverem publicados.
          </p>
        </section>
      </div>
    </>
  );
}
