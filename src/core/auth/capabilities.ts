import type { Puesto } from '@/core/types'

export const MODULOS = [
  'dashboard',
  'pos',
  'mesas',
  'cocina',
  'salidas',
  'ingreso',
  'inventario',
  'productos',
  'bodega',
  'movimientos',
  'reportes',
  'usuarios',
  'configuracion'
] as const

export type Modulo = (typeof MODULOS)[number]

export type Capability =
  | `modulos.${Modulo}`
  | 'pos.vender'
  | 'mesas.atender'
  | 'cocina.gestionar'
  | 'salidas.registrar'
  | 'ingreso.registrar'
  | 'transferencias.gestionar'
  | 'inventario.ajustar'
  | 'productos.gestionar'
  | 'usuarios.gestionar'
  | 'config.gestionar'
  | 'reportes.ver'
  | 'ventas.devolver'

export const CAPABILITY_LABELS: Record<Capability, { label: string; group: string }> =
  {
    'modulos.dashboard': { label: 'Dashboard', group: 'Módulos' },
    'modulos.pos': { label: 'Punto de Venta', group: 'Módulos' },
    'modulos.mesas': { label: 'Mesas (restaurante)', group: 'Módulos' },
    'modulos.cocina': { label: 'Cocina (comandas)', group: 'Módulos' },
    'modulos.salidas': { label: 'Salidas y vouchers', group: 'Módulos' },
    'modulos.ingreso': { label: 'Ingreso de mercadería', group: 'Módulos' },
    'modulos.inventario': { label: 'Inventario', group: 'Módulos' },
    'modulos.productos': { label: 'Productos', group: 'Módulos' },
    'modulos.bodega': { label: 'Bodega y transferencias', group: 'Módulos' },
    'modulos.movimientos': { label: 'Movimientos', group: 'Módulos' },
    'modulos.reportes': { label: 'Reportes', group: 'Módulos' },
    'modulos.usuarios': { label: 'Usuarios y permisos', group: 'Módulos' },
    'modulos.configuracion': { label: 'Configuración', group: 'Módulos' },
    'pos.vender': { label: 'Registrar ventas (POS)', group: 'Acciones' },
    'mesas.atender': { label: 'Atender mesas y enviar comandas', group: 'Acciones' },
    'cocina.gestionar': { label: 'Gestionar comandas en cocina', group: 'Acciones' },
    'salidas.registrar': { label: 'Registrar salidas', group: 'Acciones' },
    'ingreso.registrar': { label: 'Registrar recepciones', group: 'Acciones' },
    'transferencias.gestionar': { label: 'Gestionar transferencias', group: 'Acciones' },
    'inventario.ajustar': { label: 'Ajustar inventario', group: 'Acciones' },
    'productos.gestionar': { label: 'Gestionar productos', group: 'Acciones' },
    'usuarios.gestionar': { label: 'Gestionar usuarios', group: 'Acciones' },
    'config.gestionar': { label: 'Gestionar configuración', group: 'Acciones' },
    'reportes.ver': { label: 'Ver reportes', group: 'Acciones' },
    'ventas.devolver': { label: 'Devolver o anular ventas', group: 'Acciones' }
  }

const MODULOS_POR_PUESTO: Record<Puesto, Modulo[]> = {
  admin: [...MODULOS],
  bodega: ['dashboard', 'ingreso', 'inventario', 'productos', 'bodega', 'movimientos'],
  tienda: ['dashboard', 'pos', 'mesas', 'cocina', 'salidas', 'inventario', 'movimientos'],
  auditor: ['dashboard', 'inventario', 'movimientos', 'reportes']
}

const ACCIONES_POR_PUESTO: Record<Puesto, Capability[]> = {
  admin: [
    'pos.vender',
    'mesas.atender',
    'cocina.gestionar',
    'salidas.registrar',
    'ingreso.registrar',
    'transferencias.gestionar',
    'inventario.ajustar',
    'productos.gestionar',
    'usuarios.gestionar',
    'config.gestionar',
    'reportes.ver',
    'ventas.devolver'
  ],
  bodega: [
    'ingreso.registrar',
    'transferencias.gestionar',
    'inventario.ajustar',
    'productos.gestionar'
  ],
  tienda: ['pos.vender', 'mesas.atender', 'cocina.gestionar', 'salidas.registrar'],
  auditor: ['reportes.ver']
}

export const ROLE_DEFAULTS: Record<Puesto, Capability[]> = Object.fromEntries(
  (Object.keys(MODULOS_POR_PUESTO) as Puesto[]).map((p) => [
    p,
    [
      ...MODULOS_POR_PUESTO[p].map((m) => `modulos.${m}` as Capability),
      ...ACCIONES_POR_PUESTO[p]
    ]
  ])
) as Record<Puesto, Capability[]>

/** Evalúa una capacidad en orden estricto (módulo apagado gana siempre). */
export function evaluarCapacidad(
  cap: Capability,
  opts: {
    esOwner: boolean
    role: 'admin' | 'integrante'
    puesto: Puesto
    modulosHabilitados: Modulo[]
    overrides: Record<string, boolean>
  }
): boolean {
  const { esOwner, role, puesto, modulosHabilitados, overrides } = opts

  // 1) Módulo apagado => nadie lo ve (ni admin, ni owner)
  if (cap.startsWith('modulos.')) {
    const m = cap.slice('modulos.'.length) as Modulo
    if (!modulosHabilitados.includes(m)) return false
    if (esOwner || role === 'admin') return true
    return ROLE_DEFAULTS[puesto].includes(cap)
  }

  // owner ve todo
  if (esOwner) return true
  // 3) override explícito (permite sumar o revocar)
  if (cap in overrides) return overrides[cap]
  // 2) admin de empresa: todas las acciones de módulos habilitados
  if (role === 'admin') return true
  // 4) defaults por puesto
  return ROLE_DEFAULTS[puesto].includes(cap)
}
