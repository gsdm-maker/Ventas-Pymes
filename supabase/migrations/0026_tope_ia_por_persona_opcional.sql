-- ============================================================
-- Mi Socio Pyme · 0026 · Tope del asistente por persona opcional
-- planes_ia.mensajes_dia_usuario = null → sin límite individual: solo cuenta la bolsa
-- diaria de la empresa (útil cuando la empresa tiene una o pocas personas y no se quiere
-- perder el cupo). Con valor, cada persona además tiene su propio máximo diario.
-- _estado_ia: igual que 0025, salvo que el tope por persona se salta cuando es null.
-- ============================================================

alter table public.planes_ia alter column mensajes_dia_usuario drop not null;
alter table public.planes_ia drop constraint if exists planes_ia_mensajes_dia_usuario_check;
alter table public.planes_ia
  add constraint planes_ia_mensajes_dia_usuario_check
  check (mensajes_dia_usuario is null or mensajes_dia_usuario between 1 and 100000);

create or replace function public._estado_ia(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles;
  e public.empresas;
  pl public.planes_ia;
  v_hoy date := public.hoy_negocio();
  v_nu int;
  v_ne int;
  v_motivo text;
begin
  select * into p from public.profiles where id = p_user;
  if not found or not p.activo then
    return jsonb_build_object('permitido', false, 'motivo', 'Tu cuenta está inactiva.');
  end if;
  if p.empresa_id is null then
    return jsonb_build_object('permitido', false, 'motivo', 'Tu cuenta no pertenece a una empresa.');
  end if;
  select * into e from public.empresas where id = p.empresa_id;
  if e.plan_ia is null then
    return jsonb_build_object('permitido', false,
      'motivo', 'Tu empresa no tiene el asistente activado. Pídelo al administrador del sistema.');
  end if;
  select * into pl from public.planes_ia where plan = e.plan_ia;
  select coalesce(sum(mensajes), 0) into v_ne from public.uso_ia where empresa_id = e.id and dia = v_hoy;
  select coalesce(sum(mensajes), 0) into v_nu from public.uso_ia where user_id = p_user and dia = v_hoy;

  if not p.es_owner and not public._plan_vigente(e.plan, e.prueba_hasta, e.plan_vence, e.dias_gracia) then
    v_motivo := case when e.plan = 'prueba'
      then 'Tu período de prueba terminó. Contáctanos para activar tu suscripción.'
      else 'La suscripción de tu empresa está vencida. Contáctanos para renovarla.' end;
  elsif not public._evaluar_cap(p.es_owner, p.role, p.puesto, p.permissions, e.modulos, 'asistente.usar') then
    v_motivo := 'No tienes permiso para usar el asistente. Pídelo al administrador de tu empresa.';
  elsif not p.es_owner and pl.mensajes_dia_usuario is not null and v_nu >= pl.mensajes_dia_usuario then
    v_motivo := format('Usaste tus %s mensajes de hoy. Mañana se renuevan.', pl.mensajes_dia_usuario);
  elsif not p.es_owner and v_ne >= pl.mensajes_dia_empresa then
    v_motivo := format('Tu empresa usó los %s mensajes de hoy del plan %s. Mañana se renuevan.',
                       pl.mensajes_dia_empresa, pl.nombre);
  end if;

  return jsonb_build_object(
    'permitido', v_motivo is null,
    'motivo', v_motivo,
    'empresa_id', e.id,
    'plan', pl.plan,
    'plan_nombre', pl.nombre,
    'usados_usuario', v_nu,
    'tope_usuario', pl.mensajes_dia_usuario,
    'usados_empresa', v_ne,
    'tope_empresa', pl.mensajes_dia_empresa);
end $$;

revoke execute on function public._estado_ia(uuid) from public, anon, authenticated;
