-- ============================================================
-- Mi Socio Pyme · 0013 · Productos sin control de stock y ventas offline
-- - productos.controla_stock: un restaurante mezcla productos con inventario
--   (bebidas en lata) y sin inventario (platos); estos se venden siempre, no
--   generan movimientos ni alertas, pero sí cuentan en reportes.
-- - empresas.tipo_negocio (retail | restaurante): solo define el valor por
--   defecto de controla_stock al crear productos y la presentación del POS.
-- - Ventas y salidas encoladas sin conexión (p_permitir_sin_stock): si al
--   sincronizar el stock ya no alcanza, se registran igual (el cliente ya pagó),
--   el stock queda en 0 y la diferencia queda marcada para revisar.
-- ============================================================

alter table public.productos add column if not exists controla_stock boolean not null default true;
alter table public.empresas add column if not exists tipo_negocio text not null default 'retail';
alter table public.empresas drop constraint if exists empresas_tipo_negocio_check;
alter table public.empresas add constraint empresas_tipo_negocio_check check (tipo_negocio in ('retail', 'restaurante'));
alter table public.venta_items add column if not exists sin_stock integer not null default 0;
alter table public.ventas add column if not exists con_diferencia boolean not null default false;

-- Salida interna (idempotente por uuid_local). p_permitir_sin_stock: la usa la cola
-- offline; si el stock ya no alcanza, se registra igual y se deja constancia.
drop function if exists public.registrar_salida(uuid, uuid, uuid, integer, uuid, text, uuid);
create or replace function public.registrar_salida(
  p_producto uuid, p_variante uuid, p_ubicacion uuid, p_cantidad integer,
  p_motivo uuid, p_observaciones text, p_uuid_local uuid,
  p_permitir_sin_stock boolean default false
) returns public.vouchers language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public._contexto(array['salidas.registrar'], 'salidas');
  v_uuid uuid := coalesce(p_uuid_local, gen_random_uuid());
  v_stock public.stock;
  v_mov public.movimientos;
  v_voucher public.vouchers;
  v_prod public.productos;
  v_sin int := 0;
begin
  -- Reintento de una salida ya registrada: devuelve el mismo voucher
  select * into v_mov from public.movimientos where empresa_id = v_emp and uuid_local = v_uuid;
  if found then
    select * into v_voucher from public.vouchers
     where empresa_id = v_emp and tipo = 'movimiento' and referencia_id = v_mov.id;
    return v_voucher;
  end if;

  if p_cantidad is null or p_cantidad <= 0 then raise exception 'Cantidad inválida'; end if;
  perform public._ubicacion_empresa(p_ubicacion, v_emp);
  if not public.puede_ver_ubicacion(p_ubicacion) then raise exception 'Ubicación no autorizada'; end if;
  v_prod := public._producto(p_producto, p_variante, v_emp);
  if not v_prod.controla_stock then
    raise exception 'El producto % no controla stock: regístralo como venta en el punto de venta', v_prod.nombre;
  end if;
  if p_motivo is not null and not exists (
    select 1 from public.motivos_salida where id = p_motivo and empresa_id = v_emp
  ) then
    raise exception 'Motivo de salida no válido';
  end if;

  v_stock := public._stock_row(p_producto, p_variante, p_ubicacion, v_emp);
  if v_stock.disponible < p_cantidad then
    if not coalesce(p_permitir_sin_stock, false) then raise exception 'Stock insuficiente'; end if;
    v_sin := p_cantidad - v_stock.disponible;
  end if;

  update public.stock
     set disponible = disponible - (p_cantidad - v_sin), updated_at = now()
   where id = v_stock.id;

  insert into public.movimientos (
    empresa_id, uuid_local, tipo, producto_id, variante_id,
    ubicacion_origen_id, cantidad, motivo_id, observaciones, usuario_id, estado_sync
  ) values (
    v_emp, v_uuid, 'salida', p_producto, p_variante,
    p_ubicacion, p_cantidad, p_motivo,
    case when v_sin > 0 then concat_ws(' · ', p_observaciones, 'Registrada sin conexión: ' || v_sin || ' u. sin stock')
         else p_observaciones end,
    auth.uid(), 'sincronizado'
  ) returning * into v_mov;

  insert into public.vouchers (
    empresa_id, numero, tipo, referencia_id, ubicacion_id, usuario_id, detalle
  ) values (
    v_emp, public._folio('SAL'), 'movimiento', v_mov.id, p_ubicacion, auth.uid(),
    jsonb_build_object('tipo_movimiento', 'salida', 'cantidad', p_cantidad, 'sin_stock', v_sin)
  ) returning * into v_voucher;

  return v_voucher;
