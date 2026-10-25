import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { proyeccionReposicion } from '@/core/data/api'
import type { FilaReposicion } from '@/core/types'

// Estado compartido: la campana y el Dashboard usan la misma consulta
interface Estado {
  filas: FilaReposicion[]
  cargando: boolean
  ts: number
  /** usuario:empresa — cada usuario ve solo las tiendas que tiene autorizadas */
  clave: string | null
}

let estado: Estado = { filas: [], cargando: false, ts: 0, clave: null }
const oyentes = new Set<() => void>()
let enCurso: Promise<void> | null = null

const VIGENCIA_MS = 5 * 60 * 1000

function emitir(parcial: Partial<Estado>) {
  estado = { ...estado, ...parcial }
  oyentes.forEach((o) => o())
}

async function cargar(clave: string, forzar = false) {
  const vigente = estado.clave === clave && Date.now() - estado.ts < VIGENCIA_MS
  if (!forzar && vigente) return
  if (enCurso) return enCurso
  emitir({ cargando: true, clave, filas: estado.clave === clave ? estado.filas : [] })
  enCurso = proyeccionReposicion()
    // Si entretanto cambió el usuario, el resultado ya no es suyo
    .then((filas) => estado.clave === clave && emitir({ filas, ts: Date.now() }))
    .catch(() => emitir({ ts: Date.now() }))
    .finally(() => {
      enCurso = null
      emitir({ cargando: false })
    })
  return enCurso
}

/** Marca las alertas como desactualizadas (tras una venta, salida o transferencia). */
export function invalidarAlertas() {
  emitir({ ts: 0 })
}

/** Alertas de quiebre para la proyección por defecto (hasta el próximo domingo). */
export function useAlertasStock() {
  const { empresa, profile, can } = useAuth()
  const habilitado = !!empresa && !!profile && can('modulos.inventario')
  const clave = habilitado ? `${profile!.id}:${empresa!.id}` : null

  const snap = useSyncExternalStore(
    (o) => {
      oyentes.add(o)
      return () => oyentes.delete(o)
    },
    () => estado
  )

  useEffect(() => {
    if (!clave) return
    void cargar(clave)
    const id = window.setInterval(() => void cargar(clave), VIGENCIA_MS)
    const alVolver = () => document.visibilityState === 'visible' && void cargar(clave)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [clave, snap.ts])

  const recargar = useCallback(() => (clave ? cargar(clave, true) : Promise.resolve()), [clave])

  const filas = clave && snap.clave === clave ? snap.filas : []
  return {
    habilitado,
    filas,
    cargando: snap.cargando,
    quebrados: filas.filter((f) => f.estado === 'quebrado'),
    porQuebrar: filas.filter((f) => f.estado === 'por_quebrar'),
    bajoMinimo: filas.filter((f) => f.estado === 'bajo_minimo'),
    recargar
  }
}
