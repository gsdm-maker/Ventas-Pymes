-- ============================================================
-- Mi Socio Pyme · 0019 · Restaurante: mesas, cuentas abiertas, comandas a cocina y propina
-- - Módulos nuevos: 'mesas' (salón y cobro de cuentas) y 'cocina' (pantalla de comandas).
-- - Una cuenta abierta por mesa; los pedidos se envían a cocina como comandas numeradas
--   por día y tienda. Al cobrar se genera una venta normal (registrar_venta) y la propina
--   queda aparte del total (no lleva IVA), asociada al garzón que abrió la mesa.
-- - Capacidades: mesas.atender (garzón) y cocina.gestionar (cocina/barra).
-- ============================================================

-- ---------------- Tablas ----------------
create table if not exists public.mesas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ubicacion_id uuid not null references public.ubicaciones(id) on delete cascade,
  nombre text not null check (length(trim(nombre)) between 1 and 40),
  zona text check (zona is null or length(zona) <= 40),
  capacidad integer not null default 4 check (capacidad between 1 and 50),
  orden integer not null default 0,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists mesas_nombre_uq on public.mesas (ubicacion_id, lower(trim(nombre))) where activa;
create index if not exists mesas_ubicacion_idx on public.mesas (empresa_id, ubicacion_id);

create table if not exists public.cuentas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ubicacion_id uuid not null references public.ubicaciones(id) on delete restrict,
  mesa_id uuid not null references public.mesas(id) on delete restrict,
  estado text not null default 'abierta' check (estado in ('abierta', 'cobrada', 'anulada')),
  comensales integer check (comensales is null or comensales between 1 and 99),
  garzon_id uuid not null references public.profiles(id) on delete restrict,
  venta_id uuid references public.ventas(id) on delete set null,
  motivo_anulacion text,
  abierta_at timestamptz not null default now(),
  cerrada_at timestamptz
);
-- Una sola cuenta abierta por mesa
create unique index if not exists cuentas_abierta_uq on public.cuentas (mesa_id) where estado = 'abierta';
create index if not exists cuentas_ubicacion_idx on public.cuentas (empresa_id, ubicacion_id, estado);

create table if not exists public.comandas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ubicacion_id uuid not null references public.ubicaciones(id) on delete restrict,
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  fecha date not null,
  numero integer not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'preparando', 'lista', 'entregada', 'anulada')),
  usuario_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  actualizada_at timestamptz not null default now(),
  unique (ubicacion_id, fecha, numero)
);
create index if not exists comandas_cocina_idx on public.comandas (empresa_id, ubicacion_id, estado, created_at);

create table if not exists public.cuenta_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  comanda_id uuid not null references public.comandas(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete restrict,
  variante_id uuid references public.producto_variantes(id) on delete restrict,
  descripcion text not null,
  cantidad integer not null check (cantidad between 1 and 999),
  precio_unitario integer not null check (precio_unitario >= 0),
  nota text check (nota is null or length(nota) <= 140),
  anulado boolean not null default false,
  motivo_anulacion text,
  anulado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cuenta_items_cuenta_idx on public.cuenta_items (cuenta_id);
create index if not exists cuenta_items_comanda_idx on public.cuenta_items (comanda_id);

-- Venta generada desde una cuenta: propina (fuera del total, sin IVA) y garzón
alter table public.ventas add column if not exists propina integer not null default 0;
alter table public.ventas drop constraint if exists ventas_propina_check;
alter table public.ventas add constraint ventas_propina_check check (propina >= 0);
alter table public.ventas add column if not exists cuenta_id uuid references public.cuentas(id) on delete set null;
alter table public.ventas add column if not exists garzon_id uuid references public.profiles(id) on delete set null;

-- ---------------- RLS ----------------
alter table public.mesas enable row level security;
alter table public.cuentas enable row level security;
alter table public.comandas enable row level security;
alter table public.cuenta_items enable row level security;

drop policy if exists tenant_select on public.mesas;
drop policy if exists tenant_insert on public.mesas;
drop policy if exists tenant_update on public.mesas;
drop policy if exists tenant_delete on public.mesas;
create policy tenant_select on public.mesas for select
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and public.puede_ver_ubicacion(ubicacion_id));
-- Las mesas se configuran directo (sin RPC); el resto solo por funciones
create policy tenant_insert on public.mesas for insert
  with check (public.puede_escribir(empresa_id, array['config.gestionar']) and public.puede_ver_ubicacion(ubicacion_id));
