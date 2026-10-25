-- ============================================================
-- Mi Socio Pyme · Pruebas: restaurante (mesas, comandas, propina) — se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/restaurante.sql
-- {{USUARIO_TIENDA}} (tienda, restringido) atiende; {{USUARIO_ADMIN}} (admin) supervisa.
-- ============================================================
create temp table zz_resultados (n serial, caso text, esperado text, obtenido text);

create function pg_temp.probar(p_caso text, p_usuario text, p_esperado text, p_sql text)
returns void language plpgsql as $$
declare v text; v_uid uuid;
begin
  begin
    select id into v_uid from public.profiles where email = p_usuario;
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute p_sql into v;
    raise exception using errcode = 'ZZ999', message = 'OK ' || coalesce(v, '-');
  exception when others then
    v := case when sqlstate = 'ZZ999' then sqlerrm else 'ERROR ' || sqlstate || ': ' || sqlerrm end;
  end;
  insert into zz_resultados (caso, esperado, obtenido) values (p_caso, p_esperado, v);
end $$;

-- Ejecuta y CONFIRMA (para encadenar pasos): el resultado queda para los casos siguientes
create function pg_temp.paso(p_usuario text, p_sql text) returns text language plpgsql as $$
declare v text; v_uid uuid;
begin
  select id into v_uid from public.profiles where email = p_usuario;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

-- ---------------- Preparación (se revierte) ----------------
create temp table zz_ctx as
select e.id as emp,
       (select a.ubicacion_id from public.ubicacion_acceso a
          join public.profiles p on p.id = a.user_id and p.email = '{{USUARIO_TIENDA}}'
          join public.ubicaciones u on u.id = a.ubicacion_id
         order by u.nombre limit 1) as tienda,
       (select u.id from public.ubicaciones u
         where u.empresa_id = e.id and u.tipo = 'tienda'
           and u.id not in (select a.ubicacion_id from public.ubicacion_acceso a join public.profiles p on p.id = a.user_id and p.email = '{{USUARIO_TIENDA}}')
         limit 1) as otra
  from public.empresas e
 where e.id = (select empresa_id from public.profiles where email = '{{USUARIO_TIENDA}}');
grant select on zz_ctx to authenticated;

update public.empresas set modulos = array(select distinct unnest(modulos || array['mesas', 'cocina']))
 where id = (select emp from zz_ctx);

insert into public.productos (empresa_id, sku, nombre, precio_venta, controla_stock)
select emp, 'ZZ-PLATO', 'Lomo a lo pobre', 8990, false from zz_ctx;
insert into public.productos (empresa_id, sku, nombre, precio_venta, controla_stock)
select emp, 'ZZ-LATA', 'Bebida en lata', 1500, true from zz_ctx;
insert into public.stock (empresa_id, producto_id, ubicacion_id, disponible)
select c.emp, p.id, c.tienda, 3 from zz_ctx c join public.productos p on p.sku = 'ZZ-LATA' and p.empresa_id = c.emp;
insert into public.mesas (empresa_id, ubicacion_id, nombre, zona)
select emp, tienda, n, 'Salón' from zz_ctx, unnest(array['ZZ Mesa 1', 'ZZ Mesa 2', 'ZZ Mesa 3']) n;
insert into public.mesas (empresa_id, ubicacion_id, nombre) select emp, otra, 'ZZ Mesa Otra' from zz_ctx where otra is not null;

create function pg_temp.mesa(p text) returns uuid language sql as $$
  select id from public.mesas where nombre = p and empresa_id = (select emp from zz_ctx);
$$;
create function pg_temp.prod(p text) returns uuid language sql as $$
  select id from public.productos where sku = p and empresa_id = (select emp from zz_ctx);
$$;
create function pg_temp.items(p_sku text, p_cant int, p_nota text default null) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod(p_sku), 'cantidad', p_cant, 'nota', p_nota));
$$;
create function pg_temp.cuenta(p_mesa text) returns uuid language sql as $$
  select id from public.cuentas where mesa_id = pg_temp.mesa(p_mesa) and estado = 'abierta';
$$;

create temp table zz_com (k text, id uuid, numero int);
create function pg_temp.enviar(p_mesa text, p_items jsonb, p_comensales int default null) returns text language plpgsql as $$
declare c public.comandas;
begin
  c := public.enviar_comanda(pg_temp.mesa(p_mesa), p_items, p_comensales);
  return c.id::text;
