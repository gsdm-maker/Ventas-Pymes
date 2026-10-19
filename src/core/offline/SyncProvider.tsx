import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { supabase } from '@/core/supabase/client'
import { useAuth } from '@/core/auth/AuthProvider'
import {
  actualizarIntento,
  contarCola,
  encolar,
  listarCola,
  marcarRechazada,
  quitarDeCola,
  type OperacionPendiente,
  type TipoOperacion
} from '@/core/offline/db'
import { esRechazoDefinitivo } from '@/core/offline/errores'

interface SyncCtx {
  online: boolean
  pendientes: number
  ultimaSync: string | null
  sincronizando: boolean
  errores: number
  refrescarEstado: () => Promise<void>
  sincronizar: () => Promise<void>
  encolarOperacion: (
    tipo: TipoOperacion,
    payload: Record<string, unknown>,
    uuidLocal?: string
  ) => Promise<string>
}

const Ctx = createContext<SyncCtx | null>(null)

function argumentos(op: OperacionPendiente) {
  if (op.tipo === 'salida') {
    return {
      rpc: 'registrar_salida',
      args: {
        p_producto: op.payload.producto_id,
        p_variante: op.payload.variante_id ?? null,
        p_ubicacion: op.payload.ubicacion_id,
        p_cantidad: op.payload.cantidad,
        p_motivo: op.payload.motivo_id ?? null,
        p_observaciones: op.payload.observaciones ?? null,
        p_uuid_local: op.uuid_local,
        // Ya se entregó la mercadería: si el stock no alcanza se registra igual y se marca
        p_permitir_sin_stock: true
      }
    }
  }
  return {
    rpc: 'registrar_venta',
    args: {
      p_ubicacion: op.payload.ubicacion_id,
      p_items: op.payload.items,
      p_descuento_tipo: op.payload.descuento_tipo,
      p_descuento_valor: op.payload.descuento_valor,
      p_medio_pago: op.payload.medio_pago,
      p_referencia: op.payload.referencia ?? null,
      p_uuid_local: op.uuid_local,
      // La venta ya se cobró: si el stock no alcanza se registra igual y se marca
      p_permitir_sin_stock: true
    }
  }
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const [online, setOnline] = useState(navigator.onLine)
  const [pendientes, setPendientes] = useState(0)
  const [errores, setErrores] = useState(0)
  const [sincronizando, setSincronizando] = useState(false)
  const [ultimaSync, setUltimaSync] = useState<string | null>(
    localStorage.getItem('stockflow:ultimaSync')
  )
  const corriendo = useRef(false)

  const refrescarEstado = useCallback(async () => {
    if (!userId) {
      setPendientes(0)
      setErrores(0)
      return
    }
    const c = await contarCola(userId)
    setPendientes(c.pendientes)
    setErrores(c.rechazadas)
  }, [userId])

  const sincronizar = useCallback(async () => {
    if (corriendo.current || !navigator.onLine || !userId) return
    corriendo.current = true
    setSincronizando(true)
    try {
      const ops = (await listarCola(userId)).filter((op) => op.estado !== 'rechazado')
      for (const op of ops) {
        try {
          const { rpc, args } = argumentos(op)
          // Las RPC son idempotentes por uuid_local: reenviar no duplica
          const { error, status } = await supabase.rpc(rpc, args)
          if (!error) await quitarDeCola(op.key)
          else if (esRechazoDefinitivo(error, status)) await marcarRechazada(op, error.message)
          else await actualizarIntento(op)
        } catch {
          await actualizarIntento(op)
        }
      }
      const ahora = new Date().toISOString()
      setUltimaSync(ahora)
      localStorage.setItem('stockflow:ultimaSync', ahora)
    } finally {
      await refrescarEstado()
      setSincronizando(false)
      corriendo.current = false
    }
  }, [userId, refrescarEstado])

  const encolarOperacion = useCallback(
    async (
      tipo: TipoOperacion,
      payload: Record<string, unknown>,
      uuidLocal?: string
    ) => {
      if (!userId) throw new Error('Sesión no disponible')
      const op = await encolar(tipo, payload, userId, uuidLocal)
      await refrescarEstado()
      if (navigator.onLine) void sincronizar()
      return op.uuid_local
    },
    [userId, refrescarEstado, sincronizar]
  )

  useEffect(() => {
    const on = () => {
      setOnline(true)
      void sincronizar()
    }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [sincronizar])

  // Reintento periódico: cubre el caso en que la red volvió pero el token aún no se renovaba
  useEffect(() => {
    const id = window.setInterval(() => {
      if (navigator.onLine && pendientes > 0) void sincronizar()
    }, 60_000)
    return () => window.clearInterval(id)
  }, [pendientes, sincronizar])

  // Al iniciar sesión (o abrir la app con sesión) se envía lo que quedó en cola
  useEffect(() => {
    void refrescarEstado()
    if (userId && navigator.onLine) void sincronizar()
  }, [userId, refrescarEstado, sincronizar])

  return (
    <Ctx.Provider
      value={{
        online,
        pendientes,
        ultimaSync,
        sincronizando,
        errores,
        refrescarEstado,
        sincronizar,
        encolarOperacion
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useSync() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSync debe usarse dentro de SyncProvider')
  return ctx
}
