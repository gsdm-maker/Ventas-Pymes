-- ============================================================
-- Mi Socio Pyme · 0020 · Rubro y módulos del dueño, permisos por usuario y correcciones
-- - Rubro (tipo_negocio: retail | restaurante | mixto) y módulos: solo el administrador
--   general. El admin de empresa los ve, pero no los cambia.
-- - Los ajustes por usuario (profiles.permissions) ahora también aplican a los módulos
--   (antes se ignoraban), siempre dentro de los módulos habilitados para la empresa.
-- - Un admin de empresa no puede otorgar capacidades que él no tiene, ni al editar un
--   perfil (proteger_perfil) ni al crear la cuenta (validar_permisos_nuevos, Edge Function).
-- - Variantes, categorías, ubicaciones y mesas solo pueden apuntar a filas de la misma empresa.
-- - registrar_salida: dos envíos simultáneos de la misma salida offline no se rechazan.
-- ============================================================

-- ---------------- Rubro y módulos ----------------
alter table public.empresas drop constraint if exists empresas_tipo_negocio_check;
alter table public.empresas add constraint empresas_tipo_negocio_check
  check (tipo_negocio in ('retail', 'restaurante', 'mixto'));

alter table public.empresas drop constraint if exists empresas_modulos_check;
alter table public.empresas add constraint empresas_modulos_check
  check (modulos <@ array['dashboard','pos','mesas','cocina','salidas','ingreso','inventario',
                          'productos','bodega','movimientos','reportes','usuarios','configuracion']);

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
     or new.tipo_negocio is distinct from old.tipo_negocio then
    raise exception 'Solo el administrador general puede cambiar plan, prueba, rubro o módulos';
  end if;
  if not public.es_admin_empresa(old.id) then
    raise exception 'No autorizado sobre esta empresa';
  end if;
  return new;
end $$;

-- ---------------- Capacidades ----------------
-- Espejo de MODULOS y Capability en src/core/auth/capabilities.ts
create or replace function public._catalogo_caps()
returns text[] language sql immutable set search_path = public as $$
  select array[
    'modulos.dashboard','modulos.pos','modulos.mesas','modulos.cocina','modulos.salidas',
    'modulos.ingreso','modulos.inventario','modulos.productos','modulos.bodega',
    'modulos.movimientos','modulos.reportes','modulos.usuarios','modulos.configuracion',
    'pos.vender','mesas.atender','cocina.gestionar','salidas.registrar','ingreso.registrar',
    'transferencias.gestionar','inventario.ajustar','productos.gestionar','usuarios.gestionar',
    'config.gestionar','reportes.ver','ventas.devolver'];
$$;

-- Misma evaluación que evaluarCapacidad() del front: módulo apagado gana siempre; luego
-- owner, ajuste explícito del usuario, admin de empresa y defaults del puesto.
create or replace function public._evaluar_cap(
  p_es_owner boolean, p_role text, p_puesto text, p_permisos jsonb, p_modulos text[], p_cap text
) returns boolean language sql stable set search_path = public as $$
  select case
    when p_cap like 'modulos.%' and not (substr(p_cap, 9) = any(coalesce(p_modulos, '{}'))) then false
    when coalesce(p_es_owner, false) then true
    when coalesce(p_permisos, '{}'::jsonb) ? p_cap then coalesce((p_permisos ->> p_cap)::boolean, false)
    when p_role = 'admin' then true
    else p_cap = any(public._caps_puesto(p_puesto))
  end;
$$;

