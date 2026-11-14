-- ============================================================
-- Mi Socio Pyme · Pruebas: niveles de plan y topes (0027) y demo según el plan (0028) — se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/niveles.sql
--      (antes de aplicar: --antes supabase/migrations/0027_niveles_plan.sql)
-- Usuarios: {{USUARIO_TIENDA}} (puesto tienda) · {{USUARIO_ADMIN}} (admin de empresa)
-- 'directo' = conexión directa (como la Edge Function con service_role).
-- Cada caso corre en su propia subtransacción: lo que prepara se deshace al terminar.
-- ============================================================
create temp table zz_resultados (n serial, caso text, esperado text, obtenido text);

create function pg_temp.probar(p_caso text, p_usuario text, p_esperado text, p_sql text, p_prep text default null)
returns void language plpgsql as $$
declare v text; v_uid uuid; v_hint text;
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
    get stacked diagnostics v_hint = pg_exception_hint;
    v := case when sqlstate = 'ZZ999' then sqlerrm
              else 'ERROR ' || sqlstate || coalesce(' [' || nullif(v_hint, '') || ']', '') || ': ' || sqlerrm end;
  end;
  insert into zz_resultados (caso, esperado, obtenido) values (p_caso, p_esperado, v);
end $$;

create temp table zz_ctx as
select p.empresa_id as emp, p.id as admin_id,
       (select t.id from public.profiles t where t.email = '{{USUARIO_TIENDA}}') as tienda_id
  from public.profiles p where p.email = '{{USUARIO_ADMIN}}';
grant select on zz_ctx to authenticated;

-- Atajos
create function pg_temp.nuevo_producto(p_sku text) returns text language sql as $$
  with i as (insert into public.productos (empresa_id, sku, nombre)
             values ((select emp from zz_ctx), p_sku, 'Prueba ' || p_sku) returning 1)
  select count(*)::text from i $$;
create function pg_temp.medida(p_prod integer, p_ubic integer, p_usu integer) returns void language sql as $$
  select public.aplicar_nivel((select emp from zz_ctx), 'medida', p_prod, p_ubic, p_usu); $$;
create function pg_temp.activos(p_tabla text) returns integer language plpgsql as $$
declare v integer;
begin
  execute format('select count(*) from public.%I where empresa_id = $1 and %s', p_tabla,
    case p_tabla when 'ubicaciones' then 'activa' when 'profiles' then 'activo and not es_owner' else 'activo' end)
    into v using (select emp from zz_ctx);
  return v;
end $$;

-- ---------------- Catálogo de niveles ----------------
select pg_temp.probar('hay tres niveles: Socio, Socio Pro, Socio Pro Max', '{{USUARIO_TIENDA}}', 'OK Socio, Socio Pro, Socio Pro Max',
  $q$ select string_agg(nombre, ', ' order by orden) from public.niveles_plan $q$);
select pg_temp.probar('nadie de la empresa edita los niveles', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with u as (update public.niveles_plan set max_productos = 99999 returning 1) select count(*)::text from u $q$);
select pg_temp.probar('cupos del asistente: 8 · 40 · 150', 'directo', 'OK 8,40,150',
  $q$ select string_agg(mensajes_dia_empresa::text, ',' order by orden) from public.planes_ia $q$);

-- ---------------- Sin nivel (empresas anteriores): sin topes ----------------
select pg_temp.probar('empresa sin nivel crea productos sin tope', 'directo', 'OK 1',
  $q$ select pg_temp.nuevo_producto('ZZ-SIN-NIVEL') $q$,
  $p$ update public.empresas set nivel = null where id = (select emp from zz_ctx) $p$);

-- ---------------- Aplicar nivel ----------------
select pg_temp.probar('Socio en retail: con bodega, sin mesas ni cocina; asistente básico', 'directo', 'OK t,f,t,basico',
  $q$ select concat_ws(',', 'bodega' = any(modulos), 'mesas' = any(modulos), 'pos' = any(modulos), plan_ia)
        from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ update public.empresas set tipo_negocio = 'retail' where id = (select emp from zz_ctx);
      select public.aplicar_nivel((select emp from zz_ctx), 's') $p$);
