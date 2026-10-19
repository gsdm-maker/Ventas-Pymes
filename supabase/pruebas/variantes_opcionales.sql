-- ============================================================
-- Mi Socio Pyme · Pruebas: tallas y colores opcionales por empresa — se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/variantes_opcionales.sql
-- Empresa demo (admin de prueba): tiene variantes activas con stock (ROP-*).
-- ============================================================
create temp table zz_resultados (n serial, caso text, esperado text, obtenido text);

create function pg_temp.probar(p_caso text, p_usuario text, p_esperado text, p_sql text, p_prep text default null)
returns void language plpgsql as $$
declare v text; v_uid uuid;
begin
  begin
    if p_prep is not null then execute p_prep; end if;
    select id into v_uid from public.profiles where email = p_usuario;
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute p_sql into v;
    raise exception using errcode = 'ZZ999', message = 'OK ' || coalesce(v, '-');
  exception when others then
    v := case when sqlstate = 'ZZ999' then sqlerrm else 'ERROR ' || sqlstate || ': ' || sqlerrm end;
  end;
  insert into zz_resultados (caso, esperado, obtenido) values (p_caso, p_esperado, v);
end $$;

-- Preparación común: apaga todas las variantes de la demo (como superusuario, sin triggers de stock)
create function pg_temp.sin_variantes() returns void language plpgsql as $$
begin
  alter table public.producto_variantes disable trigger trg_validar_desactivar_variante;
  update public.producto_variantes set activa = false
   where empresa_id = (select empresa_id from public.profiles where email = '{{USUARIO_ADMIN}}');
  alter table public.producto_variantes enable trigger trg_validar_desactivar_variante;
end $$;

select pg_temp.probar('la demo quedó con la opción encendida', '{{USUARIO_ADMIN}}', 'OK true',
  $q$ select usa_variantes::text from public.empresas where id = public.mi_empresa() $q$);
select pg_temp.probar('no se apaga con variantes activas', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.empresas set usa_variantes = false where id = public.mi_empresa() returning 1) select count(*)::text from u $q$);
select pg_temp.probar('no se desactiva una talla con stock', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.producto_variantes set activa = false
                  where id = (select variante_id from public.stock where variante_id is not null and disponible > 0 limit 1) returning 1)
      select count(*)::text from u $q$);
select pg_temp.probar('sin variantes activas sí se apaga', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with u as (update public.empresas set usa_variantes = false where id = public.mi_empresa() returning 1) select count(*)::text from u $q$,
  $p$ select pg_temp.sin_variantes() $p$);
select pg_temp.probar('apagada: no se pueden crear variantes', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with i as (insert into public.producto_variantes (producto_id, empresa_id, sku, talla)
                 select id, empresa_id, 'ZZ-X', 'XS' from public.productos where sku = 'ACC-001' and empresa_id = public.mi_empresa() returning 1)
      select count(*)::text from i $q$,
  $p$ select pg_temp.sin_variantes(); update public.empresas set usa_variantes = false where id = (select empresa_id from public.profiles where email = '{{USUARIO_ADMIN}}') $p$);
select pg_temp.probar('apagada: se vende sin elegir talla', '{{USUARIO_ADMIN}}', 'OK venta registrada',
  $q$ select 'venta registrada' from public.registrar_venta(
        (select ubicacion_id from public.stock s join public.productos p on p.id = s.producto_id
          where p.sku = 'ACC-001' and s.variante_id is null and s.disponible > 0 limit 1),
        (select jsonb_build_array(jsonb_build_object('producto_id', id, 'cantidad', 1)) from public.productos where sku = 'ACC-001' and empresa_id = public.mi_empresa()),
        'monto', 0, 'efectivo', null) $q$,
  $p$ select pg_temp.sin_variantes(); update public.empresas set usa_variantes = false where id = (select empresa_id from public.profiles where email = '{{USUARIO_ADMIN}}') $p$);
select pg_temp.probar('encendida: se pueden crear variantes', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with i as (insert into public.producto_variantes (producto_id, empresa_id, sku, talla)
                 select id, empresa_id, 'ZZ-X', 'XS' from public.productos where sku = 'ACC-001' and empresa_id = public.mi_empresa() returning 1)
      select count(*)::text from i $q$);
select pg_temp.probar('una talla sin stock sí se desactiva', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with u as (update public.producto_variantes set activa = false
                  where id = (select v.id from public.producto_variantes v where v.empresa_id = public.mi_empresa() and v.activa
                                and not exists (select 1 from public.stock s where s.variante_id = v.id and s.disponible + s.reservado + s.transito > 0) limit 1)
                 returning 1)
      select count(*)::text from u $q$,
  $p$ insert into public.producto_variantes (producto_id, empresa_id, sku, talla)
      select id, empresa_id, 'ZZ-Y', 'XXS' from public.productos where sku = 'ROP-001' and empresa_id = (select empresa_id from public.profiles where email = '{{USUARIO_ADMIN}}') $p$);

do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
