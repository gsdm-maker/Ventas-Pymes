-- ============================================================
-- Mi Socio Pyme · 0010 · Endurecimiento de seguridad (revisión 18-10-2026)
-- 1) Funciones internas (_stock_row, _folio) fuera del alcance de anon/authenticated.
-- 2) Capacidades, módulos y período de prueba se validan en la base (tiene_cap,
--    empresa_vigente, _contexto), no solo en el front.
-- 3) ubicacion_acceso: solo lectura para usuarios; lo escribe la Edge Function.
-- 4) profiles: un usuario no puede cambiar su puesto, permisos, estado ni correo.
-- 5) stock, movimientos, ventas, vouchers, recepciones y transferencias: solo
--    lectura vía API; toda escritura pasa por las RPC transaccionales.
-- 6) Catálogo y maestros: escritura según capacidad (productos/config).
-- 7) RPC: precio desde la base, productos/ubicaciones de la propia empresa,
--    idempotencia por uuid_local (ventas y salidas), bloqueos de fila y
--    validación de cantidades recibidas.
-- ============================================================

-- ---------------- 1) Funciones internas ----------------------------------
revoke execute on function public._stock_row(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._folio(text) from public, anon, authenticated;

-- ---------------- 2) Helpers de autorización -----------------------------
create or replace function public.empresa_vigente()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select e.plan <> 'prueba' or e.prueba_hasta is null or e.prueba_hasta > now()
      from public.empresas e where e.id = public.mi_empresa()
  ), false);
$$;

-- Espejo de src/core/auth/capabilities.ts (defaults por puesto)
create or replace function public._caps_puesto(p_puesto text)
returns text[] language sql immutable set search_path = public as $$
  select case p_puesto
    when 'admin' then array[
      'modulos.dashboard','modulos.pos','modulos.salidas','modulos.ingreso','modulos.inventario',
      'modulos.productos','modulos.bodega','modulos.movimientos','modulos.reportes',
      'modulos.usuarios','modulos.configuracion',
      'pos.vender','salidas.registrar','ingreso.registrar','transferencias.gestionar',
      'inventario.ajustar','productos.gestionar','usuarios.gestionar','config.gestionar','reportes.ver']
    when 'bodega' then array[
      'modulos.dashboard','modulos.ingreso','modulos.inventario','modulos.productos',
      'modulos.bodega','modulos.movimientos',
      'ingreso.registrar','transferencias.gestionar','inventario.ajustar','productos.gestionar']
    when 'tienda' then array[
      'modulos.dashboard','modulos.pos','modulos.salidas','modulos.inventario','modulos.movimientos',
      'pos.vender','salidas.registrar']
    when 'auditor' then array[
      'modulos.dashboard','modulos.inventario','modulos.movimientos','modulos.reportes',
      'reportes.ver']
    else array[]::text[]
  end;
$$;

