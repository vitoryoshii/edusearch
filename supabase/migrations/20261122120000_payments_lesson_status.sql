-- EduSearch — Fase 5A (1/2): novos estados da aula para o fluxo pago.
--
-- Em arquivo próprio: o PostgreSQL não permite usar um valor de enum na mesma transação em que ele
-- foi criado. A migration seguinte (payments_foundation) já pode usá-los.
--
-- awaiting_payment: horário RESERVADO temporariamente enquanto o Pix não é pago (bloqueia conflito).
-- expired:          o prazo do Pix venceu sem pagamento; o horário foi liberado.

alter type public.lesson_status add value if not exists 'awaiting_payment';
alter type public.lesson_status add value if not exists 'expired';
