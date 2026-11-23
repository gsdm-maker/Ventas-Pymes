successfully downloaded text file (SHA: 83d1a17599f226122569e29adcf584b5e3e87b52)
-- ============================================================
-- Mi Socio Pyme · 0027 · Niveles de plan (Socio · Socio Pro · Socio Pro Max · A medida)
-- Dos ejes que se combinan:
--   - empresas.plan  (0025, «membresía»): cómo paga → prueba / mensual / anual / dueño.
--   - empresas.nivel (nuevo): qué funciones y cuánto → s / m / l / medida.
-- Cada nivel estándar (tabla niveles_plan) define módulos, plan del asistente, topes de
-- productos / locales / usuarios, si los reportes son completos y si se pueden dar permisos
-- por usuario. «medida» toma los topes de la propia empresa (max_*; null = sin límite).
-- nivel null = empresa anterior a esta migración: sin topes (no cambia nada para ella).
-- Reglas:
--   - Los topes se controlan en la base (triggers): no se puede crear ni reactivar sobre el
--     tope. Lo que ya existe sobre el tope NO se borra.
--   - El plan anual es siempre Socio Pro Max (nivel l).
--   - Solo el administrador general (Edge Function admin-users) cambia nivel y topes.
--   - El plan manda: con Socio / Socio Pro / Socio Pro Max los módulos y el asistente salen
--     del nivel (cambiar el rubro los recalcula). Solo «medida» se ajusta a mano.
--   - Cupos del asistente: Básico 8 · Pro 40 · Max 150 mensajes al día (empresa).
--   - Precios: los de Socio / Socio Pro / Socio Pro Max viven en niveles_plan (los edita el
--     administrador general desde la consola); el de «medida» es el cotizado de cada empresa
--     (empresas.precio_medida). Son de referencia: el cobro sigue registrándose a mano.
-- ============================================================

-- ---------------- Asistente: cupos nuevos (el gancho para subir de plan) ----------------
update public.planes_ia set mensajes_dia_empresa = 8,   mensajes_dia_usuario = null where plan = 'basico';
update public.planes_ia set mensajes_dia_empresa = 40,  mensajes_dia_usuario = null where plan = 'pro';
update public.planes_ia set mensajes_dia_empresa = 150, mensajes_dia_usuario = null where plan = 'max';

-- ---------------- Niveles ----------------
create table if not exists public.niveles_plan (
  nivel text primary key check (nivel in ('s', 'm', 'l')),
  nombre text not null,
  precio_mensual integer not null check (precio_mensual >= 0),
  -- null = el nivel no se vende anual
  precio_anual integer check (precio_anual is null or precio_anual >= 0),
  modulos text[] not null,
  plan_ia text references public.planes_ia(plan) on update cascade,
  max_productos integer check (max_productos is null or max_productos >= 1),
  max_ubicaciones integer check (max_ubicaciones is null or max_ubicaciones >= 1),
  max_usuarios integer check (max_usuarios is null or max_usuarios >= 1),
  reportes_completos boolean not null,
  permisos_a_medida boolean not null,
  orden integer not null
);

insert into public.niveles_plan
  (nivel, nombre, precio_mensual, modulos, plan_ia, max_productos, max_ubicaciones, max_usuarios,
   reportes_completos, permisos_a_medida, orden)
values
  ('s', 'Socio', 10000,
   array['dashboard','pos','salidas','ingreso','inventario','productos','bodega','movimientos','reportes','usuarios','configuracion'],
   'basico', 200, 2, 3, false, false, 1),
  ('m', 'Socio Pro', 20000,
   array['dashboard','pos','mesas','cocina','salidas','ingreso','inventario','productos','bodega','movimientos','reportes','usuarios','configuracion'],
   'pro', 2000, 5, 8, true, true, 2),
  ('l', 'Socio Pro Max', 30000,
   array['dashboard','pos','mesas','cocina','salidas','ingreso','inventario','productos','bodega','movimientos','reportes','usuarios','configuracion'],
   'max', null, null, null, true, true, 3)
on conflict (nivel) do nothing;
alter table public.niveles_plan add column if not exists precio_anual integer
  check (precio_anual is null or precio_anual >= 0);
update public.niveles_plan set precio_anual = 330000 where nivel = 'l' and precio_anual is null;

