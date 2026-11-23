successfully downloaded text file (SHA: 0dc5d082b79850cca0c193c553d5a35c8fb94b6b)
-- ============================================================
-- Mi Socio Pyme · 0029: presentaciones de un producto (caja, pack, display)
-- El producto lleva su stock en la unidad base (UN). Una presentación es otra forma de
-- comprarlo o venderlo: «Caja x50» = 50 unidades, con precio y código de barras propios.
--   · Venta de 1 caja: cobra el precio de la caja y descuenta 50 u. del stock.
--   · Ingreso: se escriben cajas y el cliente envía unidades y costo por unidad.
-- Solo para productos sin tallas/colores. Pruebas: supabase/pruebas/presentaciones.sql
-- ============================================================

create table if not exists public.producto_presentaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete cascade,
  nombre text not null,
  factor integer not null check (factor between 2 and 100000),
  precio_venta integer not null check (precio_venta >= 0),
  codigo_barras text,
  se_vende boolean not null default true,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  constraint producto_presentaciones_nombre check (length(trim(nombre)) between 1 and 40),
  unique (producto_id, factor)
);
create index if not exists producto_presentaciones_producto on public.producto_presentaciones (producto_id);
create unique index if not exists producto_presentaciones_codigo_unico
  on public.producto_presentaciones (empresa_id, codigo_barras) where codigo_barras is not null;

-- Coherencia: la empresa del producto, sin variantes y sin repetir el código de barras de un producto
create or replace function public._validar_presentacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  select empresa_id into v_emp from public.productos where id = new.producto_id;
  if v_emp is null then raise exception 'Producto no encontrado'; end if;
  if tg_op = 'UPDATE' and new.producto_id <> old.producto_id then
    raise exception 'Una presentación no se puede mover a otro producto';
  end if;
  new.empresa_id := v_emp;
  new.nombre := trim(new.nombre);
  new.codigo_barras := nullif(trim(coalesce(new.codigo_barras, '')), '');
  if exists (select 1 from public.producto_variantes v where v.producto_id = new.producto_id and v.activa) then
    raise exception 'Las presentaciones son para productos sin tallas ni colores';
  end if;
  if new.codigo_barras is not null and exists (
    select 1 from public.productos p where p.empresa_id = v_emp and p.codigo_barras = new.codigo_barras
  ) then
    raise exception 'Ese código de barras ya lo tiene otro producto';
  end if;
  return new;
end $$;
revoke execute on function public._validar_presentacion() from public, anon, authenticated;

drop trigger if exists validar_presentacion on public.producto_presentaciones;
create trigger validar_presentacion before insert or update on public.producto_presentaciones
  for each row execute function public._validar_presentacion();

-- Y al revés: un producto no puede tomar el código de barras de una presentación
create or replace function public._codigo_barras_libre()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.codigo_barras is not null and exists (
    select 1 from public.producto_presentaciones x
     where x.empresa_id = new.empresa_id and x.codigo_barras = new.codigo_barras
  ) then
    raise exception 'Ese código de barras ya lo tiene otro producto';
  end if;
  return new;
end $$;
revoke execute on function public._codigo_barras_libre() from public, anon, authenticated;

drop trigger if exists codigo_barras_libre on public.productos;
create trigger codigo_barras_libre before insert or update of codigo_barras on public.productos
  for each row execute function public._codigo_barras_libre();

-- RLS: lee la empresa; escribe quien gestiona productos (igual que producto_variantes)
alter table public.producto_presentaciones enable row level security;
drop policy if exists tenant_select on public.producto_presentaciones;
drop policy if exists tenant_insert on public.producto_presentaciones;
drop policy if exists tenant_update on public.producto_presentaciones;
drop policy if exists tenant_delete on public.producto_presentaciones;
create policy tenant_select on public.producto_presentaciones for select
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner()));
create policy tenant_insert on public.producto_presentaciones for insert
  with check (public.puede_escribir(empresa_id, array['productos.gestionar']));
create policy tenant_update on public.producto_presentaciones for update
  using (public.puede_escribir(empresa_id, array['productos.gestionar']))
  with check (public.puede_escribir(empresa_id, array['productos.gestionar']));
create policy tenant_delete on public.producto_presentaciones for delete
  using (public.puede_escribir(empresa_id, array['productos.gestionar']));
