-- ============================================================
-- Mi Socio Pyme · Pruebas de la proyección de reposición — se ejecutan y se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/reposicion.sql
--      (anteponer la migración con --antes para probarla sin aplicarla)
-- Caso controlado: producto ZZ-REPO en la primera tienda, 8 semanas con
-- 2 u/día de lunes a jueves y 6 u/día de viernes a domingo (26 u/semana).
-- ============================================================
create temp table zz_resultados (n serial, caso text, esperado text, obtenido text);

create function pg_temp.probar(p_caso text, p_usuario text, p_esperado text, p_sql text)
returns void language plpgsql as $$
declare v text; v_uid uuid;
begin
  begin
    if p_usuario = 'anon' then
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      perform set_config('role', 'anon', true);
    else
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

-- ---------------- Preparación (como superusuario, se revierte) ----------------
-- Sin historia simulada previa, para que el caso controlado sea exacto
delete from public.movimientos where simulado;

do $$
declare
  v_emp uuid; v_tienda uuid; v_prod uuid; v_user uuid;
  v_hoy date := public.hoy_negocio();
begin
  select id, empresa_id into v_user, v_emp from public.profiles where email = '{{USUARIO_ADMIN}}';
  select id into v_tienda from public.ubicaciones where empresa_id = v_emp and tipo = 'tienda' order by nombre limit 1;
  insert into public.productos (empresa_id, sku, nombre, precio_venta, stock_minimo)
  values (v_emp, 'ZZ-REPO', 'Producto prueba reposición', 9990, 3) returning id into v_prod;
  insert into public.stock (empresa_id, producto_id, ubicacion_id, disponible) values (v_emp, v_prod, v_tienda, 10);
  -- 15 en bodega: alcanza para transferir 15 de los 22 sugeridos; el resto (7) se compra
  insert into public.stock (empresa_id, producto_id, ubicacion_id, disponible)
  select v_emp, v_prod, id, 15 from public.ubicaciones where empresa_id = v_emp and tipo = 'bodega' order by nombre limit 1;
  insert into public.movimientos (empresa_id, uuid_local, tipo, producto_id, ubicacion_origen_id, cantidad, usuario_id, created_at)
  select v_emp, gen_random_uuid(), 'salida', v_prod, v_tienda,
         case when extract(isodow from d) <= 4 then 2 else 6 end, v_user,
         (d::date + time '12:00') at time zone 'America/Santiago'
    from generate_series(v_hoy - 56, v_hoy - 1, interval '1 day') d;
end $$;

-- Pasos en sentencias separadas (una CTE no ve sus propios cambios)
create function pg_temp.con_ajuste() returns text language plpgsql as $$
begin
  update public.empresas set reposicion = reposicion || '{"ajuste_pct": 50}' where id = public.mi_empresa();
  return (select demanda_periodo::text from public.proyeccion_reposicion(public.hoy_negocio() + 6) where sku = 'ZZ-REPO');
end $$;
create function pg_temp.estados_simulados() returns text language plpgsql as $$
declare v_stock_antes bigint; v_r text;
begin
  select sum(disponible) into v_stock_antes from public.stock;
  perform public.simular_historia(12);
  select string_agg(estado || ': ' || n, ', ') into v_r from (
    select estado, count(*) n from public.proyeccion_reposicion() group by estado order by estado) x;
  if (select sum(disponible) from public.stock) <> v_stock_antes then return 'EL STOCK CAMBIÓ'; end if;
  return v_r || ' · stock intacto';
end $$;
create function pg_temp.borrar_simulada() returns text language plpgsql as $$
begin
  perform public.simular_historia(2);
  perform public.borrar_historia_simulada();
  return (select count(*) from public.movimientos where simulado) || ' simuladas';
end $$;

-- ---------------- Cálculo ----------------
select pg_temp.probar('perfil por día (lun…dom)', '{{USUARIO_ADMIN}}', 'OK {2.00,2.00,2.00,2.00,6.00,6.00,6.00}',
  $q$ select prom_por_dia::text from public.proyeccion_reposicion() where sku = 'ZZ-REPO' $q$);
select pg_temp.probar('promedio diario = 26/7', '{{USUARIO_ADMIN}}', 'OK 3.71',
  $q$ select prom_diario::text from public.proyeccion_reposicion() where sku = 'ZZ-REPO' $q$);
select pg_temp.probar('demanda próximos 7 días = 26', '{{USUARIO_ADMIN}}', 'OK 26',
  $q$ select demanda_periodo::text from public.proyeccion_reposicion(public.hoy_negocio() + 6) where sku = 'ZZ-REPO' $q$);
select pg_temp.probar('sugerido 7 días = 26 + 20% (6) − 10 en stock', '{{USUARIO_ADMIN}}', 'OK 22',
  $q$ select sugerido::text from public.proyeccion_reposicion(public.hoy_negocio() + 6) where sku = 'ZZ-REPO' $q$);
select pg_temp.probar('quiebre antes de 7 días (stock 10 < 26)', '{{USUARIO_ADMIN}}', 'OK por_quebrar',
  $q$ select estado || ' / quiebra ' || fecha_quiebre || ' (' || dias_cobertura || ' días)'
        from public.proyeccion_reposicion(public.hoy_negocio() + 6) where sku = 'ZZ-REPO' $q$);
select pg_temp.probar('detalle diario tiene un día por fecha del período', '{{USUARIO_ADMIN}}', 'OK 7',
  $q$ select jsonb_array_length(detalle)::text from public.proyeccion_reposicion(public.hoy_negocio() + 6) where sku = 'ZZ-REPO' $q$);
select pg_temp.probar('sugerencia: transferir desde bodega o comprar', '{{USUARIO_ADMIN}}', 'OK 15 + 7 = 22 (bodega 15)',
  $q$ select desde_bodega || ' + ' || comprar || ' = ' || sugerido || ' (bodega ' || bodega_disponible || ')'
        from public.proyeccion_reposicion(public.hoy_negocio() + 6) where sku = 'ZZ-REPO' $q$);
select pg_temp.probar('ajuste de temporada +50%', '{{USUARIO_ADMIN}}', 'OK 39',
  $q$ select pg_temp.con_ajuste() $q$);
select pg_temp.probar('fecha pasada rechazada', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ select count(*)::text from public.proyeccion_reposicion(public.hoy_negocio() - 1) $q$);

-- ---------------- Historia simulada ----------------
select pg_temp.probar('admin genera 12 semanas simuladas', '{{USUARIO_ADMIN}}', 'OK n > 0',
  $q$ select public.simular_historia(12)::text $q$);
select pg_temp.probar('estados con historia simulada (y stock intacto)', '{{USUARIO_ADMIN}}', 'OK conteo por estado · stock intacto',
  $q$ select pg_temp.estados_simulados() $q$);
select pg_temp.probar('borrar historia simulada', '{{USUARIO_ADMIN}}', 'OK 0 simuladas',
  $q$ select pg_temp.borrar_simulada() $q$);

-- ---------------- Permisos ----------------
select pg_temp.probar('juan (tienda) ve solo sus 3 tiendas', '{{USUARIO_TIENDA}}', 'OK 3',
  $q$ select count(distinct ubicacion_id)::text from public.proyeccion_reposicion() $q$);
select pg_temp.probar('juan no puede generar historia simulada', '{{USUARIO_TIENDA}}', 'ERROR P0001',
  $q$ select public.simular_historia(12)::text $q$);
select pg_temp.probar('anon no puede ver la proyección', 'anon', 'ERROR 42501',
  $q$ select count(*)::text from public.proyeccion_reposicion() $q$);

do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
