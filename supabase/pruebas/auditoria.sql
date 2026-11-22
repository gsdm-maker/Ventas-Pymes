-- ============================================================
-- Mi Socio Pyme · Pruebas: auditoría para el administrador general (0031) — se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs --ensayo supabase/migrations/0031_auditoria_para_el_dueno.sql supabase/pruebas/auditoria.sql
-- Usuarios: {{USUARIO_TIENDA}} (puesto tienda) · {{USUARIO_ADMIN}} (admin de empresa)
-- ============================================================
create temp table zz_resultados (n serial, caso text, esperado text, obtenido text);

create function pg_temp.probar(p_caso text, p_usuario text, p_esperado text, p_sql text, p_prep text default null)
returns void language plpgsql as $$
declare v text; v_uid uuid;
begin
  begin
    if p_prep is not null then execute p_prep; end if;
    if p_usuario <> 'directo' then
      select id into v_uid from public.profiles where email = p_usuario;
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
    end if;
    execute p_sql into v;
    raise exception using errcode = 'ZZ999', message = 'OK ' || coalesce(v, '-');
  exception when others then
    v := case when sqlstate = 'ZZ999' then sqlerrm else 'ERROR ' || sqlstate || ': ' || sqlerrm end;
  end;
  insert into zz_resultados (caso, esperado, obtenido) values (p_caso, p_esperado, v);
end $$;

insert into public.admin_auditoria (accion, detalle) values ('prueba_0031', '{}'::jsonb);

select pg_temp.probar('admin de empresa no ve la auditoría', '{{USUARIO_ADMIN}}', 'OK 0',
  $q$ select count(*)::text from public.admin_auditoria where accion = 'prueba_0031' $q$);
select pg_temp.probar('tienda no ve la auditoría', '{{USUARIO_TIENDA}}', 'OK 0',
  $q$ select count(*)::text from public.admin_auditoria where accion = 'prueba_0031' $q$);
select pg_temp.probar('admin de empresa no inserta en la auditoría', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with i as (insert into public.admin_auditoria (accion) values ('falsa') returning 1) select count(*)::text from i $q$);
select pg_temp.probar('admin de empresa no borra la auditoría', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with d as (delete from public.admin_auditoria returning 1) select count(*)::text from d $q$);
select pg_temp.probar('el administrador general sí la ve', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ select count(*)::text from public.admin_auditoria where accion = 'prueba_0031' $q$,
  $p$ select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      update public.profiles set es_owner = true where email = '{{USUARIO_ADMIN}}' $p$);
select pg_temp.probar('el administrador general no inserta directo', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with i as (insert into public.admin_auditoria (accion) values ('falsa') returning 1) select count(*)::text from i $q$,
  $p$ select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      update public.profiles set es_owner = true where email = '{{USUARIO_ADMIN}}' $p$);
select pg_temp.probar('anon no ve la auditoría', 'directo', 'ERROR 42501',
  $q$ select count(*)::text from public.admin_auditoria $q$,
  $p$ set local role anon $p$);

do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