end $$;
grant select, insert, delete on zz_com to authenticated;

-- Verificaciones de varios pasos en plpgsql (un CTE no ve lo que modifica una función)
create function pg_temp.abrir_mesa1() returns text language plpgsql as $$
declare c uuid;
begin
  c := pg_temp.enviar('ZZ Mesa 1', pg_temp.items('ZZ-PLATO', 2, 'sin cebolla') || pg_temp.items('ZZ-LATA', 1), 4)::uuid;
  return 'cuentas ' || (select count(*) from public.cuentas where mesa_id = pg_temp.mesa('ZZ Mesa 1') and estado = 'abierta')
    || ' · ítems ' || (select count(*) from public.cuenta_items where comanda_id = c)
    || ' · nota ' || (select nota from public.cuenta_items where comanda_id = c and nota is not null)
    || ' · comensales ' || (select comensales from public.cuentas where mesa_id = pg_temp.mesa('ZZ Mesa 1') and estado = 'abierta');
end $$;
create function pg_temp.anular_b() returns text language plpgsql as $$
begin
  perform public.anular_item_cuenta((select id from public.cuenta_items where comanda_id = (select id from zz_com where k = 'B')), 'Cliente cambió de opinión');
  return (select estado from public.comandas where id = (select id from zz_com where k = 'B'));
end $$;
create function pg_temp.cobrar_mesa2() returns text language plpgsql as $$
declare v public.ventas;
begin
  v := public.cobrar_cuenta(pg_temp.cuenta('ZZ Mesa 2'), 'efectivo', null, 1948);
  return 'total ' || v.total || ' · propina ' || v.propina
    || ' · garzón ' || (v.garzon_id = (select id from public.profiles where email = '{{USUARIO_TIENDA}}'))
    || ' · voucher ' || (select (detalle->>'propina') || '/' || (detalle->>'mesa') from public.vouchers where referencia_id = v.id)
    || ' · stock lata ' || (select disponible from public.stock where producto_id = pg_temp.prod('ZZ-LATA') and ubicacion_id = (select tienda from zz_ctx))
    || ' · cuenta ' || (select estado from public.cuentas where id = v.cuenta_id)
    || ' · comandas ' || (select string_agg(estado, ',' order by numero) from public.comandas where cuenta_id = v.cuenta_id);
end $$;
create function pg_temp.anular_mesa3() returns text language plpgsql as $$
declare c uuid := pg_temp.cuenta('ZZ Mesa 3');
begin
  perform public.anular_cuenta(c, 'Se fueron sin pedir');
  return (select estado from public.cuentas where id = c) || ' · comanda ' || (select estado from public.comandas where cuenta_id = c);
end $$;

-- ---------------- Casos ----------------
select pg_temp.probar('garzón abre la mesa con la primera comanda', '{{USUARIO_TIENDA}}', 'OK cuentas 1 · ítems 2 · nota sin cebolla · comensales 4',
  $q$ select pg_temp.abrir_mesa1() $q$);

-- Dejar la mesa 1 con dos comandas confirmadas para los casos siguientes
insert into zz_com values ('A', pg_temp.paso('{{USUARIO_TIENDA}}', $q$ select pg_temp.enviar('ZZ Mesa 1', pg_temp.items('ZZ-PLATO', 2, 'sin cebolla') || pg_temp.items('ZZ-LATA', 1), 4) $q$)::uuid, null);
insert into zz_com values ('B', pg_temp.paso('{{USUARIO_TIENDA}}', $q$ select pg_temp.enviar('ZZ Mesa 1', pg_temp.items('ZZ-PLATO', 1)) $q$)::uuid, null);
update zz_com z set numero = c.numero from public.comandas c where c.id = z.id;

select pg_temp.probar('segunda comanda usa la misma cuenta y el número sigue', '{{USUARIO_TIENDA}}', 'OK cuentas 1 · correlativo true',
  $q$ select 'cuentas ' || (select count(*) from public.cuentas where mesa_id = pg_temp.mesa('ZZ Mesa 1') and estado = 'abierta')
       || ' · correlativo ' || ((select numero from zz_com where k = 'B') = (select numero from zz_com where k = 'A') + 1) $q$);
