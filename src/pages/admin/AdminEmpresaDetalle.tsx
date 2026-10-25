import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, UserPlus, Sparkles, KeyRound, MapPin } from 'lucide-react'
import { supabase } from '@/core/supabase/client'
import type { Empresa, Profile, TipoNegocio, Ubicacion } from '@/core/types'
import { MODULOS, MODULO_LABEL, RUBRO_LABEL, modulosPorRubro } from '@/core/auth/capabilities'
import { AdminTabs } from '@/pages/admin/AdminTabs'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { LoadingState, PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { formatFecha } from '@/lib/format'
import { PLAN_LABEL } from '@/core/auth/plan'
import { accesosPorUsuario, actualizarUbicacionesUsuario } from '@/core/data/api'
import { SelectorUbicaciones } from '@/components/usuarios/SelectorUbicaciones'
import { asignadasActivas, resumenUbicaciones, sinUbicacionActiva } from '@/lib/ubicaciones'
import { cn } from '@/lib/cn'

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
  const [editUbi, setEditUbi] = useState<{ usuario: Profile; valor: string[] | null } | null>(null)
  const [resultado, setResultado] = useState<{ email: string; clave: string } | null>(null)
  const [rubro, setRubro] = useState<TipoNegocio>('retail')
  const [modulos, setModulos] = useState<string[]>([])
  const [guardandoModulos, setGuardandoModulos] = useState(false)

  async function cargar() {
    if (!id) return
    setCargando(true)
    const { data: e } = await supabase.from('empresas').select('*').eq('id', id).single()
    setEmpresa((e as Empresa) ?? null)
    setRubro((e as Empresa | null)?.tipo_negocio ?? 'retail')
    setModulos((e as Empresa | null)?.modulos ?? [])
    const { data: u } = await supabase.from('profiles').select('*').eq('empresa_id', id).order('nombre')
    setUsuarios((u as Profile[]) ?? [])
    const { data: ub } = await supabase.from('ubicaciones').select('*').eq('empresa_id', id).order('nombre')
    setUbicaciones((ub as Ubicacion[]) ?? [])
    setAccesos(await accesosPorUsuario(id))
    setCargando(false)
  }

  useEffect(() => {
    void cargar()
  }, [id])

  async function invocar(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke('admin-users', { body })
    if (error || (data as { error?: string })?.error) {
      toast((data as { error?: string })?.error || error?.message || 'Error', 'error')
      return null
    }
    return data as Record<string, unknown>
  }

  async function cambiarPlan(plan: string) {
    const dias = plan === 'prueba' ? 15 : 0
    const r = await invocar({ accion: 'actualizar_plan', empresa_id: id, plan, prueba_dias: dias })
    if (r) {
      toast('Plan actualizado')
      void cargar()
    }
  }

  function elegirRubro(r: TipoNegocio) {
    setRubro(r)
    setModulos((prev) => modulosPorRubro(r, prev))
  }

  async function guardarModulos() {
    setGuardandoModulos(true)
    const r = await invocar({ accion: 'actualizar_modulos', empresa_id: id, tipo_negocio: rubro, modulos })
    setGuardandoModulos(false)
    if (r) {
      toast('Rubro y módulos actualizados')
      void cargar()
    }
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
    const { error } = await supabase.rpc('sembrar_demo', { p_empresa: id })
    if (error) return toast(error.message, 'error')
    toast('Datos de demostración cargados')
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

  if (cargando) return <><AdminTabs /><LoadingState /></>
  if (!empresa) return <><AdminTabs /><p className="text-sm text-fg-muted">Empresa no encontrada.</p></>

  return (
    <>
      <AdminTabs />
      <PageHeader
        title={empresa.nombre}
        subtitle={`Plan ${PLAN_LABEL[empresa.plan]}${empresa.prueba_hasta ? ` · hasta ${formatFecha(empresa.prueba_hasta)}` : ''}`}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/empresas')}>
            <ArrowLeft size={16} /> Volver
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Plan y período de prueba" />
            <CardBody className="space-y-3">
              <div className="flex gap-2">
                {(['prueba', 'gratis', 'pago'] as const).map((p) => (
                  <Button key={p} size="sm" variant={empresa.plan === p ? 'primary' : 'secondary'} onClick={() => void cambiarPlan(p)}>
                    {PLAN_LABEL[p]}
                  </Button>
                ))}
              </div>
              {empresa.prueba_hasta && <p className="text-xs text-fg-muted">Prueba hasta {formatFecha(empresa.prueba_hasta)}</p>}
              <Button variant="secondary" block onClick={() => void cargarDemo()}>
                <Sparkles size={16} /> Cargar datos de ejemplo
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Rubro y módulos" subtitle="Lo que la empresa puede usar" />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(RUBRO_LABEL) as TipoNegocio[]).map((r) => (
                  <Button key={r} size="sm" variant={rubro === r ? 'primary' : 'secondary'} onClick={() => elegirRubro(r)}>
                    {RUBRO_LABEL[r]}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-fg-muted">
                El rubro enciende o apaga Mesas y Cocina. En restaurante, los productos nuevos parten sin
                control de stock.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {MODULOS.map((m) => (
                  <label key={m} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={modulos.includes(m)}
                      onChange={(e) =>
                        setModulos((prev) => (e.target.checked ? [...prev, m] : prev.filter((x) => x !== m)))
                      }
                      className="size-4 accent-[rgb(var(--accent))]"
                    />
                    <span className="text-fg-body">{MODULO_LABEL[m]}</span>
                  </label>
                ))}
              </div>
              <Button block disabled={guardandoModulos} onClick={() => void guardarModulos()}>
                {guardandoModulos ? 'Guardando…' : 'Guardar rubro y módulos'}
              </Button>
            </CardBody>
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Usuarios"
            subtitle={`${usuarios.length} cuenta(s)`}
            action={
              <Button size="sm" onClick={() => setOpen(true)}>
                <UserPlus size={14} /> Crear cuenta
              </Button>
            }
          />
          <CardBody className="p-0">
            <div className="divide-y divide-border">
              {usuarios.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-fg">{u.nombre}</p>
                    <p className="text-xs text-fg-muted">{u.email}</p>
                    {!u.es_owner && (
                      <p className={cn('mt-0.5 text-xs', sinUbicacionActiva(accesos[u.id], ubicaciones) ? 'text-warning' : 'text-fg-faint')}>
                        {resumenUbicaciones(accesos[u.id], ubicaciones)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
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
