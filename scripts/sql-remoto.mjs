// Ejecuta SQL en la base del VPS por SSH (psql como postgres). Sin Supabase.
// Uso:
//   node scripts/sql-remoto.mjs --ensayo supabase/pruebas/seguridad.sql
//   node scripts/sql-remoto.mjs --ensayo supabase/migrations/0031_x.sql supabase/pruebas/seguridad.sql
//   node scripts/sql-remoto.mjs supabase/migrations/0031_x.sql          (sobre la base real, con cuidado)
//
// --ensayo: copia la base real a `<base>_ensayo`, carga los datos de prueba (infra/vps/pruebas/fixture.sql),
//           corre los archivos y borra la copia. La base real no se toca: sirve para probar una migración
//           antes de aplicarla y para correr las suites (terminan en excepción y se revierten solas).
// Sin --ensayo: corre sobre la base real, sin datos de prueba ni reversa. Aplicar una migración se hace así,
//           con `set role <base>_owner;` al inicio del archivo y solo con el OK del dueño.
//
// Conexión (nada de esto se versiona):
//   VPS_SSH         usuario@host (si falta, se lee «ssh usuario@host» de Datakeys.md)
//   VPS_SSH_KEY     clave privada (por defecto ~/.ssh/id_ed25519_gsdm_qa)
//   VPS_SUDO_PASS   clave sudo (si falta, la línea «pass» que sigue a «VPS:» en Datakeys.md)
//   VPS_DB          base (por defecto misociopyme)
// Usuarios de las suites ({{USUARIO_TIENDA}} y {{USUARIO_ADMIN}}): los del fixture, o PRUEBAS_USUARIO_*.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const ensayo = args.includes('--ensayo')
const archivos = args.filter((a) => !a.startsWith('--'))
if (!archivos.length) {
  console.error('Indica al menos un archivo .sql')
  process.exit(1)
}

const datakeys = existsSync('Datakeys.md') ? readFileSync('Datakeys.md', 'utf8') : ''
const ssh = process.env.VPS_SSH ?? datakeys.match(/ssh\s+([\w.-]+@[\d.]+)/)?.[1]
const lineas = datakeys.split(/\r?\n/)
const iVps = lineas.findIndex((l) => /^VPS:/.test(l))
const passDatakeys = iVps >= 0 ? lineas.slice(iVps).map((l) => l.match(/^pass[: ]*(\S.*)$/i)?.[1]).find(Boolean) : undefined
const sudoPass = process.env.VPS_SUDO_PASS ?? passDatakeys
if (!ssh || !sudoPass) {
  console.error('Falta VPS_SSH o VPS_SUDO_PASS (o la sección «VPS:» de Datakeys.md)')
  process.exit(1)
}
const clave = process.env.VPS_SSH_KEY ?? join(homedir(), '.ssh', 'id_ed25519_gsdm_qa')
const base = process.env.VPS_DB ?? 'misociopyme'
if (!/^[a-z][a-z0-9_]*$/.test(base)) {
  console.error('VPS_DB inválida')
  process.exit(1)
}

const usuarios = {
  USUARIO_TIENDA: process.env.PRUEBAS_USUARIO_TIENDA ?? 'tienda@prueba.invalid',
  USUARIO_ADMIN: process.env.PRUEBAS_USUARIO_ADMIN ?? 'admin@prueba.invalid'
}
const sql = archivos
  .map((f) => readFileSync(f, 'utf8').replace(/\r$/gm, ''))
  .join('\n;\n')
  .replace(/\{\{(USUARIO_TIENDA|USUARIO_ADMIN)\}\}/g, (_, k) => usuarios[k])
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64').match(/.{1,76}/g).join('\n')

const destino = ensayo ? `${base}_ensayo` : base
const psql = (db, extra = '') => `runuser -u postgres -- psql -X -p 5433 -d ${db} ${extra}`
let guion = `set -u
W=$(mktemp -d); chmod 755 "$W"; trap 'rm -rf "$W"' EXIT
base64 -d > "$W/q.sql" <<'FIN_Q'
${b64(sql)}
FIN_Q
chmod 644 "$W/q.sql"
`
if (ensayo) {
  const fixture = readFileSync('infra/vps/pruebas/fixture.sql', 'utf8').replace(/\r$/gm, '')
  guion += `base64 -d > "$W/fixture.sql" <<'FIN_F'
${b64(fixture)}
FIN_F
chmod 644 "$W/fixture.sql"
${psql('postgres', `-qc "drop database if exists ${destino}"`)} >/dev/null 2>&1
${psql('postgres', `-qc "create database ${destino} owner ${base}_owner"`)} >&2
runuser -u postgres -- pg_dump -p 5433 -Fc ${base} > "$W/copia.dump" || echo "volcado falló" >&2
chmod 644 "$W/copia.dump"
runuser -u postgres -- pg_restore -p 5433 -d ${destino} --no-owner --role=${base}_owner "$W/copia.dump" >/dev/null 2>&1 || true
${psql(destino, '-q -v ON_ERROR_STOP=1 -f "$W/fixture.sql"')} >&2 || echo "fixture falló" >&2
`
}
guion += `${psql(destino, '-X -f "$W/q.sql"')} 2>&1
`
if (ensayo) guion += `${psql('postgres', `-qc "drop database if exists ${destino}"`)} >/dev/null 2>&1\n`

const r = spawnSync('ssh', ['-i', clave, '-o', 'BatchMode=yes', ssh, "sudo -S -p '' bash"], {
  input: `${sudoPass}\n${guion}`,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024
})
if (r.error) {
  console.error('No se pudo ejecutar ssh:', r.error.message)
  process.exit(1)
}
const salida = (r.stdout ?? '') + (r.stderr ?? '')

// Las pruebas terminan con una excepción "RESULTADOS [...]": se muestran como lista
const i = salida.indexOf('RESULTADOS [')
let filas
if (i >= 0) {
  const resto = salida.slice(i + 'RESULTADOS '.length)
  const corte = resto.search(/\n(CONTEXT|STATEMENT|LINE \d+):/)
  try {
    filas = JSON.parse((corte >= 0 ? resto.slice(0, corte) : resto).trim())
  } catch {
    filas = undefined
  }
}
if (filas) {
  for (const f of filas) console.log(`\n• ${f.caso}\n    esperado: ${f.esperado}\n    obtenido: ${f.obtenido}`)
  console.log(ensayo ? '\n(Ensayo en una copia: la base real no se tocó)' : '\n(Transacción revertida: no se guardó ningún cambio)')
} else {
  console.log(salida.replace(sudoPass, '<oculto>'))
  if (r.status !== 0 || /ERROR:/.test(salida)) process.exit(1)
}