select pg_temp.probar('cocina pasa la comanda B a preparando', '{{USUARIO_TIENDA}}', 'OK preparando',
  $q$ select (public.cambiar_estado_comanda((select id from zz_com where k = 'B'), 'preparando')).estado $q$);
select pg_temp.paso('{{USUARIO_TIENDA}}', $q$ select (public.cambiar_estado_comanda((select id from zz_com where k = 'B'), 'preparando')).estado $q$);
select pg_temp.probar('estado de comanda inválido se rechaza', '{{USUARIO_TIENDA}}', 'ERROR P0001: Estado inválido',
  $q$ select (public.cambiar_estado_comanda((select id from zz_com where k = 'A'), 'quemada')).estado $q$);
select pg_temp.probar('anular ítem en preparación sin motivo se rechaza', '{{USUARIO_TIENDA}}', 'ERROR P0001: Indica el motivo',
  $q$ select public.anular_item_cuenta((select id from public.cuenta_items where comanda_id = (select id from zz_com where k = 'B')))::text $q$);
select pg_temp.probar('anular ítem con motivo deja la comanda anulada', '{{USUARIO_TIENDA}}', 'OK anulada',
  $q$ select pg_temp.anular_b() $q$);
select pg_temp.paso('{{USUARIO_TIENDA}}', $q$ select public.anular_item_cuenta((select id from public.cuenta_items where comanda_id = (select id from zz_com where k = 'B')), 'Cliente cambió de opinión')::text $q$);

select pg_temp.probar('mover la cuenta a una mesa libre', '{{USUARIO_TIENDA}}', 'OK ZZ Mesa 2',
  $q$ select m.nombre from public.mover_cuenta(pg_temp.cuenta('ZZ Mesa 1'), pg_temp.mesa('ZZ Mesa 2')) c join public.mesas m on m.id = c.mesa_id $q$);
select pg_temp.paso('{{USUARIO_TIENDA}}', $q$ select (public.mover_cuenta(pg_temp.cuenta('ZZ Mesa 1'), pg_temp.mesa('ZZ Mesa 2'))).id::text $q$);
select pg_temp.paso('{{USUARIO_TIENDA}}', $q$ select pg_temp.enviar('ZZ Mesa 3', pg_temp.items('ZZ-PLATO', 1)) $q$);
select pg_temp.probar('mover a una mesa ocupada se rechaza', '{{USUARIO_TIENDA}}', 'ERROR P0001: La mesa ZZ Mesa 3 está ocupada',
  $q$ select (public.mover_cuenta(pg_temp.cuenta('ZZ Mesa 2'), pg_temp.mesa('ZZ Mesa 3'))).id::text $q$);

select pg_temp.probar('propina mayor que el total se rechaza', '{{USUARIO_TIENDA}}', 'ERROR P0001: La propina no puede ser mayor',
  $q$ select (public.cobrar_cuenta(pg_temp.cuenta('ZZ Mesa 2'), 'efectivo', null, 999999)).folio $q$);
select pg_temp.probar('cobrar con propina: venta, garzón, voucher, stock y comandas', '{{USUARIO_TIENDA}}',
  'OK total 19480 · propina 1948 · garzón true · voucher 1948/ZZ Mesa 2 · stock lata 2 · cuenta cobrada · comandas entregada,anulada',
  $q$ select pg_temp.cobrar_mesa2() $q$);
select pg_temp.paso('{{USUARIO_TIENDA}}', $q$ select (public.cobrar_cuenta(pg_temp.cuenta('ZZ Mesa 2'), 'efectivo', null, 1948)).folio $q$);
select pg_temp.probar('la cuenta cobrada no se vuelve a cobrar', '{{USUARIO_TIENDA}}', 'ERROR P0001: Cuenta no encontrada',
  $q$ select (public.cobrar_cuenta(pg_temp.cuenta('ZZ Mesa 2'), 'efectivo', null, 0)).folio $q$);
select pg_temp.probar('la mesa queda libre tras cobrar', '{{USUARIO_TIENDA}}', 'OK 0',
  $q$ select count(*)::text from public.cuentas where mesa_id = pg_temp.mesa('ZZ Mesa 2') and estado = 'abierta' $q$);

select pg_temp.probar('garzón sin permiso de anular no cierra una cuenta con pedidos', '{{USUARIO_TIENDA}}', 'ERROR P0001: Solo quien puede anular',
  $q$ select public.anular_cuenta(pg_temp.cuenta('ZZ Mesa 3'), 'Se fueron')::text $q$);
