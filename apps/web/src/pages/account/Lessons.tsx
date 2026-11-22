import { Link, Navigate } from "react-router";
import { Card, buttonClasses } from "@edusearch/ui";
import { hasRole, useServerMe } from "../../app/account";
import { PageHeader } from "../../components/PageHeader";
import { LessonList } from "../../components/marketplace/LessonList";
import { FEATURES } from "../../lib/features";

/**
 * Aviso conforme o estágio dos pagamentos: aulas do piloto são gratuitas; aulas reservadas com Pix
 * mostram "Pagamento" e, no sandbox, não movimentam dinheiro real.
 */
const LESSONS_NOTICE: Record<typeof FEATURES.payments, string> = {
  off: "Aulas do piloto, sem cobrança.",
  sandbox: "Aulas do piloto são gratuitas; aulas reservadas com Pix usam o ambiente de testes, sem dinheiro real.",
  production: "Aulas do piloto são gratuitas; aulas reservadas com Pix mostram o pagamento em cada aula.",
};

/** Minhas aulas (aluno e/ou professor): próximas com link do Meet, anteriores e canceladas. */
export default function AccountLessons() {
  const me = useServerMe();
  if (FEATURES.scheduling === "off" || !me) return <Navigate to="/conta" replace />;
  const student = hasRole(me, "student");
  return (
    <>
      <PageHeader title="Minhas aulas" description={`Horários de Brasília. O link do Google Meet aparece em cada aula confirmada. ${LESSONS_NOTICE[FEATURES.payments]}`} />
      <Card>
        <LessonList
          emptyAction={
            student ? (
              <Link to="/conta/explorar" className={buttonClasses({})}>
                Explorar professores
              </Link>
            ) : undefined
          }
        />
      </Card>
    </>
  );
}
