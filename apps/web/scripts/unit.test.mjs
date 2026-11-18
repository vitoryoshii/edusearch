/**
 * Testes unitários das regras determinísticas do frontend (sem navegador).
 * Rodam com `node --test` (Node 23.6+/22.18+ executa .ts com remoção de tipos).
 *
 *   pnpm --filter @edusearch/web test:unit
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { STANDARD_COMMISSION_BPS, commissionOf, formatBps, splitLessonAmount } from "../src/lib/commission.ts";
import { addDays, addMonths, conflictReason, dateKey, monthGrid, startOfWeek, weekDays } from "../src/lib/calendar.ts";
import { isTrustedMeetUrl, onlineLessonState } from "../src/lib/meeting.ts";

describe("comissão padrão de 15%", () => {
  test("a regra oficial é 15% (1500 basis points)", () => {
    assert.equal(STANDARD_COMMISSION_BPS, 1500);
    assert.equal(formatBps(STANDARD_COMMISSION_BPS), "15%");
    assert.equal(formatBps(1250), "12,5%");
  });

  test("aula de R$ 100,00 → R$ 15,00 de comissão e R$ 85,00 para o professor", () => {
    assert.deepEqual(splitLessonAmount(10000), { commissionCents: 1500, teacherShareCents: 8500 });
  });

  test("valores da demonstração (R$ 60 a R$ 110) somam exatamente o valor da aula", () => {
    for (const cents of [6000, 7000, 7500, 8000, 9500, 11000, 1, 333, 99999]) {
      const { commissionCents, teacherShareCents } = splitLessonAmount(cents);
      assert.ok(Number.isInteger(commissionCents) && Number.isInteger(teacherShareCents));
      assert.equal(commissionCents + teacherShareCents, cents);
    }
    assert.equal(commissionOf(8000), 1200);
    assert.equal(commissionOf(9500), 1425);
  });

  test("recusa valores não inteiros (sem ponto flutuante)", () => {
    assert.throws(() => commissionOf(80.5));
    assert.throws(() => commissionOf(8000, 15.5));
  });
});

describe("calendário", () => {
  test("semana começa na segunda-feira e tem 7 dias", () => {
    const days = weekDays("2026-11-19"); // quinta-feira
    assert.equal(days.length, 7);
    assert.equal(days[0], "2026-11-16");
    assert.equal(days[6], "2026-11-22");
    assert.equal(startOfWeek("2026-11-22"), "2026-11-16"); // domingo pertence à semana iniciada na segunda
  });

  test("grade do mês cobre semanas completas", () => {
    const grid = monthGrid("2026-11-10");
    assert.equal(grid.length % 7, 0);
    assert.equal(grid[0], "2026-10-26");
    assert.ok(grid.includes("2026-11-01") && grid.includes("2026-11-30"));
  });

  test("navegação de mês preserva o fim do mês", () => {
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  });

  test("conflito: aula ativa em dia bloqueado ou fora da grade", () => {
    const start = new Date(2026, 10, 19, 15, 0);
    const end = new Date(2026, 10, 19, 16, 0);
    const lesson = { status: "scheduled", start: start.toISOString(), end: end.toISOString() };
    const weekly = [{ weekday: 4, enabled: true, ranges: [{ start: "14:00", end: "17:00" }] }];
    assert.equal(conflictReason(lesson, weekly, new Set()), null);
    assert.equal(conflictReason(lesson, weekly, new Set([dateKey(start)])), "Aula marcada em um dia bloqueado");
    const reduced = [{ weekday: 4, enabled: true, ranges: [{ start: "14:00", end: "15:30" }] }];
    assert.equal(conflictReason(lesson, reduced, new Set()), "Aula fora da disponibilidade atual");
    assert.equal(conflictReason({ ...lesson, status: "cancelled" }, reduced, new Set()), null);
  });
});

describe("Google Meet", () => {
  test("só aceita URLs oficiais do Meet", () => {
    assert.equal(isTrustedMeetUrl("https://meet.google.com/abc-defg-hij"), true);
    for (const bad of [
      null,
      "",
      "http://meet.google.com/abc-defg-hij",
      "https://meet.google.com.evil.example/abc-defg-hij",
      "https://evil.example/meet.google.com/abc-defg-hij",
      "https://meet.google.com/abc-defg-hij?x=1",
      "https://meet.google.com/lookup/abc",
      "javascript:alert(1)",
    ]) {
      assert.equal(isTrustedMeetUrl(bad), false, String(bad));
    }
  });

  test("estados da aula online pelo horário e pela reserva", () => {
    const start = Date.UTC(2026, 10, 20, 22, 0);
    const lesson = (status) => ({ status, start: new Date(start).toISOString(), end: new Date(start + 3_600_000).toISOString() });
    const at = (minutesFromStart) => start + minutesFromStart * 60_000;
    assert.equal(onlineLessonState(lesson("scheduled"), at(-3 * 24 * 60)), "scheduled");
    assert.equal(onlineLessonState(lesson("scheduled"), at(-120)), "waiting");
    assert.equal(onlineLessonState(lesson("scheduled"), at(-10)), "ready");
    assert.equal(onlineLessonState(lesson("scheduled"), at(30)), "live");
    assert.equal(onlineLessonState(lesson("scheduled"), at(61)), "finished");
    assert.equal(onlineLessonState(lesson("completed"), at(-120)), "finished");
    assert.equal(onlineLessonState(lesson("cancelled"), at(-120)), "cancelled");
    assert.equal(onlineLessonState(lesson("pending_payment"), at(-10)), "awaiting_payment");
  });
});
