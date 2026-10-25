-- ============================================================
-- Mi Socio Pyme · 0021 · Tiendas y bodegas: se desactivan, no se borran
-- - Borrar una ubicación eliminaba su stock en cascada sin dejar rastro y dejaba a los
--   usuarios asignados solo a ella sin filas en ubicacion_acceso, que se interpreta como
--   «ve todas». Ahora no se puede borrar vía API: se desactiva (activa = false).
-- - Desactivar exige: sin stock, sin transferencias abiertas, sin cuentas de mesa abiertas y
--   que quede otra ubicación activa. Las inactivas ya no aceptan operaciones
--   (_ubicacion_empresa) y su historial (ventas, movimientos, reportes) queda intacto.
-- - Quien estaba asignado solo a una ubicación desactivada queda sin acceso (sus filas en
--   ubicacion_acceso se conservan), no con acceso a todas.
-- ============================================================

drop policy if exists tenant_delete on public.ubicaciones;
revoke delete on public.ubicaciones from anon, authenticated;

create or replace function public.validar_desactivar_ubicacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n bigint;
begin
  if not (old.activa and not new.activa) then
    return new;
  end if;

  select coalesce(sum(s.disponible + s.reservado + s.transito), 0) into v_n
    from public.stock s join public.productos p on p.id = s.producto_id and p.controla_stock
   where s.ubicacion_id = old.id;
  if v_n > 0 then
    raise exception '% tiene % u. en stock: transfiérelas o regístralas como salida antes de desactivarla', old.nombre, v_n;
  end if;

  select count(*) into v_n from public.transferencias
   where (origen_id = old.id or destino_id = old.id)
     and estado in ('borrador', 'pendiente_despacho', 'en_transito');
  if v_n > 0 then
    raise exception '% tiene % transferencia(s) sin recibir: complétalas antes de desactivarla', old.nombre, v_n;
  end if;

  select count(*) into v_n from public.cuentas where ubicacion_id = old.id and estado = 'abierta';
  if v_n > 0 then
    raise exception '% tiene % cuenta(s) de mesa abiertas: cóbralas o anúlalas antes de desactivarla', old.nombre, v_n;
  end if;

  if not exists (
    select 1 from public.ubicaciones where empresa_id = old.empresa_id and activa and id <> old.id
  ) then
    raise exception 'Debe quedar al menos una ubicación activa';
  end if;
  return new;
end $$;

drop trigger if exists trg_validar_desactivar_ubicacion on public.ubicaciones;
create trigger trg_validar_desactivar_ubicacion
  before update of activa on public.ubicaciones
  for each row execute function public.validar_desactivar_ubicacion();