select pg_temp.probar('Socio Pro en restaurante trae mesas y cocina', 'directo', 'OK t,t,pro',
  $q$ select concat_ws(',', 'mesas' = any(modulos), 'cocina' = any(modulos), plan_ia)
        from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ update public.empresas set tipo_negocio = 'restaurante' where id = (select emp from zz_ctx);
      select public.aplicar_nivel((select emp from zz_ctx), 'm') $p$);
select pg_temp.probar('Socio Pro en retail no trae mesas', 'directo', 'OK f,t',
  $q$ select concat_ws(',', 'mesas' = any(modulos), 'bodega' = any(modulos)) from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ update public.empresas set tipo_negocio = 'retail' where id = (select emp from zz_ctx);
      select public.aplicar_nivel((select emp from zz_ctx), 'm') $p$);
select pg_temp.probar('nivel inválido se rechaza', 'directo', 'ERROR P0001: Nivel inválido',
  $q$ select public.aplicar_nivel((select emp from zz_ctx), 'xl')::text $q$);

-- ---------------- Tope de productos ----------------
select pg_temp.probar('Socio (200) con pocos productos crea uno más', 'directo', 'OK 1',
  $q$ select pg_temp.nuevo_producto('ZZ-S-OK') $q$,
  $p$ select public.aplicar_nivel((select emp from zz_ctx), 's') $p$);
select pg_temp.probar('al llegar al tope no se crea otro producto', 'directo', 'ERROR P0001 [tope_plan:productos]',
  $q$ select left(pg_temp.nuevo_producto('ZZ-SOBRE'), 0) $q$,
  $p$ select pg_temp.medida(pg_temp.activos('productos'), null, null) $p$);
select pg_temp.probar('sobre el tope se sigue editando lo existente', 'directo', 'OK 1',
  $q$ with u as (update public.productos set nombre = nombre || ' ' where id = (
        select id from public.productos where empresa_id = (select emp from zz_ctx) and activo limit 1) returning 1)
      select count(*)::text from u $q$,
  $p$ select pg_temp.medida(1, null, null) $p$);
select pg_temp.probar('sobre el tope no se reactiva un producto', 'directo', 'ERROR P0001 [tope_plan:productos]',
  $q$ with u as (update public.productos set activo = true where sku = 'ZZ-INACTIVO' and empresa_id = (select emp from zz_ctx) returning 1)
      select left(count(*)::text, 0) from u $q$,
  $p$ insert into public.productos (empresa_id, sku, nombre, activo) values ((select emp from zz_ctx), 'ZZ-INACTIVO', 'Inactivo', false);
      select pg_temp.medida(pg_temp.activos('productos'), null, null) $p$);
select pg_temp.probar('un producto inactivo no cuenta para el tope', 'directo', 'OK 1',
  $q$ select pg_temp.nuevo_producto('ZZ-LIBRE') $q$,
  $p$ select pg_temp.medida(pg_temp.activos('productos'), null, null);
      update public.productos set activo = false where id = (
        select id from public.productos where empresa_id = (select emp from zz_ctx) and activo limit 1) $p$);
select pg_temp.probar('el admin de la empresa también choca con el tope', '{{USUARIO_ADMIN}}', 'ERROR P0001 [tope_plan:productos]',
  $q$ select left(pg_temp.nuevo_producto('ZZ-ADMIN'), 0) $q$,
  $p$ select pg_temp.medida(pg_temp.activos('productos'), null, null) $p$);
select pg_temp.probar('el mensaje nombra el plan y el tope', 'directo', 'ERROR P0001 [tope_plan:productos]: Tu plan A medida permite hasta 1 productos. Para agregar más, sube de plan.',
  $q$ select left(pg_temp.nuevo_producto('ZZ-MSJ'), 0) $q$,
  $p$ select pg_temp.medida(1, null, null) $p$);
select pg_temp.probar('Socio Pro Max no tiene tope de productos', 'directo', 'OK 1',
  $q$ select pg_temp.nuevo_producto('ZZ-L') $q$,
  $p$ select public.aplicar_nivel((select emp from zz_ctx), 'l') $p$);

