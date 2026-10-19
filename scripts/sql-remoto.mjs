// Ejecuta SQL en el proyecto Supabase vía Management API.
// Uso:
//   node scripts/sql-remoto.mjs supabase/pruebas/seguridad.sql
//   node scripts/sql-remoto.mjs --antes supabase/migrations/0010_x.sql supabase/pruebas/seguridad.sql
// Token: variable SUPABASE_ACCESS_TOKEN o el token sbp_ de Datakeys.md (no versionado).
// Proyecto: variable SUPABASE_PROJECT_REF o supabase/.temp/project-ref.
// Usuarios de prueba ({{USUARIO_TIENDA}} y {{USUARIO_ADMIN}} en supabase/pruebas): variables
// PRUEBAS_USUARIO_TIENDA / PRUEBAS_USUARIO_ADMIN o líneas «Prueba tienda: …» / «Prueba admin: …»
// de Datakeys.md, para que los correos reales no queden en el repositorio.
import { existsSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const archivos = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--antes') archivos.push(args[++i])
  else archivos.push(args[i])
}
if (!archivos.length) {
  console.error('Indica al menos un archivo .sql')
  process.exit(1)
}

const token =
  process.env.SUPABASE_ACCESS_TOKEN ??
  (existsSync('Datakeys.md') ? readFileSync('Datakeys.md', 'utf8').match(/sbp_[A-Za-z0-9]+/)?.[0] : undefined)
const ref =
  process.env.SUPABASE_PROJECT_REF ??
  (existsSync('supabase/.temp/project-ref') ? readFileSync('supabase/.temp/project-ref', 'utf8').trim() : undefined)
if (!token || !ref) {
  console.error('Falta SUPABASE_ACCESS_TOKEN o SUPABASE_PROJECT_REF')
  process.exit(1)
}

const datakeys = existsSync('Datakeys.md') ? readFileSync('Datakeys.md', 'utf8') : ''
const deDatakeys = (etiqueta) => datakeys.match(new RegExp(`^\\s*${etiqueta}:\\s*(\\S+@\\S+)`, 'im'))?.[1]
const usuarios = {
  USUARIO_TIENDA: process.env.PRUEBAS_USUARIO_TIENDA ?? deDatakeys('Prueba tienda'),
  USUARIO_ADMIN: process.env.PRUEBAS_USUARIO_ADMIN ?? deDatakeys('Prueba admin')
}
const query = archivos
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n;\n')
  .replace(/\{\{(USUARIO_TIENDA|USUARIO_ADMIN)\}\}/g, (_, k) => {
    if (!usuarios[k]) {
      console.error(`Falta el correo de ${k}: define PRUEBAS_${k} o agrega «Prueba ${k === 'USUARIO_TIENDA' ? 'tienda' : 'admin'}: correo» en Datakeys.md`)
      process.exit(1)
    }
    return usuarios[k]
  })
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
})
const body = await r.json()

// Las pruebas terminan con una excepción "RESULTADOS [...]": se muestran como tabla
const m = typeof body?.message === 'string' && body.message.match(/RESULTADOS (\[.*\])/s)
if (m) {
  const filas = JSON.parse(m[1])
  for (const f of filas) {
    console.log(`\n• ${f.caso}\n    esperado: ${f.esperado}\n    obtenido: ${f.obtenido}`)
  }
  console.log('\n(Transacción revertida: no se guardó ningún cambio)')
} else {
  console.log(r.status, JSON.stringify(body, null, 1))
  if (!r.ok) process.exit(1)
}
