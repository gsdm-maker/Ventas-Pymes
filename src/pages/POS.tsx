import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useSync } from '@/core/offline/SyncProvider'
import { invalidarAlertas } from '@/core/data/useAlertasStock'
import { registrarVenta } from '@/core/data/ventas'
import type { ProductoConStock } from '@/core/types'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { CatalogoPos, ElegirVariante } from '@/components/pos/CatalogoPos'
import { TicketPanel, TicketResumenMovil } from '@/components/pos/TicketPanel'
import { useCatalogoPos } from '@/components/pos/useCatalogoPos'
import { useTicketPos } from '@/components/pos/useTicketPos'
import type { UltimaVenta, VistaPos } from '@/components/pos/tipos'
import { desglosarIVA } from '@/lib/format'
import { imprimirDocumento, leerConfigImpresion, ticketVentaHtml, type TicketVenta } from '@/lib/impresion'
import { MEDIO_PAGO, referenciaPara } from '@/lib/mediosPago'

/**
 * Punto de venta. Esta pantalla solo coordina: el catálogo (useCatalogoPos + CatalogoPos), el
 * ticket en curso (useTicketPos + TicketPanel) y el cobro (en línea o a la cola offline).
 */
export function POS() {
  const { ubicacionActiva, ubicaciones, profile, empresa } = useAuth()
  const { online, encolarOperacion } = useSync()
  const toast = useToast()
  const buscador = useRef<HTMLInputElement>(null)
  const [vista, setVista] = useState<VistaPos>('lista')
  const [enviando, setEnviando] = useState(false)
  // Última venta: aviso sin bloquear, la caja queda lista para la siguiente
  const [ultima, setUltima] = useState<UltimaVenta | null>(null)
  const [ticketAbierto, setTicketAbierto] = useState(false)
  // Producto con tallas/colores: primero se elige la variante
  const [eligiendo, setEligiendo] = useState<{ producto: ProductoConStock; cantidad: number } | null>(null)

  const catalogo = useCatalogoPos(ubicacionActiva)
  const ticket = useTicketPos(profile && ubicacionActiva ? `misociopyme:ticket:${profile.id}:${ubicacionActiva}` : null)
  const ubicacionNombre = ubicaciones.find((u) => u.id === ubicacionActiva)?.nombre ?? ''
  const puedeCobrar = ticket.listoParaCobrar && !enviando

  const enfocarBuscador = () => {
    // En celular no se abre el teclado solo
    if (window.matchMedia('(pointer: fine)').matches) buscador.current?.focus()
  }

  function agregar(p: ProductoConStock, cantidad = 1) {
    if (p.variantes?.length) setEligiendo({ producto: p, cantidad })
    else ticket.agregarLinea(p, null, p.disponible, '', cantidad)
    catalogo.setBusqueda('')
    enfocarBuscador()
  }

  // El comprobante se imprime solo al cobrar (configurable por equipo en Configuración).
  // Para reimprimir: Salidas y vouchers → abrir la venta → Imprimir.
  function registrarUltima(u: UltimaVenta) {
    setUltima(u)
    const config = leerConfigImpresion()
    if (config.alCobrar) imprimirDocumento(ticketVentaHtml(u.ticket, config.ancho))
  }

  function cajaLista() {
    ticket.limpiar()
    setEnviando(false)
    enfocarBuscador()
    void catalogo.recargar()
  }

  async function finalizar() {
    if (!ubicacionActiva) return
    setEnviando(true)
    const { lineas, medio, referencia, recibido, total } = ticket
    // Identificador de la venta: el servidor la registra una sola vez aunque se reenvíe
    const uuidLocal = crypto.randomUUID()
    const items = lineas.map((l) => ({
      producto_id: l.producto_id,
      variante_id: l.variante_id,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precio_unitario: l.precio_unitario
    }))
    const payload = {
      ubicacion_id: ubicacionActiva,
      items,
      descuento_tipo: ticket.descuentoTipo,
      descuento_valor: ticket.descuentoValor,
      medio_pago: medio,
      referencia: referenciaPara(medio, referencia)
    }
    const comprobante: TicketVenta = {
      empresa: empresa?.nombre ?? '',
      ubicacion: ubicacionNombre,
      folio: null,
      fecha: new Date(),
      cajero: profile?.nombre || profile?.email || '',
      lineas: items,
      bruto: ticket.bruto,
      descuento: ticket.descMonto,
      total,
      neto: ticket.neto,
      iva: ticket.iva,
      medio,
      referencia: referenciaPara(medio, referencia),
      recibido: MEDIO_PAGO[medio].daVuelto ? recibido : 0
    }

    const guardarOffline = async () => {
      await encolarOperacion('venta', payload, uuidLocal)
      registrarUltima({ folio: 'Pendiente de sincronización', total, offline: true, ticket: comprobante })
      toast('Venta guardada sin conexión')
      cajaLista()
    }

    if (!online) return guardarOffline()

    const { data: venta, error, deRed } = await registrarVenta(payload, uuidLocal)
    // Se cayó la red a mitad de camino: queda en cola con el mismo uuid (no se duplica)
    if (deRed) return guardarOffline()
    if (error || !venta) {
      setEnviando(false)
      toast(error ?? 'No se pudo registrar la venta', 'error')
      return
    }
    invalidarAlertas()
    // El total lo confirma el servidor (precio del catálogo)
    const { neto, iva } = desglosarIVA(venta.total)
    registrarUltima({
      folio: venta.folio,
      total: venta.total,
      offline: false,
      ticket: { ...comprobante, folio: venta.folio, total: venta.total, neto, iva }
    })
    toast(`Venta ${venta.folio} registrada`)
    cajaLista()
  }

  // F9 cobra · F2 o «/» va al buscador · Esc limpia la búsqueda
  useEffect(() => {
    const alPresionar = (e: KeyboardEvent) => {
      if (document.querySelector('[role=dialog]')) return
      if (e.key === 'F9' && puedeCobrar) {
        e.preventDefault()
        void finalizar()
      } else if (e.key === 'F2' || (e.key === '/' && document.activeElement?.tagName !== 'INPUT')) {
        e.preventDefault()
        buscador.current?.focus()
      } else if (e.key === 'Escape' && document.activeElement === buscador.current) {
        catalogo.setBusqueda('')
      }
    }
    window.addEventListener('keydown', alPresionar)
    return () => window.removeEventListener('keydown', alPresionar)
  })

  const panel = { ticket, puedeCobrar, enviando, online, ultima }

  return (
    <>
      <PageHeader title="Punto de Venta" subtitle={`Vendiendo en ${ubicacionNombre}`} />

      {/* En escritorio todo cabe en la pantalla: barra con el título (4rem) + márgenes (3.25rem) */}
      <div className="flex flex-col gap-4 lg:h-[calc(100dvh-7.25rem)] lg:min-h-[30rem] lg:flex-row lg:overflow-hidden">
        <CatalogoPos catalogo={catalogo} buscador={buscador} vista={vista} setVista={setVista} agregar={agregar} />

        {/* Ticket */}
        <div className="hidden w-full flex-col rounded-2xl border border-border bg-panel p-4 lg:flex lg:h-full lg:w-[380px] lg:shrink-0 lg:overflow-hidden xl:w-[420px]">
          <TicketPanel {...panel} finalizar={finalizar} />
        </div>

        {/* Resumen flotante del ticket en móvil */}
        <TicketResumenMovil lineas={ticket.lineas} total={ticket.total} onVerTicket={() => setTicketAbierto(true)} />

        {/* Modal del ticket en móvil */}
        <Modal open={ticketAbierto} onClose={() => setTicketAbierto(false)} title={`Ticket activo · ${ticket.lineas.length} ítem(s)`}>
          <TicketPanel
            {...panel}
            finalizar={() => {
              setTicketAbierto(false)
              void finalizar()
            }}
          />
        </Modal>
      </div>

      <ElegirVariante
        producto={eligiendo?.producto ?? null}
        onCerrar={() => setEligiendo(null)}
        onElegir={(varianteId, stock, etiqueta) => {
          if (eligiendo) ticket.agregarLinea(eligiendo.producto, varianteId, stock, etiqueta, eligiendo.cantidad)
          setEligiendo(null)
        }}
      />
    </>
  )
}
