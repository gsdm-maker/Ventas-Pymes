import { createContext, useContext } from 'react'

export interface OpcionesConfirmacion {
  titulo: string
  mensaje?: string
  /** Texto del botón de confirmación (acción destructiva) */
  accion?: string
}

export type Confirmar = (opciones: OpcionesConfirmacion) => Promise<boolean>

export const ConfirmCtx = createContext<Confirmar | null>(null)

/** Pide confirmación con un modal propio: `if (!(await confirmar({...}))) return` */
export function useConfirm(): Confirmar {
  const ctx = useContext(ConfirmCtx)
  if (!ctx) throw new Error('useConfirm debe usarse dentro de ConfirmProvider')
  return ctx
}
