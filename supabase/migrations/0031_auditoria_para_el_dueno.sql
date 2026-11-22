-- ============================================================
-- Mi Socio Pyme · 0031 · El administrador general puede leer la auditoría
-- La pantalla «Actividad» de la consola general consulta admin_auditoria con la sesión del usuario,
-- pero la tabla solo era legible por service_role (0002) y respondía 403.
-- Ahora: SELECT para authenticated, con una política que solo deja pasar al administrador general
-- (es_owner). Escribir sigue siendo solo de service_role y de las funciones SECURITY DEFINER.
-- Reversa: drop policy admin_auditoria_dueno_lee on public.admin_auditoria;
--          revoke select on public.admin_auditoria from authenticated;
-- ============================================================
grant select on public.admin_auditoria to authenticated;

drop policy if exists admin_auditoria_dueno_lee on public.admin_auditoria;
create policy admin_auditoria_dueno_lee on public.admin_auditoria
  for select to authenticated
  using (public.es_owner());
