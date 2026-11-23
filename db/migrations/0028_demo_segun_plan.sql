successfully downloaded text file (SHA: 8de5dcc0b1991dad599fb56e60e6d71fa89f63e4)
-- ============================================================
-- Mi Socio Pyme · 0028 · Datos de demostración según el plan
-- - Solo el administrador general (o el servidor) carga el ejemplo; el admin de la empresa ya no.
-- - Sigue rechazándose si la empresa ya tiene locales: nunca toca datos reales.
-- - Respeta los topes del plan (0027): crea tantos locales como permita (Tienda Centro,
--   Bodega Principal, Tienda Mall, Tienda Outlet, en ese orden) y no más productos que el tope.
--   Antes creaba siempre 4 locales y con Socio (2) fallaba.
-- ============================================================

create or replace function public.sembrar_demo(p_empresa uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rol text := coalesce(auth.role(), '');
  v_max_ubic integer;
  v_max_prod integer;
  v_bodega uuid;
  v_t_centro uuid;
  v_t_mall uuid;
  v_t_outlet uuid;
  v_cat_ropa uuid;
  v_cat_bisu uuid;
  v_cat_carteras uuid;
  v_cat_acc uuid;
  v_prov uuid;
  v_p uuid;
begin
  if v_rol not in ('service_role', '') and not public.es_owner() then
    raise exception 'Solo el administrador general puede cargar datos de demostración';
  end if;

  if not exists (select 1 from public.empresas where id = p_empresa) then
    raise exception 'La empresa no existe';
  end if;

  if exists (select 1 from public.ubicaciones where empresa_id = p_empresa) then
    raise exception 'La empresa ya tiene datos cargados';
  end if;

  select t.max_ubicaciones, t.max_productos into v_max_ubic, v_max_prod
    from public._topes_empresa(p_empresa) t;
  v_max_ubic := least(coalesce(v_max_ubic, 4), 4);
  v_max_prod := least(coalesce(v_max_prod, 13), 13);

  -- Ubicaciones: primero una tienda (para vender) y luego la bodega
  insert into public.ubicaciones (empresa_id, nombre, tipo, direccion)
  values (p_empresa, 'Tienda Centro', 'tienda', 'Av. Providencia 1234') returning id into v_t_centro;
  if v_max_ubic >= 2 then
    insert into public.ubicaciones (empresa_id, nombre, tipo)
    values (p_empresa, 'Bodega Principal', 'bodega') returning id into v_bodega;
  end if;
  if v_max_ubic >= 3 then
    insert into public.ubicaciones (empresa_id, nombre, tipo, direccion)
    values (p_empresa, 'Tienda Mall', 'tienda', 'Mall Plaza, Local 210') returning id into v_t_mall;
  end if;
  if v_max_ubic >= 4 then
    insert into public.ubicaciones (empresa_id, nombre, tipo, direccion)
    values (p_empresa, 'Tienda Outlet', 'tienda', 'Outlet Buenaventura KM 15') returning id into v_t_outlet;
  end if;

  -- Categorías
  insert into public.categorias (empresa_id, nombre) values (p_empresa, 'Ropa') returning id into v_cat_ropa;
  insert into public.categorias (empresa_id, nombre) values (p_empresa, 'Bisutería') returning id into v_cat_bisu;
  insert into public.categorias (empresa_id, nombre) values (p_empresa, 'Carteras') returning id into v_cat_carteras;
  insert into public.categorias (empresa_id, nombre) values (p_empresa, 'Accesorios') returning id into v_cat_acc;

  -- Motivos de salida y unidades de medida: solo los que falten (vaciar_empresa los conserva)
  insert into public.motivos_salida (empresa_id, nombre)
  select p_empresa, m from unnest(array['Venta en tienda', 'Merma', 'Uso interno', 'Devolución a proveedor']) m
   where not exists (select 1 from public.motivos_salida x where x.empresa_id = p_empresa and lower(x.nombre) = lower(m));

  insert into public.unidades_medida (empresa_id, codigo, nombre)
  select p_empresa, c, n from (values ('UN', 'Unidad'), ('PAR', 'Par'), ('SET', 'Set')) u(c, n)
   where not exists (select 1 from public.unidades_medida x where x.empresa_id = p_empresa and x.codigo = c);

  -- Proveedor
  insert into public.proveedores (empresa_id, nombre, contacto, telefono, email)
  values (p_empresa, 'Importadora Andina', 'Marcela Rojas', '+56 9 8123 4567', 'ventas@andina.cl')
  returning id into v_prov;

  -- Productos (hasta el tope del plan)
  -- (orden, sku, nombre, categoria, marca, costo, precio, min, objetivo, foto)
  with datos as (
    select * from (values
      (1,  'ROP-001', 'Vestido Lino Goa',           v_cat_ropa,     'Aurora', 12000, 25990, 5, 20, 'https://images.unsplash.com/photo-1509551388413-e18d0ac5d495?w=600&q=70&auto=format&fit=crop'),
      (2,  'ROP-002', 'Blusa Seda Otoño',           v_cat_ropa,     'Aurora',  9000, 19990, 5, 15, 'https://images.unsplash.com/photo-1551163943-3f6a855d1153?w=600&q=70&auto=format&fit=crop'),
      (3,  'ROP-003', 'Pantalón Palazo Beige',      v_cat_ropa,     'Nómada',  9500, 22990, 4, 12, 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=600&q=70&auto=format&fit=crop'),
      (4,  'ROP-004', 'Chaqueta Denim Clásica',     v_cat_ropa,     'Nómada', 15000, 34990, 3, 10, 'https://images.unsplash.com/photo-1523205771623-e0faa4d2813d?w=600&q=70&auto=format&fit=crop'),
      (5,  'BIS-001', 'Collar Baño de Oro',         v_cat_bisu,     'Lúnula',  3500,  9990, 6, 25, 'https://images.unsplash.com/photo-1611652022419-a9419f74343d?w=600&q=70&auto=format&fit=crop'),
      (6,  'BIS-002', 'Aretes Jhumka Perla',        v_cat_bisu,     'Lúnula',  2500,  7490, 8, 30, 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=600&q=70&auto=format&fit=crop'),
      (7,  'BIS-003', 'Pulsera Aro Minimalista',    v_cat_bisu,     'Lúnula',  1800,  5990, 8, 30, 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=600&q=70&auto=format&fit=crop'),
      (8,  'CAR-001', 'Cartera Cuero Cognac',       v_cat_carteras, 'Cuoieria',38000, 79990, 3, 10, 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=600&q=70&auto=format&fit=crop'),
      (9,  'CAR-002', 'Bandolera Mini Negra',       v_cat_carteras, 'Cuoieria',24000, 52990, 4, 12, 'https://images.unsplash.com/photo-1591561954557-26941169b49e?w=600&q=70&auto=format&fit=crop'),
      (10, 'CAR-003', 'Mochila Canvas Natural',     v_cat_carteras, 'Nómada',  16000, 35990, 4, 12, 'https://images.unsplash.com/photo-1547949003-9792a18a2601?w=600&q=70&auto=format&fit=crop'),
      (11, 'ACC-001', 'Lentes de Sol Carey',        v_cat_acc,      'Solari',   6000, 17990, 5, 20, 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=600&q=70&auto=format&fit=crop'),
      (12, 'ACC-002', 'Cinturón Cuero Trenzado',    v_cat_acc,      'Cuoieria', 8000, 18990, 5, 20, null),
      (13, 'ACC-003', 'Pañuelo Seda Estampado',     v_cat_acc,      'Aurora',   4000, 12990, 6, 24, 'https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=600&q=70&auto=format&fit=crop')
    ) as t(orden, sku, nombre, categoria, marca, costo, precio, min, objetivo, foto)
  )
  insert into public.productos (empresa_id, sku, nombre, categoria_id, marca, foto_url, costo_referencia, precio_venta, stock_minimo, stock_objetivo)
  select p_empresa, sku, nombre, categoria, marca, foto, costo, precio, min, objetivo
    from datos where orden <= v_max_prod order by orden;

  -- Existencias: bodega con volumen, tiendas con surtido (incluye críticos y agotados)
  for v_p in select id from public.productos where empresa_id = p_empresa loop
    insert into public.stock (empresa_id, producto_id, ubicacion_id, disponible, reservado, transito)
    values (p_empresa, v_p, v_t_centro, 4 + (random() * 10)::int, 0, 0);
    if v_bodega is not null then
      insert into public.stock (empresa_id, producto_id, ubicacion_id, disponible, reservado, transito)
      values (p_empresa, v_p, v_bodega, 30 + (random() * 40)::int, 0, 0);
    end if;
    if v_t_mall is not null then
      insert into public.stock (empresa_id, producto_id, ubicacion_id, disponible, reservado, transito)
      values (p_empresa, v_p, v_t_mall, 2 + (random() * 8)::int, 0, 0);
    end if;
    if v_t_outlet is not null then
      insert into public.stock (empresa_id, producto_id, ubicacion_id, disponible, reservado, transito)
      values (p_empresa, v_p, v_t_outlet, (random() * 6)::int, 0, 0);
    end if;
  end loop;

  -- Fuerza algunos casos demostrativos (bajo stock y sin stock), si existen
  update public.stock s set disponible = 1
   from public.productos p
  where s.producto_id = p.id and s.ubicacion_id = v_t_centro
    and p.empresa_id = p_empresa and p.sku = 'CAR-001';
  update public.stock s set disponible = 0
   from public.productos p
  where s.producto_id = p.id and s.ubicacion_id = v_t_mall
    and p.empresa_id = p_empresa and p.sku = 'ROP-004';
  update public.stock s set disponible = 0
   from public.productos p
  where s.producto_id = p.id and s.ubicacion_id = v_t_outlet
    and p.empresa_id = p_empresa and p.sku = 'ACC-003';
end $$;

revoke execute on function public.sembrar_demo(uuid) from anon, public;
grant execute on function public.sembrar_demo(uuid) to authenticated, service_role;

-- ============================================================
-- Empezar de cero: borra los datos de operación de una empresa (los del ejemplo o las pruebas)
-- y deja la empresa lista para cargar los reales.
-- - Solo el administrador general (o el servidor). Hay que escribir el nombre de la empresa.
-- - Borra: ventas, devoluciones, cuentas y comandas, mesas, vouchers, recepciones,
--   transferencias, movimientos, stock, productos y variantes, categorías, proveedores,
--   locales y los accesos de cada usuario a esos locales.
-- - Conserva: la empresa (plan, membresía, módulos, marca), los usuarios, los motivos de
--   salida, las unidades de medida, los pagos del plan y el uso del asistente.
-- - Queda en admin_auditoria con lo que se borró.
-- ============================================================
create or replace function public.vaciar_empresa(p_empresa uuid, p_confirmacion text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rol text := coalesce(auth.role(), '');
  v_nombre text;
  v_res jsonb;
begin
  if v_rol not in ('service_role', '') and not public.es_owner() then
    raise exception 'Solo el administrador general puede vaciar una empresa';
  end if;

  select nombre into v_nombre from public.empresas where id = p_empresa;
  if v_nombre is null then
    raise exception 'La empresa no existe';
  end if;
  if lower(btrim(coalesce(p_confirmacion, ''))) <> lower(btrim(v_nombre)) then
    raise exception 'Para confirmar, escribe el nombre exacto de la empresa: %', v_nombre;
  end if;

  v_res := jsonb_build_object(
    'ventas',      (select count(*) from public.ventas where empresa_id = p_empresa),
    'movimientos', (select count(*) from public.movimientos where empresa_id = p_empresa),
    'productos',   (select count(*) from public.productos where empresa_id = p_empresa),
    'locales',     (select count(*) from public.ubicaciones where empresa_id = p_empresa));

  -- Del más dependiente al más general (las restricciones «restrict» obligan a este orden)
  delete from public.devolucion_items di using public.devoluciones d
   where di.devolucion_id = d.id and d.empresa_id = p_empresa;
  delete from public.devoluciones where empresa_id = p_empresa;
  delete from public.cuentas where empresa_id = p_empresa;          -- arrastra comandas e ítems
  delete from public.venta_items vi using public.ventas v
   where vi.venta_id = v.id and v.empresa_id = p_empresa;
  delete from public.ventas where empresa_id = p_empresa;
  delete from public.vouchers where empresa_id = p_empresa;
  delete from public.recepcion_items ri using public.recepciones r
   where ri.recepcion_id = r.id and r.empresa_id = p_empresa;
  delete from public.recepciones where empresa_id = p_empresa;
  delete from public.transferencia_items ti using public.transferencias t
   where ti.transferencia_id = t.id and t.empresa_id = p_empresa;
  delete from public.transferencias where empresa_id = p_empresa;
  delete from public.movimientos where empresa_id = p_empresa;
  delete from public.stock where empresa_id = p_empresa;
  delete from public.producto_variantes where empresa_id = p_empresa;
  delete from public.productos where empresa_id = p_empresa;
  delete from public.categorias where empresa_id = p_empresa;
  delete from public.proveedores where empresa_id = p_empresa;
  delete from public.mesas where empresa_id = p_empresa;
  delete from public.ubicacion_acceso where empresa_id = p_empresa;
  delete from public.ubicaciones where empresa_id = p_empresa;

  insert into public.admin_auditoria (actor_id, accion, objetivo_id, detalle, empresa_id)
  values (auth.uid(), 'vaciar_empresa', p_empresa, v_res, p_empresa);

  return v_res;
end $$;

revoke execute on function public.vaciar_empresa(uuid, text) from anon, public;
grant execute on function public.vaciar_empresa(uuid, text) to authenticated, service_role;
