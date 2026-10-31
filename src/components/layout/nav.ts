import {
  LayoutDashboard,
  ShoppingCart,
  PackageMinus,
  PackagePlus,
  Boxes,
  Tags,
  Warehouse,
  ArrowLeftRight,
  FileText,
  BarChart3,
  Users,
  Settings,
  BellRing,
  UtensilsCrossed,
  ChefHat,
  ShieldCheck,
  Building2,
  Sparkles,
  ScrollText,
  type LucideIcon
} from 'lucide-react'
import type { Capability } from '@/core/auth/capabilities'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  cap?: Capability
  grupo: 'operacion' | 'inventario' | 'admin'
  mobile?: boolean
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, cap: 'modulos.dashboard', grupo: 'operacion', mobile: true },
  { to: '/pos', label: 'Punto de Venta', icon: ShoppingCart, cap: 'modulos.pos', grupo: 'operacion', mobile: true },
  { to: '/mesas', label: 'Mesas', icon: UtensilsCrossed, cap: 'modulos.mesas', grupo: 'operacion', mobile: true },
  { to: '/cocina', label: 'Cocina', icon: ChefHat, cap: 'modulos.cocina', grupo: 'operacion' },
  { to: '/salidas', label: 'Salidas y vouchers', icon: PackageMinus, cap: 'modulos.salidas', grupo: 'operacion', mobile: true },
  { to: '/ingreso', label: 'Ingreso de mercadería', icon: PackagePlus, cap: 'modulos.ingreso', grupo: 'operacion' },
  { to: '/inventario', label: 'Inventario', icon: Boxes, cap: 'modulos.inventario', grupo: 'inventario', mobile: true },
  { to: '/reposicion', label: 'Reposición y alertas', icon: BellRing, cap: 'modulos.inventario', grupo: 'inventario' },
  { to: '/productos', label: 'Productos', icon: Tags, cap: 'modulos.productos', grupo: 'inventario' },
  { to: '/bodega', label: 'Bodega y transferencias', icon: Warehouse, cap: 'modulos.bodega', grupo: 'inventario', mobile: true },
  { to: '/movimientos', label: 'Movimientos', icon: ArrowLeftRight, cap: 'modulos.movimientos', grupo: 'inventario' },
  { to: '/reportes', label: 'Reportes', icon: BarChart3, cap: 'modulos.reportes', grupo: 'admin' },
  { to: '/usuarios', label: 'Usuarios y permisos', icon: Users, cap: 'modulos.usuarios', grupo: 'admin' },
  { to: '/configuracion', label: 'Configuración', icon: Settings, cap: 'modulos.configuracion', grupo: 'admin' }
]

export const GRUPOS: { key: NavItem['grupo']; label: string }[] = [
  { key: 'operacion', label: 'Operación' },
  { key: 'inventario', label: 'Inventario' },
  { key: 'admin', label: 'Administración' }
]

/** Secciones de la consola general (solo Admin general). Las usan las pestañas, la barra
 *  inferior del celular y el menú «Más». `corto` es el texto de la barra inferior. */
export interface AdminNavItem {
  to: string
  label: string
  corto: string
  icon: LucideIcon
}

export const ADMIN_NAV: AdminNavItem[] = [
  { to: '/admin', label: 'Resumen', corto: 'Resumen', icon: ShieldCheck },
  { to: '/admin/empresas', label: 'Empresas', corto: 'Empresas', icon: Building2 },
  { to: '/admin/asistente', label: 'Asistente IA', corto: 'IA', icon: Sparkles },
  { to: '/admin/owners', label: 'Admins generales', corto: 'Admins', icon: Users },
  { to: '/admin/actividad', label: 'Actividad', corto: 'Actividad', icon: ScrollText }
]

export { FileText }
