-- Plantilla VPS · verificación dentro de la base de un proyecto. Solo lectura.
-- Uso: sudo -u postgres psql -p 5433 -d <p> -f 91_verificar_base.sql
-- Correr después de levantar GoTrue y storage-api y de aplicar las migraciones.
\set ON_ERROR_STOP on

do $$
declare
  v text;
  def text;
begin
  -- 1. auth.uid() y auth.role() existen y solo leen el JWT (sin variables app.* ni rol por defecto).
  if to_regprocedure('auth.uid()') is null or to_regprocedure('auth.role()') is null then
    raise exception 'Faltan auth.uid() o auth.role(): ¿arrancó GoTrue?';
  end if;
  select string_agg(p.proname, ', ') into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'auth' and p.proname in ('uid', 'role', 'jwt', 'email')
     and (p.prosrc ~ 'app\.' or p.prosrc ~ '''authenticated''' or p.prosecdef);
  if v is not null then raise exception 'auth.% no es la definición de GoTrue', v; end if;

  -- 2. Ninguna variable de configuración guarda el secreto JWT. Lo que fija PostgREST por sesión
  --    (PGRST_APP_SETTINGS_*) no se ve desde aquí: revisar además el .env del contenedor.
  if current_setting('app.settings.jwt_secret', true) is not null
     or exists (select 1 from pg_db_role_setting s, unnest(s.setconfig) c where c ilike '%jwt_secret%') then
    raise exception 'El secreto JWT está cargado como variable de configuración';
  end if;

  -- 3. Todas las tablas de public tienen RLS.
  select string_agg(c.relname, ', ') into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v is not null then raise exception 'Tablas sin RLS: %', v; end if;

  -- 4. anon y authenticated no tienen TRUNCATE, TRIGGER ni REFERENCES en public.
  --    (storage queda con los permisos que fija storage-api; se revisa en la fase 3.)
  select string_agg(distinct table_name || ':' || grantee || ':' || privilege_type, ', ') into v
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated', 'PUBLIC')
     and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES');
  if v is not null then raise exception 'Privilegios sobrantes: %', v; end if;

  -- 5. anon y authenticated no leen ni escriben auth directamente.
  select string_agg(distinct table_name || ':' || grantee, ', ') into v
    from information_schema.role_table_grants
   where table_schema = 'auth' and grantee in ('anon', 'authenticated', 'PUBLIC');
  if v is not null then raise exception 'Acceso directo a auth: %', v; end if;

  -- 6. Nadie salvo el dueño puede crear objetos en public.
  select string_agg(r.rolname, ', ') into v from pg_roles r
   where has_schema_privilege(r.oid, 'public', 'CREATE')
     and not r.rolsuper and r.rolname !~ '_owner$';
  if v is not null then raise exception 'Roles con CREATE en public: %', v; end if;

  -- 7. Las funciones SECURITY DEFINER de public no son del superusuario y fijan search_path.
  select string_agg(p.proname, ', ') into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles o on o.oid = p.proowner
   where n.nspname = 'public' and p.prosecdef
     and (o.rolsuper or p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  if v is not null then raise exception 'SECURITY DEFINER inseguras (dueño superusuario o sin search_path): %', v; end if;

  raise notice 'Base % OK', current_database();
end $$;
