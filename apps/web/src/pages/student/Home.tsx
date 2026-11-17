import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRightIcon, Button, Card, Chip, EmptyState, Input, SearchIcon, SparkleIcon, buttonClasses } from "@edusearch/ui";
import { useSession } from "../../app/session";
import { AsyncContent } from "../../components/AsyncContent";
import { LessonCard } from "../../components/LessonCard";
import { SectionTitle } from "../../components/PageHeader";
import { TeacherCard } from "../../components/TeacherCard";
import { SUBJECTS } from "../../lib/catalog";
import { dataSource } from "../../lib/data/source";
import { useAsync } from "../../lib/hooks/useAsync";

export default function StudentHome() {
  const { session } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const lessons = useAsync(() => dataSource.listStudentLessons(), []);
  const teachers = useAsync(() => dataSource.searchTeachers({}), []);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    navigate(q.trim() ? `/aluno/buscar?q=${encodeURIComponent(q.trim())}` : "/aluno/buscar");
  };

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-fg-strong sm:text-3xl">Olá, {session?.name ?? "estudante"}</h1>
        <p className="mt-1 text-fg-muted">O que você quer aprender hoje?</p>
        <form role="search" onSubmit={onSearch} className="mt-5 flex gap-2">
          <Input
            label="Buscar professores"
            hideLabel
            className="flex-1"
            type="search"
            placeholder="Disciplina, objetivo ou nome do professor"
            leftIcon={<SearchIcon />}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button type="submit">Buscar</Button>
        </form>
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Disciplinas populares">
          {SUBJECTS.slice(0, 5).map((s) => (
            <li key={s.id}>
              <Chip onClick={() => navigate(`/aluno/buscar?disciplina=${s.id}`)}>{s.name}</Chip>
            </li>
          ))}
        </ul>
      </header>

      <Card tone="soft" padding="lg" className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-surface text-link">
            <SparkleIcon className="h-6 w-6" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-fg-strong">Não sabe por onde começar?</h2>
            <p className="mt-1 text-sm text-fg">
              Conte seu objetivo e receba professores recomendados para o seu perfil.
            </p>
          </div>
        </div>
        <Link to="/aluno/assistente" className={buttonClasses({ className: "sm:shrink-0" })}>
          Usar o assistente
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </Card>

      <section aria-labelledby="proxima-aula">
        <SectionTitle
          id="proxima-aula"
          action={
            <Link to="/aluno/aulas" className="text-sm font-medium text-link hover:underline">
              Ver todas
            </Link>
          }
        >
          Próxima aula
        </SectionTitle>
        <AsyncContent state={lessons} reload={lessons.reload}>
          {(data) => {
            const next = data
              .filter((l) => l.status === "scheduled" && new Date(l.end) > new Date())
              .sort((a, b) => a.start.localeCompare(b.start))[0];
            return next ? (
              <LessonCard lesson={next} perspective="student" highlight />
            ) : (
              <EmptyState
                compact
                title="Nenhuma aula agendada"
                description="Encontre um professor e agende sua primeira aula."
                action={
                  <Link to="/aluno/buscar" className={buttonClasses({ size: "sm" })}>
                    Buscar professores
                  </Link>
                }
              />
            );
          }}
        </AsyncContent>
      </section>

      <section aria-labelledby="em-destaque">
        <SectionTitle
          id="em-destaque"
          action={
            <Link to="/aluno/buscar" className="text-sm font-medium text-link hover:underline">
              Ver todos
            </Link>
          }
        >
          Professores em destaque
        </SectionTitle>
        <AsyncContent
          state={teachers}
          reload={teachers.reload}
          isEmpty={(d) => d.length === 0}
          empty={{ title: "Nenhum professor disponível", description: "Volte mais tarde para ver novos perfis." }}
        >
          {(data) => (
            <ul className="grid gap-3 md:grid-cols-2">
              {data.slice(0, 4).map((t) => (
                <li key={t.id}>
                  <TeacherCard teacher={t} compact />
                </li>
              ))}
            </ul>
          )}
        </AsyncContent>
      </section>
    </div>
  );
}
