-- ============================================================
-- Mi Socio Pyme · 0015 · Tallas y colores opcionales por empresa
-- - empresas.usa_variantes: si está apagado no se pueden crear variantes y el
--   sistema trabaja con un solo stock por producto (como antes).
-- - No se puede apagar mientras haya variantes activas, ni desactivar una
--   variante que aún tiene stock (quedaría mercadería invisible).
-- ============================================================

alter table public.empresas add column if not exists usa_variantes boolean not null default false;

-- Igual que proteger_perfil (0010): sin JWT = conexión directa (migraciones, SQL Editor),
-- confiable. Antes bloqueaba los update de migraciones sobre empresas.
create or replace function public.proteger_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare rol text := coalesce(auth.role(), '');
begin
  if rol in ('service_role', '') or public.es_owner() then
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

-- Las empresas que ya usan variantes quedan con la opción encendida
update public.empresas e set usa_variantes = true
 where exists (select 1 from public.producto_variantes pv where pv.empresa_id = e.id and pv.activa);

create or replace function public.empresa_usa_variantes(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select usa_variantes from public.empresas where id = p_empresa), false);
$$;
revoke execute on function public.empresa_usa_variantes(uuid) from public, anon;
grant execute on function public.empresa_usa_variantes(uuid) to authenticated, service_role;

-- Crear variantes solo si la empresa las usa
drop policy if exists tenant_insert on public.producto_variantes;
create policy tenant_insert on public.producto_variantes for insert
  with check (public.puede_escribir(empresa_id, array['productos.gestionar'])
              and public.empresa_usa_variantes(empresa_id));

-- Con la opción apagada no se exige variante
create or replace function public._exigir_variante(p_prod uuid, p_var uuid, p_ubi uuid, p_permitir_legado boolean)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_var is not null then return; end if;
  if not public.empresa_usa_variantes((select empresa_id from public.productos where id = p_prod)) then return; end if;
  if not exists (select 1 from public.producto_variantes where producto_id = p_prod and activa) then return; end if;
  if p_permitir_legado and exists (
    select 1 from public.stock where producto_id = p_prod and variante_id is null and ubicacion_id = p_ubi and disponible > 0
  ) then return; end if;
  raise exception 'Elige la talla o color de %', (select nombre from public.productos where id = p_prod);
end $$;
revoke execute on function public._exigir_variante(uuid, uuid, uuid, boolean) from public, anon, authenticated;

-- No apagar la opción con variantes activas
create or replace function public.validar_usa_variantes()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if old.usa_variantes and not new.usa_variantes then
    select count(distinct producto_id) into n from public.producto_variantes where empresa_id = new.id and activa;
    if n > 0 then
      raise exception 'Hay % producto(s) con tallas o colores activos: desactívalos antes de apagar esta opción', n;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_validar_usa_variantes on public.empresas;
create trigger trg_validar_usa_variantes
  before update of usa_variantes on public.empresas
  for each row execute function public.validar_usa_variantes();

-- No desactivar una variante que todavía tiene stock
create or replace function public.validar_desactivar_variante()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if old.activa and not new.activa then
    select coalesce(sum(disponible + reservado + transito), 0) into n from public.stock where variante_id = new.id;
    if n > 0 then
      raise exception 'La variante % aún tiene % u. en stock: véndelas o transfiérelas antes de desactivarla',
        nullif(concat_ws(' · ', new.talla, new.color, new.modelo), ''), n;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_validar_desactivar_variante on public.producto_variantes;
create trigger trg_validar_desactivar_variante
  before update of activa on public.producto_variantes
  for each row execute function public.validar_desactivar_variante();
