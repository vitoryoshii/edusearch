import { Link } from "react-router";
import { buttonClasses } from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { LessonTabs } from "../../components/LessonTabs";
import { PageHeader } from "../../components/PageHeader";
import { dataSource } from "../../lib/data/source";
import { useAsync } from "../../lib/hooks/useAsync";

export default function StudentLessons() {
  const lessons = useAsync(() => dataSource.listStudentLessons(), []);
  return (
    <>
      <PageHeader title="Minhas aulas" description="Acompanhe suas aulas agendadas e o histórico." />
      <AsyncContent state={lessons} reload={lessons.reload}>
        {(data) => (
          <LessonTabs
            lessons={data}
            perspective="student"
            onChange={lessons.setData}
            emptyAction={
              <Link to="/aluno/buscar" className={buttonClasses({ size: "sm" })}>
                Buscar professores
              </Link>
            }
          />
        )}
      </AsyncContent>
    </>
  );
}
