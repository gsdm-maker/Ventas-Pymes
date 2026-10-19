-- ============================================================
-- Mi Socio Pyme · Pruebas: variantes (talla/color) y devoluciones — se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/variantes_devoluciones.sql
-- ZZ-POLERA: tallas S (2 u.) y M (0 u.) + 1 u. antigua sin talla · ZZ-GORRO: sin variantes, 10 u.
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

-- ---------------- Preparación (se revierte) ----------------
create temp table zz_ctx as
select e.id as emp,
       (select a.ubicacion_id from public.ubicacion_acceso a
          join public.profiles p on p.id = a.user_id and p.email = '{{USUARIO_TIENDA}}'
          join public.ubicaciones u on u.id = a.ubicacion_id
         order by u.nombre limit 1) as tienda,
       null::uuid as polera, null::uuid as talla_s, null::uuid as talla_m, null::uuid as gorro
  from public.empresas e
 where e.id = (select empresa_id from public.profiles where email = '{{USUARIO_TIENDA}}');
grant select on zz_ctx to authenticated;

with p as (insert into public.productos (empresa_id, sku, nombre, precio_venta) select emp, 'ZZ-POLERA', 'Polera básica', 10000 from zz_ctx returning id)
update zz_ctx set polera = (select id from p);
with v as (insert into public.producto_variantes (producto_id, empresa_id, sku, talla) select polera, emp, 'ZZ-POLERA-S', 'S' from zz_ctx returning id)
update zz_ctx set talla_s = (select id from v);
with v as (insert into public.producto_variantes (producto_id, empresa_id, sku, talla) select polera, emp, 'ZZ-POLERA-M', 'M' from zz_ctx returning id)
update zz_ctx set talla_m = (select id from v);
with p as (insert into public.productos (empresa_id, sku, nombre, precio_venta) select emp, 'ZZ-GORRO', 'Gorro de lana', 5000 from zz_ctx returning id)
update zz_ctx set gorro = (select id from p);
insert into public.stock (empresa_id, producto_id, variante_id, ubicacion_id, disponible)
select emp, polera, talla_s, tienda, 2 from zz_ctx union all
select emp, polera, talla_m, tienda, 0 from zz_ctx union all
select emp, polera, null, tienda, 1 from zz_ctx union all
select emp, gorro, null, tienda, 10 from zz_ctx;

create function pg_temp.item(p_prod uuid, p_var uuid, p_cant int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('producto_id', p_prod, 'variante_id', p_var, 'cantidad', p_cant, 'precio_unitario', 1, 'descripcion', 'x'));
$$;
create function pg_temp.stock_de(p_prod uuid, p_var uuid) returns int language sql as $$
  select disponible from public.stock where producto_id = p_prod and variante_id is not distinct from p_var and ubicacion_id = (select tienda from zz_ctx);
$$;

create function pg_temp.venta_talla() returns text language plpgsql as $$
declare v public.ventas; d text;
begin
  v := public.registrar_venta((select tienda from zz_ctx), pg_temp.item((select polera from zz_ctx), (select talla_s from zz_ctx), 2), 'monto', 0, 'efectivo', null);
  select descripcion into d from public.venta_items where venta_id = v.id;
  return 'stock S ' || pg_temp.stock_de((select polera from zz_ctx), (select talla_s from zz_ctx)) || ' · descripción: ' || d;
end $$;

create function pg_temp.legado_agotado() returns text language plpgsql as $$
begin
  perform public.registrar_venta((select tienda from zz_ctx), pg_temp.item((select polera from zz_ctx), null, 1), 'monto', 0, 'efectivo', null);
  -- El legado (1 u.) ya se vendió: la siguiente venta sin talla debe exigir la variante
  perform public.registrar_venta((select tienda from zz_ctx), pg_temp.item((select polera from zz_ctx), null, 1), 'monto', 0, 'efectivo', null);
  return 'no exigió variante';
end $$;

