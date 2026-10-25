// Verifica que el catálogo de módulos y permisos esté igual en sus tres copias:
//   1) src/core/auth/capabilities.ts (front)
//   2) supabase/migrations/*.sql (la definición más reciente de _catalogo_caps, _caps_puesto
//      y el CHECK empresas_modulos_check)
//   3) supabase/functions/admin-users/index.ts (MODULOS)
// Uso: npm run verificar:catalogo   (sale con código 1 si algo no calza)
// No toca la base: lee los archivos del repositorio.
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const ts = createRequire(import.meta.url)('typescript')

// ---------- 1) Front ----------
const fuente = readFileSync('src/core/auth/capabilities.ts', 'utf8')
const js = ts.transpileModule(fuente, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText
const front = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const frontModulos = [...front.MODULOS]
const frontCaps = Object.keys(front.CAPABILITY_LABELS)
const frontPuestos = Object.fromEntries(Object.entries(front.ROLE_DEFAULTS).map(([p, caps]) => [p, [...caps]]))

// ---------- 2) SQL: la última definición gana ----------
const migraciones = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
function ultima(regex) {
  let hallado = null
  for (const f of migraciones) {
    const sql = readFileSync(`supabase/migrations/${f}`, 'utf8')
    for (const m of sql.matchAll(regex)) hallado = { archivo: f, texto: m[1] }
  }
  if (!hallado) throw new Error(`No se encontró ${regex}`)
  return hallado
}
const comillas = (t) => [...t.matchAll(/'([^']+)'/g)].map((m) => m[1])

const sqlCaps = ultima(/function public\._catalogo_caps\(\)[\s\S]*?select array\[([\s\S]*?)\];/g)
const sqlModulos = ultima(/add constraint empresas_modulos_check\s+check \(modulos <@ array\[([\s\S]*?)\]\)/g)
const sqlPuestosDef = ultima(/function public\._caps_puesto\(p_puesto text\)([\s\S]*?)end;\s*\$\$/g)
const sqlPuestos = Object.fromEntries(
  [...sqlPuestosDef.texto.matchAll(/when '(\w+)' then array\[([\s\S]*?)\]/g)].map((m) => [m[1], comillas(m[2])])
)

// ---------- 3) Edge Function ----------
const edge = readFileSync('supabase/functions/admin-users/index.ts', 'utf8')
const edgeModulos = comillas(edge.match(/const MODULOS = \[([\s\S]*?)\]/)[1])

// ---------- Comparación ----------
const errores = []
function igual(nombre, a, b, etiquetaA, etiquetaB) {
  const faltaEnB = a.filter((x) => !b.includes(x))
  const sobraEnB = b.filter((x) => !a.includes(x))
  if (faltaEnB.length || sobraEnB.length) {
    errores.push(
      `✗ ${nombre}\n` +
        (faltaEnB.length ? `    en ${etiquetaA} pero no en ${etiquetaB}: ${faltaEnB.join(', ')}\n` : '') +
        (sobraEnB.length ? `    en ${etiquetaB} pero no en ${etiquetaA}: ${sobraEnB.join(', ')}\n` : '')
    )
  } else {
    console.log(`✓ ${nombre}`)
  }
}

igual('Módulos: front vs CHECK de empresas', frontModulos, comillas(sqlModulos.texto), 'capabilities.ts', sqlModulos.archivo)
igual('Módulos: front vs admin-users', frontModulos, edgeModulos, 'capabilities.ts', 'admin-users')
igual('Capacidades: front vs _catalogo_caps', frontCaps, comillas(sqlCaps.texto), 'capabilities.ts', sqlCaps.archivo)
igual('Puestos: front vs _caps_puesto', Object.keys(frontPuestos), Object.keys(sqlPuestos), 'capabilities.ts', sqlPuestosDef.archivo)
for (const puesto of Object.keys(frontPuestos)) {
  igual(`Permisos por defecto de «${puesto}»`, frontPuestos[puesto], sqlPuestos[puesto] ?? [], 'capabilities.ts', sqlPuestosDef.archivo)
}

if (errores.length) {
  console.error('\n' + errores.join('\n'))
  console.error('El catálogo está desalineado: corrige la copia que falta (y agrega una migración si es SQL).')
  process.exit(1)
}
console.log('\nCatálogo alineado en front, base de datos y Edge Function.')
