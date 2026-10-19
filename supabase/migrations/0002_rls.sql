-- ============================================================
-- Mi Socio Pyme · 0002 · Funciones helper, triggers y RLS
-- ============================================================

-- ---------------- Helpers (SECURITY DEFINER + search_path fijo) -------------
create or replace function public.mi_empresa()
returns uuid language sql stable security definer set search_path = public as $$
  select empresa_id from public.profiles where id = auth.uid();
$$;

create or replace function public.es_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select es_owner from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.es_activo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select activo from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.es_admin_empresa(e uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select (p.role = 'admin' and p.empresa_id = e) or p.es_owner
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

create or replace function public.tiene_modulo(m text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select m = any(e.modulos) from public.empresas e where e.id = public.mi_empresa()
  ), false);
$$;

create or replace function public.puede_ver_ubicacion(u uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.es_owner() then exists (select 1 from public.ubicaciones where id = u)
    else exists (
      select 1 from public.ubicaciones ub
      where ub.id = u
        and ub.empresa_id = public.mi_empresa()
        and (
          not exists (select 1 from public.ubicacion_acceso a where a.user_id = auth.uid())
          or exists (select 1 from public.ubicacion_acceso a
                     where a.user_id = auth.uid() and a.ubicacion_id = u)
        )
    )
  end;
$$;

-- ---------------- Trigger: crear perfil al alta de usuario (auth.users) -----
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nombre)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------- Triggers anti-escalación --------------------------------
create or replace function public.proteger_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
declare rol text := current_setting('request.jwt.claim.role', true);
begin
  if rol = 'service_role' or public.es_owner() then
    return new;
  end if;
  if new.es_owner is distinct from old.es_owner then
    raise exception 'No autorizado para cambiar es_owner';
  end if;
  if new.empresa_id is distinct from old.empresa_id then
    raise exception 'No autorizado para cambiar la empresa del usuario';
  end if;
  if new.id = auth.uid() and new.role is distinct from old.role then
    raise exception 'No autorizado para cambiar el propio rol';
  end if;
  return new;
end $$;

drop trigger if exists trg_proteger_perfil on public.profiles;
create trigger trg_proteger_perfil
  before update on public.profiles
  for each row execute function public.proteger_perfil();

create or replace function public.proteger_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare rol text := current_setting('request.jwt.claim.role', true);
begin
  if rol = 'service_role' or public.es_owner() then
    return new;
  end if;
  if new.plan is distinct from old.plan
     or new.prueba_hasta is distinct from old.prueba_hasta
     or new.modulos is distinct from old.modulos then
    raise exception 'Solo el administrador general puede cambiar plan, prueba o módulos';
  end if;
  if not public.es_admin_empresa(old.id) then
    raise exception 'No autorizado sobre esta empresa';
  end if;
  return new;
end $$;

drop trigger if exists trg_proteger_empresa on public.empresas;
create trigger trg_proteger_empresa
  before update on public.empresas
  for each row execute function public.proteger_empresa();

create or replace function public.validar_ubicacion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.ubicaciones where id = new.parent_id and empresa_id = new.empresa_id
  ) then
    raise exception 'La ubicación padre debe pertenecer a la misma empresa';
  end if;
  return new;
end $$;

drop trigger if exists trg_validar_ubicacion on public.ubicaciones;
create trigger trg_validar_ubicacion
  before insert or update on public.ubicaciones
  for each row execute function public.validar_ubicacion();

-- ---------------- RLS: activar en todas las tablas ------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'plataforma','empresas','profiles','ubicaciones','categorias','unidades_medida',
    'productos','producto_variantes','proveedores','motivos_salida','stock',
    'movimientos','recepciones','recepcion_items','transferencias',
    'transferencia_items','ventas','venta_items','vouchers','ubicacion_acceso',
    'admin_auditoria'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- Tablas con empresa_id directo: política tenant estándar
