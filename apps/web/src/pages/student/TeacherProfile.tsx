import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  Avatar,
  Badge,
  CalendarIcon,
  Card,
  ClockIcon,
  EmptyState,
  HeartIcon,
  IconButton,
  buttonClasses,
  cn,
} from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { NextSlots } from "../../components/NextSlots";
import { PageHeader, SectionTitle } from "../../components/PageHeader";
import { subjectName } from "../../lib/catalog";
import { dataSource, isDemo } from "../../lib/data/source";
import { LEVEL_LABELS, METHODOLOGY_LABELS, PERIOD_LABELS, formatMoney } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";

export default function TeacherProfile() {
  const { id = "" } = useParams();
  const teacher = useAsync(() => dataSource.getTeacher(id), [id]);
  const [favorite, setFavorite] = useState(false);

  return (
    <>
      <PageHeader back={{ to: "/aluno/buscar", label: "Voltar à busca" }} title="Perfil do professor" />
      <AsyncContent state={teacher} reload={teacher.reload} loading="spinner">
        {(t) => (
          <div className="grid grid-cols-1 gap-6 pb-16 lg:grid-cols-[1fr_20rem] lg:items-start lg:pb-0">
            <div className="space-y-6">
              <Card padding="lg">
                <div className="flex items-start gap-4 sm:gap-5">
                  <span className="hidden sm:block">
                    <Avatar name={t.name} size="xl" />
                  </span>
                  <span className="sm:hidden">
                    <Avatar name={t.name} size="lg" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h2 className="text-xl font-semibold text-fg-strong sm:text-2xl">{t.name}</h2>
                        <p className="mt-1 text-fg-muted">{t.headline}</p>
                      </div>
                      <IconButton
                        label={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                        aria-pressed={favorite}
                        onClick={() => setFavorite((f) => !f)}
                        className="-mt-2 -mr-2"
                      >
                        <HeartIcon className={cn("h-5 w-5", favorite && "fill-current text-danger-text")} />
                      </IconButton>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {isDemo && <Badge tone="demo">Perfil fictício</Badge>}
                      {t.subjects.map((s) => (
                        <Badge key={s} tone="primary">
                          {subjectName(s)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              <NextSlots teacherId={t.id} />

              <section aria-labelledby="sobre-prof">
                <SectionTitle id="sobre-prof">Sobre</SectionTitle>
                <Card>
                  <p className="leading-relaxed text-fg">{t.bio}</p>
                  <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-fg-muted">Níveis</dt>
                      <dd className="mt-1 font-medium text-fg-strong">{t.levels.map((l) => LEVEL_LABELS[l]).join(", ")}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Metodologia</dt>
                      <dd className="mt-1 font-medium text-fg-strong">
                        {t.methodologies.map((m) => METHODOLOGY_LABELS[m]).join(", ")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Períodos</dt>
                      <dd className="mt-1 font-medium text-fg-strong">{t.periods.map((p) => PERIOD_LABELS[p]).join(", ")}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Idiomas</dt>
                      <dd className="mt-1 font-medium text-fg-strong">{t.languages.join(", ")}</dd>
                    </div>
                  </dl>
                </Card>
              </section>

              <section aria-labelledby="formacao">
                <SectionTitle id="formacao">Formação</SectionTitle>
                <Card>
                  <ul className="space-y-2 text-fg">
                    {t.education.map((e) => (
                      <li key={e} className="flex gap-2">
                        <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-link" />
                        {e}
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>

              <section aria-labelledby="avaliacoes">
                <SectionTitle id="avaliacoes">Avaliações</SectionTitle>
                <EmptyState
                  compact
                  title="Ainda sem avaliações"
                  description="As avaliações aparecerão depois que alunos concluírem aulas pela plataforma."
                />
              </section>
            </div>

            {/* Resumo de contratação: fixo na lateral no desktop, barra inferior no mobile */}
            <Card className="hidden lg:sticky lg:top-6 lg:block">
              <p className="text-2xl font-semibold text-fg-strong tabular-nums">{formatMoney(t.priceCents)}</p>
              <p className="text-sm text-fg-muted">por aula</p>
              <ul className="mt-5 space-y-2 text-sm text-fg">
                <li className="flex items-center gap-2">
                  <ClockIcon className="h-4 w-4 text-fg-muted" /> {t.lessonMinutes} minutos
                </li>
                <li className="flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4 text-fg-muted" /> Aula online
                </li>
              </ul>
              <Link to={`/aluno/professores/${t.id}/agendar`} className={buttonClasses({ fullWidth: true, className: "mt-6" })}>
                Agendar aula
              </Link>
            </Card>

            <div className="fixed inset-x-0 bottom-16 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-sm lg:hidden">
              <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-fg-strong tabular-nums">{formatMoney(t.priceCents)}</p>
                  <p className="text-xs text-fg-muted">por aula · {t.lessonMinutes} min</p>
                </div>
                <Link to={`/aluno/professores/${t.id}/agendar`} className={buttonClasses()}>
                  Agendar aula
                </Link>
              </div>
            </div>
          </div>
        )}
      </AsyncContent>
    </>
  );
}
