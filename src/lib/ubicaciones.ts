interface Ubicacion {
  id: string
  nombre: string
}

/** Texto corto para listas: «Todas» o «Centro, Mall» */
export function resumenUbicaciones(ids: string[] | undefined, ubicaciones: Ubicacion[]): string {
  if (!ids || ids.length === 0) return 'Todas las ubicaciones'
  const nombres = ids.map((id) => ubicaciones.find((u) => u.id === id)?.nombre).filter(Boolean)
  return nombres.length ? nombres.join(', ') : `${ids.length} ubicación(es)`
}
