-- Congela las escrituras de public durante el corte. Reversa: descongelar.sql.
-- No usar default_transaction_read_only: PostgREST abre sus RPC en modo escritura y lo ignora.
-- El error 55006 llega como HTTP 500: la app lo trata como falla temporal y deja la venta en cola.
-- Con P0001 la marcaría como rechazada para siempre.
-- No cubre auth ni storage: comparar auth.users y storage.objects después del dump.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';

create schema if not exists corte;
revoke all on schema corte from public;

create or replace function corte.bloquear() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55006',
    message = 'Sistema en mantención. La operación se reintentará.';
end $$;
revoke all on function corte.bloquear() from public;

do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p') and not c.relispartition
  loop
    execute format('drop trigger if exists zz_corte_bloqueo on public.%I', t.relname);
    execute format('create trigger zz_corte_bloqueo before insert or update or delete or truncate on public.%I for each statement execute function corte.bloquear()', t.relname);
  end loop;
end $$;

select count(*) as tablas_congeladas from pg_trigger
 where tgname = 'zz_corte_bloqueo' and not tgisinternal;
commit;