select pg_temp.probar('admin anula la cuenta sin motivo: se rechaza', '{{USUARIO_ADMIN}}', 'ERROR P0001: Indica el motivo',
  $q$ select public.anular_cuenta(pg_temp.cuenta('ZZ Mesa 3'))::text $q$);
select pg_temp.probar('admin anula la cuenta con motivo', '{{USUARIO_ADMIN}}', 'OK anulada · comanda anulada',
  $q$ select pg_temp.anular_mesa3() $q$);

select pg_temp.probar('reporte de propinas por garzón', '{{USUARIO_ADMIN}}', 'OK 1 cuenta · venta 19480 · propina 1948',
  $q$ select cuentas || ' cuenta · venta ' || ventas || ' · propina ' || propinas
       from public.reporte_propinas(public.hoy_negocio(), public.hoy_negocio(), (select tienda from zz_ctx))
      where garzon_id = (select id from public.profiles where email = '{{USUARIO_TIENDA}}') $q$);
select pg_temp.probar('garzón no ve reportes de propinas', '{{USUARIO_TIENDA}}', 'ERROR P0001: No tienes permiso',
  $q$ select count(*)::text from public.reporte_propinas(public.hoy_negocio(), public.hoy_negocio()) $q$);

select pg_temp.probar('mesa de una tienda no autorizada', '{{USUARIO_TIENDA}}', 'ERROR P0001: Mesa no encontrada',
  $q$ select pg_temp.enviar('ZZ Mesa Otra', pg_temp.items('ZZ-PLATO', 1)) $q$);
select pg_temp.probar('garzón no ve mesas de otra tienda', '{{USUARIO_TIENDA}}', 'OK 0',
  $q$ select count(*)::text from public.mesas where nombre = 'ZZ Mesa Otra' $q$);
select pg_temp.probar('insertar cuentas directo está bloqueado (solo RPC)', '{{USUARIO_TIENDA}}', 'ERROR 42501',
  $q$ with i as (insert into public.cuentas (empresa_id, ubicacion_id, mesa_id, garzon_id)
       values ((select emp from zz_ctx), (select tienda from zz_ctx), pg_temp.mesa('ZZ Mesa 1'), auth.uid()) returning 1) select count(*)::text from i $q$);
select pg_temp.probar('garzón no configura mesas', '{{USUARIO_TIENDA}}', 'ERROR 42501',
  $q$ with i as (insert into public.mesas (empresa_id, ubicacion_id, nombre) values ((select emp from zz_ctx), (select tienda from zz_ctx), 'ZZ Nueva') returning 1) select count(*)::text from i $q$);
select pg_temp.probar('admin configura mesas', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with i as (insert into public.mesas (empresa_id, ubicacion_id, nombre) values ((select emp from zz_ctx), (select tienda from zz_ctx), 'ZZ Nueva') returning 1) select count(*)::text from i $q$);
select pg_temp.probar('nombre de mesa repetido se rechaza', '{{USUARIO_ADMIN}}', 'ERROR 23505',
  $q$ with i as (insert into public.mesas (empresa_id, ubicacion_id, nombre) values ((select emp from zz_ctx), (select tienda from zz_ctx), 'zz mesa 1') returning 1) select count(*)::text from i $q$);

-- Sin el permiso mesas.atender (override) el garzón no puede tomar pedidos
update public.profiles set permissions = permissions || '{"mesas.atender": false}' where email = '{{USUARIO_TIENDA}}';
select pg_temp.probar('sin mesas.atender no se envían comandas', '{{USUARIO_TIENDA}}', 'ERROR P0001: No tienes permiso',
  $q$ select pg_temp.enviar('ZZ Mesa 1', pg_temp.items('ZZ-PLATO', 1)) $q$);

-- ---------------- 0024: solo lo que se cocina va a cocina · estados de a un paso ----------------
-- Se devuelve el permiso que quitó el caso anterior
update public.profiles set permissions = permissions - 'mesas.atender' where email = '{{USUARIO_TIENDA}}';
update public.productos set va_a_cocina = false where id = pg_temp.prod('ZZ-LATA');

