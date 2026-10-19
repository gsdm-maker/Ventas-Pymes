-- ============================================================
-- Mi Socio Pyme · 0001 · Esquema base
-- ============================================================
create extension if not exists pgcrypto;

-- Fila única de configuración de la plataforma
create table if not exists plataforma (
  id int primary key default 1,
  contacto_suscripcion text[] not null default '{}',
  constraint plataforma_singleton check (id = 1)
);
insert into plataforma (id) values (1) on conflict do nothing;

-- Empresas (tenant)
create table if not exists empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  moneda text not null default 'CLP',
  plan text not null default 'prueba' check (plan in ('prueba', 'gratis', 'pago')),
  prueba_hasta timestamptz,
  modulos text[] not null default array[
    'dashboard','pos','salidas','ingreso','inventario','productos','bodega',
    'movimientos','reportes','usuarios','configuracion'
  ],
  created_at timestamptz not null default now()
);

-- Perfiles (extienden auth.users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nombre text not null default '',
  empresa_id uuid references empresas(id) on delete set null,
  role text not null default 'integrante' check (role in ('admin', 'integrante')),
  puesto text not null default 'tienda' check (puesto in ('admin', 'bodega', 'tienda', 'auditor')),
  es_owner boolean not null default false,
  activo boolean not null default true,
  must_change_password boolean not null default false,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Ubicaciones: bodegas y tiendas (árbol opcional para bodegas)
create table if not exists ubicaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  tipo text not null check (tipo in ('bodega', 'tienda')),
  parent_id uuid references ubicaciones(id) on delete set null,
  direccion text,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

-- Categorías / subcategorías
create table if not exists categorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  parent_id uuid references categorias(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Unidades de medida
create table if not exists unidades_medida (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  unique (empresa_id, codigo)
);

-- Productos
create table if not exists productos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  sku text not null,
  codigo_barras text,
  nombre text not null,
  descripcion text,
  categoria_id uuid references categorias(id) on delete set null,
  marca text,
  unidad_medida text not null default 'UN',
  foto_url text,
  precio_venta integer not null default 0 check (precio_venta >= 0),
  costo_referencia integer not null default 0 check (costo_referencia >= 0),
  stock_minimo integer not null default 0 check (stock_minimo >= 0),
  stock_objetivo integer not null default 0 check (stock_objetivo >= 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, sku)
);

-- Variantes (talla / color / modelo)
create table if not exists producto_variantes (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references productos(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  sku text not null,
  talla text,
  color text,
  modelo text,
  activa boolean not null default true,
  unique (empresa_id, sku)
);

-- Proveedores
create table if not exists proveedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  contacto text,
  telefono text,
  email text,
  activo boolean not null default true
);

-- Motivos de salida
create table if not exists motivos_salida (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Existencias por producto/variante y ubicación
create table if not exists stock (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  variante_id uuid references producto_variantes(id) on delete cascade,
  ubicacion_id uuid not null references ubicaciones(id) on delete cascade,
  disponible integer not null default 0 check (disponible >= 0),
  reservado integer not null default 0 check (reservado >= 0),
  transito integer not null default 0 check (transito >= 0),
  updated_at timestamptz not null default now()
);
create unique index if not exists stock_unico
  on stock (producto_id, coalesce(variante_id, '00000000-0000-0000-0000-000000000000'::uuid), ubicacion_id);

-- Movimientos (entradas, salidas, transferencias, ajustes)
create table if not exists movimientos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  uuid_local uuid not null,
  tipo text not null check (tipo in ('entrada', 'salida', 'transferencia', 'ajuste')),
  producto_id uuid not null references productos(id) on delete restrict,
  variante_id uuid references producto_variantes(id) on delete set null,
  ubicacion_origen_id uuid references ubicaciones(id) on delete set null,
  ubicacion_destino_id uuid references ubicaciones(id) on delete set null,
  cantidad integer not null check (cantidad > 0),
  motivo_id uuid references motivos_salida(id) on delete set null,
  referencia text,
  observaciones text,
  usuario_id uuid not null references profiles(id) on delete restrict,
  estado_sync text not null default 'sincronizado'
    check (estado_sync in ('local', 'sincronizado', 'rechazado')),
  created_at timestamptz not null default now(),
  unique (empresa_id, uuid_local)
);

-- Recepciones de mercadería
create table if not exists recepciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  proveedor_id uuid references proveedores(id) on delete set null,
  origen_texto text,
  ubicacion_destino_id uuid not null references ubicaciones(id) on delete restrict,
  observaciones text,
  usuario_id uuid not null references profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists recepcion_items (
  id uuid primary key default gen_random_uuid(),
  recepcion_id uuid not null references recepciones(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete restrict,
  variante_id uuid references producto_variantes(id) on delete set null,
  cantidad integer not null check (cantidad > 0),
  costo_unitario integer
);

-- Transferencias entre ubicaciones
create table if not exists transferencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  folio text not null,
  origen_id uuid not null references ubicaciones(id) on delete restrict,
  destino_id uuid not null references ubicaciones(id) on delete restrict,
  estado text not null default 'borrador' check (estado in (
    'borrador','pendiente_despacho','en_transito','recibida',
    'recibida_con_diferencias','cancelada'
  )),
  observaciones text,
  usuario_despacho_id uuid references profiles(id) on delete set null,
  usuario_recepcion_id uuid references profiles(id) on delete set null,
  despachada_at timestamptz,
  recibida_at timestamptz,
  created_at timestamptz not null default now(),
  unique (empresa_id, folio)
);

create table if not exists transferencia_items (
  id uuid primary key default gen_random_uuid(),
  transferencia_id uuid not null references transferencias(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete restrict,
  variante_id uuid references producto_variantes(id) on delete set null,
  cantidad_enviada integer not null check (cantidad_enviada > 0),
  cantidad_recibida integer,
  diferencia integer
);

-- Ventas (POS) — registro, sin pago real
create table if not exists ventas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  folio text not null,
  ubicacion_id uuid not null references ubicaciones(id) on delete restrict,
  usuario_id uuid not null references profiles(id) on delete restrict,
  descuento_tipo text not null default 'porcentaje'
    check (descuento_tipo in ('porcentaje', 'monto')),
  descuento_valor integer not null default 0 check (descuento_valor >= 0),
  neto integer not null default 0,
  iva integer not null default 0,
  total integer not null default 0,
  medio_pago text not null check (medio_pago in ('efectivo', 'transferencia', 'debito')),
  referencia_pago text,
  estado_sync text not null default 'sincronizado'
    check (estado_sync in ('local', 'sincronizado', 'rechazado')),
  created_at timestamptz not null default now(),
  unique (empresa_id, folio),
  constraint venta_referencia_pago check (
    (medio_pago = 'efectivo' and referencia_pago is null)
    or (medio_pago <> 'efectivo' and referencia_pago is not null)
  )
);

create table if not exists venta_items (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references ventas(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete restrict,
  variante_id uuid references producto_variantes(id) on delete set null,
  descripcion text not null,
  cantidad integer not null check (cantidad > 0),
  precio_unitario integer not null check (precio_unitario >= 0),
  total_linea integer not null check (total_linea >= 0)
);

-- Vouchers internos (comprobante de movimiento/venta/transferencia)
create table if not exists vouchers (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  numero text not null,
  tipo text not null check (tipo in ('movimiento', 'venta', 'transferencia')),
  referencia_id uuid not null,
  ubicacion_id uuid references ubicaciones(id) on delete set null,
  usuario_id uuid references profiles(id) on delete set null,
  detalle jsonb not null default '{}'::jsonb,
  estado_sync text not null default 'sincronizado'
    check (estado_sync in ('local', 'sincronizado', 'rechazado')),
  created_at timestamptz not null default now(),
  unique (empresa_id, numero)
);

-- Acceso de usuarios a ubicaciones
create table if not exists ubicacion_acceso (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  ubicacion_id uuid not null references ubicaciones(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  unique (user_id, ubicacion_id)
);

-- Auditoría administrativa (solo service_role)
create table if not exists admin_auditoria (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  accion text not null,
  objetivo_id uuid,
  detalle jsonb,
  empresa_id uuid,
  created_at timestamptz not null default now()
);

-- Índices útiles
create index if not exists idx_productos_empresa on productos (empresa_id);
create index if not exists idx_stock_empresa on stock (empresa_id);
create index if not exists idx_stock_ubicacion on stock (ubicacion_id);
create index if not exists idx_movimientos_empresa on movimientos (empresa_id, created_at desc);
create index if not exists idx_ventas_empresa on ventas (empresa_id, created_at desc);
create index if not exists idx_ubicaciones_empresa on ubicaciones (empresa_id);
create index if not exists idx_profiles_empresa on profiles (empresa_id);
