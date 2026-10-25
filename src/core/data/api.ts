import { supabase } from '@/core/supabase/client'
import { conRespaldo } from '@/core/offline/respaldo'
import { compararVariantes } from '@/lib/variantes'
import type {
  Categoria,
  Comanda,
  Cuenta,
  CuentaItem,
  Mesa,
  Empresa,
  EstadoStock,
  FilaReposicion,
  ReporteVentas,
  Movimiento,
  MotivoSalida,
  Producto,
  ProductoConStock,
  ProductoVariante,
  VarianteConStock,
  Profile,
  Proveedor,
  Stock,
  Transferencia,
  Venta,
  Voucher
} from '@/core/types'

function estadoStock(disponible: number, minimo: number, controla = true): EstadoStock {
  if (!controla) return 'ok'
  if (disponible <= 0) return 'sin'
  if (disponible <= minimo) return 'bajo'
  return 'ok'
}

export async function listarEmpresas(): Promise<Empresa[]> {
  const { data } = await supabase.from('empresas').select('*').order('nombre')
  return (data as Empresa[]) ?? []
}

export async function listarUbicaciones() {
  const { data } = await supabase
    .from('ubicaciones')
    .select('*')
    .order('tipo')
    .order('nombre')
  return data ?? []
}

export async function listarCategorias(): Promise<Categoria[]> {
  return conRespaldo('categorias', async () => {
    const { data, error } = await supabase.from('categorias').select('*').order('nombre')
    if (error) throw error
    return (data as Categoria[]) ?? []
  })
}

export async function listarProveedores(): Promise<Proveedor[]> {
  const { data } = await supabase.from('proveedores').select('*').order('nombre')
  return (data as Proveedor[]) ?? []
}

export async function listarMotivos(): Promise<MotivoSalida[]> {
  return conRespaldo('motivos', async () => {
    const { data, error } = await supabase
      .from('motivos_salida')
      .select('*')
      .eq('activo', true)
      .order('nombre')
    if (error) throw error
    return (data as MotivoSalida[]) ?? []
  })
}

/**
 * Productos con existencias y estado calculado para una ubicación concreta.
 * Queda una copia local por usuario y ubicación para vender sin conexión.
 */
export async function listarProductosConStock(
  ubicacionId: string | null
): Promise<ProductoConStock[]> {
  return conRespaldo(`productos:${ubicacionId ?? 'todas'}`, () => cargarProductosConStock(ubicacionId))
}

async function cargarProductosConStock(ubicacionId: string | null): Promise<ProductoConStock[]> {
  let stockQuery = supabase.from('stock').select('*')
  if (ubicacionId) stockQuery = stockQuery.eq('ubicacion_id', ubicacionId)
  // Las cuatro consultas son independientes: en paralelo, un solo viaje de espera
  const [
    { data: productos, error: e1 },
    { data: categorias, error: e2 },
    { data: stock, error: e3 },
    { data: variantes, error: e4 }
  ] = await Promise.all([
    supabase.from('productos').select('*').order('nombre'),
    supabase.from('categorias').select('id, nombre'),
    stockQuery,
    supabase.from('producto_variantes').select('*').eq('activa', true).order('sku')
  ])
  const error = e1 ?? e2 ?? e3 ?? e4
  if (error) throw error

  // Stock por variante y stock antiguo sin talla
  const porVariante = new globalThis.Map<string, { disponible: number; reservado: number; transito: number }>()
  const sinVariante = new globalThis.Map<string, number>()
  for (const s of (stock ?? []) as Stock[]) {
    if (s.variante_id) {
      const a = porVariante.get(s.variante_id) ?? { disponible: 0, reservado: 0, transito: 0 }
      a.disponible += s.disponible
      a.reservado += s.reservado
      a.transito += s.transito
      porVariante.set(s.variante_id, a)
    } else {
      sinVariante.set(s.producto_id, (sinVariante.get(s.producto_id) ?? 0) + s.disponible)
    }
  }
  const variantesDe = new globalThis.Map<string, VarianteConStock[]>()
  for (const v of (variantes ?? []) as ProductoVariante[]) {
    const st = porVariante.get(v.id) ?? { disponible: 0, reservado: 0, transito: 0 }
    variantesDe.set(v.producto_id, [...(variantesDe.get(v.producto_id) ?? []), { ...v, ...st }])
  }
  for (const lista of variantesDe.values()) lista.sort(compararVariantes)

  const catMap = new globalThis.Map((categorias ?? []).map((c) => [c.id, c.nombre]))
  const stockMap = new globalThis.Map<string, Stock>()
  for (const s of (stock ?? []) as Stock[]) {
    const actual = stockMap.get(s.producto_id)
    if (!actual) stockMap.set(s.producto_id, { ...s })
    else {
      actual.disponible += s.disponible
      actual.reservado += s.reservado
      actual.transito += s.transito
    }
  }

  return ((productos ?? []) as Producto[]).map((p) => {
    const s = stockMap.get(p.id)
    const disponible = s?.disponible ?? 0
    return {
      ...p,
      categoria_nombre: p.categoria_id ? catMap.get(p.categoria_id) ?? null : null,
      disponible,
      reservado: s?.reservado ?? 0,
      transito: s?.transito ?? 0,
      estado_stock: estadoStock(disponible, p.stock_minimo, p.controla_stock !== false),
      variantes: variantesDe.get(p.id) ?? [],
      legado: variantesDe.has(p.id) ? sinVariante.get(p.id) ?? 0 : 0
    }
  })
}