end $$;

-- Ingreso / recepción
create or replace function public.registrar_entrada(
  p_ubicacion uuid, p_items jsonb, p_proveedor uuid,
  p_origen_texto text, p_observaciones text
) returns public.recepciones language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public._contexto(array['ingreso.registrar'], 'ingreso');
  v_rec public.recepciones;
  it jsonb;
  v_prod uuid; v_var uuid; v_cant int; v_costo int;
  v_stock public.stock;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La recepción no tiene productos';
  end if;
  perform public._ubicacion_empresa(p_ubicacion, v_emp);
  if not public.puede_ver_ubicacion(p_ubicacion) then raise exception 'Ubicación no autorizada'; end if;
  if p_proveedor is not null and not exists (
    select 1 from public.proveedores where id = p_proveedor and empresa_id = v_emp
  ) then
    raise exception 'Proveedor no válido';
  end if;

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
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida'; end if;
    if v_costo is not null and v_costo < 0 then raise exception 'Costo unitario inválido'; end if;
    if not (public._producto(v_prod, v_var, v_emp)).controla_stock then
      raise exception 'Un producto sin control de stock no admite ingreso de mercadería';
    end if;

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

-- Crear transferencia (reserva en origen)
create or replace function public.crear_transferencia(
  p_origen uuid, p_destino uuid, p_items jsonb, p_observaciones text
) returns public.transferencias language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public._contexto(array['transferencias.gestionar'], 'bodega');
  v_tr public.transferencias;
  it jsonb;
  v_prod uuid; v_var uuid; v_cant int; v_stock public.stock;
begin
  if p_origen = p_destino then raise exception 'Origen y destino deben ser distintos'; end if;
  perform public._ubicacion_empresa(p_origen, v_emp);
  perform public._ubicacion_empresa(p_destino, v_emp);
  if not public.puede_ver_ubicacion(p_origen) then raise exception 'Origen no autorizado'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La transferencia no tiene productos';
  end if;

  insert into public.transferencias (empresa_id, folio, origen_id, destino_id, estado, observaciones, usuario_despacho_id)
  values (v_emp, public._folio('TRF'), p_origen, p_destino, 'pendiente_despacho', p_observaciones, auth.uid())
  returning * into v_tr;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'producto_id')::uuid;
    v_var := nullif(it->>'variante_id', '')::uuid;
    v_cant := (it->>'cantidad_enviada')::int;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida'; end if;
    if not (public._producto(v_prod, v_var, v_emp)).controla_stock then
      raise exception 'Un producto sin control de stock no se transfiere';
    end if;

    v_stock := public._stock_row(v_prod, v_var, p_origen, v_emp);
    if v_stock.disponible < v_cant then raise exception 'Stock insuficiente en origen'; end if;

    update public.stock
       set disponible = disponible - v_cant, reservado = reservado + v_cant, updated_at = now()
     where id = v_stock.id;

    insert into public.transferencia_items (transferencia_id, producto_id, variante_id, cantidad_enviada)
    values (v_tr.id, v_prod, v_var, v_cant);
  end loop;

  return v_tr;
end $$;

