-- ============================================================
-- Mi Socio Pyme · Pruebas: asistente con IA (0023) — se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/asistente.sql
-- Usuarios: {{USUARIO_TIENDA}} (puesto tienda) · {{USUARIO_ADMIN}} (admin de empresa)
-- Cada caso corre en su propia subtransacción: lo que prepara no pasa al siguiente.
-- ============================================================
create temp table zz_resultados (n serial, caso text, esperado text, obtenido text);

-- p_rol: 'authenticated' (como el usuario) o 'service_role' (como la Edge Function)
create function pg_temp.probar(p_caso text, p_usuario text, p_esperado text, p_sql text,
                               p_prep text default null, p_rol text default 'authenticated')
returns void language plpgsql as $$
declare v text; v_uid uuid;
begin
  begin
    if p_prep is not null then execute p_prep; end if;
    select id into v_uid from public.profiles where email = p_usuario;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', p_rol)::text, true);
    perform set_config('role', p_rol, true);
    execute p_sql into v;
    raise exception using errcode = 'ZZ999', message = 'OK ' || coalesce(v, '-');
  exception when others then
    v := case when sqlstate = 'ZZ999' then sqlerrm else 'ERROR ' || sqlstate || ': ' || sqlerrm end;
  end;
  insert into zz_resultados (caso, esperado, obtenido) values (p_caso, p_esperado, v);
end $$;

-- ---------------- Preparación (se revierte) ----------------
create temp table zz_ctx as
select p.empresa_id as emp, p.id as admin_id,
       (select id from public.profiles where email = '{{USUARIO_TIENDA}}') as juan_id
  from public.profiles p where p.email = '{{USUARIO_ADMIN}}';
grant select on zz_ctx to authenticated, service_role;

-- Estado inicial conocido: empresa sin asistente, sin uso de hoy, juan sin ajuste del permiso
update public.empresas set plan_ia = null where id = (select emp from zz_ctx);
delete from public.uso_ia where empresa_id = (select emp from zz_ctx);
update public.profiles set permissions = permissions - 'asistente.usar'
 where id = (select juan_id from zz_ctx);

-- ---------------- Plan de la empresa ----------------
select pg_temp.probar('sin plan: el admin no puede usar el asistente', '{{USUARIO_ADMIN}}', 'OK false',
  $q$ select public.mi_uso_ia() ->> 'permitido' $q$);
select pg_temp.probar('con plan Pro: el admin puede', '{{USUARIO_ADMIN}}', 'OK true · Pro · 40',
  $q$ select (r ->> 'permitido') || ' · ' || (r ->> 'plan_nombre') || ' · ' || (r ->> 'tope_usuario')
        from public.mi_uso_ia() r $q$,
  $p$ update public.empresas set plan_ia = 'pro' where id = (select emp from zz_ctx) $p$);
select pg_temp.probar('mi_uso_ia no expone el id de empresa', '{{USUARIO_ADMIN}}', 'OK false',
  $q$ select (public.mi_uso_ia() ? 'empresa_id')::text $q$,
  $p$ update public.empresas set plan_ia = 'pro' where id = (select emp from zz_ctx) $p$);
select pg_temp.probar('admin de empresa no cambia su plan de asistente', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.empresas set plan_ia = 'max' where id = (select emp from zz_ctx) returning 1)
      select count(*)::text from u $q$);
select pg_temp.probar('admin de empresa no edita los topes de los planes', '{{USUARIO_ADMIN}}', 'OK 0',
  $q$ with u as (update public.planes_ia set mensajes_dia_usuario = 99999 returning 1) select count(*)::text from u $q$);
select pg_temp.probar('los usuarios ven los planes', '{{USUARIO_TIENDA}}', 'OK 3',
  $q$ select count(*)::text from public.planes_ia $q$);

-- ---------------- Permiso por usuario ----------------
select pg_temp.probar('juan (tienda) no tiene el permiso por defecto', '{{USUARIO_TIENDA}}', 'OK false',
  $q$ select public.mi_uso_ia() ->> 'permitido' $q$,
  $p$ update public.empresas set plan_ia = 'pro' where id = (select emp from zz_ctx) $p$);
select pg_temp.probar('juan con el permiso otorgado sí puede', '{{USUARIO_TIENDA}}', 'OK true',
  $q$ select public.mi_uso_ia() ->> 'permitido' $q$,
  $p$ update public.empresas set plan_ia = 'pro' where id = (select emp from zz_ctx);
      update public.profiles set permissions = permissions || '{"asistente.usar": true}'
       where id = (select juan_id from zz_ctx) $p$);
select pg_temp.probar('admin al que le quitaron el permiso no puede', '{{USUARIO_ADMIN}}', 'OK false',
  $q$ select public.mi_uso_ia() ->> 'permitido' $q$,
  $p$ update public.empresas set plan_ia = 'pro' where id = (select emp from zz_ctx);
      update public.profiles set permissions = permissions || '{"asistente.usar": false}'
       where id = (select admin_id from zz_ctx) $p$);

-- ---------------- Topes (como la Edge Function) ----------------
select pg_temp.probar('un usuario no puede sumarse uso a mano', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ select public.registrar_uso_ia((select admin_id from zz_ctx))::text $q$);
select pg_temp.probar('registrar_uso_ia suma el mensaje', '{{USUARIO_ADMIN}}', 'OK true · 1',
  $q$ select (r ->> 'permitido') || ' · ' || (r ->> 'usados_usuario')
        from public.registrar_uso_ia((select admin_id from zz_ctx)) r $q$,
  $p$ update public.empresas set plan_ia = 'pro' where id = (select emp from zz_ctx) $p$, 'service_role');
