-- EduSearch — Fase 2.6A: endurecimento de public.rls_auto_enable().
--
-- O projeto remoto possui public.rls_auto_enable(), função de event trigger que liga o RLS em
-- tabelas novas. O mecanismo deve continuar funcionando; o problema é o privilégio EXECUTE
-- padrão (PUBLIC → anon/authenticated), apontado pelo Security Advisor (lints 0028/0029), e um
-- search_path possivelmente mutável (lint 0011).
--
-- Correção:
-- * revoga EXECUTE de PUBLIC, anon e authenticated. Event triggers são disparados pelo servidor
--   e NÃO conferem EXECUTE de quem executa o DDL (comportamento verificado no PostgreSQL 17:
--   o RLS continua sendo ligado em tabelas criadas por um papel sem EXECUTE);
-- * fixa search_path = '' (o corpo usa pg_event_trigger_ddl_commands(), de pg_catalog, que é
--   sempre pesquisado, e object_identity já vem qualificado com o schema).
--
-- Idempotente e condicional: em um banco limpo (local/CI) a função não existe e nada é feito.
-- ANTES de aplicar no remoto, conferir o corpo da função (docs/database-design.md, seção
-- "rls_auto_enable") — se ele usar nomes sem schema, ajustar o search_path em vez de ''.

do $$
declare
  v_fn regprocedure := to_regprocedure('public.rls_auto_enable()');
begin
  if v_fn is null then
    raise notice 'public.rls_auto_enable() não existe neste banco; nada a fazer.';
    return;
  end if;

  execute 'revoke all on function public.rls_auto_enable() from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.rls_auto_enable() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.rls_auto_enable() from authenticated';
  end if;

  execute 'alter function public.rls_auto_enable() set search_path = ''''';
end
$$;
