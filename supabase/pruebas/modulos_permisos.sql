-- ============================================================
-- Mi Socio Pyme · Pruebas: rubro y módulos del dueño, permisos por usuario y referencias
-- entre empresas (0020) — se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/modulos_permisos.sql
-- Usuarios: {{USUARIO_TIENDA}} (puesto tienda) · {{USUARIO_ADMIN}} (admin de empresa)
-- 'directo' = conexión directa (como el SQL Editor o la Edge Function con service_role).
-- ============================================================
create temp table zz_resultados (n serial, caso text, esperado text, obtenido text);

create function pg_temp.probar(p_caso text, p_usuario text, p_esperado text, p_sql text, p_prep text default null)
returns void language plpgsql as $$
declare v text; v_uid uuid;
begin
  begin
    if p_prep is not null then execute p_prep; end if;
    if p_usuario <> 'directo' then
      select id into v_uid from public.profiles where email = p_usuario;
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
    end if;
    execute p_sql into v;
    raise exception using errcode = 'ZZ999', message = 'OK ' || coalesce(v, '-');
  exception when others then
    v := case when sqlstate = 'ZZ999' then sqlerrm else 'ERROR ' || sqlstate || ': ' || sqlerrm end;
  end;
  insert into zz_resultados (caso, esperado, obtenido) values (p_caso, p_esperado, v);
end $$;

-- ---------------- Preparación (se revierte) ----------------
create temp table zz_ctx as
select p.empresa_id as emp,
       p.id as admin_id,
       (select id from public.profiles where email = '{{USUARIO_TIENDA}}') as juan_id
  from public.profiles p where p.email = '{{USUARIO_ADMIN}}';
grant select on zz_ctx to authenticated;

-- Empresa ajena con un producto y una categoría
insert into public.empresas (nombre) values ('ZZ Empresa ajena');
create temp table zz_ajena as
select e.id as emp, null::uuid as producto, null::uuid as categoria from public.empresas e where e.nombre = 'ZZ Empresa ajena';
insert into public.productos (empresa_id, sku, nombre) select emp, 'ZZ-AJENO', 'Producto ajeno' from zz_ajena;
insert into public.categorias (empresa_id, nombre) select emp, 'ZZ Categoría ajena' from zz_ajena;
-- El atacante no puede leer filas ajenas (RLS): usa los UUID, como los obtendría de la URL de una foto
update zz_ajena set producto = (select id from public.productos where sku = 'ZZ-AJENO' and empresa_id = zz_ajena.emp),
                   categoria = (select id from public.categorias where nombre = 'ZZ Categoría ajena' and empresa_id = zz_ajena.emp);
insert into public.productos (empresa_id, sku, nombre) select emp, 'ZZ-PROPIO', 'Producto propio' from zz_ctx;
grant select on zz_ajena to authenticated;

-- La empresa de prueba usa variantes y tiene reportes habilitado; juan sin ajustes
update public.empresas set usa_variantes = true,
       modulos = array(select distinct unnest(modulos || array['reportes']))
 where id = (select emp from zz_ctx);
update public.profiles set permissions = '{}' where id = (select juan_id from zz_ctx);

-- ---------------- Rubro y módulos: solo el administrador general ----------------
select pg_temp.probar('admin cambia los módulos de su empresa', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.empresas set modulos = array_remove(modulos, 'reportes') where id = public.mi_empresa() returning 1) select count(*)::text from u $q$);
select pg_temp.probar('admin cambia el rubro', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.empresas set tipo_negocio = 'mixto' where id = public.mi_empresa() returning 1) select count(*)::text from u $q$);
select pg_temp.probar('admin edita el nombre (sin tocar módulos)', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with u as (update public.empresas set nombre = nombre where id = public.mi_empresa() returning 1) select count(*)::text from u $q$);
select pg_temp.probar('rubro tienda y restaurante (mixto) es válido', 'directo', 'OK 1',
  $q$ with u as (update public.empresas set tipo_negocio = 'mixto' where id = (select emp from zz_ctx) returning 1) select count(*)::text from u $q$);
select pg_temp.probar('rubro inválido se rechaza', 'directo', 'ERROR 23514',
  $q$ with u as (update public.empresas set tipo_negocio = 'farmacia' where id = (select emp from zz_ctx) returning 1) select count(*)::text from u $q$);
select pg_temp.probar('módulo inexistente se rechaza', 'directo', 'ERROR 23514',
  $q$ with u as (update public.empresas set modulos = modulos || array['casino'] where id = (select emp from zz_ctx) returning 1) select count(*)::text from u $q$);

-- ---------------- Ajustes por usuario en módulos ----------------
select pg_temp.probar('juan (tienda) no ve reportes por defecto', '{{USUARIO_TIENDA}}', 'OK false',
  $q$ select public.tiene_cap('modulos.reportes')::text $q$);
select pg_temp.probar('juan ve reportes con ajuste del admin', '{{USUARIO_TIENDA}}', 'OK true',
  $q$ select public.tiene_cap('modulos.reportes')::text $q$,
  $p$ update public.profiles set permissions = '{"modulos.reportes": true}' where id = (select juan_id from zz_ctx) $p$);
select pg_temp.probar('juan pierde inventario con ajuste del admin', '{{USUARIO_TIENDA}}', 'OK false',
  $q$ select public.tiene_cap('modulos.inventario')::text $q$,
  $p$ update public.profiles set permissions = '{"modulos.inventario": false}' where id = (select juan_id from zz_ctx) $p$);
