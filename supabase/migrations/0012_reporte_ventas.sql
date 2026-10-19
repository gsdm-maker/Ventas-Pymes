-- ============================================================
-- Mi Socio Pyme · 0012 · Reporte de ventas por tienda
-- - reporte_ventas(desde, hasta, tienda?): totales vs período anterior, ranking
--   de tiendas, venta diaria por tienda, promedio por día de la semana, top
--   productos, medios de pago y categorías. Días en hora de Chile.
-- - La historia simulada ahora crea ventas completas (ventas + venta_items +
--   movimientos), igual que el POS, para que reportes y proyección coincidan.
-- ============================================================

alter table public.ventas add column if not exists simulado boolean not null default false;

create index if not exists idx_ventas_empresa_ubicacion_fecha
  on public.ventas (empresa_id, ubicacion_id, created_at);

-- ---------------------------------------------------------------------------
-- Historia simulada: tickets de ~2 productos, más ventas viernes a domingo
-- ---------------------------------------------------------------------------
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
    select s.producto_id, s.variante_id, s.ubicacion_id, p.precio_venta, p.nombre,
           (0.3 + random() * 1.4) * case when p.precio_venta < 15000 then 1.6
                                         when p.precio_venta < 40000 then 1.0 else 0.5 end as tasa
      from public.stock s
      join public.ubicaciones u on u.id = s.ubicacion_id and u.tipo = 'tienda' and u.activa
      join public.productos p on p.id = s.producto_id and p.activo
     where s.empresa_id = v_emp
  ),
  dias as (
    select d::date as dia, extract(isodow from d)::int as dow, (v_hoy - d::date - 1) / 7 as semanas_atras
      from generate_series(v_hoy - 7 * p_semanas, v_hoy - 1, interval '1 day') d
  ),
  lineas as (
    -- floor(x + U) tiene esperanza x; leve crecimiento hacia las semanas recientes
    select t.producto_id, t.variante_id, t.ubicacion_id, t.precio_venta, t.nombre, d.dia,
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
    join _sim_tickets t on t.ubicacion_id = l.ubicacion_id and t.dia = l.dia and t.ticket = l.ticket;

  return v_n;
end $$;

create or replace function public.borrar_historia_simulada()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_n int;
begin
  if v_emp is null or not public.es_admin_empresa(v_emp) or not public.tiene_cap('config.gestionar') then
    raise exception 'Solo un administrador de la empresa puede borrar la historia simulada';
  end if;
  delete from public.ventas where empresa_id = v_emp and simulado;  -- venta_items en cascada
  get diagnostics v_n = row_count;
  delete from public.movimientos where empresa_id = v_emp and simulado;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Reporte de ventas
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
    select ve.id, ve.ubicacion_id, ve.total, ve.neto, ve.iva, ve.medio_pago,
           (ve.created_at at time zone 'America/Santiago')::date as dia
      from public.ventas ve
     where ve.empresa_id = v_emp
       and ve.created_at >= (v_ant_desde::timestamp at time zone 'America/Santiago')
       and ve.created_at < ((p_hasta + 1)::timestamp at time zone 'America/Santiago')
       and public.puede_ver_ubicacion(ve.ubicacion_id)
  ),
  va as (select v.*, v.dia >= p_desde as actual from v),
  vf as (select * from va where p_tienda is null or ubicacion_id = p_tienda),
  it as (
    select vi.producto_id, vi.cantidad, vi.total_linea, vf.actual, vf.ubicacion_id
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
           sum(cantidad) filter (where actual) as u, sum(cantidad) filter (where not actual) as u_ant
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
        'unidades_ant', (select coalesce(sum(cantidad) filter (where not actual), 0) from it)
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

revoke execute on function public.reporte_ventas(date, date, uuid) from public, anon;
grant execute on function public.reporte_ventas(date, date, uuid) to authenticated, service_role;
