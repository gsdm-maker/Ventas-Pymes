-- Datos ficticios para las suites. Solo corre en bases de ensayo (msp_prueba o copias temporales como misociopyme_ensayo). Sin datos reales. Idempotente.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role', 'service_role', true),
       set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  v_emp uuid; v_otra uuid; v_admin uuid; v_tienda uuid; v_otro uuid; v_ub uuid;
begin
  if to_regclass('public.profiles') is null then raise exception 'sin esquema'; end if;
  if current_database() not in ('msp_prueba', 'misociopyme_ensayo') then raise exception 'base incorrecta'; end if;
  if exists (select 1 from auth.users where email = 'admin@prueba.invalid') then
    raise notice 'Datos de prueba ya existen'; return;
  end if;

  insert into public.empresas (nombre) values ('Empresa Prueba A') returning id into v_emp;
  insert into public.empresas (nombre) values ('Empresa Prueba B') returning id into v_otra;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@prueba.invalid', '', now(), '{}', '{"nombre":"Admin Prueba"}', now(), now())
  returning id into v_admin;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tienda@prueba.invalid', '', now(), '{}', '{"nombre":"Tienda Prueba"}', now(), now())
  returning id into v_tienda;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'otra@prueba.invalid', '', now(), '{}', '{"nombre":"Otra Empresa"}', now(), now())
  returning id into v_otro;

  -- GoTrue no admite NULL en estas columnas: falla al leer el usuario (login y API admin).
  update auth.users
     set confirmation_token = '', recovery_token = '', email_change_token_new = '',
         email_change = '', email_change_token_current = '', phone_change = '',
         phone_change_token = '', reauthentication_token = ''
   where id in (v_admin, v_tienda, v_otro);

  update public.profiles set empresa_id = v_emp, role = 'admin', puesto = 'admin' where id = v_admin;
  update public.profiles set empresa_id = v_emp, role = 'integrante', puesto = 'tienda' where id = v_tienda;
  update public.profiles set empresa_id = v_otra, role = 'admin', puesto = 'admin' where id = v_otro;

  perform public.sembrar_demo(v_emp);
  perform public.sembrar_demo(v_otra);

  for v_ub in select id from public.ubicaciones where empresa_id = v_emp and tipo = 'tienda' loop
    insert into public.ubicacion_acceso (empresa_id, user_id, ubicacion_id) values (v_emp, v_tienda, v_ub);
  end loop;
end $$;
update public.empresas set usa_variantes = true where nombre = 'Empresa Prueba A' and not usa_variantes;

do $$
declare v_emp uuid; v_prod uuid; v_var uuid; v_ub uuid; v_admin uuid; v_acc uuid; v_ub_acc uuid;
begin
  select id into v_emp from public.empresas where nombre = 'Empresa Prueba A';
  select id into v_admin from public.profiles where email = 'admin@prueba.invalid';
  select id into v_prod from public.productos where empresa_id = v_emp and sku = 'ROP-001';
  if v_prod is null then raise exception 'Falta ROP-001 en la empresa de prueba'; end if;

  if not exists (select 1 from public.producto_variantes where empresa_id = v_emp and sku = 'ROP-001-M') then
    insert into public.producto_variantes (producto_id, empresa_id, sku, talla)
    values (v_prod, v_emp, 'ROP-001-M', 'M') returning id into v_var;
    select id into v_ub from public.ubicaciones where empresa_id = v_emp and tipo = 'tienda' order by nombre limit 1;
    insert into public.stock (empresa_id, producto_id, variante_id, ubicacion_id, disponible)
    values (v_emp, v_prod, v_var, v_ub, 10);
  end if;

  if not exists (select 1 from public.ventas where empresa_id = v_emp) then
    select id into v_acc from public.productos where empresa_id = v_emp and sku = 'ACC-001';
    select s.ubicacion_id into v_ub_acc from public.stock s
     where s.producto_id = v_acc and s.variante_id is null and s.disponible > 0
     order by s.disponible desc limit 1;
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    perform public.registrar_venta(v_ub_acc,
      jsonb_build_array(jsonb_build_object('producto_id', v_acc, 'cantidad', 1)), 'monto', 0, 'efectivo', null);
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  end if;
end $$;
commit;

select e.nombre,
       (select count(*) from public.ubicaciones u where u.empresa_id = e.id) ubicaciones,
       (select count(*) from public.productos p where p.empresa_id = e.id) productos,
       (select count(*) from public.profiles f where f.empresa_id = e.id) usuarios
  from public.empresas e order by 1;
