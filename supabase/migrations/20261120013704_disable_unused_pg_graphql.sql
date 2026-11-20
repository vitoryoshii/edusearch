-- EduSearch — Fase 2.6A: remove a extensão pg_graphql, que o EduSearch não usa.
--
-- Motivo: com pg_graphql instalada, toda tabela com SELECT para anon/authenticated fica visível
-- no schema GraphQL (lints 0026/0027 do Security Advisor). O EduSearch não usa GraphQL: o
-- frontend fala com a API FastAPI e, quando usa o Supabase, com Auth/REST. Os GRANTs e as
-- políticas RLS continuam exatamente como estão; só a superfície GraphQL deixa de existir.
--
-- * Projeto remoto edusearch-db: a extensão NÃO está instalada → este comando não faz nada.
-- * Banco local do Supabase CLI: a imagem instala pg_graphql por padrão → é removida aqui.
-- * Sem CASCADE: se algum objeto depender da extensão, a migration FALHA em vez de apagá-lo.
--
-- O endpoint /graphql/v1 também deixa de ser exposto localmente (graphql_public foi retirado de
-- [api].schemas em supabase/config.toml). Rollback: docs/database-design.md → "GraphQL".

drop extension if exists pg_graphql;
