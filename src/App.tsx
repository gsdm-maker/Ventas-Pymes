import { Route, Routes } from 'react-router-dom'
import { AuthGuard, ModuloGuard } from '@/core/auth/guards'
import { Login } from '@/pages/Login'
import { CambiarClave } from '@/pages/CambiarClave'
import { Restablecer } from '@/pages/Restablecer'
import { Dashboard } from '@/pages/Dashboard'
import { POS } from '@/pages/POS'
import { SalidaRapida } from '@/pages/SalidaRapida'
import { Salidas } from '@/pages/Salidas'
import { Ingreso } from '@/pages/Ingreso'
import { Inventario } from '@/pages/Inventario'
import { ProductoDetalle } from '@/pages/ProductoDetalle'
import { Productos } from '@/pages/Productos'
import { Bodega } from '@/pages/Bodega'
import { Movimientos } from '@/pages/Movimientos'
import { Reportes } from '@/pages/Reportes'
import { Usuarios } from '@/pages/Usuarios'
import { Configuracion } from '@/pages/Configuracion'
import { Sync } from '@/pages/Sync'
import { Voucher } from '@/pages/Voucher'
import { Admin } from '@/pages/admin/Admin'
import { AdminEmpresas } from '@/pages/admin/AdminEmpresas'
import { AdminEmpresaDetalle } from '@/pages/admin/AdminEmpresaDetalle'
import { AdminOwners } from '@/pages/admin/AdminOwners'
import { AdminActividad } from '@/pages/admin/AdminActividad'
import { NoEncontrado } from '@/pages/NoEncontrado'
import { Reposicion } from '@/pages/Reposicion'
import { Mesas } from '@/pages/Mesas'
import { Cocina } from '@/pages/Cocina'

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
        <Route path="voucher/:id" element={<Voucher />} />
        <Route path="admin" element={<Admin />} />
        <Route path="admin/empresas" element={<AdminEmpresas />} />
        <Route path="admin/empresas/:id" element={<AdminEmpresaDetalle />} />
        <Route path="admin/owners" element={<AdminOwners />} />
        <Route path="admin/actividad" element={<AdminActividad />} />
        <Route path="*" element={<NoEncontrado />} />
      </Route>
    </Routes>
  )
}
