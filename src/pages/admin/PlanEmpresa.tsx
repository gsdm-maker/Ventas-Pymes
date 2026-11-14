import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Layers } from 'lucide-react'
import type { Empresa, Nivel, NivelPlanConfig, PlanIa, PlanIaConfig, TipoNegocio } from '@/core/types'
import { MODULOS, MODULO_LABEL, RUBRO_LABEL, modulosPorRubro } from '@/core/auth/capabilities'
import { adminUsers } from '@/core/data/admin'
import { listarNiveles, listarPlanesIa } from '@/core/data/api'
import { NIVEL_LABEL } from '@/lib/niveles'
import { formatCLP, formatMiles } from '@/lib/format'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'

const NIVELES: Nivel[] = ['s', 'm', 'l', 'medida']
const RUBROS = Object.keys(RUBRO_LABEL) as TipoNegocio[]
const CAMPOS = [
  { k: 'productos', label: 'Productos' },
  { k: 'ubicaciones', label: 'Locales' },
  { k: 'usuarios', label: 'Usuarios' }
] as const

function tope(n: number | null): string {
  return n === null ? 'sin límite' : formatMiles(n)
}

function aTexto(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n)
}

/** Lo que se escribe en un tope: vacío = sin límite; undefined = inválido. */
function leerTope(texto: string): number | null | undefined {
  if (!texto.trim()) return null
  const n = Number(texto)
  return Number.isInteger(n) && n >= 1 ? n : undefined
}

/** Espejo de _modulos_nivel() en la base: en retail se quitan Mesas y Cocina. */
function modulosDelNivel(n: NivelPlanConfig, rubro: string | undefined): string[] {
  return rubro === 'retail' || !rubro ? n.modulos.filter((m) => m !== 'mesas' && m !== 'cocina') : [...n.modulos]
}

function mismos(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join() === [...b].sort().join()
}

function Opcion({
  activo,
  disabled,
  onClick,
  children
}: {
  activo: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activo}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        activo ? 'border-accent bg-accent-soft text-accent' : 'border-border text-fg-body hover:bg-surface'
      )}
    >
      {children}
    </button>
  )
}

/**
 * Consola general · plan de la empresa, en un solo lugar: 1 plan → 2 rubro → lo que incluye.
 * Socio, Socio Pro y Socio Pro Max fijan módulos, asistente y topes (el rubro solo suma o quita
 * Mesas y Cocina). Solo «A medida» deja ajustar módulos, asistente y topes a mano; la Edge
 * Function rechaza esos ajustes en los otros niveles. La membresía (cómo paga) va aparte.
 */
