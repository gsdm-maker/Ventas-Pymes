-- ============================================================
-- Mi Socio Pyme · 0018 · Recepción: documento del proveedor (opcional) y costo
-- - recepciones: tipo (factura, guía, boleta, otro), número y fecha del documento.
-- - registrar_entrada puede actualizar el costo del producto con lo pagado.
-- ============================================================
alter table public.recepciones add column if not exists documento_tipo text;
alter table public.recepciones drop constraint if exists recepciones_documento_tipo_check;
alter table public.recepciones add constraint recepciones_documento_tipo_check
  check (documento_tipo is null or documento_tipo in ('factura', 'guia', 'boleta', 'otro'));
alter table public.recepciones add column if not exists documento_numero text;
alter table public.recepciones add column if not exists documento_fecha date;

-- Ingreso / recepción con datos opcionales del documento del proveedor
drop function if exists public.registrar_entrada(uuid, jsonb, uuid, text, text);
create or replace function public.registrar_entrada(
  p_ubicacion uuid, p_items jsonb, p_proveedor uuid,
  p_origen_texto text, p_observaciones text,
  p_documento_tipo text default null, p_documento_numero text default null,
  p_documento_fecha date default null,
  -- Guarda el costo pagado como costo del producto (solo con productos.gestionar)
  p_actualizar_costo boolean default false
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

  if p_documento_tipo is not null and p_documento_tipo not in ('factura', 'guia', 'boleta', 'otro') then
    raise exception 'Tipo de documento inválido';
  end if;

  insert into public.recepciones (
    empresa_id, proveedor_id, origen_texto, ubicacion_destino_id, observaciones, usuario_id,
    documento_tipo, documento_numero, documento_fecha
  ) values (
    v_emp, p_proveedor, p_origen_texto, p_ubicacion, p_observaciones, auth.uid(),
    p_documento_tipo, nullif(trim(coalesce(p_documento_numero, '')), ''), p_documento_fecha
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
    perform public._exigir_variante(v_prod, v_var, p_ubicacion, false);

    insert into public.recepcion_items (recepcion_id, producto_id, variante_id, cantidad, costo_unitario)
    values (v_rec.id, v_prod, v_var, v_cant, v_costo);

    if coalesce(p_actualizar_costo, false) and v_costo is not null and v_costo > 0
       and public.tiene_cap('productos.gestionar') then
      update public.productos set costo_referencia = v_costo where id = v_prod and empresa_id = v_emp;
    end if;

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


revoke execute on function public.registrar_entrada(uuid, jsonb, uuid, text, text, text, text, date, boolean) from anon, public;
grant execute on function public.registrar_entrada(uuid, jsonb, uuid, text, text, text, text, date, boolean) to authenticated, service_role;
