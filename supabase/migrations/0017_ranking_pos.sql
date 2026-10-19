-- ============================================================
-- Mi Socio Pyme · 0017 · Ranking de productos más vendidos por tienda (POS rápido)
-- El POS ordena el catálogo por lo que más vende esa ubicación en los últimos
-- N días, para que lo de todos los días quede arriba sin buscar.
-- ============================================================
create or replace function public.ranking_ventas(p_ubicacion uuid, p_dias integer default 30)
returns table (producto_id uuid, unidades bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.mi_empresa();
begin
  if v_emp is null or not public.es_activo() then raise exception 'Usuario sin empresa'; end if;
  if not public.puede_ver_ubicacion(p_ubicacion) then raise exception 'Ubicación no autorizada'; end if;
  return query
    select vi.producto_id, sum(vi.cantidad - vi.cantidad_devuelta)::bigint
      from public.venta_items vi
      join public.ventas v on v.id = vi.venta_id
     where v.empresa_id = v_emp
       and v.ubicacion_id = p_ubicacion
       and v.estado <> 'anulada'
       and v.created_at >= now() - make_interval(days => least(greatest(coalesce(p_dias, 30), 1), 365))
     group by vi.producto_id
     order by 2 desc;
end $$;

revoke execute on function public.ranking_ventas(uuid, integer) from public, anon;
grant execute on function public.ranking_ventas(uuid, integer) to authenticated, service_role;
