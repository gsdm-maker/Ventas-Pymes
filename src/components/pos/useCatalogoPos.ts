import { useEffect, useMemo, useRef, useState } from 'react'
import type { Categoria, ProductoConStock } from '@/core/types'
import { listarCategorias, listarProductosConStock, rankingVentas } from '@/core/data/api'
import { pendientesPorProducto } from '@/core/offline/respaldo'
import { useToast } from '@/components/ui/Toast'
import { aplicarPendientes } from '@/lib/variantes'

// Con conexión, la copia local del catálogo se renueva cada 5 minutos aunque no se venda:
// si se corta internet, el POS vende con un stock de hace como máximo ese tiempo
const RENOVAR_COPIA_MS = 5 * 60 * 1000

/**
 * Catálogo del POS para una ubicación: productos con su stock (menos lo que espera en la cola
 * offline), categorías, lo más vendido primero y la búsqueda («3*pol» agrega 3 unidades).
 */
export function useCatalogoPos(ubicacionId: string | null) {
  const toast = useToast()
  const [productos, setProductos] = useState<ProductoConStock[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [catActiva, setCatActiva] = useState<string>('all')
  const [busqueda, setBusqueda] = useState('')
  // Unidades vendidas por producto en esta tienda (30 días): lo más vendido primero
  const [ranking, setRanking] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    listarCategorias().then(setCategorias)
  }, [])

  // Stock de la copia (o del servidor) menos lo que aún está en la cola offline
  async function recargar() {
    if (!ubicacionId) return
    const [lista, pendientes] = await Promise.all([listarProductosConStock(ubicacionId), pendientesPorProducto(ubicacionId)])
    setProductos(aplicarPendientes(lista.filter((x) => x.activo), pendientes))
  }

  useEffect(() => {
    void recargar().catch(() => toast('No hay copia local del catálogo: conéctate una vez para descargarlo', 'error'))
    if (ubicacionId) rankingVentas(ubicacionId).then(setRanking).catch(() => setRanking(new Map()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ubicacionId])

  // Renovación de la copia: cada 5 min, al volver la conexión (tras dar tiempo a que suba la
  // cola de ventas offline) y al volver a esta pestaña. Sin red no hace nada: se usa la copia.
  const recargarRef = useRef(recargar)
  recargarRef.current = recargar
  useEffect(() => {
    const renovar = () => {
      if (navigator.onLine) void recargarRef.current().catch(() => {})
    }
    let tras: number | undefined
    const alReconectar = () => {
      window.clearTimeout(tras)
      tras = window.setTimeout(renovar, 3000)
    }
    const alVolver = () => {
      if (document.visibilityState === 'visible') renovar()
    }
    const id = window.setInterval(renovar, RENOVAR_COPIA_MS)
    window.addEventListener('online', alReconectar)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(tras)
      window.removeEventListener('online', alReconectar)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [])

  // «3*pol» o «3x pol»: agrega 3 unidades del producto buscado
  const multiplicador = busqueda.match(/^\s*(\d{1,3})\s*[*x×]\s*(.*)$/i)
  const cantidadBusqueda = multiplicador ? Math.max(1, Number(multiplicador[1])) : 1
  const termino = (multiplicador ? multiplicador[2] : busqueda).trim().toLowerCase()

  const filtrados = useMemo(() => {
    return productos
      .filter((p) => {
        if (catActiva !== 'all' && p.categoria_id !== catActiva) return false
        if (!termino) return true
        return p.nombre.toLowerCase().includes(termino) || p.sku.toLowerCase().includes(termino) || (p.codigo_barras ?? '') === termino
      })
      .sort((a, b) => (ranking.get(b.id) ?? 0) - (ranking.get(a.id) ?? 0) || a.nombre.localeCompare(b.nombre))
  }, [productos, catActiva, termino, ranking])

  return { categorias, catActiva, setCatActiva, busqueda, setBusqueda, termino, cantidadBusqueda, filtrados, recargar }
}

export type CatalogoPos = ReturnType<typeof useCatalogoPos>
