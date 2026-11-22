-- Adopción de una base ya existente (la que dejó el DBA) a la plantilla del VPS. Paso 1 de 2.
-- Corre como postgres, DESPUÉS de 01_proyecto.sql y ANTES de levantar GoTrue y storage-api.
-- Guarda lo que depende de los `auth` y `storage` de juguete del ambiente antiguo, los retira para que
-- GoTrue y storage-api creen los verdaderos, y deja el esquema listo. Todo en una transacción.
-- Uso: psql -p 5433 -d <proyecto> -v proyecto=<proyecto> -f 01_preparar.sql
\set ON_ERROR_STOP on
\if :{?proyecto}
\else
  \echo 'Falta -v proyecto=<nombre>'
  \quit
\endif

begin;

create schema adopcion;
revoke all on schema adopcion from public;

-- Usuarios del esquema antiguo (id, correo, hash bcrypt y metadatos se conservan).
create table adopcion.usuarios as select * from auth.users;

-- Sentencias para reponer, en orden, lo que cuelga de auth.users y storage.*
create table adopcion.sentencias (orden int, sql text);

insert into adopcion.sentencias
select 10, pg_get_triggerdef(t.oid)
  from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;

insert into adopcion.sentencias
select 20, format('alter table %s add constraint %I %s', c.conrelid::regclass, c.conname, pg_get_constraintdef(c.oid))
  from pg_constraint c where c.confrelid = 'auth.users'::regclass;

create table adopcion.buckets as select id, name, public from storage.buckets;

insert into adopcion.sentencias
select 30, format('create policy %I on storage.objects as %s for %s to %s%s%s',
                  policyname, lower(permissive), lower(cmd), array_to_string(roles, ', '),
                  case when qual is not null then ' using (' || qual || ')' else '' end,
                  case when with_check is not null then ' with check (' || with_check || ')' else '' end)
  from pg_policies where schemaname = 'storage' and tablename = 'objects';

-- Retirar lo antiguo.
alter table public.profiles drop constraint profiles_id_fkey;
drop trigger on_auth_user_created on auth.users;
drop table storage.objects;       -- se lleva sus políticas
drop table storage.buckets;
drop function storage.foldername(text);
drop table auth.users;

-- auth.uid() y auth.role() las usan las políticas: se conservan y GoTrue las reemplaza (create or replace)
-- con la versión sin respaldo en app.user_id. Deben ser de su dueño para que pueda hacerlo.
alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
alter schema auth owner to supabase_auth_admin;
alter schema storage owner to supabase_storage_admin;
revoke all on schema auth from public;
revoke all on schema storage from public;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;

commit;

select 'usuarios guardados: ' || count(*) from adopcion.usuarios
union all select 'sentencias guardadas: ' || count(*) from adopcion.sentencias
union all select 'buckets guardados: ' || count(*) from adopcion.buckets;
