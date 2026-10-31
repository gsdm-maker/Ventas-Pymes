import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Building2, ChevronRight } from 'lucide-react'
import { listarEmpresas } from '@/core/data/api'
import type { Empresa, Plan, TipoNegocio } from '@/core/types'
import { AdminTabs } from '@/pages/admin/AdminTabs'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { LoadingState, PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { DIAS_PRUEBA_DEFAULT, PLAN_DESCRIPCION, etiquetaPlan, tonoPlan, estadoPlan, resumenPlan } from '@/core/auth/plan'
import { cn } from '@/lib/cn'
import { RUBRO_LABEL, modulosPorRubro } from '@/core/auth/capabilities'
import { adminUsers } from '@/core/data/admin'

export function AdminEmpresas() {
  const toast = useToast()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [cargando, setCargando] = useState(true)
  const [open, setOpen] = useState(false)
  const formVacio = {
    nombre: '',
    plan: 'prueba' as Plan,
    prueba_dias: DIAS_PRUEBA_DEFAULT,
    inicio: '',
    tipo_negocio: 'retail' as TipoNegocio,
    admin_email: '',
    admin_nombre: ''
  }
  const [form, setForm] = useState(formVacio)
  const [resultado, setResultado] = useState<{ email: string; clave: string } | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function cargar() {
    setCargando(true)
    setEmpresas(await listarEmpresas())
    setCargando(false)
  }

  useEffect(() => {
    void cargar()
  }, [])

  async function crear() {
    if (!form.nombre.trim() || !form.admin_email.trim()) {
      return toast('Completa el nombre de la empresa y el correo del administrador', 'warning')
    }
    if (form.plan === 'prueba' && (!Number.isInteger(form.prueba_dias) || form.prueba_dias < 1 || form.prueba_dias > 365)) {
      return toast('Los días de prueba van de 1 a 365', 'warning')
    }
    setEnviando(true)
    const { data, error } = await adminUsers<{ admin_email: string; clave_temporal: string }>({
        accion: 'crear_empresa',
        nombre: form.nombre.trim(),
        plan: form.plan,
        prueba_dias: form.prueba_dias,
        inicio: form.inicio || undefined,
        tipo_negocio: form.tipo_negocio,
        modulos: modulosPorRubro(form.tipo_negocio),
        admin_email: form.admin_email.trim().toLowerCase(),
        admin_nombre: form.admin_nombre.trim()
    })
    setEnviando(false)
    if (error || !data) return toast(error ?? 'Error', 'error')
    setResultado({ email: data.admin_email, clave: data.clave_temporal })
    setOpen(false)
    setForm(formVacio)
    void cargar()
  }

  return (
    <>
      <AdminTabs />
      <PageHeader
        title="Empresas"
        subtitle="Crea empresas, su administrador y su plan"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> Nueva empresa
          </Button>
        }
      />

      {cargando ? (
        <LoadingState />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="divide-y divide-border">
              {empresas.map((e) => (
                <Link key={e.id} to={`/admin/empresas/${e.id}`} className="flex items-center justify-between gap-3 px-4 py-4 hover:bg-surface sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                      <Building2 size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{e.nombre}</p>
                      <p
                        className={cn(
                          'text-xs',
                          ['gracia', 'bloqueado'].includes(estadoPlan(e).fase)
                            ? 'text-danger'
                            : estadoPlan(e).fase === 'por_vencer'
                              ? 'text-warning'
                              : 'text-fg-muted'
                        )}
                      >
                        {resumenPlan(e)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                    <Badge tone={tonoPlan(e.plan)}>
                      {etiquetaPlan(e.plan)}
                    </Badge>
                    <ChevronRight size={16} className="text-fg-faint" />
                  </div>
                </Link>
              ))}
              {empresas.length === 0 && (
                <p className="px-5 py-6 text-sm text-fg-muted">Aún no hay empresas. Crea la primera.</p>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nueva empresa"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={enviando} onClick={() => void crear()}>
              {enviando ? 'Creando…' : 'Crear empresa y administrador'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nombre de la empresa" required>
            <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Boutique Aurora" />
          </Field>
          <Field label="Rubro" hint="Define los módulos iniciales (Mesas y Cocina para restaurante). Luego puedes ajustarlos en el detalle de la empresa.">
            <Select value={form.tipo_negocio} onChange={(e) => setForm({ ...form, tipo_negocio: e.target.value as TipoNegocio })}>
              {(Object.keys(RUBRO_LABEL) as TipoNegocio[]).map((r) => (
                <option key={r} value={r}>{RUBRO_LABEL[r]}</option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan inicial" hint={PLAN_DESCRIPCION[form.plan]}>
              <Select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value as Plan })}>
                {(['prueba', 'mensual', 'anual', 'dueno'] as Plan[]).map((p) => (
                  <option key={p} value={p}>{etiquetaPlan(p)}</option>
                ))}
              </Select>
            </Field>
            {form.plan === 'prueba' && (
              <Field label="Días de prueba" hint="De 1 a 365">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  value={form.prueba_dias}
                  onChange={(e) => setForm({ ...form, prueba_dias: Math.round(Number(e.target.value) || 0) })}
                />
              </Field>
            )}
            {(form.plan === 'mensual' || form.plan === 'anual') && (
              <Field label="Fecha de alta" hint="Vacío = hoy. Los ciclos se cuentan desde aquí.">
                <Input type="date" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} />
              </Field>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre del administrador">
              <Input value={form.admin_nombre} onChange={(e) => setForm({ ...form, admin_nombre: e.target.value })} placeholder="María Soto" />
            </Field>
            <Field label="Correo del administrador" required>
              <Input type="email" autoComplete="off" spellCheck={false} value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} placeholder="admin@aurora.cl" />
            </Field>
          </div>
          <p className="text-xs text-fg-muted">
            Se creará la empresa y una cuenta de administrador con contraseña temporal. La clave se
            muestra una sola vez.
          </p>
        </div>
      </Modal>

      <Modal
        open={!!resultado}
        onClose={() => setResultado(null)}
        title="Cuenta creada"
        footer={<Button onClick={() => setResultado(null)}>Entendido</Button>}
      >
        <p className="text-sm text-fg-body">Comparte estas credenciales de forma segura:</p>
        <div className="mt-3 rounded-xl bg-surface p-4 font-mono text-sm">
          <p className="text-fg">{resultado?.email}</p>
          <p className="text-accent">{resultado?.clave}</p>
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          El usuario deberá cambiar la contraseña en el primer ingreso. Esta clave no se vuelve a
          mostrar.
        </p>
      </Modal>
    </>
  )
}
