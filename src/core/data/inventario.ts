import { supabase } from '@/core/supabase/client'
import type { Movimiento, Producto, ProductoVariante, Stock, TransferenciaItem } from '@/core/types'
import { resultado, soloError, type Resultado } from '@/core/data/resultado'

// ---------------- Productos ----------------

/** Mensaje claro para el error más común al guardar un producto. */
export function mensajeErrorProducto(r: Resultado<unknown>): string | null {
  if (!r.error) return null
  return r.codigo === '23505' && r.error.includes('codigo_barras') ? 'Ese código de barras ya lo tiene otro producto' : r.error
}

/** Crea (con el id ya reservado para la foto) o actualiza un producto. */
export async function guardarProducto(datos: Record<string, unknown>, id: string, existe: boolean): Promise<string | null> {
  const r = existe
    ? resultado(await supabase.from('productos').update(datos).eq('id', id))
    : resultado(await supabase.from('productos').insert({ ...datos, id }))
  return mensajeErrorProducto(r)
}

export async function crearProducto(fila: Record<string, unknown>): Promise<Resultado<Producto>> {
  const r = resultado<Producto>(await supabase.from('productos').insert(fila).select().single())
  return { ...r, error: mensajeErrorProducto(r) }
}

export async function productoPorId(id: string): Promise<Producto | null> {
  const { data } = await supabase.from('productos').select('*').eq('id', id).single()
  return (data as Producto) ?? null
}

export async function guardarStockMinimo(id: string, minimo: number): Promise<string | null> {
  return soloError(await supabase.from('productos').update({ stock_minimo: minimo }).eq('id', id))
}

/** Ficha de inventario: producto, stock por ubicación (con su nombre) y últimos movimientos. */
export async function detalleProducto(id: string) {
  const [producto, { data: s }, { data: ubis }, { data: m }] = await Promise.all([
    productoPorId(id),
    supabase.from('stock').select('*').eq('producto_id', id),
    supabase.from('ubicaciones').select('id, nombre'),
    supabase.from('movimientos').select('*').eq('producto_id', id).order('created_at', { ascending: false }).limit(15)
  ])
  const nombres = new Map(((ubis ?? []) as { id: string; nombre: string }[]).map((u) => [u.id, u.nombre]))
  return {
    producto,
    stock: ((s ?? []) as Stock[]).map((row) => ({ ...row, ubicacion: nombres.get(row.ubicacion_id) })),
    movimientos: (m as Movimiento[]) ?? []
  }
}

// ---------------- Fotos (Storage) ----------------
const BUCKET = 'productos'

/** Sube la foto y devuelve su URL pública (con versión, para no ver la anterior en caché). */
export async function subirFotoProducto(ruta: string, blob: Blob): Promise<string> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, blob, { upsert: true, contentType: blob.type, cacheControl: '31536000' })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta)
  return `${data.publicUrl}?v=${Date.now()}`
}

/** Borra la foto subida de un producto que no llegó a crearse (a partir de su URL). */
export function borrarFotoHuerfana(url: string): void {
  const ruta = url.match(/\/public\/productos\/([^?]+)/)?.[1]
  if (ruta) void supabase.storage.from(BUCKET).remove([ruta])
}

// ---------------- Variantes ----------------
export async function listarVariantes(productoId: string): Promise<ProductoVariante[]> {
  const { data } = await supabase.from('producto_variantes').select('*').eq('producto_id', productoId).order('sku')
  return (data as ProductoVariante[]) ?? []
}

export async function crearVariantes(filas: Partial<ProductoVariante>[]): Promise<string | null> {
  return soloError(await supabase.from('producto_variantes').insert(filas))
}

export async function cambiarActivaVariante(id: string, activa: boolean): Promise<string | null> {
  return soloError(await supabase.from('producto_variantes').update({ activa }).eq('id', id))
}

// ---------------- Bodega: transferencias y recepciones ----------------
export async function itemsDeTransferencias(ids: string[]): Promise<TransferenciaItem[]> {
  if (!ids.length) return []
  const { data } = await supabase.from('transferencia_items').select('*').in('transferencia_id', ids)
  return (data as TransferenciaItem[]) ?? []
}

export async function crearTransferencia(
  origen: string,
  destino: string,
  items: { producto_id: string; variante_id: string | null; cantidad_enviada: number }[],
  observaciones: string | null
): Promise<string | null> {
  return soloError(
    await supabase.rpc('crear_transferencia', { p_origen: origen, p_destino: destino, p_items: items, p_observaciones: observaciones })
  )
}

export async function despacharTransferencia(id: string): Promise<string | null> {
  return soloError(await supabase.rpc('despachar_transferencia', { p_id: id }))
}

export async function recibirTransferencia(id: string, items: { id: string; cantidad_recibida: number }[]): Promise<string | null> {
  return soloError(await supabase.rpc('recibir_transferencia', { p_id: id, p_items: items }))
}

export interface DatosEntrada {
  ubicacion_id: string
  items: { producto_id: string; variante_id: string | null; cantidad: number; costo_unitario: number | null }[]
  proveedor_id: string | null
  observaciones: string | null
  documento: { tipo: string; numero: string | null; fecha: string | null } | null
  actualizar_costo: boolean
}

/** Ingreso de mercadería (con o sin documento del proveedor). */
export async function registrarEntrada(e: DatosEntrada): Promise<string | null> {
  return soloError(
    await supabase.rpc('registrar_entrada', {
      p_ubicacion: e.ubicacion_id,
      p_items: e.items,
      p_proveedor: e.proveedor_id,
      p_origen_texto: null,
      p_observaciones: e.observaciones,
      p_documento_tipo: e.documento?.tipo ?? null,
      p_documento_numero: e.documento?.numero ?? null,
      p_documento_fecha: e.documento?.fecha ?? null,
      p_actualizar_costo: e.actualizar_costo
    })
  )
}
