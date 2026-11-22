-- Plantilla VPS · verificación del aislamiento entre proyectos (todo el cluster). Solo lectura.
-- Uso: sudo -u postgres psql -p 5433 -d postgres -f 90_verificar_cluster.sql
-- Falla con excepción ante la primera regla rota. Diseño: docs/DISENO_PLANTILLA_VPS.md (secciones 4 y 5).
\set ON_ERROR_STOP on

do $$
declare
  v text;
  compartidos constant text[] := array['anon','authenticated','service_role','supabase_auth_admin','supabase_storage_admin'];
begin
  -- 1. Ninguna base que admita conexiones (incluida template1) acepta CONNECT de PUBLIC.
  --    datacl nulo = abierta a PUBLIC.
  select string_agg(datname, ', ') into v
    from pg_database d
   where d.datallowconn
     and (d.datacl is null
          or exists (select 1 from aclexplode(d.datacl) a where a.grantee = 0 and a.privilege_type = 'CONNECT'));
  if v is not null then raise exception 'Bases abiertas a PUBLIC: %', v; end if;

  -- 2. Los roles compartidos existen, no tienen login y no pueden conectarse a ninguna base.
  select string_agg(n, ', ') into v
    from unnest(compartidos) n
   where not exists (select 1 from pg_roles where rolname = n);
  if v is not null then raise exception 'Faltan roles compartidos: %', v; end if;

  select string_agg(rolname, ', ') into v from pg_roles where rolname = any(compartidos) and rolcanlogin;
  if v is not null then raise exception 'Roles compartidos con login: %', v; end if;

  select string_agg(r.rolname || '→' || d.datname, ', ') into v
    from pg_roles r cross join pg_database d
   where r.rolname = any(compartidos) and not d.datistemplate
     and exists (select 1 from aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
                  where a.grantee = r.oid and a.privilege_type = 'CONNECT');
  if v is not null then raise exception 'Roles compartidos con CONNECT directo: %', v; end if;

  -- 3. Sin ALTER ROLE global sobre roles compartidos (solo IN DATABASE).
  select string_agg(r.rolname, ', ') into v
    from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
   where s.setdatabase = 0 and r.rolname = any(compartidos);
  if v is not null then raise exception 'ALTER ROLE global sobre roles compartidos: %', v; end if;

  -- 4. Solo postgres y service_role saltan RLS; solo postgres es superusuario.
  select string_agg(rolname, ', ') into v from pg_roles
   where (rolbypassrls or rolsuper or rolcreaterole or rolcreatedb or rolreplication)
     and rolname not in ('postgres', 'service_role') and rolname !~ '^pg_';
  if v is not null then raise exception 'Roles con atributos peligrosos: %', v; end if;

  -- 5. Todo rol con login (salvo postgres) sigue el patrón <p>_(authenticator|auth|storage)
  --    y solo puede conectarse a la base <p>.
  select string_agg(rolname, ', ') into v from pg_roles
   where rolcanlogin and rolname <> 'postgres'
     and rolname !~ '^[a-z][a-z0-9_]{2,30}_(authenticator|auth|storage)$'
     and rolname <> 'gsdm_admin';  -- excepción conocida: acceso del DBA (CloudBeaver) solo a la base postgres, sin atributos peligrosos (ver ESTADO.md)
  if v is not null then raise exception 'Roles con login fuera de la plantilla: %', v; end if;

  select string_agg(r.rolname || '→' || d.datname, ', ') into v
    from pg_roles r cross join pg_database d
   where r.rolcanlogin and r.rolname <> 'postgres' and not d.datistemplate
     and has_database_privilege(r.oid, d.oid, 'CONNECT')
     and not (r.rolname = 'gsdm_admin' and d.datname = 'postgres')
     and d.datname <> regexp_replace(r.rolname, '_(authenticator|auth|storage)$', '');
  if v is not null then raise exception 'Roles que pueden conectarse a otra base: %', v; end if;

  -- 6. authenticator y storage cambian a anon/authenticated/service_role sin heredar.
  select string_agg(m.rolname || '∈' || g.rolname, ', ') into v
    from pg_auth_members am
    join pg_roles m on m.oid = am.member
    join pg_roles g on g.oid = am.roleid
   where g.rolname in ('anon', 'authenticated', 'service_role')
     and (am.inherit_option or m.rolname !~ '_(authenticator|storage)$');
  if v is not null then raise exception 'Membresías indebidas de roles de API: %', v; end if;

  -- 7. Solo <p>_auth y <p>_owner son miembros de supabase_auth_admin; solo <p>_storage y <p>_owner
  --    de supabase_storage_admin. Nadie tiene ADMIN OPTION sobre roles compartidos.
  select string_agg(m.rolname || '∈' || g.rolname, ', ') into v
    from pg_auth_members am
    join pg_roles m on m.oid = am.member
    join pg_roles g on g.oid = am.roleid
   where g.rolname = any(compartidos)
     and (am.admin_option
          or (g.rolname = 'supabase_auth_admin' and m.rolname !~ '_(auth|owner)$')
          or (g.rolname = 'supabase_storage_admin' and m.rolname !~ '_(storage|owner)$'));
  if v is not null then raise exception 'Membresías indebidas de roles de servicio: %', v; end if;

  raise notice 'Cluster OK: aislamiento entre proyectos verificado';
end $$;