export interface ResumenDashboard {
  productosActivos: number
  unidadesDisponibles: number
  bajoMinimo: number
  sinStock: number
  transferenciasPendientes: number
  movimientosPendientes: number
  /** Ventas sincronizadas sin stock suficiente en los últimos 7 días */
  ventasConDiferencia: number
  criticos: ProductoConStock[]
  porUbicacion: { ubicacion: string; unidades: number }[]
}

export async function resumenDashboard(ubicacionId: string | null): Promise<ResumenDashboard> {
  // Todas las consultas son independientes: en paralelo
  const [
    productos,
    { data: transf },
    { data: pendSync },
    { count: conDiferencia },
    { data: ubicaciones },
    { data: stockAll }
  ] = await Promise.all([
    listarProductosConStock(ubicacionId),
    supabase.from('transferencias').select('estado').in('estado', ['pendiente_despacho', 'en_transito']),
    supabase.from('movimientos').select('id').eq('estado_sync', 'local'),
    supabase
      .from('ventas')
      .select('id', { count: 'exact', head: true })
      .eq('con_diferencia', true)
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
    supabase.from('ubicaciones').select('id, nombre'),
    supabase.from('stock').select('ubicacion_id, disponible')
  ])
  const activos = productos.filter((p) => p.activo)
  const ubiMap = new globalThis.Map((ubicaciones ?? []).map((u) => [u.id, u.nombre]))
  const acc = new globalThis.Map<string, number>()
  for (const s of stockAll ?? []) {
    const nombre = ubiMap.get(s.ubicacion_id as string) ?? '—'
    acc.set(nombre, (acc.get(nombre) ?? 0) + (s.disponible as number))
  }

  return {
    productosActivos: activos.length,
    unidadesDisponibles: activos.reduce((a, p) => a + p.disponible, 0),
    bajoMinimo: activos.filter((p) => p.estado_stock === 'bajo').length,
    sinStock: activos.filter((p) => p.estado_stock === 'sin').length,
    transferenciasPendientes: (transf ?? []).length,
    movimientosPendientes: (pendSync ?? []).length,
    ventasConDiferencia: conDiferencia ?? 0,
    criticos: activos
      .filter((p) => p.estado_stock !== 'ok')
      .sort((a, b) => a.disponible - b.disponible)
      .slice(0, 8),
    porUbicacion: [...acc.entries()].map(([ubicacion, unidades]) => ({ ubicacion, unidades }))
  }
}

export async function listarMovimientos(filtros?: {
  desde?: string
  tipo?: string
}): Promise<Movimiento[]> {
  let q = supabase
    .from('movimientos')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300)
  if (filtros?.tipo) q = q.eq('tipo', filtros.tipo)
  if (filtros?.desde) q = q.gte('created_at', filtros.desde)
  const { data } = await q
  return (data as Movimiento[]) ?? []
}

export async function listarVentas(): Promise<Venta[]> {
  const { data } = await supabase
    .from('ventas')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  return (data as Venta[]) ?? []
}