-- ---------------- Tope de locales ----------------
select pg_temp.probar('Socio (2 locales) con 2 o más no crea otro', 'directo', 'ERROR P0001 [tope_plan:ubicaciones]',
  $q$ with i as (insert into public.ubicaciones (empresa_id, nombre, tipo) values ((select emp from zz_ctx), 'ZZ Local', 'tienda') returning 1)
      select left(count(*)::text, 0) from i $q$,
  $p$ insert into public.ubicaciones (empresa_id, nombre, tipo)
        select (select emp from zz_ctx), 'ZZ Relleno ' || g, 'tienda'
          from generate_series(1, greatest(0, 2 - pg_temp.activos('ubicaciones'))) g;
      select public.aplicar_nivel((select emp from zz_ctx), 's') $p$);
select pg_temp.probar('los locales que ya existen siguen activos', 'directo', 'OK true',
  $q$ select (pg_temp.activos('ubicaciones') >= 1)::text $q$,
  $p$ select public.aplicar_nivel((select emp from zz_ctx), 's') $p$);
select pg_temp.probar('con cupo libre se crea un local', 'directo', 'OK 1',
  $q$ with i as (insert into public.ubicaciones (empresa_id, nombre, tipo) values ((select emp from zz_ctx), 'ZZ Local', 'tienda') returning 1)
      select count(*)::text from i $q$,
  $p$ select pg_temp.medida(null, pg_temp.activos('ubicaciones') + 1, null) $p$);
select pg_temp.probar('sobre el tope no se reactiva un local', 'directo', 'ERROR P0001 [tope_plan:ubicaciones]',
  $q$ with u as (update public.ubicaciones set activa = true where nombre = 'ZZ Inactivo' and empresa_id = (select emp from zz_ctx) returning 1)
      select left(count(*)::text, 0) from u $q$,
  $p$ insert into public.ubicaciones (empresa_id, nombre, tipo, activa) values ((select emp from zz_ctx), 'ZZ Inactivo', 'bodega', false);
      select pg_temp.medida(null, pg_temp.activos('ubicaciones'), null) $p$);

-- ---------------- Tope de usuarios y permisos por usuario ----------------
select pg_temp.probar('sobre el tope no se reactiva un usuario', 'directo', 'ERROR P0001 [tope_plan:usuarios]',
  $q$ with u as (update public.profiles set activo = true where id = (select tienda_id from zz_ctx) returning 1)
      select left(count(*)::text, 0) from u $q$,
  $p$ update public.profiles set activo = false where id = (select tienda_id from zz_ctx);
      select pg_temp.medida(null, null, pg_temp.activos('profiles')) $p$);
select pg_temp.probar('con cupo libre se reactiva el usuario', 'directo', 'OK 1',
  $q$ with u as (update public.profiles set activo = true where id = (select tienda_id from zz_ctx) returning 1)
      select count(*)::text from u $q$,
  $p$ update public.profiles set activo = false where id = (select tienda_id from zz_ctx);
      select pg_temp.medida(null, null, pg_temp.activos('profiles') + 1) $p$);
select pg_temp.probar('sobre el tope se puede desactivar un usuario', 'directo', 'OK 1',
  $q$ with u as (update public.profiles set activo = false where id = (select tienda_id from zz_ctx) returning 1)
      select count(*)::text from u $q$,
  $p$ select pg_temp.medida(null, null, 1) $p$);
select pg_temp.probar('Socio no permite permisos a medida', 'directo', 'ERROR P0001 [tope_plan:permisos]',
  $q$ with u as (update public.profiles set permissions = '{"reportes.ver": true}' where id = (select tienda_id from zz_ctx) returning 1)
      select left(count(*)::text, 0) from u $q$,
  $p$ select public.aplicar_nivel((select emp from zz_ctx), 's') $p$);