-- Venta de 3 gorros con 10% de descuento (total 13.500), devolución de 1 y luego anulación del resto
create function pg_temp.devoluciones() returns text language plpgsql as $$
declare v public.ventas; d1 public.devoluciones; d2 public.devoluciones; it uuid; e1 text; e2 text; st int; vo text; mo int;
begin
  v := public.registrar_venta((select tienda from zz_ctx), pg_temp.item((select gorro from zz_ctx), null, 3), 'porcentaje', 10, 'efectivo', null);
  select id into it from public.venta_items where venta_id = v.id;
  d1 := public.devolver_venta(v.id, jsonb_build_array(jsonb_build_object('venta_item_id', it, 'cantidad', 1)), 'Producto defectuoso');
  select estado into e1 from public.ventas where id = v.id;
  d2 := public.devolver_venta(v.id, null, 'Cliente se arrepintió');
  select estado into e2 from public.ventas where id = v.id;
  st := pg_temp.stock_de((select gorro from zz_ctx), null);
  select tipo into vo from public.vouchers where referencia_id = d1.id;
  select count(*) into mo from public.movimientos where referencia in (d1.folio, d2.folio) and tipo = 'entrada';
  return 'total ' || v.total || ' · dev1 ' || d1.total || ' (' || d1.tipo || ', venta ' || e1 || ') · dev2 ' || d2.total
    || ' (' || d2.tipo || ', venta ' || e2 || ') · stock gorro ' || st || ' · voucher ' || vo || ' · movimientos ' || mo;
end $$;

create function pg_temp.anulacion_directa() returns text language plpgsql as $$
declare v public.ventas; d public.devoluciones;
begin
  v := public.registrar_venta((select tienda from zz_ctx), pg_temp.item((select gorro from zz_ctx), null, 2), 'monto', 0, 'debito', '123456');
  d := public.devolver_venta(v.id, null, 'Error de cobro');
  perform public.devolver_venta(v.id, null, 'Otra vez');
  return 'no rechazó la segunda anulación';
exception when others then
  return d.tipo || ' ' || d.total || ' · segunda: ' || sqlerrm;
end $$;

create function pg_temp.exceso() returns text language plpgsql as $$
declare v public.ventas; it uuid;
begin
  v := public.registrar_venta((select tienda from zz_ctx), pg_temp.item((select gorro from zz_ctx), null, 1), 'monto', 0, 'efectivo', null);
  select id into it from public.venta_items where venta_id = v.id;
  perform public.devolver_venta(v.id, jsonb_build_array(jsonb_build_object('venta_item_id', it, 'cantidad', 2)), 'Prueba');
  return 'no rechazó';
end $$;

create function pg_temp.reporte_neto() returns text language plpgsql as $$
declare antes bigint; despues bigint; v public.ventas; d public.devoluciones; it uuid; tk_antes int; tk_despues int;
begin
  v := public.registrar_venta((select tienda from zz_ctx), pg_temp.item((select gorro from zz_ctx), null, 2), 'monto', 0, 'efectivo', null);
  select (r->'totales'->>'monto')::bigint, (r->'totales'->>'tickets')::int into antes, tk_antes
    from public.reporte_ventas(public.hoy_negocio(), public.hoy_negocio()) r;
  select id into it from public.venta_items where venta_id = v.id;
  d := public.devolver_venta(v.id, jsonb_build_array(jsonb_build_object('venta_item_id', it, 'cantidad', 1)), 'Prueba reporte');
  select (r->'totales'->>'monto')::bigint into despues from public.reporte_ventas(public.hoy_negocio(), public.hoy_negocio()) r;
  perform public.devolver_venta(v.id, null, 'Prueba reporte');
  select (r->'totales'->>'tickets')::int into tk_despues from public.reporte_ventas(public.hoy_negocio(), public.hoy_negocio()) r;
  return 'baja ' || (antes - despues) || ' (devuelto ' || d.total || ') · tickets ' || tk_antes || ' → ' || tk_despues || ' al anular';
end $$;

create function pg_temp.ingreso_talla() returns text language plpgsql as $$
begin
  perform public.registrar_entrada((select tienda from zz_ctx), pg_temp.item((select polera from zz_ctx), (select talla_m from zz_ctx), 5), null, null, null);
  return 'M ' || pg_temp.stock_de((select polera from zz_ctx), (select talla_m from zz_ctx));
end $$;

create function pg_temp.proyeccion_sin_legado() returns text language plpgsql as $$
declare r text;
begin
  -- Se vende la unidad antigua sin talla; su fila (ya en 0) deja de aparecer
  perform public.registrar_venta((select tienda from zz_ctx), pg_temp.item((select polera from zz_ctx), null, 1), 'monto', 0, 'efectivo', null);
  select string_agg(coalesce(variante, 'sin talla'), ', ' order by variante) into r
    from public.proyeccion_reposicion() where sku = 'ZZ-POLERA';
  return r;
end $$;

create function pg_temp.simulada_por_talla() returns text language plpgsql as $$
declare n int; d text;
begin
  perform public.simular_historia(2);
  select count(*), max(descripcion) into n, d from public.venta_items where producto_id = (select polera from zz_ctx) and variante_id is not null;
  return 'ítems con talla ' || (n > 0) || ' · ej: ' || coalesce(d, '-');
