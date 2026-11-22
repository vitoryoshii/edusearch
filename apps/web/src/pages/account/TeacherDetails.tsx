import type { ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router";
import { ArrowLeftIcon, Avatar, Badge, Card, InfoIcon, buttonClasses } from "@edusearch/ui";
import { hasRole, useServerMe } from "../../app/account";
import { AsyncContent } from "../../components/AsyncContent";
import { BookingPanel } from "../../components/marketplace/BookingPanel";
import { useSubjectNames } from "../../components/marketplace/LessonList";
import { schedulingApi } from "../../lib/api/scheduling";
import { FEATURES } from "../../lib/features";
import { METHODOLOGY_LABELS } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";
import { EXPERIENCE_LABELS, MODALITY_LABELS, ONBOARDING_PATH, type ExperienceRange, type Modality } from "../../lib/onboarding";
import type { Methodology } from "../../lib/api/types";

/** Perfil público REAL do professor (cadastro salvo) + horários livres e reserva. */
export default function TeacherDetails() {
  const me = useServerMe();
  const { id = "" } = useParams();
  if (FEATURES.scheduling === "off" || !me) return <Navigate to="/conta" replace />;
  const isStudent = hasRole(me, "student");
  if (!isStudent && id !== me.id) return <Navigate to="/conta" replace />;
  return <TeacherDetailsPage id={id} canBook={isStudent && id !== me.id} />;
}

/** Perfil profissional do próprio professor: como os alunos veem + atalho para editar o cadastro. */
export function OwnProfessionalProfile() {
  const me = useServerMe();
  if (!me || !hasRole(me, "teacher")) return <Navigate to="/conta" replace />;
  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-strong">Perfil profissional</h1>
          <p className="mt-1 text-sm text-fg-muted">É isto que os alunos veem quando seu perfil está publicado.</p>
        </div>
        <Link to={ONBOARDING_PATH.teacher} className={buttonClasses({ variant: "secondary", className: "shrink-0" })}>
          Editar cadastro
        </Link>
      </div>
      {FEATURES.scheduling === "off" ? null : <TeacherDetailsPage id={me.id} canBook={false} />}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-fg">{children}</div>
    </section>
  );
}

function TeacherDetailsPage({ id, canBook }: { id: string; canBook: boolean }) {
  const profile = useAsync(() => schedulingApi.teacherProfile(id), [id]);
  const subjectName = useSubjectNames();

  return (
    <>
      {canBook && (
        <Link to="/conta/explorar" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-link underline-offset-4 hover:underline">
          <ArrowLeftIcon className="h-4 w-4" /> Voltar para a busca
        </Link>
      )}
      <AsyncContent state={profile} reload={profile.reload} loading="spinner" loadingLabel="Carregando perfil…">
        {(t) => (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start" data-testid="teacher-profile">
            <div className="space-y-6">
              {t.is_own_profile && (
                <Card tone="muted" className="flex items-start gap-3 text-sm" data-testid="own-preview">
                  <InfoIcon className="mt-0.5 h-5 w-5 shrink-0 text-link" />
                  <p>
                    Pré-visualização do seu perfil público.{" "}
                    {t.is_published ? "É assim que os alunos o veem." : "Ele só aparece para alunos depois da aprovação."}
                  </p>
                </Card>
              )}
              <Card>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <Avatar name={t.display_name} src={t.avatar_url ?? undefined} size="xl" />
                  <div className="min-w-0">
                    <h1 className="text-2xl font-semibold tracking-tight text-fg-strong">{t.display_name}</h1>
                    {t.headline && <p className="mt-1 text-fg">{t.headline}</p>}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {t.modality && <Badge tone="neutral">{MODALITY_LABELS[t.modality as Modality]}</Badge>}
                      {t.experience && <Badge tone="neutral">Experiência: {EXPERIENCE_LABELS[t.experience as ExperienceRange]}</Badge>}
                      {t.lesson_durations_minutes.length > 0 && <Badge tone="neutral">Aulas de {[...t.lesson_durations_minutes].sort((a, b) => a - b).join(", ")} min</Badge>}
                    </div>
                  </div>
                </div>
              </Card>
              <Card className="space-y-6">
                {t.bio && (
                  <Section title="Sobre">
                    <p className="whitespace-pre-line">{t.bio}</p>
                  </Section>
                )}
                <Section title="Disciplinas">
                  <div className="flex flex-wrap gap-1.5">
                    {t.subjects.map((s) => (
                      <Badge key={s} tone="primary">
                        {subjectName(s)}
                      </Badge>
                    ))}
                  </div>
                </Section>
                {t.specialties && <Section title="Especialidades">{t.specialties}</Section>}
                {t.academic_background && <Section title="Formação">{t.academic_background}</Section>}
                {(t.teaching_methods.length > 0 || t.methodology) && (
                  <Section title="Como são as aulas">
                    {t.teaching_methods.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5">
                        {t.teaching_methods.map((m) => (
                          <li key={m}>
                            <Badge tone="neutral">{METHODOLOGY_LABELS[m as Methodology] ?? m}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                    {t.methodology && <p className="mt-2 whitespace-pre-line">{t.methodology}</p>}
                  </Section>
                )}
              </Card>
            </div>
            {canBook ? (
              <Card className="lg:sticky lg:top-6" data-testid="booking-card">
                <h2 className="text-lg font-semibold text-fg-strong">Reservar aula</h2>
                <p className="mt-1 mb-4 text-sm text-fg-muted">Horários de Brasília, próximos 14 dias.</p>
                <BookingPanel teacher={t} subjectName={subjectName} />
              </Card>
            ) : null}
          </div>
        )}
      </AsyncContent>
    </>
  );
}
