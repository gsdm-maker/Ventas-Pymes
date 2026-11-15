-- ============================================================
-- Mi Socio Pyme · Pruebas: suscripción con cobro automático por Flow (0030) — se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/suscripcion_flow.sql
--      (antes de aplicar: --antes supabase/migrations/0030_suscripcion_flow.sql)
-- Usuarios: {{USUARIO_TIENDA}} (puesto tienda) · {{USUARIO_ADMIN}} (admin de empresa)
-- 'directo' = conexión directa (como la Edge Function con service_role).
-- Cada caso corre en su propia subtransacción: lo que prepara se deshace al terminar.
-- Los montos esperados suponen los precios de 0027 (10.000 · 20.000 · 30.000 · anual 330.000).
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

-- ---------------- Atajos ----------------
-- Empresa de prueba en un estado conocido: plan mensual, nivel Socio, vence el día indicado
create function pg_temp.base(p_vence timestamptz default '2030-01-10 12:00+00') returns void language plpgsql as $$
begin
  update public.empresas
     set plan = 'mensual', prueba_hasta = null, plan_inicio = '2029-12-10 12:00+00', plan_vence = p_vence
   where id = (select emp from zz_ctx);
  perform public.aplicar_nivel((select emp from zz_ctx), 's');
end $$;
-- Contrato completo hasta «tarjeta registrada» (sin cobros todavía)
create function pg_temp.contratar(p_nivel text default 'm', p_periodo text default 'mensual') returns void language plpgsql as $$
begin
  perform public.flow_preparar_suscripcion((select emp from zz_ctx), (select admin_id from zz_ctx), p_nivel, p_periodo);
  perform public.flow_guardar_cliente((select emp from zz_ctx), 'cus_zz');
  perform public.flow_activar_suscripcion('cus_zz', 'sub_zz', 'Visa', '1234', '2030-02-01 12:00+00');
end $$;
create function pg_temp.cobro(p_inv bigint, p_estado text, p_hasta timestamptz default '2030-02-01 12:00+00',
                              p_monto integer default 20000) returns jsonb language sql as $$
  select public.flow_registrar_cobro('sub_zz', p_inv, p_monto, '2030-01-01 12:00+00', p_hasta, p_estado, 1,
                                     case when p_estado = 'fallido' then 'Tarjeta rechazada' end, 900000 + p_inv) $$;
-- plan · nivel · vence · estado de la suscripción · pagos de Flow en pagos_plan · cobros
create function pg_temp.foto() returns text language sql as $$
  select concat_ws(' · ', e.plan, e.nivel, to_char(e.plan_vence at time zone 'UTC', 'YYYY-MM-DD'),
           (select estado from public.suscripciones_flow where empresa_id = e.id),
           (select count(*) from public.pagos_plan where empresa_id = e.id and nota like 'Flow · importe %'),
           (select count(*) from public.cobros_flow where empresa_id = e.id))
    from public.empresas e where e.id = (select emp from zz_ctx) $$;
-- Otra empresa con su propia suscripción y un cobro
create function pg_temp.otra() returns uuid language plpgsql as $$
declare v_emp uuid; v_sus uuid;
begin
  insert into public.empresas (nombre) values ('ZZ Otra') returning id into v_emp;
  insert into public.suscripciones_flow (empresa_id, nivel, periodo, estado, flow_customer_id, flow_subscription_id)
  values (v_emp, 's', 'mensual', 'activa', 'cus_otra', 'sub_otra') returning id into v_sus;
  insert into public.cobros_flow (empresa_id, suscripcion_id, flow_invoice_id, nivel, periodo, monto, periodo_desde, periodo_hasta, estado)
  values (v_emp, v_sus, 777, 's', 'mensual', 10000, '2030-01-01 12:00+00', '2030-02-01 12:00+00', 'pendiente');
  return v_emp;
end $$;

-- ---------------- Quién ve qué ----------------
select pg_temp.probar('el admin de la empresa ve su suscripción y su tarjeta', '{{USUARIO_ADMIN}}', 'OK activa,m,mensual,Visa,1234',
  $q$ select concat_ws(',', estado, nivel, periodo, tarjeta_marca, tarjeta_ultimos4) from public.suscripciones_flow $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar() $p$);