export async function listarVouchers(): Promise<Voucher[]> {
  const { data } = await supabase
    .from('vouchers')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  return (data as Voucher[]) ?? []
}

export async function listarTransferencias(): Promise<Transferencia[]> {
  const { data } = await supabase
    .from('transferencias')
    .select('*')
    .order('created_at', { ascending: false })
  return (data as Transferencia[]) ?? []
}

export async function listarUsuarios(): Promise<Profile[]> {
  const { data } = await supabase.from('profiles').select('*').order('nombre')
  return (data as Profile[]) ?? []
}

export async function listarAccesos() {
  const { data } = await supabase.from('ubicacion_acceso').select('*')
  return data ?? []
}

/** Ubicaciones autorizadas por usuario (sin entrada = todas). */
export async function accesosPorUsuario(empresaId?: string): Promise<Record<string, string[]>> {
  let q = supabase.from('ubicacion_acceso').select('user_id, ubicacion_id')
  if (empresaId) q = q.eq('empresa_id', empresaId)
  const { data } = await q
  const m: Record<string, string[]> = {}
  for (const a of (data ?? []) as { user_id: string; ubicacion_id: string }[]) {
    ;(m[a.user_id] ??= []).push(a.ubicacion_id)
  }
  return m
}

/** null = todas las ubicaciones. Devuelve el mensaje de error, si lo hay. */
export async function actualizarUbicacionesUsuario(userId: string, ubicaciones: string[] | null): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body: { accion: 'actualizar_ubicaciones', user_id: userId, ubicaciones: ubicaciones ?? [] }
  })
  return (data as { error?: string } | null)?.error ?? error?.message ?? null
}

export async function evolucionMovimientos(ubicacionId: string | null) {
  let q = supabase
    .from('movimientos')
    .select('tipo, created_at')
    .gte('created_at', new Date(Date.now() - 13 * 86400000).toISOString())
  if (ubicacionId) {
    q = q.or(`ubicacion_origen_id.eq.${ubicacionId},ubicacion_destino_id.eq.${ubicacionId}`)
  }
  const { data } = await q
  const dias: { fecha: string; entradas: number; salidas: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    const key = d.toISOString().slice(0, 10)
    dias.push({ fecha: key, entradas: 0, salidas: 0 })
  }
  for (const m of data ?? []) {
    const key = (m.created_at as string).slice(0, 10)
    const fila = dias.find((x) => x.fecha === key)
    if (!fila) continue
    if (m.tipo === 'entrada') fila.entradas += 1
    if (m.tipo === 'salida') fila.salidas += 1
  }
  return dias
}

/** Proyección de reposición hasta `hasta` ('AAAA-MM-DD'); sin fecha, hasta el próximo domingo. */
export async function proyeccionReposicion(hasta?: string | null): Promise<FilaReposicion[]> {
  const { data, error } = await supabase.rpc('proyeccion_reposicion', hasta ? { p_hasta: hasta } : {})
  if (error) throw error
  return (data as FilaReposicion[]) ?? []
}

export async function simularHistoria(semanas = 12): Promise<number> {
  const { data, error } = await supabase.rpc('simular_historia', { p_semanas: semanas })
  if (error) throw error
  return data as number
}

export async function borrarHistoriaSimulada(): Promise<number> {
  const { data, error } = await supabase.rpc('borrar_historia_simulada')
  if (error) throw error
  return data as number
}

/** Una transferencia por (bodega → tienda) con todos sus productos. */
export async function crearTransferenciasSugeridas(
  filas: Pick<FilaReposicion, 'producto_id' | 'variante_id' | 'ubicacion_id' | 'bodega_origen_id' | 'desde_bodega'>[],
  observacion: string
): Promise<number> {
  const grupos = new Map<string, typeof filas>()
  for (const f of filas) {
    if (!f.bodega_origen_id || f.desde_bodega <= 0) continue
    const k = `${f.bodega_origen_id}|${f.ubicacion_id}`
    grupos.set(k, [...(grupos.get(k) ?? []), f])
  }
  let creadas = 0
  for (const [k, items] of grupos) {
    const [origen, destino] = k.split('|')
    const { error } = await supabase.rpc('crear_transferencia', {
      p_origen: origen,
      p_destino: destino,
      p_items: items.map((i) => ({
        producto_id: i.producto_id,
        variante_id: i.variante_id,
        cantidad_enviada: i.desde_bodega
      })),
      p_observaciones: observacion
    })
    if (error) throw error
    creadas++
  }
  return creadas
}

