import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { proyeccionReposicion } from '@/core/data/api'
import type { FilaReposicion } from '@/core/types'

// Estado compartido: la campana y el Dashboard usan la misma consulta
interface Estado {
  filas: FilaReposicion[]
  cargando: boolean
  ts: number
  empresaId: string | null
}

let estado: Estado = { filas: [], cargando: false, ts: 0, empresaId: null }
const oyentes = new Set<() => void>()
let enCurso: Promise<void> | null = null

const VIGENCIA_MS = 5 * 60 * 1000

function emitir(parcial: Partial<Estado>) {
  estado = { ...estado, ...parcial }
  oyentes.forEach((o) => o())
}

async function cargar(empresaId: string, forzar = false) {
  const vigente = estado.empresaId === empresaId && Date.now() - estado.ts < VIGENCIA_MS
  if (!forzar && vigente) return
  if (enCurso) return enCurso
  emitir({ cargando: true, empresaId })
  enCurso = proyeccionReposicion()
    .then((filas) => emitir({ filas, ts: Date.now() }))
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
  const { empresa, can } = useAuth()
  const habilitado = !!empresa && can('modulos.inventario')
  const empresaId = habilitado ? empresa!.id : null

  const snap = useSyncExternalStore(
    (o) => {
      oyentes.add(o)
      return () => oyentes.delete(o)
    },
    () => estado
  )

  useEffect(() => {
    if (!empresaId) return
    void cargar(empresaId)
    const id = window.setInterval(() => void cargar(empresaId), VIGENCIA_MS)
    const alVolver = () => document.visibilityState === 'visible' && void cargar(empresaId)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [empresaId, snap.ts])

  const recargar = useCallback(() => (empresaId ? cargar(empresaId, true) : Promise.resolve()), [empresaId])

  const filas = empresaId && snap.empresaId === empresaId ? snap.filas : []
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
