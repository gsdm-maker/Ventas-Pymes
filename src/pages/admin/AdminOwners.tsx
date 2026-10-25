import { useEffect, useState } from 'react'
import { ShieldCheck, UserPlus, UserMinus } from 'lucide-react'
import type { Profile } from '@/core/types'
import { AdminTabs } from '@/pages/admin/AdminTabs'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { LoadingState, PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { adminUsers, listarAdministradoresGenerales } from '@/core/data/admin'

export function AdminOwners() {
  const toast = useToast()
  const [owners, setOwners] = useState<Profile[]>([])
  const [cargando, setCargando] = useState(true)
  const [email, setEmail] = useState('')
  const [nombre, setNombre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [nueva, setNueva] = useState<{ email: string; clave: string } | null>(null)

  async function cargar() {
    setCargando(true)
    setOwners(await listarAdministradoresGenerales())
    setCargando(false)
  }

  useEffect(() => {
    void cargar()
  }, [])

  async function invocar(body: Record<string, unknown>) {
    const { data, error } = await adminUsers(body)
    if (error) {
      toast(error, 'error')
      return null
    }
    return data
  }

  async function nombrar() {
    if (!email.trim()) return toast('Ingresa el correo', 'warning')
    setEnviando(true)
    const r = await invocar({ accion: 'nombrar_owner', email: email.trim().toLowerCase(), nombre: nombre.trim() })
    setEnviando(false)
    if (!r) return
    if (r.clave_temporal) {
      setNueva({ email: r.email as string, clave: r.clave_temporal as string })
    } else {
      toast(r.ya_es_owner ? 'Esa cuenta ya era administrador general' : 'Cuenta promovida a administrador general')
    }
    setEmail('')
    setNombre('')
    void cargar()
  }

  async function revocar(u: Profile) {
    const r = await invocar({ accion: 'revocar_owner', user_id: u.id })
    if (r) {
      toast('Administrador general revocado')
      void cargar()
    }
  }

  return (
    <>
      <AdminTabs />
      <PageHeader
        title="Administradores generales"
        subtitle="Cuentas con acceso total a la plataforma"
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Con acceso de administrador general" subtitle={`${owners.length} cuenta(s)`} />
          <CardBody className="p-0">
            <div className="divide-y divide-border">
              {cargando ? (
                <LoadingState />
              ) : (
                owners.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-accent">
                        <ShieldCheck size={16} />
                      </span>
                      <div>
                        <p className="text-sm font-medium text-fg">{u.nombre}</p>
                        <p className="text-xs text-fg-muted">{u.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={u.activo ? 'success' : 'blocked'} dot>{u.activo ? 'Activo' : 'Inactivo'}</Badge>
                      {owners.length > 1 && (
                        <Button size="sm" variant="ghost" onClick={() => void revocar(u)}>
                          <UserMinus size={13} /> Revocar
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Nombrar administrador general" subtitle="Promueve una cuenta existente o crea una nueva" />
          <CardBody className="space-y-4">
            <Field label="Correo" required>
              <Input type="email" autoComplete="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@empresa.cl" />
            </Field>
            <Field label="Nombre" hint="Solo si hay que crear la cuenta">
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </Field>
            <Button block disabled={enviando} onClick={() => void nombrar()}>
              <UserPlus size={16} /> {enviando ? 'Procesando…' : 'Nombrar administrador general'}
            </Button>
            <p className="text-xs text-fg-muted">
              Si el correo ya existe, se promueve esa cuenta. Si no, se crea con clave temporal. Debe
              quedar siempre al menos un administrador general.
            </p>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={!!nueva}
        onClose={() => setNueva(null)}
        title="Administrador general creado"
        footer={<Button onClick={() => setNueva(null)}>Entendido</Button>}
      >
        <p className="text-sm text-fg-body">Comparte estas credenciales de forma segura:</p>
        <div className="mt-3 rounded-xl bg-surface p-4 font-mono text-sm">
          <p className="text-fg">{nueva?.email}</p>
          <p className="text-accent">{nueva?.clave}</p>
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          Deberá cambiar la contraseña en el primer ingreso. La clave no se vuelve a mostrar.
        </p>
      </Modal>
    </>
  )
}
