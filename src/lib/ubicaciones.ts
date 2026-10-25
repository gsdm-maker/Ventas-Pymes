interface Ubicacion {
  id: string
  nombre: string
  activa?: boolean
}

/** Asignadas que siguen activas (las desactivadas no cuentan ni se ofrecen). */
export function asignadasActivas(ids: string[] | undefined, ubicaciones: Ubicacion[]): string[] {
  return (ids ?? []).filter((id) => ubicaciones.some((u) => u.id === id && u.activa !== false))
}

/** Restringido a ubicaciones que ya no están activas: no puede operar en ninguna. */
export function sinUbicacionActiva(ids: string[] | undefined, ubicaciones: Ubicacion[]): boolean {
  return !!ids?.length && asignadasActivas(ids, ubicaciones).length === 0
}

/** Texto corto para listas: «Todas», «Centro, Mall» o «Sin ubicaciones activas» */
export function resumenUbicaciones(ids: string[] | undefined, ubicaciones: Ubicacion[]): string {
  if (!ids || ids.length === 0) return 'Todas las ubicaciones'
  const nombres = asignadasActivas(ids, ubicaciones).map((id) => ubicaciones.find((u) => u.id === id)!.nombre)
  return nombres.length ? nombres.join(', ') : 'Sin ubicaciones activas: asígnale otra'
}
