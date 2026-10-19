/**
 * EAN-13. Los códigos internos usan el prefijo 2 (rango reservado para uso interno
 * de la tienda, no choca con códigos de fabricantes).
 */

/** Dígito verificador de los primeros 12 dígitos. */
export function digitoVerificador(doce: string): number {
  let suma = 0
  for (let i = 0; i < 12; i++) suma += Number(doce[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (suma % 10)) % 10
}

export function esEan13Valido(codigo: string): boolean {
  return /^\d{13}$/.test(codigo) && digitoVerificador(codigo.slice(0, 12)) === Number(codigo[12])
}

/** Nuevo EAN-13 interno que no esté en `usados`. */
export function generarEan13Interno(usados: Set<string>): string {
  for (;;) {
    const azar = new Uint32Array(2)
    crypto.getRandomValues(azar)
    const once = (String(azar[0]) + String(azar[1])).padStart(11, '0').slice(-11)
    const doce = '2' + once
    const codigo = doce + digitoVerificador(doce)
    if (!usados.has(codigo)) return codigo
  }
}

// Codificación de barras EAN-13 (L, G, R) y paridad según el primer dígito
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const PARIDAD = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

/** 95 módulos ('1' = barra) de un EAN-13 válido. */
export function modulosEan13(codigo: string): string {
  const d = codigo.split('').map(Number)
  const par = PARIDAD[d[0]]
  let s = '101'
  for (let i = 1; i <= 6; i++) s += (par[i - 1] === 'L' ? L : G)[d[i]]
  s += '01010'
  for (let i = 7; i <= 12; i++) s += R[d[i]]
  return s + '101'
}

/** SVG del código (para la vista previa y la etiqueta impresa). */
export function svgEan13(codigo: string, alto = 60): string {
  const m = modulosEan13(codigo)
  const barras: string[] = []
  for (let i = 0; i < m.length; i++) {
    if (m[i] !== '1') continue
    let j = i
    while (m[j + 1] === '1') j++
    barras.push(`<rect x="${i + 11}" y="0" width="${j - i + 1}" height="${alto}"/>`)
    i = j
  }
  const ancho = 95 + 22
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto + 14}" role="img" aria-label="Código de barras ${codigo}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${barras.join('')}</g><text x="${ancho / 2}" y="${alto + 11}" font-family="monospace" font-size="10" text-anchor="middle" fill="#000">${codigo}</text></svg>`
}