select pg_temp.probar('Socio: quitar los permisos a medida sí se puede', 'directo', 'OK 1',
  $q$ with u as (update public.profiles set permissions = '{}' where id = (select tienda_id from zz_ctx) returning 1)
      select count(*)::text from u $q$,
  $p$ select public.aplicar_nivel((select emp from zz_ctx), 's') $p$);
select pg_temp.probar('Socio Pro permite permisos a medida', 'directo', 'OK 1',
  $q$ with u as (update public.profiles set permissions = '{"reportes.ver": true}' where id = (select tienda_id from zz_ctx) returning 1)
      select count(*)::text from u $q$,
  $p$ select public.aplicar_nivel((select emp from zz_ctx), 'm') $p$);

-- ---------------- Plan anual = Socio Pro Max ----------------
select pg_temp.probar('pasar a anual aplica Socio Pro Max', 'directo', 'OK l,max',
  $q$ select concat_ws(',', nivel, plan_ia) from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ select public.aplicar_nivel((select emp from zz_ctx), 's');
      select public.cambiar_plan_empresa((select emp from zz_ctx), 'anual', (select admin_id from zz_ctx)) $p$);
select pg_temp.probar('con anual no se baja a Socio', 'directo', 'ERROR P0001: El plan anual es siempre Socio Pro Max. Cambia primero la membresía.',
  $q$ select public.aplicar_nivel((select emp from zz_ctx), 's')::text $q$,
  $p$ select public.cambiar_plan_empresa((select emp from zz_ctx), 'anual', (select admin_id from zz_ctx)) $p$);
select pg_temp.probar('con anual tampoco se baja de nivel a mano', 'directo', 'ERROR 23514',
  $q$ with u as (update public.empresas set nivel = 'm' where id = (select emp from zz_ctx) returning 1) select count(*)::text from u $q$,
  $p$ select public.cambiar_plan_empresa((select emp from zz_ctx), 'anual', (select admin_id from zz_ctx)) $p$);
select pg_temp.probar('de anual a mensual conserva Socio Pro Max', 'directo', 'OK l',
  $q$ select nivel from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ select public.cambiar_plan_empresa((select emp from zz_ctx), 'anual', (select admin_id from zz_ctx));
      select public.cambiar_plan_empresa((select emp from zz_ctx), 'mensual', (select admin_id from zz_ctx)) $p$);

-- ---------------- Cambiar el rubro: el plan manda ----------------
select pg_temp.probar('Socio Pro: pasar a restaurante suma mesas y cocina', 'directo', 'OK restaurante,t,t',
  $q$ select concat_ws(',', tipo_negocio, 'mesas' = any(modulos), 'cocina' = any(modulos))
        from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ update public.empresas set tipo_negocio = 'retail' where id = (select emp from zz_ctx);
      select public.aplicar_nivel((select emp from zz_ctx), 'm');
      select public.cambiar_rubro((select emp from zz_ctx), 'restaurante') $p$);
select pg_temp.probar('Socio Pro: volver a tienda quita mesas y cocina', 'directo', 'OK retail,f,f',
  $q$ select concat_ws(',', tipo_negocio, 'mesas' = any(modulos), 'cocina' = any(modulos))
        from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ select public.aplicar_nivel((select emp from zz_ctx), 'm');
      select public.cambiar_rubro((select emp from zz_ctx), 'restaurante');
      select public.cambiar_rubro((select emp from zz_ctx), 'retail') $p$);
select pg_temp.probar('Socio en restaurante sigue sin mesas', 'directo', 'OK restaurante,f',
  $q$ select concat_ws(',', tipo_negocio, 'mesas' = any(modulos)) from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ select public.aplicar_nivel((select emp from zz_ctx), 's');
      select public.cambiar_rubro((select emp from zz_ctx), 'restaurante') $p$);
select pg_temp.probar('nivel estándar: cambiar el rubro deshace un módulo quitado a mano', 'directo', 'OK t',
  $q$ select ('reportes' = any(modulos))::text from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ select public.aplicar_nivel((select emp from zz_ctx), 'm');
      update public.empresas set modulos = array_remove(modulos, 'reportes') where id = (select emp from zz_ctx);
      select public.cambiar_rubro((select emp from zz_ctx), 'mixto') $p$);
