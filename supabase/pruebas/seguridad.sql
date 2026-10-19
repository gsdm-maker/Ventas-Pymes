-- ============================================================
-- Mi Socio Pyme · Pruebas de seguridad (RLS + RPC) — se ejecutan y se REVIERTEN.
-- Cada caso corre como un usuario real dentro de una subtransacción; al final
-- se lanza una excepción con el resultado en JSON, así nada queda guardado.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/seguridad.sql
--      (anteponer una migración con --antes para probarla sin aplicarla)
-- Usuarios: {{USUARIO_TIENDA}} (tienda, 3 tiendas) · {{USUARIO_ADMIN}} (admin)
-- ============================================================
create temp table zz_resultados (n serial, caso text, esperado text, obtenido text);

create function pg_temp.probar(p_caso text, p_usuario text, p_esperado text, p_sql text, p_prep text default null)
returns void language plpgsql as $$
declare v text; v_uid uuid;
begin
  begin
    -- Preparación opcional como superusuario (también se revierte)
    if p_prep is not null then execute p_prep; end if;
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

-- Venta de 1 unidad en la tienda autorizada con más stock, enviando precio_unitario = 1
create function pg_temp.sql_venta(p_uuid text) returns text language sql as $f$
  select format($q$
    with s as (
      select s.ubicacion_id u, s.producto_id p, pr.precio_venta pv
        from public.stock s
        join public.productos pr on pr.id = s.producto_id
       where s.disponible > 0 and s.variante_id is null and pr.activo
         and public.puede_ver_ubicacion(s.ubicacion_id)
       order by s.disponible desc limit 1)
    select v.total || ' / precio catalogo ' || s.pv
      from s, lateral public.registrar_venta(s.u,
        jsonb_build_array(jsonb_build_object('producto_id', s.p, 'cantidad', 1, 'precio_unitario', 1, 'descripcion', 'x')),
        'monto', 0, 'efectivo', null %s) v
  $q$, case when p_uuid is null then '' else ', ' || quote_literal(p_uuid) || '::uuid' end);
$f$;

-- La misma venta offline enviada dos veces (mismo uuid_local) debe quedar una sola vez
create function pg_temp.venta_doble() returns text language plpgsql as $$
declare a text; b text; n int;
begin
  execute pg_temp.sql_venta('11111111-2222-3333-4444-555555555555') into a;
  execute pg_temp.sql_venta('11111111-2222-3333-4444-555555555555') into b;
  select count(*) into n from public.ventas where uuid_local = '11111111-2222-3333-4444-555555555555';
  return n || ' venta(s)';
end $$;

-- La misma salida offline enviada dos veces debe devolver el mismo voucher
create function pg_temp.salida_doble() returns text language plpgsql as $$
declare v1 text; v2 text; p uuid; u uuid;
begin
  select s.producto_id, s.ubicacion_id into p, u from public.stock s
   where s.disponible > 1 and s.variante_id is null and public.puede_ver_ubicacion(s.ubicacion_id)
   order by s.disponible desc limit 1;
  select numero into v1 from public.registrar_salida(p, null, u, 1, null, 'prueba', '99999999-2222-3333-4444-555555555555');
  select numero into v2 from public.registrar_salida(p, null, u, 1, null, 'prueba', '99999999-2222-3333-4444-555555555555');
  return case when v1 = v2 then 'mismo voucher' else 'vouchers distintos' end;
end $$;

-- Crear + despachar una transferencia de 1 unidad y recibir p_cant
create function pg_temp.recibir(p_cant int) returns text language plpgsql as $$
declare t public.transferencias; p uuid; o uuid; d uuid; it uuid;
begin
  select s.producto_id, s.ubicacion_id into p, o from public.stock s
   where s.disponible > 0 and s.variante_id is null order by s.disponible desc limit 1;
  select id into d from public.ubicaciones where id <> o order by nombre limit 1;
  t := public.crear_transferencia(o, d, jsonb_build_array(jsonb_build_object('producto_id', p, 'cantidad_enviada', 1)), 'prueba');
  perform public.despachar_transferencia(t.id);
  select id into it from public.transferencia_items where transferencia_id = t.id;
  t := public.recibir_transferencia(t.id, jsonb_build_array(jsonb_build_object('id', it, 'cantidad_recibida', p_cant)));
  return t.estado;
end $$;

-- ---------------- Ataques (deben FALLAR) ----------------
select pg_temp.probar('anon ejecuta _stock_row (fuga entre empresas)', 'anon', 'ERROR 42501',
  (select format('select (public._stock_row(%L::uuid, null, %L::uuid, %L::uuid)).disponible::text',
                 producto_id, ubicacion_id, empresa_id) from public.stock where variante_id is null limit 1));
select pg_temp.probar('juan ejecuta _stock_row', '{{USUARIO_TIENDA}}', 'ERROR 42501',
  (select format('select (public._stock_row(%L::uuid, null, %L::uuid, %L::uuid)).disponible::text',
                 producto_id, ubicacion_id, empresa_id) from public.stock where variante_id is null limit 1));