export function PlanEmpresa({ empresa, onCambio }: { empresa: Empresa; onCambio: () => void }) {
  const toast = useToast()
  const [catalogo, setCatalogo] = useState<NivelPlanConfig[]>([])
  const [planesIa, setPlanesIa] = useState<PlanIaConfig[]>([])
  const [elegido, setElegido] = useState<Nivel | null>(empresa.nivel ?? null)
  const [rubro, setRubro] = useState<TipoNegocio>(empresa.tipo_negocio ?? 'retail')
  const [topes, setTopes] = useState({ productos: '', ubicaciones: '', usuarios: '' })
  const [precio, setPrecio] = useState(aTexto(empresa.precio_medida))
  const [modulos, setModulos] = useState<string[]>(empresa.modulos)
  const [planIa, setPlanIa] = useState<PlanIa | null>(empresa.plan_ia ?? null)
  const [enviando, setEnviando] = useState(false)
  const [cargado, setCargado] = useState(false)

  useEffect(() => {
    void Promise.all([listarNiveles().then(setCatalogo), listarPlanesIa().then(setPlanesIa)]).finally(() =>
      setCargado(true)
    )
  }, [])

  useEffect(() => {
    setElegido(empresa.nivel ?? null)
    setRubro(empresa.tipo_negocio ?? 'retail')
    setModulos(empresa.modulos)
    setPlanIa(empresa.plan_ia ?? null)
    setTopes({
      productos: aTexto(empresa.max_productos),
      ubicaciones: aTexto(empresa.max_ubicaciones),
      usuarios: aTexto(empresa.max_usuarios)
    })
    setPrecio(aTexto(empresa.precio_medida))
  }, [empresa])

  const rubroGuardado = empresa.tipo_negocio ?? 'retail'
  const anual = empresa.plan === 'anual'
  const actual = catalogo.find((n) => n.nivel === empresa.nivel)
  const vista = catalogo.find((n) => n.nivel === elegido)
  // Datos anteriores a este cambio: módulos o asistente distintos a los del nivel estándar
  const personalizado =
    !!actual &&
    ((actual.plan_ia ?? null) !== (empresa.plan_ia ?? null) ||
      !mismos(modulosDelNivel(actual, empresa.tipo_negocio), empresa.modulos))

  // Sin catálogo (base sin la migración 0027) no hay planes que aplicar
  const sinCatalogo = cargado && catalogo.length === 0
  // Ajustes a mano: solo con «A medida» ya guardado
  const editaAjustes = empresa.nivel === 'medida' && elegido === 'medida'

  const topesCambian =
    topes.productos !== aTexto(empresa.max_productos) ||
    topes.ubicaciones !== aTexto(empresa.max_ubicaciones) ||
    topes.usuarios !== aTexto(empresa.max_usuarios) ||
    precio !== aTexto(empresa.precio_medida)
  const cambiaNivel =
    elegido !== null &&
    (elegido !== empresa.nivel || (elegido === 'medida' && topesCambian) || (elegido === empresa.nivel && personalizado))
  const cambiaRubro = rubro !== rubroGuardado
  const cambiaAjustes = editaAjustes && (!mismos(modulos, empresa.modulos) || planIa !== (empresa.plan_ia ?? null))

  // Lo que quedará incluido (espejo de aplicar_nivel / cambiar_rubro en la base)
  const incluye: string[] =
    vista && elegido !== 'medida'
      ? modulosDelNivel(vista, rubro)
      : editaAjustes
        ? modulos
        : modulosPorRubro(rubro, empresa.modulos)
  const iaIncluida = vista && elegido !== 'medida' ? vista.plan_ia : editaAjustes ? planIa : (empresa.plan_ia ?? null)
  const nombreIa = (p: PlanIa | null) => (p ? (planesIa.find((x) => x.plan === p)?.nombre ?? p) : 'Sin asistente')

  async function enviar(body: Record<string, unknown>): Promise<boolean> {
    const { error } = await adminUsers({ ...body, empresa_id: empresa.id })
    if (error) toast(error, 'error')
    return !error
  }

  async function aplicarPlan() {
    let nivelBody: Record<string, unknown> | null = null
    if (cambiaNivel && elegido) {
      nivelBody = { accion: 'actualizar_nivel', nivel: elegido }
      if (elegido === 'medida') {
        const p = leerTope(topes.productos)
        const u = leerTope(topes.ubicaciones)
        const us = leerTope(topes.usuarios)
        if (p === undefined || u === undefined || us === undefined) {
          return toast('Los topes son números enteros mayores que cero; déjalos vacíos para «sin límite»', 'warning')
        }
        Object.assign(nivelBody, {
          max_productos: p,
          max_ubicaciones: u,
          max_usuarios: us,
          precio_medida: precio ? Number(precio) : null
        })
      }
    }
    setEnviando(true)
    let algo = false
    try {
      // Primero el rubro: el nivel calcula sus módulos con el rubro guardado
      if (cambiaRubro) {
        if (!(await enviar({ accion: 'actualizar_rubro', tipo_negocio: rubro }))) return
        algo = true
      }
      if (nivelBody) {
        if (!(await enviar(nivelBody))) return
        algo = true
      }
      toast(elegido ? `Plan ${NIVEL_LABEL[elegido]} aplicado` : 'Rubro actualizado')
    } finally {
      setEnviando(false)
      if (algo) onCambio()
    }
  }

  async function guardarAjustes() {
    if (modulos.length === 0) return toast('Deja al menos un módulo', 'warning')
    setEnviando(true)
    let algo = false
    try {
      if (!mismos(modulos, empresa.modulos)) {
        if (!(await enviar({ accion: 'actualizar_modulos', modulos }))) return
        algo = true
      }
      if (planIa !== (empresa.plan_ia ?? null)) {
        if (!(await enviar({ accion: 'actualizar_plan_ia', plan_ia: planIa }))) return
        algo = true
      }
      toast('Ajustes a medida guardados')
    } finally {
      setEnviando(false)
      if (algo) onCambio()
    }
  }

  return (
    <Card>
      <CardHeader
        title="Plan de la empresa"
        subtitle="El plan define qué incluye; el rubro, si lleva mesas y cocina"
        action={
          <Link to="/admin/planes" className="shrink-0 text-xs font-medium text-accent hover:underline">
            Comparar planes
          </Link>
        }
      />
      <CardBody className="space-y-4">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Layers size={15} className="text-fg-muted" aria-hidden />
          <Badge tone={empresa.nivel ? 'accent' : 'neutral'}>
            {empresa.nivel ? NIVEL_LABEL[empresa.nivel] : 'Sin plan'}
          </Badge>
          <Badge tone="neutral">{RUBRO_LABEL[rubroGuardado]}</Badge>
          {personalizado && <Badge tone="warning">distinto al plan</Badge>}
        </p>
        {sinCatalogo ? (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
            No se pudo leer el catálogo de planes: la base todavía no tiene los planes (migración 0027). Hasta
            aplicarla no se pueden asignar planes y lo de abajo muestra lo que la empresa tiene hoy.
          </p>
        ) : (
          !empresa.nivel && (
            <p className="text-xs text-fg-muted">
              Sin plan no se aplican topes y lo que incluye quedó de antes. Elige el plan que paga y aplícalo.
            </p>
          )
        )}

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">1 · Plan</h3>
          <div role="radiogroup" aria-label="Plan" className="grid grid-cols-2 gap-1.5">
            {NIVELES.map((n) => {
              const c = catalogo.find((x) => x.nivel === n)
              return (
                <Opcion
                  key={n}
                  activo={elegido === n}
                  disabled={sinCatalogo || (anual && n !== 'l')}
                  onClick={() => setElegido(n)}
                >
                  {NIVEL_LABEL[n]}
                  <span className="block text-[11px] font-normal text-fg-muted">
                    {c
                      ? `${formatCLP(c.precio_mensual)}/mes`
                      : n === 'medida' && empresa.nivel === 'medida' && empresa.precio_medida != null
                        ? `${formatCLP(empresa.precio_medida)}/mes`
                        : !cargado
                          ? '…'
                          : n === 'medida'
                            ? 'Por cotización'
                            : '—'}
                  </span>
                </Opcion>
              )
            })}
          </div>
          {vista && (
            <p className="text-xs text-fg-muted">
              Productos {tope(vista.max_productos)} · locales {tope(vista.max_ubicaciones)} · usuarios{' '}
              {tope(vista.max_usuarios)} · reportes {vista.reportes_completos ? 'completos' : 'del día y del mes'} ·
              permisos a medida {vista.permisos_a_medida ? 'sí' : 'no'}.
            </p>
          )}
          {elegido === 'medida' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="Precio/mes" hint={precio ? formatCLP(Number(precio)) : 'Cotizado'}>
                <Input
                  inputMode="numeric"
                  placeholder="45000"
                  value={precio}
                  onChange={(e) => setPrecio(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
              {CAMPOS.map(({ k, label }) => (
                <Field key={k} label={label}>
                  <Input
                    inputMode="numeric"
                    placeholder="Sin límite"
                    value={topes[k]}
                    onChange={(e) => setTopes((prev) => ({ ...prev, [k]: e.target.value.replace(/\D/g, '') }))}
                  />
                </Field>
              ))}
            </div>
          )}
          {anual && <p className="text-xs text-fg-muted">Con membresía anual el plan es siempre Socio Pro Max.</p>}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">2 · Rubro</h3>
          <div role="radiogroup" aria-label="Rubro" className="grid grid-cols-3 gap-1.5">
            {RUBROS.map((r) => (
              <Opcion key={r} activo={rubro === r} onClick={() => setRubro(r)}>
                {RUBRO_LABEL[r]}
              </Opcion>
            ))}
          </div>
          {elegido === 's' && rubro !== 'retail' && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
              Socio no incluye mesas ni cocina: para restaurante corresponde Socio Pro o superior.
            </p>
          )}
          <p className="text-xs text-fg-muted">En restaurante, los productos nuevos parten sin control de stock.</p>
        </section>

        <Button block disabled={enviando || sinCatalogo || (!cambiaNivel && !cambiaRubro)} onClick={() => void aplicarPlan()}>
          {enviando
            ? 'Aplicando…'
            : !cambiaRubro && elegido === empresa.nivel && personalizado && elegido !== 'medida'
              ? 'Volver a lo del plan'
              : 'Aplicar plan y rubro'}
        </Button>

        <section className="space-y-2 border-t border-border pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {editaAjustes ? '3 · Ajustes a medida' : vista || elegido === 'medida' ? '3 · Qué incluye' : '3 · Qué tiene hoy'}
          </h3>
          {editaAjustes ? (
            <>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {MODULOS.map((m) => (
                  <label key={m} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
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
              <div role="radiogroup" aria-label="Asistente con IA" className="grid grid-cols-2 gap-1.5">
                <Opcion activo={!planIa} onClick={() => setPlanIa(null)}>
                  Sin asistente
                </Opcion>
                {planesIa.map((p) => (
                  <Opcion key={p.plan} activo={planIa === p.plan} onClick={() => setPlanIa(p.plan)}>
                    {p.nombre}
                    <span className="block text-[11px] font-normal text-fg-muted">{p.mensajes_dia_empresa}/día</span>
                  </Opcion>
                ))}
              </div>
              <Button variant="secondary" block disabled={enviando || !cambiaAjustes} onClick={() => void guardarAjustes()}>
                {enviando ? 'Guardando…' : 'Guardar ajustes a medida'}
              </Button>
            </>
          ) : (
            <>
              <ul className="flex flex-wrap gap-1.5" aria-label="Módulos incluidos">
                {MODULOS.filter((m) => incluye.includes(m)).map((m) => (
                  <li key={m} className="rounded-full bg-surface px-2.5 py-1 text-xs text-fg-body">
                    {MODULO_LABEL[m]}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-fg-muted">Asistente: {nombreIa(iaIncluida)}.</p>
              <p className="text-xs text-fg-muted">
                {!vista && elegido !== 'medida'
                  ? 'Es lo que tiene hoy. Al aplicar un plan, quedará lo que ese plan incluye.'
                  : elegido === 'medida'
                    ? 'Al aplicar «A medida» se conservan estos módulos y asistente; después podrás ajustarlos aquí.'
                    : 'Lo fija el plan. Para ajustar módulos o asistente a mano, pásala a «A medida».'}
              </p>
            </>
          )}
        </section>
      </CardBody>
    </Card>
  )
}
