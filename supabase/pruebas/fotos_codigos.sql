-- ============================================================
-- Mi Socio Pyme · Pruebas: fotos en Storage y código de barras único — se REVIERTEN.
-- Uso: node scripts/sql-remoto.mjs supabase/pruebas/fotos_codigos.sql
-- ============================================================
create temp table zz_resultados (n serial, caso text, esperado text, obtenido text);

create function pg_temp.probar(p_caso text, p_usuario text, p_esperado text, p_sql text)
returns void language plpgsql as $$
declare v text; v_uid uuid;
begin
  begin
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

select pg_temp.probar('admin sube foto en la carpeta de su empresa', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with i as (insert into storage.objects (bucket_id, name, owner) values ('productos', public.mi_empresa()::text || '/zz.webp', auth.uid()) returning 1) select count(*)::text from i $q$);
select pg_temp.probar('no puede subir en la carpeta de otra empresa', '{{USUARIO_ADMIN}}', 'ERROR 42501',
  $q$ with i as (insert into storage.objects (bucket_id, name, owner) values ('productos', '00000000-0000-0000-0000-000000000000/zz.webp', auth.uid()) returning 1) select count(*)::text from i $q$);
select pg_temp.probar('juan (tienda, sin gestionar productos) no sube fotos', '{{USUARIO_TIENDA}}', 'ERROR 42501',
  $q$ with i as (insert into storage.objects (bucket_id, name, owner) values ('productos', public.mi_empresa()::text || '/zz2.webp', auth.uid()) returning 1) select count(*)::text from i $q$);
select pg_temp.probar('código de barras repetido en la empresa se rechaza', '{{USUARIO_ADMIN}}', 'ERROR 23505',
  $q$ with a as (update public.productos set codigo_barras = '2000000000015' where sku in ('BIS-001', 'BIS-002') and empresa_id = public.mi_empresa() returning 1) select count(*)::text from a $q$);
select pg_temp.probar('código de barras único se guarda', '{{USUARIO_ADMIN}}', 'OK 1',
  $q$ with a as (update public.productos set codigo_barras = '2000000000015' where sku = 'BIS-001' and empresa_id = public.mi_empresa() returning 1) select count(*)::text from a $q$);

do $$ begin
  raise exception 'RESULTADOS %', (select json_agg(json_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido) order by n) from zz_resultados);
end $$;