alter table public.niveles_plan enable row level security;
-- Todos los usuarios activos los leen (la app muestra topes y el plan siguiente); nadie los escribe
drop policy if exists niveles_plan_select on public.niveles_plan;
create policy niveles_plan_select on public.niveles_plan for select to authenticated using (true);
revoke insert, update, delete on public.niveles_plan from anon, authenticated;

-- ---------------- Columnas de la empresa ----------------
alter table public.empresas
  add column if not exists nivel text,
  add column if not exists max_productos integer,
  add column if not exists max_ubicaciones integer,
  add column if not exists max_usuarios integer,
  -- Precio mensual cotizado de un plan «A medida» (CLP); null en los niveles estándar
  add column if not exists precio_medida integer;
alter table public.empresas drop constraint if exists empresas_precio_medida_check;
alter table public.empresas
  add constraint empresas_precio_medida_check check (precio_medida is null or precio_medida >= 0);

alter table public.empresas drop constraint if exists empresas_nivel_check;
alter table public.empresas
  add constraint empresas_nivel_check check (nivel is null or nivel in ('s', 'm', 'l', 'medida'));
alter table public.empresas drop constraint if exists empresas_max_check;
alter table public.empresas
  add constraint empresas_max_check check (
    (max_productos is null or max_productos >= 1)
    and (max_ubicaciones is null or max_ubicaciones >= 1)
    and (max_usuarios is null or max_usuarios >= 1));
-- El plan anual es siempre Socio Pro Max
alter table public.empresas drop constraint if exists empresas_anual_nivel_check;
alter table public.empresas
  add constraint empresas_anual_nivel_check check (plan <> 'anual' or nivel = 'l');

-- ---------------- Topes vigentes de una empresa ----------------
-- Nivel estándar → valores de niveles_plan. «medida» → columnas max_* de la empresa con
-- reportes y permisos completos. Sin nivel → sin topes.
create or replace function public._topes_empresa(p_emp uuid)
returns table (nivel text, nombre text, max_productos integer, max_ubicaciones integer,
               max_usuarios integer, reportes_completos boolean, permisos_a_medida boolean)
language sql stable security definer set search_path = public as $$
  select e.nivel,
         case when e.nivel = 'medida' then 'A medida' else n.nombre end,
         case when e.nivel = 'medida' then e.max_productos else n.max_productos end,
         case when e.nivel = 'medida' then e.max_ubicaciones else n.max_ubicaciones end,
         case when e.nivel = 'medida' then e.max_usuarios else n.max_usuarios end,
         coalesce(n.reportes_completos, true),
         coalesce(n.permisos_a_medida, true)
    from public.empresas e
    left join public.niveles_plan n on n.nivel = e.nivel
   where e.id = p_emp;
$$;
revoke execute on function public._topes_empresa(uuid) from public, anon, authenticated;
grant execute on function public._topes_empresa(uuid) to service_role;

-- Módulos de un nivel según el rubro (retail no lleva mesas ni cocina; igual que modulosPorRubro)
create or replace function public._modulos_nivel(p_nivel text, p_rubro text)
returns text[] language sql stable security definer set search_path = public as $$
  select array(
    select m from unnest(n.modulos) m
     where coalesce(p_rubro, 'retail') <> 'retail' or m not in ('mesas', 'cocina'))
    from public.niveles_plan n where n.nivel = p_nivel;
$$;
revoke execute on function public._modulos_nivel(text, text) from public, anon, authenticated;
grant execute on function public._modulos_nivel(text, text) to service_role;

-- ---------------- Control de topes (triggers) ----------------
create or replace function public._error_tope(p_nombre text, p_tope integer, p_que text, p_recurso text)
returns void language plpgsql as $$
begin
  raise exception 'Tu plan % permite hasta % %. Para agregar más, sube de plan.', p_nombre, p_tope, p_que
    using errcode = 'P0001', hint = 'tope_plan:' || p_recurso;
end $$;