-- Misma evaluación que evaluarCapacidad() del front
create or replace function public.tiene_cap(p_cap text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles;
  v_mods text[];
begin
  select * into p from public.profiles where id = auth.uid();
  if not found or not p.activo then return false; end if;
  select modulos into v_mods from public.empresas where id = p.empresa_id;

  if p_cap like 'modulos.%' then
    if not (substr(p_cap, 9) = any(coalesce(v_mods, '{}'))) then return false; end if;
    if p.es_owner or p.role = 'admin' then return true; end if;
    return p_cap = any(public._caps_puesto(p.puesto));
  end if;

  if p.es_owner then return true; end if;
  if p.permissions ? p_cap then return coalesce((p.permissions ->> p_cap)::boolean, false); end if;
  if p.role = 'admin' then return true; end if;
  return p_cap = any(public._caps_puesto(p.puesto));
end $$;

-- Puede escribir en la empresa con alguna de las capacidades indicadas
create or replace function public.puede_escribir(p_empresa uuid, p_caps text[])
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_activo() and (
    public.es_owner()
    or (
      p_empresa = public.mi_empresa()
      and public.empresa_vigente()
      and exists (select 1 from unnest(p_caps) c where public.tiene_cap(c))
    )
  );
$$;

-- Contexto común de las RPC: devuelve la empresa del usuario o falla
create or replace function public._contexto(p_caps text[], p_modulo text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.mi_empresa();
begin
  if v_emp is null then raise exception 'Usuario sin empresa'; end if;
  if not public.es_activo() then raise exception 'Cuenta inactiva'; end if;
  if not public.empresa_vigente() then raise exception 'El período de prueba de la empresa terminó'; end if;
  if not exists (select 1 from public.empresas e where e.id = v_emp and p_modulo = any(e.modulos)) then
    raise exception 'El módulo % no está habilitado para la empresa', p_modulo;
  end if;
  if not exists (select 1 from unnest(p_caps) c where public.tiene_cap(c)) then
    raise exception 'No tienes permiso para esta operación';
  end if;
  return v_emp;
end $$;

-- Producto (y variante) activos de la empresa
create or replace function public._producto(p_prod uuid, p_var uuid, p_emp uuid)
returns public.productos language plpgsql stable security definer set search_path = public as $$
declare r public.productos;
begin
  select * into r from public.productos where id = p_prod and empresa_id = p_emp;
  if not found then raise exception 'Producto no encontrado'; end if;
  if not r.activo then raise exception 'El producto % está inactivo', r.nombre; end if;
  if p_var is not null and not exists (
    select 1 from public.producto_variantes v
     where v.id = p_var and v.producto_id = p_prod and v.empresa_id = p_emp and v.activa
  ) then
    raise exception 'Variante no válida para %', r.nombre;
  end if;
  return r;
end $$;

-- Ubicación activa de la empresa
create or replace function public._ubicacion_empresa(p_ubi uuid, p_emp uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ubicaciones where id = p_ubi and empresa_id = p_emp and activa) then
    raise exception 'Ubicación no válida';
  end if;
end $$;

-- Fila de stock bloqueada (sin carreras entre lectura y actualización)
create or replace function public._stock_row(
  p_prod uuid, p_var uuid, p_ubi uuid, p_emp uuid
) returns public.stock language plpgsql security definer set search_path = public as $$
declare r public.stock;
begin
  insert into public.stock (empresa_id, producto_id, variante_id, ubicacion_id)
  values (p_emp, p_prod, p_var, p_ubi)
  on conflict (producto_id, coalesce(variante_id, '00000000-0000-0000-0000-000000000000'::uuid), ubicacion_id)
  do nothing;

  select * into r from public.stock
   where producto_id = p_prod
     and ubicacion_id = p_ubi
     and coalesce(variante_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_var, '00000000-0000-0000-0000-000000000000'::uuid)
   for update;
  return r;
end $$;

revoke execute on function public._stock_row(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._caps_puesto(text) from public, anon;
revoke execute on function public._contexto(text[], text) from public, anon, authenticated;
revoke execute on function public._producto(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._ubicacion_empresa(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.empresa_vigente() from public, anon;
revoke execute on function public.tiene_cap(text) from public, anon;
revoke execute on function public.puede_escribir(uuid, text[]) from public, anon;
grant execute on function public._caps_puesto(text) to authenticated, service_role;
grant execute on function public.empresa_vigente() to authenticated, service_role;
grant execute on function public.tiene_cap(text) to authenticated, service_role;
grant execute on function public.puede_escribir(uuid, text[]) to authenticated, service_role;

-- ---------------- 3) ubicacion_acceso ------------------------------------
drop policy if exists tenant_rw on public.ubicacion_acceso;
drop policy if exists acceso_select on public.ubicacion_acceso;
create policy acceso_select on public.ubicacion_acceso for select
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner()));
revoke insert, update, delete, truncate on public.ubicacion_acceso from anon, authenticated;

-- Coherencia: usuario y ubicación de la misma empresa que la fila
create or replace function public.validar_ubicacion_acceso()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ubicaciones where id = new.ubicacion_id and empresa_id = new.empresa_id) then
    raise exception 'La ubicación no pertenece a la empresa';
  end if;
  if not exists (select 1 from public.profiles where id = new.user_id and empresa_id = new.empresa_id) then
    raise exception 'El usuario no pertenece a la empresa';
  end if;
  return new;
end $$;

drop trigger if exists trg_validar_ubicacion_acceso on public.ubicacion_acceso;
create trigger trg_validar_ubicacion_acceso
  before insert or update on public.ubicacion_acceso
  for each row execute function public.validar_ubicacion_acceso();

-- ---------------- 4) profiles --------------------------------------------
-- Sin JWT (rol '') = conexión directa a la base (SQL Editor, migraciones,
-- owner_bootstrap.sql): confiable. Toda petición vía API trae rol anon/authenticated.
create or replace function public.proteger_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
declare rol text := coalesce(auth.role(), '');
begin
  if rol in ('service_role', '') or public.es_owner() then
    return new;
  end if;
  if new.es_owner is distinct from old.es_owner then
    raise exception 'No autorizado para cambiar es_owner';
  end if;
  if new.empresa_id is distinct from old.empresa_id then
    raise exception 'No autorizado para cambiar la empresa del usuario';
  end if;
  if new.email is distinct from old.email or new.id is distinct from old.id then
    raise exception 'No autorizado para cambiar el correo del usuario';
  end if;

  if new.id = auth.uid() then
    -- Sobre sí mismo solo puede cambiar nombre y must_change_password
    if new.role is distinct from old.role
       or new.puesto is distinct from old.puesto
       or new.permissions is distinct from old.permissions
       or new.activo is distinct from old.activo then
      raise exception 'No puedes cambiar tu propio rol, puesto, permisos o estado';
    end if;
    return new;
  end if;

  -- Sobre otro usuario de su empresa (la política ya exige admin de empresa)
  if not public.tiene_cap('usuarios.gestionar') then
    raise exception 'No tienes permiso para gestionar usuarios';
  end if;
  if old.role = 'admin' and (
       new.role is distinct from old.role
       or new.puesto is distinct from old.puesto
       or new.permissions is distinct from old.permissions
       or new.activo is distinct from old.activo) then
    raise exception 'Solo el administrador general puede modificar a otro administrador';
  end if;
  return new;
