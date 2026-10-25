import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { supabase } from '@/core/supabase/client'
import { listarPlanesIa, usoIaEmpresas, type UsoIaEmpresa } from '@/core/data/api'
import type { PlanIaConfig } from '@/core/types'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { formatMiles } from '@/lib/format'

/** Consola general: topes diarios de cada plan del asistente y uso por empresa. */
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
    setGuardando(p.plan)
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: {
        accion: 'actualizar_planes_ia',
        plan: p.plan,
        mensajes_dia_empresa: p.mensajes_dia_empresa,
        mensajes_dia_usuario: p.mensajes_dia_usuario
      }
    })
    setGuardando(null)
    const msg = (data as { error?: string } | null)?.error ?? error?.message
    if (msg) return toast(msg, 'error')
    toast(`Plan ${p.nombre} actualizado`)
  }

  const conUso = uso.filter((u) => u.plan_ia || u.mes > 0)

  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Planes del asistente con IA"
          subtitle="Todos los planes tienen las mismas funciones; cambia cuántas preguntas al día. Se aplica al momento."
        />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          {planes.map((p) => (
            <div key={p.plan} className="space-y-3 rounded-xl border border-border p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                <Sparkles size={15} className="text-accent" /> {p.nombre}
              </p>
              <Field label="Mensajes al día por empresa">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={p.mensajes_dia_empresa}
                  onChange={(e) => cambiar(p.plan, { mensajes_dia_empresa: Number(e.target.value) })}
                />
              </Field>
              <Field label="Mensajes al día por usuario">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={p.mensajes_dia_usuario}
                  onChange={(e) => cambiar(p.plan, { mensajes_dia_usuario: Number(e.target.value) })}
                />
              </Field>
              <Button size="sm" block disabled={guardando === p.plan} onClick={() => void guardar(p)}>
                {guardando === p.plan ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Uso del asistente" subtitle="Mensajes respondidos" />
        <CardBody className="p-0">
          <div className="divide-y divide-border">
            {conUso.map((u) => (
              <div key={u.empresa_id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{u.nombre}</p>
                  <p className="text-xs text-fg-muted">
                    Hoy {formatMiles(u.hoy)} · mes {formatMiles(u.mes)}
                  </p>
                </div>
                <Badge tone={u.plan_ia ? 'accent' : 'neutral'}>
                  {planes.find((p) => p.plan === u.plan_ia)?.nombre ?? 'Sin asistente'}
                </Badge>
              </div>
            ))}
            {conUso.length === 0 && (
              <p className="px-5 py-4 text-sm text-fg-muted">Ninguna empresa tiene el asistente activado todavía.</p>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
