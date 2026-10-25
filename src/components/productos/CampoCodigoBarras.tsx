import { Barcode, Printer } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { esEan13Valido, generarEan13Interno, svgEan13 } from '@/lib/codigoBarras'
import { formatCLP } from '@/lib/format'

/** Código de barras: se escanea/escribe el del fabricante o se genera uno interno. */
export function CampoCodigoBarras({
  id,
  valor,
  usados,
  nombre,
  precio,
  disabled,
  onChange
}: {
  /** Lo asigna Field para asociar la etiqueta al campo */
  id?: string
  valor: string
  /** Códigos ya usados en la empresa (para no repetir) */
  usados: Set<string>
  nombre: string
  precio: number
  disabled?: boolean
  onChange: (v: string) => void
}) {
  const valido = esEan13Valido(valor)

  function imprimir() {
    const w = window.open('', '_blank', 'width=420,height=360')
    if (!w) return
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiqueta ${esc(valor)}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh}
.e{width:58mm;padding:3mm;text-align:center}.n{font-size:11px;margin-bottom:2mm}.p{font-size:16px;font-weight:700;margin-top:1mm}
svg{width:100%;height:auto}@page{size:62mm 40mm;margin:0}</style></head>
<body><div class="e"><div class="n">${esc(nombre || 'Producto')}</div>${svgEan13(valor)}<div class="p">${esc(formatCLP(precio))}</div></div></body></html>`)
    w.document.close()
    // Sin script dentro de la ventana (la CSP no permite scripts en línea): se imprime desde aquí
    w.focus()
    setTimeout(() => {
      w.print()
      w.close()
    }, 250)
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          id={id}
          value={valor}
          inputMode="numeric"
          placeholder="Escanea o escribe el código…"
          aria-label="Código de barras"
          autoComplete="off"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.replace(/\s/g, ''))}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(generarEan13Interno(usados))}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-medium text-fg-body hover:bg-surface disabled:opacity-50"
        >
          <Barcode size={15} aria-hidden /> Generar
        </button>
      </div>
      {valor && valido && (
        <div className="flex items-center gap-3">
          <div className="w-44 rounded-lg border border-border bg-white p-1.5" dangerouslySetInnerHTML={{ __html: svgEan13(valor, 40) }} />
          <button type="button" onClick={imprimir} className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
            <Printer size={14} aria-hidden /> Imprimir etiqueta
          </button>
        </div>
      )}
      {valor && !valido && (
        <p className="text-xs text-fg-muted">Código del fabricante u otro formato: se guarda tal cual (sin vista previa EAN-13).</p>
      )}
    </div>
  )
}
