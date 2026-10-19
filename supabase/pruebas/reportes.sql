-- ============================================================
-- Mi Socio Pyme · Pruebas del reporte de ventas — se ejecutan y se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/reportes.sql
--      (anteponer la migración con --antes para probarla sin aplicarla)
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

-- Genera historia y compara el reporte con lo registrado (pasos separados)
create function pg_temp.coherencia() returns text language plpgsql as $$
declare r jsonb; v_desde date := public.hoy_negocio() - 28; v_hasta date := public.hoy_negocio() - 1;
  v_ventas bigint; v_monto bigint; v_unid bigint; v_mov bigint;
begin
  perform public.simular_historia(8);
  r := public.reporte_ventas(v_desde, v_hasta);
  select count(*), coalesce(sum(total), 0) into v_ventas, v_monto from public.ventas
   where simulado and (created_at at time zone 'America/Santiago')::date between v_desde and v_hasta;
  select coalesce(sum(vi.cantidad), 0) into v_unid from public.venta_items vi join public.ventas v on v.id = vi.venta_id
   where v.simulado and (v.created_at at time zone 'America/Santiago')::date between v_desde and v_hasta;
  select coalesce(sum(cantidad), 0) into v_mov from public.movimientos
   where simulado and (created_at at time zone 'America/Santiago')::date between v_desde and v_hasta;
  return case
    when (r->'totales'->>'tickets')::bigint = v_ventas and (r->'totales'->>'monto')::bigint = v_monto
     and (r->'totales'->>'unidades')::bigint = v_unid and v_unid = v_mov
     and (select sum((t->>'monto')::bigint) from jsonb_array_elements(r->'tiendas') t) = v_monto
     and (select sum((d->>'monto')::bigint) from jsonb_array_elements(r->'por_dia') d) = v_monto
    then 'coincide: ' || v_ventas || ' ventas, $' || v_monto || ', ' || v_unid || ' unidades'
    else 'NO COINCIDE ' || (r->'totales')::text || ' tiendas ' || (select sum((t->>'monto')::bigint) from jsonb_array_elements(r->'tiendas') t)
      || ' por_dia ' || (select sum((d->>'monto')::bigint) from jsonb_array_elements(r->'por_dia') d) || ' vs ventas ' || v_ventas || ' monto ' || v_monto || ' unid ' || v_unid || ' mov ' || v_mov
  end;
end $$;

create function pg_temp.forma() returns text language plpgsql as $$
declare r jsonb;
begin
  perform public.simular_historia(8);
  r := public.reporte_ventas(public.hoy_negocio() - 13, public.hoy_negocio());
  return 'dias ' || (r->>'dias') || ' · tiendas ' || jsonb_array_length(r->'tiendas')
    || ' · por_dia ' || jsonb_array_length(r->'por_dia')
    || ' · dow ' || jsonb_array_length(r->'por_dia_semana')
    || ' · top ' || jsonb_array_length(r->'top_productos')
    || ' · medios ' || jsonb_array_length(r->'medios')
    || ' · anterior ' || (r->'anterior'->>'desde') || '..' || (r->'anterior'->>'hasta')
    || ' · monto_ant>0 ' || ((r->'totales'->>'monto_ant')::bigint > 0);
end $$;

create function pg_temp.filtro_tienda() returns text language plpgsql as $$
declare r jsonb; t jsonb; v_t uuid;
begin
  perform public.simular_historia(4);
  select id into v_t from public.ubicaciones where empresa_id = public.mi_empresa() and tipo = 'tienda' order by nombre limit 1;
  r := public.reporte_ventas(public.hoy_negocio() - 13, public.hoy_negocio() - 1, v_t);
  select x into t from jsonb_array_elements(r->'tiendas') x where x->>'id' = v_t::text;
  return case when (r->'totales'->>'monto') = (t->>'monto') then 'totales = tienda filtrada' else 'distinto' end
    || ' · series por_dia de 1 tienda: ' || (select count(distinct d->>'tienda') from jsonb_array_elements(r->'por_dia') d);
end $$;

select pg_temp.probar('reporte coincide con ventas, ítems y movimientos', '{{USUARIO_ADMIN}}', 'OK coincide',
  $q$ select pg_temp.coherencia() $q$);
select pg_temp.probar('forma del reporte (14 días, 3 tiendas)', '{{USUARIO_ADMIN}}', 'OK dias 14 · tiendas 3 + bodega si vendió (4) · por_dia = dias × tiendas',
  $q$ select pg_temp.forma() $q$);
select pg_temp.probar('filtro por tienda', '{{USUARIO_ADMIN}}', 'OK totales = tienda filtrada · 1 serie',
  $q$ select pg_temp.filtro_tienda() $q$);
select pg_temp.probar('rango invertido rechazado', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ select public.reporte_ventas(public.hoy_negocio(), public.hoy_negocio() - 1)::text $q$);
select pg_temp.probar('rango > 366 días rechazado', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ select public.reporte_ventas(public.hoy_negocio() - 400, public.hoy_negocio())::text $q$);
select pg_temp.probar('juan (tienda) no tiene módulo reportes', '{{USUARIO_TIENDA}}', 'ERROR P0001',
  $q$ select public.reporte_ventas(public.hoy_negocio() - 6, public.hoy_negocio())::text $q$);
select pg_temp.probar('anon no puede ver el reporte', 'anon', 'ERROR 42501',
  $q$ select public.reporte_ventas(public.hoy_negocio() - 6, public.hoy_negocio())::text $q$);

do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