create policy tenant_update on public.mesas for update
  using (public.puede_escribir(empresa_id, array['config.gestionar']))
  with check (public.puede_escribir(empresa_id, array['config.gestionar']) and public.puede_ver_ubicacion(ubicacion_id));

drop policy if exists tenant_select on public.cuentas;
create policy tenant_select on public.cuentas for select
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and public.puede_ver_ubicacion(ubicacion_id));
drop policy if exists tenant_select on public.comandas;
create policy tenant_select on public.comandas for select
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and public.puede_ver_ubicacion(ubicacion_id));
drop policy if exists tenant_select on public.cuenta_items;
create policy tenant_select on public.cuenta_items for select
  using (exists (select 1 from public.cuentas c where c.id = cuenta_id));

-- ---------------- Capacidades por puesto ----------------
-- Espejo de src/core/auth/capabilities.ts (defaults por puesto)
create or replace function public._caps_puesto(p_puesto text)
returns text[] language sql immutable set search_path = public as $$
  select case p_puesto
    when 'admin' then array[
      'modulos.dashboard','modulos.pos','modulos.mesas','modulos.cocina','modulos.salidas','modulos.ingreso',
      'modulos.inventario','modulos.productos','modulos.bodega','modulos.movimientos','modulos.reportes',
      'modulos.usuarios','modulos.configuracion',
      'pos.vender','mesas.atender','cocina.gestionar','salidas.registrar','ingreso.registrar',
      'transferencias.gestionar','inventario.ajustar','productos.gestionar','usuarios.gestionar',
      'config.gestionar','reportes.ver','ventas.devolver']
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

-- ---------------- Helpers ----------------
-- Cuenta abierta de la empresa, bloqueada para actualizar
create or replace function public._cuenta_abierta(p_cuenta uuid, p_emp uuid)
returns public.cuentas language plpgsql security definer set search_path = public as $$
declare r public.cuentas;
begin
  select * into r from public.cuentas where id = p_cuenta and empresa_id = p_emp for update;
  if not found then raise exception 'Cuenta no encontrada'; end if;
  if not public.puede_ver_ubicacion(r.ubicacion_id) then raise exception 'Ubicación no autorizada'; end if;
  if r.estado <> 'abierta' then raise exception 'La cuenta ya está cerrada'; end if;
  return r;
end $$;
revoke execute on function public._cuenta_abierta(uuid, uuid) from public, anon, authenticated;

-- ---------------- Enviar comanda (abre la cuenta si la mesa está libre) ----------------
create or replace function public.enviar_comanda(p_mesa uuid, p_items jsonb, p_comensales integer default null)
returns public.comandas language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public._contexto(array['mesas.atender'], 'mesas');
  v_mesa public.mesas;
  v_cuenta public.cuentas;
  v_com public.comandas;
  v_prod public.productos;
  v_hoy date := public.hoy_negocio();
  it jsonb;
  v_var uuid; v_cant int; v_nota text;
