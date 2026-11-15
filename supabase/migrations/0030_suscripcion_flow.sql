-- ============================================================
-- Mi Socio Pyme · 0030 · Suscripción con cobro automático (Flow)
-- Antes: el administrador general registraba cada pago a mano (registrar_pago_plan).
-- Ahora, además: el administrador de la empresa puede contratar su plan con tarjeta. Flow
-- guarda la tarjeta, cobra cada período y avisa; el sistema solo registra lo que Flow confirma.
--   - suscripciones_flow : una por empresa. Qué contrató (nivel + período), en qué estado
--     está y con qué tarjeta (solo marca y últimos 4 dígitos; el número nunca llega aquí).
--   - cobros_flow        : un registro por importe de Flow (pagado, fallido, pendiente).
--     El número de importe es único: un aviso repetido no extiende el plan dos veces.
--   - eventos_flow       : bitácora de avisos recibidos, para diagnóstico del administrador general.
-- Reglas:
--   - Contratar no da acceso: el plan se activa o extiende solo con un cobro PAGADO.
--   - El vencimiento pasa a ser el fin del período que informa Flow (mes calendario, no 30
--     días). Nunca se acorta: si ya había un vencimiento posterior, se conserva.
--   - El nivel contratado se aplica con el primer cobro pagado; en las renovaciones no se
--     vuelve a aplicar (respeta un ajuste posterior del administrador general).
--   - Un cobro fallido deja la suscripción «morosa» y NO toca el vencimiento: siguen valiendo
--     los días de gracia y los avisos de 0025.
--   - Se contratan Socio / Socio Pro / Socio Pro Max. Anual solo Socio Pro Max (0027).
--     «A medida» y «dueño» siguen con registro manual.
--   - Un cambio de precio en niveles_plan rige para TODAS las suscripciones. Flow no deja
--     editar el monto de un plan con suscriptores, así que el identificador del plan lleva el
--     precio (msp-m-mensual-20000): al cambiar el precio la Edge Function crea el plan nuevo en
--     Flow, mueve cada suscripción vigente con subscription/changePlan y deja constancia aquí
--     con flow_actualizar_plan. Los cobros ya emitidos conservan su monto.
--   - Todo lo escribe la Edge Function (service_role). El admin de la empresa solo lee lo suyo.
-- Lo manual no cambia: cambiar_plan_empresa y registrar_pago_plan siguen igual.
-- Pruebas: supabase/pruebas/suscripcion_flow.sql
-- ============================================================

-- ---------------- Suscripción de la empresa ----------------
create table if not exists public.suscripciones_flow (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null unique references public.empresas(id) on delete cascade,
  nivel text not null check (nivel in ('s', 'm', 'l')),
  periodo text not null check (periodo in ('mensual', 'anual')),
  estado text not null default 'pendiente_tarjeta'
    check (estado in ('pendiente_tarjeta', 'activa', 'morosa', 'cancelada')),
  -- Identificadores en Flow
  flow_customer_id text unique check (flow_customer_id is null or char_length(flow_customer_id) between 1 and 80),
  flow_subscription_id text unique check (flow_subscription_id is null or char_length(flow_subscription_id) between 1 and 80),
  flow_plan_id text check (flow_plan_id is null or char_length(flow_plan_id) between 1 and 80),
  -- Solo para mostrar «Visa terminada en 1234»
  tarjeta_marca text check (tarjeta_marca is null or char_length(tarjeta_marca) <= 30),
  tarjeta_ultimos4 text check (tarjeta_ultimos4 is null or tarjeta_ultimos4 ~ '^[0-9]{4}$'),
  proximo_cobro timestamptz,
  -- Pidió cancelar: sigue con acceso hasta el fin del período pagado
  cancela_al_vencer boolean not null default false,
  -- false hasta el primer cobro pagado (ahí se aplica el nivel contratado)
  nivel_aplicado boolean not null default false,
  iniciada_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suscripciones_flow_anual_check check (periodo <> 'anual' or nivel = 'l'),
  constraint suscripciones_flow_activa_check
    check (estado not in ('activa', 'morosa') or flow_subscription_id is not null)
);