create or replace function public.controlar_tope_productos()
returns trigger language plpgsql security definer set search_path = public as $$
declare t record; v_n integer;
begin
  if not new.activo then return new; end if;
  if tg_op = 'UPDATE' and old.activo and old.empresa_id = new.empresa_id then return new; end if;
  select * into t from public._topes_empresa(new.empresa_id);
  if t.max_productos is null then return new; end if;
  -- Serializa altas simultáneas de la misma empresa
  perform pg_advisory_xact_lock(hashtextextended('tope_productos:' || new.empresa_id::text, 0));
  select count(*) into v_n from public.productos
   where empresa_id = new.empresa_id and activo and id <> new.id;
  if v_n >= t.max_productos then
    perform public._error_tope(t.nombre, t.max_productos, 'productos', 'productos');
  end if;
  return new;
end $$;

drop trigger if exists trg_tope_productos on public.productos;
create trigger trg_tope_productos before insert or update of activo, empresa_id on public.productos
  for each row execute function public.controlar_tope_productos();

create or replace function public.controlar_tope_ubicaciones()
returns trigger language plpgsql security definer set search_path = public as $$
declare t record; v_n integer;
begin
  if not new.activa then return new; end if;
  if tg_op = 'UPDATE' and old.activa and old.empresa_id = new.empresa_id then return new; end if;
  select * into t from public._topes_empresa(new.empresa_id);
  if t.max_ubicaciones is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('tope_ubicaciones:' || new.empresa_id::text, 0));
  select count(*) into v_n from public.ubicaciones
   where empresa_id = new.empresa_id and activa and id <> new.id;
  if v_n >= t.max_ubicaciones then
    perform public._error_tope(t.nombre, t.max_ubicaciones,
      case when t.max_ubicaciones = 1 then 'local' else 'locales' end, 'ubicaciones');
  end if;
  return new;
end $$;

drop trigger if exists trg_tope_ubicaciones on public.ubicaciones;
create trigger trg_tope_ubicaciones before insert or update of activa, empresa_id on public.ubicaciones
  for each row execute function public.controlar_tope_ubicaciones();

-- Usuarios: cuentan las cuentas activas de la empresa (el administrador general no cuenta).
-- Permisos por usuario: si el nivel no los incluye, solo valen los del puesto.
create or replace function public.controlar_tope_usuarios()
returns trigger language plpgsql security definer set search_path = public as $$
declare t record; v_n integer; v_alta boolean;
begin
  if new.empresa_id is null or new.es_owner then return new; end if;
  select * into t from public._topes_empresa(new.empresa_id);
  if t.nivel is null then return new; end if;

  if not t.permisos_a_medida and coalesce(new.permissions, '{}'::jsonb) <> '{}'::jsonb
     and (tg_op = 'INSERT' or new.permissions is distinct from old.permissions
          or new.empresa_id is distinct from old.empresa_id) then
    raise exception 'Tu plan % no incluye permisos a medida por usuario: se usan los del puesto. Para ajustarlos, sube de plan.', t.nombre
      using errcode = 'P0001', hint = 'tope_plan:permisos';
  end if;

  v_alta := new.activo and (tg_op = 'INSERT' or not old.activo or old.es_owner
                            or new.empresa_id is distinct from old.empresa_id);
  if v_alta and t.max_usuarios is not null then
    perform pg_advisory_xact_lock(hashtextextended('tope_usuarios:' || new.empresa_id::text, 0));
    select count(*) into v_n from public.profiles
     where empresa_id = new.empresa_id and activo and not es_owner and id <> new.id;
    if v_n >= t.max_usuarios then
      perform public._error_tope(t.nombre, t.max_usuarios,
        case when t.max_usuarios = 1 then 'usuario' else 'usuarios' end, 'usuarios');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_tope_usuarios on public.profiles;
create trigger trg_tope_usuarios before insert or update of activo, empresa_id, es_owner, permissions on public.profiles
  for each row execute function public.controlar_tope_usuarios();

-- ---------------- Plan anual = Socio Pro Max ----------------
-- Al pasar a anual se aplica el nivel l (módulos y asistente). Con anual no se puede bajar de nivel
-- (lo impide empresas_anual_nivel_check).
create or replace function public.anual_es_pro_max()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.plan = 'anual' and (tg_op = 'INSERT' or old.plan is distinct from 'anual') then
    new.nivel := 'l';
    new.modulos := public._modulos_nivel('l', new.tipo_negocio);
    new.plan_ia := (select plan_ia from public.niveles_plan where nivel = 'l');
    new.max_productos := null; new.max_ubicaciones := null; new.max_usuarios := null;
    new.precio_medida := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_anual_es_pro_max on public.empresas;
