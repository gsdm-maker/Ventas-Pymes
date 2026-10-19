-- ============================================================
-- Mi Socio Pyme · 0008 · RLS: cuentas activas y acceso por ubicación
-- 1) Toda lectura/escritura exige es_activo() (desactivar de verdad).
-- 2) Las tablas con ubicación respetan puede_ver_ubicacion().
-- ============================================================

-- Tablas con empresa_id, sin ubicación: activo + empresa
do $$
declare t text;
begin
  foreach t in array array[
    'ubicaciones','categorias','unidades_medida','productos','producto_variantes',
    'proveedores','motivos_salida','ubicacion_acceso'
  ]
  loop
    execute format('drop policy if exists tenant_rw on public.%I;', t);
    execute format($f$
      create policy tenant_rw on public.%I
      for all
      using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner()))
      with check (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner()));
    $f$, t);
  end loop;
end $$;

-- stock · por ubicación
drop policy if exists tenant_rw on public.stock;
create policy tenant_rw on public.stock for all
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and public.puede_ver_ubicacion(ubicacion_id))
  with check (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and public.puede_ver_ubicacion(ubicacion_id));

-- ventas · por ubicación
drop policy if exists tenant_rw on public.ventas;
create policy tenant_rw on public.ventas for all
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and public.puede_ver_ubicacion(ubicacion_id))
  with check (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and public.puede_ver_ubicacion(ubicacion_id));

-- vouchers · por ubicación (nullable)
drop policy if exists tenant_rw on public.vouchers;
create policy tenant_rw on public.vouchers for all
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and (ubicacion_id is null or public.puede_ver_ubicacion(ubicacion_id)))
  with check (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and (ubicacion_id is null or public.puede_ver_ubicacion(ubicacion_id)));

-- movimientos · por origen o destino
drop policy if exists tenant_rw on public.movimientos;
create policy tenant_rw on public.movimientos for all
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and ((ubicacion_origen_id is null and ubicacion_destino_id is null)
              or public.puede_ver_ubicacion(ubicacion_origen_id)
              or public.puede_ver_ubicacion(ubicacion_destino_id)))
  with check (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and ((ubicacion_origen_id is null and ubicacion_destino_id is null)
              or public.puede_ver_ubicacion(ubicacion_origen_id)
              or public.puede_ver_ubicacion(ubicacion_destino_id)));

-- recepciones · destino
drop policy if exists tenant_rw on public.recepciones;
create policy tenant_rw on public.recepciones for all
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and public.puede_ver_ubicacion(ubicacion_destino_id))
  with check (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and public.puede_ver_ubicacion(ubicacion_destino_id));

-- transferencias · origen o destino
drop policy if exists tenant_rw on public.transferencias;
create policy tenant_rw on public.transferencias for all
  using (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and (public.puede_ver_ubicacion(origen_id) or public.puede_ver_ubicacion(destino_id)))
  with check (public.es_activo() and (empresa_id = public.mi_empresa() or public.es_owner())
         and (public.puede_ver_ubicacion(origen_id) or public.puede_ver_ubicacion(destino_id)));

-- Hijas: activo + padre
drop policy if exists tenant_rw on public.recepcion_items;
create policy tenant_rw on public.recepcion_items for all
  using (public.es_activo() and exists (
    select 1 from public.recepciones r
     where r.id = recepcion_id and (r.empresa_id = public.mi_empresa() or public.es_owner())))
  with check (public.es_activo() and exists (
    select 1 from public.recepciones r
     where r.id = recepcion_id and (r.empresa_id = public.mi_empresa() or public.es_owner())));

drop policy if exists tenant_rw on public.transferencia_items;
create policy tenant_rw on public.transferencia_items for all
  using (public.es_activo() and exists (
    select 1 from public.transferencias t
     where t.id = transferencia_id and (t.empresa_id = public.mi_empresa() or public.es_owner())))
  with check (public.es_activo() and exists (
    select 1 from public.transferencias t
     where t.id = transferencia_id and (t.empresa_id = public.mi_empresa() or public.es_owner())));

drop policy if exists tenant_rw on public.venta_items;
create policy tenant_rw on public.venta_items for all
  using (public.es_activo() and exists (
    select 1 from public.ventas v
     where v.id = venta_id and (v.empresa_id = public.mi_empresa() or public.es_owner())))
  with check (public.es_activo() and exists (
    select 1 from public.ventas v
     where v.id = venta_id and (v.empresa_id = public.mi_empresa() or public.es_owner())));

-- empresas (lectura) y perfiles (escritura) exigen cuenta activa
drop policy if exists empresas_select on public.empresas;
create policy empresas_select on public.empresas for select
  using (public.es_activo() and (id = public.mi_empresa() or public.es_owner()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (public.es_activo() and (id = auth.uid() or public.es_admin_empresa(empresa_id) or public.es_owner()))
  with check (public.es_activo() and (id = auth.uid() or public.es_admin_empresa(empresa_id) or public.es_owner()));
