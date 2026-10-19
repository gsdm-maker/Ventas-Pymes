-- ============================================================
-- Mi Socio Pyme · 0011 · Alertas de quiebre y proyección de reposición
-- - proyeccion_reposicion(): por producto y tienda, demanda esperada día a día
--   (promedio por día de la semana, ponderando más las semanas recientes),
--   fecha estimada de quiebre, stock objetivo y sugerencia de reposición
--   (transferir desde bodega o comprar la diferencia).
-- - Temporada: si hay más de un año de historia, factor del mismo período del
--   año anterior; además un ajuste manual (%) configurable por empresa.
-- - simular_historia() / borrar_historia_simulada(): ventas ficticias para demo.
-- Zona horaria de negocio: America/Santiago.
-- ============================================================

alter table public.movimientos add column if not exists simulado boolean not null default false;

-- semanas: historia usada · seguridad_pct: colchón sobre la demanda · ajuste_pct: temporada manual
alter table public.empresas
  add column if not exists reposicion jsonb not null
  default '{"semanas": 8, "seguridad_pct": 20, "ajuste_pct": 0}'::jsonb;

create index if not exists idx_movimientos_salidas
  on public.movimientos (empresa_id, ubicacion_origen_id, producto_id, created_at)
  where tipo = 'salida';

create or replace function public.hoy_negocio()
returns date language sql stable as $$
  select (now() at time zone 'America/Santiago')::date;
$$;

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
      join public.productos p on p.id = s.producto_id and p.activo
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

-- ---------------------------------------------------------------------------
-- Historia simulada (demo): salidas ficticias en las tiendas, sin tocar el stock
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

  delete from public.movimientos where empresa_id = v_emp and simulado;

  with tasas as (
    -- Tasa base diaria por producto y tienda: los productos baratos rotan más
    select s.producto_id, s.variante_id, s.ubicacion_id,
           (0.3 + random() * 1.4) * case when p.precio_venta < 15000 then 1.6
                                         when p.precio_venta < 40000 then 1.0 else 0.5 end as tasa
      from public.stock s
      join public.ubicaciones u on u.id = s.ubicacion_id and u.tipo = 'tienda' and u.activa
      join public.productos p on p.id = s.producto_id and p.activo
     where s.empresa_id = v_emp
  ),
  dias as (
    select d::date as dia, extract(isodow from d)::int as dow,
           (v_hoy - d::date - 1) / 7 as semanas_atras
      from generate_series(v_hoy - 7 * p_semanas, v_hoy - 1, interval '1 day') d
  ),
  ventas as (
    -- floor(x + U) tiene esperanza x; leve crecimiento hacia las semanas recientes
    select t.producto_id, t.variante_id, t.ubicacion_id, d.dia,
           floor(t.tasa * v_mult[d.dow] * (1 + 0.015 * (p_semanas - d.semanas_atras)) + random())::int as cant
      from tasas t cross join dias d
  )
  insert into public.movimientos (
    empresa_id, uuid_local, tipo, producto_id, variante_id, ubicacion_origen_id, cantidad,
    referencia, observaciones, usuario_id, estado_sync, simulado, created_at
  )
  select v_emp, gen_random_uuid(), 'salida', v.producto_id, v.variante_id, v.ubicacion_id, v.cant,
         'SIMULADO', 'Venta simulada para proyección', auth.uid(), 'sincronizado', true,
         ((v.dia + time '10:00') + random() * interval '10 hours') at time zone 'America/Santiago'
    from ventas v
   where v.cant > 0;

  get diagnostics v_n = row_count;
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
  delete from public.movimientos where empresa_id = v_emp and simulado;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------- Privilegios ----------------------------------------------
revoke execute on function public.hoy_negocio() from public, anon;
revoke execute on function public.proyeccion_reposicion(date) from public, anon;
revoke execute on function public.simular_historia(integer) from public, anon;
revoke execute on function public.borrar_historia_simulada() from public, anon;
grant execute on function public.hoy_negocio() to authenticated, service_role;
grant execute on function public.proyeccion_reposicion(date) to authenticated, service_role;
grant execute on function public.simular_historia(integer) to authenticated, service_role;
grant execute on function public.borrar_historia_simulada() to authenticated, service_role;
