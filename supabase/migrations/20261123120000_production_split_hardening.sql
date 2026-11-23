-- PR #31 — split Pix de produção: recebedor isolado por ambiente e nenhuma liquidação presumida.
-- Esta migration é aditiva para registros históricos: não altera payment_intents existentes, seus
-- snapshots de comissão ou splits já registrados. Aplicar somente após revisão operacional.

-- A mesma pessoa pode possuir subcontas distintas no Sandbox e em Production. O identificador do
-- gateway continua único globalmente, mas a identidade da conta passa a ser (professor, ambiente).
alter table public.teacher_payout_accounts
  drop constraint teacher_payout_accounts_pkey;
alter table public.teacher_payout_accounts
  add primary key (teacher_id, environment);

-- Uma conta já vinculada não pode ser trocada pelo professor através do formulário. A API só chama
-- esta função após a resposta autenticada do gateway conferir externalId e ambiente.
create or replace function private.payout_account_upsert(
  p_sacc text, p_last4 text, p_env public.payment_environment
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher uuid := private.claims_sub();
begin
  if v_teacher is null or not exists (
    select 1 from public.account_roles r where r.user_id = v_teacher and r.role = 'teacher'
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'role_required';
  end if;

  insert into public.teacher_payout_accounts (teacher_id, sub_account_id, environment, tax_id_last4)
  values (v_teacher, p_sacc, p_env, p_last4)
  on conflict (teacher_id, environment) do update
     set tax_id_last4 = excluded.tax_id_last4,
         status = 'active'
   where public.teacher_payout_accounts.sub_account_id = excluded.sub_account_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'payout_account_conflict';
  end if;
end;
$$;

-- Pix pago confirma a aula, mas não é prova por si só de saldo liquidado ou sacável da subconta.
-- ``credited`` fica reservado para futura evidência conciliável do provedor; novos splits seguem
-- ``pending`` depois da confirmação até que essa evidência exista.
create or replace function private.payment_confirm(p_charge text, p_paid_amount integer, p_source text)
returns table (intent_id uuid, lesson_id uuid, student_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_intents;
  v_lesson_status public.lesson_status;
  v_outcome text := 'confirmed';
begin
  select * into v from public.payment_intents p where p.gateway_charge_id = p_charge for update;
  if not found then
    return query select null::uuid, null::uuid, null::uuid, 'unknown_charge'::text;
    return;
  end if;
  if v.status in ('paid', 'refunded', 'under_dispute') then
    return query select v.id, v.lesson_id, v.student_id, 'already_processed'::text;
    return;
  end if;
  if p_paid_amount is distinct from v.amount_cents then
    perform private.payment_audit(v.id, v.status::text, v.status::text, p_source,
      format('valor divergente: esperado %s, recebido %s', v.amount_cents, p_paid_amount));
    return query select v.id, v.lesson_id, v.student_id, 'amount_mismatch'::text;
    return;
  end if;

  update public.payment_intents
     set status = 'paid', paid_at = pg_catalog.now(), paid_amount_cents = p_paid_amount
   where id = v.id;
  perform private.payment_audit(v.id, v.status::text, 'paid', p_source, null);

  select l.status into v_lesson_status from public.lessons l where l.id = v.lesson_id for update;
  if v_lesson_status = 'awaiting_payment' then
    update public.lessons set status = 'scheduled' where id = v.lesson_id;
  elsif v_lesson_status = 'expired' then
    begin
      update public.lessons set status = 'scheduled' where id = v.lesson_id;
      v_outcome := 'confirmed_late';
    exception when exclusion_violation then
      insert into public.refund_requests (intent_id, reason, requested_by, amount_cents)
      values (v.id, 'late_payment_slot_taken', 'system', v.amount_cents)
      on conflict do nothing;
      v_outcome := 'paid_slot_lost';
    end;
  elsif v_lesson_status = 'cancelled' then
    insert into public.refund_requests (intent_id, reason, requested_by, amount_cents)
    values (v.id, 'paid_after_cancel', 'system', v.amount_cents)
    on conflict do nothing;
    v_outcome := 'paid_after_cancel';
  end if;
  perform private.payment_audit(v.id, 'paid', 'paid', p_source, v_outcome);
  return query select v.id, v.lesson_id, v.student_id, v_outcome;
end;
$$;

revoke all on function private.payout_account_upsert(text, text, public.payment_environment)
  from public, anon, authenticated;
grant execute on function private.payout_account_upsert(text, text, public.payment_environment)
  to edusearch_api;
revoke all on function private.payment_confirm(text, integer, text) from public, anon, authenticated;
grant execute on function private.payment_confirm(text, integer, text) to edusearch_api;