select pg_temp.probar('el admin de la empresa ve sus cobros', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ select count(*)::text from public.cobros_flow $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.cobro(1, 'pagado') $p$);
select pg_temp.probar('el puesto tienda no ve la suscripción', '{{USUARIO_TIENDA}}', 'OK 0',
  $q$ select count(*)::text from public.suscripciones_flow $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar() $p$);
select pg_temp.probar('el puesto tienda no ve los cobros', '{{USUARIO_TIENDA}}', 'OK 0',
  $q$ select count(*)::text from public.cobros_flow $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.cobro(1, 'pagado') $p$);
select pg_temp.probar('el admin no ve la suscripción ni los cobros de otra empresa', '{{USUARIO_ADMIN}}', 'OK 0,0',
  $q$ select concat_ws(',', (select count(*) from public.suscripciones_flow), (select count(*) from public.cobros_flow)) $q$,
  $p$ select pg_temp.otra() $p$);
select pg_temp.probar('el admin de la empresa no ve la bitácora de avisos', '{{USUARIO_ADMIN}}', 'OK 0',
  $q$ select count(*)::text from public.eventos_flow $q$,
  $p$ insert into public.eventos_flow (empresa_id, tipo, resultado, referencia) values ((select emp from zz_ctx), 'cobro', 'ok', 'ZZ-1') $p$);
select pg_temp.probar('sin sesión (anon) no hay acceso a tablas ni funciones', 'directo', 'OK f,f,f,f,f',
  $q$ select concat_ws(',',
        has_table_privilege('anon', 'public.suscripciones_flow', 'select'),
        has_table_privilege('anon', 'public.cobros_flow', 'select'),
        has_table_privilege('anon', 'public.eventos_flow', 'select'),
        has_function_privilege('anon', 'public.flow_registrar_cobro(text, bigint, integer, timestamptz, timestamptz, text, integer, text, bigint)', 'execute'),
        has_function_privilege('anon', 'public.flow_preparar_suscripcion(uuid, uuid, text, text)', 'execute')) $q$);

-- ---------------- El cliente no escribe ----------------
select pg_temp.probar('el admin no crea una suscripción a mano', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with i as (insert into public.suscripciones_flow (empresa_id, nivel, periodo) values (public.mi_empresa(), 'l', 'mensual') returning 1)
      select count(*)::text from i $q$);
select pg_temp.probar('el admin no cambia su suscripción', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with u as (update public.suscripciones_flow set nivel = 'l' returning 1) select count(*)::text from u $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar() $p$);
select pg_temp.probar('el admin no borra su suscripción', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with d as (delete from public.suscripciones_flow returning 1) select count(*)::text from d $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar() $p$);
select pg_temp.probar('el admin no marca un cobro como pagado', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with u as (update public.cobros_flow set estado = 'pagado' returning 1) select count(*)::text from u $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.cobro(1, 'fallido') $p$);
select pg_temp.probar('el admin no inventa un cobro', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with i as (insert into public.cobros_flow (empresa_id, suscripcion_id, flow_invoice_id, nivel, periodo, monto, periodo_desde, periodo_hasta, estado)
                 select empresa_id, id, 999, 'm', 'mensual', 0, now(), now() + interval '1 year', 'pagado' from public.suscripciones_flow returning 1)
      select count(*)::text from i $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar() $p$);
select pg_temp.probar('el admin no llama a flow_preparar_suscripcion', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ select public.flow_preparar_suscripcion(public.mi_empresa(), auth.uid(), 'm', 'mensual')::text $q$);
select pg_temp.probar('el admin no llama a flow_guardar_cliente', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ select public.flow_guardar_cliente(public.mi_empresa(), 'cus_x')::text $q$);
select pg_temp.probar('el admin no llama a flow_activar_suscripcion', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ select public.flow_activar_suscripcion('cus_zz', 'sub_x', 'Visa', '1234')::text $q$);
select pg_temp.probar('el admin no llama a flow_registrar_cobro', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ select public.flow_registrar_cobro('sub_zz', 1, 0, now(), now() + interval '10 years', 'pagado')::text $q$);
select pg_temp.probar('el admin no llama a flow_sincronizar_suscripcion', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ select public.flow_sincronizar_suscripcion('sub_zz', 'activa')::text $q$);

