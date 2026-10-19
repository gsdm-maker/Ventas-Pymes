import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Building2, ChevronRight } from 'lucide-react'
import { supabase } from '@/core/supabase/client'
import { listarEmpresas } from '@/core/data/api'
import type { Empresa } from '@/core/types'
import { AdminTabs } from '@/pages/admin/AdminTabs'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { LoadingState, PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { formatFecha, hace } from '@/lib/format'
import { PLAN_LABEL } from '@/core/auth/plan'

export function AdminEmpresas() {
  const toast = useToast()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [cargando, setCargando] = useState(true)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    nombre: '',
    prueba_dias: 15,
    tipo_negocio: 'retail',
    admin_email: '',
    admin_nombre: ''
  })
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
    setEnviando(true)
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: {
        accion: 'crear_empresa',
        nombre: form.nombre.trim(),
        prueba_dias: Number(form.prueba_dias) || 0,
        tipo_negocio: form.tipo_negocio,
        admin_email: form.admin_email.trim().toLowerCase(),
        admin_nombre: form.admin_nombre.trim()
      }
    })
    setEnviando(false)
    if (error || (data as { error?: string })?.error) {
      return toast((data as { error?: string })?.error || error?.message || 'Error', 'error')
    }
    setResultado({ email: (data as { admin_email: string }).admin_email, clave: (data as { clave_temporal: string }).clave_temporal })
    setOpen(false)
    setForm({ nombre: '', prueba_dias: 15, tipo_negocio: 'retail', admin_email: '', admin_nombre: '' })
    void cargar()
  }

  return (
    <>
      <AdminTabs />
      <PageHeader
        title="Empresas"
        subtitle="Crea empresas y asigna su administrador y período de prueba"
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
                <Link key={e.id} to={`/admin/empresas/${e.id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-surface">
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent">
                      <Building2 size={16} />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-fg">{e.nombre}</p>
                      <p className="text-xs text-fg-muted">
                        {e.plan === 'prueba' && e.prueba_hasta
                          ? `Prueba hasta ${formatFecha(e.prueba_hasta)} (${hace(e.prueba_hasta)})`
                          : `Creada ${hace(e.created_at)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={e.plan === 'pago' ? 'success' : e.plan === 'prueba' ? 'warning' : 'neutral'}>
                      {PLAN_LABEL[e.plan]}
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
          <Field label="Tipo de negocio" hint="Solo el valor por defecto de «controla stock» en productos nuevos">
            <Select value={form.tipo_negocio} onChange={(e) => setForm({ ...form, tipo_negocio: e.target.value })}>
              <option value="retail">Tienda / retail</option>
              <option value="restaurante">Restaurante / café</option>
            </Select>
          </Field>
          <Field label="Período de prueba (días)" hint="0 = sin prueba">
            <Select value={form.prueba_dias} onChange={(e) => setForm({ ...form, prueba_dias: Number(e.target.value) })}>
              {[0, 7, 15, 30, 60, 90].map((d) => (
                <option key={d} value={d}>{d === 0 ? 'Sin prueba' : `${d} días`}</option>
              ))}
            </Select>
          </Field>
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
