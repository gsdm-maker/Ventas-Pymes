-- Aislamiento entre empresas: cada usuario de A no debe ver filas de B, y viceversa. Solo lectura; se revierte.
\set ON_ERROR_STOP on
begin;
create temp table zz (usuario text, tabla text, ajenas bigint, propias bigint) on commit drop;
grant insert on zz to authenticated;

do $$
declare
  u record; t record; v_ajenas bigint; v_propias bigint;
begin
  for u in select p.id, p.email, p.empresa_id from public.profiles p where p.email like '%@prueba.invalid' loop
    for t in
      select c.table_name from information_schema.columns c
       join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'empresa_id' and x.table_type = 'BASE TABLE'
      order by 1
    loop
      perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      begin
        execute format('select count(*) filter (where empresa_id is distinct from $1), count(*) filter (where empresa_id = $1) from public.%I', t.table_name)
          into v_ajenas, v_propias using u.empresa_id;
      exception when insufficient_privilege then
        v_ajenas := 0; v_propias := -1;
      end;
      perform set_config('role', 'none', true);
      insert into zz values (u.email, t.table_name, v_ajenas, v_propias);
    end loop;
  end loop;
end $$;

select count(distinct tabla) as tablas, count(*) as comprobaciones,
       count(*) filter (where ajenas > 0) as con_filas_ajenas,
       count(*) filter (where propias > 0) as con_filas_propias,
       count(*) filter (where propias = -1) as sin_permiso
  from zz;
select usuario, tabla, ajenas from zz where ajenas > 0 order by 1, 2;
rollback;
