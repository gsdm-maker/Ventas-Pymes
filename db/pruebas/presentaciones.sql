successfully downloaded text file (SHA: 3c40fcda679764e62672eca97edb41a962f12d9d)
-- ============================================================
-- Mi Socio Pyme · Pruebas: presentaciones de producto (0029) — se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/presentaciones.sql
--      (antes de aplicar: --antes supabase/migrations/0029_presentaciones.sql)
-- ZZ-INC: incienso por unidad ($200, stock 120 en la tienda de prueba) con «Caja x50» a $5.000.
-- ============================================================
create temp table zz_resultados (n serial, caso text, esperado text, obtenido text);

create function pg_temp.probar(p_caso text, p_usuario text, p_esperado text, p_sql text)
returns void language plpgsql as $$
declare v text; v_uid uuid;
begin
  begin
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

-- ---------------- Preparación (se revierte) ----------------
create temp table zz_ctx as
select e.id as emp,
       (select a.ubicacion_id from public.ubicacion_acceso a
          join public.profiles p on p.id = a.user_id and p.email = '{{USUARIO_TIENDA}}'
          join public.ubicaciones u on u.id = a.ubicacion_id
         order by u.nombre limit 1) as tienda
  from public.empresas e
 where e.id = (select empresa_id from public.profiles where email = '{{USUARIO_TIENDA}}');
grant select on zz_ctx to authenticated;

insert into public.productos (empresa_id, sku, nombre, precio_venta, controla_stock, codigo_barras)
select emp, 'ZZ-INC', 'Incienso sándalo', 200, true, 'ZZ7800000000001' from zz_ctx;
insert into public.productos (empresa_id, sku, nombre, precio_venta, controla_stock)
select emp, 'ZZ-OTRO', 'Otro producto', 1000, true from zz_ctx;
insert into public.stock (empresa_id, producto_id, ubicacion_id, disponible)
select c.emp, p.id, c.tienda, 120 from zz_ctx c join public.productos p on p.sku = 'ZZ-INC' and p.empresa_id = c.emp;
insert into public.producto_presentaciones (empresa_id, producto_id, nombre, factor, precio_venta, codigo_barras)
select emp, p.id, '  Caja x50 ', 50, 5000, 'ZZ17800000000001'
  from zz_ctx c join public.productos p on p.sku = 'ZZ-INC' and p.empresa_id = c.emp;
grant select on public.producto_presentaciones to authenticated;

create function pg_temp.prod(p_sku text) returns uuid language sql as $$
  select id from public.productos where sku = p_sku and empresa_id = (select emp from zz_ctx) $$;
create function pg_temp.caja() returns uuid language sql as $$
  select id from public.producto_presentaciones where producto_id = pg_temp.prod('ZZ-INC') $$;
create function pg_temp.stock_inc() returns int language sql as $$
  select disponible from public.stock where producto_id = pg_temp.prod('ZZ-INC') and ubicacion_id = (select tienda from zz_ctx) $$;
-- Línea de venta: el precio enviado por el cliente se ignora (el servidor usa el del catálogo)
create function pg_temp.item(p_sku text, p_cant int, p_pres uuid default null) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod(p_sku), 'cantidad', p_cant,
         'presentacion_id', p_pres, 'precio_unitario', 1, 'descripcion', 'x')) $$;

create function pg_temp.vender_cajas() returns text language plpgsql as $$
declare v public.ventas; it public.venta_items; mov int;
begin
  v := public.registrar_venta((select tienda from zz_ctx), pg_temp.item('ZZ-INC', 2, pg_temp.caja()), 'monto', 0, 'efectivo', null);
  select * into it from public.venta_items where venta_id = v.id;
  select cantidad into mov from public.movimientos where referencia = v.folio;
  return concat_ws(' · ', 'total ' || v.total, it.descripcion, 'cant ' || it.cantidad, 'factor ' || it.factor,
                   'precio ' || it.precio_unitario, 'mov ' || mov, 'stock ' || pg_temp.stock_inc());
end $$;