alter table public.suscripciones_flow enable row level security;
drop policy if exists suscripciones_flow_select on public.suscripciones_flow;
create policy suscripciones_flow_select on public.suscripciones_flow for select to authenticated
  using ((select public.es_owner())
         or ((select public.es_activo()) and public.es_admin_empresa(empresa_id)));
revoke all on public.suscripciones_flow from anon, authenticated;
grant select on public.suscripciones_flow to authenticated;
grant select, insert, update, delete on public.suscripciones_flow to service_role;

-- ---------------- Cobros (importes de Flow) ----------------
create table if not exists public.cobros_flow (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  suscripcion_id uuid not null references public.suscripciones_flow(id) on delete cascade,
  flow_invoice_id bigint not null unique,
  flow_orden bigint,
  nivel text not null check (nivel in ('s', 'm', 'l')),
  periodo text not null check (periodo in ('mensual', 'anual')),
  monto integer not null check (monto >= 0),
  periodo_desde timestamptz not null,
  periodo_hasta timestamptz not null,
  estado text not null check (estado in ('pendiente', 'pagado', 'fallido', 'anulado')),
  intentos integer not null default 0 check (intentos >= 0),
  error text check (error is null or char_length(error) <= 300),
  pagado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cobros_flow_fechas_check check (periodo_hasta > periodo_desde)
);
create index if not exists idx_cobros_flow_empresa on public.cobros_flow (empresa_id, created_at desc);
create index if not exists idx_cobros_flow_suscripcion on public.cobros_flow (suscripcion_id);

alter table public.cobros_flow enable row level security;
drop policy if exists cobros_flow_select on public.cobros_flow;
create policy cobros_flow_select on public.cobros_flow for select to authenticated
  using ((select public.es_owner())
         or ((select public.es_activo()) and public.es_admin_empresa(empresa_id)));
revoke all on public.cobros_flow from anon, authenticated;
grant select on public.cobros_flow to authenticated;
grant select, insert, update, delete on public.cobros_flow to service_role;

