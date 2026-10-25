-- ============================================================
-- Mi Socio Pyme · 0023 · Asistente con IA (chat sobre los datos del negocio)
-- - planes_ia: Básico / Pro / Max. Todos tienen las mismas funciones y el mismo modelo
--   (el más económico); solo cambian los topes diarios de mensajes por empresa y por
--   usuario. Los edita solo el administrador general, vía la Edge Function admin-users.
-- - empresas.plan_ia: plan del asistente de cada empresa (null = sin asistente). Solo lo
--   cambia el administrador general (proteger_empresa).
-- - Permiso por usuario 'asistente.usar': por defecto solo administradores; el admin de
--   empresa lo da o lo quita a cada persona.
-- - uso_ia + registrar_uso_ia(): tope de gasto contado en la base, no en memoria. Solo lo
--   usa la Edge Function `asistente` (service_role) antes de llamar a OpenAI.
-- - ventas_por_hora(): ventas promedio por día de la semana y hora, para recomendar horarios.
-- - stock_asistente(): búsqueda de stock con RLS del usuario (security invoker).
-- ============================================================

-- ---------------- Planes ----------------
create table if not exists public.planes_ia (
  plan text primary key check (plan in ('basico', 'pro', 'max')),
  nombre text not null,
  mensajes_dia_empresa integer not null check (mensajes_dia_empresa between 1 and 100000),
  mensajes_dia_usuario integer not null check (mensajes_dia_usuario between 1 and 100000),
  orden integer not null default 0
);

insert into public.planes_ia (plan, nombre, mensajes_dia_empresa, mensajes_dia_usuario, orden) values
  ('basico', 'Básico', 30, 10, 1),
  ('pro', 'Pro', 150, 40, 2),
  ('max', 'Max', 600, 150, 3)
on conflict (plan) do nothing;

alter table public.planes_ia enable row level security;
-- Todos los usuarios activos pueden ver los planes (la app muestra el tope); nadie los
-- escribe desde la app: el administrador general los cambia vía admin-users (service_role).
drop policy if exists planes_ia_select on public.planes_ia;
create policy planes_ia_select on public.planes_ia for select to authenticated
  using (public.es_activo());

alter table public.empresas add column if not exists plan_ia text
  references public.planes_ia(plan) on update cascade;

-- ---------------- proteger_empresa (igual que 0020 + plan_ia) ----------------
create or replace function public.proteger_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare rol text := coalesce(auth.role(), '');
begin
  if rol in ('service_role', '') or public.es_owner() then
    return new;
  end if;
  if new.plan is distinct from old.plan
     or new.prueba_hasta is distinct from old.prueba_hasta
     or new.modulos is distinct from old.modulos
     or new.tipo_negocio is distinct from old.tipo_negocio
     or new.plan_ia is distinct from old.plan_ia then
    raise exception 'Solo el administrador general puede cambiar plan, prueba, rubro, módulos o asistente';
  end if;
  if not public.es_admin_empresa(old.id) then
    raise exception 'No autorizado sobre esta empresa';
  end if;
  return new;
end $$;

-- ---------------- Capacidad asistente.usar ----------------
-- Espejo de Capability en src/core/auth/capabilities.ts
create or replace function public._catalogo_caps()
returns text[] language sql immutable set search_path = public as $$
  select array[
    'modulos.dashboard','modulos.pos','modulos.mesas','modulos.cocina','modulos.salidas',
    'modulos.ingreso','modulos.inventario','modulos.productos','modulos.bodega',
    'modulos.movimientos','modulos.reportes','modulos.usuarios','modulos.configuracion',
    'pos.vender','mesas.atender','cocina.gestionar','salidas.registrar','ingreso.registrar',
    'transferencias.gestionar','inventario.ajustar','productos.gestionar','usuarios.gestionar',
    'config.gestionar','reportes.ver','ventas.devolver','asistente.usar'];
$$;