begin
  select * into v_mesa from public.mesas where id = p_mesa and empresa_id = v_emp and activa;
  if not found then raise exception 'Mesa no encontrada'; end if;
  if not public.puede_ver_ubicacion(v_mesa.ubicacion_id) then raise exception 'Ubicación no autorizada'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La comanda no tiene productos';
  end if;

  perform pg_advisory_xact_lock(hashtext('mesa:' || p_mesa::text));
  select * into v_cuenta from public.cuentas where mesa_id = p_mesa and estado = 'abierta' for update;
  if not found then
    insert into public.cuentas (empresa_id, ubicacion_id, mesa_id, comensales, garzon_id)
    values (v_emp, v_mesa.ubicacion_id, p_mesa, p_comensales, auth.uid())
    returning * into v_cuenta;
  elsif p_comensales is not null then
    update public.cuentas set comensales = p_comensales where id = v_cuenta.id returning * into v_cuenta;
  end if;

  -- Número correlativo por tienda y día
  perform pg_advisory_xact_lock(hashtext('comanda:' || v_mesa.ubicacion_id::text || v_hoy::text));
  insert into public.comandas (empresa_id, ubicacion_id, cuenta_id, fecha, numero, usuario_id)
  values (
    v_emp, v_mesa.ubicacion_id, v_cuenta.id, v_hoy,
    coalesce((select max(numero) from public.comandas where ubicacion_id = v_mesa.ubicacion_id and fecha = v_hoy), 0) + 1,
    auth.uid()
  ) returning * into v_com;

  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := (it->>'cantidad')::int;
    if v_cant is null or v_cant <= 0 or v_cant > 999 then raise exception 'Cantidad inválida'; end if;
    v_var := nullif(it->>'variante_id', '')::uuid;
    v_prod := public._producto((it->>'producto_id')::uuid, v_var, v_emp);
    perform public._exigir_variante(v_prod.id, v_var, v_mesa.ubicacion_id, true);
    v_nota := nullif(left(trim(coalesce(it->>'nota', '')), 140), '');
    insert into public.cuenta_items (
      empresa_id, cuenta_id, comanda_id, producto_id, variante_id, descripcion, cantidad, precio_unitario, nota
    ) values (
      v_emp, v_cuenta.id, v_com.id, v_prod.id, v_var,
      concat_ws(' · ', v_prod.nombre, public._etiqueta_variante(v_var)), v_cant, v_prod.precio_venta, v_nota
    );
  end loop;

  return v_com;
end $$;

-- ---------------- Estado de una comanda ----------------
-- Cocina: pendiente → preparando → lista. Garzón o cocina: entregada. Se puede volver atrás.
create or replace function public.cambiar_estado_comanda(p_comanda uuid, p_estado text)
returns public.comandas language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_com public.comandas;
begin
  if p_estado not in ('pendiente', 'preparando', 'lista', 'entregada') then raise exception 'Estado inválido'; end if;
  if p_estado = 'entregada' then
    v_emp := public._contexto(array['mesas.atender', 'cocina.gestionar'], 'mesas');
  else
    v_emp := public._contexto(array['cocina.gestionar'], 'cocina');
  end if;
  select * into v_com from public.comandas where id = p_comanda and empresa_id = v_emp for update;
  if not found then raise exception 'Comanda no encontrada'; end if;
  if not public.puede_ver_ubicacion(v_com.ubicacion_id) then raise exception 'Ubicación no autorizada'; end if;
  if v_com.estado = 'anulada' then raise exception 'La comanda está anulada'; end if;
  if not exists (select 1 from public.cuentas c where c.id = v_com.cuenta_id and c.estado = 'abierta') then
    raise exception 'La cuenta de esta comanda ya está cerrada';
  end if;
  update public.comandas set estado = p_estado, actualizada_at = now() where id = p_comanda returning * into v_com;
  return v_com;
end $$;

