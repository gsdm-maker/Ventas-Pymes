import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Building2, ChevronRight, Search, Store, UtensilsCrossed } from 'lucide-react'
import { listarEmpresas } from '@/core/data/api'
import type { Empresa, Nivel, Plan, TipoNegocio } from '@/core/types'
import { AdminTabs } from '@/pages/admin/AdminTabs'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, LoadingState, PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { DIAS_PRUEBA_DEFAULT, PLAN_DESCRIPCION, etiquetaPlan, tonoPlan, estadoPlan, resumenPlan } from '@/core/auth/plan'
import { cn } from '@/lib/cn'
import { RUBRO_LABEL } from '@/core/auth/capabilities'
import { adminUsers } from '@/core/data/admin'
import { FILTROS_NIVEL, FILTRO_NIVEL_LABEL, NIVEL_LABEL, claveNivel, etiquetaNivel, type FiltroNivel } from '@/lib/niveles'

type Filtro = FiltroNivel | 'todas' | 'atencion'
const FILTROS: Filtro[] = ['todas', 'atencion', ...FILTROS_NIVEL]
const etiquetaFiltro = (f: Filtro) =>
  f === 'todas' ? 'Todas' : f === 'atencion' ? 'Requieren atención' : FILTRO_NIVEL_LABEL[f]
const enAtencion = (fase: string) => fase === 'bloqueado' || fase === 'gracia' || fase === 'por_vencer'

export function AdminEmpresas() {
  const toast = useToast()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [cargando, setCargando] = useState(true)
  const [open, setOpen] = useState(false)
  const formVacio = {
    nombre: '',
    plan: 'prueba' as Plan,
    // La prueba muestra Socio Pro; el anual es siempre Socio Pro Max
    nivel: 'm' as Exclude<Nivel, 'medida'>,
    prueba_dias: DIAS_PRUEBA_DEFAULT,
    inicio: '',
    tipo_negocio: 'retail' as TipoNegocio,
    admin_email: '',
    admin_nombre: ''
  }
  const [form, setForm] = useState(formVacio)
  const [resultado, setResultado] = useState<{ email: string; clave: string } | null>(null)
  const [enviando, setEnviando] = useState(false)
  // Filtro en la URL (?plan=s|m|l|medida|sin|atencion): el Resumen enlaza directo aquí
  const [params, setParams] = useSearchParams()
  const crudo = params.get('plan')
  const filtro: Filtro = FILTROS.includes(crudo as Filtro) ? (crudo as Filtro) : 'todas'
  const [busqueda, setBusqueda] = useState('')

  const filas = useMemo(() => empresas.map((e) => ({ e, estado: estadoPlan(e) })), [empresas])
  const cumple = (f: Filtro, x: (typeof filas)[number]) =>
    f === 'todas' || (f === 'atencion' ? enAtencion(x.estado.fase) : claveNivel(x.e.nivel) === f)
  const texto = busqueda.trim().toLowerCase()
  const visibles = filas.filter((x) => cumple(filtro, x) && (!texto || x.e.nombre.toLowerCase().includes(texto)))

  function elegirFiltro(f: Filtro) {
    const p = new URLSearchParams(params)
    if (f === 'todas') p.delete('plan')
    else p.set('plan', f)
    setParams(p, { replace: true })
  }

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
        nivel: form.plan === 'anual' ? 'l' : form.nivel,
        prueba_dias: form.prueba_dias,
        inicio: form.inicio || undefined,
        tipo_negocio: form.tipo_negocio,
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
        subtitle="Crea empresas, su administrador, su plan y su membresía"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> Nueva empresa
          </Button>
        }
      />

      {cargando ? (
        <LoadingState />
      ) : empresas.length === 0 ? (
        <EmptyState
          icon={<Building2 size={22} />}
          title="Aún no hay empresas"
          description="Crea la primera: eliges su plan, su rubro y su membresía, y queda lista con su administrador."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} /> Nueva empresa
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative block lg:w-72">
              <span className="sr-only">Buscar empresa</span>
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" aria-hidden />
              <Input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre"
                className="pl-9"
              />
            </label>
            <div
              role="radiogroup"
              aria-label="Filtrar empresas"
              className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden"
            >
              {FILTROS.map((f) => {
                const n = filas.filter((x) => cumple(f, x)).length
                const activo = filtro === f
                return (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={activo}
                    onClick={() => elegirFiltro(f)}
                    className={cn(
                      'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-accent',
                      activo
                        ? 'bg-accent-soft text-accent'
                        : (f === 'sin' || f === 'atencion') && n > 0
                          ? 'text-warning hover:bg-surface'
                          : 'text-fg-muted hover:bg-surface'
                    )}
                  >
                    {etiquetaFiltro(f)}
                    <span className="tabular-nums opacity-70">{n}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <Card>
            <CardBody className="p-0">
              <ul className="divide-y divide-border">
                {visibles.map(({ e, estado }) => (
                  <li key={e.id}>
                    <Link
                      to={`/admin/empresas/${e.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-surface sm:px-5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden>
                          {e.tipo_negocio && e.tipo_negocio !== 'retail' ? <UtensilsCrossed size={16} /> : <Store size={16} />}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-fg">{e.nombre}</p>
                          <p
                            className={cn(
                              'truncate text-xs',
                              estado.fase === 'gracia' || estado.fase === 'bloqueado'
                                ? 'text-danger'
                                : estado.fase === 'por_vencer'
                                  ? 'text-warning'
                                  : 'text-fg-muted'
                            )}
                          >
                            {RUBRO_LABEL[e.tipo_negocio ?? 'retail']} · {resumenPlan(e, estado)}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                        <Badge tone={e.nivel ? 'accent' : 'warning'}>{etiquetaNivel(e.nivel)}</Badge>
                        <span className="hidden sm:inline-flex">
                          <Badge tone={tonoPlan(e.plan)}>{etiquetaPlan(e.plan)}</Badge>
                        </span>
                        <ChevronRight size={16} className="text-fg-faint" aria-hidden />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {visibles.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-fg-muted">
                  Ninguna empresa coincide.{' '}
                  <button
                    type="button"
                    className="font-medium text-accent hover:underline"
                    onClick={() => {
                      setBusqueda('')
                      elegirFiltro('todas')
                    }}
                  >
                    Ver todas
                  </button>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="1 · Plan"
              hint={form.plan === 'anual' ? 'La membresía anual es siempre Socio Pro Max.' : 'Define módulos, asistente y topes. «A medida» se configura después en el detalle.'}
            >
              <Select
                value={form.plan === 'anual' ? 'l' : form.nivel}
                disabled={form.plan === 'anual'}
                onChange={(e) => setForm({ ...form, nivel: e.target.value as Exclude<Nivel, 'medida'> })}
              >
                {(['s', 'm', 'l'] as const).map((n) => (
                  <option key={n} value={n}>{NIVEL_LABEL[n]}</option>
                ))}
              </Select>
            </Field>
            <Field label="2 · Rubro" hint="Suma Mesas y Cocina desde Socio Pro.">
              <Select value={form.tipo_negocio} onChange={(e) => setForm({ ...form, tipo_negocio: e.target.value as TipoNegocio })}>
                {(Object.keys(RUBRO_LABEL) as TipoNegocio[]).map((r) => (
                  <option key={r} value={r}>{RUBRO_LABEL[r]}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="3 · Membresía" hint={PLAN_DESCRIPCION[form.plan]}>
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
