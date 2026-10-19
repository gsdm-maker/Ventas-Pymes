import { openDB, type DBSchema } from 'idb'

export type TipoOperacion = 'salida' | 'venta'

/** pendiente: se reintenta sola · rechazado: el servidor la rechazó y requiere revisión */
export type EstadoOperacion = 'pendiente' | 'rechazado'

export interface OperacionPendiente {
  key: string
  uuid_local: string
  tipo: TipoOperacion
  payload: Record<string, unknown>
  creado: number
  intentos: number
  /** Usuario que la registró: solo se sincroniza con su sesión */
  user_id?: string
  estado?: EstadoOperacion
  error?: string
}

interface CacheEntry {
  key: string
  value: unknown
  ts: number
}

interface StockFlowDB extends DBSchema {
  cola: { key: string; value: OperacionPendiente; indexes: { porFecha: number } }
  cache: { key: string; value: CacheEntry }
}

// Nombre interno heredado: cambiarlo dejaría huérfana la cola offline de los equipos en uso
const dbp = openDB<StockFlowDB>('stockflow', 1, {
  upgrade(db) {
    const cola = db.createObjectStore('cola', { keyPath: 'key' })
    cola.createIndex('porFecha', 'creado')
    db.createObjectStore('cache', { keyPath: 'key' })
  }
})

function uuid(): string {
  return crypto.randomUUID()
}

// Operaciones guardadas antes de existir user_id se asignan a quien sincronice
function esDe(op: OperacionPendiente, userId: string): boolean {
  return !op.user_id || op.user_id === userId
}

export async function encolar(
  tipo: TipoOperacion,
  payload: Record<string, unknown>,
  userId: string,
  uuidLocal?: string
): Promise<OperacionPendiente> {
  const db = await dbp
  const uuid_local = uuidLocal ?? uuid()
  const op: OperacionPendiente = {
    key: uuid_local,
    uuid_local,
    tipo,
    payload,
    creado: Date.now(),
    intentos: 0,
    user_id: userId,
    estado: 'pendiente'
  }
  await db.put('cola', op)
  return op
}

export async function listarCola(userId: string): Promise<OperacionPendiente[]> {
  const db = await dbp
  const todas = await db.getAllFromIndex('cola', 'porFecha')
  return todas.filter((op) => esDe(op, userId))
}

export async function quitarDeCola(key: string): Promise<void> {
  const db = await dbp
  await db.delete('cola', key)
}

export async function actualizarIntento(op: OperacionPendiente): Promise<void> {
  const db = await dbp
  await db.put('cola', { ...op, intentos: op.intentos + 1 })
}

export async function marcarRechazada(op: OperacionPendiente, error: string): Promise<void> {
  const db = await dbp
  await db.put('cola', { ...op, intentos: op.intentos + 1, estado: 'rechazado', error })
}

export async function reactivar(key: string): Promise<void> {
  const db = await dbp
  const op = await db.get('cola', key)
  if (op) await db.put('cola', { ...op, estado: 'pendiente', error: undefined })
}

export async function guardarCache(key: string, value: unknown): Promise<void> {
  const db = await dbp
  await db.put('cache', { key, value, ts: Date.now() })
}

export async function leerCache<T>(key: string): Promise<T | null> {
  const db = await dbp
  const row = await db.get('cache', key)
  return row ? (row.value as T) : null
}

export async function contarCola(userId: string): Promise<{ pendientes: number; rechazadas: number }> {
  const ops = await listarCola(userId)
  const rechazadas = ops.filter((op) => op.estado === 'rechazado').length
  return { pendientes: ops.length - rechazadas, rechazadas }
}