select pg_temp.probar('ajuste no enciende un módulo apagado para la empresa', '{{USUARIO_TIENDA}}', 'OK false',
  $q$ select public.tiene_cap('modulos.mesas')::text $q$,
  $p$ update public.profiles set permissions = '{"modulos.mesas": true}' where id = (select juan_id from zz_ctx);
      update public.empresas set modulos = array_remove(modulos, 'mesas') where id = (select emp from zz_ctx) $p$);

-- ---------------- Sin escalada de privilegios ----------------
select pg_temp.probar('admin da reportes a juan', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with u as (update public.profiles set permissions = '{"modulos.reportes": true, "reportes.ver": true}' where id = (select juan_id from zz_ctx) returning 1) select count(*)::text from u $q$);
select pg_temp.probar('permiso desconocido se rechaza', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.profiles set permissions = '{"todo.poder": true}' where id = (select juan_id from zz_ctx) returning 1) select count(*)::text from u $q$);
select pg_temp.probar('admin restringido otorga lo que no tiene', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.profiles set permissions = '{"config.gestionar": true}' where id = (select juan_id from zz_ctx) returning 1) select count(*)::text from u $q$,
  $p$ update public.profiles set permissions = '{"config.gestionar": false}' where id = (select admin_id from zz_ctx) $p$);
select pg_temp.probar('admin restringido asciende a juan a admin', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.profiles set role = 'admin', permissions = '{}' where id = (select juan_id from zz_ctx) returning 1) select count(*)::text from u $q$,
  $p$ update public.profiles set permissions = '{"config.gestionar": false}' where id = (select admin_id from zz_ctx) $p$);
select pg_temp.probar('admin restringido otorga lo que sí tiene', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with u as (update public.profiles set permissions = '{"reportes.ver": true}' where id = (select juan_id from zz_ctx) returning 1) select count(*)::text from u $q$,
  $p$ update public.profiles set permissions = '{"config.gestionar": false}' where id = (select admin_id from zz_ctx) $p$);
select pg_temp.probar('admin restringido edita a quien ya tenía el permiso', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with u as (update public.profiles set puesto = puesto, permissions = permissions || '{"reportes.ver": true}' where id = (select juan_id from zz_ctx) returning 1) select count(*)::text from u $q$,
  $p$ update public.profiles set permissions = '{"config.gestionar": true}' where id = (select juan_id from zz_ctx);
      update public.profiles set permissions = '{"config.gestionar": false}' where id = (select admin_id from zz_ctx) $p$);
select pg_temp.probar('crear cuenta: admin restringido no otorga lo que no tiene', 'directo', 'OK No puedes otorgar un permiso que tú no tienes (modulos.configuracion)',
  $q$ select public.validar_permisos_nuevos((select admin_id from zz_ctx), (select emp from zz_ctx), 'admin', 'admin', '{}') $q$,
  $p$ update public.profiles set permissions = '{"modulos.configuracion": false}' where id = (select admin_id from zz_ctx) $p$);
select pg_temp.probar('crear cuenta: admin completo crea a otro admin', 'directo', 'OK ok',
  $q$ select coalesce(public.validar_permisos_nuevos((select admin_id from zz_ctx), (select emp from zz_ctx), 'admin', 'admin', '{}'), 'ok') $q$,
  $p$ update public.profiles set permissions = '{}' where id = (select admin_id from zz_ctx) $p$);
select pg_temp.probar('juan ejecuta validar_permisos_nuevos', '{{USUARIO_TIENDA}}', 'ERROR 42501',
  $q$ select public.validar_permisos_nuevos((select juan_id from zz_ctx), (select emp from zz_ctx), 'admin', 'admin', '{}') $q$);

-- ---------------- Referencias entre empresas ----------------
select pg_temp.probar('admin crea variante sobre producto ajeno', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with i as (insert into public.producto_variantes (empresa_id, producto_id, sku, talla)
        select public.mi_empresa(), producto, 'ZZ-AJENO-M', 'M' from zz_ajena
        returning 1) select count(*)::text from i $q$);
select pg_temp.probar('admin crea variante de su producto', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with i as (insert into public.producto_variantes (empresa_id, producto_id, sku, talla)
        select public.mi_empresa(), p.id, 'ZZ-PROPIO-M', 'M' from public.productos p where p.sku = 'ZZ-PROPIO' and p.empresa_id = public.mi_empresa()
        returning 1) select count(*)::text from i $q$);
select pg_temp.probar('admin asigna categoría ajena a su producto', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.productos set categoria_id = (select categoria from zz_ajena)
        where sku = 'ZZ-PROPIO' and empresa_id = public.mi_empresa() returning 1) select count(*)::text from u $q$);
select pg_temp.probar('variante ajena (ya existente) no bloquea al dueño del producto', 'directo', 'OK sin error',
  $q$ select coalesce(nullif(public._exigir_variante(p.id, null, (select id from public.ubicaciones where empresa_id = (select emp from zz_ajena) limit 1), false)::text, ''), 'sin error')
        from public.productos p where p.sku = 'ZZ-AJENO' $q$,
  $p$ alter table public.producto_variantes disable trigger trg_referencias_empresa;
      insert into public.producto_variantes (empresa_id, producto_id, sku, talla)
      select (select emp from zz_ctx), p.id, 'ZZ-INYECTADA', 'XL' from public.productos p where p.sku = 'ZZ-AJENO';
      alter table public.producto_variantes enable trigger trg_referencias_empresa;
      update public.empresas set usa_variantes = true where id = (select emp from zz_ajena) $p$);
select pg_temp.probar('juan ejecuta _etiqueta_variante', '{{USUARIO_TIENDA}}', 'ERROR 42501',
  $q$ select public._etiqueta_variante(gen_random_uuid()) $q$);

-- Resultado (aborta la transacción: nada queda guardado)
do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
