import type { MedioPago } from '@/core/types'
import { formatCLP } from '@/lib/format'
import { etiquetaMedio } from '@/lib/mediosPago'

/**
 * Impresión de tickets en impresoras térmicas (58 u 80 mm) o comunes.
 * Se imprime desde un iframe oculto de la misma página: no abre ventanas (que el navegador
 * bloquearía al imprimir sola después de cobrar) y funciona sin conexión. Para que imprima
 * directo en la impresora predeterminada, sin diálogo, el equipo de caja abre Chrome con
 * --kiosk-printing (ver Ayuda → Punto de Venta). Las reimpresiones se hacen desde el voucher.
 */

export type AnchoPapel = 58 | 80

/** Configuración de impresión de esta caja (este equipo). */
export interface ConfigImpresion {
  /** Imprimir el comprobante apenas se cobra (encendido por defecto) */
  alCobrar: boolean
  ancho: AnchoPapel
}

const CLAVE = 'misociopyme:impresion'
const PREDETERMINADA: ConfigImpresion = { alCobrar: true, ancho: 80 }

export function leerConfigImpresion(): ConfigImpresion {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as Partial<ConfigImpresion> | null
    return { alCobrar: v?.alCobrar !== false, ancho: v?.ancho === 58 ? 58 : 80 }
  } catch {
    return PREDETERMINADA
  }
}

export function guardarConfigImpresion(c: ConfigImpresion): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(c))
  } catch {
    // sin almacenamiento: se usa la predeterminada
  }
}

export function esc(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** Documento HTML de ticket con el ancho de papel indicado. `cuerpo` ya viene escapado. */
/**
 * Papel en blanco al final del ticket: la térmica corta apenas termina el contenido y sin esto
 * la última línea queda justo en el corte. Si aún queda cortado, subir este valor.
 */
const AVANCE_MM = 18

export function documentoTicket(titulo: string, cuerpo: string, ancho: AnchoPapel): string {
  // Área imprimible típica: 48 mm en papel de 58 y 72 mm en papel de 80
  const util = ancho === 58 ? 48 : 72
  const letra = ancho === 58 ? 10.5 : 12
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
@page{size:${ancho}mm auto;margin:0}
*{box-sizing:border-box}
body{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:${letra}px;line-height:1.35;margin:0;padding:3mm ${(ancho - util) / 2}mm;width:${ancho}mm;color:#000}
h1{font-size:${letra + 2}px;margin:0 0 1mm;text-align:center}
p{margin:0 0 .8mm;text-align:center}
table{width:100%;border-collapse:collapse;margin:2mm 0;font-size:inherit}
td{padding:.5mm 0;vertical-align:top}
td:last-child{text-align:right;white-space:nowrap;padding-left:2mm}
.sep td{border-top:1px dashed #000;padding-top:1.2mm}
.fuerte td{font-weight:700;font-size:${letra + 1}px}
.s{color:#333;font-size:${letra - 1}px}
.det{display:block;color:#333;font-size:${letra - 1}px}
.avance{height:${AVANCE_MM}mm}
</style></head><body>${cuerpo}<div class="avance">&nbsp;</div></body></html>`
}

let marco: HTMLIFrameElement | null = null

/** Imprime un documento HTML completo desde un iframe oculto. */
export function imprimirDocumento(html: string): void {
  marco?.remove()
  marco = document.createElement('iframe')
  marco.setAttribute('aria-hidden', 'true')
  marco.tabIndex = -1
  // Fuera de la pantalla pero con tamaño real: algunos navegadores no imprimen un marco de
  // tamaño cero o con visibility:hidden (no muestran nada al cobrar)
  marco.style.cssText = 'position:fixed;left:-10000px;top:0;width:80mm;height:200mm;border:0'
  document.body.appendChild(marco)
  const doc = marco.contentDocument
  const win = marco.contentWindow
  if (!doc || !win) return
  doc.open()
  doc.write(html)
  doc.close()
  // Esperar a que el documento tome los estilos antes de abrir el diálogo
  setTimeout(() => {
    try {
      win.focus()
      win.print()
    } catch {
      // Si el navegador no deja imprimir el marco, se imprime en una ventana aparte
      const w = window.open('', '_blank', 'width=380,height=600')
      if (!w) return
      w.document.write(html)
      w.document.close()
      w.focus()
      w.print()
      w.close()
    }
  }, 150)
}

// ---------------- Comprobante de venta del POS ----------------

export interface TicketVenta {
  empresa: string
  ubicacion: string
  /** null: venta sin conexión, el folio se asigna al sincronizar */
  folio: string | null
  fecha: Date
  cajero: string
  lineas: { descripcion: string; cantidad: number; precio_unitario: number }[]
  bruto: number
  descuento: number
  total: number
  neto: number
  iva: number
  medio: MedioPago
  referencia: string | null
  /** Efectivo recibido (0 si no se ingresó) */
  recibido: number
  /** Restaurante: mesa y propina (fuera del total, sin IVA) */
  mesa?: string
  propina?: number
  /** Reimpresión desde el voucher */
  copia?: boolean
}

export function ticketVentaHtml(t: TicketVenta, ancho: AnchoPapel): string {
  const fila = (a: string, b: string, clase = '') => `<tr${clase ? ` class="${clase}"` : ''}><td>${a}</td><td>${b}</td></tr>`
  const lineas = t.lineas
    .map((l) =>
      fila(
        `${esc(l.descripcion)}<span class="det">${l.cantidad} × ${esc(formatCLP(l.precio_unitario))}</span>`,
        esc(formatCLP(l.cantidad * l.precio_unitario))
      )
    )
    .join('')
  const vuelto = t.recibido > 0 ? t.recibido - t.total - (t.propina ?? 0) : 0
  const cuerpo = `<h1>${esc(t.empresa)}</h1>
<p>${esc(t.ubicacion)}</p>
<p><b>${t.folio ? `Venta ${esc(t.folio)}` : 'Venta sin conexión'}${t.mesa ? ` · ${esc(t.mesa)}` : ''}</b></p>
${t.copia ? '<p><b>COPIA</b></p>' : ''}
<p class="s">${esc(t.fecha.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }))} · ${esc(t.cajero)}</p>
<table>${lineas}
${t.descuento > 0 ? fila('Subtotal', esc(formatCLP(t.bruto)), 'sep') + fila('Descuento', `−${esc(formatCLP(t.descuento))}`) : ''}
${fila('TOTAL', esc(formatCLP(t.total)), 'sep fuerte')}
${fila('<span class="s">Neto</span>', `<span class="s">${esc(formatCLP(t.neto))}</span>`)}
${fila('<span class="s">IVA 19%</span>', `<span class="s">${esc(formatCLP(t.iva))}</span>`)}
${t.propina ? fila('Propina (voluntaria)', esc(formatCLP(t.propina)), 'sep') + fila('<b>Total pagado</b>', `<b>${esc(formatCLP(t.total + t.propina))}</b>`) : ''}
${fila(esc(etiquetaMedio(t.medio)), t.referencia ? `N° ${esc(t.referencia)}` : '', 'sep')}
${t.recibido > 0 ? fila('Recibido', esc(formatCLP(t.recibido))) + fila('Vuelto', esc(formatCLP(Math.max(0, vuelto)))) : ''}
</table>
${t.folio ? '' : '<p class="s">El folio se asigna al volver la conexión.</p>'}
<p class="s">Comprobante interno · no válido como boleta</p>
<p>¡Gracias por su compra!</p>`
  return documentoTicket(t.folio ? `Venta ${t.folio}` : 'Venta', cuerpo, ancho)
}