select pg_temp.probar('tope por usuario: el tercer mensaje con tope 2 se rechaza', '{{USUARIO_ADMIN}}', 'OK false · 2',
  $q$ select (r ->> 'permitido') || ' · ' || (select mensajes from public.uso_ia
                where user_id = (select admin_id from zz_ctx) and dia = public.hoy_negocio())
        from public.registrar_uso_ia((select admin_id from zz_ctx)) r $q$,
  $p$ update public.empresas set plan_ia = 'basico' where id = (select emp from zz_ctx);
      update public.planes_ia set mensajes_dia_usuario = 2 where plan = 'basico';
      select public.registrar_uso_ia((select admin_id from zz_ctx));
      select public.registrar_uso_ia((select admin_id from zz_ctx)) $p$, 'service_role');
select pg_temp.probar('tope por empresa: lo usado por otro cuenta', '{{USUARIO_TIENDA}}', 'OK false',
  $q$ select public.registrar_uso_ia((select juan_id from zz_ctx)) ->> 'permitido' $q$,
  $p$ update public.empresas set plan_ia = 'basico' where id = (select emp from zz_ctx);
      update public.planes_ia set mensajes_dia_empresa = 1 where plan = 'basico';
      update public.profiles set permissions = permissions || '{"asistente.usar": true}'
       where id = (select juan_id from zz_ctx);
      select public.registrar_uso_ia((select admin_id from zz_ctx)) $p$, 'service_role');
select pg_temp.probar('devolver_uso_ia descuenta un error de OpenAI', '{{USUARIO_ADMIN}}', 'OK 0',
  $q$ select mensajes::text from public.uso_ia where user_id = (select admin_id from zz_ctx)
         and dia = public.hoy_negocio() $q$,
  $p$ update public.empresas set plan_ia = 'pro' where id = (select emp from zz_ctx);
      select public.registrar_uso_ia((select admin_id from zz_ctx));
      select public.devolver_uso_ia((select admin_id from zz_ctx)) $p$, 'service_role');
select pg_temp.probar('usuario no puede ver uso_ia directo', '{{USUARIO_ADMIN}}', 'OK 0',
  $q$ select count(*)::text from public.uso_ia $q$,
  $p$ update public.empresas set plan_ia = 'pro' where id = (select emp from zz_ctx);
      select public.registrar_uso_ia((select admin_id from zz_ctx)) $p$);
select pg_temp.probar('admin de empresa no ve el uso de todas las empresas', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ select count(*)::text from public.uso_ia_empresas() $q$);

-- ---------------- Datos que consulta el asistente ----------------
select pg_temp.probar('admin consulta ventas por hora', '{{USUARIO_ADMIN}}', 'OK true',
  $q$ select (jsonb_typeof(public.ventas_por_hora(public.hoy_negocio() - 56, public.hoy_negocio()) -> 'por_hora') = 'array')::text $q$);
select pg_temp.probar('juan (sin reportes) no consulta ventas por hora', '{{USUARIO_TIENDA}}', 'ERROR P0001',
  $q$ select public.ventas_por_hora(public.hoy_negocio() - 56, public.hoy_negocio())::text $q$);
select pg_temp.probar('stock_asistente solo muestra ubicaciones permitidas', '{{USUARIO_TIENDA}}', 'OK 0',
  $q$ select count(*)::text from public.stock_asistente()
       where ubicacion not in (select nombre from public.ubicaciones where id in
             (select ubicacion_id from public.ubicacion_acceso where user_id = (select juan_id from zz_ctx))) $q$,
  $p$ delete from public.ubicacion_acceso where user_id = (select juan_id from zz_ctx);
      insert into public.ubicacion_acceso (user_id, ubicacion_id, empresa_id)
      select juan_id, (select id from public.ubicaciones where empresa_id = emp and tipo = 'tienda' and activa
                        order by nombre limit 1), emp from zz_ctx $p$);
select pg_temp.probar('stock_asistente filtra por texto', '{{USUARIO_ADMIN}}', 'OK true',
  $q$ select bool_and(producto ilike '%' || (select left(nombre, 4) from public.productos
                   where empresa_id = (select emp from zz_ctx) and activo and controla_stock limit 1) || '%'
                   or sku ilike '%' || (select left(nombre, 4) from public.productos
                   where empresa_id = (select emp from zz_ctx) and activo and controla_stock limit 1) || '%')::text
        from public.stock_asistente((select left(nombre, 4) from public.productos
                   where empresa_id = (select emp from zz_ctx) and activo and controla_stock limit 1)) $q$);

select pg_temp.probar('admin consulta análisis de productos', '{{USUARIO_ADMIN}}', 'OK true',
  $q$ select (r ? 'resumen' and jsonb_typeof(r -> 'sin_movimiento') = 'array')::text
        from public.analisis_productos(30) r $q$);
select pg_temp.probar('juan (sin reportes) no ve márgenes', '{{USUARIO_TIENDA}}', 'ERROR P0001',
  $q$ select public.analisis_productos(30)::text $q$);

-- Resultado (aborta la transacción: nada queda guardado)
do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