end $$;

-- ---------------- 5) Tablas transaccionales: solo lectura ----------------
do $$
declare t text;
begin
  foreach t in array array[
    'stock','movimientos','ventas','venta_items','vouchers',
    'recepciones','recepcion_items','transferencias','transferencia_items'
  ]
  loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated;', t);
  end loop;
end $$;

drop policy if exists tenant_rw on public.stock;
create policy tenant_select on public.stock for select
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and public.puede_ver_ubicacion(ubicacion_id));

drop policy if exists tenant_rw on public.ventas;
create policy tenant_select on public.ventas for select
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and public.puede_ver_ubicacion(ubicacion_id));

drop policy if exists tenant_rw on public.vouchers;
create policy tenant_select on public.vouchers for select
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and (ubicacion_id is null or public.puede_ver_ubicacion(ubicacion_id)));

drop policy if exists tenant_rw on public.movimientos;
create policy tenant_select on public.movimientos for select
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and ((ubicacion_origen_id is null and ubicacion_destino_id is null)
              or public.puede_ver_ubicacion(ubicacion_origen_id)
              or public.puede_ver_ubicacion(ubicacion_destino_id)));

drop policy if exists tenant_rw on public.recepciones;
create policy tenant_select on public.recepciones for select
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and public.puede_ver_ubicacion(ubicacion_destino_id));

drop policy if exists tenant_rw on public.transferencias;
create policy tenant_select on public.transferencias for select
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and (public.puede_ver_ubicacion(origen_id) or public.puede_ver_ubicacion(destino_id)));

-- Hijas: visibles si el padre es visible (incluye la restricción por ubicación)
drop policy if exists tenant_rw on public.recepcion_items;
create policy tenant_select on public.recepcion_items for select
  using (exists (select 1 from public.recepciones r where r.id = recepcion_id));

drop policy if exists tenant_rw on public.transferencia_items;
create policy tenant_select on public.transferencia_items for select
  using (exists (select 1 from public.transferencias t where t.id = transferencia_id));

drop policy if exists tenant_rw on public.venta_items;
create policy tenant_select on public.venta_items for select
  using (exists (select 1 from public.ventas v where v.id = venta_id));

-- ---------------- 6) Catálogo y maestros ---------------------------------
do $$
declare
  t text;
  caps text;
