-- ============================================================
-- Mi Socio Pyme · 0009 · Restringir ubicaciones por ubicacion_acceso
-- Un usuario de empresa solo ve las ubicaciones que tiene
-- asignadas en ubicacion_acceso. Si no tiene restricciones,
-- conserva el comportamiento anterior (ve todas las de su empresa).
-- ============================================================

drop policy if exists tenant_rw on public.ubicaciones;
create policy tenant_rw on public.ubicaciones for all
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
  )
  with check (
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