select pg_temp.probar('A medida: cambiar el rubro conserva los módulos ajustados', 'directo', 'OK f,t',
  $q$ select concat_ws(',', 'reportes' = any(modulos), 'mesas' = any(modulos)) from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ update public.empresas set tipo_negocio = 'retail' where id = (select emp from zz_ctx);
      select public.aplicar_nivel((select emp from zz_ctx), 'm');
      select pg_temp.medida(null, null, null);
      update public.empresas set modulos = array_remove(modulos, 'reportes') where id = (select emp from zz_ctx);
      select public.cambiar_rubro((select emp from zz_ctx), 'mixto') $p$);
select pg_temp.probar('rubro inválido se rechaza', 'directo', 'ERROR P0001: Rubro inválido',
  $q$ select public.cambiar_rubro((select emp from zz_ctx), 'casino')::text $q$);

-- ---------------- Precios y plan «A medida» ----------------
select pg_temp.probar('precios de referencia: 10.000 · 20.000 · 30.000 (anual 330.000)', '{{USUARIO_TIENDA}}', 'OK 10000/-,20000/-,30000/330000',
  $q$ select string_agg(precio_mensual || '/' || coalesce(precio_anual::text, '-'), ',' order by orden) from public.niveles_plan $q$);
select pg_temp.probar('el administrador general cambia un precio (directo)', 'directo', 'OK 12000',
  $q$ select precio_mensual::text from public.niveles_plan where nivel = 's' $q$,
  $p$ update public.niveles_plan set precio_mensual = 12000 where nivel = 's' $p$);
select pg_temp.probar('aplicar_a_medida fija nivel, precio, topes, asistente y módulos', 'directo', 'OK medida,45000,500,3,4,pro,2',
  $q$ select concat_ws(',', nivel, precio_medida, max_productos, max_ubicaciones, max_usuarios, plan_ia, cardinality(modulos))
        from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ select public.aplicar_nivel((select emp from zz_ctx), 's');
      select public.aplicar_a_medida((select emp from zz_ctx), array['pos','productos'], 'pro', 500, 3, 4, 45000) $p$);
select pg_temp.probar('aplicar_a_medida sin topes = sin límite', 'directo', 'OK -,-,-,0',
  $q$ select concat_ws(',', coalesce(max_productos::text, '-'), coalesce(max_ubicaciones::text, '-'), coalesce(max_usuarios::text, '-'), precio_medida)
        from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ select public.aplicar_a_medida((select emp from zz_ctx), array['pos'], null, null, null, null, 0) $p$);
select pg_temp.probar('volver a un nivel estándar borra el precio cotizado', 'directo', 'OK m,-',
  $q$ select concat_ws(',', nivel, coalesce(precio_medida::text, '-')) from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ select public.aplicar_a_medida((select emp from zz_ctx), array['pos'], null, null, null, null, 45000);
      select public.aplicar_nivel((select emp from zz_ctx), 'm') $p$);
select pg_temp.probar('aplicar_nivel medida guarda el precio cotizado', 'directo', 'OK medida,25000',
  $q$ select concat_ws(',', nivel, precio_medida) from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ select public.aplicar_nivel((select emp from zz_ctx), 'medida', null, null, null, 25000) $p$);
select pg_temp.probar('aplicar_a_medida sin módulos se rechaza', 'directo', 'ERROR P0001: Deja al menos un módulo',
  $q$ select public.aplicar_a_medida((select emp from zz_ctx), array[]::text[], null, null, null, null, 1000)::text $q$);
select pg_temp.probar('aplicar_a_medida sin precio se rechaza', 'directo', 'ERROR P0001: Indica el precio',
  $q$ select public.aplicar_a_medida((select emp from zz_ctx), array['pos'], null, null, null, null, null)::text $q$);
select pg_temp.probar('aplicar_a_medida con asistente inexistente se rechaza', 'directo', 'ERROR P0001: Plan de asistente inválido',
  $q$ select public.aplicar_a_medida((select emp from zz_ctx), array['pos'], 'ultra', null, null, null, 1000)::text $q$);
