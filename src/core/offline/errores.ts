export interface ErrorRpc {
  code?: string
  message?: string
}

/** Falla de red o del servidor: la operación se puede reintentar más tarde. */
export function esErrorDeRed(error: ErrorRpc | null, status?: number): boolean {
  if (!error) return false
  if (status === 0 || (status !== undefined && status >= 500)) return true
  if (!error.code) return /fetch|network|timeout|load failed/i.test(error.message ?? '')
  return false
}

/** El servidor rechazó la operación por reglas de negocio o permisos: reintentar no sirve. */
export function esRechazoDefinitivo(error: ErrorRpc, status?: number): boolean {
  if (esErrorDeRed(error, status)) return false
  const code = error.code ?? ''
  return code === 'P0001' || code === '42501' || code.startsWith('22') || code.startsWith('23')
}