-- ---------------- Preparar el contrato ----------------
select pg_temp.probar('contratar Socio Pro mensual: monto y plan de Flow', 'directo', 'OK 20000,msp-m-mensual-20000',
  $q$ select concat_ws(',', r ->> 'monto', r ->> 'flow_plan_id')
        from (select public.flow_preparar_suscripcion((select emp from zz_ctx), (select admin_id from zz_ctx), 'm', 'mensual') as r) x $q$,
  $p$ select pg_temp.base() $p$);
select pg_temp.probar('contratar deja la suscripción pendiente de tarjeta', 'directo', 'OK pendiente_tarjeta',
  $q$ select estado from public.suscripciones_flow where empresa_id = (select emp from zz_ctx) $q$,
  $p$ select pg_temp.base();
      select public.flow_preparar_suscripcion((select emp from zz_ctx), (select admin_id from zz_ctx), 'm', 'mensual') $p$);
select pg_temp.probar('contratar Socio Pro Max anual', 'directo', 'OK 330000,msp-l-anual-330000',
  $q$ select concat_ws(',', r ->> 'monto', r ->> 'flow_plan_id')
        from (select public.flow_preparar_suscripcion((select emp from zz_ctx), (select admin_id from zz_ctx), 'l', 'anual') as r) x $q$,
  $p$ select pg_temp.base() $p$);
select pg_temp.probar('preparar no da acceso: el plan no cambia', 'directo', 'OK mensual · s · 2030-01-10 · activa · 0 · 0',
  $q$ select pg_temp.foto() $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar('l', 'anual') $p$);
select pg_temp.probar('nivel inexistente se rechaza', 'directo', 'ERROR P0001: Plan inválido',
  $q$ select public.flow_preparar_suscripcion((select emp from zz_ctx), (select admin_id from zz_ctx), 'xl', 'mensual')::text $q$,
  $p$ select pg_temp.base() $p$);
select pg_temp.probar('«A medida» no se contrata en línea', 'directo', 'ERROR P0001: Plan inválido',
  $q$ select public.flow_preparar_suscripcion((select emp from zz_ctx), (select admin_id from zz_ctx), 'medida', 'mensual')::text $q$,
  $p$ select pg_temp.base() $p$);
select pg_temp.probar('período inexistente se rechaza', 'directo', 'ERROR P0001: Período inválido',
  $q$ select public.flow_preparar_suscripcion((select emp from zz_ctx), (select admin_id from zz_ctx), 'm', 'semanal')::text $q$,
  $p$ select pg_temp.base() $p$);
select pg_temp.probar('anual con Socio Pro se rechaza', 'directo', 'ERROR P0001: El plan anual es solo Socio Pro Max',
  $q$ select public.flow_preparar_suscripcion((select emp from zz_ctx), (select admin_id from zz_ctx), 'm', 'anual')::text $q$,
  $p$ select pg_temp.base() $p$);
select pg_temp.probar('empresa con plan sin vencimiento no contrata', 'directo', 'ERROR P0001: Tu empresa tiene un plan sin vencimiento: no necesita suscripción',
  $q$ select public.flow_preparar_suscripcion((select emp from zz_ctx), (select admin_id from zz_ctx), 'm', 'mensual')::text $q$,
  $p$ update public.empresas set plan = 'dueno', plan_vence = null where id = (select emp from zz_ctx) $p$);
select pg_temp.probar('el puesto tienda no puede contratar', 'directo', 'ERROR P0001: Solo el administrador de la empresa puede contratar la suscripción',
  $q$ select public.flow_preparar_suscripcion((select emp from zz_ctx), (select tienda_id from zz_ctx), 'm', 'mensual')::text $q$,
  $p$ select pg_temp.base() $p$);