end $$;

-- ---------------- Variantes ----------------
select pg_temp.probar('venta por talla descuenta su stock y guarda la talla', '{{USUARIO_TIENDA}}', 'OK stock S 0 · descripción: Polera básica · S',
  $q$ select pg_temp.venta_talla() $q$);
select pg_temp.probar('sin talla: vende el stock antiguo y luego exige talla', '{{USUARIO_TIENDA}}', 'ERROR P0001 Elige la talla',
  $q$ select pg_temp.legado_agotado() $q$);
select pg_temp.probar('talla sin stock se rechaza', '{{USUARIO_TIENDA}}', 'ERROR P0001 Stock insuficiente',
  $q$ select folio from public.registrar_venta((select tienda from zz_ctx), pg_temp.item((select polera from zz_ctx), (select talla_m from zz_ctx), 1), 'monto', 0, 'efectivo', null) $q$);
select pg_temp.probar('variante de otro producto se rechaza', '{{USUARIO_TIENDA}}', 'ERROR P0001 Variante no válida',
  $q$ select folio from public.registrar_venta((select tienda from zz_ctx), pg_temp.item((select gorro from zz_ctx), (select talla_s from zz_ctx), 1), 'monto', 0, 'efectivo', null) $q$);
select pg_temp.probar('ingreso sin talla de producto con variantes se rechaza', '{{USUARIO_ADMIN}}', 'ERROR P0001 Elige la talla',
  $q$ select id::text from public.registrar_entrada((select tienda from zz_ctx), pg_temp.item((select polera from zz_ctx), null, 5), null, null, null) $q$);
select pg_temp.probar('ingreso por talla suma a esa talla', '{{USUARIO_ADMIN}}', 'OK M 5',
  $q$ select pg_temp.ingreso_talla() $q$);
select pg_temp.probar('combinación talla/color repetida se rechaza', '{{USUARIO_ADMIN}}', 'ERROR 23505',
  $q$ with i as (insert into public.producto_variantes (producto_id, empresa_id, sku, talla) select polera, emp, 'ZZ-POLERA-S2', 'S' from zz_ctx returning 1) select count(*)::text from i $q$);
select pg_temp.probar('proyección por talla con etiqueta (stock antiguo con 1 u. visible)', '{{USUARIO_ADMIN}}', 'OK M, S, sin talla',
  $q$ select string_agg(coalesce(variante, 'sin talla'), ', ' order by variante) from public.proyeccion_reposicion() where sku = 'ZZ-POLERA' $q$);
select pg_temp.probar('agotado el stock antiguo, su fila desaparece', '{{USUARIO_ADMIN}}', 'OK M, S',
  $q$ select pg_temp.proyeccion_sin_legado() $q$);
select pg_temp.probar('historia simulada vende por talla', '{{USUARIO_ADMIN}}', 'OK ítems con talla true',
  $q$ select pg_temp.simulada_por_talla() $q$);

-- ---------------- Devoluciones ----------------
select pg_temp.probar('devolución parcial y luego del resto (con 10% de descuento)', '{{USUARIO_ADMIN}}',
  'OK total 13500 · dev1 4500 (devolucion, devuelta_parcial) · dev2 9000 (devolucion, anulada) · stock gorro 10 · voucher devolucion · movimientos 2',
  $q$ select pg_temp.devoluciones() $q$);
select pg_temp.probar('anulación directa y no se puede anular dos veces', '{{USUARIO_ADMIN}}', 'OK anulacion 10000 · segunda: ya está anulada',
  $q$ select pg_temp.anulacion_directa() $q$);
select pg_temp.probar('devolver más de lo vendido se rechaza', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ select pg_temp.exceso() $q$);
select pg_temp.probar('motivo obligatorio', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ select folio from public.devolver_venta((select id from public.ventas order by created_at desc limit 1), null, ' ') $q$);
select pg_temp.probar('el reporte descuenta lo devuelto y excluye anuladas', '{{USUARIO_ADMIN}}', 'OK baja = devuelto · tickets −1 al anular',
  $q$ select pg_temp.reporte_neto() $q$);
select pg_temp.probar('juan (tienda) no puede devolver sin permiso', '{{USUARIO_TIENDA}}', 'ERROR P0001 permiso',
  $q$ select folio from public.devolver_venta((select id from public.ventas order by created_at desc limit 1), null, 'Intento') $q$);
select pg_temp.probar('nadie escribe devoluciones directo', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with d as (delete from public.devoluciones returning 1) select count(*)::text from d $q$);

do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
