/** Unidades de medida: las que define la empresa o, si aún no define ninguna, las sugeridas. */
export interface Unidad {
  codigo: string
  nombre: string
}

export const UNIDADES_SUGERIDAS: Unidad[] = [
  { codigo: 'UN', nombre: 'Unidad' },
  { codigo: 'KG', nombre: 'Kilo' },
  { codigo: 'GR', nombre: 'Gramo' },
  { codigo: 'LT', nombre: 'Litro' },
  { codigo: 'ML', nombre: 'Mililitro' },
  { codigo: 'MT', nombre: 'Metro' },
  { codigo: 'CJ', nombre: 'Caja' },
  { codigo: 'PAQ', nombre: 'Paquete' },
  { codigo: 'PAR', nombre: 'Par' },
  { codigo: 'SET', nombre: 'Set' }
]

/** Código normalizado: mayúsculas, sin espacios, hasta 8 caracteres. */
export function normalizarCodigo(codigo: string): string {
  return codigo.trim().toUpperCase().replace(/\s+/g, '').slice(0, 8)
}

/** Lista vigente de la empresa (o la sugerida si está vacía). */
export function unidadesVigentes(propias: Unidad[]): Unidad[] {
  return propias.length ? propias : UNIDADES_SUGERIDAS
}

/** Opciones del selector: incluye la unidad actual del producto aunque ya no esté en la lista. */
export function opcionesUnidad(propias: Unidad[], actual: string | null | undefined): Unidad[] {
  const lista = unidadesVigentes(propias)
  const cod = actual?.trim()
  if (!cod || lista.some((u) => u.codigo === cod)) return lista
  return [...lista, { codigo: cod, nombre: `${cod} (ya no está en la lista)` }]
}
