import type { Tone } from '@/components/ui/Badge'
import type { EstadoReposicion, FilaReposicion } from '@/core/types'
import { formatDiaCorto } from '@/lib/format'

export const ETIQUETA_ESTADO: Record<EstadoReposicion, string> = {
  quebrado: 'Quebrado',
  por_quebrar: 'Por quebrar',
  bajo_minimo: 'Bajo mínimo',
  ok: 'Cubierto'
}
export const TONO_ESTADO: Record<EstadoReposicion, Tone> = {
  quebrado: 'danger',
  por_quebrar: 'warning',
  bajo_minimo: 'info',
  ok: 'success'
}

/** "Se agota el mié 21-10 (3 d)" */
export function textoCobertura(f: FilaReposicion): string {
  if (f.estado === 'quebrado') return 'Sin stock ahora'
  if (!f.fecha_quiebre) return f.con_historia ? 'Cubre más de 60 días' : 'Sin historia de ventas'
  if (f.dias_cobertura === 0) return 'Se agota hoy'
  return `Se agota el ${formatDiaCorto(f.fecha_quiebre)} (${f.dias_cobertura} d)`
}