begin
  foreach t in array array[
    'productos','producto_variantes','categorias','unidades_medida','proveedores','motivos_salida'
  ]
  loop
    caps := case
      when t = 'productos' then $c$array['productos.gestionar','inventario.ajustar']$c$
      when t = 'producto_variantes' then $c$array['productos.gestionar']$c$
      else $c$array['config.gestionar']$c$
    end;
    execute format('drop policy if exists tenant_rw on public.%I;', t);
    execute format('drop policy if exists tenant_select on public.%I;', t);
    execute format('drop policy if exists tenant_insert on public.%I;', t);
    execute format('drop policy if exists tenant_update on public.%I;', t);
    execute format('drop policy if exists tenant_delete on public.%I;', t);
    execute format($f$
      create policy tenant_select on public.%I for select
      using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner()));
    $f$, t);
    execute format($f$
      create policy tenant_insert on public.%I for insert
      with check (public.puede_escribir(empresa_id, %s));
    $f$, t, caps);
    execute format($f$
      create policy tenant_update on public.%I for update
      using (public.puede_escribir(empresa_id, %s))
      with check (public.puede_escribir(empresa_id, %s));
    $f$, t, caps, caps);
    execute format($f$
      create policy tenant_delete on public.%I for delete
      using (public.puede_escribir(empresa_id, %s));
    $f$, t, caps);
  end loop;
end $$;

-- Ubicaciones: lectura según ubicacion_acceso (0009); escritura con config.gestionar
drop policy if exists tenant_rw on public.ubicaciones;
drop policy if exists tenant_select on public.ubicaciones;
drop policy if exists tenant_insert on public.ubicaciones;
drop policy if exists tenant_update on public.ubicaciones;
drop policy if exists tenant_delete on public.ubicaciones;
create policy tenant_select on public.ubicaciones for select
  using (
    public.es_activo()
    and (empresa_id = public.mi_empresa() or public.es_owner())
    and (
      public.es_owner()
      or not exists (select 1 from public.ubicacion_acceso a where a.user_id = auth.uid())
      or exists (
        select 1 from public.ubicacion_acceso a
        where a.user_id = auth.uid() and a.ubicacion_id = public.ubicaciones.id
      )
    )
  );
create policy tenant_insert on public.ubicaciones for insert
  with check (public.puede_escribir(empresa_id, array['config.gestionar']));
create policy tenant_update on public.ubicaciones for update
  using (public.puede_escribir(empresa_id, array['config.gestionar']))
  with check (public.puede_escribir(empresa_id, array['config.gestionar']));
create policy tenant_delete on public.ubicaciones for delete
  using (public.puede_escribir(empresa_id, array['config.gestionar']));

-- Empresa: además de ser admin, exige config.gestionar (el trigger protege plan/módulos)
drop policy if exists empresas_update on public.empresas;
create policy empresas_update on public.empresas for update
  using (public.es_owner() or (public.es_admin_empresa(id) and public.puede_escribir(id, array['config.gestionar'])))
  with check (public.es_owner() or (public.es_admin_empresa(id) and public.puede_escribir(id, array['config.gestionar'])));

-- ---------------- 7) RPC -------------------------------------------------
alter table public.ventas add column if not exists uuid_local uuid;
create unique index if not exists ventas_uuid_local
  on public.ventas (empresa_id, uuid_local) where uuid_local is not null;

