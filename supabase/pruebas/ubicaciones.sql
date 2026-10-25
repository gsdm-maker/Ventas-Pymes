-- ============================================================
-- Mi Socio Pyme · Pruebas: desactivar tiendas y bodegas (0021) — se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/ubicaciones.sql
-- Usuarios: {{USUARIO_TIENDA}} (puesto tienda) · {{USUARIO_ADMIN}} (admin de empresa)
-- ZZ Vacía: ubicación nueva sin stock ni movimientos.
-- ============================================================
create temp table zz_resultados (n serial, caso text, esperado text, obtenido text);

create function pg_temp.probar(p_caso text, p_usuario text, p_esperado text, p_sql text, p_prep text default null)
returns void language plpgsql as $$
declare v text; v_uid uuid;
begin
  begin
    if p_prep is not null then execute p_prep; end if;
    select id into v_uid from public.profiles where email = p_usuario;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute p_sql into v;
    raise exception using errcode = 'ZZ999', message = 'OK ' || coalesce(v, '-');
  exception when others then
    v := case when sqlstate = 'ZZ999' then sqlerrm else 'ERROR ' || sqlstate || ': ' || sqlerrm end;
  end;
  insert into zz_resultados (caso, esperado, obtenido) values (p_caso, p_esperado, v);
end $$;

-- ---------------- Preparación (se revierte) ----------------
insert into public.ubicaciones (empresa_id, nombre, tipo)
select empresa_id, 'ZZ Vacía', 'tienda' from public.profiles where email = '{{USUARIO_ADMIN}}';

create temp table zz_ctx as
select p.empresa_id as emp,
       (select id from public.profiles where email = '{{USUARIO_TIENDA}}') as juan_id,
       p.id as admin_id,
       (select id from public.ubicaciones where nombre = 'ZZ Vacía' and empresa_id = p.empresa_id) as vacia,
       (select s.ubicacion_id from public.stock s join public.productos pr on pr.id = s.producto_id and pr.controla_stock
         where s.empresa_id = p.empresa_id and s.disponible > 0 group by 1 order by sum(s.disponible) desc limit 1) as con_stock,
       (select id from public.ubicaciones u where u.empresa_id = p.empresa_id and u.activa and u.nombre <> 'ZZ Vacía'
         order by nombre limit 1) as otra
  from public.profiles p where p.email = '{{USUARIO_ADMIN}}';
grant select on zz_ctx to authenticated;

-- ---------------- Casos ----------------
select pg_temp.probar('admin borra una ubicación', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with d as (delete from public.ubicaciones where id = (select vacia from zz_ctx) returning 1) select count(*)::text from d $q$);
select pg_temp.probar('admin desactiva ubicación vacía', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with u as (update public.ubicaciones set activa = false where id = (select vacia from zz_ctx) returning 1) select count(*)::text from u $q$);
select pg_temp.probar('admin desactiva ubicación con stock', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.ubicaciones set activa = false where id = (select con_stock from zz_ctx) returning 1) select count(*)::text from u $q$);
select pg_temp.probar('admin desactiva ubicación con transferencia en tránsito', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.ubicaciones set activa = false where id = (select vacia from zz_ctx) returning 1) select count(*)::text from u $q$,
  $p$ insert into public.transferencias (empresa_id, folio, origen_id, destino_id, estado)
      select emp, 'ZZ-TRF-1', otra, vacia, 'en_transito' from zz_ctx $p$);
select pg_temp.probar('admin desactiva ubicación con cuenta de mesa abierta', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.ubicaciones set activa = false where id = (select vacia from zz_ctx) returning 1) select count(*)::text from u $q$,
  $p$ insert into public.mesas (empresa_id, ubicacion_id, nombre) select emp, vacia, 'ZZ Mesa' from zz_ctx;
      insert into public.cuentas (empresa_id, ubicacion_id, mesa_id, garzon_id)
      select c.emp, c.vacia, m.id, c.admin_id from zz_ctx c join public.mesas m on m.nombre = 'ZZ Mesa' and m.ubicacion_id = c.vacia $p$);
select pg_temp.probar('no se desactiva la última ubicación activa', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.ubicaciones set activa = false where id = (select vacia from zz_ctx) returning 1) select count(*)::text from u $q$,
  $p$ alter table public.ubicaciones disable trigger trg_validar_desactivar_ubicacion;
      update public.ubicaciones set activa = false where empresa_id = (select emp from zz_ctx) and id <> (select vacia from zz_ctx);
      alter table public.ubicaciones enable trigger trg_validar_desactivar_ubicacion $p$);
select pg_temp.probar('admin reactiva una ubicación', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with u as (update public.ubicaciones set activa = true where id = (select vacia from zz_ctx) returning 1) select count(*)::text from u $q$,
  $p$ update public.ubicaciones set activa = false where id = (select vacia from zz_ctx) $p$);
select pg_temp.probar('juan (tienda) desactiva una ubicación', '{{USUARIO_TIENDA}}', 'OK 0',
  $q$ with u as (update public.ubicaciones set activa = false where id = (select vacia from zz_ctx) returning 1) select count(*)::text from u $q$,
  $p$ insert into public.ubicacion_acceso (user_id, ubicacion_id, empresa_id) select juan_id, vacia, emp from zz_ctx $p$);
select pg_temp.probar('asignado solo a una ubicación desactivada no ve las demás', '{{USUARIO_TIENDA}}', 'OK 0 activas · otra visible: false',
  $q$ select (select count(*) from public.ubicaciones where activa) || ' activas · otra visible: ' || public.puede_ver_ubicacion((select otra from zz_ctx)) $q$,
  $p$ delete from public.ubicacion_acceso where user_id = (select juan_id from zz_ctx);
      insert into public.ubicacion_acceso (user_id, ubicacion_id, empresa_id) select juan_id, vacia, emp from zz_ctx;
      update public.ubicaciones set activa = false where id = (select vacia from zz_ctx) $p$);
select pg_temp.probar('ubicación desactivada no acepta ventas', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ select folio from public.registrar_venta((select vacia from zz_ctx),
        jsonb_build_array(jsonb_build_object('producto_id', (select id from public.productos where empresa_id = (select emp from zz_ctx) and activo limit 1), 'cantidad', 1)),
        'monto', 0, 'efectivo', null) $q$,
  $p$ update public.ubicaciones set activa = false where id = (select vacia from zz_ctx) $p$);

-- Resultado (aborta la transacción: nada queda guardado)
do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
