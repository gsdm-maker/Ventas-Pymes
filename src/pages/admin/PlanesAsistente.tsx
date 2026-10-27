import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { listarPlanesIa, usoIaEmpresas, type UsoIaEmpresa } from '@/core/data/api'
import type { PlanIaConfig } from '@/core/types'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { formatMiles } from '@/lib/format'
import { adminUsers } from '@/core/data/admin'

/** Consola general · Asistente IA: topes diarios de cada plan y uso por empresa. */
export function PlanesAsistente() {
  const toast = useToast()
  const [planes, setPlanes] = useState<PlanIaConfig[]>([])
  const [uso, setUso] = useState<UsoIaEmpresa[]>([])
  const [guardando, setGuardando] = useState<string | null>(null)

  useEffect(() => {
    void listarPlanesIa().then(setPlanes)
    void usoIaEmpresas().then(setUso)
  }, [])

  function cambiar(plan: string, campos: Partial<PlanIaConfig>) {
    setPlanes((prev) => prev.map((p) => (p.plan === plan ? { ...p, ...campos } : p)))
  }

  async function guardar(p: PlanIaConfig) {
    if (p.mensajes_dia_usuario !== null && p.mensajes_dia_usuario > p.mensajes_dia_empresa) {
      return toast('El máximo por persona no puede superar la bolsa de la empresa', 'warning')
    }
    setGuardando(p.plan)
    const { error } = await adminUsers({
      accion: 'actualizar_planes_ia',
      plan: p.plan,
      mensajes_dia_empresa: p.mensajes_dia_empresa,
      mensajes_dia_usuario: p.mensajes_dia_usuario
    })
    setGuardando(null)
    if (error) return toast(error, 'error')
    toast(`Plan ${p.nombre} actualizado`)
  }

  const conUso = uso.filter((u) => u.plan_ia || u.mes > 0)

  return (
    <div className="mt-5 space-y-5">
      <Card>
        <CardHeader
          title="Topes de cada plan"
          subtitle="Preguntas al día. Se aplica al momento a todas las empresas con ese plan. Lo que no se usa en el día no se acumula."
        />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          {planes.map((p) => (
            <div key={p.plan} className="space-y-3 rounded-xl border border-border p-4">
              <p className="flex items-center justify-between gap-2 text-sm font-semibold text-fg">
                <span className="flex items-center gap-2">
                  <Sparkles size={15} className="text-accent" /> {p.nombre}
                </span>
                <span className="text-xs font-normal text-fg-muted">
                  {uso.filter((u) => u.plan_ia === p.plan).length} empresa(s)
                </span>
              </p>
              <Field label="Bolsa diaria de la empresa" hint="La comparten todas las personas con permiso.">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={p.mensajes_dia_empresa}
                  onChange={(e) => cambiar(p.plan, { mensajes_dia_empresa: Number(e.target.value) })}
                />
              </Field>
              <Field
                label="Máximo por persona al día"
                hint={p.mensajes_dia_usuario ? 'Nadie puede usar más que esto, aunque sobre bolsa.' : 'Vacío = sin límite: cualquiera puede usar toda la bolsa.'}
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={p.mensajes_dia_empresa}
                  placeholder="Sin límite"
                  value={p.mensajes_dia_usuario ?? ''}
                  onChange={(e) =>
                    cambiar(p.plan, { mensajes_dia_usuario: e.target.value === '' ? null : Number(e.target.value) })
                  }
                />
              </Field>
              <Button size="sm" variant="secondary" block disabled={guardando === p.plan} onClick={() => void guardar(p)}>
                {guardando === p.plan ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Uso por empresa" subtitle="Mensajes respondidos hoy y en el mes" />
        <CardBody className="p-0">
          {conUso.length === 0 ? (
            <p className="px-5 py-4 text-sm text-fg-muted">Ninguna empresa tiene el asistente activado todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-fg-muted">
                    <th className="px-5 py-2.5 font-medium">Empresa</th>
                    <th className="px-5 py-2.5 font-medium">Plan</th>
                    <th className="px-5 py-2.5 text-right font-medium">Hoy</th>
                    <th className="px-5 py-2.5 text-right font-medium">Mes</th>
                  </tr>
                </thead>
                <tbody>
                  {conUso.map((u) => {
                    const plan = planes.find((p) => p.plan === u.plan_ia)
                    return (
                      <tr key={u.empresa_id} className="border-b border-border/60 last:border-0">
                        <td className="px-5 py-2.5 font-medium text-fg">{u.nombre}</td>
                        <td className="px-5 py-2.5">
                          <Badge tone={plan ? 'accent' : 'neutral'}>{plan?.nombre ?? 'Sin asistente'}</Badge>
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-fg-body">
                          {formatMiles(u.hoy)}
                          {plan && <span className="text-fg-faint"> / {formatMiles(plan.mensajes_dia_empresa)}</span>}
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-fg-body">{formatMiles(u.mes)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
