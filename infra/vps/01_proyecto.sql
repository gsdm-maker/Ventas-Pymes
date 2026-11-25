-- Plantilla VPS · paso 1 · crea roles, base y esquemas vacíos de un proyecto. Idempotente.
-- Diseño: docs/DISENO_PLANTILLA_VPS.md (secciones 4, 5 y 7).
--
-- Uso (como root, con las claves en el entorno, nunca en la línea de comandos):
--   set -a; . /srv/<p>/.env; set +a
--   runuser -u postgres -- psql -p 5433 -d postgres -v proyecto=<p> -f 01_proyecto.sql
-- (runuser conserva el entorno; sudo-rs de Ubuntu 26.04 no admite `sudo -E`).
-- Variables de entorno requeridas: CLAVE_AUTHENTICATOR, CLAVE_AUTH, CLAVE_STORAGE
-- (generar con: openssl rand -base64 32 | tr -d '/+=' ).
\set ON_ERROR_STOP on

-- No dejar las claves en el log del servidor ni en pg_stat_statements (guarda el texto de ALTER ROLE).
set log_statement = 'none';
set log_min_error_statement = 'panic';
set log_min_duration_statement = -1;
set pg_stat_statements.track_utility = off;

\if :{?proyecto}
\else
  \echo 'Falta -v proyecto=<nombre>'
  \quit
\endif

-- Sin sufijos de rol, para que el rol <p>_auth nunca se confunda con un proyecto llamado <x>_auth.
select :'proyecto' ~ '^[a-z][a-z0-9_]{2,30}$'
   and :'proyecto' !~ '_(owner|authenticator|auth|storage|auth_admin|storage_admin)$'
   and :'proyecto' not in ('postgres', 'template0', 'template1') as nombre_ok \gset
\if :nombre_ok
\else
  \echo 'Nombre de proyecto inválido: minúsculas, números y _, de 3 a 31 caracteres, sin terminar en _owner/_authenticator/_auth/_storage/_auth_admin/_storage_admin'
  \quit
\endif

\getenv clave_authenticator CLAVE_AUTHENTICATOR
\getenv clave_auth CLAVE_AUTH
\getenv clave_storage CLAVE_STORAGE
\if :{?clave_authenticator}
\else
  \echo 'Falta CLAVE_AUTHENTICATOR en el entorno'
  \quit
\endif
\if :{?clave_auth}
\else
  \echo 'Falta CLAVE_AUTH en el entorno'
  \quit
\endif
\if :{?clave_storage}
\else
  \echo 'Falta CLAVE_STORAGE en el entorno'
  \quit
\endif

select length(:'clave_authenticator') >= 32 and length(:'clave_auth') >= 32 and length(:'clave_storage') >= 32 as claves_ok \gset
\if :claves_ok
\else
  \echo 'Las claves deben tener al menos 32 caracteres'
  \quit
\endif

\set rol_owner :proyecto '_owner'
\set rol_authenticator :proyecto '_authenticator'
\set rol_auth :proyecto '_auth'
\set rol_storage :proyecto '_storage'
\set rol_auth_admin :proyecto '_auth_admin'
\set rol_storage_admin :proyecto '_storage_admin'

-- ---------------- Roles del proyecto ----------------
select format('create role %I', r) from unnest(array[:'rol_owner', :'rol_authenticator', :'rol_auth', :'rol_storage', :'rol_auth_admin', :'rol_storage_admin']) r
 where not exists (select 1 from pg_roles where rolname = r) \gexec

alter role :"rol_owner" nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role :"rol_authenticator" login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 30 password :'clave_authenticator';
alter role :"rol_auth" login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 10 password :'clave_auth';
alter role :"rol_storage" login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 10 password :'clave_storage';
-- Dueños de esquema por proyecto: sin login y sin atributos peligrosos.
alter role :"rol_auth_admin" nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 0;
alter role :"rol_storage_admin" nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 0;

-- PostgREST: solo cambia de rol por petición, no hereda privilegios.
grant anon, authenticated, service_role to :"rol_authenticator" with inherit false, set true;
-- GoTrue: dueño de auth.
grant :"rol_auth_admin" to :"rol_auth" with inherit true, set true;
-- storage-api: dueño de storage y cambia de rol por petición.
grant :"rol_storage_admin" to :"rol_storage" with inherit true, set true;
grant anon, authenticated, service_role to :"rol_storage" with inherit false, set true;
-- Dueño de public: necesita ser dueño efectivo de auth y storage para crear
-- triggers sobre auth.users y políticas sobre storage.objects (migraciones 0001 y 0016).
grant :"rol_auth_admin", :"rol_storage_admin" to :"rol_owner" with inherit true, set false;

-- ---------------- Base ----------------
select format('create database %I with owner %I template template0 encoding %L', :'proyecto', :'rol_owner', 'UTF8')
 where not exists (select 1 from pg_database where datname = :'proyecto') \gexec

revoke all on database :"proyecto" from public;
grant connect on database :"proyecto" to :"rol_authenticator", :"rol_auth", :"rol_storage";

alter role anon in database :"proyecto" set statement_timeout = '3s';
alter role authenticated in database :"proyecto" set statement_timeout = '8s';
alter role :"rol_authenticator" in database :"proyecto" set statement_timeout = '8s';
alter database :"proyecto" set search_path = "$user", public, extensions;
-- storage-api usa este GUC para identificar al dueño del esquema storage.
alter database :"proyecto" set storage.super_user = :'rol_storage_admin';
-- GoTrue y storage-api arrancan su sesión como el rol dueño del esquema. Si no, lo que crean sus
-- migraciones queda a nombre del rol con login y <p>_owner no puede crear el trigger sobre
-- auth.users (0001) ni las políticas sobre storage.objects (0016).
alter role :"rol_auth" in database :"proyecto" set role = :'rol_auth_admin';
alter role :"rol_auth" in database :"proyecto" set search_path = auth;
alter role :"rol_storage" in database :"proyecto" set role = :'rol_storage_admin';
alter role :"rol_storage" in database :"proyecto" set search_path = storage;

-- ---------------- Dentro de la base ----------------
\connect :"proyecto"
set log_statement = 'none';

revoke all on schema public from public;
alter schema public owner to :"rol_owner";
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists extensions authorization :"rol_owner";
revoke all on schema extensions from public;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;

-- Vacíos: GoTrue y storage-api crean sus tablas y funciones al arrancar.
create schema if not exists auth authorization :"rol_auth_admin";
revoke all on schema auth from public;
grant usage on schema auth to anon, authenticated, service_role;

create schema if not exists storage authorization :"rol_storage_admin";
revoke all on schema storage from public;
grant usage on schema storage to anon, authenticated, service_role;

-- Privilegios por defecto para lo que creen las migraciones (corren con SET ROLE <p>_owner).
alter default privileges for role :"rol_owner" in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges for role :"rol_owner" in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges for role :"rol_owner" in schema public
  grant execute on functions to anon, authenticated, service_role;

\echo 'Listo. Siguiente: agregar la línea del proyecto a pg_hba.conf y recargar, levantar GoTrue y storage-api,'
\echo 'aplicar migraciones con SET ROLE <p>_owner y correr 91_verificar_base.sql y 90_verificar_cluster.sql.'
