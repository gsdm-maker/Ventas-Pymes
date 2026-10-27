-- ============================================================
-- Mi Socio Pyme · Pruebas: planes de suscripción (0025) — se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/planes.sql
--      (antes de aplicar: --antes supabase/migrations/0025_planes_suscripcion.sql)
-- Usuarios: {{USUARIO_TIENDA}} (puesto tienda) · {{USUARIO_ADMIN}} (admin de empresa)
-- 'directo' = conexión directa (como la Edge Function con service_role).
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

create temp table zz_ctx as
select p.empresa_id as emp, p.id as admin_id from public.profiles p where p.email = '{{USUARIO_ADMIN}}';
grant select on zz_ctx to authenticated;

-- ---------------- Regla de vigencia ----------------
select pg_temp.probar('dueño nunca vence', 'directo', 'OK true',
  $q$ select public._plan_vigente('dueno', null, null, 0)::text $q$);
select pg_temp.probar('prueba vencida bloquea', 'directo', 'OK false',
  $q$ select public._plan_vigente('prueba', now() - interval '1 hour', null, 5)::text $q$);
select pg_temp.probar('mensual vencido hace 3 días sigue en gracia (5)', 'directo', 'OK true',
  $q$ select public._plan_vigente('mensual', null, now() - interval '3 days', 5)::text $q$);
select pg_temp.probar('mensual vencido hace 6 días se bloquea', 'directo', 'OK false',
  $q$ select public._plan_vigente('mensual', null, now() - interval '6 days', 5)::text $q$);
select pg_temp.probar('anual sin gracia se bloquea al vencer', 'directo', 'OK false',
  $q$ select public._plan_vigente('anual', null, now() - interval '1 minute', 0)::text $q$);
select pg_temp.probar('plan antiguo «pago» ya no es válido', 'directo', 'ERROR 23514',
  $q$ with u as (update public.empresas set plan = 'pago' where id = (select emp from zz_ctx) returning 1) select count(*)::text from u $q$);
select pg_temp.probar('mensual sin vencimiento se rechaza', 'directo', 'ERROR 23514',
  $q$ with u as (update public.empresas set plan = 'mensual', plan_vence = null where id = (select emp from zz_ctx) returning 1) select count(*)::text from u $q$);

-- ---------------- Cambiar plan y registrar pagos (Edge Function) ----------------
select pg_temp.probar('mensual con alta hace 45 días vence en el ciclo en curso (día 60)', 'directo', 'OK 60',
  $q$ select extract(day from (e.plan_vence - e.plan_inicio))::int::text from public.empresas e where e.id = (select emp from zz_ctx) $q$,
  $p$ select public.cambiar_plan_empresa((select emp from zz_ctx), 'mensual', (select admin_id from zz_ctx), 15, public.hoy_negocio() - 45) $p$);
select pg_temp.probar('registrar pago suma 30 días al vencimiento', 'directo', 'OK 30',
  $q$ select extract(day from ((r ->> 'hasta')::timestamptz - (r ->> 'desde')::timestamptz))::int::text
        from (select public.registrar_pago_plan((select emp from zz_ctx), (select admin_id from zz_ctx), 'transferencia') as r) x $q$,
  $p$ select public.cambiar_plan_empresa((select emp from zz_ctx), 'mensual', (select admin_id from zz_ctx)) $p$);
select pg_temp.probar('el pago queda en el historial', 'directo', 'OK 2',
  $q$ select count(*)::text from public.pagos_plan where empresa_id = (select emp from zz_ctx) and created_at >= now() - interval '1 minute' $q$,
  $p$ select public.cambiar_plan_empresa((select emp from zz_ctx), 'anual', (select admin_id from zz_ctx));
      select public.registrar_pago_plan((select emp from zz_ctx), (select admin_id from zz_ctx)) $p$);
