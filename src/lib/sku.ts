/** Código interno sugerido: 3 letras de la categoría (o PRD) + correlativo libre, p. ej. ROP-005. */
export function skuAutomatico(nombreCategoria: string | undefined, skusExistentes: string[]): string {
  const prefijo = (nombreCategoria ?? 'PRD')
    .normalize('NFD')
    .replace(/[^a-zA-Z]/g, '')
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, 'X')
  const usados = new Set(skusExistentes.map((s) => s.toUpperCase()))
  let n = skusExistentes.filter((s) => s.toUpperCase().startsWith(prefijo + '-')).length + 1
  while (usados.has(`${prefijo}-${String(n).padStart(3, '0')}`)) n++
  return `${prefijo}-${String(n).padStart(3, '0')}`
}
