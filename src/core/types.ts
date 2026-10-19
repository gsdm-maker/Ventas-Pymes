/**
 * Tipos de dominio de Mi Socio Pyme (espejo del esquema en supabase/migrations).
 * El cliente de Supabase se usa sin genéricos para simplificar; estas
 * interfaces tipan los resultados en la capa de datos.
 */

export type Plan = 'prueba' | 'gratis' | 'pago'
export type RolEmpresa = 'admin' | 'integrante'
export type Puesto = 'admin' | 'bodega' | 'tienda' | 'auditor'
export type TipoUbicacion = 'bodega' | 'tienda'
export type TipoMovimiento = 'entrada' | 'salida' | 'transferencia' | 'ajuste'
export type EstadoSync = 'local' | 'sincronizado' | 'rechazado'
export type EstadoTransferencia =
  | 'borrador'
  | 'pendiente_despacho'
  | 'en_transito'
  | 'recibida'
  | 'recibida_con_diferencias'
  | 'cancelada'
export type MedioPago = 'efectivo' | 'transferencia' | 'debito'
export type TipoNegocio = 'retail' | 'restaurante'
export type EstadoStock = 'ok' | 'bajo' | 'sin' | 'exceso'

export interface Empresa {
  id: string
  nombre: string
  moneda: string
  plan: Plan
  prueba_hasta: string | null
  modulos: string[]
  reposicion?: ParametrosReposicion
  /** retail | restaurante: valor por defecto de controla_stock en productos nuevos */
  tipo_negocio?: TipoNegocio
  /** Tallas y colores (variantes) habilitados */
  usa_variantes?: boolean
  created_at: string
}

/** Parámetros de la proyección de reposición (empresas.reposicion). */
export interface ParametrosReposicion {
  semanas: number
  seguridad_pct: number
  ajuste_pct: number
}

export interface Profile {
  id: string
  email: string
  nombre: string
  empresa_id: string | null
  role: RolEmpresa
  puesto: Puesto
  es_owner: boolean
  activo: boolean
  must_change_password: boolean
  permissions: Record<string, boolean>
  created_at: string
}

export interface Ubicacion {
  id: string
  empresa_id: string
  nombre: string
  tipo: TipoUbicacion
  parent_id: string | null
  direccion: string | null
  activa: boolean
  created_at: string
}

export interface Categoria {
  id: string
  empresa_id: string
  nombre: string
  parent_id: string | null
  created_at: string
}

export interface Producto {
  id: string
  empresa_id: string
  sku: string
  codigo_barras: string | null
  nombre: string
  descripcion: string | null
  categoria_id: string | null
  marca: string | null
  unidad_medida: string
  foto_url: string | null
  precio_venta: number
  costo_referencia: number
  stock_minimo: number
  stock_objetivo: number
  /** false: se vende sin llevar existencias (platos, servicios) */
  controla_stock: boolean
  activo: boolean
  created_at: string
}

export interface ProductoVariante {
  id: string
  producto_id: string
  empresa_id: string
  sku: string
  talla: string | null
  color: string | null
  modelo: string | null
  activa: boolean
}

export interface Proveedor {
  id: string
  empresa_id: string
  nombre: string
  contacto: string | null
  telefono: string | null
  email: string | null
  activo: boolean
}

export interface MotivoSalida {
  id: string
  empresa_id: string
  nombre: string
  activo: boolean
  created_at: string
}

export interface UnidadMedida {
  id: string
  empresa_id: string
  codigo: string
  nombre: string
}

export interface Stock {
  id: string
  empresa_id: string
  producto_id: string
  variante_id: string | null
  ubicacion_id: string
  disponible: number
  reservado: number
  transito: number
  updated_at: string
}

export interface Movimiento {
  id: string
  empresa_id: string
  uuid_local: string
  tipo: TipoMovimiento
  producto_id: string
  variante_id: string | null
  ubicacion_origen_id: string | null
  ubicacion_destino_id: string | null
  cantidad: number
  motivo_id: string | null
  referencia: string | null
  observaciones: string | null
  usuario_id: string
  estado_sync: EstadoSync
  created_at: string
}

export interface Recepcion {
  id: string
  empresa_id: string
  proveedor_id: string | null
  origen_texto: string | null
  ubicacion_destino_id: string
  observaciones: string | null
  usuario_id: string
  created_at: string
}

export interface RecepcionItem {
  id: string
  recepcion_id: string
  producto_id: string
  variante_id: string | null
  cantidad: number
  costo_unitario: number | null
}

export interface Transferencia {
  id: string
  empresa_id: string
  folio: string
  origen_id: string
  destino_id: string
  estado: EstadoTransferencia
  observaciones: string | null
  usuario_despacho_id: string | null
  usuario_recepcion_id: string | null
  despachada_at: string | null
  recibida_at: string | null
  created_at: string
}

export interface TransferenciaItem {
  id: string
  transferencia_id: string
  producto_id: string
  variante_id: string | null
  cantidad_enviada: number
  cantidad_recibida: number | null
  diferencia: number | null
}

export interface Venta {
  id: string
  empresa_id: string
  folio: string
  ubicacion_id: string
  usuario_id: string
  descuento_tipo: 'porcentaje' | 'monto'
  descuento_valor: number
  neto: number
  iva: number
  total: number
  medio_pago: MedioPago
  referencia_pago: string | null
  estado_sync: EstadoSync
  estado: EstadoVenta
  monto_devuelto: number
  /** Restaurante: propina (fuera del total), cuenta y garzón */
  propina?: number
  cuenta_id?: string | null
  garzon_id?: string | null
  created_at: string
}

