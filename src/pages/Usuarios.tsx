import { useEffect, useState } from 'react'
import { Info, Save, UserPlus, KeyRound } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { accesosPorUsuario, actualizarUbicacionesUsuario, listarUsuarios } from '@/core/data/api'
import { SelectorUbicaciones } from '@/components/usuarios/SelectorUbicaciones'
import { EditorPermisos } from '@/components/usuarios/EditorPermisos'
import { limpiarPermisos } from '@/core/auth/capabilities'
import { cn } from '@/lib/cn'
import { asignadasActivas, resumenUbicaciones, sinUbicacionActiva } from '@/lib/ubicaciones'
import type { Puesto, Profile } from '@/core/types'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { LoadingState, PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { actualizarPerfilUsuario, adminUsers } from '@/core/data/admin'

const puestos: Puesto[] = ['admin', 'bodega', 'tienda', 'auditor']

export function Usuarios() {
  const { profile: yo, empresa, ubicaciones, can } = useAuth()
  const toast = useToast()
  const [usuarios, setUsuarios] = useState<Profile[]>([])
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState<Profile | null>(null)
  const [permisos, setPermisos] = useState<Record<string, boolean>>({})
  const [puesto, setPuesto] = useState<Puesto>('tienda')
  const [accesos, setAccesos] = useState<Record<string, string[]>>({})
  const [ubiSel, setUbiSel] = useState<string[] | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [crearOpen, setCrearOpen] = useState(false)
  const formVacio = {
    email: '',
    nombre: '',
    role: 'integrante' as 'integrante' | 'admin',
    puesto: 'tienda' as Puesto,
    permisos: {} as Record<string, boolean>,
    ubicaciones: null as string[] | null
  }
  const [form, setForm] = useState(formVacio)
  const [resultado, setResultado] = useState<{ email: string; clave: string } | null>(null)

  const ubicacionesEmpresa = ubicaciones.filter((u) => u.empresa_id === empresa?.id)

  useEffect(() => {
    recargar().finally(() => setCargando(false))
  }, [])

  async function recargar() {
    const [data, acc] = await Promise.all([listarUsuarios(), accesosPorUsuario()])
    setUsuarios(data)
    setAccesos(acc)
  }

  function abrir(u: Profile) {
    setEditando(u)
    setPuesto(u.puesto)
    setPermisos(limpiarPermisos(u.permissions))
    // Las desactivadas no se ofrecen: si solo tenía esas, el admin debe elegir otra
    setUbiSel(accesos[u.id]?.length ? asignadasActivas(accesos[u.id], ubicacionesEmpresa) : null)
  }

  async function toggleActivo(u: Profile) {
    const { error } = await adminUsers({ accion: 'toggle_usuario', user_id: u.id, activo: !u.activo })
    if (error) return toast(error, 'error')
    setUsuarios((prev) => prev.map((x) => (x.id === u.id ? { ...x, activo: !x.activo } : x)))
    toast(u.activo ? 'Usuario desactivado' : 'Usuario activado')
  }

  async function guardar() {
    if (!editando) return
    if (ubiSel !== null && ubiSel.length === 0) return toast('Marca al menos una ubicación o elige «Todas»', 'warning')
    setGuardando(true)
    const error = await actualizarPerfilUsuario(editando.id, { puesto, permissions: permisos })
    if (error) {
      setGuardando(false)
      return toast(error, 'error')
    }
    // Ubicaciones: solo si cambiaron (las escribe la Edge Function)
    const antes = [...(accesos[editando.id] ?? [])].sort().join()
    const despues = [...(ubiSel ?? [])].sort().join()
    if (antes !== despues) {
      const err = await actualizarUbicacionesUsuario(editando.id, ubiSel)
      if (err) {
        setGuardando(false)
        return toast(err, 'error')
      }
      setAccesos((prev) => ({ ...prev, [editando.id]: ubiSel ?? [] }))
    }
    setGuardando(false)
    setUsuarios((prev) => prev.map((x) => (x.id === editando.id ? { ...x, puesto, permissions: permisos } : x)))
    toast('Cambios guardados')
    setEditando(null)
  }

  async function invocar(body: Record<string, unknown>) {
    const { data, error } = await adminUsers(body)
    if (error) {
      toast(error, 'error')
      return null
    }
    return data
  }

  async function crearUsuario() {
    if (!form.email.trim()) return toast('Ingresa el correo', 'warning')
    if (!yo?.empresa_id) return toast('No tienes empresa asignada', 'error')
    if (form.ubicaciones !== null && form.ubicaciones.length === 0) {
      return toast('Marca al menos una ubicación o elige «Todas»', 'warning')
    }
    const r = await invocar({
      accion: 'crear_usuario',
      empresa_id: yo.empresa_id,
      email: form.email.trim().toLowerCase(),
      nombre: form.nombre.trim(),
      role: form.role,
      puesto: form.puesto,
      permissions: form.permisos,
      ubicaciones: form.ubicaciones ?? []
    })
    if (r) {
      setResultado({ email: r.email as string, clave: r.clave_temporal as string })
      setCrearOpen(false)
      setForm(formVacio)
      void recargar()
    }
  }

  async function resetClave(u: Profile) {
    const r = await invocar({ accion: 'reset_password', user_id: u.id })
    if (r) setResultado({ email: u.email, clave: r.clave_temporal as string })
  }

  const gestiona = can('usuarios.gestionar')
  const modulosEmpresa = empresa?.modulos ?? []
  // Un admin de empresa no puede modificarse a sí mismo ni a otro admin (solo el Admin general)
  const editable = (u: Profile) =>
    !u.es_owner && (!!yo?.es_owner || (u.role !== 'admin' && u.id !== yo?.id))

  return (
    <>
      <PageHeader
        title="Usuarios y permisos"
        subtitle="Cuentas con acceso a esta empresa"
      />

      {/* Acción principal flotante (sobre la barra inferior en móvil), igual que en Productos */}
      {gestiona && yo?.empresa_id && !crearOpen && (
        <Button
          onClick={() => setCrearOpen(true)}
          aria-label="Crear usuario"
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-30 h-12 rounded-full px-4 shadow-lg sm:px-5 lg:bottom-8 lg:right-8"
        >
          <UserPlus size={18} /> <span className="hidden sm:inline">Crear usuario</span>
        </Button>
      )}

      {gestiona && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-xs text-info">
          <Info size={15} className="mt-0.5 shrink-0" />
          Como administrador de la empresa puedes crear usuarios, resetear sus claves y ajustar sus
          permisos. Cada usuario quedará aislado a esta empresa.
        </div>
      )}

      {cargando ? (
        <LoadingState />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="divide-y divide-border">
              {usuarios.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                      {u.nombre.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()}
                    </span>
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium text-fg">
                        {u.nombre}
                        {u.id === yo?.id && <Badge tone="neutral">Tú</Badge>}
                        {u.es_owner && <Badge tone="accent">Admin general</Badge>}
                      </p>
                      <p className="text-xs text-fg-muted">{u.email}</p>
                      {!u.es_owner && (
                        <p className={cn('mt-0.5 text-xs', sinUbicacionActiva(accesos[u.id], ubicacionesEmpresa) ? 'text-warning' : 'text-fg-faint')}>
                          {resumenUbicaciones(accesos[u.id], ubicacionesEmpresa)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone="neutral">{u.puesto}</Badge>
                    <Badge tone={u.activo ? 'success' : 'blocked'} dot>{u.activo ? 'Activo' : 'Inactivo'}</Badge>
                    {gestiona && editable(u) && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => abrir(u)}>Permisos</Button>
                        <Button size="sm" variant="secondary" onClick={() => void resetClave(u)}>
                          <KeyRound size={13} /> Clave
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void toggleActivo(u)}>
                          {u.activo ? 'Desactivar' : 'Activar'}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <Modal
        open={!!editando}
        onClose={() => setEditando(null)}
        title={`Permisos y ubicaciones de ${editando?.nombre ?? ''}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button onClick={() => void guardar()} disabled={guardando}><Save size={16} /> {guardando ? 'Guardando…' : 'Guardar'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block max-w-xs">
            <span className="mb-1.5 block text-xs font-medium text-fg-body">Puesto</span>
            <Select value={puesto} onChange={(e) => setPuesto(e.target.value as Puesto)}>
              {puestos.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </label>

          {editando && (
            <EditorPermisos
              role={editando.role}
              puesto={puesto}
              permisos={permisos}
              onChange={setPermisos}
              modulosEmpresa={modulosEmpresa}
              conAsistente={!!empresa?.plan_ia}
              puedeOtorgar={can}
            />
          )}

          {ubicacionesEmpresa.length > 0 && (
            <div className="border-t border-border pt-4">
              <SelectorUbicaciones ubicaciones={ubicacionesEmpresa} valor={ubiSel} onChange={setUbiSel} />
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={crearOpen}
        onClose={() => setCrearOpen(false)}
        title="Crear usuario"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCrearOpen(false)}>Cancelar</Button>
            <Button onClick={() => void crearUsuario()}>Crear usuario</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre">
              <Input
                value={form.nombre}
                onChange={(e) => setForm((prev) => ({ ...prev, nombre: e.target.value }))}
              />
            </Field>
            <Field label="Correo" required>
              <Input
                type="email"
                autoComplete="off"
                spellCheck={false}
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              />
            </Field>
            <Field label="Rol de empresa">
              <Select
                value={form.role}
                onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as 'integrante' | 'admin', permisos: {} }))}
              >
                <option value="integrante">Integrante</option>
                <option value="admin">Administrador de empresa</option>
              </Select>
            </Field>
            <Field label="Puesto">
              <Select
                value={form.puesto}
                onChange={(e) => setForm((prev) => ({ ...prev, puesto: e.target.value as Puesto, permisos: {} }))}
              >
                <option value="admin">Administrador</option>
                <option value="bodega">Encargado de bodega</option>
                <option value="tienda">Encargado de tienda</option>
                <option value="auditor">Auditor / supervisor</option>
              </Select>
            </Field>
          </div>
          <div className="border-t border-border pt-4">
            <EditorPermisos
              role={form.role}
              puesto={form.puesto}
              permisos={form.permisos}
              onChange={(permisos) => setForm((prev) => ({ ...prev, permisos }))}
              modulosEmpresa={modulosEmpresa}
              conAsistente={!!empresa?.plan_ia}
              puedeOtorgar={can}
            />
          </div>
          {ubicacionesEmpresa.length > 0 && (
            <SelectorUbicaciones
              ubicaciones={ubicacionesEmpresa}
              valor={form.ubicaciones}
              onChange={(v) => setForm((prev) => ({ ...prev, ubicaciones: v }))}
            />
          )}
        </div>
      </Modal>

      <Modal
        open={!!resultado}
        onClose={() => setResultado(null)}
        title="Clave temporal"
        footer={<Button onClick={() => setResultado(null)}>Entendido</Button>}
      >
        <div className="rounded-xl bg-surface p-4 font-mono text-sm">
          <p className="text-fg">{resultado?.email}</p>
          <p className="text-accent">{resultado?.clave}</p>
        </div>
        <p className="mt-3 text-xs text-fg-muted">El usuario deberá cambiar la contraseña al ingresar.</p>
      </Modal>
    </>
  )
}

