import { AsyncContent } from "../../components/AsyncContent";
import { LessonTabs } from "../../components/LessonTabs";
import { PageHeader } from "../../components/PageHeader";
import { dataSource } from "../../lib/data/source";
import { useAsync } from "../../lib/hooks/useAsync";

export default function TeacherLessons() {
  const lessons = useAsync(() => dataSource.listTeacherLessons(), []);
  return (
    <>
      <PageHeader title="Aulas agendadas" description="Próximas aulas, histórico e cancelamentos." />
      <AsyncContent state={lessons} reload={lessons.reload}>
        {(data) => <LessonTabs lessons={data} perspective="teacher" onChange={lessons.setData} />}
      </AsyncContent>
    </>
  );
}
