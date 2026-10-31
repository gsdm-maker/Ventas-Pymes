import { useEffect, useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import type { Categoria, ProductoConStock } from '@/core/types'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { FotoProducto } from '@/components/productos/FotoProducto'
import { CampoCodigoBarras } from '@/components/productos/CampoCodigoBarras'
import { formatCLP } from '@/lib/format'
import { margenDesdePrecio, precioDesdeMargen } from '@/lib/precio'
import { skuAutomatico } from '@/lib/sku'
import { borrarFotoHuerfana, crearProducto } from '@/core/data/inventario'

/**
 * Ficha simple para crear un producto sin salir de otra pantalla (p. ej. la
 * recepción): foto, nombre, costo → margen → precio, categoría, stock mínimo y
 * código de barras. Siempre controla stock (se está ingresando mercadería).
 */
export function CrearProductoRapido({
  abierto,
  nombreInicial,
  codigoInicial,
  costoInicial,
  categorias,
  productos,
  onCerrar,
  onCreado
}: {
  abierto: boolean
  nombreInicial: string
  /** Código de barras ya leído (p. ej. con la cámara) */
  codigoInicial?: string
  costoInicial?: number
  categorias: Categoria[]
  productos: ProductoConStock[]
  onCerrar: () => void
  onCreado: (p: ProductoConStock) => void
}) {
  const { empresa } = useAuth()
  const toast = useToast()
  const [id, setId] = useState('')
  const [nombre, setNombre] = useState('')
  const [costo, setCosto] = useState(0)
  const [margen, setMargen] = useState('')
  const [precio, setPrecio] = useState(0)
  const [categoria, setCategoria] = useState('')
  const [minimo, setMinimo] = useState(0)
  const [codigo, setCodigo] = useState('')
  const [foto, setFoto] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!abierto) return
    setId(crypto.randomUUID())
    setNombre(nombreInicial)
    setCosto(costoInicial ?? 0)
    setMargen('')
    setPrecio(0)
    setCategoria('')
    setMinimo(0)
    setCodigo(codigoInicial ?? '')
    setFoto('')
  }, [abierto, nombreInicial, codigoInicial, costoInicial])

  function cambiarCosto(c: number) {
    setCosto(c)
    const m = Number(margen)
    if (margen !== '' && m < 100) setPrecio(precioDesdeMargen(c, m))
    else setMargen(String(margenDesdePrecio(c, precio) ?? ''))
  }
  function cambiarMargen(t: string) {
    setMargen(t)
    const m = Number(t.replace(',', '.'))
    if (t !== '' && Number.isFinite(m) && m < 100 && costo) setPrecio(precioDesdeMargen(costo, m))
  }
  function cambiarPrecio(p: number) {
    setPrecio(p)
    setMargen(String(margenDesdePrecio(costo, p) ?? ''))
  }

  function cerrar() {
    // Foto subida de un producto que no se creó: se borra
    borrarFotoHuerfana(foto)
    onCerrar()
  }

  async function guardar() {
    if (!empresa) return
    if (!nombre.trim()) return toast('Escribe el nombre del producto', 'warning')
    if (!precio) return toast('Indica el precio de venta (o costo y margen)', 'warning')
    setGuardando(true)
    const cat = categorias.find((c) => c.id === categoria)
    const fila = {
      id,
      empresa_id: empresa.id,
      sku: skuAutomatico(cat?.nombre, productos.map((p) => p.sku)),
      nombre: nombre.trim(),
      categoria_id: categoria || null,
      precio_venta: precio,
      costo_referencia: costo,
      stock_minimo: minimo,
      codigo_barras: codigo.trim() || null,
      foto_url: foto || null,
      controla_stock: true,
      activo: true
    }
    const { data, error } = await crearProducto(fila)
    setGuardando(false)
    if (error) return toast(error, 'error')
    toast(`Producto «${fila.nombre}» creado (${fila.sku})`)
    onCreado({
      ...(data as ProductoConStock),
      categoria_nombre: cat?.nombre ?? null,
      disponible: 0,
      reservado: 0,
      transito: 0,
      estado_stock: 'sin',
      variantes: [],
      legado: 0
    })
  }

  return (
    <Modal
      open={abierto}
      onClose={cerrar}
      title="Nuevo producto"
      footer={
        <>
          <Button variant="secondary" onClick={cerrar}>Cancelar</Button>
          <Button onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Creando…' : 'Crear y agregar'}</Button>
        </>
      }
    >
      {empresa && id && (
        <div className="space-y-4">
          <FotoProducto url={foto} empresaId={empresa.id} productoId={id} onChange={setFoto} />
          <Field label="Nombre" required>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Costo neto">
              <Input type="number" inputMode="numeric" value={costo || ''} onChange={(e) => cambiarCosto(Number(e.target.value) || 0)} placeholder="0" />
            </Field>
            <Field label="Margen %">
              <Input inputMode="decimal" value={margen} onChange={(e) => cambiarMargen(e.target.value)} placeholder="40" disabled={!costo} />
            </Field>
            <Field label="Precio venta" required>
              <Input type="number" inputMode="numeric" value={precio || ''} onChange={(e) => cambiarPrecio(Number(e.target.value) || 0)} placeholder="0" />
            </Field>
          </div>
          {precio > 0 && (
            <p className="-mt-2 text-xs text-fg-muted">
              Con IVA: neto {formatCLP(Math.round(precio / 1.19))} + IVA {formatCLP(precio - Math.round(precio / 1.19))}.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Categoría">
              <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="">Sin categoría</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </Select>
            </Field>
            <Field label="Stock mínimo">
              <Input type="number" inputMode="numeric" value={minimo || ''} onChange={(e) => setMinimo(Number(e.target.value) || 0)} placeholder="0" />
            </Field>
          </div>
          <Field label="Código de barras">
            <CampoCodigoBarras
              valor={codigo}
              usados={new Set(productos.filter((p) => p.codigo_barras).map((p) => p.codigo_barras as string))}
              nombre={nombre}
              precio={precio}
              onChange={setCodigo}
            />
          </Field>
          <p className="text-xs text-fg-muted">Tallas, marca y descripción se agregan después en Productos.</p>
        </div>
      )}
    </Modal>
  )
}