-- Venta POS: precio desde productos, idempotente por uuid_local. Los productos sin
-- control de stock (platos, servicios) se venden sin tocar existencias. Con
-- p_permitir_sin_stock (cola offline) una venta ya cobrada no se rechaza por stock.
drop function if exists public.registrar_venta(uuid, jsonb, text, integer, text, text);
drop function if exists public.registrar_venta(uuid, jsonb, text, integer, text, text, uuid);
create or replace function public.registrar_venta(
  p_ubicacion uuid, p_items jsonb, p_descuento_tipo text,
  p_descuento_valor integer, p_medio_pago text, p_referencia text,
  p_uuid_local uuid default null,
  p_permitir_sin_stock boolean default false
) returns public.ventas language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public._contexto(array['pos.vender'], 'pos');
  v_venta public.ventas;
  v_prod_row public.productos;
  it jsonb;
  v_prod uuid; v_var uuid; v_cant int; v_desc text;
  v_bruto int := 0; v_desc_monto int := 0;
  v_total int; v_neto int; v_iva int;
  v_stock public.stock;
  v_sin int;
  v_hay_dif boolean := false;
begin
  if p_uuid_local is not null then
    select * into v_venta from public.ventas where empresa_id = v_emp and uuid_local = p_uuid_local;
    if found then return v_venta; end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;
  if p_medio_pago not in ('efectivo', 'transferencia', 'debito') then raise exception 'Medio de pago inválido'; end if;
  if p_descuento_tipo not in ('porcentaje', 'monto') then raise exception 'Tipo de descuento inválido'; end if;
  if p_medio_pago = 'efectivo' and nullif(trim(coalesce(p_referencia, '')), '') is not null then
    raise exception 'El efectivo no lleva número de referencia';
  end if;
  if p_medio_pago <> 'efectivo' and nullif(trim(coalesce(p_referencia, '')), '') is null then
    raise exception 'Debe indicar el número de referencia del pago';
  end if;
  perform public._ubicacion_empresa(p_ubicacion, v_emp);
  if not public.puede_ver_ubicacion(p_ubicacion) then raise exception 'Ubicación no autorizada'; end if;

  -- Total con el precio vigente del catálogo (no el enviado por el cliente)
  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := (it->>'cantidad')::int;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida'; end if;
    v_prod_row := public._producto((it->>'producto_id')::uuid, nullif(it->>'variante_id', '')::uuid, v_emp);
    v_bruto := v_bruto + v_cant * v_prod_row.precio_venta;
  end loop;

  if p_descuento_tipo = 'porcentaje' then
    v_desc_monto := round(v_bruto * least(greatest(coalesce(p_descuento_valor, 0), 0), 100) / 100.0);
  else
    v_desc_monto := least(greatest(coalesce(p_descuento_valor, 0), 0), v_bruto);
  end if;

  v_total := v_bruto - v_desc_monto;
  v_neto := round(v_total / 1.19);
  v_iva := v_total - v_neto;

  begin
    insert into public.ventas (
      empresa_id, folio, ubicacion_id, usuario_id, descuento_tipo, descuento_valor,
      neto, iva, total, medio_pago, referencia_pago, uuid_local
    ) values (
      v_emp, public._folio('VTA'), p_ubicacion, auth.uid(), p_descuento_tipo,
      coalesce(p_descuento_valor, 0), v_neto, v_iva, v_total, p_medio_pago,
      nullif(trim(coalesce(p_referencia, '')), ''), p_uuid_local
    ) returning * into v_venta;
  exception when unique_violation then
    -- Dos envíos simultáneos de la misma venta offline: devuelve la existente
    select * into v_venta from public.ventas where empresa_id = v_emp and uuid_local = p_uuid_local;
    if found then return v_venta; end if;
    raise;
  end;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'producto_id')::uuid;
    v_var := nullif(it->>'variante_id', '')::uuid;
    v_cant := (it->>'cantidad')::int;
    v_prod_row := public._producto(v_prod, v_var, v_emp);
    v_desc := v_prod_row.nombre;

    v_sin := 0;
    if v_prod_row.controla_stock then
      v_stock := public._stock_row(v_prod, v_var, p_ubicacion, v_emp);
      if v_stock.disponible < v_cant then
        if not coalesce(p_permitir_sin_stock, false) then
          raise exception 'Stock insuficiente para %', v_desc;
        end if;
        v_sin := v_cant - v_stock.disponible;
        v_hay_dif := true;
      end if;
      update public.stock set disponible = disponible - (v_cant - v_sin), updated_at = now() where id = v_stock.id;
    end if;

    insert into public.venta_items (venta_id, producto_id, variante_id, descripcion, cantidad, precio_unitario, total_linea, sin_stock)
    values (v_venta.id, v_prod, v_var, v_desc, v_cant, v_prod_row.precio_venta, v_cant * v_prod_row.precio_venta, v_sin);

    -- Solo los productos con stock dejan movimiento (historial de existencias y proyección)
    if v_prod_row.controla_stock then
      insert into public.movimientos (
        empresa_id, uuid_local, tipo, producto_id, variante_id,
        ubicacion_origen_id, cantidad, referencia, observaciones, usuario_id, estado_sync
      ) values (
        v_emp, gen_random_uuid(), 'salida', v_prod, v_var,
        p_ubicacion, v_cant, v_venta.folio,
        case when v_sin > 0 then 'Venta registrada sin conexión: ' || v_sin || ' u. sin stock' end,
        auth.uid(), 'sincronizado'
      );
    end if;
  end loop;

  if v_hay_dif then
    update public.ventas set con_diferencia = true where id = v_venta.id returning * into v_venta;
  end if;

  insert into public.vouchers (empresa_id, numero, tipo, referencia_id, ubicacion_id, usuario_id, detalle)
  values (v_emp, v_venta.folio, 'venta', v_venta.id, p_ubicacion, auth.uid(),
    jsonb_build_object(
      'total', v_total, 'neto', v_neto, 'iva', v_iva,
      'medio_pago', p_medio_pago, 'referencia', v_venta.referencia_pago
    ));

  return v_venta;
