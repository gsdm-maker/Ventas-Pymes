-- ============================================================
-- Mi Socio Pyme · 0004 · Datos de demostración
-- Función invocable por un Admin de empresa (o service_role).
-- Carga Boutique Aurora: bodega + 3 tiendas, categorías, productos y stock.
-- ============================================================
create or replace function public.sembrar_demo(p_empresa uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rol text := current_setting('request.jwt.claim.role', true);
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
  if v_rol <> 'service_role' and not public.es_admin_empresa(p_empresa) then
    raise exception 'Solo un administrador de la empresa puede cargar datos de demostración';
  end if;

  if exists (select 1 from public.ubicaciones where empresa_id = p_empresa) then
    raise exception 'La empresa ya tiene datos cargados';
  end if;

  -- Ubicaciones
  insert into public.ubicaciones (empresa_id, nombre, tipo) values (p_empresa, 'Bodega Principal', 'bodega') returning id into v_bodega;
  insert into public.ubicaciones (empresa_id, nombre, tipo, direccion) values (p_empresa, 'Tienda Centro', 'tienda', 'Av. Providencia 1234') returning id into v_t_centro;
  insert into public.ubicaciones (empresa_id, nombre, tipo, direccion) values (p_empresa, 'Tienda Mall', 'tienda', 'Mall Plaza, Local 210') returning id into v_t_mall;
  insert into public.ubicaciones (empresa_id, nombre, tipo, direccion) values (p_empresa, 'Tienda Outlet', 'tienda', 'Outlet Buenaventura KM 15') returning id into v_t_outlet;

  -- Categorías
  insert into public.categorias (empresa_id, nombre) values (p_empresa, 'Ropa') returning id into v_cat_ropa;
  insert into public.categorias (empresa_id, nombre) values (p_empresa, 'Bisutería') returning id into v_cat_bisu;
  insert into public.categorias (empresa_id, nombre) values (p_empresa, 'Carteras') returning id into v_cat_carteras;
  insert into public.categorias (empresa_id, nombre) values (p_empresa, 'Accesorios') returning id into v_cat_acc;

  -- Motivos de salida
  insert into public.motivos_salida (empresa_id, nombre) values
    (p_empresa, 'Venta en tienda'),
    (p_empresa, 'Merma'),
    (p_empresa, 'Uso interno'),
    (p_empresa, 'Devolución a proveedor');

  -- Unidades de medida
  insert into public.unidades_medida (empresa_id, codigo, nombre) values
    (p_empresa, 'UN', 'Unidad'), (p_empresa, 'PAR', 'Par'), (p_empresa, 'SET', 'Set');

  -- Proveedor
  insert into public.proveedores (empresa_id, nombre, contacto, telefono, email)
  values (p_empresa, 'Importadora Andina', 'Marcela Rojas', '+56 9 8123 4567', 'ventas@andina.cl')
  returning id into v_prov;

  -- Productos + stock
  -- (sku, nombre, categoria, marca, costo, precio, min, objetivo, foto)
  with datos as (
    select * from (values
      ('ROP-001', 'Vestido Lino Goa',           v_cat_ropa,     'Aurora', 12000, 25990, 5, 20, 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=600&q=70&auto=format&fit=crop'),
      ('ROP-002', 'Blusa Seda Otoño',           v_cat_ropa,     'Aurora',  9000, 19990, 5, 15, 'https://images.unsplash.com/photo-1551163943-3f6a855d1153?w=600&q=70&auto=format&fit=crop'),
      ('ROP-003', 'Pantalón Palazo Beige',      v_cat_ropa,     'Nómada',  9500, 22990, 4, 12, 'https://images.unsplash.com/photo-1509551388413-e18d0ac5d495?w=600&q=70&auto=format&fit=crop'),
      ('ROP-004', 'Chaqueta Denim Clásica',     v_cat_ropa,     'Nómada', 15000, 34990, 3, 10, 'https://images.unsplash.com/photo-1523205771623-e0faa4d2813d?w=600&q=70&auto=format&fit=crop'),
      ('BIS-001', 'Collar Baño de Oro',         v_cat_bisu,     'Lúnula',  3500,  9990, 6, 25, 'https://images.unsplash.com/photo-1611652022419-a9419f74343d?w=600&q=70&auto=format&fit=crop'),
      ('BIS-002', 'Aretes Jhumka Perla',        v_cat_bisu,     'Lúnula',  2500,  7490, 8, 30, 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=600&q=70&auto=format&fit=crop'),
      ('BIS-003', 'Pulsera Aro Minimalista',    v_cat_bisu,     'Lúnula',  1800,  5990, 8, 30, 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=600&q=70&auto=format&fit=crop'),
      ('CAR-001', 'Cartera Cuero Cognac',       v_cat_carteras, 'Cuoieria',38000, 79990, 3, 10, 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=600&q=70&auto=format&fit=crop'),
      ('CAR-002', 'Bandolera Mini Negra',       v_cat_carteras, 'Cuoieria',24000, 52990, 4, 12, 'https://images.unsplash.com/photo-1591561954557-26941169b49e?w=600&q=70&auto=format&fit=crop'),
      ('CAR-003', 'Mochila Canvas Natural',     v_cat_carteras, 'Nómada',  16000, 35990, 4, 12, 'https://images.unsplash.com/photo-1547949003-9792a18a2601?w=600&q=70&auto=format&fit=crop'),
      ('ACC-001', 'Lentes de Sol Carey',        v_cat_acc,      'Solari',   6000, 17990, 5, 20, 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=600&q=70&auto=format&fit=crop'),
      ('ACC-002', 'Cinturón Cuero Trenzado',    v_cat_acc,      'Cuoieria', 8000, 18990, 5, 20, 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600&q=70&auto=format&fit=crop'),
      ('ACC-003', 'Pañuelo Seda Estampado',     v_cat_acc,      'Aurora',   4000, 12990, 6, 24, 'https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=600&q=70&auto=format&fit=crop')
    ) as t(sku, nombre, categoria, marca, costo, precio, min, objetivo, foto)
  )
  insert into public.productos (empresa_id, sku, nombre, categoria_id, marca, foto_url, costo_referencia, precio_venta, stock_minimo, stock_objetivo)
  select p_empresa, sku, nombre, categoria, marca, foto, costo, precio, min, objetivo from datos;

  -- Existencias: bodega con volumen, tiendas con surtido (incluye críticos y agotados)
  for v_p in select id from public.productos where empresa_id = p_empresa loop
    insert into public.stock (empresa_id, producto_id, ubicacion_id, disponible, reservado, transito)
    values
      (p_empresa, v_p, v_bodega, 30 + (random() * 40)::int, 0, 0),
      (p_empresa, v_p, v_t_centro, 4 + (random() * 10)::int, 0, 0),
      (p_empresa, v_p, v_t_mall, 2 + (random() * 8)::int, 0, 0),
      (p_empresa, v_p, v_t_outlet, (random() * 6)::int, 0, 0);
  end loop;

  -- Fuerza algunos casos demostrativos (bajo stock y sin stock)
  update public.stock s set disponible = 1
   from public.productos p, public.ubicaciones u
  where s.producto_id = p.id and s.ubicacion_id = u.id
    and p.empresa_id = p_empresa and u.nombre = 'Tienda Centro' and p.sku = 'CAR-001';
  update public.stock s set disponible = 0
   from public.productos p, public.ubicaciones u
  where s.producto_id = p.id and s.ubicacion_id = u.id
    and p.empresa_id = p_empresa and u.nombre = 'Tienda Mall' and p.sku = 'ROP-004';
  update public.stock s set disponible = 0
   from public.productos p, public.ubicaciones u
  where s.producto_id = p.id and s.ubicacion_id = u.id
    and p.empresa_id = p_empresa and u.nombre = 'Tienda Outlet' and p.sku = 'ACC-003';
end $$;

revoke execute on function public.sembrar_demo(uuid) from anon, public;
grant execute on function public.sembrar_demo(uuid) to authenticated, service_role;
