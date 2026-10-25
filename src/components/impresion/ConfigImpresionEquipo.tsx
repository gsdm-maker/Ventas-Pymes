import { useState } from 'react'
import { Copy, Printer } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'
import { desglosarIVA } from '@/lib/format'
import {
  guardarConfigImpresion,
  imprimirDocumento,
  leerConfigImpresion,
  ticketVentaHtml,
  type AnchoPapel,
  type ConfigImpresion
} from '@/lib/impresion'

/**
 * Impresión de comprobantes en ESTE equipo (cada caja tiene la suya): imprimir al cobrar,
 * ancho del papel térmico, ticket de prueba y cómo dejar Chrome imprimiendo sin diálogo.
 */
export function ConfigImpresionEquipo() {
  const { empresa, ubicaciones, ubicacionActiva, profile } = useAuth()
  const toast = useToast()
  const [config, setConfig] = useState<ConfigImpresion>(leerConfigImpresion)
  const comando = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing ${window.location.origin}/pos`

  function cambiar(c: ConfigImpresion) {
    setConfig(c)
    guardarConfigImpresion(c)
  }

  function prueba() {
    const desglose = desglosarIVA(3980)
    imprimirDocumento(
      ticketVentaHtml(
        {
          empresa: empresa?.nombre ?? '',
          ubicacion: ubicaciones.find((u) => u.id === ubicacionActiva)?.nombre ?? '',
          folio: 'PRUEBA',
          fecha: new Date(),
          cajero: profile?.nombre || '',
          lineas: [{ descripcion: 'Producto de prueba', cantidad: 2, precio_unitario: 1990 }],
          bruto: 3980,
          descuento: 0,
          total: 3980,
          neto: desglose.neto,
          iva: desglose.iva,
          medio: 'efectivo',
          referencia: null,
          recibido: 5000
        },
        config.ancho
      )
    )
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(comando)
      toast('Destino copiado')
    } catch {
      toast('No se pudo copiar: selecciónalo y cópialo a mano', 'warning')
    }
  }

  return (
    <Card id="impresion">
      <CardHeader title="Impresión en este equipo" subtitle="Comprobante de venta del Punto de Venta y precuenta de Mesas" />
      <CardBody className="space-y-4 text-sm">
        <label className="flex items-start gap-2 rounded-xl border border-border p-3 text-fg-body">
          <input
            type="checkbox"
            checked={config.alCobrar}
            onChange={(e) => cambiar({ ...config, alCobrar: e.target.checked })}
            className="mt-0.5 size-4 accent-[rgb(var(--accent))]"
          />
          <span>
            <span className="font-medium text-fg">Imprimir al cobrar</span>
            <span className="block text-xs text-fg-muted">
              Cada venta imprime su comprobante (también sin conexión). Apágalo en equipos sin impresora. Para
              reimprimir: Salidas y vouchers → abrir la venta → Imprimir.
            </span>
          </span>
        </label>

        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-fg-body">Ancho del papel</legend>
          <div className="grid grid-cols-2 gap-2">
            {([80, 58] as AnchoPapel[]).map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={config.ancho === a}
                onClick={() => cambiar({ ...config, ancho: a })}
                className={cn(
                  'rounded-xl border px-3 py-2 font-medium transition-colors',
                  config.ancho === a ? 'border-accent bg-accent-soft text-accent' : 'border-border text-fg-body hover:bg-surface'
                )}
              >
                {a} mm
              </button>
            ))}
          </div>
        </fieldset>

        <Button variant="secondary" block onClick={prueba}>
          <Printer size={15} aria-hidden /> Imprimir ticket de prueba
        </Button>

        <div className="space-y-2 rounded-xl bg-surface p-3 text-xs text-fg-body">
          <p className="font-medium text-fg">Imprimir directo, sin la ventana de elegir impresora</p>
          <p className="text-fg-muted">
            Ninguna página web puede saltarse esa ventana por sí sola. Se configura una vez en el computador de caja (Windows):
          </p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>Deja la impresora térmica como <b>predeterminada</b> (Configuración de Windows → Impresoras).</li>
            <li>Crea un acceso directo en el escritorio con este destino:</li>
          </ol>
          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-panel px-2 py-1.5 text-[11px]">{comando}</code>
            <button
              type="button"
              onClick={() => void copiar()}
              aria-label="Copiar destino del acceso directo"
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-fg-muted hover:bg-panel"
            >
              <Copy size={14} aria-hidden />
            </button>
          </div>
          <ol className="list-decimal space-y-1 pl-4" start={3}>
            <li>Cierra todas las ventanas de Chrome y abre la caja <b>siempre</b> desde ese acceso directo.</li>
            <li>Pulsa «Imprimir ticket de prueba»: debe salir directo por la térmica.</li>
          </ol>
        </div>
      </CardBody>
    </Card>
  )
}