revoke all on public.producto_presentaciones from anon;
grant select, insert, update, delete on public.producto_presentaciones to authenticated;

-- Línea de venta: cuántas unidades base trae cada unidad vendida (1 = unidad suelta)
alter table public.venta_items add column if not exists presentacion_id uuid
  references public.producto_presentaciones(id) on delete set null;
alter table public.venta_items add column if not exists factor integer not null default 1;
do $$ begin
  alter table public.venta_items add constraint venta_items_factor check (factor >= 1);
exception when duplicate_object then null; end $$;

-- Presentación que se vende en una línea (null = unidad suelta). Valida empresa, producto y estado.
create or replace function public._presentacion_venta(p_prod uuid, p_var uuid, p_pres uuid, p_emp uuid)
returns public.producto_presentaciones language plpgsql stable security definer set search_path = public as $$
declare r public.producto_presentaciones;
begin
  if p_pres is null then return null; end if;
  if p_var is not null then raise exception 'Las presentaciones no se combinan con tallas ni colores'; end if;
  select * into r from public.producto_presentaciones
   where id = p_pres and producto_id = p_prod and empresa_id = p_emp and activa and se_vende;
  if not found then raise exception 'Esa presentación ya no está disponible para la venta'; end if;
  return r;
end $$;
revoke execute on function public._presentacion_venta(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Venta: precio de la presentación y stock en unidades
-- ---------------------------------------------------------------------------
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
  v_pres public.producto_presentaciones;
  v_precio int; v_factor int; v_unid int;
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
    perform public._exigir_variante((it->>'producto_id')::uuid, nullif(it->>'variante_id', '')::uuid, p_ubicacion, true);
    v_pres := public._presentacion_venta(v_prod_row.id, nullif(it->>'variante_id', '')::uuid, nullif(it->>'presentacion_id', '')::uuid, v_emp);
    v_bruto := v_bruto + v_cant * coalesce(v_pres.precio_venta, v_prod_row.precio_venta);
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
    v_desc := concat_ws(' · ', v_prod_row.nombre, public._etiqueta_variante(v_var));
    -- Presentación (caja, pack): precio propio; el stock se descuenta en unidades
    v_pres := public._presentacion_venta(v_prod, v_var, nullif(it->>'presentacion_id', '')::uuid, v_emp);
    v_precio := coalesce(v_pres.precio_venta, v_prod_row.precio_venta);
    v_factor := coalesce(v_pres.factor, 1);
    v_unid := v_cant * v_factor;
    if v_pres.id is not null then v_desc := v_desc || ' · ' || v_pres.nombre; end if;

    v_sin := 0;
    if v_prod_row.controla_stock then
      v_stock := public._stock_row(v_prod, v_var, p_ubicacion, v_emp);
      if v_stock.disponible < v_unid then
        if not coalesce(p_permitir_sin_stock, false) then
          raise exception 'Stock insuficiente para %', v_desc;
        end if;
        v_sin := v_unid - v_stock.disponible;
        v_hay_dif := true;
      end if;
      update public.stock set disponible = disponible - (v_unid - v_sin), updated_at = now() where id = v_stock.id;
    end if;

    insert into public.venta_items (
      venta_id, producto_id, variante_id, descripcion, cantidad, precio_unitario, total_linea, sin_stock,
      presentacion_id, factor
    ) values (v_venta.id, v_prod, v_var, v_desc, v_cant, v_precio, v_cant * v_precio, v_sin, v_pres.id, v_factor);

    -- Solo los productos con stock dejan movimiento (historial de existencias y proyección)
    if v_prod_row.controla_stock then
      insert into public.movimientos (
        empresa_id, uuid_local, tipo, producto_id, variante_id,
        ubicacion_origen_id, cantidad, referencia, observaciones, usuario_id, estado_sync
      ) values (
        v_emp, gen_random_uuid(), 'salida', v_prod, v_var,
        p_ubicacion, v_unid, v_venta.folio,
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
-- Devolución: vuelve al stock la cantidad en unidades (2 cajas de 50 = 100 u.)
-- ---------------------------------------------------------------------------
create or replace function public.devolver_venta(p_venta uuid, p_items jsonb, p_motivo text)
returns public.devoluciones language plpgsql volatile security definer set search_path = public as $$
declare
  v_emp uuid := public._contexto(array['ventas.devolver'], 'pos');
  v_venta public.ventas;
  v_it public.venta_items;
  v_dev public.devoluciones;
  v_prod public.productos;
  v_stock public.stock;
  v_cant int;
  v_bruto int;
  v_factor numeric;
  v_linea int;
  v_refund int := 0;
  v_lineas int := 0;
  v_restante int;
  v_motivo text := trim(coalesce(p_motivo, ''));
begin
  if length(v_motivo) < 3 then raise exception 'Indica el motivo de la devolución'; end if;

  select * into v_venta from public.ventas where id = p_venta and empresa_id = v_emp for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if not public.puede_ver_ubicacion(v_venta.ubicacion_id) then raise exception 'Ubicación no autorizada'; end if;
  if v_venta.estado = 'anulada' then raise exception 'La venta % ya está anulada', v_venta.folio; end if;

  -- El reembolso respeta el descuento de la venta (prorrateo sobre el bruto)
  select coalesce(sum(total_linea), 0) into v_bruto from public.venta_items where venta_id = p_venta;
  v_factor := case when v_bruto > 0 then v_venta.total::numeric / v_bruto else 0 end;

  insert into public.devoluciones (empresa_id, venta_id, ubicacion_id, folio, motivo, usuario_id)
  values (v_emp, p_venta, v_venta.ubicacion_id, public._folio('DEV'), v_motivo, auth.uid())
  returning * into v_dev;

  for v_it in select * from public.venta_items where venta_id = p_venta order by id for update loop
    if p_items is null then
      v_cant := v_it.cantidad - v_it.cantidad_devuelta;
    else
      v_cant := coalesce((
        select (e->>'cantidad')::int from jsonb_array_elements(p_items) e
         where (e->>'venta_item_id')::uuid = v_it.id limit 1), 0);
    end if;
    continue when v_cant = 0;
    if v_cant < 0 or v_cant > v_it.cantidad - v_it.cantidad_devuelta then
      raise exception 'Cantidad a devolver inválida para % (quedan %)', v_it.descripcion, v_it.cantidad - v_it.cantidad_devuelta;
    end if;

    update public.venta_items set cantidad_devuelta = cantidad_devuelta + v_cant where id = v_it.id;
    v_linea := round(v_cant * v_it.precio_unitario * v_factor);
    v_refund := v_refund + v_linea;
    v_lineas := v_lineas + 1;
    insert into public.devolucion_items (devolucion_id, venta_item_id, producto_id, variante_id, cantidad, monto)
    values (v_dev.id, v_it.id, v_it.producto_id, v_it.variante_id, v_cant, v_linea);

    -- El producto vuelve al stock de la tienda donde se vendió
    select * into v_prod from public.productos where id = v_it.producto_id;
    if v_prod.controla_stock then
      v_stock := public._stock_row(v_it.producto_id, v_it.variante_id, v_venta.ubicacion_id, v_emp);
      update public.stock set disponible = disponible + v_cant * v_it.factor, updated_at = now() where id = v_stock.id;
      insert into public.movimientos (
        empresa_id, uuid_local, tipo, producto_id, variante_id,
        ubicacion_destino_id, cantidad, referencia, observaciones, usuario_id, estado_sync
      ) values (
        v_emp, gen_random_uuid(), 'entrada', v_it.producto_id, v_it.variante_id,
        v_venta.ubicacion_id, v_cant * v_it.factor, v_dev.folio,
        'Devolución de ' || v_venta.folio || ': ' || v_motivo, auth.uid(), 'sincronizado'
      );
    end if;
  end loop;

  if v_lineas = 0 then raise exception 'No hay productos para devolver'; end if;

  select coalesce(sum(cantidad - cantidad_devuelta), 0) into v_restante from public.venta_items where venta_id = p_venta;
  if v_restante = 0 then
    -- Todo devuelto: se reembolsa exactamente lo que quedaba (sin diferencias de redondeo)
    v_refund := v_venta.total - v_venta.monto_devuelto;
  end if;

  update public.ventas
     set monto_devuelto = monto_devuelto + v_refund,
         estado = case when v_restante = 0 then 'anulada' else 'devuelta_parcial' end
   where id = p_venta;

  update public.devoluciones
     set total = v_refund,
         tipo = case when v_restante = 0 and v_venta.monto_devuelto = 0 then 'anulacion' else 'devolucion' end
   where id = v_dev.id
  returning * into v_dev;

  insert into public.vouchers (empresa_id, numero, tipo, referencia_id, ubicacion_id, usuario_id, detalle)
  values (v_emp, v_dev.folio, 'devolucion', v_dev.id, v_venta.ubicacion_id, auth.uid(),
          jsonb_build_object('venta', v_venta.folio, 'venta_id', v_venta.id, 'total', v_refund,
                             'tipo', v_dev.tipo, 'motivo', v_motivo, 'medio_pago', v_venta.medio_pago));

  return v_dev;
end $$;

-- ---------------------------------------------------------------------------
-- Reporte de ventas: «unidades» cuenta unidades reales
-- ---------------------------------------------------------------------------
create or replace function public.reporte_ventas(p_desde date, p_hasta date, p_tienda uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_dias int;
  v_ant_desde date;
  v_r jsonb;
begin
  if v_emp is null then raise exception 'Usuario sin empresa'; end if;
  if not public.es_activo() then raise exception 'Cuenta inactiva'; end if;
  if not public.tiene_cap('modulos.reportes') then raise exception 'No tienes permiso para ver reportes'; end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then raise exception 'Rango de fechas inválido'; end if;
  v_dias := p_hasta - p_desde + 1;
  if v_dias > 366 then raise exception 'El rango admite como máximo 366 días'; end if;
  if p_tienda is not null and not public.puede_ver_ubicacion(p_tienda) then raise exception 'Ubicación no autorizada'; end if;
  -- Período anterior de igual largo, inmediatamente antes
  v_ant_desde := p_desde - v_dias;

  with
  v as (
    -- Montos netos de devoluciones; las ventas anuladas no cuentan
    select ve.id, ve.ubicacion_id, ve.total - ve.monto_devuelto as total,
           round((ve.total - ve.monto_devuelto) / 1.19) as neto,
           (ve.total - ve.monto_devuelto) - round((ve.total - ve.monto_devuelto) / 1.19) as iva,
           ve.medio_pago,
           (ve.created_at at time zone 'America/Santiago')::date as dia
      from public.ventas ve
     where ve.empresa_id = v_emp and ve.estado <> 'anulada'
       and ve.created_at >= (v_ant_desde::timestamp at time zone 'America/Santiago')
       and ve.created_at < ((p_hasta + 1)::timestamp at time zone 'America/Santiago')
       and public.puede_ver_ubicacion(ve.ubicacion_id)
  ),
  va as (select v.*, v.dia >= p_desde as actual from v),
  vf as (select * from va where p_tienda is null or ubicacion_id = p_tienda),
  it as (
    select vi.producto_id, (vi.cantidad - vi.cantidad_devuelta) * vi.factor as cantidad,
           round(vi.total_linea * (vi.cantidad - vi.cantidad_devuelta)::numeric / vi.cantidad) as total_linea,
           vf.actual, vf.ubicacion_id
      from public.venta_items vi join vf on vf.id = vi.venta_id
  ),
  tiendas as (
    select u.id, u.nombre from public.ubicaciones u
     where u.empresa_id = v_emp and public.puede_ver_ubicacion(u.id)
       and ((u.tipo = 'tienda' and u.activa) or exists (select 1 from va where va.ubicacion_id = u.id))
  ),
  dias as (
    select d::date as dia, extract(isodow from d)::int as dow from generate_series(p_desde, p_hasta, interval '1 day') d
  ),
  dow_n as (select dow, count(*) as n from dias group by dow),
  unid as (
    select ubicacion_id,
           sum((vi.cantidad - vi.cantidad_devuelta) * vi.factor) filter (where actual) as u,
           sum((vi.cantidad - vi.cantidad_devuelta) * vi.factor) filter (where not actual) as u_ant
      from public.venta_items vi join va on va.id = vi.venta_id
     group by ubicacion_id
  ),
  por_tienda as (
    select t.id, t.nombre,
           coalesce(sum(va.total) filter (where va.actual), 0) as monto,
           count(va.id) filter (where va.actual) as tickets,
           coalesce(sum(va.total) filter (where not va.actual), 0) as monto_ant,
           count(va.id) filter (where not va.actual) as tickets_ant
      from tiendas t left join va on va.ubicacion_id = t.id
     group by t.id, t.nombre
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'dias', v_dias,
    'anterior', jsonb_build_object('desde', v_ant_desde, 'hasta', p_desde - 1),
    'totales', (
      select jsonb_build_object(
        'monto', coalesce(sum(total) filter (where actual), 0),
        'neto', coalesce(sum(neto) filter (where actual), 0),
        'iva', coalesce(sum(iva) filter (where actual), 0),
        'tickets', count(*) filter (where actual),
        'monto_ant', coalesce(sum(total) filter (where not actual), 0),
        'tickets_ant', count(*) filter (where not actual),
        'unidades', (select coalesce(sum(cantidad) filter (where actual), 0) from it),
        'unidades_ant', (select coalesce(sum(cantidad) filter (where not actual), 0) from it),
        -- Devuelto (incluye anulaciones) de las ventas del período
        'devuelto', (
          select coalesce(sum(x.monto_devuelto), 0) from public.ventas x
           where x.empresa_id = v_emp and x.monto_devuelto > 0
             and (x.created_at at time zone 'America/Santiago')::date between p_desde and p_hasta
             and public.puede_ver_ubicacion(x.ubicacion_id)
             and (p_tienda is null or x.ubicacion_id = p_tienda))
      ) from vf
    ),
    'tiendas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pt.id, 'nombre', pt.nombre, 'monto', pt.monto, 'tickets', pt.tickets,
               'monto_ant', pt.monto_ant, 'tickets_ant', pt.tickets_ant,
               'unidades', coalesce(un.u, 0), 'unidades_ant', coalesce(un.u_ant, 0))
             order by pt.nombre)
        from por_tienda pt left join unid un on un.ubicacion_id = pt.id
    ), '[]'::jsonb),
    'por_dia', coalesce((
      select jsonb_agg(jsonb_build_object('fecha', x.dia, 'tienda', x.id, 'monto', x.monto) order by x.dia, x.nombre)
        from (
          select d.dia, t.id, t.nombre, coalesce(sum(vf.total), 0) as monto
            from dias d cross join tiendas t
            left join vf on vf.dia = d.dia and vf.ubicacion_id = t.id and vf.actual
           where p_tienda is null or t.id = p_tienda
           group by d.dia, t.id, t.nombre
        ) x
    ), '[]'::jsonb),
    'por_dia_semana', coalesce((
      select jsonb_agg(jsonb_build_object('tienda', x.id, 'dow', x.dow, 'monto_prom', x.prom) order by x.nombre, x.dow)
        from (
          select t.id, t.nombre, dn.dow, round(coalesce(sum(vf.total), 0)::numeric / dn.n) as prom
            from tiendas t cross join dow_n dn
            left join vf on vf.ubicacion_id = t.id and vf.actual and extract(isodow from vf.dia) = dn.dow
           where p_tienda is null or t.id = p_tienda
           group by t.id, t.nombre, dn.dow, dn.n
        ) x
    ), '[]'::jsonb),
    'top_productos', coalesce((
      select jsonb_agg(x order by x.monto desc)
        from (
          select p.id, p.nombre, p.sku, p.foto_url, sum(it.cantidad) as unidades, sum(it.total_linea) as monto
            from it join public.productos p on p.id = it.producto_id
           where it.actual
           group by p.id, p.nombre, p.sku, p.foto_url
           order by sum(it.total_linea) desc
           limit 10
        ) x
    ), '[]'::jsonb),
    'medios', coalesce((
      select jsonb_agg(jsonb_build_object('medio', medio_pago, 'monto', monto, 'tickets', n) order by monto desc)
        from (select medio_pago, sum(total) as monto, count(*) as n from vf where actual group by medio_pago) x
    ), '[]'::jsonb),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('categoria', categoria, 'monto', monto, 'unidades', unidades) order by monto desc)
        from (
          select coalesce(c.nombre, 'Sin categoría') as categoria, sum(it.total_linea) as monto, sum(it.cantidad) as unidades
            from it join public.productos p on p.id = it.producto_id
            left join public.categorias c on c.id = p.categoria_id
           where it.actual
           group by 1
        ) x
    ), '[]'::jsonb)
  ) into v_r;

  return v_r;
end $$;