select pg_temp.probar('el admin de una empresa no contrata por otra', 'directo', 'ERROR P0001: Solo el administrador de la empresa puede contratar la suscripción',
  $q$ select public.flow_preparar_suscripcion(pg_temp.otra(), (select admin_id from zz_ctx), 'm', 'mensual')::text $q$);
select pg_temp.probar('con una suscripción en curso no se contrata otra', 'directo', 'ERROR P0001: Tu empresa ya tiene una suscripción en curso. Cancélala antes de contratar otra.',
  $q$ select public.flow_preparar_suscripcion((select emp from zz_ctx), (select admin_id from zz_ctx), 'l', 'mensual')::text $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar() $p$);
select pg_temp.probar('tras cancelar se puede volver a contratar y conserva el cliente de Flow', 'directo', 'OK pendiente_tarjeta,l,cus_zz,-',
  $q$ select concat_ws(',', estado, nivel, flow_customer_id, coalesce(flow_subscription_id, '-'))
        from public.suscripciones_flow where empresa_id = (select emp from zz_ctx) $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar();
      select public.flow_sincronizar_suscripcion('sub_zz', 'cancelada');
      select public.flow_preparar_suscripcion((select emp from zz_ctx), (select admin_id from zz_ctx), 'l', 'mensual') $p$);

-- ---------------- Tarjeta registrada ----------------
select pg_temp.probar('el mismo aviso de tarjeta dos veces no cambia nada', 'directo', 'OK true',
  $q$ select public.flow_activar_suscripcion('cus_zz', 'sub_zz', 'Visa', '1234') ->> 'repetido' $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar() $p$);
select pg_temp.probar('cliente de Flow desconocido se rechaza', 'directo', 'ERROR P0001: Cliente de Flow desconocido',
  $q$ select public.flow_activar_suscripcion('cus_nadie', 'sub_x', 'Visa', '1234')::text $q$);
select pg_temp.probar('últimos dígitos mal formados no se guardan', 'directo', 'OK activa,-',
  $q$ select concat_ws(',', estado, coalesce(tarjeta_ultimos4, '-')) from public.suscripciones_flow where empresa_id = (select emp from zz_ctx) $q$,
  $p$ select pg_temp.base();
      select public.flow_preparar_suscripcion((select emp from zz_ctx), (select admin_id from zz_ctx), 'm', 'mensual');
      select public.flow_guardar_cliente((select emp from zz_ctx), 'cus_zz');
      select public.flow_activar_suscripcion('cus_zz', 'sub_zz', 'Visa', '4111111111111111') $p$);
select pg_temp.probar('una suscripción activa exige el identificador de Flow', 'directo', 'ERROR 23514',
  $q$ with i as (insert into public.suscripciones_flow (empresa_id, nivel, periodo, estado) values ((select emp from zz_ctx), 'm', 'mensual', 'activa') returning 1)
      select count(*)::text from i $q$);

-- ---------------- Cobros ----------------
select pg_temp.probar('cobro pagado: aplica el nivel y extiende hasta el fin del período', 'directo', 'OK mensual · m · 2030-02-01 · activa · 1 · 1',
  $q$ select pg_temp.foto() $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.cobro(1, 'pagado') $p$);
select pg_temp.probar('el mismo importe avisado dos veces no extiende dos veces', 'directo', 'OK false · mensual · m · 2030-02-01 · activa · 1 · 1',
  $q$ select (pg_temp.cobro(1, 'pagado', '2030-03-01 12:00+00') ->> 'aplicado') || ' · ' || pg_temp.foto() $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.cobro(1, 'pagado') $p$);
select pg_temp.probar('el siguiente importe sí extiende', 'directo', 'OK mensual · m · 2030-03-01 · activa · 2 · 2',
  $q$ select pg_temp.foto() $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.cobro(1, 'pagado');
      select pg_temp.cobro(2, 'pagado', '2030-03-01 12:00+00') $p$);
