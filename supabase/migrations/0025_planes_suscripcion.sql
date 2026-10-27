-- ============================================================
-- Mi Socio Pyme · 0025 · Planes de suscripción
-- Antes: prueba / gratis / pago. Ahora:
--   - prueba  : N días configurables (prueba_hasta). Al terminar se bloquea.
--   - mensual : ciclos de 30 días contados desde la fecha de alta (plan_inicio).
--   - anual   : ciclos de 1 año desde la fecha de alta.
--   - dueno   : pago único, sin vencimiento.
-- Mensual y anual: plan_vence es el fin del período pagado. Después quedan
-- `dias_gracia` días (5 por defecto) con alertas antes de bloquear el uso.
-- Alertas al admin de la empresa: desde `aviso_dias_antes` días antes del vencimiento,
-- con un aviso emergente cada `aviso_cada_horas` horas (24 = una vez al día).
-- Pagos: registrar_pago_plan() suma un período al vencimiento actual (respeta el ciclo
-- desde la fecha de alta) y deja el registro en pagos_plan. Solo lo llama la Edge Function
-- admin-users (service_role) a pedido del administrador general.
-- Migración de datos: gratis → dueno; pago → mensual con 30 días desde hoy.
-- ============================================================

-- ---------------- Columnas ----------------
alter table public.empresas
  add column if not exists plan_inicio timestamptz,
  add column if not exists plan_vence timestamptz,
  add column if not exists dias_gracia integer not null default 5,
  add column if not exists aviso_dias_antes integer not null default 7,
  add column if not exists aviso_cada_horas integer not null default 24;

alter table public.empresas drop constraint if exists empresas_plan_check;

update public.empresas set plan = 'dueno', prueba_hasta = null,
       plan_inicio = coalesce(plan_inicio, created_at)
 where plan = 'gratis';
update public.empresas set plan = 'mensual', prueba_hasta = null,
       plan_inicio = coalesce(plan_inicio, now()),
       plan_vence = coalesce(plan_vence, now() + interval '30 days')
 where plan = 'pago';

alter table public.empresas
  add constraint empresas_plan_check check (plan in ('prueba', 'mensual', 'anual', 'dueno'));
alter table public.empresas drop constraint if exists empresas_plan_vence_check;
alter table public.empresas
  add constraint empresas_plan_vence_check check (plan not in ('mensual', 'anual') or plan_vence is not null);
alter table public.empresas drop constraint if exists empresas_avisos_check;
alter table public.empresas
  add constraint empresas_avisos_check check (
    dias_gracia between 0 and 60
    and aviso_dias_antes between 0 and 90
    and aviso_cada_horas between 1 and 720);

-- ---------------- Regla única de vigencia ----------------
-- Espejo de estadoPlan() en src/core/auth/plan.ts y de planVigente() en admin-users
create or replace function public._plan_vigente(
  p_plan text, p_prueba_hasta timestamptz, p_vence timestamptz, p_gracia integer)
returns boolean language sql stable set search_path = public as $$
  select case
    when p_plan = 'dueno' then true
    when p_plan = 'prueba' then p_prueba_hasta is null or p_prueba_hasta > now()
    when p_plan in ('mensual', 'anual') then
      p_vence is not null and p_vence + make_interval(days => coalesce(p_gracia, 0)) > now()
    else false
  end;
$$;

create or replace function public.empresa_vigente()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select public._plan_vigente(e.plan, e.prueba_hasta, e.plan_vence, e.dias_gracia)
      from public.empresas e where e.id = public.mi_empresa()
  ), false);
$$;

