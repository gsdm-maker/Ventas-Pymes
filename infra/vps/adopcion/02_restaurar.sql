-- Adopción de una base existente. Paso 2 de 2.
-- Corre como postgres DESPUÉS de que GoTrue y storage-api crearon sus tablas.
-- Repone usuarios, identidades, bucket, políticas, triggers y claves foráneas, pasa el dueño de `public`
-- al rol <proyecto>_owner, y quita al rol del ambiente antiguo.
-- Uso: psql -p 5433 -d <proyecto> -v proyecto=<proyecto> -v rol_antiguo=<rol_app_del_dba> -f 02_restaurar.sql
\set ON_ERROR_STOP on
\if :{?proyecto}
\else
  \echo 'Falta -v proyecto=<nombre>'
  \quit
\endif

begin;

-- Usuarios con el mismo id (la cola offline se filtra por user_id) y el mismo hash.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       u.encrypted_password, coalesce(u.email_confirmed_at, now()),
       coalesce(u.raw_app_meta_data, '{"provider":"email","providers":["email"]}'::jsonb),
       coalesce(u.raw_user_meta_data, '{}'::jsonb),
       coalesce(u.created_at, now()), coalesce(u.updated_at, now()), '', '', '', ''
  from adopcion.usuarios u;

insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
select u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
       'email', now(), now(), null
  from adopcion.usuarios u;

-- Bucket de fotos y lo que colgaba de auth.users / storage.*
insert into storage.buckets (id, name, public)
select id, name, public from adopcion.buckets on conflict (id) do nothing;

do $$
declare s record;
begin
  for s in select sql from adopcion.sentencias order by orden loop
    execute s.sql;
  end loop;
end $$;

-- Dueño de lo de `public`: <proyecto>_owner (las funciones SECURITY DEFINER dejan de correr como superusuario).
select format('alter schema public owner to %I', :'proyecto' || '_owner') \gexec
select format('alter %s %s owner to %I',
              case c.relkind when 'v' then 'view' when 'm' then 'materialized view' when 'f' then 'foreign table' else 'table' end,
              c.oid::regclass, :'proyecto' || '_owner')
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
   and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') \gexec
select format('alter sequence %s owner to %I', c.oid::regclass, :'proyecto' || '_owner')
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
   and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('a', 'i', 'e')) \gexec
select format('alter %s %s owner to %I', case p.prokind when 'p' then 'procedure' else 'function' end,
              p.oid::regprocedure, :'proyecto' || '_owner')
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') \gexec
select format('alter type %s owner to %I', t.oid::regtype, :'proyecto' || '_owner')
  from pg_type t
 where t.typnamespace = 'public'::regnamespace and t.typtype in ('e', 'd')
   and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e') \gexec

-- Privilegios: sin TRUNCATE, TRIGGER ni REFERENCES para anon y authenticated (hallazgo A10).
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- Rol del ambiente antiguo (hallazgos A2 y A11): se elimina (sus permisos y membresías en anon/authenticated/service_role incluidos).
\if :{?rol_antiguo}
select format('alter database %I owner to %I', :'proyecto', :'proyecto' || '_owner') \gexec
select format('drop owned by %I', :'rol_antiguo') \gexec
select format('drop role %I', :'rol_antiguo') \gexec
\endif

drop schema adopcion cascade;

commit;
\echo 'Listo. Siguiente: migraciones faltantes con SET ROLE <proyecto>_owner, 91_verificar_base.sql y las suites.'
