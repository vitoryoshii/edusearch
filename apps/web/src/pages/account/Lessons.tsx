import { Link, Navigate } from "react-router";
import { Card, buttonClasses } from "@edusearch/ui";
import { hasRole, useServerMe } from "../../app/account";
import { PageHeader } from "../../components/PageHeader";
import { LessonList } from "../../components/marketplace/LessonList";
import { FEATURES } from "../../lib/features";

/** Minhas aulas (aluno e/ou professor): próximas com link do Meet, anteriores e canceladas. */
export default function AccountLessons() {
  const me = useServerMe();
  if (FEATURES.scheduling === "off" || !me) return <Navigate to="/conta" replace />;
  const student = hasRole(me, "student");
  return (
    <>
      <PageHeader title="Minhas aulas" description="Horários de Brasília. O link do Google Meet aparece em cada aula confirmada. Aulas do piloto, sem cobrança." />
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
