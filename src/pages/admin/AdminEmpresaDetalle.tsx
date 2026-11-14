import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, UserPlus, Sparkles, KeyRound, MapPin, Eraser } from 'lucide-react'
import type { Empresa, NivelPlanConfig, Profile, Ubicacion } from '@/core/types'
import { AdminTabs } from '@/pages/admin/AdminTabs'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { LoadingState, PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { estadoPlan, etiquetaPlan, resumenPlan, tonoPlan } from '@/core/auth/plan'
import { RUBRO_LABEL } from '@/core/auth/capabilities'
import { Medidor } from '@/components/plan/MedidoresPlan'
import { PlanSuscripcion } from '@/pages/admin/PlanSuscripcion'
import { PlanEmpresa } from '@/pages/admin/PlanEmpresa'
import { etiquetaNivel, topesDe } from '@/lib/niveles'
import { accesosPorUsuario, actualizarUbicacionesUsuario, listarNiveles } from '@/core/data/api'
import { SelectorUbicaciones } from '@/components/usuarios/SelectorUbicaciones'
import { asignadasActivas, resumenUbicaciones, sinUbicacionActiva } from '@/lib/ubicaciones'
import { cn } from '@/lib/cn'
import { adminUsers, detalleEmpresaAdmin, sembrarDemo, vaciarEmpresa } from '@/core/data/admin'

export function AdminEmpresaDetalle() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [empresa, setEmpresa] = useState<Empresa | null>(null)
  const [usuarios, setUsuarios] = useState<Profile[]>([])
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ email: '', nombre: '', role: 'integrante', puesto: 'tienda', ubicaciones: null as string[] | null })
  const [accesos, setAccesos] = useState<Record<string, string[]>>({})
  const [vaciar, setVaciar] = useState<{ abierto: boolean; texto: string; enviando: boolean }>({
    abierto: false,
    texto: '',
    enviando: false
  })
  const [editUbi, setEditUbi] = useState<{ usuario: Profile; valor: string[] | null } | null>(null)
  const [resultado, setResultado] = useState<{ email: string; clave: string } | null>(null)
  const [catalogo, setCatalogo] = useState<NivelPlanConfig[]>([])

  useEffect(() => {
    void listarNiveles().then(setCatalogo)
  }, [])

  async function cargar() {
    if (!id) return
    setCargando(true)
    const { empresa: e, usuarios: u, ubicaciones: ub } = await detalleEmpresaAdmin(id)
    setEmpresa(e)
    setUsuarios(u)
    setUbicaciones(ub)
    setAccesos(await accesosPorUsuario(id))
    setCargando(false)
  }

  useEffect(() => {
    void cargar()
  }, [id])

  async function invocar(body: Record<string, unknown>) {
    const { data, error } = await adminUsers(body)
    if (error) {
      toast(error, 'error')
      return null
    }
    return data
  }

  async function guardarUbicaciones() {
    if (!editUbi) return
    if (editUbi.valor !== null && editUbi.valor.length === 0) {
      return toast('Marca al menos una ubicación o elige «Todas»', 'warning')
    }
    const err = await actualizarUbicacionesUsuario(editUbi.usuario.id, editUbi.valor)
    if (err) return toast(err, 'error')
    setAccesos((prev) => ({ ...prev, [editUbi.usuario.id]: editUbi.valor ?? [] }))
    setEditUbi(null)
    toast('Ubicaciones actualizadas')
  }

  async function crearUsuario() {
    if (!form.email.trim()) return toast('Ingresa el correo', 'warning')
    if (form.ubicaciones !== null && form.ubicaciones.length === 0) {
      return toast('Marca al menos una ubicación o elige «Todas»', 'warning')
    }
    const r = await invocar({
      accion: 'crear_usuario',
      empresa_id: id,
      email: form.email.trim().toLowerCase(),
      nombre: form.nombre.trim(),
      role: form.role,
      puesto: form.puesto,
      ubicaciones: form.ubicaciones ?? []
    })
    if (r) {
      setResultado({ email: r.email as string, clave: r.clave_temporal as string })
      setOpen(false)
      setForm({ email: '', nombre: '', role: 'integrante', puesto: 'tienda', ubicaciones: null })
      void cargar()
    }
  }

  async function cargarDemo() {
    if (!id) return
    const error = await sembrarDemo(id)
    if (error) return toast(error, 'error')
    toast('Datos de demostración cargados')
    void cargar()
  }

  async function confirmarVaciar() {
    if (!id) return
    setVaciar((v) => ({ ...v, enviando: true }))
    const error = await vaciarEmpresa(id, vaciar.texto)
    setVaciar((v) => ({ ...v, enviando: false }))
    if (error) return toast(error, 'error')
    setVaciar({ abierto: false, texto: '', enviando: false })
    toast('Empresa vaciada: lista para cargar sus datos reales')
    void cargar()
  }

  async function resetClave(u: Profile) {
    const r = await invocar({ accion: 'reset_password', user_id: u.id })
    if (r) {
      setResultado({ email: u.email, clave: r.clave_temporal as string })
      void cargar()
    }
  }

  async function toggleActivo(u: Profile) {
    const r = await invocar({ accion: 'toggle_usuario', user_id: u.id, activo: !u.activo })
    if (r) {
      toast(u.activo ? 'Usuario desactivado' : 'Usuario activado')
      void cargar()
    }
  }

  const ubicacionesActivas = ubicaciones.filter((u) => u.activa)
  // Mismo conteo que los triggers de tope: usuarios activos sin el admin general, locales activos
  const usuariosActivos = usuarios.filter((u) => u.activo && !u.es_owner).length

  if (cargando) return <><AdminTabs /><LoadingState /></>
  if (!empresa) return <><AdminTabs /><p className="text-sm text-fg-muted">Empresa no encontrada.</p></>

  const topes = topesDe(empresa, catalogo)
  const estado = estadoPlan(empresa)
  const usuariosLlenos = topes.usuarios !== null && usuariosActivos >= topes.usuarios

  return (
    <>
      <AdminTabs />
      <PageHeader
        title={empresa.nombre}
        subtitle={RUBRO_LABEL[empresa.tipo_negocio ?? 'retail']}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/empresas')}>
            <ArrowLeft size={16} /> Volver
          </Button>
        }
      />

      {/* Estado de un vistazo: plan, membresía y uso contra los topes del plan */}
      <Card className="mb-5">
        <CardBody className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <p className="text-xs text-fg-muted">Plan</p>
            <div className="mt-1">
              <Badge tone={empresa.nivel ? 'accent' : 'warning'}>{etiquetaNivel(empresa.nivel)}</Badge>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-fg-muted">Membresía</p>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <Badge tone={tonoPlan(empresa.plan)}>{etiquetaPlan(empresa.plan)}</Badge>
              <span
                className={cn(
                  'truncate text-xs',
                  estado.fase === 'gracia' || estado.fase === 'bloqueado'
                    ? 'text-danger'
                    : estado.fase === 'por_vencer'
                      ? 'text-warning'
                      : 'text-fg-muted'
                )}
              >
                {resumenPlan(empresa, estado)}
              </span>
            </div>
          </div>
          <ul className="contents">
            <Medidor label="Usuarios" uso={{ usados: usuariosActivos, tope: topes.usuarios }} />
            <Medidor label="Locales" uso={{ usados: ubicacionesActivas.length, tope: topes.ubicaciones }} />
          </ul>
        </CardBody>
      </Card>

      {/* Fila 1: qué incluye (plan y rubro) y cómo paga (membresía). Fila 2: usuarios. */}
      <div className="grid gap-5 lg:grid-cols-3">
        <PlanEmpresa empresa={empresa} onCambio={() => void cargar()} />
        <PlanSuscripcion empresa={empresa} onCambio={() => void cargar()} />

        <Card>
          <CardHeader title="Herramientas" subtitle="Atajos de la consola para esta empresa" />
          <CardBody className="space-y-3">
            {ubicaciones.length === 0 ? (
              <div className="space-y-1.5">
                <Button variant="secondary" block onClick={() => void cargarDemo()}>
                  <Sparkles size={16} /> Cargar datos de ejemplo
                </Button>
                <p className="text-xs text-fg-muted">
                  Crea Boutique Aurora (locales, productos y stock) dentro de los topes de su plan. Solo se puede en una
                  empresa sin locales: nunca toca datos reales.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Button variant="secondary" block onClick={() => setVaciar({ abierto: true, texto: '', enviando: false })}>
                  <Eraser size={16} /> Empezar de cero
                </Button>
                <p className="text-xs text-fg-muted">
                  Borra productos, stock, locales, ventas y movimientos (los del ejemplo o las pruebas). Conserva la
                  empresa, su plan y sus usuarios.
                </p>
              </div>
            )}
            <Link to="/admin/asistente" className="inline-block text-xs font-medium text-accent hover:underline">
              Cupos de cada asistente y uso de hoy →
            </Link>
            <p className="text-xs text-fg-muted">
              Los administradores de la empresa dan o quitan el permiso «Asistente» a cada usuario en Usuarios.
            </p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Usuarios"
            subtitle={
              usuariosLlenos
                ? 'Llegó al tope de usuarios de su plan: desactiva uno o sube de plan para crear otro.'
                : `${usuarios.length} ${usuarios.length === 1 ? 'cuenta' : 'cuentas'}`
            }
            action={
              <Button size="sm" disabled={usuariosLlenos} onClick={() => setOpen(true)}>
                <UserPlus size={14} /> Crear cuenta
              </Button>
            }
          />
          <CardBody className="p-0">
            <div className="divide-y divide-border">
              {usuarios.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{u.nombre}</p>
                    <p className="truncate text-xs text-fg-muted">{u.email}</p>
                    {!u.es_owner && (
                      <p className={cn('mt-0.5 text-xs', sinUbicacionActiva(accesos[u.id], ubicaciones) ? 'text-warning' : 'text-fg-faint')}>
                        {resumenUbicaciones(accesos[u.id], ubicaciones)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{u.puesto}</Badge>
                    <Badge tone={u.activo ? 'success' : 'blocked'} dot>{u.activo ? 'Activo' : 'Inactivo'}</Badge>
                    {!u.es_owner && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditUbi({ usuario: u, valor: accesos[u.id]?.length ? asignadasActivas(accesos[u.id], ubicaciones) : null })}
                        >
                          <MapPin size={13} /> Ubicaciones
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => void resetClave(u)}>
                          <KeyRound size={13} /> Clave
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void toggleActivo(u)}>
                          {u.activo ? 'Desactivar' : 'Activar'}
                        </Button>
                      </>
                    )}
                    {u.es_owner && <Badge tone="accent">Admin general</Badge>}
                  </div>
                </div>
              ))}
              {usuarios.length === 0 && <p className="px-5 py-4 text-sm text-fg-muted">Sin usuarios.</p>}
            </div>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={vaciar.abierto}
        onClose={() => !vaciar.enviando && setVaciar({ abierto: false, texto: '', enviando: false })}
        size="sm"
        title="Empezar de cero"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={vaciar.enviando}
              onClick={() => setVaciar({ abierto: false, texto: '', enviando: false })}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={
                vaciar.enviando || vaciar.texto.trim().toLowerCase() !== empresa.nombre.trim().toLowerCase()
              }
              onClick={() => void confirmarVaciar()}
            >
              {vaciar.enviando ? 'Borrando…' : 'Borrar todo y empezar'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-fg-body">
          <p>
            Se borran <span className="font-medium text-fg">para siempre</span> los datos de operación de{' '}
            <span className="font-medium text-fg">{empresa.nombre}</span>:
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            <li>Productos, variantes, categorías, proveedores y stock</li>
            <li>Locales y bodegas ({ubicaciones.length}), con sus mesas</li>
            <li>Ventas, devoluciones, cuentas, comandas y vouchers</li>
            <li>Recepciones, transferencias y movimientos</li>
          </ul>
          <p className="text-xs text-fg-muted">
            Se conservan la empresa (plan, membresía, módulos y marca), los usuarios, los motivos de salida y las
            unidades de medida. Úsalo solo con datos de ejemplo o de prueba.
          </p>
          <Field label={`Escribe «${empresa.nombre}» para confirmar`}>
            <Input
              value={vaciar.texto}
              autoComplete="off"
              onChange={(e) => setVaciar((v) => ({ ...v, texto: e.target.value }))}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Crear cuenta"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => void crearUsuario()}>Crear cuenta</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre">
              <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </Field>
            <Field label="Correo" required>
              <Input type="email" autoComplete="off" spellCheck={false} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Rol de empresa">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="integrante">Integrante</option>
                <option value="admin">Administrador de empresa</option>
              </Select>
            </Field>
            <Field label="Puesto">
              <Select value={form.puesto} onChange={(e) => setForm({ ...form, puesto: e.target.value })}>
                <option value="admin">Administrador</option>
                <option value="bodega">Encargado de bodega</option>
                <option value="tienda">Encargado de tienda</option>
                <option value="auditor">Auditor / supervisor</option>
              </Select>
            </Field>
          </div>
          {ubicacionesActivas.length > 0 && (
            <SelectorUbicaciones
              ubicaciones={ubicacionesActivas}
              valor={form.ubicaciones}
              onChange={(v) => setForm((prev) => ({ ...prev, ubicaciones: v }))}
            />
          )}
        </div>
      </Modal>

      <Modal
        open={!!editUbi}
        onClose={() => setEditUbi(null)}
        title={`Ubicaciones de ${editUbi?.usuario.nombre ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditUbi(null)}>Cancelar</Button>
            <Button onClick={() => void guardarUbicaciones()}>Guardar</Button>
          </>
        }
      >
        {editUbi && (
          <SelectorUbicaciones
            ubicaciones={ubicacionesActivas}
            valor={editUbi.valor}
            onChange={(v) => setEditUbi({ ...editUbi, valor: v })}
          />
        )}
      </Modal>

      <Modal
        open={!!resultado}
        onClose={() => setResultado(null)}
        title="Cuenta creada"
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