select pg_temp.probar('aplicar_a_medida con membresía anual se rechaza', 'directo', 'ERROR P0001: El plan anual',
  $q$ select public.aplicar_a_medida((select emp from zz_ctx), array['pos'], null, null, null, null, 1000)::text $q$,
  $p$ update public.empresas set plan = 'anual', plan_inicio = now(), plan_vence = now() + interval '1 year'
       where id = (select emp from zz_ctx) $p$);

-- ---------------- Solo el administrador general ----------------
select pg_temp.probar('admin de empresa edita un precio del catálogo', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with u as (update public.niveles_plan set precio_mensual = 1 returning 1) select count(*)::text from u $q$);
select pg_temp.probar('admin de empresa llama a aplicar_a_medida', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ select public.aplicar_a_medida(public.mi_empresa(), array['pos'], 'max', null, null, null, 0)::text $q$);
select pg_temp.probar('admin de empresa cambia su precio cotizado', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.empresas set precio_medida = 1 where id = public.mi_empresa() returning 1) select left(count(*)::text, 0) from u $q$);
select pg_temp.probar('admin de empresa llama a cambiar_rubro', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ select public.cambiar_rubro(public.mi_empresa(), 'mixto')::text $q$);
select pg_temp.probar('admin de empresa cambia su nivel', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.empresas set nivel = 'l' where id = public.mi_empresa() returning 1) select left(count(*)::text, 0) from u $q$);
select pg_temp.probar('admin de empresa sube su tope a mano', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.empresas set max_productos = 99999 where id = public.mi_empresa() returning 1) select left(count(*)::text, 0) from u $q$);
select pg_temp.probar('admin de empresa llama a aplicar_nivel', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ select public.aplicar_nivel(public.mi_empresa(), 'l')::text $q$);
select pg_temp.probar('admin de empresa no lee los topes de otra forma', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ select count(*)::text from public._topes_empresa(public.mi_empresa()) $q$);

-- ---------------- Uso del plan (medidores) ----------------
select pg_temp.probar('uso_plan: Socio, tope 200 y siguiente Socio Pro', '{{USUARIO_TIENDA}}', 'OK Socio,200,Socio Pro,false',
  $q$ select concat_ws(',', u ->> 'nombre', u -> 'productos' ->> 'tope', u -> 'siguiente' ->> 'nombre', u ->> 'reportes_completos')
        from (select public.uso_plan() as u) x $q$,
  $p$ select public.aplicar_nivel((select emp from zz_ctx), 's') $p$);
select pg_temp.probar('uso_plan: Socio Pro Max sin topes ni siguiente', '{{USUARIO_ADMIN}}', 'OK Socio Pro Max,-,-',
  $q$ select concat_ws(',', u ->> 'nombre', coalesce(u -> 'productos' ->> 'tope', '-'), coalesce(u -> 'siguiente' ->> 'nombre', '-'))
        from (select public.uso_plan() as u) x $q$,
  $p$ select public.aplicar_nivel((select emp from zz_ctx), 'l') $p$);
select pg_temp.probar('uso_plan cuenta los productos activos', '{{USUARIO_ADMIN}}', 'OK true',
  $q$ select ((public.uso_plan() -> 'productos' ->> 'usados')::int = pg_temp.activos('productos'))::text $q$);

-- ---------------- Datos de demostración según el plan (0028) ----------------
-- Empresa vacía con el nivel pedido, se le carga el ejemplo y se cuentan locales · productos · stock
create function pg_temp.demo_en(p_nivel text, p_prod integer default null, p_ubic integer default null)
returns text language plpgsql as $$
declare v_emp uuid;
begin
  insert into public.empresas (nombre) values ('ZZ Demo ' || coalesce(p_nivel, 'sin')) returning id into v_emp;
  if p_nivel = 'medida' then perform public.aplicar_nivel(v_emp, 'medida', p_prod, p_ubic, null);
  elsif p_nivel is not null then perform public.aplicar_nivel(v_emp, p_nivel); end if;
  perform public.sembrar_demo(v_emp);
  return concat_ws(' · ',
    (select count(*) from public.ubicaciones where empresa_id = v_emp),
    (select count(*) from public.productos where empresa_id = v_emp),
    (select count(*) from public.stock where empresa_id = v_emp));
