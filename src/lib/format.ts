/**
 * Formato CLP, fechas DD/MM/AAAA e IVA chileno (19%).
 * Todos los montos se manejan como enteros de pesos (sin decimales).
 */

export const IVA_TASA = 0.19

const clp = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0
})

export function formatCLP(monto: number): string {
  return clp.format(Math.round(monto || 0))
}

const clpCompacto = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  notation: 'compact',
  maximumFractionDigits: 1
})

/** "$1,2 M" para ejes y celdas angostas */
export function formatCLPCompacto(monto: number): string {
  return clpCompacto.format(Math.round(monto || 0))
}

/** Formatea sin símbolo: "18.500" */
export function formatMiles(monto: number): string {
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(
    Math.round(monto || 0)
  )
}

/** Precio final con IVA incluido -> neto e IVA (Chile, 19%). */
export function desglosarIVA(totalConIVA: number) {
  const neto = Math.round(totalConIVA / (1 + IVA_TASA))
  const iva = totalConIVA - neto
  return { neto, iva, total: Math.round(totalConIVA) }
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

const fmtFecha = new Intl.DateTimeFormat('es-CL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
})
const fmtFechaHora = new Intl.DateTimeFormat('es-CL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})
const fmtHora = new Intl.DateTimeFormat('es-CL', {
  hour: '2-digit',
  minute: '2-digit'
})

/** DD/MM/AAAA */
export function formatFecha(value: string | Date): string {
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return '—'
  return fmtFecha.format(d)
}

/** DD/MM/AAAA HH:mm */
export function formatFechaHora(value: string | Date): string {
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return '—'
  return fmtFechaHora.format(d)
}

export function formatHora(value: string | Date): string {
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return '—'
  return fmtHora.format(d)
}

/** "hace 3 min", "hace 2 h", "hace 4 días" */
export function hace(value: string | Date | null | undefined): string {
  if (!value) return 'nunca'
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return 'nunca'
  const seg = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seg < 60) return 'hace instantes'
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`
  if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`
  return `hace ${Math.floor(seg / 86400)} d`
}

export function diasHasta(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

/** 'AAAA-MM-DD' como fecha local (new Date('AAAA-MM-DD') la toma en UTC y en Chile cae el día anterior). */
export function parseDia(dia: string): Date {
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(a, m - 1, d)
}

const fmtDiaCorto = new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: '2-digit', month: '2-digit' })
const fmtDiaLargo = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })

/** "mié 21-10" */
export function formatDiaCorto(dia: string): string {
  return fmtDiaCorto.format(parseDia(dia)).replace(',', '')
}

/** "domingo 25 de octubre" */
export function formatDiaLargo(dia: string): string {
  return fmtDiaLargo.format(parseDia(dia)).replace(',', '')
}

/** 'AAAA-MM-DD' de una fecha local */
export function aDia(fecha: Date): string {
  const m = String(fecha.getMonth() + 1).padStart(2, '0')
  const d = String(fecha.getDate()).padStart(2, '0')
  return `${fecha.getFullYear()}-${m}-${d}`
}

export const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
