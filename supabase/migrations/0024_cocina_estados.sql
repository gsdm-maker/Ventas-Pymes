-- ============================================================
-- Mi Socio Pyme · 0024 · Cocina: estados de comanda en orden y solo lo que se cocina
-- - Estados de una comanda (patrón State): se avanza o retrocede de a un paso.
--     pendiente ⇄ preparando ⇄ lista ⇄ entregada
--   Antes se aceptaba cualquier salto (p. ej. «entregada» → «pendiente»). Repetir el estado
--   actual no falla (doble toque). Anular sigue siendo solo con anular_item_cuenta.
-- - productos.va_a_cocina: lo que no se prepara (bebidas, envasados) se agrega a la cuenta
--   sin pasar por cocina. Si un pedido trae solo eso, no se crea comanda.
--   cuenta_items.comanda_id queda nulo para esos ítems.
-- ============================================================

alter table public.productos add column if not exists va_a_cocina boolean not null default true;
alter table public.cuenta_items alter column comanda_id drop not null;

-- ---------------- Transiciones permitidas ----------------
create or replace function public._transicion_comanda(p_desde text, p_hacia text)
returns boolean language sql immutable set search_path = public as $$
  select (p_desde, p_hacia) in (
    ('pendiente', 'preparando'),
    ('preparando', 'lista'), ('preparando', 'pendiente'),
    ('lista', 'entregada'), ('lista', 'preparando'),
    ('entregada', 'lista'));
$$;
revoke execute on function public._transicion_comanda(text, text) from public, anon, authenticated;

create or replace function public.cambiar_estado_comanda(p_comanda uuid, p_estado text)
returns public.comandas language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_com public.comandas;
begin
  if p_estado not in ('pendiente', 'preparando', 'lista', 'entregada') then raise exception 'Estado inválido'; end if;
  select * into v_com from public.comandas where id = p_comanda and empresa_id = public.mi_empresa() for update;
  if not found then raise exception 'Comanda no encontrada'; end if;
  -- Entregar o deshacer la entrega: garzón o cocina. Lo demás (preparación): solo cocina
  if p_estado = 'entregada' or v_com.estado = 'entregada' then
    v_emp := public._contexto(array['mesas.atender', 'cocina.gestionar'], 'mesas');
  else
    v_emp := public._contexto(array['cocina.gestionar'], 'cocina');
  end if;
  if v_com.empresa_id <> v_emp then raise exception 'Comanda no encontrada'; end if;
  if not public.puede_ver_ubicacion(v_com.ubicacion_id) then raise exception 'Ubicación no autorizada'; end if;
  if v_com.estado = 'anulada' then raise exception 'La comanda está anulada'; end if;
  if not exists (select 1 from public.cuentas c where c.id = v_com.cuenta_id and c.estado = 'abierta') then
    raise exception 'La cuenta de esta comanda ya está cerrada';
  end if;
  if v_com.estado = p_estado then return v_com; end if;
  if not public._transicion_comanda(v_com.estado, p_estado) then
    raise exception 'No se puede pasar de «%» a «%»: avanza o retrocede de a un paso', v_com.estado, p_estado;
  end if;
  update public.comandas set estado = p_estado, actualizada_at = now() where id = p_comanda returning * into v_com;
  return v_com;
end $$;

-- ---------------- Enviar pedido: a cocina solo lo que se prepara ----------------
-- Devuelve la comanda creada, o null si el pedido no tenía nada para cocina.
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

  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := (it->>'cantidad')::int;
    if v_cant is null or v_cant <= 0 or v_cant > 999 then raise exception 'Cantidad inválida'; end if;
    v_var := nullif(it->>'variante_id', '')::uuid;
    v_prod := public._producto((it->>'producto_id')::uuid, v_var, v_emp);
    perform public._exigir_variante(v_prod.id, v_var, v_mesa.ubicacion_id, true);
    v_nota := nullif(left(trim(coalesce(it->>'nota', '')), 140), '');

    -- La comanda (número correlativo por tienda y día) se crea con el primer ítem de cocina
    if v_prod.va_a_cocina and v_com.id is null then
      perform pg_advisory_xact_lock(hashtext('comanda:' || v_mesa.ubicacion_id::text || v_hoy::text));
      insert into public.comandas (empresa_id, ubicacion_id, cuenta_id, fecha, numero, usuario_id)
      values (
        v_emp, v_mesa.ubicacion_id, v_cuenta.id, v_hoy,
        coalesce((select max(numero) from public.comandas where ubicacion_id = v_mesa.ubicacion_id and fecha = v_hoy), 0) + 1,
        auth.uid()
      ) returning * into v_com;
    end if;

    insert into public.cuenta_items (
      empresa_id, cuenta_id, comanda_id, producto_id, variante_id, descripcion, cantidad, precio_unitario, nota
    ) values (
      v_emp, v_cuenta.id, case when v_prod.va_a_cocina then v_com.id end, v_prod.id, v_var,
      concat_ws(' · ', v_prod.nombre, public._etiqueta_variante(v_var)), v_cant, v_prod.precio_venta, v_nota
    );
  end loop;

  return v_com;
end $$;

-- ---------------- Anular ítem: los que no pasan por cocina no piden motivo ----------------
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
  if v_item.comanda_id is not null then
    select * into v_com from public.comandas where id = v_item.comanda_id;
    if v_com.estado <> 'pendiente' and nullif(trim(coalesce(p_motivo, '')), '') is null then
      raise exception 'Indica el motivo: cocina ya empezó a preparar este pedido';
    end if;
  end if;
  update public.cuenta_items
     set anulado = true, motivo_anulacion = nullif(trim(coalesce(p_motivo, '')), ''), anulado_por = auth.uid()
   where id = p_item;
  -- Comanda sin ítems vigentes: sale de la pantalla de cocina
  if v_com.id is not null and not exists (select 1 from public.cuenta_items where comanda_id = v_com.id and not anulado) then
    update public.comandas set estado = 'anulada', actualizada_at = now() where id = v_com.id;
  end if;
end $$;
