"""Regras puras de agenda: janelas semanais, horários livres e validação de reserva.

Mesmas regras do trigger ``private.lessons_before_insert`` (defesa em profundidade):
fuso America/Sao_Paulo, aula dentro de UMA janela do dia, início no futuro e até 60 dias.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, timezone, tzinfo

WEEKDAYS = ("seg", "ter", "qua", "qui", "sex", "sab", "dom")  # isoweekday 1..7

MIN_NOTICE = timedelta(hours=2)  # antecedência mínima para reservar
MAX_HORIZON = timedelta(days=60)  # igual ao trigger do banco
SLOT_STEP_MINUTES = 30
MAX_WINDOWS = 28


def _local_tz() -> tzinfo:
    try:
        from zoneinfo import ZoneInfo  # noqa: PLC0415

        return ZoneInfo("America/Sao_Paulo")
    except Exception:  # noqa: BLE001 — sem base de fusos (Windows/Pyodide sem tzdata)
        # Sem horário de verão no Brasil desde 2019: -03:00 fixo equivale a America/Sao_Paulo.
        return timezone(timedelta(hours=-3), "America/Sao_Paulo")


LOCAL_TZ = _local_tz()


@dataclass(frozen=True, order=True)
class Window:
    weekday: str
    start_minute: int
    end_minute: int


class InvalidWindowsError(ValueError):
    pass


def minutes_from_hhmm(value: str) -> int:
    hh, mm = value.split(":")
    minutes = int(hh) * 60 + int(mm)
    if not (0 <= minutes <= 1440) or len(hh) != 2 or len(mm) != 2:
        raise ValueError("horário inválido")
    return minutes


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def normalize_windows(windows: list[Window]) -> list[Window]:
    """Ordena e recusa sobreposição, granularidade fora de 15 min e excesso de janelas."""
    if len(windows) > MAX_WINDOWS:
        raise InvalidWindowsError(f"no máximo {MAX_WINDOWS} janelas")
    ordered = sorted(windows, key=lambda w: (WEEKDAYS.index(w.weekday), w.start_minute))
    for w in ordered:
        if w.weekday not in WEEKDAYS:
            raise InvalidWindowsError("dia da semana inválido")
        if not (0 <= w.start_minute < w.end_minute <= 1440):
            raise InvalidWindowsError("o fim precisa ser depois do início")
        if w.start_minute % 15 or w.end_minute % 15:
            raise InvalidWindowsError("use horários de 15 em 15 minutos")
    for a, b in zip(ordered, ordered[1:], strict=False):
        if a.weekday == b.weekday and b.start_minute < a.end_minute:
            raise InvalidWindowsError(f"janelas sobrepostas em {a.weekday}")
    return ordered


def _local(dt: datetime) -> datetime:
    return dt.astimezone(LOCAL_TZ)


def _overlaps(start: datetime, end: datetime, busy: list[tuple[datetime, datetime]]) -> bool:
    return any(start < b_end and b_start < end for b_start, b_end in busy)


def booking_problem(
    start: datetime,
    duration_minutes: int,
    windows: list[Window],
    busy: list[tuple[datetime, datetime]],
    *,
    now: datetime,
) -> str | None:
    """Motivo (em português) para o horário NÃO poder ser reservado; ``None`` se puder."""
    if start.tzinfo is None:
        return "informe o horário com fuso"
    end = start + timedelta(minutes=duration_minutes)
    if start < now + MIN_NOTICE:
        return "reserve com pelo menos 2 horas de antecedência"
    if start > now + MAX_HORIZON:
        return "reserve com até 60 dias de antecedência"
    local_start, local_end = _local(start), _local(end)
    if local_start.date() != local_end.date() and local_end.time() != time(0, 0):
        return "a aula precisa terminar no mesmo dia"
    weekday = WEEKDAYS[local_start.isoweekday() - 1]
    s = local_start.hour * 60 + local_start.minute
    e = s + duration_minutes
    if local_start.second or local_start.microsecond or s % 15:
        return "horário inválido"
    if not any(w.weekday == weekday and w.start_minute <= s and e <= w.end_minute for w in windows):
        return "horário fora da disponibilidade do professor"
    if _overlaps(start, end, busy):
        return "horário indisponível"
    return None


def available_slots(
    windows: list[Window],
    duration_minutes: int,
    busy: list[tuple[datetime, datetime]],
    *,
    now: datetime,
    days: int = 14,
) -> list[datetime]:
    """Inícios livres (UTC), de 30 em 30 min, nos próximos ``days`` dias (horário local)."""
    days = max(1, min(days, MAX_HORIZON.days))
    today = _local(now).date()
    result: list[datetime] = []
    for offset in range(days + 1):
        day: date = today + timedelta(days=offset)
        weekday = WEEKDAYS[day.isoweekday() - 1]
        for w in windows:
            if w.weekday != weekday:
                continue
            minute = w.start_minute
            while minute + duration_minutes <= w.end_minute:
                local = datetime.combine(day, time(0, 0), tzinfo=LOCAL_TZ) + timedelta(
                    minutes=minute
                )
                start = local.astimezone(UTC)
                if booking_problem(start, duration_minutes, windows, busy, now=now) is None:
                    result.append(start)
                minute += SLOT_STEP_MINUTES
    return sorted(set(result))