select pg_temp.probar('un cobro nunca acorta un vencimiento posterior', 'directo', 'OK mensual · m · 2030-06-01 · activa · 1 · 1',
  $q$ select pg_temp.foto() $q$,
  $p$ select pg_temp.base('2030-06-01 12:00+00'); select pg_temp.contratar(); select pg_temp.cobro(1, 'pagado') $p$);
select pg_temp.probar('cobro fallido: suscripción morosa y vencimiento intacto', 'directo', 'OK mensual · s · 2030-01-10 · morosa · 0 · 1',
  $q$ select pg_temp.foto() $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.cobro(1, 'fallido') $p$);
select pg_temp.probar('el reintento pagado del mismo importe regulariza', 'directo', 'OK mensual · m · 2030-02-01 · activa · 1 · 1',
  $q$ select pg_temp.foto() $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.cobro(1, 'fallido'); select pg_temp.cobro(1, 'pagado') $p$);
select pg_temp.probar('cobro pendiente no da acceso', 'directo', 'OK mensual · s · 2030-01-10 · activa · 0 · 1',
  $q$ select pg_temp.foto() $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.cobro(1, 'pendiente') $p$);
select pg_temp.probar('desde el período de prueba: pasa a mensual y termina la prueba', 'directo', 'OK mensual · m · 2030-02-01 · activa · 1 · 1 · -',
  $q$ select pg_temp.foto() || ' · ' || coalesce((select prueba_hasta::text from public.empresas where id = (select emp from zz_ctx)), '-') $q$,
  $p$ select pg_temp.base();
      update public.empresas set plan = 'prueba', prueba_hasta = now() + interval '5 days', plan_vence = null, plan_inicio = null
       where id = (select emp from zz_ctx);
      select pg_temp.contratar(); select pg_temp.cobro(1, 'pagado') $p$);
select pg_temp.probar('la renovación no pisa un nivel ajustado después', 'directo', 'OK mensual · l · 2030-03-01 · activa · 2 · 2',
  $q$ select pg_temp.foto() $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.cobro(1, 'pagado');
      select public.aplicar_nivel((select emp from zz_ctx), 'l');
      select pg_temp.cobro(2, 'pagado', '2030-03-01 12:00+00') $p$);
select pg_temp.probar('anual pagado: plan anual y Socio Pro Max por un año', 'directo', 'OK anual · l · 2031-01-01 · activa · 1 · 1',
  $q$ select pg_temp.foto() $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar('l', 'anual');
      select pg_temp.cobro(1, 'pagado', '2031-01-01 12:00+00', 330000) $p$);
select pg_temp.probar('el pago queda en el historial con el número de importe', 'directo', 'OK mensual,Flow · importe 41,-',
  $q$ select concat_ws(',', plan, nota, coalesce(registrado_por::text, '-')) from public.pagos_plan
       where empresa_id = (select emp from zz_ctx) and nota like 'Flow%' $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.cobro(41, 'pagado') $p$);
select pg_temp.probar('cobro de una suscripción desconocida se rechaza', 'directo', 'ERROR P0001: Suscripción de Flow desconocida',
  $q$ select public.flow_registrar_cobro('sub_nadie', 1, 20000, now(), now() + interval '1 month', 'pagado')::text $q$);
select pg_temp.probar('un importe de otra suscripción no se reasigna', 'directo', 'ERROR P0001: El importe pertenece a otra suscripción',
  $q$ select pg_temp.cobro(777, 'pagado')::text $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.otra() $p$);
select pg_temp.probar('estado de cobro inexistente se rechaza', 'directo', 'ERROR P0001: Estado de cobro inválido',
  $q$ select pg_temp.cobro(1, 'aprobado')::text $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar() $p$);
select pg_temp.probar('monto negativo se rechaza', 'directo', 'ERROR 23514',
  $q$ select pg_temp.cobro(1, 'pagado', '2030-02-01 12:00+00', -1)::text $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar() $p$);
select pg_temp.probar('período al revés se rechaza', 'directo', 'ERROR 23514',
  $q$ select pg_temp.cobro(1, 'pagado', '2029-01-01 12:00+00')::text $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar() $p$);