-- ---------------- Bitácora de avisos de Flow ----------------
create table if not exists public.eventos_flow (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id) on delete set null,
  tipo text not null check (tipo in ('tarjeta', 'cobro', 'sincronizacion', 'cancelacion')),
  resultado text not null check (resultado in ('ok', 'ignorado', 'error')),
  -- Identificador de Flow (importe, suscripción). Nunca el token ni datos de la tarjeta.
  referencia text check (referencia is null or char_length(referencia) <= 100),
  detalle text check (detalle is null or char_length(detalle) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists idx_eventos_flow_fecha on public.eventos_flow (created_at desc);
create index if not exists idx_eventos_flow_empresa on public.eventos_flow (empresa_id);

alter table public.eventos_flow enable row level security;
-- Solo el administrador general
drop policy if exists eventos_flow_select on public.eventos_flow;
create policy eventos_flow_select on public.eventos_flow for select to authenticated
  using ((select public.es_owner()));
revoke all on public.eventos_flow from anon, authenticated;
grant select on public.eventos_flow to authenticated;
grant select, insert on public.eventos_flow to service_role;

-- ---------------- 1 · Preparar el contrato ----------------
-- Valida quién contrata y qué, y deja la suscripción «pendiente de tarjeta». Devuelve lo que
-- la Edge Function necesita para hablar con Flow (plan, monto y el cliente si ya existe).
create or replace function public.flow_preparar_suscripcion(
  p_empresa uuid, p_actor uuid, p_nivel text, p_periodo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  n public.niveles_plan;
  s public.suscripciones_flow;
  v_monto integer;
  v_plan text;
begin
  select * into e from public.empresas where id = p_empresa for update;
  if not found then raise exception 'Empresa inexistente'; end if;
  if not exists (
    select 1 from public.profiles p
     where p.id = p_actor and p.activo
       and (p.es_owner or (p.role = 'admin' and p.empresa_id = p_empresa))) then
    raise exception 'Solo el administrador de la empresa puede contratar la suscripción';
  end if;
  if p_nivel is null or p_nivel not in ('s', 'm', 'l') then raise exception 'Plan inválido'; end if;
  if p_periodo is null or p_periodo not in ('mensual', 'anual') then raise exception 'Período inválido'; end if;
  if p_periodo = 'anual' and p_nivel <> 'l' then
    raise exception 'El plan anual es solo Socio Pro Max';
  end if;
  if e.plan = 'dueno' then
    raise exception 'Tu empresa tiene un plan sin vencimiento: no necesita suscripción';
  end if;

  select * into n from public.niveles_plan where nivel = p_nivel;
  v_monto := case p_periodo when 'mensual' then n.precio_mensual else n.precio_anual end;
  if v_monto is null or v_monto <= 0 then
    raise exception 'Ese plan no está disponible para contratar en línea';
  end if;
  v_plan := format('msp-%s-%s-%s', p_nivel, p_periodo, v_monto);

  select * into s from public.suscripciones_flow where empresa_id = p_empresa for update;
  if found and s.estado in ('activa', 'morosa') then
    raise exception 'Tu empresa ya tiene una suscripción en curso. Cancélala antes de contratar otra.';
  end if;

  insert into public.suscripciones_flow (empresa_id, nivel, periodo, estado, flow_plan_id, iniciada_por)
  values (p_empresa, p_nivel, p_periodo, 'pendiente_tarjeta', v_plan, p_actor)
  on conflict (empresa_id) do update
     set nivel = excluded.nivel, periodo = excluded.periodo, estado = 'pendiente_tarjeta',
         flow_plan_id = excluded.flow_plan_id, flow_subscription_id = null,
         proximo_cobro = null, cancela_al_vencer = false, nivel_aplicado = false,
         iniciada_por = excluded.iniciada_por, updated_at = now()
  returning * into s;

  return jsonb_build_object(
    'empresa_id', p_empresa,
    'empresa_nombre', e.nombre,
    'nivel', p_nivel,
    'nivel_nombre', n.nombre,
    'periodo', p_periodo,
    'monto', v_monto,
    'flow_plan_id', v_plan,
    'flow_customer_id', s.flow_customer_id);
end $$;

-- ---------------- 2 · Guardar el cliente creado en Flow ----------------
create or replace function public.flow_guardar_cliente(p_empresa uuid, p_customer text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(p_customer), '') is null then raise exception 'Falta el cliente de Flow'; end if;
  update public.suscripciones_flow
     set flow_customer_id = btrim(p_customer), updated_at = now()
   where empresa_id = p_empresa;
  if not found then raise exception 'La empresa no tiene una suscripción en preparación'; end if;
end $$;

-- ---------------- 3 · Tarjeta registrada y suscripción creada en Flow ----------------
-- No da acceso: el plan se activa con el primer cobro pagado (flow_registrar_cobro).
-- Repetir el aviso con la misma suscripción no cambia nada.
create or replace function public.flow_activar_suscripcion(
  p_customer text, p_subscription text, p_marca text, p_ultimos4 text, p_proximo timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.suscripciones_flow;
begin
  if nullif(btrim(p_subscription), '') is null then raise exception 'Falta la suscripción de Flow'; end if;
  select * into s from public.suscripciones_flow where flow_customer_id = p_customer for update;
  if not found then raise exception 'Cliente de Flow desconocido'; end if;
  if s.flow_subscription_id = p_subscription then
    return jsonb_build_object('empresa_id', s.empresa_id, 'estado', s.estado, 'repetido', true);
  end if;
  if s.estado <> 'pendiente_tarjeta' then
    raise exception 'La suscripción no está esperando una tarjeta';
  end if;
  update public.suscripciones_flow
     set estado = 'activa', flow_subscription_id = btrim(p_subscription),
         tarjeta_marca = nullif(left(btrim(p_marca), 30), ''),
         tarjeta_ultimos4 = case when p_ultimos4 ~ '^[0-9]{4}$' then p_ultimos4 end,
         proximo_cobro = p_proximo, updated_at = now()
   where id = s.id;
  return jsonb_build_object('empresa_id', s.empresa_id, 'estado', 'activa', 'repetido', false);
end $$;

-- ---------------- 4 · Registrar un importe de Flow ----------------
-- Un registro por importe. Pagado por primera vez → activa o extiende el plan y deja el pago
-- en pagos_plan. Un importe ya pagado no se vuelve a aplicar (los avisos se repiten).
create or replace function public.flow_registrar_cobro(
  p_subscription text, p_invoice bigint, p_monto integer,
  p_desde timestamptz, p_hasta timestamptz, p_estado text,
  p_intentos integer default 0, p_error text default null, p_orden bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.suscripciones_flow;
  e public.empresas;
  c public.cobros_flow;
  v_emp uuid;
  v_vence timestamptz;
begin
  if p_estado is null or p_estado not in ('pendiente', 'pagado', 'fallido', 'anulado') then
    raise exception 'Estado de cobro inválido';
  end if;
  if p_invoice is null then raise exception 'Falta el número de importe'; end if;

  -- Mismo orden de bloqueo que flow_preparar_suscripcion: empresa y luego suscripción
  select empresa_id into v_emp from public.suscripciones_flow where flow_subscription_id = p_subscription;
  if v_emp is null then raise exception 'Suscripción de Flow desconocida'; end if;
  select * into e from public.empresas where id = v_emp for update;
  select * into s from public.suscripciones_flow where flow_subscription_id = p_subscription for update;
  if not found then raise exception 'Suscripción de Flow desconocida'; end if;

  select * into c from public.cobros_flow where flow_invoice_id = p_invoice for update;
  if found then
    if c.suscripcion_id <> s.id then raise exception 'El importe pertenece a otra suscripción'; end if;
    if c.estado = 'pagado' then
      return jsonb_build_object('empresa_id', v_emp, 'aplicado', false, 'estado', 'pagado', 'vence', e.plan_vence);
    end if;
    update public.cobros_flow
       set estado = p_estado, monto = p_monto, periodo_desde = p_desde, periodo_hasta = p_hasta,
           intentos = coalesce(p_intentos, 0), error = nullif(left(btrim(p_error), 300), ''),
           flow_orden = coalesce(p_orden, flow_orden),
           pagado_en = case when p_estado = 'pagado' then now() end, updated_at = now()
     where id = c.id;
  else
    insert into public.cobros_flow
      (empresa_id, suscripcion_id, flow_invoice_id, flow_orden, nivel, periodo, monto,
       periodo_desde, periodo_hasta, estado, intentos, error, pagado_en)
    values
      (v_emp, s.id, p_invoice, p_orden, s.nivel, s.periodo, p_monto,
       p_desde, p_hasta, p_estado, coalesce(p_intentos, 0), nullif(left(btrim(p_error), 300), ''),
       case when p_estado = 'pagado' then now() end);
  end if;

  if p_estado = 'fallido' then
    update public.suscripciones_flow set estado = 'morosa', updated_at = now()
     where id = s.id and estado = 'activa';
    return jsonb_build_object('empresa_id', v_emp, 'aplicado', false, 'estado', 'fallido', 'vence', e.plan_vence);
  end if;
  if p_estado <> 'pagado' then
    return jsonb_build_object('empresa_id', v_emp, 'aplicado', false, 'estado', p_estado, 'vence', e.plan_vence);
  end if;

  -- Pagado: el plan sin vencimiento no se toca; el resto se activa o se extiende
  if e.plan <> 'dueno' then
    v_vence := greatest(coalesce(e.plan_vence, p_hasta), p_hasta);
    -- Anual exige Socio Pro Max (0027): el nivel va antes que el cambio de membresía
    if s.periodo = 'anual' and e.nivel is distinct from 'l' then
      perform public.aplicar_nivel(v_emp, 'l');
    end if;
    update public.empresas
       set plan = s.periodo, prueba_hasta = null,
           plan_inicio = case when e.plan in ('mensual', 'anual') then coalesce(e.plan_inicio, p_desde) else p_desde end,
           plan_vence = v_vence
     where id = v_emp;
    if not s.nivel_aplicado and (select nivel from public.empresas where id = v_emp) is distinct from s.nivel then
      perform public.aplicar_nivel(v_emp, s.nivel);
    end if;
  else
    v_vence := null;
  end if;

  insert into public.pagos_plan (empresa_id, plan, periodo_desde, periodo_hasta, nota, registrado_por)
  values (v_emp, s.periodo, p_desde, p_hasta, 'Flow · importe ' || p_invoice, null);
  update public.suscripciones_flow
     set estado = case when estado = 'cancelada' then estado else 'activa' end,
         nivel_aplicado = true, updated_at = now()
   where id = s.id;

  return jsonb_build_object('empresa_id', v_emp, 'aplicado', true, 'estado', 'pagado', 'vence', v_vence);
end $$;

-- ---------------- 5 · Reflejar el estado que informa Flow ----------------
-- Cancelación pedida por el cliente, término en Flow, morosidad y fecha del próximo cobro.
-- No toca el plan de la empresa: al cancelar se conserva el acceso hasta plan_vence.
create or replace function public.flow_sincronizar_suscripcion(
  p_subscription text, p_estado text, p_proximo timestamptz default null,
  p_cancela_al_vencer boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.suscripciones_flow;
begin
  if p_estado is null or p_estado not in ('activa', 'morosa', 'cancelada') then
    raise exception 'Estado de suscripción inválido';
  end if;
  select * into s from public.suscripciones_flow where flow_subscription_id = p_subscription for update;
  if not found then raise exception 'Suscripción de Flow desconocida'; end if;
  update public.suscripciones_flow
     set estado = p_estado,
         proximo_cobro = case when p_estado = 'cancelada' then null else coalesce(p_proximo, proximo_cobro) end,
         cancela_al_vencer = case when p_estado = 'cancelada' then false
                                  else coalesce(p_cancela_al_vencer, cancela_al_vencer) end,
         updated_at = now()
   where id = s.id;
  return jsonb_build_object('empresa_id', s.empresa_id, 'estado', p_estado);
end $$;

-- ---------------- 6 · Constancia del cambio de plan en Flow ----------------
-- Tras mover una suscripción a un plan con el precio nuevo. Solo cambia el identificador:
-- nivel y período no se tocan (el cambio de nivel del cliente es otra entrega).
create or replace function public.flow_actualizar_plan(p_subscription text, p_plan text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_plan is null or p_plan !~ '^msp-(s|m|l)-(mensual|anual)-[0-9]+$' then
    raise exception 'Identificador de plan inválido';
  end if;
  update public.suscripciones_flow
     set flow_plan_id = p_plan, updated_at = now()
   where flow_subscription_id = p_subscription
     and estado in ('activa', 'morosa')
     and p_plan like 'msp-' || nivel || '-' || periodo || '-%';
  if not found then
    raise exception 'Suscripción de Flow desconocida o el plan no corresponde a su nivel y período';
  end if;
end $$;

-- ---------------- Permisos: solo la Edge Function ----------------
revoke execute on function public.flow_preparar_suscripcion(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.flow_guardar_cliente(uuid, text) from public, anon, authenticated;
revoke execute on function public.flow_activar_suscripcion(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.flow_registrar_cobro(text, bigint, integer, timestamptz, timestamptz, text, integer, text, bigint) from public, anon, authenticated;
revoke execute on function public.flow_sincronizar_suscripcion(text, text, timestamptz, boolean) from public, anon, authenticated;
revoke execute on function public.flow_actualizar_plan(text, text) from public, anon, authenticated;
grant execute on function public.flow_actualizar_plan(text, text) to service_role;
grant execute on function public.flow_preparar_suscripcion(uuid, uuid, text, text) to service_role;
grant execute on function public.flow_guardar_cliente(uuid, text) to service_role;
grant execute on function public.flow_activar_suscripcion(text, text, text, text, timestamptz) to service_role;
grant execute on function public.flow_registrar_cobro(text, bigint, integer, timestamptz, timestamptz, text, integer, text, bigint) to service_role;
grant execute on function public.flow_sincronizar_suscripcion(text, text, timestamptz, boolean) to service_role;