create trigger trg_anual_es_pro_max before insert or update of plan on public.empresas
  for each row execute function public.anual_es_pro_max();

-- ---------------- Aplicar un nivel (Edge Function, a pedido del administrador general) ----------------
-- Estándar: copia módulos (según rubro) y asistente del nivel, y borra los topes propios.
-- «medida»: deja módulos y asistente como están y fija los topes indicados (null = sin límite).
drop function if exists public.aplicar_nivel(uuid, text, integer, integer, integer);
create or replace function public.aplicar_nivel(
  p_empresa uuid, p_nivel text,
  p_max_productos integer default null, p_max_ubicaciones integer default null, p_max_usuarios integer default null,
  p_precio integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.empresas;
begin
  select * into e from public.empresas where id = p_empresa for update;
  if not found then raise exception 'Empresa inexistente'; end if;
  if p_nivel not in ('s', 'm', 'l', 'medida') then raise exception 'Nivel inválido'; end if;
  if e.plan = 'anual' and p_nivel <> 'l' then
    raise exception 'El plan anual es siempre Socio Pro Max. Cambia primero la membresía.';
  end if;

  if p_nivel = 'medida' then
    update public.empresas
       set nivel = 'medida', max_productos = p_max_productos,
           max_ubicaciones = p_max_ubicaciones, max_usuarios = p_max_usuarios,
           precio_medida = p_precio
     where id = p_empresa;
  else
    update public.empresas
       set nivel = p_nivel,
           modulos = public._modulos_nivel(p_nivel, e.tipo_negocio),
           plan_ia = (select plan_ia from public.niveles_plan where nivel = p_nivel),
           max_productos = null, max_ubicaciones = null, max_usuarios = null,
           precio_medida = null
     where id = p_empresa;
  end if;
  return (select to_jsonb(x) from public._topes_empresa(p_empresa) x);
end $$;
revoke execute on function public.aplicar_nivel(uuid, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.aplicar_nivel(uuid, text, integer, integer, integer, integer) to service_role;

-- ---------------- Crear un plan «A medida» de una vez (Edge Function, administrador general) ----------------
-- Fija nivel, módulos, asistente, topes (null = sin límite) y precio cotizado en una sola transacción.
create or replace function public.aplicar_a_medida(
  p_empresa uuid, p_modulos text[], p_plan_ia text,
  p_max_productos integer, p_max_ubicaciones integer, p_max_usuarios integer, p_precio integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.empresas;
begin
  select * into e from public.empresas where id = p_empresa for update;
  if not found then raise exception 'Empresa inexistente'; end if;
  if e.plan = 'anual' then
    raise exception 'El plan anual es siempre Socio Pro Max. Cambia primero la membresía.';
  end if;
  if p_modulos is null or cardinality(p_modulos) = 0 then raise exception 'Deja al menos un módulo'; end if;
  if p_precio is null or p_precio < 0 then raise exception 'Indica el precio mensual cotizado'; end if;
  if p_plan_ia is not null and not exists (select 1 from public.planes_ia where plan = p_plan_ia) then
    raise exception 'Plan de asistente inválido';
  end if;
  update public.empresas
     set nivel = 'medida', modulos = p_modulos, plan_ia = p_plan_ia,
         max_productos = p_max_productos, max_ubicaciones = p_max_ubicaciones,
         max_usuarios = p_max_usuarios, precio_medida = p_precio
   where id = p_empresa;
  return (select to_jsonb(x) from public._topes_empresa(p_empresa) x);
end $$;

revoke execute on function public.aplicar_a_medida(uuid, text[], text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.aplicar_a_medida(uuid, text[], text, integer, integer, integer, integer) to service_role;

-- ---------------- Cambiar el rubro (Edge Function, a pedido del administrador general) ----------------
-- El plan manda: con un nivel estándar los módulos se recalculan del nivel para el rubro nuevo.
-- Con «medida» o sin nivel se conservan los módulos y solo se suman o quitan Mesas y Cocina
-- (igual que modulosPorRubro en la app).
create or replace function public.cambiar_rubro(p_empresa uuid, p_rubro text)
returns text[] language plpgsql security definer set search_path = public as $$
declare e public.empresas; v_mod text[];
begin
  if p_rubro is null or p_rubro not in ('retail', 'restaurante', 'mixto') then
    raise exception 'Rubro inválido';
  end if;
  select * into e from public.empresas where id = p_empresa for update;
  if not found then raise exception 'Empresa inexistente'; end if;
  if e.nivel in ('s', 'm', 'l') then
    v_mod := public._modulos_nivel(e.nivel, p_rubro);
  else
    v_mod := array(select m from unnest(e.modulos) m where m not in ('mesas', 'cocina'));
    if p_rubro <> 'retail' then v_mod := v_mod || array['mesas', 'cocina']; end if;
  end if;
  update public.empresas set tipo_negocio = p_rubro, modulos = v_mod where id = p_empresa;
  return v_mod;
end $$;
revoke execute on function public.cambiar_rubro(uuid, text) from public, anon, authenticated;
grant execute on function public.cambiar_rubro(uuid, text) to service_role;

-- ---------------- Uso del plan (para medidores y avisos en la app) ----------------
create or replace function public.uso_plan()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.mi_empresa(); t record; v_sig record;
begin
  if v_emp is null or not public.es_activo() then return null; end if;
  select * into t from public._topes_empresa(v_emp);
  select n.nivel, n.nombre into v_sig from public.niveles_plan n
   where n.orden > coalesce((select orden from public.niveles_plan where nivel = t.nivel), 99)
   order by n.orden limit 1;
  return jsonb_build_object(
    'nivel', t.nivel,
    'nombre', t.nombre,
    'reportes_completos', t.reportes_completos,
    'permisos_a_medida', t.permisos_a_medida,
    'siguiente', case when v_sig.nivel is null then null
                      else jsonb_build_object('nivel', v_sig.nivel, 'nombre', v_sig.nombre) end,
    'productos', jsonb_build_object('usados',
       (select count(*) from public.productos where empresa_id = v_emp and activo), 'tope', t.max_productos),
    'ubicaciones', jsonb_build_object('usados',
       (select count(*) from public.ubicaciones where empresa_id = v_emp and activa), 'tope', t.max_ubicaciones),
    'usuarios', jsonb_build_object('usados',
       (select count(*) from public.profiles where empresa_id = v_emp and activo and not es_owner), 'tope', t.max_usuarios));
end $$;
revoke execute on function public.uso_plan() from public, anon;
grant execute on function public.uso_plan() to authenticated, service_role;

-- ---------------- proteger_empresa (igual que 0025 + nivel y topes) ----------------
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
     or new.plan_ia is distinct from old.plan_ia
     or new.nivel is distinct from old.nivel
     or new.max_productos is distinct from old.max_productos
     or new.max_ubicaciones is distinct from old.max_ubicaciones
     or new.max_usuarios is distinct from old.max_usuarios
     or new.precio_medida is distinct from old.precio_medida then
    raise exception 'Solo el administrador general puede cambiar plan, nivel, topes, vencimiento, avisos, rubro, módulos o asistente';
  end if;
  if not public.es_admin_empresa(old.id) then
    raise exception 'No autorizado sobre esta empresa';
  end if;
  return new;
end $$;

-- ---------------- Asistente: mensaje del tope con el nombre del plan (igual que 0026) ----------------
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
  v_nivel text;
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
  -- Nombre comercial del plan (Socio, Socio Pro…); sin nivel se usa el del asistente
  v_nivel := coalesce((select nombre from public._topes_empresa(e.id)), pl.nombre);
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
                       pl.mensajes_dia_empresa, v_nivel);
  end if;

  return jsonb_build_object(
    'permitido', v_motivo is null,
    'motivo', v_motivo,
    'empresa_id', e.id,
    'plan', pl.plan,
    'plan_nombre', v_nivel,
    'nivel', e.nivel,
    'usados_usuario', v_nu,
    'tope_usuario', pl.mensajes_dia_usuario,
    'usados_empresa', v_ne,
    'tope_empresa', pl.mensajes_dia_empresa);
end $$;

revoke execute on function public._estado_ia(uuid) from public, anon, authenticated;
