import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, Chip, Select, Card, buttonClasses, useToast } from "@edusearch/ui";
import { QueryContent } from "../QueryContent";
import { ApiError, describeError } from "../../lib/api/client";
import type { Lesson } from "../../lib/api/scheduling";
import { FEATURES } from "../../lib/features";
import { useBookLessonMutation, useCheckoutMutation, useSlotsQuery } from "../../lib/query/hooks";
import { SLOT_PERIOD_LABEL, dateParts, groupSlotsByDay, groupSlotsByPeriod, timeOf } from "../../lib/scheduling";

type Offer = { id: string; display_name?: string | null; subjects: string[]; lesson_durations_minutes: number[] };

/**
 * Reserva de aula de TESTE com UM professor (perfil público). Disciplina e duração vêm do cadastro
 * real; os horários, da API (fuso de Brasília). Idempotência por intenção de reserva: clique duplo
 * ou nova tentativa devolvem a MESMA aula.
 *
 * Com pagamentos ligados (Fase 5), a reserva vira um checkout Pix: o servidor reserva o horário
 * (aguardando pagamento), calcula o valor e gera o Pix; o app só envia o horário escolhido.
 */
export function BookingPanel({ teacher, subjectName, onBooked }: { teacher: Offer; subjectName: (slug: string) => string; onBooked?: (lesson: Lesson) => void }) {
  const toast = useToast();
  const [subject, setSubject] = useState(teacher.subjects[0] ?? "");
  const [duration, setDuration] = useState(teacher.lesson_durations_minutes[0] ?? 60);
  const [slot, setSlot] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [slotNotice, setSlotNotice] = useState<string | null>(null);
  const [booked, setBooked] = useState<Lesson | null>(null);
  // Uma chave por INTENÇÃO de reserva; envio em andamento ignora um segundo clique.
  const key = useRef<string>(crypto.randomUUID());
  const inFlight = useRef(false);
  // Horários em cache aparecem na hora e são revalidados; quem garante o horário é o servidor (409).
  const slots = useSlotsQuery(teacher.id, duration);
  const bookMutation = useBookLessonMutation();
  const checkoutMutation = useCheckoutMutation();
  const navigate = useNavigate();
  const paid = FEATURES.payments !== "off";
  // A API é a fonte de verdade: se uma revalidação retirar o horário, não deixa o CTA usar cache antigo.
  useEffect(() => {
    if (slot && slots.data && !slots.data.slots.includes(slot)) {
      setSlot(null);
      setSlotNotice("Este horário acabou de ficar indisponível. Escolha outro horário para continuar.");
    }
  }, [slot, slots.data]);
  const renew = () => {
    setSlot(null);
    setSelectedDay(null);
    setSlotNotice(null);
    key.current = crypto.randomUUID();
  };
  const book = {
    pending: bookMutation.isPending || checkoutMutation.isPending,
    run: async () => {
    if (!slot || !subject || inFlight.current) return;
    inFlight.current = true;
    if (paid) {
      try {
        const payment = await checkoutMutation.mutateAsync({ teacher_id: teacher.id, subject, starts_at: slot, duration_minutes: duration, idempotency_key: key.current });
        renew();
        navigate(`/conta/pagamentos/${payment.id}`);
      } finally {
        inFlight.current = false;
      }
      return;
    }
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
    if (e instanceof ApiError && e.status === 409) {
      renew();
      setSlotNotice("Este horário acabou de ficar indisponível. Escolha outro horário para continuar.");
    }
    toast({ tone: "error", title: "Não foi possível reservar", description: describeError(e) });
  };

  return (
    <div className="min-w-0 space-y-5" data-testid="booking-panel">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Select label="Disciplina" className="min-w-0" value={subject} onChange={(e) => setSubject(e.target.value)} options={teacher.subjects.map((s) => ({ value: s, label: subjectName(s) }))} />
        <Select
          label="Duração"
          className="min-w-0"
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
          <>
            <SlotPicker
              slots={d.slots}
              selectedDay={selectedDay}
              setSelectedDay={setSelectedDay}
              slot={slot}
              setSlot={(next) => {
                setSlotNotice(null);
                setSlot(next);
              }}
            />
            {slotNotice && <p role="status" className="text-sm font-medium text-warning-text">{slotNotice}</p>}
          </>
        )}
      </QueryContent>
      <BookingSummary teacher={teacher} subjectName={subjectName} subject={subject} duration={duration} slot={slot} paid={paid} />
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Button className="w-full sm:w-auto" disabled={!slot || !subject} loading={book.pending} onClick={() => void book.run().catch(fail)} data-testid="book-lesson">
          {!slot ? "Escolha uma data e horário" : paid ? "Reservar e pagar com Pix" : "Confirmar reserva"}
        </Button>
        {booked && (
          <Link to="/conta/aulas" className={buttonClasses({ variant: "ghost", size: "sm" })}>
            Ver em Minhas aulas
          </Link>
        )}
      </div>
      {booked && <p className="text-sm font-medium text-success-text" role="status">Reserva confirmada. Você encontra os detalhes em Minhas aulas.</p>}
      <p className="text-xs text-fg-muted">
        {paid
          ? `O horário fica reservado enquanto o Pix estiver válido.${FEATURES.payments === "sandbox" ? " Ambiente de testes: sem dinheiro real." : ""}`
          : "Aula do piloto, sem cobrança. Você pode cancelar em Minhas aulas."}
      </p>
    </div>
  );
}