select pg_temp.probar('juan borra su ubicacion_acceso (pasa a ver todo)', '{{USUARIO_TIENDA}}', 'ERROR 42501',
  $q$ with d as (delete from public.ubicacion_acceso where user_id = auth.uid() returning 1) select count(*)::text from d $q$);
select pg_temp.probar('juan se da puesto admin y permisos', '{{USUARIO_TIENDA}}', 'ERROR P0001',
  $q$ with u as (update public.profiles set puesto = 'admin', permissions = '{"usuarios.gestionar":true}' where id = auth.uid() returning 1) select count(*)::text from u $q$);
select pg_temp.probar('juan cambia su correo', '{{USUARIO_TIENDA}}', 'ERROR P0001',
  $q$ with u as (update public.profiles set email = 'otro@x.cl' where id = auth.uid() returning 1) select count(*)::text from u $q$);
select pg_temp.probar('juan suma 100 al stock directo', '{{USUARIO_TIENDA}}', 'ERROR 42501',
  $q$ with u as (update public.stock set disponible = disponible + 100 returning 1) select count(*)::text from u $q$);
select pg_temp.probar('juan borra movimientos confirmados', '{{USUARIO_TIENDA}}', 'ERROR 42501',
  $q$ with d as (delete from public.movimientos returning 1) select count(*)::text from d $q$);
select pg_temp.probar('juan borra vouchers', '{{USUARIO_TIENDA}}', 'ERROR 42501',
  $q$ with d as (delete from public.vouchers returning 1) select count(*)::text from d $q$);
select pg_temp.probar('juan (tienda) crea producto', '{{USUARIO_TIENDA}}', 'ERROR 42501',
  $q$ with i as (insert into public.productos (empresa_id, sku, nombre) values (public.mi_empresa(), 'ZZ-TEST', 'x') returning 1) select count(*)::text from i $q$);
select pg_temp.probar('juan (tienda) crea transferencia', '{{USUARIO_TIENDA}}', 'ERROR P0001 sin permiso',
  $q$ select folio from public.crear_transferencia(
        (select id from public.ubicaciones order by nombre limit 1),
        (select id from public.ubicaciones order by nombre desc limit 1),
        '[{"producto_id":"00000000-0000-0000-0000-000000000000","cantidad_enviada":1}]'::jsonb, null) $q$);
select pg_temp.probar('venta enviando precio_unitario = 1', '{{USUARIO_TIENDA}}', 'OK total = precio catalogo',
  pg_temp.sql_venta(null));
select pg_temp.probar('admin desactiva a otro admin directo', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.profiles set activo = false where email = '{{USUARIO_TIENDA}}' returning 1) select count(*)::text from u $q$,
  $p$ update public.profiles set role = 'admin' where email = '{{USUARIO_TIENDA}}' $p$);
select pg_temp.probar('recibir 500 de 1 enviado', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ select pg_temp.recibir(500) $q$);

-- ---------------- Operación legítima (debe FUNCIONAR) ----------------
select pg_temp.probar('venta offline duplicada (mismo uuid_local)', '{{USUARIO_TIENDA}}', 'OK 1 venta(s)',
  $q$ select pg_temp.venta_doble() $q$);
select pg_temp.probar('salida offline duplicada (mismo uuid_local)', '{{USUARIO_TIENDA}}', 'OK mismo voucher',
  $q$ select pg_temp.salida_doble() $q$);
select pg_temp.probar('juan ve solo sus ubicaciones', '{{USUARIO_TIENDA}}', 'OK 3',
  $q$ select count(*)::text from public.ubicaciones $q$);
select pg_temp.probar('juan cambia su nombre', '{{USUARIO_TIENDA}}', 'OK 1',
  $q$ with u as (update public.profiles set nombre = nombre where id = auth.uid() returning 1) select count(*)::text from u $q$);
select pg_temp.probar('juan limpia must_change_password', '{{USUARIO_TIENDA}}', 'OK 1',
  $q$ with u as (update public.profiles set must_change_password = false where id = auth.uid() returning 1) select count(*)::text from u $q$);
select pg_temp.probar('admin cambia puesto de juan', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with u as (update public.profiles set puesto = 'bodega' where email = '{{USUARIO_TIENDA}}' returning 1) select count(*)::text from u $q$);
select pg_temp.probar('admin crea producto', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with i as (insert into public.productos (empresa_id, sku, nombre) values (public.mi_empresa(), 'ZZ-TEST', 'x') returning 1) select count(*)::text from i $q$);
select pg_temp.probar('admin edita configuración de empresa', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with u as (update public.empresas set nombre = nombre where id = public.mi_empresa() returning 1) select count(*)::text from u $q$);
select pg_temp.probar('admin lee ubicacion_acceso', '{{USUARIO_ADMIN}}', 'OK >=3',
  $q$ select count(*)::text from public.ubicacion_acceso $q$);
select pg_temp.probar('admin lee venta_items', '{{USUARIO_ADMIN}}', 'OK n',
  $q$ select count(*)::text from public.venta_items $q$);
select pg_temp.probar('admin transfiere recibiendo menos (diferencia)', '{{USUARIO_ADMIN}}', 'OK recibida_con_diferencias',
  $q$ select pg_temp.recibir(0) $q$);

-- Resultado (aborta la transacción: nada queda guardado)
do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