export type EstadoVenta = 'vigente' | 'devuelta_parcial' | 'anulada'

export interface Devolucion {
  id: string
  venta_id: string
  ubicacion_id: string
  folio: string
  tipo: 'anulacion' | 'devolucion'
  motivo: string
  total: number
  usuario_id: string
  created_at: string
}

export interface VentaItem {
  id: string
  venta_id: string
  producto_id: string
  variante_id: string | null
  descripcion: string
  cantidad: number
  precio_unitario: number
  total_linea: number
  cantidad_devuelta: number
}

export interface Voucher {
  id: string
  empresa_id: string
  numero: string
  tipo: 'movimiento' | 'venta' | 'transferencia'
  referencia_id: string
  ubicacion_id: string | null
  usuario_id: string | null
  detalle: Record<string, unknown>
  estado_sync: EstadoSync
  created_at: string
}

export interface UbicacionAcceso {
  id: string
  user_id: string
  ubicacion_id: string
  empresa_id: string
}

export interface AdminAuditoria {
  id: string
  actor_id: string | null
  accion: string
  objetivo_id: string | null
  detalle: Record<string, unknown> | null
  empresa_id: string | null
  created_at: string
}

export interface VarianteConStock extends ProductoVariante {
  disponible: number
  reservado: number
  transito: number
}

export interface ProductoConStock extends Producto {
  categoria_nombre?: string | null
  /** Total del producto (todas las variantes y el stock antiguo sin talla) */
  disponible: number
  reservado: number
  transito: number
  estado_stock: EstadoStock
  /** Tallas/colores activos con su stock; vacío si el producto no tiene variantes */
  variantes: VarianteConStock[]
  /** Stock antiguo sin talla de un producto que ya tiene variantes */
  legado: number
}

export type EstadoReposicion = 'quebrado' | 'por_quebrar' | 'bajo_minimo' | 'ok'

/** Fila de proyeccion_reposicion(): un producto en una ubicación. Fechas como 'AAAA-MM-DD'. */
export interface FilaReposicion {
  producto_id: string
  variante_id: string | null
  /** «M · Negro» o null */
  variante: string | null
  ubicacion_id: string
  ubicacion_nombre: string
  ubicacion_tipo: TipoUbicacion
  nombre: string
  sku: string
  foto_url: string | null
  categoria: string | null
  stock_minimo: number
  disponible: number
  transito: number
  vendido_hoy: number
  prom_diario: number
  /** Venta promedio esperada de lunes (0) a domingo (6) */
  prom_por_dia: number[]
  demanda_periodo: number
  seguridad: number
  objetivo: number
  sugerido: number
  desde_bodega: number
  comprar: number
  bodega_origen_id: string | null
  bodega_disponible: number
  fecha_quiebre: string | null
  dias_cobertura: number | null
  estado: EstadoReposicion
  con_historia: boolean
  detalle: { fecha: string; demanda: number }[]
  hoy: string
  hasta: string
  semanas_usadas: number
  factor_temporada: number
}

/** Resultado de reporte_ventas(). Fechas 'AAAA-MM-DD'; montos en CLP. */
export interface ReporteVentas {
  desde: string
  hasta: string
  dias: number
  anterior: { desde: string; hasta: string }
  totales: {
    monto: number
    neto: number
    iva: number
    tickets: number
    unidades: number
    monto_ant: number
    tickets_ant: number
    unidades_ant: number
  }
  tiendas: {
    id: string
    nombre: string
    monto: number
    tickets: number
    unidades: number
    monto_ant: number
    tickets_ant: number
    unidades_ant: number
  }[]
  por_dia: { fecha: string; tienda: string; monto: number }[]
  /** dow: 1 = lunes … 7 = domingo */
  por_dia_semana: { tienda: string; dow: number; monto_prom: number }[]
  top_productos: { id: string; nombre: string; sku: string; foto_url: string | null; unidades: number; monto: number }[]
  medios: { medio: MedioPago; monto: number; tickets: number }[]
  categorias: { categoria: string; monto: number; unidades: number }[]
}

// ---------------- Restaurante ----------------
export interface Mesa {
  id: string
  empresa_id: string
  ubicacion_id: string
  nombre: string
  zona: string | null
  capacidad: number
  orden: number
  activa: boolean
}

export type EstadoComanda = 'pendiente' | 'preparando' | 'lista' | 'entregada' | 'anulada'

export interface Cuenta {
  id: string
  ubicacion_id: string
  mesa_id: string
  estado: 'abierta' | 'cobrada' | 'anulada'
  comensales: number | null
  garzon_id: string
  venta_id: string | null
  abierta_at: string
}

export interface Comanda {
  id: string
  ubicacion_id: string
  cuenta_id: string
  numero: number
  estado: EstadoComanda
  usuario_id: string
  created_at: string
  actualizada_at: string
}

export interface CuentaItem {
  id: string
  cuenta_id: string
  comanda_id: string
  producto_id: string
  variante_id: string | null
  descripcion: string
  cantidad: number
  precio_unitario: number
  nota: string | null
  anulado: boolean
  created_at: string
}