create function pg_temp.vender_unidades() returns text language plpgsql as $$
declare v public.ventas; it public.venta_items;
begin
  v := public.registrar_venta((select tienda from zz_ctx), pg_temp.item('ZZ-INC', 3), 'monto', 0, 'efectivo', null);
  select * into it from public.venta_items where venta_id = v.id;
  return concat_ws(' · ', 'total ' || v.total, 'factor ' || it.factor, 'stock ' || pg_temp.stock_inc());
end $$;

create function pg_temp.vender_y_devolver() returns text language plpgsql as $$
declare v public.ventas; it public.venta_items; d public.devoluciones; antes int;
begin
  v := public.registrar_venta((select tienda from zz_ctx), pg_temp.item('ZZ-INC', 2, pg_temp.caja()), 'monto', 0, 'efectivo', null);
  antes := pg_temp.stock_inc();
  select * into it from public.venta_items where venta_id = v.id;
  d := public.devolver_venta(v.id, jsonb_build_array(jsonb_build_object('venta_item_id', it.id, 'cantidad', 1)), 'Prueba de devolución');
  return concat_ws(' · ', 'stock tras venta ' || antes, 'devuelto $' || d.total, 'stock ' || pg_temp.stock_inc());
end $$;

create function pg_temp.vender_y_reportar() returns text language plpgsql as $$
declare v public.ventas; r jsonb; antes int; despues int;
begin
  r := public.reporte_ventas(public.hoy_negocio(), public.hoy_negocio(), (select tienda from zz_ctx));
  antes := (r->'totales'->>'unidades')::int;
  v := public.registrar_venta((select tienda from zz_ctx), pg_temp.item('ZZ-INC', 1, pg_temp.caja()), 'monto', 0, 'efectivo', null);
  r := public.reporte_ventas(public.hoy_negocio(), public.hoy_negocio(), (select tienda from zz_ctx));
  despues := (r->'totales'->>'unidades')::int;
  return 'unidades +' || (despues - antes);
end $$;

create function pg_temp.caja_con_variante() returns text language plpgsql as $$
declare r text;
begin
  insert into public.producto_variantes (producto_id, empresa_id, sku, talla)
  values (pg_temp.prod('ZZ-OTRO'), (select emp from zz_ctx), 'ZZ-OTRO-S', 'S');
  insert into public.producto_presentaciones (empresa_id, producto_id, nombre, factor, precio_venta)
  values ((select emp from zz_ctx), pg_temp.prod('ZZ-OTRO'), 'Caja x10', 10, 9000) returning nombre into r;
  return r;
end $$;

-- ---------------- Catálogo ----------------
select pg_temp.probar('la presentación se guarda limpia y en la empresa del producto', 'directo', 'OK Caja x50 · 50 · t',
  $q$ select concat_ws(' · ', nombre, factor, empresa_id = (select emp from zz_ctx))
        from public.producto_presentaciones where id = pg_temp.caja() $q$);
select pg_temp.probar('el admin agrega otra presentación (display x12)', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with i as (insert into public.producto_presentaciones (empresa_id, producto_id, nombre, factor, precio_venta)
                 values ((select emp from zz_ctx), pg_temp.prod('ZZ-INC'), 'Display x12', 12, 2000) returning 1)
      select count(*)::text from i $q$);
select pg_temp.probar('el puesto de tienda no crea presentaciones', '{{USUARIO_TIENDA}}', 'ERROR 42501',
  $q$ with i as (insert into public.producto_presentaciones (empresa_id, producto_id, nombre, factor, precio_venta)
                 values ((select emp from zz_ctx), pg_temp.prod('ZZ-INC'), 'Pack x6', 6, 1000) returning 1)
      select count(*)::text from i $q$);
select pg_temp.probar('el puesto de tienda sí las ve (para vender)', '{{USUARIO_TIENDA}}', 'OK 1',
  $q$ select count(*)::text from public.producto_presentaciones where id = pg_temp.caja() $q$);
