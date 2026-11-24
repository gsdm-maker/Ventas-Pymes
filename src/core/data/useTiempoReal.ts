import { useEffect, useRef } from 'react'

/**
 * Recarga la pantalla cada 20 s mientras hay una tienda activa (mesas, cocina, cuentas).
 * El VPS propio no tiene tiempo real (websocket), así que no se abre ningún canal: antes el
 * cliente intentaba conectarse y reintentaba sin éxito. `tablas` se conserva por compatibilidad
 * con los llamadores; si algún día se agrega tiempo real, se vuelve a suscribir aquí.
 */
export function useTiempoReal(ubicacionId: string | null, _tablas: string[], onCambio: () => void) {
  const ref = useRef(onCambio)
  ref.current = onCambio

  useEffect(() => {
    if (!ubicacionId) return
    const id = window.setInterval(() => ref.current(), 20000)
    return () => window.clearInterval(id)
  }, [ubicacionId])
}
