import { useRef, useState } from 'react'
import { Camera, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { supabase } from '@/core/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { comprimirImagen } from '@/lib/imagen'

/**
 * Foto del producto: se toma con la cámara (celular) o se elige un archivo, se
 * comprime en el navegador y se guarda en Storage (bucket «productos», carpeta de
 * la empresa). Devuelve la URL pública con un parámetro de versión.
 */
export function FotoProducto({
  url,
  empresaId,
  productoId,
  disabled,
  onChange
}: {
  url: string
  empresaId: string
  productoId: string
  disabled?: boolean
  onChange: (url: string) => void
}) {
  const toast = useToast()
  const camara = useRef<HTMLInputElement>(null)
  const archivo = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState(false)

  async function subir(f: File | undefined) {
    if (!f) return
    if (!f.type.startsWith('image/')) return toast('El archivo no es una imagen', 'warning')
    setSubiendo(true)
    try {
      const blob = await comprimirImagen(f)
      const ext = blob.type === 'image/webp' ? 'webp' : 'jpg'
      const ruta = `${empresaId}/${productoId}.${ext}`
      const { error } = await supabase.storage
        .from('productos')
        .upload(ruta, blob, { upsert: true, contentType: blob.type, cacheControl: '31536000' })
      if (error) throw error
      const { data } = supabase.storage.from('productos').getPublicUrl(ruta)
      // La versión evita que el navegador muestre la foto anterior
      onChange(`${data.publicUrl}?v=${Date.now()}`)
      toast(`Foto guardada (${Math.round(blob.size / 1024)} KB)`)
    } catch (e) {
      toast((e as Error).message || 'No se pudo subir la foto', 'error')
    } finally {
      setSubiendo(false)
      if (camara.current) camara.current.value = ''
      if (archivo.current) archivo.current.value = ''
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative grid size-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface-2">
        {url ? (
          <img src={url} alt="Foto del producto" width={96} height={96} className="size-full object-cover" />
        ) : (
          <Camera size={24} className="text-fg-faint" aria-hidden />
        )}
        {subiendo && (
          <span className="absolute inset-0 grid place-items-center bg-panel/70">
            <Loader2 size={20} className="animate-spin text-accent" aria-label="Subiendo foto" />
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {/* capture abre directo la cámara trasera en el celular */}
        <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void subir(e.target.files?.[0])} />
        <input ref={archivo} type="file" accept="image/*" className="hidden" onChange={(e) => void subir(e.target.files?.[0])} />
        <button
          type="button"
          disabled={disabled || subiendo}
          onClick={() => camara.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-container disabled:opacity-50"
        >
          <Camera size={14} aria-hidden /> Tomar foto
        </button>
        <button
          type="button"
          disabled={disabled || subiendo}
          onClick={() => archivo.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-fg-body hover:bg-surface disabled:opacity-50"
        >
          <ImagePlus size={14} aria-hidden /> Elegir imagen
        </button>
        {url && (
          <button
            type="button"
            disabled={disabled || subiendo}
            onClick={() => onChange('')}
            className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-danger disabled:opacity-50"
          >
            <Trash2 size={13} aria-hidden /> Quitar foto
          </button>
        )}
      </div>
    </div>
  )
}
