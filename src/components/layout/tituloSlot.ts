import { createContext } from 'react'

/**
 * Lugar de la barra superior (solo escritorio) donde PageHeader muestra el título de la
 * pantalla. Null fuera del AppShell (login, voucher) o mientras no se monta.
 */
export const TituloSlotContext = createContext<HTMLElement | null>(null)
