-- Plantilla VPS · paso 0 · una sola vez por cluster. Idempotente.
-- Ejecutar como superusuario:  sudo -u postgres psql -p 5433 -d postgres -f 00_cluster_una_vez.sql
-- Diseño: docs/DISENO_PLANTILLA_VPS.md (sección 4).
\set ON_ERROR_STOP on

-- Roles compartidos de la API. Sin login, sin CONNECT, nunca ALTER ROLE global.
-- Los dueños de auth/storage son por proyecto (<p>_auth_admin, <p>_storage_admin): ver 01_proyecto.sql.
do $$
declare r record;
begin
  for r in select * from (values
      ('anon', false),
      ('authenticated', false),
      ('service_role', true)
    ) v(nombre, bypass)
  loop
    if not exists (select 1 from pg_roles where rolname = r.nombre) then
      execute format('create role %I', r.nombre);
    end if;
    execute format(
      'alter role %I nologin noinherit nosuperuser nocreatedb nocreaterole noreplication %s connection limit 0',
      r.nombre, case when r.bypass then 'bypassrls' else 'nobypassrls' end);
  end loop;
end $$;

-- La base de mantenimiento y template1 no admiten conexiones de PUBLIC
-- (CREATE DATABASE copia template1 sin necesitar CONNECT).
revoke all on database postgres from public;
revoke connect on database template1 from public;

\echo 'Listo: roles compartidos y base postgres cerrada. Siguiente: 01_proyecto.sql'
