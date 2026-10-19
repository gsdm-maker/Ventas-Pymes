-- ============================================================
-- Mi Socio Pyme · 0003 · Operaciones de negocio (RPC transaccionales)
-- Toda la lógica de stock vive aquí; el cliente solo llama funciones.
-- ============================================================
create sequence if not exists public.folio_seq;

create or replace function public._folio(prefix text)
returns text language sql volatile as $$
  select prefix || '-' || to_char(now(), 'YYMMDD') || '-' ||
         lpad(nextval('public.folio_seq')::text, 5, '0');
$$;

-- Devuelve (y crea si falta) la fila de stock de un producto/variante/ubicación
create or replace function public._stock_row(
  p_prod uuid, p_var uuid, p_ubi uuid, p_emp uuid
) returns public.stock language plpgsql security definer set search_path = public as $$
declare r public.stock;
begin
  select * into r from public.stock
   where producto_id = p_prod
     and ubicacion_id = p_ubi
     and coalesce(variante_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_var, '00000000-0000-0000-0000-000000000000'::uuid);
  if not found then
    insert into public.stock (empresa_id, producto_id, variante_id, ubicacion_id)
    values (p_emp, p_prod, p_var, p_ubi)
    returning * into r;
  end if;
  return r;
end $$;

-- ---------------------- Salida interna de mercadería -----------------------
create or replace function public.registrar_salida(
  p_producto uuid, p_variante uuid, p_ubicacion uuid, p_cantidad integer,
  p_motivo uuid, p_observaciones text, p_uuid_local uuid
) returns public.vouchers language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_stock public.stock;
  v_mov public.movimientos;
  v_voucher public.vouchers;
begin
  if v_emp is null then raise exception 'Usuario sin empresa'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'Cantidad inválida'; end if;
  if not public.puede_ver_ubicacion(p_ubicacion) then raise exception 'Ubicación no autorizada'; end if;

  v_stock := public._stock_row(p_producto, p_variante, p_ubicacion, v_emp);
  if v_stock.disponible < p_cantidad then raise exception 'Stock insuficiente'; end if;

  update public.stock
     set disponible = disponible - p_cantidad, updated_at = now()
   where id = v_stock.id;

  insert into public.movimientos (
    empresa_id, uuid_local, tipo, producto_id, variante_id,
    ubicacion_origen_id, cantidad, motivo_id, observaciones, usuario_id, estado_sync
  ) values (
    v_emp, coalesce(p_uuid_local, gen_random_uuid()), 'salida', p_producto, p_variante,
    p_ubicacion, p_cantidad, p_motivo, p_observaciones, auth.uid(), 'sincronizado'
  ) returning * into v_mov;

  insert into public.vouchers (
    empresa_id, numero, tipo, referencia_id, ubicacion_id, usuario_id, detalle
  ) values (
    v_emp, public._folio('SAL'), 'movimiento', v_mov.id, p_ubicacion, auth.uid(),
    jsonb_build_object('tipo_movimiento', 'salida', 'cantidad', p_cantidad)
  ) returning * into v_voucher;

  return v_voucher;
end $$;

-- ---------------------- Ingreso / recepción de mercadería ------------------
create or replace function public.registrar_entrada(
  p_ubicacion uuid, p_items jsonb, p_proveedor uuid,
  p_origen_texto text, p_observaciones text
) returns public.recepciones language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_rec public.recepciones;
  it jsonb;
  v_prod uuid; v_var uuid; v_cant int; v_costo int;
  v_stock public.stock;
begin
  if v_emp is null then raise exception 'Usuario sin empresa'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La recepción no tiene productos';
  end if;
  if not public.puede_ver_ubicacion(p_ubicacion) then raise exception 'Ubicación no autorizada'; end if;

  insert into public.recepciones (
    empresa_id, proveedor_id, origen_texto, ubicacion_destino_id, observaciones, usuario_id
  ) values (
    v_emp, p_proveedor, p_origen_texto, p_ubicacion, p_observaciones, auth.uid()
  ) returning * into v_rec;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'producto_id')::uuid;
    v_var := nullif(it->>'variante_id', '')::uuid;
    v_cant := (it->>'cantidad')::int;
    v_costo := nullif(it->>'costo_unitario', '')::int;

    insert into public.recepcion_items (recepcion_id, producto_id, variante_id, cantidad, costo_unitario)
    values (v_rec.id, v_prod, v_var, v_cant, v_costo);

    v_stock := public._stock_row(v_prod, v_var, p_ubicacion, v_emp);
    update public.stock set disponible = disponible + v_cant, updated_at = now() where id = v_stock.id;

    insert into public.movimientos (
      empresa_id, uuid_local, tipo, producto_id, variante_id,
      ubicacion_destino_id, cantidad, observaciones, usuario_id, estado_sync
    ) values (
      v_emp, gen_random_uuid(), 'entrada', v_prod, v_var,
      p_ubicacion, v_cant, p_observaciones, auth.uid(), 'sincronizado'
    );
  end loop;

  return v_rec;
end $$;

