import { useEffect, useRef } from 'react'
import { db } from '@/core/db/client'

/**
 * Recarga cuando cambian las tablas indicadas de una tienda (Supabase Realtime,
 * filtrado por RLS). Agrupa ráfagas de cambios y, por si el canal se cae,
 * vuelve a cargar cada 20 s.
 */
export function useTiempoReal(ubicacionId: string | null, tablas: string[], onCambio: () => void) {
  const ref = useRef(onCambio)
  ref.current = onCambio
  const lista = tablas.join(',')

  useEffect(() => {
    if (!ubicacionId) return
    let t: number | undefined
    const disparar = () => {
      window.clearTimeout(t)
      t = window.setTimeout(() => ref.current(), 250)
    }
    const canal = db.channel(`rt:${lista}:${ubicacionId}`)
    for (const tabla of lista.split(',')) {
      // cuenta_items no tiene ubicación: RLS deja pasar solo lo visible
      const filter = tabla === 'cuenta_items' ? undefined : `ubicacion_id=eq.${ubicacionId}`
      canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla, filter }, disparar)
    }
    canal.subscribe()
    const respaldo = window.setInterval(() => ref.current(), 20000)
    return () => {
      window.clearTimeout(t)
      window.clearInterval(respaldo)
      void db.removeChannel(canal)
    }
  }, [ubicacionId, lista])
}