export async function reporteVentas(desde: string, hasta: string, tienda?: string | null): Promise<ReporteVentas> {
  const { data, error } = await supabase.rpc('reporte_ventas', {
    p_desde: desde,
    p_hasta: hasta,
    ...(tienda ? { p_tienda: tienda } : {})
  })
  if (error) throw error
  return data as ReporteVentas
}

/** Unidades vendidas por producto en una ubicación (últimos `dias`), para ordenar el POS. */
export async function rankingVentas(ubicacionId: string, dias = 30): Promise<Map<string, number>> {
  const filas = await conRespaldo(`ranking:${ubicacionId}`, async () => {
    const { data, error } = await supabase.rpc('ranking_ventas', { p_ubicacion: ubicacionId, p_dias: dias })
    if (error) throw error
    return (data as { producto_id: string; unidades: number }[]) ?? []
  })
  return new globalThis.Map(filas.map((f) => [f.producto_id, Number(f.unidades)]))
}

// ---------------- Restaurante ----------------
export interface Salon {
  mesas: Mesa[]
  cuentas: Cuenta[]
  comandas: Comanda[]
  items: CuentaItem[]
}

/** Mesas de la tienda con sus cuentas abiertas, comandas e ítems. */
export async function cargarSalon(ubicacionId: string): Promise<Salon> {
  const [m, c] = await Promise.all([
    supabase.from('mesas').select('*').eq('ubicacion_id', ubicacionId).eq('activa', true).order('orden').order('nombre'),
    supabase.from('cuentas').select('*').eq('ubicacion_id', ubicacionId).eq('estado', 'abierta')
  ])
  if (m.error) throw m.error
  if (c.error) throw c.error
  const cuentas = (c.data as Cuenta[]) ?? []
  const ids = cuentas.map((x) => x.id)
  if (!ids.length) return { mesas: (m.data as Mesa[]) ?? [], cuentas, comandas: [], items: [] }
  const [co, it] = await Promise.all([
    supabase.from('comandas').select('*').in('cuenta_id', ids).order('numero'),
    supabase.from('cuenta_items').select('*').in('cuenta_id', ids).order('created_at')
  ])
  if (co.error) throw co.error
  if (it.error) throw it.error
  return { mesas: (m.data as Mesa[]) ?? [], cuentas, comandas: (co.data as Comanda[]) ?? [], items: (it.data as CuentaItem[]) ?? [] }
}

export interface ComandaCocina extends Comanda {
  mesa: string
  items: CuentaItem[]
}

/** Comandas abiertas de la tienda (pendientes, en preparación y listas). */
export async function comandasCocina(ubicacionId: string): Promise<ComandaCocina[]> {
  const { data, error } = await supabase
    .from('comandas')
    .select('*, cuentas(mesas(nombre)), cuenta_items(*)')
    .eq('ubicacion_id', ubicacionId)
    .in('estado', ['pendiente', 'preparando', 'lista'])
    .order('created_at')
  if (error) throw error
  type Fila = Comanda & { cuentas: { mesas: { nombre: string } | null } | null; cuenta_items: CuentaItem[] }
  return ((data as Fila[]) ?? []).map(({ cuentas, cuenta_items, ...c }) => ({
    ...c,
    mesa: cuentas?.mesas?.nombre ?? '—',
    items: cuenta_items.filter((i) => !i.anulado)
  }))
}

export interface FilaPropina {
  garzon_id: string | null
  garzon: string
  cuentas: number
  ventas: number
  propinas: number
}

export async function reportePropinas(desde: string, hasta: string, tienda?: string | null): Promise<FilaPropina[]> {
  const { data, error } = await supabase.rpc('reporte_propinas', {
    p_desde: desde,
    p_hasta: hasta,
    ...(tienda ? { p_tienda: tienda } : {})
  })
  if (error) throw error
  return (data as FilaPropina[]) ?? []
}