-- ---------------------- Transferencias entre ubicaciones -------------------
create or replace function public.crear_transferencia(
  p_origen uuid, p_destino uuid, p_items jsonb, p_observaciones text
) returns public.transferencias language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_tr public.transferencias;
  it jsonb;
  v_prod uuid; v_var uuid; v_cant int; v_stock public.stock;
begin
  if v_emp is null then raise exception 'Usuario sin empresa'; end if;
  if p_origen = p_destino then raise exception 'Origen y destino deben ser distintos'; end if;
  if not public.puede_ver_ubicacion(p_origen) then raise exception 'Origen no autorizado'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La transferencia no tiene productos';
  end if;

  insert into public.transferencias (empresa_id, folio, origen_id, destino_id, estado, observaciones, usuario_despacho_id)
  values (v_emp, public._folio('TRF'), p_origen, p_destino, 'pendiente_despacho', p_observaciones, auth.uid())
  returning * into v_tr;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'producto_id')::uuid;
    v_var := nullif(it->>'variante_id', '')::uuid;
    v_cant := (it->>'cantidad_enviada')::int;
    if v_cant <= 0 then raise exception 'Cantidad inválida'; end if;

    v_stock := public._stock_row(v_prod, v_var, p_origen, v_emp);
    if v_stock.disponible < v_cant then raise exception 'Stock insuficiente en origen'; end if;

    -- Reserva: sale de disponible, entra a reservado en el origen
    update public.stock
       set disponible = disponible - v_cant, reservado = reservado + v_cant, updated_at = now()
     where id = v_stock.id;

    insert into public.transferencia_items (transferencia_id, producto_id, variante_id, cantidad_enviada)
    values (v_tr.id, v_prod, v_var, v_cant);
  end loop;

  return v_tr;
end $$;

create or replace function public.despachar_transferencia(p_id uuid)
returns public.transferencias language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_tr public.transferencias;
  it public.transferencia_items;
  v_stock public.stock;
begin
  select * into v_tr from public.transferencias where id = p_id and empresa_id = v_emp;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if v_tr.estado <> 'pendiente_despacho' then raise exception 'Estado inválido para despachar'; end if;

  for it in select * from public.transferencia_items where transferencia_id = p_id loop
    -- Libera la reserva en origen
    v_stock := public._stock_row(it.producto_id, it.variante_id, v_tr.origen_id, v_emp);
    update public.stock set reservado = reservado - it.cantidad_enviada, updated_at = now() where id = v_stock.id;
    -- Registra tránsito hacia el destino
    v_stock := public._stock_row(it.producto_id, it.variante_id, v_tr.destino_id, v_emp);
    update public.stock set transito = transito + it.cantidad_enviada, updated_at = now() where id = v_stock.id;
    -- Movimiento de trazabilidad
    insert into public.movimientos (
      empresa_id, uuid_local, tipo, producto_id, variante_id,
      ubicacion_origen_id, ubicacion_destino_id, cantidad, referencia, usuario_id, estado_sync
    ) values (
      v_emp, gen_random_uuid(), 'transferencia', it.producto_id, it.variante_id,
      v_tr.origen_id, v_tr.destino_id, it.cantidad_enviada, v_tr.folio, auth.uid(), 'sincronizado'
    );
  end loop;

  update public.transferencias
     set estado = 'en_transito', despachada_at = now()
   where id = p_id returning * into v_tr;

  insert into public.vouchers (empresa_id, numero, tipo, referencia_id, ubicacion_id, usuario_id, detalle)
  values (v_emp, public._folio('VTR'), 'transferencia', v_tr.id, v_tr.destino_id, auth.uid(),
          jsonb_build_object('origen', v_tr.origen_id, 'destino', v_tr.destino_id));

  return v_tr;
end $$;

create or replace function public.recibir_transferencia(p_id uuid, p_items jsonb)
returns public.transferencias language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_tr public.transferencias;
  it public.transferencia_items;
  v_rec int;
  v_hay_diff boolean := false;
  v_stock public.stock;
begin
  select * into v_tr from public.transferencias where id = p_id and empresa_id = v_emp;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if v_tr.estado <> 'en_transito' then raise exception 'Estado inválido para recibir'; end if;
  if not public.puede_ver_ubicacion(v_tr.destino_id) then raise exception 'Destino no autorizado'; end if;

  for it in select * from public.transferencia_items where transferencia_id = p_id loop
    v_rec := coalesce((
      select (e->>'cantidad_recibida')::int
        from jsonb_array_elements(p_items) e
       where (e->>'id')::uuid = it.id
    ), it.cantidad_enviada);

    update public.transferencia_items
       set cantidad_recibida = v_rec, diferencia = v_rec - it.cantidad_enviada
     where id = it.id;

    if v_rec <> it.cantidad_enviada then v_hay_diff := true; end if;

    -- Baja el tránsito y suma disponibilidad real
    v_stock := public._stock_row(it.producto_id, it.variante_id, v_tr.destino_id, v_emp);
    update public.stock
       set transito = transito - it.cantidad_enviada,
           disponible = disponible + v_rec,
           updated_at = now()
     where id = v_stock.id;
  end loop;

  update public.transferencias
     set estado = case when v_hay_diff then 'recibida_con_diferencias' else 'recibida' end,
         recibida_at = now(),
         usuario_recepcion_id = auth.uid()
   where id = p_id returning * into v_tr;

  return v_tr;
