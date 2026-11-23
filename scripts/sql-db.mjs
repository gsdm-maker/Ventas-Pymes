#!/usr/bin/env node
// Ejecuta SQL contra PostgreSQL directamente (psql).
// Uso:
//   node scripts/sql-db.mjs db/pruebas/seguridad.sql
// Conexion por variables de entorno (valores por defecto):
//   PGHOST=127.0.0.1 PGPORT=5433 PGDATABASE=misociopyme PGUSER=gsdm_admin PGPASSWORD=...
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const archivos = process.argv.slice(2)
if (!archivos.length) {
  console.error('Uso: node scripts/sql-db.mjs <archivo.sql> [...]')
  process.exit(1)
}

const env = {
  ...process.env,
  PGHOST: process.env.PGHOST ?? '127.0.0.1',
  PGPORT: process.env.PGPORT ?? '5433',
  PGDATABASE: process.env.PGDATABASE ?? 'misociopyme',
  PGUSER: process.env.PGUSER ?? 'gsdm_admin',
}

for (const archivo of archivos) {
  const sql = readFileSync(archivo, 'utf8')
  const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: sql,
    env,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  if (r.error) { console.error('No se pudo ejecutar psql:', r.error.message); process.exit(1) }
  if (r.status !== 0) process.exit(r.status ?? 1)
}
