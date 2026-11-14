import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Minus, Pencil, Plus, SlidersHorizontal } from 'lucide-react'
import type { Empresa, Nivel, NivelPlanConfig, PlanIa, PlanIaConfig } from '@/core/types'
import { listarEmpresas, listarNiveles, listarPlanesIa } from '@/core/data/api'
import { adminUsers } from '@/core/data/admin'
import { MODULOS, MODULO_LABEL } from '@/core/auth/capabilities'
import { estadoPlan } from '@/core/auth/plan'
import { NIVEL_LABEL } from '@/lib/niveles'
import { formatCLP, formatMiles } from '@/lib/format'
import { cn } from '@/lib/cn'
import { AdminTabs } from '@/pages/admin/AdminTabs'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { LoadingState, PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'

type NivelEstandar = Exclude<Nivel, 'medida'>

const tope = (n: number | null | undefined) => (n === null || n === undefined ? 'Sin límite' : formatMiles(n))
const soloDigitos = (v: string) => v.replace(/\D/g, '')
const aTexto = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

/** Vacío = sin límite; undefined = inválido. */
function leerTope(texto: string): number | null | undefined {
  if (!texto.trim()) return null
  const n = Number(texto)
  return Number.isInteger(n) && n >= 1 ? n : undefined
}

/** Espejo de _modulos_nivel(): en retail se quitan Mesas y Cocina. */
function modulosDelNivel(n: NivelPlanConfig, rubro: string | null | undefined): string[] {
  return !rubro || rubro === 'retail' ? n.modulos.filter((m) => m !== 'mesas' && m !== 'cocina') : [...n.modulos]
}

/** Lo que una empresa paga al mes según su plan (anual se prorratea). null = no suma. */
function ingresoMensual(e: Empresa, catalogo: NivelPlanConfig[]): number | null {
  if (e.plan !== 'mensual' && e.plan !== 'anual') return null
  if (estadoPlan(e).fase === 'bloqueado') return null
  if (e.nivel === 'medida') return e.precio_medida ?? null
  const n = catalogo.find((x) => x.nivel === e.nivel)
  if (!n) return null
  if (e.plan === 'anual') return n.precio_anual !== null ? Math.round(n.precio_anual / 12) : n.precio_mensual
  return n.precio_mensual
}

function Fila({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-fg">{children}</dd>
    </div>
  )
}

function SiNo({ si, centrado }: { si: boolean; centrado?: boolean }) {
  const lado = centrado ? 'mx-auto' : 'ml-auto'
  return si ? (
    <Check size={15} className={cn(lado, 'text-success')} aria-label="Sí" />
  ) : (
    <Minus size={15} className={cn(lado, 'text-fg-faint')} aria-label="No" />
  )
}

function FilaTabla({ label, valores, medida }: { label: string; valores: ReactNode[]; medida: string }) {
  return (
    <tr>
      <th scope="row" className="px-4 py-2 text-left font-normal text-fg-body sm:px-5">{label}</th>
      {valores.map((v, i) => (
        <td key={i} className="px-3 py-2 text-center tabular-nums text-fg">{v}</td>
      ))}
      <td className="px-3 py-2 text-center text-xs text-fg-muted">{medida}</td>
    </tr>
  )
}

/**
 * Consola general · Planes y precios. Catálogo de Socio / Socio Pro / Socio Pro Max lado a lado
 * (leído de niveles_plan, la misma tabla que aplica los topes), edición del precio de referencia
 * y creación de un plan «A medida» para una empresa. Todo pasa por la Edge Function admin-users.
 */
export function AdminPlanes() {
  const toast = useToast()
  const navigate = useNavigate()
  const [catalogo, setCatalogo] = useState<NivelPlanConfig[]>([])
  const [planesIa, setPlanesIa] = useState<PlanIaConfig[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState<{ nivel: NivelEstandar; mensual: string; anual: string } | null>(null)
  const [medida, setMedida] = useState<{
    empresaId: string
    precio: string
    productos: string
    ubicaciones: string
    usuarios: string
    planIa: PlanIa | null
    modulos: string[]
  } | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function cargar() {
    const [n, p, e] = await Promise.all([listarNiveles(), listarPlanesIa(), listarEmpresas()])
    setCatalogo(n)
    setPlanesIa(p)
    setEmpresas(e)
    setCargando(false)
  }

  useEffect(() => {
    void cargar()
  }, [])

  const porNivel = (n: Nivel) => empresas.filter((e) => e.nivel === n)
  const aMedida = porNivel('medida')
  const ingreso = useMemo(
    () => empresas.reduce((suma, e) => suma + (ingresoMensual(e, catalogo) ?? 0), 0),
    [empresas, catalogo]
  )
  const pagando = empresas.filter((e) => ingresoMensual(e, catalogo) !== null).length
  const nombreIa = (p: PlanIa | null) => {
    if (!p) return 'Sin asistente'
    const x = planesIa.find((y) => y.plan === p)
    return x ? `${x.nombre} · ${x.mensajes_dia_empresa}/día` : p
  }

  // ---------- Editar precio ----------
  async function guardarPrecio() {
    if (!editando) return
    const mensual = Number(editando.mensual)
    if (!editando.mensual || !Number.isInteger(mensual)) return toast('Escribe el precio mensual en pesos', 'warning')
    if (editando.nivel === 'l' && !editando.anual) return toast('Socio Pro Max se vende anual: escribe su precio anual', 'warning')
    setEnviando(true)
    const { error } = await adminUsers({
      accion: 'actualizar_precio_nivel',
      nivel: editando.nivel,
      precio_mensual: mensual,
      precio_anual: editando.nivel === 'l' ? Number(editando.anual) : null
    })
    setEnviando(false)
    if (error) return toast(error, 'error')
    toast(`Precio de ${NIVEL_LABEL[editando.nivel]} actualizado`)
    setEditando(null)
    void cargar()
  }

  // ---------- Crear plan a medida ----------
  /**
   * Punto de partida al elegir una empresa: si ya es «A medida», lo que tiene; si tiene un plan
   * estándar, lo de ese plan (con su rubro); sin empresa o sin plan, Socio Pro.
   */
  function formMedida(empresaId: string, precioEscrito = '') {
    const e = empresas.find((x) => x.id === empresaId)
    if (e?.nivel === 'medida') {
      return {
        empresaId,
        precio: aTexto(e.precio_medida) || precioEscrito,
        productos: aTexto(e.max_productos),
        ubicaciones: aTexto(e.max_ubicaciones),
        usuarios: aTexto(e.max_usuarios),
        planIa: e.plan_ia ?? null,
        modulos: e.modulos
      }
    }
    const n = catalogo.find((x) => x.nivel === e?.nivel) ?? catalogo.find((x) => x.nivel === 'm')
    return {
      empresaId,
      precio: precioEscrito,
      productos: aTexto(n?.max_productos),
      ubicaciones: aTexto(n?.max_ubicaciones),
      usuarios: aTexto(n?.max_usuarios),
      planIa: n?.plan_ia ?? null,
      modulos: n ? modulosDelNivel(n, e?.tipo_negocio) : (e?.modulos ?? [])
    }
  }

  const abrirMedida = (empresaId = '') => setMedida(formMedida(empresaId))

  /** Copia lo de un plan estándar como punto de partida, según el rubro de la empresa elegida. */
  function partirDe(n: NivelPlanConfig) {
    if (!medida) return
    const e = empresas.find((x) => x.id === medida.empresaId)
    setMedida({
      ...medida,
      productos: aTexto(n.max_productos),
      ubicaciones: aTexto(n.max_ubicaciones),
      usuarios: aTexto(n.max_usuarios),
      planIa: n.plan_ia,
      modulos: modulosDelNivel(n, e?.tipo_negocio)
    })
  }

  async function crearMedida() {
    if (!medida) return
    if (!medida.empresaId) return toast('Elige la empresa', 'warning')
    if (!medida.precio) return toast('Escribe el precio mensual cotizado', 'warning')
    if (medida.modulos.length === 0) return toast('Marca al menos un módulo', 'warning')
    const p = leerTope(medida.productos)
    const u = leerTope(medida.ubicaciones)
    const us = leerTope(medida.usuarios)
    if (p === undefined || u === undefined || us === undefined) {
      return toast('Los topes son números mayores que cero; déjalos vacíos para «sin límite»', 'warning')
    }
    setEnviando(true)
    const { error } = await adminUsers({
      accion: 'crear_a_medida',
      empresa_id: medida.empresaId,
      precio_medida: Number(medida.precio),
      max_productos: p,
      max_ubicaciones: u,
      max_usuarios: us,
      plan_ia: medida.planIa,
      modulos: medida.modulos
    })
    setEnviando(false)
    if (error) return toast(error, 'error')
    const nombre = empresas.find((x) => x.id === medida.empresaId)?.nombre ?? 'la empresa'
    toast(`Plan a medida aplicado a ${nombre}`)
    const id = medida.empresaId
    setMedida(null)
    navigate(`/admin/empresas/${id}`)
  }

  if (cargando) return <><AdminTabs /><LoadingState /></>

  const empresaMedida = empresas.find((x) => x.id === medida?.empresaId)

  return (
    <>
      <AdminTabs />
      <PageHeader
        title="Planes y precios"
        subtitle="Qué incluye cada plan y cuánto cuesta. Los topes se aplican en la base de datos."
        actions={
          <Button onClick={() => abrirMedida()}>
            <Plus size={16} /> Plan a medida
          </Button>
        }
      />

      <Card className="mb-5">
        <CardBody className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs text-fg-muted">Ingreso mensual estimado</p>
            <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums text-fg">{formatCLP(ingreso)}</p>
            <p className="mt-1 max-w-prose text-xs text-fg-muted">
              {pagando} {pagando === 1 ? 'empresa con membresía mensual o anual al día' : 'empresas con membresía mensual o anual al día'}{' '}
              (el anual se cuenta dividido en 12). No suma pruebas, cuentas del dueño ni bloqueadas.
            </p>
          </div>
          <p className="max-w-sm text-xs text-fg-muted">
            Los precios son de referencia para la consola: cambiarlos no modifica pagos ya registrados. La página de
            ventas se actualiza aparte.
          </p>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {catalogo.map((n) => {
          const cuantas = porNivel(n.nivel).length
          return (
            <Card key={n.nivel} className="flex flex-col">
              <CardBody className="flex flex-1 flex-col">
                <h2 className="text-base font-semibold text-fg">{n.nombre}</h2>
                <div className="mt-3 min-h-[3.75rem]">
                  <p className="text-2xl font-semibold tracking-tight tabular-nums text-fg">
                    {formatCLP(n.precio_mensual)}
                    <span className="text-sm font-normal text-fg-muted"> /mes</span>
                  </p>
                  <p className="text-xs text-fg-muted">
                    {n.precio_anual !== null ? `o ${formatCLP(n.precio_anual)} al año` : 'Solo mensual'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditando({ nivel: n.nivel, mensual: String(n.precio_mensual), anual: aTexto(n.precio_anual) })}
                  className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-md text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Pencil size={12} /> Editar precio
                </button>
                <dl className="mt-4 flex-1 divide-y divide-border border-t border-border">
                  <Fila label="Locales">{tope(n.max_ubicaciones)}</Fila>
                  <Fila label="Usuarios">{tope(n.max_usuarios)}</Fila>
                  <Fila label="Productos">{tope(n.max_productos)}</Fila>
                  <Fila label="Asistente">{nombreIa(n.plan_ia)}</Fila>
                  <Fila label="Mesas y cocina"><SiNo si={n.modulos.includes('mesas')} /></Fila>
                  <Fila label="Reportes completos"><SiNo si={n.reportes_completos} /></Fila>
                  <Fila label="Permisos por usuario"><SiNo si={n.permisos_a_medida} /></Fila>
                </dl>
                <Link
                  to={`/admin/empresas?plan=${n.nivel}`}
                  className="mt-4 text-xs font-medium text-accent hover:underline"
                >
                  {cuantas} {cuantas === 1 ? 'empresa' : 'empresas'} en este plan →
                </Link>
              </CardBody>
            </Card>
          )
        })}

        <Card className="flex flex-col">
          <CardBody className="flex flex-1 flex-col">
            <h2 className="text-base font-semibold text-fg">A medida</h2>
            <div className="mt-3 min-h-[3.75rem]">
              <p className="text-2xl font-semibold tracking-tight text-fg">Cotizado</p>
              <p className="text-xs text-fg-muted">Precio, topes, módulos y asistente por empresa</p>
            </div>
            <button
              type="button"
              onClick={() => abrirMedida()}
              className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-md text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <SlidersHorizontal size={12} /> Crear plan a medida
            </button>
            <div className="mt-4 flex-1 border-t border-border">
              {aMedida.length === 0 ? (
                <p className="py-3 text-sm text-fg-muted">
                  Ninguna empresa todavía. Úsalo cuando un cliente necesita más locales, menos módulos o un precio
                  especial.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {aMedida.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => abrirMedida(e.id)}
                        className="flex w-full items-baseline justify-between gap-3 py-2 text-left text-sm hover:text-accent"
                      >
                        <span className="truncate text-fg-body">{e.nombre}</span>
                        <span className="shrink-0 font-medium tabular-nums text-fg">
                          {e.precio_medida !== null && e.precio_medida !== undefined ? formatCLP(e.precio_medida) : 'Sin precio'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Link to="/admin/empresas?plan=medida" className="mt-4 text-xs font-medium text-accent hover:underline">
              {aMedida.length} {aMedida.length === 1 ? 'empresa' : 'empresas'} a medida →
            </Link>
          </CardBody>
        </Card>
      </div>

      {/* Toda la configuración de cada plan, punto por punto (lo que hoy aplica la base) */}
      <Card className="mt-5">
        <CardHeader
          title="Qué incluye cada plan"
          subtitle="Configuración vigente de cada plan. Mesas y Cocina se activan solo si el rubro es restaurante o mixto."
        />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium text-fg-muted sm:px-5">
                    <span className="sr-only">Característica</span>
                  </th>
                  {catalogo.map((n) => (
                    <th key={n.nivel} scope="col" className="px-3 py-2.5 text-center font-semibold text-fg">
                      {n.nombre}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2.5 text-center font-semibold text-fg">A medida</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <FilaTabla label="Precio mensual" valores={catalogo.map((n) => formatCLP(n.precio_mensual))} medida="Cotizado" />
                <FilaTabla
                  label="Precio anual"
                  valores={catalogo.map((n) => (n.precio_anual !== null ? formatCLP(n.precio_anual) : '—'))}
                  medida="—"
                />
                <FilaTabla label="Locales (tiendas o bodegas)" valores={catalogo.map((n) => tope(n.max_ubicaciones))} medida="A elección" />
                <FilaTabla label="Usuarios" valores={catalogo.map((n) => tope(n.max_usuarios))} medida="A elección" />
                <FilaTabla label="Productos" valores={catalogo.map((n) => tope(n.max_productos))} medida="A elección" />
                <FilaTabla label="Asistente con IA" valores={catalogo.map((n) => nombreIa(n.plan_ia))} medida="A elección" />
                <FilaTabla
                  label="Reportes"
                  valores={catalogo.map((n) => (n.reportes_completos ? 'Completos' : 'Del día y del mes'))}
                  medida="A elección"
                />
                <FilaTabla
                  label="Permisos por usuario"
                  valores={catalogo.map((n) => <SiNo key={n.nivel} si={n.permisos_a_medida} centrado />)}
                  medida="A elección"
                />
                <tr className="bg-surface">
                  <th scope="rowgroup" colSpan={catalogo.length + 2} className="px-4 py-2 text-left text-xs font-medium text-fg-muted sm:px-5">
                    Módulos
                  </th>
                </tr>
                {MODULOS.map((m) => (
                  <FilaTabla
                    key={m}
                    label={MODULO_LABEL[m]}
                    valores={catalogo.map((n) => <SiNo key={n.nivel} si={n.modulos.includes(m)} centrado />)}
                    medida="A elección"
                  />
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Cómo se aplica" />
        <CardBody>
          <ul className="grid gap-3 text-sm text-fg-body sm:grid-cols-3">
            <li>
              <span className="font-medium text-fg">El plan manda.</span> Socio, Socio Pro y Socio Pro Max fijan
              módulos, asistente y topes. El rubro solo suma o quita Mesas y Cocina.
            </li>
            <li>
              <span className="font-medium text-fg">Topes firmes.</span> Al llegar al tope no se pueden crear más
              locales, usuarios ni productos. Lo que ya existe no se borra.
            </li>
            <li>
              <span className="font-medium text-fg">La membresía va aparte.</span> Prueba, mensual o anual se
              definen en cada empresa. El anual es siempre Socio Pro Max.
            </li>
          </ul>
        </CardBody>
      </Card>

      {/* ---------- Editar precio ---------- */}
      <Modal
        open={!!editando}
        onClose={() => setEditando(null)}
        size="sm"
        title={editando ? `Precio de ${NIVEL_LABEL[editando.nivel]}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button disabled={enviando} onClick={() => void guardarPrecio()}>
              {enviando ? 'Guardando…' : 'Guardar precio'}
            </Button>
          </>
        }
      >
        {editando && (
          <div className="space-y-4">
            <Field label="Precio mensual (CLP)" hint={editando.mensual ? formatCLP(Number(editando.mensual)) : 'Con IVA incluido'} required>
              <Input
                inputMode="numeric"
                value={editando.mensual}
                onChange={(e) => setEditando({ ...editando, mensual: soloDigitos(e.target.value) })}
              />
            </Field>
            {editando.nivel === 'l' && (
              <Field label="Precio anual (CLP)" hint={editando.anual ? formatCLP(Number(editando.anual)) : 'La membresía anual es solo de Socio Pro Max'} required>
                <Input
                  inputMode="numeric"
                  value={editando.anual}
                  onChange={(e) => setEditando({ ...editando, anual: soloDigitos(e.target.value) })}
                />
              </Field>
            )}
            <p className="text-xs text-fg-muted">
              Cambia el precio que se muestra en la consola desde ahora. No modifica pagos ya registrados.
            </p>
          </div>
        )}
      </Modal>

      {/* ---------- Plan a medida ---------- */}
      <Modal
        open={!!medida}
        onClose={() => setMedida(null)}
        size="lg"
        title="Plan a medida"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMedida(null)}>Cancelar</Button>
            <Button disabled={enviando} onClick={() => void crearMedida()}>
              {enviando ? 'Aplicando…' : 'Aplicar plan a medida'}
            </Button>
          </>
        }
      >
        {medida && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Empresa" required hint={empresaMedida?.nivel ? `Hoy: ${NIVEL_LABEL[empresaMedida.nivel]}` : undefined}>
                <Select value={medida.empresaId} onChange={(e) => setMedida(formMedida(e.target.value, medida.precio))}>
                  <option value="">Elige una empresa…</option>
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id} disabled={e.plan === 'anual'}>
                      {e.nombre}
                      {e.plan === 'anual' ? ' (anual: siempre Socio Pro Max)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Precio mensual cotizado (CLP)" required hint={medida.precio ? formatCLP(Number(medida.precio)) : undefined}>
                <Input
                  inputMode="numeric"
                  placeholder="45000"
                  value={medida.precio}
                  onChange={(e) => setMedida({ ...medida, precio: soloDigitos(e.target.value) })}
                />
              </Field>
            </div>

            <section className="space-y-2">
              <h3 className="text-xs font-medium text-fg-muted">Partir de un plan (opcional)</h3>
              <div className="flex flex-wrap gap-1.5">
                {catalogo.map((n) => (
                  <Button key={n.nivel} size="sm" variant="secondary" onClick={() => partirDe(n)}>
                    Copiar {n.nombre}
                  </Button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium text-fg-muted">Topes · vacío = sin límite</h3>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['ubicaciones', 'Locales'],
                    ['usuarios', 'Usuarios'],
                    ['productos', 'Productos']
                  ] as const
                ).map(([k, label]) => (
                  <Field key={k} label={label}>
                    <Input
                      inputMode="numeric"
                      placeholder="Sin límite"
                      value={medida[k]}
                      onChange={(e) => setMedida({ ...medida, [k]: soloDigitos(e.target.value) })}
                    />
                  </Field>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium text-fg-muted">Asistente con IA</h3>
              <div role="radiogroup" aria-label="Asistente con IA" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {[null, ...planesIa.map((p) => p.plan)].map((p) => (
                  <button
                    key={p ?? 'ninguno'}
                    type="button"
                    role="radio"
                    aria-checked={medida.planIa === p}
                    onClick={() => setMedida({ ...medida, planIa: p })}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors',
                      medida.planIa === p ? 'border-accent bg-accent-soft text-accent' : 'border-border text-fg-body hover:bg-surface'
                    )}
                  >
                    {p ? (planesIa.find((x) => x.plan === p)?.nombre ?? p) : 'Sin asistente'}
                    {p && (
                      <span className="block text-[11px] font-normal text-fg-muted">
                        {planesIa.find((x) => x.plan === p)?.mensajes_dia_empresa}/día
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium text-fg-muted">Módulos</h3>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                {MODULOS.map((m) => (
                  <label key={m} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={medida.modulos.includes(m)}
                      onChange={(e) =>
                        setMedida({
                          ...medida,
                          modulos: e.target.checked ? [...medida.modulos, m] : medida.modulos.filter((x) => x !== m)
                        })
                      }
                      className="size-4 accent-[rgb(var(--accent))]"
                    />
                    <span className="text-fg-body">{MODULO_LABEL[m]}</span>
                  </label>
                ))}
              </div>
            </section>

            <p className="text-xs text-fg-muted">
              Se aplica al momento y reemplaza el plan que tenga la empresa. La membresía (cómo paga) no cambia.
            </p>
          </div>
        )}
      </Modal>
    </>
  )
}