end $$;
select pg_temp.probar('demo con Socio: 2 locales, 13 productos y su stock', 'directo', 'OK 2 · 13 · 26',
  $q$ select pg_temp.demo_en('s') $q$);
select pg_temp.probar('demo con Socio Pro: 4 locales', 'directo', 'OK 4 · 13 · 52',
  $q$ select pg_temp.demo_en('m') $q$);
select pg_temp.probar('demo sin plan: 4 locales', 'directo', 'OK 4 · 13 · 52',
  $q$ select pg_temp.demo_en(null) $q$);
select pg_temp.probar('demo a medida con 1 local y 5 productos', 'directo', 'OK 1 · 5 · 5',
  $q$ select pg_temp.demo_en('medida', 5, 1) $q$);
select pg_temp.probar('demo se rechaza si la empresa ya tiene locales', 'directo', 'ERROR P0001: La empresa ya tiene datos cargados',
  $q$ select public.sembrar_demo((select emp from zz_ctx))::text $q$);
select pg_temp.probar('el admin de la empresa ya no carga el demo', '{{USUARIO_ADMIN}}', 'ERROR P0001: Solo el administrador general puede cargar datos de demostración',
  $q$ select public.sembrar_demo((select emp from zz_ctx))::text $q$);

-- ---------------- Empezar de cero: vaciar_empresa (0028) ----------------
create function pg_temp.vaciar_y_contar() returns text language plpgsql as $$
declare v_emp uuid := (select emp from zz_ctx); v_antes integer;
begin
  select count(*) into v_antes from public.profiles where empresa_id = v_emp;
  perform public.vaciar_empresa(v_emp, (select upper(nombre) from public.empresas where id = v_emp));
  return concat_ws(' · ',
    (select count(*) from public.ubicaciones where empresa_id = v_emp)
      + (select count(*) from public.productos where empresa_id = v_emp)
      + (select count(*) from public.ventas where empresa_id = v_emp)
      + (select count(*) from public.movimientos where empresa_id = v_emp)
      + (select count(*) from public.stock where empresa_id = v_emp),
    ((select count(*) from public.profiles where empresa_id = v_emp) = v_antes),
    ((select count(*) from public.motivos_salida where empresa_id = v_emp) >= 0),
    (select count(*) from public.admin_auditoria where empresa_id = v_emp and accion = 'vaciar_empresa'));
end $$;
create function pg_temp.vaciar_y_sembrar() returns text language plpgsql as $$
declare v_emp uuid := (select emp from zz_ctx);
begin
  perform pg_temp.vaciar_y_contar();
  perform public.sembrar_demo(v_emp);
  return ((select count(*) from public.productos where empresa_id = v_emp) > 0
      and (select count(*) from public.unidades_medida where empresa_id = v_emp and codigo = 'UN') = 1)::text;
end $$;
select pg_temp.probar('vaciar: borra locales, productos, ventas, movimientos y stock; conserva usuarios; queda auditado', 'directo', 'OK 0 · t · t · 1',
  $q$ select pg_temp.vaciar_y_contar() $q$);
select pg_temp.probar('vaciar exige el nombre de la empresa', 'directo', 'ERROR P0001',
  $q$ select public.vaciar_empresa((select emp from zz_ctx), 'otro nombre')::text $q$);
select pg_temp.probar('el admin de la empresa no puede vaciarla', '{{USUARIO_ADMIN}}', 'ERROR P0001: Solo el administrador general puede vaciar una empresa',
  $q$ select public.vaciar_empresa((select emp from zz_ctx), (select nombre from public.empresas where id = (select emp from zz_ctx)))::text $q$);
select pg_temp.probar('vaciar y luego cargar el ejemplo funciona', 'directo', 'OK true',
  $q$ select pg_temp.vaciar_y_sembrar() $q$);

-- Resultado (aborta la transacción: nada queda guardado)
do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