revoke execute on function public._plan_vigente(text, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public._plan_vigente(text, timestamptz, timestamptz, integer) to service_role;

-- ---------------- proteger_empresa (igual que 0023 + columnas del plan) ----------------
create or replace function public.proteger_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare rol text := coalesce(auth.role(), '');
begin
  if rol in ('service_role', '') or public.es_owner() then
    return new;
  end if;
  if new.plan is distinct from old.plan
     or new.prueba_hasta is distinct from old.prueba_hasta
     or new.plan_inicio is distinct from old.plan_inicio
     or new.plan_vence is distinct from old.plan_vence
     or new.dias_gracia is distinct from old.dias_gracia
     or new.aviso_dias_antes is distinct from old.aviso_dias_antes
     or new.aviso_cada_horas is distinct from old.aviso_cada_horas
     or new.modulos is distinct from old.modulos
     or new.tipo_negocio is distinct from old.tipo_negocio
     or new.plan_ia is distinct from old.plan_ia then
    raise exception 'Solo el administrador general puede cambiar plan, vencimiento, avisos, rubro, módulos o asistente';
  end if;
  if not public.es_admin_empresa(old.id) then
    raise exception 'No autorizado sobre esta empresa';
  end if;
  return new;
end $$;

-- ---------------- Historial de pagos ----------------
create table if not exists public.pagos_plan (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  plan text not null check (plan in ('mensual', 'anual', 'dueno')),
  periodo_desde timestamptz not null,
  periodo_hasta timestamptz,
  nota text check (nota is null or char_length(nota) <= 200),
  registrado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_pagos_plan_empresa on public.pagos_plan (empresa_id, created_at desc);

alter table public.pagos_plan enable row level security;
-- Lo lee el administrador general; lo escribe solo la Edge Function (service_role)
drop policy if exists pagos_plan_select on public.pagos_plan;
create policy pagos_plan_select on public.pagos_plan for select to authenticated
  using (public.es_owner());
revoke insert, update, delete on public.pagos_plan from anon, authenticated;

-- ---------------- Cambiar el plan de una empresa ----------------
-- prueba : prueba_hasta = hoy + p_prueba_dias.
-- mensual/anual: plan_inicio = p_inicio (fecha de alta). El vencimiento es el fin del ciclo
--   en curso contado desde esa fecha (se asume pagado el período actual) y queda registrado.
-- dueno  : pago único, sin vencimiento.
create or replace function public.cambiar_plan_empresa(
  p_empresa uuid, p_plan text, p_actor uuid,
  p_prueba_dias integer default 15, p_inicio date default null, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  v_inicio timestamptz;
  v_periodo interval;
  v_vence timestamptz;
begin
  select * into e from public.empresas where id = p_empresa for update;
  if not found then raise exception 'Empresa inexistente'; end if;
  if p_plan not in ('prueba', 'mensual', 'anual', 'dueno') then raise exception 'Plan inválido'; end if;

  if p_plan = 'prueba' then
    if p_prueba_dias is null or p_prueba_dias < 1 or p_prueba_dias > 365 then
      raise exception 'Los días de prueba van de 1 a 365';
    end if;
    update public.empresas
       set plan = 'prueba', prueba_hasta = now() + make_interval(days => p_prueba_dias),
           plan_inicio = null, plan_vence = null
     where id = p_empresa;
    return jsonb_build_object('plan', 'prueba', 'vence', now() + make_interval(days => p_prueba_dias));
  end if;

  if p_plan = 'dueno' then
    update public.empresas
       set plan = 'dueno', prueba_hasta = null, plan_vence = null, plan_inicio = now()
     where id = p_empresa;
    insert into public.pagos_plan (empresa_id, plan, periodo_desde, periodo_hasta, nota, registrado_por)
    values (p_empresa, 'dueno', now(), null, nullif(btrim(p_nota), ''), p_actor);
    return jsonb_build_object('plan', 'dueno', 'vence', null);
  end if;

  -- Mensual o anual: mediodía de Chile de la fecha de alta
  if p_inicio is not null and p_inicio > public.hoy_negocio() + 31 then
    raise exception 'La fecha de alta no puede estar tan en el futuro';
  end if;
  v_inicio := (coalesce(p_inicio, public.hoy_negocio())::timestamp + time '12:00') at time zone 'America/Santiago';
  v_periodo := case p_plan when 'mensual' then interval '30 days' else interval '1 year' end;
  v_vence := v_inicio + v_periodo;
  -- Alta en el pasado: avanza al ciclo en curso
  while v_vence <= now() loop
    v_vence := v_vence + v_periodo;
  end loop;

  update public.empresas
     set plan = p_plan, prueba_hasta = null, plan_inicio = v_inicio, plan_vence = v_vence
   where id = p_empresa;
  insert into public.pagos_plan (empresa_id, plan, periodo_desde, periodo_hasta, nota, registrado_por)
  values (p_empresa, p_plan, v_vence - v_periodo, v_vence, nullif(btrim(p_nota), ''), p_actor);
  return jsonb_build_object('plan', p_plan, 'inicio', v_inicio, 'vence', v_vence);
end $$;

-- ---------------- Registrar un pago ----------------
-- Suma un período (30 días o 1 año) al vencimiento actual: el ciclo sigue anclado a la
-- fecha de alta aunque el cliente pague antes o durante los días de gracia.
create or replace function public.registrar_pago_plan(p_empresa uuid, p_actor uuid, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  v_periodo interval;
  v_desde timestamptz;
  v_hasta timestamptz;
begin
  select * into e from public.empresas where id = p_empresa for update;
  if not found then raise exception 'Empresa inexistente'; end if;
  if e.plan not in ('mensual', 'anual') then
    raise exception 'Solo los planes mensual y anual registran pagos periódicos';
  end if;
  v_periodo := case e.plan when 'mensual' then interval '30 days' else interval '1 year' end;
  v_desde := coalesce(e.plan_vence, e.plan_inicio, now());
  v_hasta := v_desde + v_periodo;
  update public.empresas set plan_vence = v_hasta where id = p_empresa;
  insert into public.pagos_plan (empresa_id, plan, periodo_desde, periodo_hasta, nota, registrado_por)
  values (p_empresa, e.plan, v_desde, v_hasta, nullif(btrim(p_nota), ''), p_actor);
  return jsonb_build_object('desde', v_desde, 'hasta', v_hasta);
end $$;

revoke execute on function public.cambiar_plan_empresa(uuid, text, uuid, integer, date, text) from public, anon, authenticated;
revoke execute on function public.registrar_pago_plan(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cambiar_plan_empresa(uuid, text, uuid, integer, date, text) to service_role;
grant execute on function public.registrar_pago_plan(uuid, uuid, text) to service_role;

-- ---------------- Asistente: misma regla de vigencia (igual que 0023) ----------------
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
  elsif not p.es_owner and v_nu >= pl.mensajes_dia_usuario then
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
