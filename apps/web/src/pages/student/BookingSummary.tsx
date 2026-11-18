import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  Avatar,
  Button,
  CalendarIcon,
  Card,
  ClockIcon,
  EmptyState,
  Select,
  Textarea,
  VideoIcon,
  buttonClasses,
  useToast,
} from "@edusearch/ui";
import { DemoNotice } from "../../components/DemoNotice";
import { PageHeader, SectionTitle } from "../../components/PageHeader";
import { ApiError, describeError } from "../../lib/api/client";
import type { Teacher, TimeSlot } from "../../lib/api/types";
import { subjectName } from "../../lib/catalog";
import { dataSource } from "../../lib/data/source";
import { firstName } from "../../lib/demo";
import { formatDateLong, formatMoney, formatTimeRange } from "../../lib/format";

export default function BookingSummary() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const state = location.state as { teacher?: Teacher; slot?: TimeSlot } | null;
  const teacher = state?.teacher;
  const slot = state?.slot;
  const [subject, setSubject] = useState(teacher?.subjects[0] ?? "");
  const [topic, setTopic] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [done, setDone] = useState(false);

  if (!teacher || !slot) {
    return (
      <>
        <PageHeader title="Resumo do agendamento" />
        <EmptyState
          icon={<CalendarIcon />}
          title="Nenhum horário selecionado"
          description="Escolha um professor e um horário para ver o resumo."
          action={
            <Link to="/aluno/buscar" className={buttonClasses({ size: "sm" })}>
              Buscar professores
            </Link>
          }
        />
      </>
    );
  }

  const confirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const lesson = await dataSource.createBooking({ teacherId: teacher.id, slotId: slot.id, subject, topic: topic.trim() || undefined });
      setDone(true);
      toast({
        tone: "success",
        title: "Aula reservada",
        description: `Também aparece na agenda de ${firstName(teacher.name)}, na visão do professor da demonstração.`,
      });
      // replace: voltar no navegador não reabre o resumo de uma reserva já feita.
      navigate("/aluno/aulas", { replace: true, state: { highlight: lesson.id } });
    } catch (e) {
      setError({ message: describeError(e), conflict: e instanceof ApiError && e.status === 409 });
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        back={{ to: `/aluno/professores/${teacher.id}/agendar`, label: "Alterar horário" }}
        title="Resumo do agendamento"
        description="Revise os detalhes antes de confirmar."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="space-y-6">
          <Card>
            <div className="flex items-center gap-4">
              <Avatar name={teacher.name} />
              <div>
                <p className="font-semibold text-fg-strong">{teacher.name}</p>
                <p className="text-sm text-fg-muted">{teacher.headline}</p>
              </div>
            </div>
            <ul className="mt-5 grid gap-3 text-sm text-fg sm:grid-cols-3">
              <li className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 shrink-0 text-fg-muted" />
                {formatDateLong(slot.start)}
              </li>
              <li className="flex items-center gap-2">
                <ClockIcon className="h-4 w-4 shrink-0 text-fg-muted" />
                {formatTimeRange(slot.start, slot.end)}
              </li>
              <li className="flex items-center gap-2">
                <VideoIcon className="h-4 w-4 shrink-0 text-fg-muted" />
                Online
              </li>
            </ul>
          </Card>

          <section aria-labelledby="detalhes-aula">
            <SectionTitle id="detalhes-aula">Sobre a aula</SectionTitle>
            <Card className="space-y-5">
              <Select
                label="Disciplina"
                options={teacher.subjects.map((s) => ({ value: s, label: subjectName(s) }))}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
              <Textarea
                label="O que você quer trabalhar nesta aula? (opcional)"
                hint="Ajuda o professor a preparar a aula."
                maxLength={300}
                rows={3}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </Card>
          </section>
        </div>

        <Card className="lg:sticky lg:top-6">
          <h2 className="font-semibold text-fg-strong">Pagamento</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-fg-muted">Aula de {teacher.lessonMinutes} min</dt>
              <dd className="font-medium text-fg-strong tabular-nums">{formatMoney(teacher.priceCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-line pt-3 text-base">
              <dt className="font-semibold text-fg-strong">Total</dt>
              <dd className="font-semibold text-fg-strong tabular-nums">{formatMoney(teacher.priceCents)}</dd>
            </div>
          </dl>
          <DemoNotice className="mt-5">
            Pagamento via Pix (AbacatePay) ainda não integrado. Nenhuma cobrança será feita.
          </DemoNotice>
          {error && (
            <div role="alert" className="mt-4 rounded-control bg-danger-soft px-3 py-2.5 text-sm text-danger-text">
              <p>{error.message}</p>
              {error.conflict && (
                <Link
                  to={`/aluno/professores/${teacher.id}/agendar`}
                  replace
                  className="mt-1.5 inline-flex min-h-9 items-center font-semibold underline underline-offset-4"
                >
                  Escolher outro horário
                </Link>
              )}
            </div>
          )}
          <Button
            fullWidth
            size="lg"
            className="mt-5"
            loading={submitting}
            disabled={done || error?.conflict}
            onClick={confirm}
          >
            Confirmar agendamento
          </Button>
          <p className="mt-3 text-center text-xs text-fg-muted">Agendamento de demonstração.</p>
        </Card>
      </div>
    </>
  );
}