select pg_temp.probar('pago durante la gracia mantiene el ciclo (no parte de hoy)', 'directo', 'OK true',
  $q$ select (e.plan_vence < now() + interval '28 days')::text from public.empresas e where e.id = (select emp from zz_ctx) $q$,
  $p$ update public.empresas set plan = 'mensual', plan_vence = now() - interval '3 days' where id = (select emp from zz_ctx);
      select public.registrar_pago_plan((select emp from zz_ctx), (select admin_id from zz_ctx)) $p$);
select pg_temp.probar('dueño no registra pagos periódicos', 'directo', 'ERROR P0001',
  $q$ select public.registrar_pago_plan((select emp from zz_ctx), (select admin_id from zz_ctx))::text $q$,
  $p$ select public.cambiar_plan_empresa((select emp from zz_ctx), 'dueno', (select admin_id from zz_ctx)) $p$);
select pg_temp.probar('prueba con 400 días se rechaza', 'directo', 'ERROR P0001',
  $q$ select public.cambiar_plan_empresa((select emp from zz_ctx), 'prueba', (select admin_id from zz_ctx), 400)::text $q$);

-- ---------------- Bloqueo efectivo ----------------
select pg_temp.probar('empresa con mensual vencido fuera de gracia queda bloqueada', '{{USUARIO_ADMIN}}', 'OK false',
  $q$ select public.empresa_vigente()::text $q$,
  $p$ update public.empresas set plan = 'mensual', plan_vence = now() - interval '10 days', dias_gracia = 5 where id = (select emp from zz_ctx) $p$);
select pg_temp.probar('empresa en gracia sigue operando', '{{USUARIO_ADMIN}}', 'OK true',
  $q$ select public.empresa_vigente()::text $q$,
  $p$ update public.empresas set plan = 'mensual', plan_vence = now() - interval '2 days', dias_gracia = 5 where id = (select emp from zz_ctx) $p$);

-- ---------------- Solo el administrador general ----------------
select pg_temp.probar('admin de empresa extiende su vencimiento', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.empresas set plan_vence = now() + interval '5 years' where id = public.mi_empresa() returning 1) select count(*)::text from u $q$);
select pg_temp.probar('admin de empresa cambia sus días de gracia', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.empresas set dias_gracia = 60 where id = public.mi_empresa() returning 1) select count(*)::text from u $q$);
select pg_temp.probar('admin de empresa cambia su plan a dueño', '{{USUARIO_ADMIN}}', 'ERROR P0001',
  $q$ with u as (update public.empresas set plan = 'dueno' where id = public.mi_empresa() returning 1) select count(*)::text from u $q$,
  $p$ update public.empresas set plan = 'prueba', prueba_hasta = now() + interval '5 days' where id = (select emp from zz_ctx) $p$);
select pg_temp.probar('admin de empresa registra un pago', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ select public.registrar_pago_plan(public.mi_empresa(), auth.uid())::text $q$);
select pg_temp.probar('admin de empresa cambia su plan por RPC', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ select public.cambiar_plan_empresa(public.mi_empresa(), 'dueno', auth.uid())::text $q$);
select pg_temp.probar('admin de empresa no ve el historial de pagos', '{{USUARIO_ADMIN}}', 'OK 0',
  $q$ select count(*)::text from public.pagos_plan $q$,
  $p$ select public.registrar_pago_plan((select emp from zz_ctx), (select admin_id from zz_ctx))
        from public.empresas where id = (select emp from zz_ctx) and plan in ('mensual', 'anual') $p$);
select pg_temp.probar('admin de empresa inserta un pago falso', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with i as (insert into public.pagos_plan (empresa_id, plan, periodo_desde) values (public.mi_empresa(), 'dueno', now()) returning 1) select count(*)::text from i $q$);
select pg_temp.probar('admin de empresa ve su vencimiento (para las alertas)', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ select count(*)::text from public.empresas where id = public.mi_empresa() and aviso_cada_horas > 0 $q$);
select pg_temp.probar('admin edita el nombre (sin tocar el plan)', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with u as (update public.empresas set nombre = nombre where id = public.mi_empresa() returning 1) select count(*)::text from u $q$);

-- Resultado (aborta la transacción: nada queda guardado)
do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
