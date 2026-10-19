/**
 * Comprime una foto en el navegador antes de subirla: lado mayor ≤ `maxLado` px,
 * WebP (o JPEG si el navegador no sabe generar WebP). Una foto de celular de
 * 3–5 MB queda en ~100 KB.
 */
export async function comprimirImagen(archivo: File, maxLado = 1000, calidad = 0.78): Promise<Blob> {
  const bitmap = await crearBitmap(archivo)
  const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height))
  const ancho = Math.round(bitmap.width * escala)
  const alto = Math.round(bitmap.height * escala)

  const canvas = document.createElement('canvas')
  canvas.width = ancho
  canvas.height = alto
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo procesar la imagen')
  ctx.drawImage(bitmap, 0, 0, ancho, alto)
  if ('close' in bitmap) bitmap.close()

  const webp = await aBlob(canvas, 'image/webp', calidad)
  if (webp && webp.type === 'image/webp') return webp
  const jpeg = await aBlob(canvas, 'image/jpeg', calidad)
  if (!jpeg) throw new Error('No se pudo comprimir la imagen')
  return jpeg
}

async function crearBitmap(archivo: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    // Respeta la orientación EXIF de las fotos de celular
    return createImageBitmap(archivo, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  }
  const url = URL.createObjectURL(archivo)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function aBlob(canvas: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, calidad))
}
