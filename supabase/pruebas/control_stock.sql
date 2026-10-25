-- ============================================================
-- Mi Socio Pyme · Pruebas: productos sin control de stock y ventas offline — se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/control_stock.sql
-- ZZ-PLATO: sin control de stock (un plato) · ZZ-LATA: con stock 3 en la tienda de prueba.
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
         order by u.nombre limit 1) as tienda
  from public.empresas e
 where e.id = (select empresa_id from public.profiles where email = '{{USUARIO_TIENDA}}');
grant select on zz_ctx to authenticated;

insert into public.productos (empresa_id, sku, nombre, precio_venta, controla_stock)
select emp, 'ZZ-PLATO', 'Lomo a lo pobre', 8990, false from zz_ctx;
insert into public.productos (empresa_id, sku, nombre, precio_venta, controla_stock)
select emp, 'ZZ-LATA', 'Bebida en lata', 1500, true from zz_ctx;
insert into public.stock (empresa_id, producto_id, ubicacion_id, disponible)
select c.emp, p.id, c.tienda, 3 from zz_ctx c join public.productos p on p.sku = 'ZZ-LATA' and p.empresa_id = c.emp;
-- Fila de stock "huérfana" del plato, para comprobar que la proyección lo ignora igual
insert into public.stock (empresa_id, producto_id, ubicacion_id, disponible)
select c.emp, p.id, c.tienda, 0 from zz_ctx c join public.productos p on p.sku = 'ZZ-PLATO' and p.empresa_id = c.emp;

create function pg_temp.item(p_sku text, p_cant int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('producto_id', id, 'cantidad', p_cant, 'precio_unitario', 1, 'descripcion', 'x'))
    from public.productos where sku = p_sku and empresa_id = (select emp from zz_ctx);
$$;
create function pg_temp.stock_de(p_sku text) returns int language sql as $$
  select s.disponible from public.stock s join public.productos p on p.id = s.producto_id
   where p.sku = p_sku and s.ubicacion_id = (select tienda from zz_ctx);
$$;

create function pg_temp.venta_plato() returns text language plpgsql as $$
declare v public.ventas; n_items int; n_mov int;
begin
  v := public.registrar_venta((select tienda from zz_ctx), pg_temp.item('ZZ-PLATO', 4), 'monto', 0, 'efectivo', null);
  select count(*) into n_items from public.venta_items where venta_id = v.id;
  select count(*) into n_mov from public.movimientos where referencia = v.folio;
  return 'total ' || v.total || ' · ítems ' || n_items || ' · movimientos ' || n_mov || ' · stock plato ' || pg_temp.stock_de('ZZ-PLATO');
end $$;

create function pg_temp.venta_offline() returns text language plpgsql as $$
declare v public.ventas; v2 public.ventas; sin int; obs text;
begin
  v := public.registrar_venta((select tienda from zz_ctx), pg_temp.item('ZZ-LATA', 5), 'monto', 0, 'efectivo', null,
                              'aaaaaaaa-0000-0000-0000-000000000001', true);
  -- Reintento de la cola con el mismo uuid: no duplica ni vuelve a descontar
  v2 := public.registrar_venta((select tienda from zz_ctx), pg_temp.item('ZZ-LATA', 5), 'monto', 0, 'efectivo', null,
                               'aaaaaaaa-0000-0000-0000-000000000001', true);
  select sin_stock into sin from public.venta_items where venta_id = v.id;
  select observaciones into obs from public.movimientos where referencia = v.folio;
  return 'stock ' || pg_temp.stock_de('ZZ-LATA') || ' · sin_stock ' || sin || ' · diferencia ' || v.con_diferencia
    || ' · misma venta ' || (v.id = v2.id) || ' · obs: ' || coalesce(obs, '-');
end $$;