do $$
declare t text;
begin
  foreach t in array array[
    'ubicaciones','categorias','unidades_medida','productos','producto_variantes',
    'proveedores','motivos_salida','stock','movimientos','recepciones',
    'transferencias','ventas','vouchers','ubicacion_acceso'
  ]
  loop
    execute format('drop policy if exists tenant_rw on public.%I;', t);
    execute format($f$
      create policy tenant_rw on public.%I
      for all
      using (empresa_id = public.mi_empresa() or public.es_owner())
      with check (empresa_id = public.mi_empresa() or public.es_owner());
    $f$, t);
  end loop;
end $$;

-- Tablas hijas: acceso a través del padre
drop policy if exists tenant_rw on public.recepcion_items;
create policy tenant_rw on public.recepcion_items for all
  using (exists (select 1 from public.recepciones r
                 where r.id = recepcion_id
                   and (r.empresa_id = public.mi_empresa() or public.es_owner())))
  with check (exists (select 1 from public.recepciones r
                 where r.id = recepcion_id
                   and (r.empresa_id = public.mi_empresa() or public.es_owner())));

drop policy if exists tenant_rw on public.transferencia_items;
create policy tenant_rw on public.transferencia_items for all
  using (exists (select 1 from public.transferencias t
                 where t.id = transferencia_id
                   and (t.empresa_id = public.mi_empresa() or public.es_owner())))
  with check (exists (select 1 from public.transferencias t
                 where t.id = transferencia_id
                   and (t.empresa_id = public.mi_empresa() or public.es_owner())));

drop policy if exists tenant_rw on public.venta_items;
create policy tenant_rw on public.venta_items for all
  using (exists (select 1 from public.ventas v
                 where v.id = venta_id
                   and (v.empresa_id = public.mi_empresa() or public.es_owner())))
  with check (exists (select 1 from public.ventas v
                 where v.id = venta_id
                   and (v.empresa_id = public.mi_empresa() or public.es_owner())));

-- empresas
drop policy if exists empresas_select on public.empresas;
create policy empresas_select on public.empresas for select
  using (id = public.mi_empresa() or public.es_owner());
drop policy if exists empresas_update on public.empresas;
create policy empresas_update on public.empresas for update
  using (public.es_admin_empresa(id) or public.es_owner())
  with check (public.es_admin_empresa(id) or public.es_owner());
drop policy if exists empresas_insert on public.empresas;
create policy empresas_insert on public.empresas for insert
  with check (public.es_owner());

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or empresa_id = public.mi_empresa() or public.es_owner());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid() or public.es_admin_empresa(empresa_id) or public.es_owner())
  with check (id = auth.uid() or public.es_admin_empresa(empresa_id) or public.es_owner());

-- plataforma (lectura para autenticados; escritura solo owner)
drop policy if exists plataforma_select on public.plataforma;
create policy plataforma_select on public.plataforma for select
  using (auth.uid() is not null);
drop policy if exists plataforma_update on public.plataforma;
create policy plataforma_update on public.plataforma for update
  using (public.es_owner()) with check (public.es_owner());

-- admin_auditoria: solo service_role (sin políticas + revoke)
revoke all on public.admin_auditoria from anon, authenticated;

-- ---------------- Privilegios de funciones ---------------------------------
revoke execute on function public.mi_empresa() from anon, public;
revoke execute on function public.es_owner() from anon, public;
revoke execute on function public.es_activo() from anon, public;
revoke execute on function public.es_admin_empresa(uuid) from anon, public;
revoke execute on function public.tiene_modulo(text) from anon, public;
revoke execute on function public.puede_ver_ubicacion(uuid) from anon, public;

grant execute on function public.mi_empresa() to authenticated, service_role;
grant execute on function public.es_owner() to authenticated, service_role;
grant execute on function public.es_activo() to authenticated, service_role;
grant execute on function public.es_admin_empresa(uuid) to authenticated, service_role;
grant execute on function public.tiene_modulo(text) to authenticated, service_role;
grant execute on function public.puede_ver_ubicacion(uuid) to authenticated, service_role;
