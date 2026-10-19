import type { ProductoConStock, ProductoVariante } from '@/core/types'

/** «M · Negro» (talla · color · modelo) */
export function etiquetaVariante(v: Pick<ProductoVariante, 'talla' | 'color' | 'modelo'> | null | undefined): string {
  if (!v) return ''
  return [v.talla, v.color, v.modelo].filter(Boolean).join(' · ')
}

const ORDEN_TALLAS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']

function rangoTalla(t: string | null): [number, number, string] {
  if (!t) return [2, 0, '']
  const i = ORDEN_TALLAS.indexOf(t.toUpperCase())
  if (i >= 0) return [0, i, '']
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? [1, n, ''] : [2, 0, t.toLowerCase()]
}

/** Orden natural: S, M, L… y tallas numéricas de menor a mayor; luego color y modelo. */
export function compararVariantes(
  a: Pick<ProductoVariante, 'talla' | 'color' | 'modelo'>,
  b: Pick<ProductoVariante, 'talla' | 'color' | 'modelo'>
): number {
  const ra = rangoTalla(a.talla)
  const rb = rangoTalla(b.talla)
  return (
    ra[0] - rb[0] ||
    ra[1] - rb[1] ||
    ra[2].localeCompare(rb[2]) ||
    (a.color ?? '').localeCompare(b.color ?? '') ||
    (a.modelo ?? '').localeCompare(b.modelo ?? '')
  )
}

/** Clave de una línea o de un stock: producto + variante ('' = sin variante) */
export function clave(productoId: string, varianteId: string | null | undefined): string {
  return `${productoId}|${varianteId ?? ''}`
}

export interface OpcionProducto {
  clave: string
  producto_id: string
  variante_id: string | null
  etiqueta: string
  disponible: number
}

/**
 * Una opción por talla/color (o por producto si no tiene variantes), para
 * selectores de ingreso y transferencias. `incluirLegado`: agrega el stock
 * antiguo sin talla mientras quede (no aplica a ingresos).
 */
export function opcionesProducto(productos: ProductoConStock[], incluirLegado: boolean): OpcionProducto[] {
  const out: OpcionProducto[] = []
  for (const p of productos) {
    const base = `${p.sku} · ${p.nombre}`
    if (!p.variantes?.length) {
      out.push({ clave: clave(p.id, null), producto_id: p.id, variante_id: null, etiqueta: base, disponible: p.disponible })
      continue
    }
    for (const v of p.variantes) {
      out.push({ clave: clave(p.id, v.id), producto_id: p.id, variante_id: v.id, etiqueta: `${base} — ${etiquetaVariante(v)}`, disponible: v.disponible })
    }
    if (incluirLegado && p.legado > 0) {
      out.push({ clave: clave(p.id, null), producto_id: p.id, variante_id: null, etiqueta: `${base} — sin talla (antiguo)`, disponible: p.legado })
    }
  }
  return out
}

/** Descuenta del stock lo que aún está en la cola offline (por producto y variante). */
export function aplicarPendientes(productos: ProductoConStock[], pendientes: Map<string, number>): ProductoConStock[] {
  if (!pendientes.size) return productos
  return productos.map((p) => {
    if (p.controla_stock === false) return p
    let total = 0
    const variantes = (p.variantes ?? []).map((v) => {
      const n = pendientes.get(clave(p.id, v.id)) ?? 0
      total += n
      return n ? { ...v, disponible: Math.max(0, v.disponible - n) } : v
    })
    const sinVariante = pendientes.get(clave(p.id, null)) ?? 0
    total += sinVariante
    return {
      ...p,
      variantes,
      legado: Math.max(0, p.legado - (p.variantes?.length ? sinVariante : 0)),
      disponible: Math.max(0, p.disponible - total)
    }
  })
}