create or replace function public.tiene_cap(p_cap text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles;
  v_mods text[];
begin
  select * into p from public.profiles where id = auth.uid();
  if not found or not p.activo then return false; end if;
  select modulos into v_mods from public.empresas where id = p.empresa_id;
  return public._evaluar_cap(p.es_owner, p.role, p.puesto, p.permissions, v_mods, p_cap);
end $$;

-- Ajustes por usuario: un objeto con capacidades conocidas y valores true/false
create or replace function public._permisos_validos(p jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(coalesce(p, '{}'::jsonb)) = 'object'
     and not exists (
       select 1 from jsonb_each(coalesce(p, '{}'::jsonb)) e
        where not (e.key = any(public._catalogo_caps())) or jsonb_typeof(e.value) <> 'boolean');
$$;

-- Primera capacidad que el perfil propuesto tendría y el actor no (null si ninguna).
-- Lo que el usuario ya tenía antes (p_antes_*) no cuenta como otorgado.
create or replace function public._cap_no_otorgable(
  p_actor uuid, p_empresa uuid,
  p_role text, p_puesto text, p_permisos jsonb,
  p_antes_role text, p_antes_puesto text, p_antes_permisos jsonb
) returns text language plpgsql stable security definer set search_path = public as $$
declare
  a public.profiles;
  v_mods text[];
  c text;
begin
  select * into a from public.profiles where id = p_actor;
  if not found or not a.activo then return 'cuenta inactiva'; end if;
  if a.es_owner then return null; end if;
  select modulos into v_mods from public.empresas where id = p_empresa;
  foreach c in array public._catalogo_caps() loop
    if public._evaluar_cap(false, p_role, p_puesto, p_permisos, v_mods, c)
       and not (p_antes_role is not null
                and public._evaluar_cap(false, p_antes_role, p_antes_puesto, p_antes_permisos, v_mods, c))
       and not public._evaluar_cap(false, a.role, a.puesto, a.permissions, v_mods, c) then
      return c;
    end if;
  end loop;
  return null;
end $$;

-- La usa la Edge Function (service_role) antes de crear una cuenta: null si todo está bien
create or replace function public.validar_permisos_nuevos(
  p_actor uuid, p_empresa uuid, p_role text, p_puesto text, p_permisos jsonb
) returns text language plpgsql stable security definer set search_path = public as $$
declare v_cap text;
begin
  if not public._permisos_validos(p_permisos) then return 'Permisos inválidos'; end if;
  v_cap := public._cap_no_otorgable(p_actor, p_empresa, p_role, p_puesto, p_permisos, null, null, null);
  if v_cap is not null then
    return format('No puedes otorgar un permiso que tú no tienes (%s)', v_cap);
  end if;
  return null;
end $$;

revoke execute on function public._catalogo_caps() from public, anon, authenticated;
revoke execute on function public._evaluar_cap(boolean, text, text, jsonb, text[], text) from public, anon, authenticated;
revoke execute on function public._permisos_validos(jsonb) from public, anon, authenticated;
revoke execute on function public._cap_no_otorgable(uuid, uuid, text, text, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.validar_permisos_nuevos(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.validar_permisos_nuevos(uuid, uuid, text, text, jsonb) to service_role;

-- ---------------- profiles ----------------
-- Igual que 0010, más: permisos válidos y sin otorgar lo que el actor no tiene
create or replace function public.proteger_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rol text := coalesce(auth.role(), '');
  v_cap text;
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
  if new.role is distinct from old.role
     or new.puesto is distinct from old.puesto
     or new.permissions is distinct from old.permissions then
    if not public._permisos_validos(new.permissions) then
      raise exception 'Permisos inválidos';
    end if;
    v_cap := public._cap_no_otorgable(auth.uid(), new.empresa_id, new.role, new.puesto, new.permissions,
                                      old.role, old.puesto, old.permissions);
    if v_cap is not null then
      raise exception 'No puedes otorgar un permiso que tú no tienes (%)', v_cap;
    end if;
  end if;
  return new;
end $$;

-- ---------------- Referencias dentro de la misma empresa ----------------
create or replace function public.validar_referencias_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'producto_variantes' then
    if not exists (select 1 from public.productos where id = new.producto_id and empresa_id = new.empresa_id) then
      raise exception 'El producto no pertenece a la empresa';
    end if;
  elsif tg_table_name = 'productos' then
    if new.categoria_id is not null and not exists (
      select 1 from public.categorias where id = new.categoria_id and empresa_id = new.empresa_id
    ) then
      raise exception 'La categoría no pertenece a la empresa';
    end if;
  elsif tg_table_name = 'categorias' then
    if new.parent_id is not null and not exists (
      select 1 from public.categorias where id = new.parent_id and empresa_id = new.empresa_id
    ) then
      raise exception 'La categoría padre no pertenece a la empresa';
    end if;
  elsif tg_table_name = 'ubicaciones' then
    if new.parent_id is not null and not exists (
      select 1 from public.ubicaciones where id = new.parent_id and empresa_id = new.empresa_id
    ) then
      raise exception 'La ubicación padre no pertenece a la empresa';
    end if;
  elsif tg_table_name = 'mesas' then
    if not exists (select 1 from public.ubicaciones where id = new.ubicacion_id and empresa_id = new.empresa_id) then
      raise exception 'La ubicación no pertenece a la empresa';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_referencias_empresa on public.producto_variantes;
create trigger trg_referencias_empresa before insert or update of producto_id, empresa_id
  on public.producto_variantes for each row execute function public.validar_referencias_empresa();
drop trigger if exists trg_referencias_empresa on public.productos;
create trigger trg_referencias_empresa before insert or update of categoria_id, empresa_id
  on public.productos for each row execute function public.validar_referencias_empresa();
drop trigger if exists trg_referencias_empresa on public.categorias;
create trigger trg_referencias_empresa before insert or update of parent_id, empresa_id
  on public.categorias for each row execute function public.validar_referencias_empresa();
drop trigger if exists trg_referencias_empresa on public.ubicaciones;
create trigger trg_referencias_empresa before insert or update of parent_id, empresa_id
  on public.ubicaciones for each row execute function public.validar_referencias_empresa();
drop trigger if exists trg_referencias_empresa on public.mesas;
create trigger trg_referencias_empresa before insert or update of ubicacion_id, empresa_id
  on public.mesas for each row execute function public.validar_referencias_empresa();

-- Con la opción apagada no se exige variante (0015); solo cuentan las variantes del producto
-- en su propia empresa
create or replace function public._exigir_variante(p_prod uuid, p_var uuid, p_ubi uuid, p_permitir_legado boolean)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := (select empresa_id from public.productos where id = p_prod);
begin
  if p_var is not null then return; end if;
  if not public.empresa_usa_variantes(v_emp) then return; end if;
  if not exists (
    select 1 from public.producto_variantes where producto_id = p_prod and empresa_id = v_emp and activa
  ) then return; end if;
  if p_permitir_legado and exists (
    select 1 from public.stock where producto_id = p_prod and variante_id is null and ubicacion_id = p_ubi and disponible > 0
  ) then return; end if;
  raise exception 'Elige la talla o color de %', (select nombre from public.productos where id = p_prod);
end $$;
revoke execute on function public._exigir_variante(uuid, uuid, uuid, boolean) from public, anon, authenticated;

-- Solo la usan otras funciones: desde la API devolvía talla/color de cualquier empresa
revoke execute on function public._etiqueta_variante(uuid) from authenticated;

-- ---------------- registrar_salida ----------------
-- Igual que 0014, con un bloqueo por uuid_local: el reenvío simultáneo de la misma salida
-- espera al primero y devuelve su voucher en vez de fallar por clave duplicada.
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
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text || v_uuid::text, 0));
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
  perform public._exigir_variante(p_producto, p_variante, p_ubicacion, true);
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