end $$;

-- ---------------------- Registro de venta (POS) ----------------------------
create or replace function public.registrar_venta(
  p_ubicacion uuid, p_items jsonb, p_descuento_tipo text,
  p_descuento_valor integer, p_medio_pago text, p_referencia text
) returns public.ventas language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_venta public.ventas;
  it jsonb;
  v_prod uuid; v_var uuid; v_cant int; v_precio int; v_desc text;
  v_bruto int := 0; v_desc_monto int := 0;
  v_total int; v_neto int; v_iva int;
  v_stock public.stock;
begin
  if v_emp is null then raise exception 'Usuario sin empresa'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene productos'; end if;
  if p_medio_pago not in ('efectivo', 'transferencia', 'debito') then raise exception 'Medio de pago inválido'; end if;
  if p_medio_pago = 'efectivo' and nullif(trim(coalesce(p_referencia, '')), '') is not null then
    raise exception 'El efectivo no lleva número de referencia';
  end if;
  if p_medio_pago <> 'efectivo' and nullif(trim(coalesce(p_referencia, '')), '') is null then
    raise exception 'Debe indicar el número de referencia del pago';
  end if;
  if not public.puede_ver_ubicacion(p_ubicacion) then raise exception 'Ubicación no autorizada'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_bruto := v_bruto + ((it->>'cantidad')::int * (it->>'precio_unitario')::int);
  end loop;

  if p_descuento_tipo = 'porcentaje' then
    v_desc_monto := round(v_bruto * least(greatest(coalesce(p_descuento_valor, 0), 0), 100) / 100.0);
  else
    v_desc_monto := least(greatest(coalesce(p_descuento_valor, 0), 0), v_bruto);
  end if;

  v_total := v_bruto - v_desc_monto;
  v_neto := round(v_total / 1.19);
  v_iva := v_total - v_neto;

  insert into public.ventas (
    empresa_id, folio, ubicacion_id, usuario_id, descuento_tipo, descuento_valor,
    neto, iva, total, medio_pago, referencia_pago
  ) values (
    v_emp, public._folio('VTA'), p_ubicacion, auth.uid(), p_descuento_tipo,
    coalesce(p_descuento_valor, 0), v_neto, v_iva, v_total, p_medio_pago,
    nullif(trim(coalesce(p_referencia, '')), '')
  ) returning * into v_venta;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'producto_id')::uuid;
    v_var := nullif(it->>'variante_id', '')::uuid;
    v_cant := (it->>'cantidad')::int;
    v_precio := (it->>'precio_unitario')::int;
    v_desc := coalesce(it->>'descripcion', 'Producto');

    v_stock := public._stock_row(v_prod, v_var, p_ubicacion, v_emp);
    if v_stock.disponible < v_cant then raise exception 'Stock insuficiente para %', v_desc; end if;
    update public.stock set disponible = disponible - v_cant, updated_at = now() where id = v_stock.id;

    insert into public.venta_items (venta_id, producto_id, variante_id, descripcion, cantidad, precio_unitario, total_linea)
    values (v_venta.id, v_prod, v_var, v_desc, v_cant, v_precio, v_cant * v_precio);

    insert into public.movimientos (
      empresa_id, uuid_local, tipo, producto_id, variante_id,
      ubicacion_origen_id, cantidad, referencia, usuario_id, estado_sync
    ) values (
      v_emp, gen_random_uuid(), 'salida', v_prod, v_var,
      p_ubicacion, v_cant, v_venta.folio, auth.uid(), 'sincronizado'
    );
  end loop;

  insert into public.vouchers (empresa_id, numero, tipo, referencia_id, ubicacion_id, usuario_id, detalle)
  values (v_emp, v_venta.folio, 'venta', v_venta.id, p_ubicacion, auth.uid(),
    jsonb_build_object(
      'total', v_total, 'neto', v_neto, 'iva', v_iva,
      'medio_pago', p_medio_pago, 'referencia', v_venta.referencia_pago
    ));

  return v_venta;
end $$;

-- ---------------------- Privilegios ----------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.registrar_salida(uuid,uuid,uuid,integer,uuid,text,uuid)',
    'public.registrar_entrada(uuid,jsonb,uuid,text,text)',
    'public.crear_transferencia(uuid,uuid,jsonb,text)',
    'public.despachar_transferencia(uuid)',
    'public.recibir_transferencia(uuid,jsonb)',
    'public.registrar_venta(uuid,jsonb,text,integer,text,text)'
  ]
  loop
    execute format('revoke execute on function %s from anon, public;', f);
    execute format('grant execute on function %s to authenticated, service_role;', f);
  end loop;
end $$;