-- Salida interna (idempotente por uuid_local)
create or replace function public.registrar_salida(
  p_producto uuid, p_variante uuid, p_ubicacion uuid, p_cantidad integer,
  p_motivo uuid, p_observaciones text, p_uuid_local uuid
) returns public.vouchers language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public._contexto(array['salidas.registrar'], 'salidas');
  v_uuid uuid := coalesce(p_uuid_local, gen_random_uuid());
  v_stock public.stock;
  v_mov public.movimientos;
  v_voucher public.vouchers;
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
  perform public._producto(p_producto, p_variante, v_emp);
  if p_motivo is not null and not exists (
    select 1 from public.motivos_salida where id = p_motivo and empresa_id = v_emp
  ) then
    raise exception 'Motivo de salida no válido';
  end if;

  v_stock := public._stock_row(p_producto, p_variante, p_ubicacion, v_emp);
  if v_stock.disponible < p_cantidad then raise exception 'Stock insuficiente'; end if;

  update public.stock
     set disponible = disponible - p_cantidad, updated_at = now()
   where id = v_stock.id;

  insert into public.movimientos (
    empresa_id, uuid_local, tipo, producto_id, variante_id,
    ubicacion_origen_id, cantidad, motivo_id, observaciones, usuario_id, estado_sync
  ) values (
    v_emp, v_uuid, 'salida', p_producto, p_variante,
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
    perform public._producto(v_prod, v_var, v_emp);

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
    perform public._producto(v_prod, v_var, v_emp);

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

-- Despachar (reservado → tránsito)
create or replace function public.despachar_transferencia(p_id uuid)
returns public.transferencias language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public._contexto(array['transferencias.gestionar'], 'bodega');
  v_tr public.transferencias;
  it public.transferencia_items;
  v_stock public.stock;
begin
  select * into v_tr from public.transferencias where id = p_id and empresa_id = v_emp for update;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if v_tr.estado <> 'pendiente_despacho' then raise exception 'Estado inválido para despachar'; end if;
  if not public.puede_ver_ubicacion(v_tr.origen_id) then raise exception 'Origen no autorizado'; end if;

  for it in select * from public.transferencia_items where transferencia_id = p_id loop
    v_stock := public._stock_row(it.producto_id, it.variante_id, v_tr.origen_id, v_emp);
    update public.stock set reservado = reservado - it.cantidad_enviada, updated_at = now() where id = v_stock.id;
    v_stock := public._stock_row(it.producto_id, it.variante_id, v_tr.destino_id, v_emp);
    update public.stock set transito = transito + it.cantidad_enviada, updated_at = now() where id = v_stock.id;
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

-- Recibir (tránsito → disponible); lo recibido no puede superar lo enviado
create or replace function public.recibir_transferencia(p_id uuid, p_items jsonb)
returns public.transferencias language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public._contexto(array['transferencias.gestionar', 'ingreso.registrar'], 'bodega');
  v_tr public.transferencias;
  it public.transferencia_items;
  v_rec int;
  v_hay_diff boolean := false;
  v_stock public.stock;
begin
  select * into v_tr from public.transferencias where id = p_id and empresa_id = v_emp for update;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if v_tr.estado <> 'en_transito' then raise exception 'Estado inválido para recibir'; end if;
  if not public.puede_ver_ubicacion(v_tr.destino_id) then raise exception 'Destino no autorizado'; end if;

  for it in select * from public.transferencia_items where transferencia_id = p_id loop
    v_rec := coalesce((
      select (e->>'cantidad_recibida')::int
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
       where (e->>'id')::uuid = it.id
       limit 1
    ), it.cantidad_enviada);
    if v_rec < 0 or v_rec > it.cantidad_enviada then
      raise exception 'Cantidad recibida inválida (debe estar entre 0 y %)', it.cantidad_enviada;
    end if;

    update public.transferencia_items
       set cantidad_recibida = v_rec, diferencia = v_rec - it.cantidad_enviada
     where id = it.id;

    if v_rec <> it.cantidad_enviada then v_hay_diff := true; end if;

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

-- Venta POS: precio desde productos, idempotente por uuid_local
drop function if exists public.registrar_venta(uuid, jsonb, text, integer, text, text);
create or replace function public.registrar_venta(
  p_ubicacion uuid, p_items jsonb, p_descuento_tipo text,
  p_descuento_valor integer, p_medio_pago text, p_referencia text,
  p_uuid_local uuid default null
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

    v_stock := public._stock_row(v_prod, v_var, p_ubicacion, v_emp);
    if v_stock.disponible < v_cant then raise exception 'Stock insuficiente para %', v_desc; end if;
    update public.stock set disponible = disponible - v_cant, updated_at = now() where id = v_stock.id;

    insert into public.venta_items (venta_id, producto_id, variante_id, descripcion, cantidad, precio_unitario, total_linea)
    values (v_venta.id, v_prod, v_var, v_desc, v_cant, v_prod_row.precio_venta, v_cant * v_prod_row.precio_venta);

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

-- ---------------- Privilegios de las RPC ---------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.registrar_salida(uuid,uuid,uuid,integer,uuid,text,uuid)',
    'public.registrar_entrada(uuid,jsonb,uuid,text,text)',
    'public.crear_transferencia(uuid,uuid,jsonb,text)',
    'public.despachar_transferencia(uuid)',
    'public.recibir_transferencia(uuid,jsonb)',
    'public.registrar_venta(uuid,jsonb,text,integer,text,text,uuid)'
  ]
  loop
    execute format('revoke execute on function %s from anon, public;', f);
    execute format('grant execute on function %s to authenticated, service_role;', f);
  end loop;
end $$;