function SlotPicker({ slots, selectedDay, setSelectedDay, slot, setSlot }: { slots: string[]; selectedDay: string | null; setSelectedDay: (day: string) => void; slot: string | null; setSlot: (slot: string) => void }) {
  const days = useMemo(() => groupSlotsByDay(slots), [slots]);
  const activeDay = days.some((day) => day.key === selectedDay) ? selectedDay : days[0]?.key;
  const day = days.find((item) => item.key === activeDay);
  if (!day) return null;
  return (
    <div className="min-w-0 space-y-4">
      <fieldset data-testid="date-picker" className="min-w-0">
        <legend className="text-sm font-semibold text-fg-strong">Escolha uma data</legend>
        <div className="mt-2 flex max-w-full snap-x gap-2 overflow-x-auto overscroll-x-contain pb-2 pr-3 scroll-smooth" aria-label="Próximas datas com horários livres">
          {days.map((item) => {
            const parts = dateParts(item.slots[0]!.iso);
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={item.key === activeDay}
                onClick={() => {
                  setSelectedDay(item.key);
                  setSlot("");
                }}
                className={`w-20 shrink-0 snap-start rounded-control border px-2 py-2.5 text-center transition-colors ${item.key === activeDay ? "border-primary bg-primary text-primary-fg" : "border-line bg-surface hover:bg-surface-muted"}`}
              >
                <span className="block text-xs font-semibold tracking-wide uppercase">{parts.weekday}</span>
                <span className="mt-0.5 block text-sm font-semibold tabular-nums">{parts.day} {parts.month}</span>
                <span className="mt-1 block text-[0.6875rem] opacity-80">{item.slots.length} horários</span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <div data-testid="slot-list" className="min-w-0">
        <p className="text-sm font-semibold text-fg-strong first-letter:uppercase">{day.label}</p>
        <div className="mt-3 space-y-3">
          {groupSlotsByPeriod(day.slots).map((group) => (
            <fieldset key={group.period} className="min-w-0">
              <legend className="text-xs font-medium text-fg-muted">{SLOT_PERIOD_LABEL[group.period]}</legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {group.slots.map((item) => <Chip key={item.iso} selected={slot === item.iso} onClick={() => setSlot(item.iso)} aria-pressed={slot === item.iso}>{item.time}</Chip>)}
              </div>
            </fieldset>
          ))}
        </div>
      </div>
    </div>
  );
}

function BookingSummary({ teacher, subjectName, subject, duration, slot, paid }: { teacher: Offer; subjectName: (slug: string) => string; subject: string; duration: number; slot: string | null; paid: boolean }) {
  const parts = slot ? dateParts(slot) : null;
  const rows = [
    ["Professor", teacher.display_name ?? "Professor selecionado"],
    ["Disciplina", subject ? subjectName(subject) : "—"],
    ["Duração", `${duration} minutos`],
    ["Data", parts ? `${parts.weekday.toUpperCase()}, ${parts.day} ${parts.month}` : "Escolha um horário"],
    ["Horário", slot ? timeOf(slot) : "—"],
  ];
  return (
    <Card tone="soft" aria-live="polite" data-testid="booking-summary" className="min-w-0">
      <h3 className="font-semibold text-fg-strong">Resumo da reserva</h3>
      <dl className="mt-3 space-y-3 text-sm text-fg-muted">
        {rows.map(([label, value]) => (
          <div key={label} className="grid min-w-0 gap-1 min-[380px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] min-[380px]:gap-3">
            <dt>{label}</dt>
            <dd className="min-w-0 break-words font-medium text-fg min-[380px]:text-right">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs leading-relaxed text-fg-muted">{paid ? "O valor e o Pix são definidos com segurança pelo servidor na próxima etapa." : "Aula do piloto, sem cobrança."}</p>
    </Card>
  );
}
