import { useEffect, useState } from 'react'
import { Plus, Shirt } from 'lucide-react'
import { supabase } from '@/core/supabase/client'
import type { ProductoVariante } from '@/core/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { compararVariantes, etiquetaVariante } from '@/lib/variantes'

const limpiar = (s: string) =>
  s.split(',').map((x) => x.trim()).filter(Boolean)

const parteSku = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()

/** Tallas y colores de un producto: crear combinaciones y activar/desactivar (nunca se borran). */
export function GestorVariantes({ productoId, sku, empresaId }: { productoId: string; sku: string; empresaId: string }) {
  const toast = useToast()
  const [variantes, setVariantes] = useState<ProductoVariante[]>([])
  const [tallas, setTallas] = useState('')
  const [colores, setColores] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    const { data } = await supabase.from('producto_variantes').select('*').eq('producto_id', productoId).order('sku')
    setVariantes(((data as ProductoVariante[]) ?? []).sort(compararVariantes))
  }

  useEffect(() => {
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoId])

  async function generar() {
    const ts = limpiar(tallas)
    const cs = limpiar(colores)
    if (!ts.length && !cs.length) return toast('Escribe al menos una talla o un color', 'warning')
    const combos: { talla: string | null; color: string | null }[] = []
    for (const t of ts.length ? ts : [null]) for (const c of cs.length ? cs : [null]) combos.push({ talla: t, color: c })
    const existentes = new Set(variantes.map((v) => `${v.talla ?? ''}|${v.color ?? ''}`))
    const nuevas = combos
      .filter((c) => !existentes.has(`${c.talla ?? ''}|${c.color ?? ''}`))
      .map((c) => ({
        producto_id: productoId,
        empresa_id: empresaId,
        talla: c.talla,
        color: c.color,
        sku: [sku, c.talla, c.color].filter(Boolean).map((x) => parteSku(String(x))).join('-')
      }))
    if (!nuevas.length) return toast('Esas combinaciones ya existen', 'warning')
    setGuardando(true)
    const { error } = await supabase.from('producto_variantes').insert(nuevas)
    setGuardando(false)
    if (error) return toast(error.message, 'error')
    toast(`${nuevas.length} variante(s) creada(s)`)
    setTallas('')
    setColores('')
    void cargar()
  }

  async function alternar(v: ProductoVariante) {
    const { error } = await supabase.from('producto_variantes').update({ activa: !v.activa }).eq('id', v.id)
    if (error) return toast(error.message, 'error')
    setVariantes((prev) => prev.map((x) => (x.id === v.id ? { ...x, activa: !x.activa } : x)))
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-fg">
        <Shirt size={15} aria-hidden /> Tallas y colores
      </p>
      {variantes.length === 0 ? (
        <p className="text-xs text-fg-muted">
          Sin variantes: el producto se vende como uno solo. Si las agregas, cada talla/color tendrá su propio
          stock y habrá que elegirla al vender, ingresar o transferir.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {variantes.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => void alternar(v)}
              title={v.activa ? 'Clic para desactivar' : 'Clic para activar'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs transition-colors hover:bg-surface"
            >
              <span className={v.activa ? 'text-fg' : 'text-fg-faint line-through'}>{etiquetaVariante(v) || v.sku}</span>
              {!v.activa && <Badge tone="neutral">inactiva</Badge>}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input placeholder="Tallas: S, M, L…" aria-label="Tallas separadas por coma" value={tallas} onChange={(e) => setTallas(e.target.value)} autoComplete="off" />
        <Input placeholder="Colores: Negro, Blanco…" aria-label="Colores separados por coma" value={colores} onChange={(e) => setColores(e.target.value)} autoComplete="off" />
        <Button type="button" variant="secondary" onClick={() => void generar()} disabled={guardando}>
          <Plus size={14} /> Crear
        </Button>
      </div>
      <p className="text-xs text-fg-muted">Se crea una variante por cada combinación talla × color. Las variantes no se borran: se desactivan.</p>
    </div>
  )
}