create function pg_temp.salida_offline() returns text language plpgsql as $$
declare vo public.vouchers;
begin
  vo := public.registrar_salida((select p.id from public.productos p where p.sku = 'ZZ-LATA' and p.empresa_id = (select emp from zz_ctx)),
                                null, (select tienda from zz_ctx), 4, null, null, 'bbbbbbbb-0000-0000-0000-000000000001', true);
  return 'stock ' || pg_temp.stock_de('ZZ-LATA') || ' · sin_stock ' || (vo.detalle->>'sin_stock');
end $$;

create function pg_temp.simulada_con_plato() returns text language plpgsql as $$
declare v_items int; v_mov int; r jsonb;
begin
  perform public.simular_historia(2);
  select count(*) into v_items from public.venta_items vi join public.productos p on p.id = vi.producto_id where p.sku = 'ZZ-PLATO';
  select count(*) into v_mov from public.movimientos m join public.productos p on p.id = m.producto_id where p.sku = 'ZZ-PLATO';
  r := public.reporte_ventas(public.hoy_negocio() - 13, public.hoy_negocio() - 1);
  return 'ítems plato ' || (v_items > 0) || ' · movimientos plato ' || v_mov
    || ' · en top/reporte ' || ((r->'categorias') is not null);
end $$;

-- ---------------- Casos ----------------
select pg_temp.probar('venta de producto sin control de stock', '{{USUARIO_TIENDA}}', 'OK total 35960 · ítems 1 · movimientos 0 · stock plato 0',
  $q$ select pg_temp.venta_plato() $q$);
select pg_temp.probar('venta en línea sin stock suficiente se rechaza', '{{USUARIO_TIENDA}}', 'ERROR P0001 Stock insuficiente',
  $q$ select folio from public.registrar_venta((select tienda from zz_ctx), pg_temp.item('ZZ-LATA', 5), 'monto', 0, 'efectivo', null) $q$);
select pg_temp.probar('venta offline sin stock suficiente se registra (idempotente)', '{{USUARIO_TIENDA}}', 'OK stock 0 · sin_stock 2 · diferencia true · misma venta true',
  $q$ select pg_temp.venta_offline() $q$);
select pg_temp.probar('salida offline sin stock suficiente se registra', '{{USUARIO_TIENDA}}', 'OK stock 0 · sin_stock 1',
  $q$ select pg_temp.salida_offline() $q$);
select pg_temp.probar('salida de producto sin control de stock se rechaza', '{{USUARIO_TIENDA}}', 'ERROR P0001',
  $q$ select numero from public.registrar_salida((select p.id from public.productos p where p.sku = 'ZZ-PLATO' and p.empresa_id = (select emp from zz_ctx)),
        null, (select tienda from zz_ctx), 1, null, null, null) $q$);
select pg_temp.probar('ingreso de producto sin control de stock se rechaza', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ select id::text from public.registrar_entrada((select tienda from zz_ctx), pg_temp.item('ZZ-PLATO', 10), null, null, null) $q$);
select pg_temp.probar('la proyección ignora productos sin control de stock', '{{USUARIO_ADMIN}}', 'OK 0',
  $q$ select count(*)::text from public.proyeccion_reposicion() where sku = 'ZZ-PLATO' $q$);
select pg_temp.probar('historia simulada vende platos sin movimientos de stock', '{{USUARIO_ADMIN}}', 'OK ítems plato true · movimientos plato 0',
  $q$ select pg_temp.simulada_con_plato() $q$);
-- Desde 0020 el rubro lo cambia solo el administrador general (ver modulos_permisos.sql)
select pg_temp.probar('admin no cambia el rubro a uno inválido', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.empresas set tipo_negocio = 'farmacia' where id = public.mi_empresa() returning 1) select count(*)::text from u $q$);
select pg_temp.probar('admin no cambia el rubro (solo el administrador general)', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.empresas set tipo_negocio = 'restaurante' where id = public.mi_empresa() returning 1) select count(*)::text from u $q$);

do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