-- Igual que 0019 + 'asistente.usar' para el puesto admin
create or replace function public._caps_puesto(p_puesto text)
returns text[] language sql immutable set search_path = public as $$
  select case p_puesto
    when 'admin' then array[
      'modulos.dashboard','modulos.pos','modulos.mesas','modulos.cocina','modulos.salidas','modulos.ingreso',
      'modulos.inventario','modulos.productos','modulos.bodega','modulos.movimientos','modulos.reportes',
      'modulos.usuarios','modulos.configuracion',
      'pos.vender','mesas.atender','cocina.gestionar','salidas.registrar','ingreso.registrar',
      'transferencias.gestionar','inventario.ajustar','productos.gestionar','usuarios.gestionar',
      'config.gestionar','reportes.ver','ventas.devolver','asistente.usar']
    when 'bodega' then array[
      'modulos.dashboard','modulos.ingreso','modulos.inventario','modulos.productos',
      'modulos.bodega','modulos.movimientos',
      'ingreso.registrar','transferencias.gestionar','inventario.ajustar','productos.gestionar']
    when 'tienda' then array[
      'modulos.dashboard','modulos.pos','modulos.mesas','modulos.cocina','modulos.salidas',
      'modulos.inventario','modulos.movimientos',
      'pos.vender','mesas.atender','cocina.gestionar','salidas.registrar']
    when 'auditor' then array[
      'modulos.dashboard','modulos.inventario','modulos.movimientos','modulos.reportes',
      'reportes.ver']
    else array[]::text[]
  end;
$$;

revoke execute on function public._catalogo_caps() from public, anon, authenticated;