select pg_temp.probar('no se repite la cantidad en el mismo producto', 'directo', 'ERROR 23505',
  $q$ insert into public.producto_presentaciones (empresa_id, producto_id, nombre, factor, precio_venta)
      values ((select emp from zz_ctx), pg_temp.prod('ZZ-INC'), 'Otra caja', 50, 4000) returning nombre $q$);
select pg_temp.probar('factor 1 no es presentación', 'directo', 'ERROR 23514',
  $q$ insert into public.producto_presentaciones (empresa_id, producto_id, nombre, factor, precio_venta)
      values ((select emp from zz_ctx), pg_temp.prod('ZZ-INC'), 'Unidad', 1, 200) returning nombre $q$);
select pg_temp.probar('la caja no toma el código de barras de un producto', 'directo', 'ERROR P0001: Ese código de barras ya lo tiene otro producto',
  $q$ insert into public.producto_presentaciones (empresa_id, producto_id, nombre, factor, precio_venta, codigo_barras)
      values ((select emp from zz_ctx), pg_temp.prod('ZZ-OTRO'), 'Caja x10', 10, 9000, 'ZZ7800000000001') returning nombre $q$);
select pg_temp.probar('un producto no toma el código de barras de una caja', 'directo', 'ERROR P0001: Ese código de barras ya lo tiene otro producto',
  $q$ update public.productos set codigo_barras = 'ZZ17800000000001' where id = pg_temp.prod('ZZ-OTRO') returning sku $q$);
select pg_temp.probar('no se mezcla con tallas ni colores', 'directo', 'ERROR P0001: Las presentaciones son para productos sin tallas ni colores',
  $q$ select pg_temp.caja_con_variante() $q$);

-- ---------------- Venta ----------------
select pg_temp.probar('2 cajas: precio de caja, descuenta 100 u.', '{{USUARIO_TIENDA}}',
  'OK total 10000 · Incienso sándalo · Caja x50 · cant 2 · factor 50 · precio 5000 · mov 100 · stock 20',
  $q$ select pg_temp.vender_cajas() $q$);
select pg_temp.probar('por unidad sigue igual', '{{USUARIO_TIENDA}}', 'OK total 600 · factor 1 · stock 117',
  $q$ select pg_temp.vender_unidades() $q$);
select pg_temp.probar('3 cajas con 120 u. no alcanzan', '{{USUARIO_TIENDA}}', 'ERROR P0001: Stock insuficiente para Incienso sándalo · Caja x50',
  $q$ select folio from public.registrar_venta((select tienda from zz_ctx), pg_temp.item('ZZ-INC', 3, pg_temp.caja()), 'monto', 0, 'efectivo', null) $q$);
select pg_temp.probar('la caja de un producto no sirve para otro', '{{USUARIO_TIENDA}}', 'ERROR P0001: Esa presentación ya no está disponible para la venta',
  $q$ select folio from public.registrar_venta((select tienda from zz_ctx), pg_temp.item('ZZ-OTRO', 1, pg_temp.caja()), 'monto', 0, 'efectivo', null) $q$);
update public.producto_presentaciones set activa = false where id = pg_temp.caja();
select pg_temp.probar('una caja desactivada no se vende', '{{USUARIO_TIENDA}}', 'ERROR P0001: Esa presentación ya no está disponible para la venta',
  $q$ select folio from public.registrar_venta((select tienda from zz_ctx), pg_temp.item('ZZ-INC', 1, pg_temp.caja()), 'monto', 0, 'efectivo', null) $q$);
update public.producto_presentaciones set activa = true where id = pg_temp.caja();
select pg_temp.probar('devolver 1 de 2 cajas repone 50 u.', '{{USUARIO_ADMIN}}', 'OK stock tras venta 20 · devuelto $5000 · stock 70',
  $q$ select pg_temp.vender_y_devolver() $q$);
select pg_temp.probar('el reporte cuenta 1 caja como 50 unidades', '{{USUARIO_ADMIN}}', 'OK unidades +50',
  $q$ select pg_temp.vender_y_reportar() $q$);

do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
