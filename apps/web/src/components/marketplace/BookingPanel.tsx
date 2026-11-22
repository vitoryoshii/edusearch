import { useRef, useState } from "react";
import { Link } from "react-router";
import { Button, Chip, Select, buttonClasses, useToast } from "@edusearch/ui";
import { QueryContent } from "../QueryContent";
import { ApiError, describeError } from "../../lib/api/client";
import type { Lesson } from "../../lib/api/scheduling";
import { useBookLessonMutation, useSlotsQuery } from "../../lib/query/hooks";
import { groupSlotsByDay } from "../../lib/scheduling";

type Offer = { id: string; subjects: string[]; lesson_durations_minutes: number[] };

/**
 * Reserva de aula de TESTE com UM professor (perfil público). Disciplina e duração vêm do cadastro
 * real; os horários, da API (fuso de Brasília). Idempotência por intenção de reserva: clique duplo
 * ou nova tentativa devolvem a MESMA aula.
 */
export function BookingPanel({ teacher, subjectName, onBooked }: { teacher: Offer; subjectName: (slug: string) => string; onBooked?: (lesson: Lesson) => void }) {
  const toast = useToast();
  const [subject, setSubject] = useState(teacher.subjects[0] ?? "");
  const [duration, setDuration] = useState(teacher.lesson_durations_minutes[0] ?? 60);
  const [slot, setSlot] = useState<string | null>(null);
  const [booked, setBooked] = useState<Lesson | null>(null);
  // Uma chave por INTENÇÃO de reserva; envio em andamento ignora um segundo clique.
  const key = useRef<string>(crypto.randomUUID());
  const inFlight = useRef(false);
  // Horários em cache aparecem na hora e são revalidados; quem garante o horário é o servidor (409).
  const slots = useSlotsQuery(teacher.id, duration);
  const bookMutation = useBookLessonMutation();
  const renew = () => {
    setSlot(null);
    key.current = crypto.randomUUID();
  };
  const book = {
    pending: bookMutation.isPending,
    run: async () => {
    if (!slot || !subject || inFlight.current) return;
    inFlight.current = true;
    let lesson: Lesson;
    try {
      lesson = await bookMutation.mutateAsync({ teacher_id: teacher.id, subject, starts_at: slot, duration_minutes: duration, idempotency_key: key.current });
    } finally {
      inFlight.current = false;
    }
    toast({
      tone: "success",
      title: "Aula reservada",
      description: lesson.meet_url ? "O link do Google Meet já está em Minhas aulas." : "O link do Meet aparece quando o professor sincronizar a agenda.",
    });
    setBooked(lesson);
    renew();
    onBooked?.(lesson);
    },
  };
  const fail = (e: unknown) => {
    // 409: o horário foi tomado (o cache de horários estava velho). A mutação já revalidou a lista.
    if (e instanceof ApiError && e.status === 409) renew();
    toast({ tone: "error", title: "Não foi possível reservar", description: describeError(e) });
  };

  return (
    <div className="space-y-5" data-testid="booking-panel">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Disciplina" value={subject} onChange={(e) => setSubject(e.target.value)} options={teacher.subjects.map((s) => ({ value: s, label: subjectName(s) }))} />
        <Select
          label="Duração"
          value={String(duration)}
          onChange={(e) => {
            setDuration(Number(e.target.value));
            renew();
          }}
          options={teacher.lesson_durations_minutes.map((d) => ({ value: String(d), label: `${d} minutos` }))}
        />
      </div>
      <QueryContent
        query={slots}
        loading="spinner"
        loadingLabel="Buscando horários livres…"
        isEmpty={(d) => d.slots.length === 0}
        empty={{ title: "Sem horários livres nos próximos 14 dias", description: "Tente outra duração ou volte mais tarde." }}
      >
        {(d) => (
          <div className="space-y-4" data-testid="slot-list">
            {groupSlotsByDay(d.slots).map((day) => (
              <fieldset key={day.key}>
                <legend className="text-sm font-medium text-fg-strong first-letter:uppercase">{day.label}</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {day.slots.map((s) => (
                    <Chip key={s.iso} selected={slot === s.iso} onClick={() => setSlot(s.iso)} aria-pressed={slot === s.iso}>
                      {s.time}
                    </Chip>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        )}
      </QueryContent>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!slot || !subject} loading={book.pending} onClick={() => void book.run().catch(fail)} data-testid="book-lesson">
          Reservar aula
        </Button>
        {booked && (
          <Link to="/conta/aulas" className={buttonClasses({ variant: "ghost", size: "sm" })}>
            Ver em Minhas aulas
          </Link>
        )}
      </div>
      <p className="text-xs text-fg-muted">Aula do piloto, sem cobrança. Você pode cancelar em Minhas aulas.</p>
    </div>
  );
}