create function pg_temp.solo_bebidas() returns text language plpgsql as $$
declare c public.comandas;
begin
  c := public.enviar_comanda(pg_temp.mesa('ZZ Mesa 1'), pg_temp.items('ZZ-LATA', 2));
  return 'comanda ' || coalesce(c.id::text, 'ninguna')
    || ' · ítems sin cocina ' || (select count(*) from public.cuenta_items where cuenta_id = pg_temp.cuenta('ZZ Mesa 1') and comanda_id is null);
end $$;
create function pg_temp.mixto() returns text language plpgsql as $$
declare c public.comandas;
begin
  c := public.enviar_comanda(pg_temp.mesa('ZZ Mesa 1'), pg_temp.items('ZZ-PLATO', 1) || pg_temp.items('ZZ-LATA', 1));
  return 'en cocina ' || (select count(*) from public.cuenta_items where comanda_id = c.id)
    || ' · directo ' || (select count(*) from public.cuenta_items where cuenta_id = c.cuenta_id and comanda_id is null);
end $$;
create function pg_temp.anular_bebida() returns text language plpgsql as $$
declare c public.comandas; v_item uuid;
begin
  c := public.enviar_comanda(pg_temp.mesa('ZZ Mesa 1'), pg_temp.items('ZZ-LATA', 1));
  select id into v_item from public.cuenta_items where cuenta_id = pg_temp.cuenta('ZZ Mesa 1') and comanda_id is null;
  perform public.anular_item_cuenta(v_item, null);
  return (select anulado::text from public.cuenta_items where id = v_item);
end $$;
-- Crea una comanda de plato y aplica los estados en orden; devuelve el estado final
create function pg_temp.recorrer(p_estados text[]) returns text language plpgsql as $$
declare c public.comandas; e text;
begin
  c := public.enviar_comanda(pg_temp.mesa('ZZ Mesa 1'), pg_temp.items('ZZ-PLATO', 1));
  foreach e in array p_estados loop
    c := public.cambiar_estado_comanda(c.id, e);
  end loop;
  return c.estado;
end $$;

select pg_temp.probar('pedido solo de bebidas no crea comanda', '{{USUARIO_TIENDA}}', 'OK comanda ninguna · ítems sin cocina 1',
  $q$ select pg_temp.solo_bebidas() $q$);
select pg_temp.probar('pedido mixto: a cocina solo el plato', '{{USUARIO_TIENDA}}', 'OK en cocina 1 · directo 1',
  $q$ select pg_temp.mixto() $q$);
select pg_temp.probar('quitar una bebida no pide motivo', '{{USUARIO_TIENDA}}', 'OK true',
  $q$ select pg_temp.anular_bebida() $q$);
select pg_temp.probar('estados en orden hasta entregada', '{{USUARIO_TIENDA}}', 'OK entregada',
  $q$ select pg_temp.recorrer(array['preparando', 'lista', 'entregada']) $q$);
select pg_temp.probar('cocina retrocede un paso', '{{USUARIO_TIENDA}}', 'OK pendiente',
  $q$ select pg_temp.recorrer(array['preparando', 'pendiente']) $q$);
select pg_temp.probar('deshacer una entrega vuelve a lista', '{{USUARIO_TIENDA}}', 'OK lista',
  $q$ select pg_temp.recorrer(array['preparando', 'lista', 'entregada', 'lista']) $q$);
select pg_temp.probar('repetir el estado actual no falla', '{{USUARIO_TIENDA}}', 'OK preparando',
  $q$ select pg_temp.recorrer(array['preparando', 'preparando']) $q$);
select pg_temp.probar('saltar de pendiente a lista se rechaza', '{{USUARIO_TIENDA}}', 'ERROR P0001: No se puede pasar',
  $q$ select pg_temp.recorrer(array['lista']) $q$);
select pg_temp.probar('entregada no vuelve a pendiente', '{{USUARIO_TIENDA}}', 'ERROR P0001: No se puede pasar',
  $q$ select pg_temp.recorrer(array['preparando', 'lista', 'entregada', 'pendiente']) $q$);

-- Módulo apagado: nadie usa mesas
update public.empresas set modulos = array_remove(modulos, 'mesas') where id = (select emp from zz_ctx);
select pg_temp.probar('módulo mesas apagado', '{{USUARIO_ADMIN}}', 'ERROR P0001: El módulo mesas no está habilitado',
  $q$ select pg_temp.enviar('ZZ Mesa 1', pg_temp.items('ZZ-PLATO', 1)) $q$);

do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
