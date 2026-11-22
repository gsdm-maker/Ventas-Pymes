-- Reversa de congelar.sql: vuelve a permitir escrituras en public.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';

do $$
declare t record;
begin
  for t in
    select c.oid::regclass as tabla from pg_trigger g
      join pg_class c on c.oid = g.tgrelid
     where g.tgname = 'zz_corte_bloqueo' and not g.tgisinternal
  loop
    execute format('drop trigger zz_corte_bloqueo on %s', t.tabla);
  end loop;
end $$;

drop function if exists corte.bloquear();
drop schema if exists corte;

select count(*) as tablas_congeladas from pg_trigger
 where tgname = 'zz_corte_bloqueo' and not tgisinternal;
commit;