-- ---------------- Cancelación y estado ----------------
select pg_temp.probar('pedir la cancelación: sigue activa hasta el fin del período', 'directo', 'OK activa,t · mensual · m · 2030-02-01 · activa · 1 · 1',
  $q$ select (select concat_ws(',', estado, cancela_al_vencer) from public.suscripciones_flow where empresa_id = (select emp from zz_ctx))
             || ' · ' || pg_temp.foto() $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.cobro(1, 'pagado');
      select public.flow_sincronizar_suscripcion('sub_zz', 'activa', null, true) $p$);
select pg_temp.probar('cancelada en Flow: sin próximo cobro y el acceso pagado se conserva', 'directo', 'OK - · mensual · m · 2030-02-01 · cancelada · 1 · 1',
  $q$ select coalesce((select proximo_cobro::text from public.suscripciones_flow where empresa_id = (select emp from zz_ctx)), '-')
             || ' · ' || pg_temp.foto() $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.cobro(1, 'pagado');
      select public.flow_sincronizar_suscripcion('sub_zz', 'cancelada') $p$);
select pg_temp.probar('estado de suscripción inexistente se rechaza', 'directo', 'ERROR P0001: Estado de suscripción inválido',
  $q$ select public.flow_sincronizar_suscripcion('sub_zz', 'pausada')::text $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar() $p$);
select pg_temp.probar('sincronizar una suscripción desconocida se rechaza', 'directo', 'ERROR P0001: Suscripción de Flow desconocida',
  $q$ select public.flow_sincronizar_suscripcion('sub_nadie', 'activa')::text $q$);

-- ---------------- Cambio de precio: rige para todas las suscripciones ----------------
select pg_temp.probar('precio nuevo: la suscripción vigente pasa al plan nuevo', 'directo', 'OK msp-m-mensual-22000,m,mensual,activa',
  $q$ select concat_ws(',', flow_plan_id, nivel, periodo, estado) from public.suscripciones_flow where empresa_id = (select emp from zz_ctx) $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select public.flow_actualizar_plan('sub_zz', 'msp-m-mensual-22000') $p$);
select pg_temp.probar('el cambio de plan no toca el vencimiento ni el nivel', 'directo', 'OK mensual · s · 2030-01-10 · activa · 0 · 0',
  $q$ select pg_temp.foto() $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select public.flow_actualizar_plan('sub_zz', 'msp-m-mensual-22000') $p$);
select pg_temp.probar('un plan de otro nivel no se asigna', 'directo', 'ERROR P0001: Suscripción de Flow desconocida o el plan no corresponde a su nivel y período',
  $q$ select public.flow_actualizar_plan('sub_zz', 'msp-l-mensual-30000')::text $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar() $p$);
select pg_temp.probar('identificador de plan mal formado se rechaza', 'directo', 'ERROR P0001: Identificador de plan inválido',
  $q$ select public.flow_actualizar_plan('sub_zz', 'plan cualquiera')::text $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar() $p$);
select pg_temp.probar('una suscripción cancelada no cambia de plan', 'directo', 'ERROR P0001: Suscripción de Flow desconocida o el plan no corresponde a su nivel y período',
  $q$ select public.flow_actualizar_plan('sub_zz', 'msp-m-mensual-22000')::text $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select public.flow_sincronizar_suscripcion('sub_zz', 'cancelada') $p$);
select pg_temp.probar('el admin no llama a flow_actualizar_plan', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ select public.flow_actualizar_plan('sub_zz', 'msp-m-mensual-1')::text $q$);

-- ---------------- Lo manual sigue igual ----------------
select pg_temp.probar('registrar un pago a mano sigue funcionando con suscripción', 'directo', 'OK true',
  $q$ select (plan_vence > '2030-02-01 12:00+00')::text from public.empresas where id = (select emp from zz_ctx) $q$,
  $p$ select pg_temp.base(); select pg_temp.contratar(); select pg_temp.cobro(1, 'pagado');
      select public.registrar_pago_plan((select emp from zz_ctx), (select admin_id from zz_ctx), 'ZZ transferencia') $p$);

-- Resultado (aborta la transacción: nada queda guardado)
do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