end $$;

-- ---------------------------------------------------------------------------
-- Proyección de reposición
-- p_hasta: último día a cubrir (por defecto, el próximo domingo; si hoy es
--          domingo, el siguiente). Máximo 90 días.
-- ---------------------------------------------------------------------------
create or replace function public.proyeccion_reposicion(p_hasta date default null)
returns table (
  producto_id uuid,
  variante_id uuid,
  ubicacion_id uuid,
  ubicacion_nombre text,
  ubicacion_tipo text,
  nombre text,
  sku text,
  foto_url text,
  categoria text,
  stock_minimo integer,
  disponible integer,
  transito integer,
  vendido_hoy integer,
  prom_diario numeric,
  prom_por_dia numeric[],
  demanda_periodo integer,
  seguridad integer,
  objetivo integer,
  sugerido integer,
  desde_bodega integer,
  comprar integer,
  bodega_origen_id uuid,
  bodega_disponible integer,
  fecha_quiebre date,
  dias_cobertura integer,
  estado text,
  con_historia boolean,
  detalle jsonb,
  hoy date,
  hasta date,
  semanas_usadas integer,
  factor_temporada numeric
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_emp uuid := public.mi_empresa();
  v_hoy date := public.hoy_negocio();
  v_hasta date;
  v_cfg jsonb;
  v_semanas int;
  v_seg numeric;
  v_ajuste numeric;
  v_inicio date;
  v_n int;
  v_w numeric;
begin
  if v_emp is null then raise exception 'Usuario sin empresa'; end if;
  if not public.es_activo() then raise exception 'Cuenta inactiva'; end if;
  if not public.tiene_cap('modulos.inventario') then raise exception 'No tienes permiso para ver la reposición'; end if;

  select e.reposicion into v_cfg from public.empresas e where e.id = v_emp;
  v_semanas := least(greatest(coalesce((v_cfg->>'semanas')::int, 8), 2), 52);
  v_seg := least(greatest(coalesce((v_cfg->>'seguridad_pct')::numeric, 20), 0), 200) / 100;
  v_ajuste := 1 + least(greatest(coalesce((v_cfg->>'ajuste_pct')::numeric, 0), -90), 300) / 100;

  v_hasta := coalesce(p_hasta,
    v_hoy + case when extract(isodow from v_hoy) = 7 then 7 else 7 - extract(isodow from v_hoy)::int end);
  if v_hasta < v_hoy then raise exception 'La fecha de proyección debe ser hoy o posterior'; end if;
  if v_hasta > v_hoy + 90 then raise exception 'La proyección admite como máximo 90 días'; end if;

  -- Ventana de historia: no más atrás que la primera salida registrada de la empresa,
  -- para no diluir el promedio con semanas en que el sistema aún no se usaba.
  select greatest(v_hoy - 7 * v_semanas,
                  coalesce(min((m.created_at at time zone 'America/Santiago')::date), v_hoy))
    into v_inicio
    from public.movimientos m
   where m.empresa_id = v_emp and m.tipo = 'salida';
  v_n := greatest(1, ceil((v_hoy - v_inicio) / 7.0)::int);
  -- Peso de la semana k (1 = la más reciente): 0,85^(k-1)
  v_w := (1 - power(0.85, v_n)) / (1 - 0.85);

  return query
  with
  ubis as (
    select u.id, u.nombre, u.tipo from public.ubicaciones u
     where u.empresa_id = v_emp and u.activa
  ),
  hist as (
    select m.producto_id, m.variante_id, m.ubicacion_origen_id as ubicacion_id,
           (m.created_at at time zone 'America/Santiago')::date as dia, m.cantidad
      from public.movimientos m
     where m.empresa_id = v_emp and m.tipo = 'salida' and m.ubicacion_origen_id is not null
       and m.created_at >= ((v_hoy - 7 * v_n - 400)::timestamp at time zone 'America/Santiago')
  ),
  -- Promedio ponderado por día de la semana (lunes = 1 … domingo = 7)
  agg as (
    select h.producto_id, h.variante_id, h.ubicacion_id,
           extract(isodow from h.dia)::int as dow,
           sum(power(0.85, (v_hoy - h.dia - 1) / 7) * h.cantidad) / v_w as prom
      from hist h
     where h.dia between v_hoy - 7 * v_n and v_hoy - 1
     group by 1, 2, 3, 4
  ),
  vendido_hoy as (
    select h.producto_id, h.variante_id, h.ubicacion_id, sum(h.cantidad)::int as cant
      from hist h where h.dia = v_hoy group by 1, 2, 3
  ),
  -- Temporada: (venta diaria en el mismo período del año pasado) / (venta diaria
  -- de las semanas previas a ese período), por producto. Requiere > 1 año de datos.
  temporada as (
    select h.producto_id,
           least(greatest(
             (sum(h.cantidad) filter (where h.dia between v_hoy - 364 and v_hasta - 364))::numeric
               / (v_hasta - v_hoy + 1)
             / nullif((sum(h.cantidad) filter (where h.dia between v_hoy - 364 - 7 * v_n and v_hoy - 365))::numeric
               / (7 * v_n), 0),
           0.5), 3) as factor
      from hist h
     where h.dia < v_hoy - 364 + (v_hasta - v_hoy) + 1
     group by 1
    having min(h.dia) <= v_hoy - 364 - 7 * v_n
  ),
  puntos as (
    select s.producto_id, s.variante_id, s.ubicacion_id, u.nombre as ubicacion_nombre, u.tipo as ubicacion_tipo,
           s.disponible, s.transito,
           p.nombre, p.sku, p.foto_url, c.nombre as categoria, p.stock_minimo,
           coalesce(t.factor, 1) * v_ajuste as factor,
           coalesce(t.factor, 1) as factor_temporada,
           coalesce(vh.cant, 0) as vendido_hoy
      from public.stock s
      join ubis u on u.id = s.ubicacion_id
      join public.productos p on p.id = s.producto_id and p.activo and p.controla_stock
      left join public.categorias c on c.id = p.categoria_id
      left join temporada t on t.producto_id = s.producto_id
      left join vendido_hoy vh on vh.producto_id = s.producto_id
                              and vh.variante_id is not distinct from s.variante_id
                              and vh.ubicacion_id = s.ubicacion_id
     where s.empresa_id = v_emp
       -- Las tiendas siempre; una bodega solo si vende directamente (tiene historia)
       and (u.tipo = 'tienda' or exists (
             select 1 from agg a where a.producto_id = s.producto_id and a.ubicacion_id = s.ubicacion_id))
  ),
  perfil as (
    select pt.producto_id, pt.variante_id, pt.ubicacion_id,
           array_agg(round(coalesce(a.prom, 0) * pt.factor, 2) order by d.dow) as por_dia,
           sum(coalesce(a.prom, 0)) * pt.factor / 7 as prom_diario,
           bool_or(a.prom is not null) as con_historia
      from puntos pt
      cross join generate_series(1, 7) d(dow)
      left join agg a on a.producto_id = pt.producto_id and a.variante_id is not distinct from pt.variante_id
                     and a.ubicacion_id = pt.ubicacion_id and a.dow = d.dow
     group by pt.producto_id, pt.variante_id, pt.ubicacion_id, pt.factor
  ),
  -- Demanda esperada día a día (60 días para estimar el quiebre). Hoy se descuenta
  -- lo ya vendido, porque el stock disponible ya lo refleja.
  serie as (
    select pt.producto_id, pt.variante_id, pt.ubicacion_id, g.dia::date as fecha,
           case when g.dia::date = v_hoy
                then greatest(pf.por_dia[extract(isodow from g.dia)::int] - pt.vendido_hoy, 0)
                else pf.por_dia[extract(isodow from g.dia)::int] end as dem,
           pt.disponible + pt.transito as stock_efectivo
      from puntos pt
      join perfil pf using (producto_id, ubicacion_id)
      cross join generate_series(v_hoy, v_hoy + 59, interval '1 day') g(dia)
     where pf.variante_id is not distinct from pt.variante_id
  ),
  acum as (
    select s.*, sum(s.dem) over (partition by s.producto_id, s.variante_id, s.ubicacion_id order by s.fecha) as cum
      from serie s
  ),
  proy as (
    select a.producto_id, a.variante_id, a.ubicacion_id,
           ceil(coalesce(sum(a.dem) filter (where a.fecha <= v_hasta), 0))::int as demanda_periodo,
           min(a.fecha) filter (where a.cum > a.stock_efectivo and a.cum > 0) as fecha_quiebre,
           jsonb_agg(jsonb_build_object('fecha', a.fecha, 'demanda', round(a.dem, 1)) order by a.fecha)
             filter (where a.fecha <= v_hasta) as detalle
      from acum a
     group by 1, 2, 3
  ),
  calc as (
    select pt.*, pf.por_dia, pf.prom_diario, pf.con_historia, pr.demanda_periodo, pr.fecha_quiebre, pr.detalle,
           ceil(pr.demanda_periodo * v_seg)::int as seguridad,
           greatest(pr.demanda_periodo + ceil(pr.demanda_periodo * v_seg)::int, pt.stock_minimo) as objetivo
      from puntos pt
      join perfil pf on pf.producto_id = pt.producto_id and pf.variante_id is not distinct from pt.variante_id
                    and pf.ubicacion_id = pt.ubicacion_id
      join proy pr on pr.producto_id = pt.producto_id and pr.variante_id is not distinct from pt.variante_id
                  and pr.ubicacion_id = pt.ubicacion_id
  ),
  estados as (
    select c.*,
           greatest(c.objetivo - (c.disponible + c.transito), 0) as sugerido,
           case
             when c.disponible = 0 and (c.prom_diario > 0 or c.stock_minimo > 0) then 'quebrado'
             when c.fecha_quiebre is not null and c.fecha_quiebre <= v_hasta then 'por_quebrar'
             when c.stock_minimo > 0 and c.disponible <= c.stock_minimo then 'bajo_minimo'
             else 'ok'
           end as estado
      from calc c
  ),
  bodegas as (
    select s.producto_id, s.variante_id, sum(s.disponible)::int as disp,
           (array_agg(s.ubicacion_id order by s.disponible desc))[1] as origen
      from public.stock s join ubis u on u.id = s.ubicacion_id and u.tipo = 'bodega'
     where s.empresa_id = v_emp and s.disponible > 0
     group by 1, 2
  ),
  -- Reparte el stock de bodega entre tiendas, primero las que quiebran antes
  reparto as (
    select e.*, b.disp as bodega_disp, b.origen,
           sum(e.sugerido) filter (where e.ubicacion_tipo = 'tienda') over (
             partition by e.producto_id, e.variante_id
             order by (e.estado = 'quebrado') desc, e.fecha_quiebre nulls last, e.ubicacion_nombre
             rows between unbounded preceding and current row) as cum_sug
      from estados e
      left join bodegas b on b.producto_id = e.producto_id and b.variante_id is not distinct from e.variante_id
  )
  select r.producto_id, r.variante_id, r.ubicacion_id, r.ubicacion_nombre, r.ubicacion_tipo,
         r.nombre, r.sku, r.foto_url, r.categoria, r.stock_minimo,
         r.disponible, r.transito, r.vendido_hoy,
         round(r.prom_diario, 2), r.por_dia,
         r.demanda_periodo, r.seguridad, r.objetivo, r.sugerido,
         d.desde_bodega, r.sugerido - d.desde_bodega,
         case when d.desde_bodega > 0 then r.origen end,
         coalesce(r.bodega_disp, 0),
         r.fecha_quiebre, (r.fecha_quiebre - v_hoy)::int,
         r.estado, r.con_historia, coalesce(r.detalle, '[]'::jsonb),
         v_hoy, v_hasta, v_n, round(r.factor_temporada, 2)
    from reparto r
    cross join lateral (
      select case when r.ubicacion_tipo = 'tienda'
                  then greatest(0, least(r.sugerido, coalesce(r.bodega_disp, 0) - (coalesce(r.cum_sug, 0) - r.sugerido)))::int
                  else 0 end as desde_bodega
    ) d
   where public.puede_ver_ubicacion(r.ubicacion_id)
   order by case r.estado when 'quebrado' then 0 when 'por_quebrar' then 1 when 'bajo_minimo' then 2 else 3 end,
            r.fecha_quiebre nulls last, r.nombre, r.ubicacion_nombre;
end $$;

create or replace function public.simular_historia(p_semanas integer default 12)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_hoy date := public.hoy_negocio();
  v_n int;
  -- Multiplicador por día de la semana (lunes … domingo)
  v_mult numeric[] := array[0.7, 0.65, 0.8, 0.95, 1.35, 1.75, 1.3];
begin
  if v_emp is null or not public.es_admin_empresa(v_emp) or not public.tiene_cap('config.gestionar') then
    raise exception 'Solo un administrador de la empresa puede generar historia simulada';
  end if;
  if p_semanas is null or p_semanas < 1 or p_semanas > 52 then raise exception 'Semanas inválidas (1 a 52)'; end if;

  delete from public.ventas where empresa_id = v_emp and simulado;
  delete from public.movimientos where empresa_id = v_emp and simulado;

  drop table if exists _sim_lineas;
  create temp table _sim_lineas on commit drop as
  with tasas as (
    -- Tasa base diaria por producto y tienda: los productos baratos rotan más
    -- Productos con stock: donde la tienda lo tiene; sin control de stock: en todas
    select p.id as producto_id, null::uuid as variante_id, u.id as ubicacion_id, p.precio_venta, p.nombre,
           p.controla_stock,
           (0.3 + random() * 1.4) * case when p.precio_venta < 15000 then 1.6
                                         when p.precio_venta < 40000 then 1.0 else 0.5 end as tasa
      from public.productos p
      join public.ubicaciones u on u.empresa_id = p.empresa_id and u.tipo = 'tienda' and u.activa
     where p.empresa_id = v_emp and p.activo
       and (not p.controla_stock
            or exists (select 1 from public.stock s where s.producto_id = p.id and s.ubicacion_id = u.id))
  ),
  dias as (
    select d::date as dia, extract(isodow from d)::int as dow, (v_hoy - d::date - 1) / 7 as semanas_atras
      from generate_series(v_hoy - 7 * p_semanas, v_hoy - 1, interval '1 day') d
  ),
  lineas as (
    -- floor(x + U) tiene esperanza x; leve crecimiento hacia las semanas recientes
    select t.producto_id, t.variante_id, t.ubicacion_id, t.precio_venta, t.nombre, t.controla_stock, d.dia,
           floor(t.tasa * v_mult[d.dow] * (1 + 0.015 * (p_semanas - d.semanas_atras)) + random())::int as cant
      from tasas t cross join dias d
  )
  select l.*, (row_number() over (partition by l.ubicacion_id, l.dia order by random()) - 1) / 2 as ticket
    from lineas l where l.cant > 0;

  drop table if exists _sim_tickets;
  create temp table _sim_tickets on commit drop as
  select x.*,
         'SIM-' || to_char(x.dia, 'YYMMDD') || '-' ||
           lpad((row_number() over (partition by x.dia order by x.ts))::text, 4, '0') as folio,
         case when x.r < 0.5 then 'efectivo' when x.r < 0.8 then 'debito' else 'transferencia' end as medio
    from (
      select l.ubicacion_id, l.dia, l.ticket, gen_random_uuid() as venta_id,
             sum(l.cant * l.precio_venta)::int as total,
             ((l.dia + time '10:00') + random() * interval '10 hours') at time zone 'America/Santiago' as ts,
             random() as r
        from _sim_lineas l
       group by l.ubicacion_id, l.dia, l.ticket
    ) x;

  insert into public.ventas (
    id, empresa_id, folio, ubicacion_id, usuario_id, descuento_tipo, descuento_valor,
    neto, iva, total, medio_pago, referencia_pago, estado_sync, simulado, created_at
  )
  select t.venta_id, v_emp, t.folio, t.ubicacion_id, auth.uid(), 'monto', 0,
         round(t.total / 1.19), t.total - round(t.total / 1.19), t.total, t.medio,
         case when t.medio = 'efectivo' then null else lpad(floor(random() * 1000000)::text, 6, '0') end,
         'sincronizado', true, t.ts
    from _sim_tickets t;
  get diagnostics v_n = row_count;

  insert into public.venta_items (venta_id, producto_id, variante_id, descripcion, cantidad, precio_unitario, total_linea)
  select t.venta_id, l.producto_id, l.variante_id, l.nombre, l.cant, l.precio_venta, l.cant * l.precio_venta
    from _sim_lineas l
    join _sim_tickets t on t.ubicacion_id = l.ubicacion_id and t.dia = l.dia and t.ticket = l.ticket;

  insert into public.movimientos (
    empresa_id, uuid_local, tipo, producto_id, variante_id, ubicacion_origen_id, cantidad,
    referencia, observaciones, usuario_id, estado_sync, simulado, created_at
  )
  select v_emp, gen_random_uuid(), 'salida', l.producto_id, l.variante_id, l.ubicacion_id, l.cant,
         t.folio, 'Venta simulada', auth.uid(), 'sincronizado', true, t.ts
    from _sim_lineas l
    join _sim_tickets t on t.ubicacion_id = l.ubicacion_id and t.dia = l.dia and t.ticket = l.ticket
   where l.controla_stock;

  return v_n;
end $$;


-- ---------------- Privilegios ----------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.registrar_salida(uuid,uuid,uuid,integer,uuid,text,uuid,boolean)',
    'public.registrar_entrada(uuid,jsonb,uuid,text,text)',
    'public.crear_transferencia(uuid,uuid,jsonb,text)',
    'public.registrar_venta(uuid,jsonb,text,integer,text,text,uuid,boolean)',
    'public.proyeccion_reposicion(date)',
    'public.simular_historia(integer)'
  ]
  loop
    execute format('revoke execute on function %s from anon, public;', f);
    execute format('grant execute on function %s to authenticated, service_role;', f);
  end loop;
end $$;