-- ---------------- Anular un ítem de la cuenta ----------------
-- Si cocina ya empezó a prepararlo, el motivo es obligatorio.
create or replace function public.anular_item_cuenta(p_item uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public._contexto(array['mesas.atender'], 'mesas');
  v_item public.cuenta_items;
  v_com public.comandas;
begin
  select * into v_item from public.cuenta_items where id = p_item and empresa_id = v_emp for update;
  if not found then raise exception 'Ítem no encontrado'; end if;
  perform public._cuenta_abierta(v_item.cuenta_id, v_emp);
  if v_item.anulado then return; end if;
  select * into v_com from public.comandas where id = v_item.comanda_id;
  if v_com.estado <> 'pendiente' and nullif(trim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Indica el motivo: cocina ya empezó a preparar este pedido';
  end if;
  update public.cuenta_items
     set anulado = true, motivo_anulacion = nullif(trim(coalesce(p_motivo, '')), ''), anulado_por = auth.uid()
   where id = p_item;
  -- Comanda sin ítems vigentes: sale de la pantalla de cocina
  if not exists (select 1 from public.cuenta_items where comanda_id = v_com.id and not anulado) then
    update public.comandas set estado = 'anulada', actualizada_at = now() where id = v_com.id;
  end if;
end $$;

-- ---------------- Cambiar la cuenta de mesa ----------------
create or replace function public.mover_cuenta(p_cuenta uuid, p_mesa uuid)
returns public.cuentas language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public._contexto(array['mesas.atender'], 'mesas');
  v_cuenta public.cuentas;
  v_mesa public.mesas;
begin
  v_cuenta := public._cuenta_abierta(p_cuenta, v_emp);
  select * into v_mesa from public.mesas where id = p_mesa and empresa_id = v_emp and activa;
  if not found then raise exception 'Mesa no encontrada'; end if;
  if v_mesa.ubicacion_id <> v_cuenta.ubicacion_id then raise exception 'La mesa es de otra tienda'; end if;
  if exists (select 1 from public.cuentas where mesa_id = p_mesa and estado = 'abierta') then
    raise exception 'La mesa % está ocupada', v_mesa.nombre;
  end if;
  update public.cuentas set mesa_id = p_mesa where id = p_cuenta returning * into v_cuenta;
  return v_cuenta;
end $$;

-- ---------------- Anular la cuenta completa ----------------
-- Sin pedidos vigentes basta con atender mesas; con pedidos exige ventas.devolver y motivo.
create or replace function public.anular_cuenta(p_cuenta uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public._contexto(array['mesas.atender'], 'mesas');
  v_cuenta public.cuentas;
begin
  v_cuenta := public._cuenta_abierta(p_cuenta, v_emp);
  if exists (select 1 from public.cuenta_items where cuenta_id = p_cuenta and not anulado) then
    if not public.tiene_cap('ventas.devolver') then
      raise exception 'Solo quien puede anular ventas puede cerrar una cuenta con pedidos sin cobrar';
    end if;
    if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Indica el motivo de la anulación'; end if;
  end if;
  update public.cuentas
     set estado = 'anulada', cerrada_at = now(), motivo_anulacion = nullif(trim(coalesce(p_motivo, '')), '')
   where id = p_cuenta;
  update public.comandas set estado = 'anulada', actualizada_at = now()
   where cuenta_id = p_cuenta and estado <> 'entregada';
end $$;

-- ---------------- Cobrar la cuenta ----------------
-- Genera la venta con registrar_venta (precio vigente, stock, voucher). La mesa ya consumió:
-- si un producto con stock no alcanza, la venta se registra igual y queda marcada.
create or replace function public.cobrar_cuenta(
  p_cuenta uuid, p_medio_pago text, p_referencia text, p_propina integer default 0,
  p_descuento_tipo text default 'monto', p_descuento_valor integer default 0
) returns public.ventas language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public._contexto(array['pos.vender'], 'mesas');
  v_cuenta public.cuentas;
  v_items jsonb;
  v_venta public.ventas;
  v_mesa text;
begin
  v_cuenta := public._cuenta_abierta(p_cuenta, v_emp);
  if coalesce(p_propina, 0) < 0 then raise exception 'Propina inválida'; end if;

  select jsonb_agg(jsonb_build_object('producto_id', producto_id, 'variante_id', variante_id, 'cantidad', cant))
    into v_items
    from (
      select producto_id, variante_id, sum(cantidad)::int as cant
        from public.cuenta_items
       where cuenta_id = p_cuenta and not anulado
       group by producto_id, variante_id
    ) x;
  if v_items is null then raise exception 'La cuenta no tiene productos para cobrar'; end if;

  v_venta := public.registrar_venta(
    v_cuenta.ubicacion_id, v_items, coalesce(p_descuento_tipo, 'monto'), coalesce(p_descuento_valor, 0),
    p_medio_pago, p_referencia, null, true
  );
  -- La propina no puede superar el total cobrado (evita errores de digitación)
  if coalesce(p_propina, 0) > v_venta.total then raise exception 'La propina no puede ser mayor que el total'; end if;

  select nombre into v_mesa from public.mesas where id = v_cuenta.mesa_id;
  update public.ventas
     set propina = coalesce(p_propina, 0), cuenta_id = p_cuenta, garzon_id = v_cuenta.garzon_id
   where id = v_venta.id returning * into v_venta;
  update public.vouchers
     set detalle = detalle || jsonb_build_object('propina', coalesce(p_propina, 0), 'mesa', v_mesa)
   where referencia_id = v_venta.id and tipo = 'venta';

  update public.cuentas set estado = 'cobrada', venta_id = v_venta.id, cerrada_at = now() where id = p_cuenta;
  update public.comandas set estado = 'entregada', actualizada_at = now()
   where cuenta_id = p_cuenta and estado in ('pendiente', 'preparando', 'lista');
  return v_venta;
end $$;

-- ---------------- Reporte de propinas por garzón ----------------
create or replace function public.reporte_propinas(p_desde date, p_hasta date, p_tienda uuid default null)
returns table (garzon_id uuid, garzon text, cuentas integer, ventas integer, propinas integer)
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.mi_empresa();
begin
  if v_emp is null then raise exception 'Usuario sin empresa'; end if;
  if not public.es_activo() then raise exception 'Cuenta inactiva'; end if;
  if not public.tiene_cap('modulos.reportes') then raise exception 'No tienes permiso para ver reportes'; end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then raise exception 'Rango de fechas inválido'; end if;
  return query
    select v.garzon_id, coalesce(pr.nombre, pr.email, '—')::text,
           count(*)::int, sum(v.total)::int, sum(v.propina)::int
      from public.ventas v
      left join public.profiles pr on pr.id = v.garzon_id
     where v.empresa_id = v_emp
       and v.cuenta_id is not null
       and v.estado <> 'anulada'
       and (p_tienda is null or v.ubicacion_id = p_tienda)
       and public.puede_ver_ubicacion(v.ubicacion_id)
       and v.created_at >= (p_desde::timestamp at time zone 'America/Santiago')
       and v.created_at < ((p_hasta + 1)::timestamp at time zone 'America/Santiago')
     group by v.garzon_id, pr.nombre, pr.email
     order by sum(v.propina) desc;
end $$;

-- ---------------- Permisos de ejecución ----------------
revoke execute on function public.enviar_comanda(uuid, jsonb, integer) from public, anon;
revoke execute on function public.cambiar_estado_comanda(uuid, text) from public, anon;
revoke execute on function public.anular_item_cuenta(uuid, text) from public, anon;
revoke execute on function public.mover_cuenta(uuid, uuid) from public, anon;
revoke execute on function public.anular_cuenta(uuid, text) from public, anon;
revoke execute on function public.cobrar_cuenta(uuid, text, text, integer, text, integer) from public, anon;
revoke execute on function public.reporte_propinas(date, date, uuid) from public, anon;
grant execute on function public.enviar_comanda(uuid, jsonb, integer) to authenticated, service_role;
grant execute on function public.cambiar_estado_comanda(uuid, text) to authenticated, service_role;
grant execute on function public.anular_item_cuenta(uuid, text) to authenticated, service_role;
grant execute on function public.mover_cuenta(uuid, uuid) to authenticated, service_role;
grant execute on function public.anular_cuenta(uuid, text) to authenticated, service_role;
grant execute on function public.cobrar_cuenta(uuid, text, text, integer, text, integer) to authenticated, service_role;
grant execute on function public.reporte_propinas(date, date, uuid) to authenticated, service_role;

-- ---------------- Tiempo real (pantalla de cocina y salón) ----------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['cuentas', 'comandas', 'cuenta_items'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