-- ---------------- Uso diario ----------------
create table if not exists public.uso_ia (
  user_id uuid not null references public.profiles(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  dia date not null default public.hoy_negocio(),
  mensajes integer not null default 0 check (mensajes >= 0),
  primary key (user_id, dia)
);
create index if not exists idx_uso_ia_empresa_dia on public.uso_ia (empresa_id, dia);

-- Sin políticas: la app no la lee directo (usa mi_uso_ia / uso_ia_empresas)
alter table public.uso_ia enable row level security;

-- Estado del asistente para una persona, sin sumar uso (lo comparten las dos funciones)
create or replace function public._estado_ia(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles;
  e public.empresas;
  pl public.planes_ia;
  v_hoy date := public.hoy_negocio();
  v_nu int;
  v_ne int;
  v_motivo text;
begin
  select * into p from public.profiles where id = p_user;
  if not found or not p.activo then
    return jsonb_build_object('permitido', false, 'motivo', 'Tu cuenta está inactiva.');
  end if;
  if p.empresa_id is null then
    return jsonb_build_object('permitido', false, 'motivo', 'Tu cuenta no pertenece a una empresa.');
  end if;
  select * into e from public.empresas where id = p.empresa_id;
  if e.plan_ia is null then
    return jsonb_build_object('permitido', false,
      'motivo', 'Tu empresa no tiene el asistente activado. Pídelo al administrador del sistema.');
  end if;
  select * into pl from public.planes_ia where plan = e.plan_ia;
  select coalesce(sum(mensajes), 0) into v_ne from public.uso_ia where empresa_id = e.id and dia = v_hoy;
  select coalesce(sum(mensajes), 0) into v_nu from public.uso_ia where user_id = p_user and dia = v_hoy;

  if not p.es_owner and e.plan = 'prueba' and e.prueba_hasta is not null and e.prueba_hasta < now() then
    v_motivo := 'Tu período de prueba terminó. Contáctanos para activar tu suscripción.';
  elsif not public._evaluar_cap(p.es_owner, p.role, p.puesto, p.permissions, e.modulos, 'asistente.usar') then
    v_motivo := 'No tienes permiso para usar el asistente. Pídelo al administrador de tu empresa.';
  elsif not p.es_owner and v_nu >= pl.mensajes_dia_usuario then
    v_motivo := format('Usaste tus %s mensajes de hoy. Mañana se renuevan.', pl.mensajes_dia_usuario);
  elsif not p.es_owner and v_ne >= pl.mensajes_dia_empresa then
    v_motivo := format('Tu empresa usó los %s mensajes de hoy del plan %s. Mañana se renuevan.',
                       pl.mensajes_dia_empresa, pl.nombre);
  end if;

  return jsonb_build_object(
    'permitido', v_motivo is null,
    'motivo', v_motivo,
    'empresa_id', e.id,
    'plan', pl.plan,
    'plan_nombre', pl.nombre,
    'usados_usuario', v_nu,
    'tope_usuario', pl.mensajes_dia_usuario,
    'usados_empresa', v_ne,
    'tope_empresa', pl.mensajes_dia_empresa);
end $$;

/** Suma un mensaje de hoy si la persona puede usar el asistente. Lo llama la Edge Function. */
create or replace function public.registrar_uso_ia(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := (select empresa_id from public.profiles where id = p_user);
  v_hoy date := public.hoy_negocio();
  r jsonb;
begin
  -- Dos mensajes simultáneos de la misma empresa no se saltan el tope
  if v_emp is not null then
    perform pg_advisory_xact_lock(hashtext('uso_ia:' || v_emp::text));
  end if;
  r := public._estado_ia(p_user);
  if not (r ->> 'permitido')::boolean then return r; end if;
  insert into public.uso_ia (user_id, empresa_id, dia, mensajes)
  values (p_user, v_emp, v_hoy, 1)
  on conflict (user_id, dia) do update set mensajes = public.uso_ia.mensajes + 1;
  return r || jsonb_build_object(
    'usados_usuario', (r ->> 'usados_usuario')::int + 1,
    'usados_empresa', (r ->> 'usados_empresa')::int + 1);
end $$;

/** Devuelve el mensaje si OpenAI falló: un error nuestro no gasta el cupo. */
create or replace function public.devolver_uso_ia(p_user uuid)
returns void language sql security definer set search_path = public as $$
  update public.uso_ia set mensajes = greatest(mensajes - 1, 0)
   where user_id = p_user and dia = public.hoy_negocio();
$$;

/** Para la app: plan, topes y uso de hoy de quien consulta. */
create or replace function public.mi_uso_ia()
returns jsonb language sql stable security definer set search_path = public as $$
  select public._estado_ia(auth.uid()) - 'empresa_id';
$$;

/** Para el administrador general: uso por empresa hoy y en el mes. */
create or replace function public.uso_ia_empresas()
returns table (empresa_id uuid, nombre text, plan_ia text, hoy bigint, mes bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_owner() then raise exception 'No autorizado'; end if;
  return query
    select e.id, e.nombre, e.plan_ia,
           coalesce(sum(u.mensajes) filter (where u.dia = public.hoy_negocio()), 0)::bigint,
           coalesce(sum(u.mensajes) filter (where u.dia >= date_trunc('month', public.hoy_negocio())::date), 0)::bigint
      from public.empresas e
      left join public.uso_ia u on u.empresa_id = e.id
     group by e.id, e.nombre, e.plan_ia
     order by 5 desc, e.nombre;
end $$;

revoke execute on function public._estado_ia(uuid) from public, anon, authenticated;
revoke execute on function public.registrar_uso_ia(uuid) from public, anon, authenticated;
revoke execute on function public.devolver_uso_ia(uuid) from public, anon, authenticated;
grant execute on function public.registrar_uso_ia(uuid) to service_role;
grant execute on function public.devolver_uso_ia(uuid) to service_role;
revoke execute on function public.mi_uso_ia() from public, anon;
grant execute on function public.mi_uso_ia() to authenticated;
revoke execute on function public.uso_ia_empresas() from public, anon;
grant execute on function public.uso_ia_empresas() to authenticated;

-- ---------------- Ventas por hora (horarios) ----------------
-- Promedio por día de la semana (1 = lunes) y hora, dividiendo por las veces que ese día
-- aparece en el rango. Mismas reglas que reporte_ventas: neto de devoluciones, sin anuladas.
create or replace function public.ventas_por_hora(p_desde date, p_hasta date, p_tienda uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_r jsonb;
begin
  if v_emp is null then raise exception 'Usuario sin empresa'; end if;
  if not public.es_activo() then raise exception 'Cuenta inactiva'; end if;
  if not public.tiene_cap('modulos.reportes') then raise exception 'No tienes permiso para ver reportes'; end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then raise exception 'Rango de fechas inválido'; end if;
  if p_hasta - p_desde + 1 > 366 then raise exception 'El rango admite como máximo 366 días'; end if;
  if p_tienda is not null and not public.puede_ver_ubicacion(p_tienda) then raise exception 'Ubicación no autorizada'; end if;

  with
  dias as (
    select extract(isodow from d)::int as dow, count(*) as n
      from generate_series(p_desde, p_hasta, interval '1 day') d group by 1
  ),
  v as (
    select extract(isodow from (ve.created_at at time zone 'America/Santiago'))::int as dow,
           extract(hour from (ve.created_at at time zone 'America/Santiago'))::int as hora,
           ve.total - ve.monto_devuelto as total
      from public.ventas ve
     where ve.empresa_id = v_emp and ve.estado <> 'anulada'
       and ve.created_at >= (p_desde::timestamp at time zone 'America/Santiago')
       and ve.created_at < ((p_hasta + 1)::timestamp at time zone 'America/Santiago')
       and public.puede_ver_ubicacion(ve.ubicacion_id)
       and (p_tienda is null or ve.ubicacion_id = p_tienda)
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'tickets_total', (select count(*) from v),
    'por_hora', coalesce((
      select jsonb_agg(jsonb_build_object(
               'dow', x.dow, 'hora', x.hora,
               'tickets_prom', round(x.tickets::numeric / d.n, 1),
               'monto_prom', round(x.monto::numeric / d.n))
             order by x.dow, x.hora)
        from (select dow, hora, count(*) as tickets, sum(total) as monto from v group by dow, hora) x
        join dias d on d.dow = x.dow
    ), '[]'::jsonb)
  ) into v_r;
  return v_r;
end $$;

revoke execute on function public.ventas_por_hora(date, date, uuid) from public, anon;
grant execute on function public.ventas_por_hora(date, date, uuid) to authenticated, service_role;

-- ---------------- Stock para el asistente ----------------
-- security invoker: corre con RLS de quien pregunta (solo su empresa y sus ubicaciones)
create or replace function public.stock_asistente(p_texto text default null, p_solo_bajo boolean default false)
returns table (producto text, sku text, variante text, ubicacion text, tipo text,
               disponible integer, transito integer, stock_minimo integer, precio integer)
language sql stable security invoker set search_path = public as $$
  select p.nombre, p.sku, nullif(concat_ws(' · ', v.talla, v.color, v.modelo), ''), u.nombre, u.tipo,
         s.disponible, s.transito, p.stock_minimo, p.precio_venta
    from public.stock s
    join public.productos p on p.id = s.producto_id and p.activo and p.controla_stock
    left join public.producto_variantes v on v.id = s.variante_id
    join public.ubicaciones u on u.id = s.ubicacion_id and u.activa
   where (p_texto is null or btrim(p_texto) = ''
          or p.nombre ilike '%' || btrim(p_texto) || '%'
          or p.sku ilike '%' || btrim(p_texto) || '%')
     and (not coalesce(p_solo_bajo, false) or s.disponible <= p.stock_minimo)
   order by (s.disponible <= p.stock_minimo) desc, p.nombre, u.nombre
   limit 80;
$$;

revoke execute on function public.stock_asistente(text, boolean) from public, anon;
grant execute on function public.stock_asistente(text, boolean) to authenticated;

-- ---------------- Análisis de productos (rentabilidad y rotación) ----------------
-- Para que el asistente opine como experto: margen estimado (precio de venta vs costo de
-- referencia), rotación, productos sin movimiento y sobrestock. Montos de venta netos de
-- devoluciones, sin anuladas. Requiere Reportes (muestra costos y márgenes).
create or replace function public.analisis_productos(p_dias integer default 30, p_tienda uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_dias int := least(greatest(coalesce(p_dias, 30), 7), 365);
  v_desde timestamptz := ((public.hoy_negocio() - v_dias + 1)::timestamp at time zone 'America/Santiago');
  v_r jsonb;
begin
  if v_emp is null then raise exception 'Usuario sin empresa'; end if;
  if not public.es_activo() then raise exception 'Cuenta inactiva'; end if;
  if not public.tiene_cap('modulos.reportes') then raise exception 'No tienes permiso para ver reportes'; end if;
  if p_tienda is not null and not public.puede_ver_ubicacion(p_tienda) then raise exception 'Ubicación no autorizada'; end if;

  with
  vend as (
    select vi.producto_id,
           sum(vi.cantidad - vi.cantidad_devuelta) as unidades,
           sum(round(vi.total_linea * (vi.cantidad - vi.cantidad_devuelta)::numeric / vi.cantidad)) as monto,
           max(ve.created_at) as ultima
      from public.venta_items vi
      join public.ventas ve on ve.id = vi.venta_id
     where ve.empresa_id = v_emp and ve.estado <> 'anulada' and ve.created_at >= v_desde
       and public.puede_ver_ubicacion(ve.ubicacion_id)
       and (p_tienda is null or ve.ubicacion_id = p_tienda)
     group by vi.producto_id
  ),
  stk as (
    select s.producto_id, sum(s.disponible) as disponible
      from public.stock s
     where s.empresa_id = v_emp and public.puede_ver_ubicacion(s.ubicacion_id)
       and (p_tienda is null or s.ubicacion_id = p_tienda)
     group by s.producto_id
  ),
  ultima_hist as (
    select vi.producto_id, max(ve.created_at) as ultima
      from public.venta_items vi join public.ventas ve on ve.id = vi.venta_id
     where ve.empresa_id = v_emp and ve.estado <> 'anulada' and public.puede_ver_ubicacion(ve.ubicacion_id)
     group by vi.producto_id
  ),
  base as (
    select p.nombre, p.sku, coalesce(c.nombre, 'Sin categoría') as categoria, p.controla_stock,
           p.precio_venta as precio, nullif(p.costo_referencia, 0) as costo,
           case when p.costo_referencia > 0 and p.precio_venta > 0
                then round(100 * (round(p.precio_venta / 1.19) - p.costo_referencia)::numeric / round(p.precio_venta / 1.19), 1) end as margen_pct,
           coalesce(v.unidades, 0) as unidades, coalesce(v.monto, 0) as monto,
           -- Ganancia bruta estimada del período (neto sin IVA menos costo)
           case when p.costo_referencia > 0 then round(coalesce(v.monto, 0) / 1.19) - coalesce(v.unidades, 0) * p.costo_referencia end as ganancia,
           coalesce(s.disponible, 0) as stock,
           case when coalesce(v.unidades, 0) > 0 then round(coalesce(s.disponible, 0) / (v.unidades::numeric / v_dias)) end as dias_cobertura,
           (coalesce(uh.ultima, null) at time zone 'America/Santiago')::date as ultima_venta,
           coalesce(s.disponible, 0) * coalesce(nullif(p.costo_referencia, 0), round(p.precio_venta / 1.19)) as valor_stock
      from public.productos p
      left join public.categorias c on c.id = p.categoria_id
      left join vend v on v.producto_id = p.id
      left join stk s on s.producto_id = p.id
      left join ultima_hist uh on uh.producto_id = p.id
     where p.empresa_id = v_emp and p.activo
  ),
  tickets as (
    select count(*) as n, coalesce(sum(ve.total - ve.monto_devuelto), 0) as monto
      from public.ventas ve
     where ve.empresa_id = v_emp and ve.estado <> 'anulada' and ve.created_at >= v_desde
       and public.puede_ver_ubicacion(ve.ubicacion_id) and (p_tienda is null or ve.ubicacion_id = p_tienda)
  )
  select jsonb_build_object(
    'dias', v_dias,
    'resumen', (select jsonb_build_object(
        'productos_activos', (select count(*) from base),
        'productos_con_venta', (select count(*) from base where unidades > 0),
        'tickets', t.n,
        'venta_total', t.monto,
        'ticket_promedio', case when t.n > 0 then round(t.monto::numeric / t.n) end,
        'ganancia_bruta_estimada', (select sum(ganancia) from base),
        'productos_sin_costo', (select count(*) from base where costo is null),
        'valor_inventario', (select sum(valor_stock) from base where controla_stock)
      ) from tickets t),
    'mas_ganancia', coalesce((select jsonb_agg(to_jsonb(x) - 'controla_stock' - 'valor_stock') from (
        select * from base where ganancia is not null and unidades > 0 order by ganancia desc limit 10) x), '[]'::jsonb),
    'margen_bajo', coalesce((select jsonb_agg(to_jsonb(x) - 'controla_stock' - 'valor_stock') from (
        select * from base where margen_pct is not null and margen_pct < 25 order by margen_pct limit 10) x), '[]'::jsonb),
    'sin_movimiento', coalesce((select jsonb_agg(to_jsonb(x) - 'controla_stock') from (
        select * from base where controla_stock and stock > 0 and unidades = 0 order by valor_stock desc limit 15) x), '[]'::jsonb),
    'sobrestock', coalesce((select jsonb_agg(to_jsonb(x) - 'controla_stock') from (
        select * from base where controla_stock and dias_cobertura > 90 order by valor_stock desc limit 10) x), '[]'::jsonb),
    'mas_vendidos', coalesce((select jsonb_agg(to_jsonb(x) - 'controla_stock' - 'valor_stock') from (
        select * from base where unidades > 0 order by monto desc limit 10) x), '[]'::jsonb)
  ) into v_r;
  return v_r;
end $$;

revoke execute on function public.analisis_productos(integer, uuid) from public, anon;
grant execute on function public.analisis_productos(integer, uuid) to authenticated, service_role;
