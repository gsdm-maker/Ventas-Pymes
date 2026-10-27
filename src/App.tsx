import { lazy, type ComponentType } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AuthGuard, ModuloGuard } from '@/core/auth/guards'
import { Login } from '@/pages/Login'
import { CambiarClave } from '@/pages/CambiarClave'
import { Restablecer } from '@/pages/Restablecer'

// Cada pantalla se descarga al entrar a ella (el service worker igual las guarda todas para
// usarlas sin conexión). Así el login y el POS no bajan, por ejemplo, la librería de gráficos.
const pagina = <M,>(cargar: () => Promise<M>, nombre: keyof M) =>
  lazy(async () => ({ default: (await cargar())[nombre] as ComponentType }))

const Dashboard = pagina(() => import('@/pages/Dashboard'), 'Dashboard')
const POS = pagina(() => import('@/pages/POS'), 'POS')
const SalidaRapida = pagina(() => import('@/pages/SalidaRapida'), 'SalidaRapida')
const Salidas = pagina(() => import('@/pages/Salidas'), 'Salidas')
const Ingreso = pagina(() => import('@/pages/Ingreso'), 'Ingreso')
const Inventario = pagina(() => import('@/pages/Inventario'), 'Inventario')
const ProductoDetalle = pagina(() => import('@/pages/ProductoDetalle'), 'ProductoDetalle')
const Productos = pagina(() => import('@/pages/Productos'), 'Productos')
const Bodega = pagina(() => import('@/pages/Bodega'), 'Bodega')
const Movimientos = pagina(() => import('@/pages/Movimientos'), 'Movimientos')
const Reportes = pagina(() => import('@/pages/Reportes'), 'Reportes')
const Usuarios = pagina(() => import('@/pages/Usuarios'), 'Usuarios')
const Configuracion = pagina(() => import('@/pages/Configuracion'), 'Configuracion')
const Sync = pagina(() => import('@/pages/Sync'), 'Sync')
const Voucher = pagina(() => import('@/pages/Voucher'), 'Voucher')
const Admin = pagina(() => import('@/pages/admin/Admin'), 'Admin')
const AdminEmpresas = pagina(() => import('@/pages/admin/AdminEmpresas'), 'AdminEmpresas')
const AdminEmpresaDetalle = pagina(() => import('@/pages/admin/AdminEmpresaDetalle'), 'AdminEmpresaDetalle')
const AdminAsistente = pagina(() => import('@/pages/admin/AdminAsistente'), 'AdminAsistente')
const AdminOwners = pagina(() => import('@/pages/admin/AdminOwners'), 'AdminOwners')
const AdminActividad = pagina(() => import('@/pages/admin/AdminActividad'), 'AdminActividad')
const NoEncontrado = pagina(() => import('@/pages/NoEncontrado'), 'NoEncontrado')
const Reposicion = pagina(() => import('@/pages/Reposicion'), 'Reposicion')
const Mesas = pagina(() => import('@/pages/Mesas'), 'Mesas')
const Cocina = pagina(() => import('@/pages/Cocina'), 'Cocina')
const Ayuda = pagina(() => import('@/pages/Ayuda'), 'Ayuda')

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/cambiar-clave" element={<CambiarClave />} />
      <Route path="/restablecer" element={<Restablecer />} />

      <Route element={<AuthGuard />}>
        <Route index element={<ModuloGuard cap="modulos.dashboard"><Dashboard /></ModuloGuard>} />
        <Route path="pos" element={<ModuloGuard cap="modulos.pos"><POS /></ModuloGuard>} />
        <Route path="mesas" element={<ModuloGuard cap="modulos.mesas"><Mesas /></ModuloGuard>} />
        <Route path="cocina" element={<ModuloGuard cap="modulos.cocina"><Cocina /></ModuloGuard>} />
        <Route path="salidas" element={<ModuloGuard cap="modulos.salidas"><Salidas /></ModuloGuard>} />
        <Route path="salidas/nueva" element={<ModuloGuard cap="modulos.salidas"><SalidaRapida /></ModuloGuard>} />
        <Route path="ingreso" element={<ModuloGuard cap="modulos.ingreso"><Ingreso /></ModuloGuard>} />
        <Route path="inventario" element={<ModuloGuard cap="modulos.inventario"><Inventario /></ModuloGuard>} />
        <Route path="inventario/:id" element={<ModuloGuard cap="modulos.inventario"><ProductoDetalle /></ModuloGuard>} />
        <Route path="reposicion" element={<ModuloGuard cap="modulos.inventario"><Reposicion /></ModuloGuard>} />
        <Route path="productos" element={<ModuloGuard cap="modulos.productos"><Productos /></ModuloGuard>} />
        <Route path="bodega" element={<ModuloGuard cap="modulos.bodega"><Bodega /></ModuloGuard>} />
        <Route path="movimientos" element={<ModuloGuard cap="modulos.movimientos"><Movimientos /></ModuloGuard>} />
        <Route path="reportes" element={<ModuloGuard cap="modulos.reportes"><Reportes /></ModuloGuard>} />
        <Route path="usuarios" element={<ModuloGuard cap="modulos.usuarios"><Usuarios /></ModuloGuard>} />
        <Route path="configuracion" element={<ModuloGuard cap="modulos.configuracion"><Configuracion /></ModuloGuard>} />
        <Route path="sync" element={<Sync />} />
        <Route path="ayuda" element={<Ayuda />} />
        <Route path="voucher/:id" element={<Voucher />} />
        <Route path="admin" element={<Admin />} />
        <Route path="admin/empresas" element={<AdminEmpresas />} />
        <Route path="admin/empresas/:id" element={<AdminEmpresaDetalle />} />
        <Route path="admin/asistente" element={<AdminAsistente />} />
        <Route path="admin/owners" element={<AdminOwners />} />
        <Route path="admin/actividad" element={<AdminActividad />} />
        <Route path="*" element={<NoEncontrado />} />
      </Route>
    </Routes>
  )
}
