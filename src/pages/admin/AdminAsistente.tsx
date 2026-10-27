import { Building2, Gauge, ShieldCheck, UserCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { AdminTabs } from '@/pages/admin/AdminTabs'
import { PlanesAsistente } from '@/pages/admin/PlanesAsistente'
import { Card, CardBody } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/Feedback'

function Paso({ n, icono, titulo, children }: { n: number; icono: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">{icono}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-fg">
          <span className="text-fg-faint">{n}.</span> {titulo}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{children}</p>
      </div>
    </div>
  )
}

/** Consola general · Asistente con IA: cómo funciona, topes de cada plan y uso por empresa. */
export function AdminAsistente() {
  return (
    <>
      <AdminTabs />
      <PageHeader
        title="Asistente con IA"
        subtitle="Socio IA responde preguntas sobre stock, ventas, reposición y horarios con los datos de cada empresa"
      />

      <Card>
        <CardBody>
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-fg-muted">Cómo funciona</p>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Paso n={1} icono={<Building2 size={16} />} titulo="Activas el plan por empresa">
              En Empresas → ficha → «Asistente con IA» eliges Básico, Pro o Max (o sin asistente). Es
              independiente del plan de suscripción.
            </Paso>
            <Paso n={2} icono={<UserCheck size={16} />} titulo="La empresa da el permiso">
              Los administradores de la empresa lo tienen de inmediato. A cada otro usuario se lo dan o quitan en
              Usuarios → permiso «Asistente».
            </Paso>
            <Paso n={3} icono={<Gauge size={16} />} titulo="Cada pregunta descuenta de la bolsa">
              Cada plan tiene una bolsa diaria que comparte toda la empresa y, si quieres, un máximo por persona
              (vacío = sin límite, así una empresa de una sola persona usa todo). Se renueva a medianoche de Chile;
              si la IA falla, el mensaje no se descuenta.
            </Paso>
            <Paso n={4} icono={<ShieldCheck size={16} />} titulo="Solo lee, nunca modifica">
              El asistente consulta con los mismos permisos de quien pregunta: no ve tiendas ni reportes que esa
              persona no ve, y no puede cambiar datos. Si la suscripción vence, también se detiene.
            </Paso>
          </div>
          <p className="mt-5 rounded-xl bg-surface px-4 py-3 text-xs leading-relaxed text-fg-muted">
            Los tres planes usan el mismo modelo y las mismas funciones; solo cambia cuántas preguntas al día
            permiten. El costo lo paga la clave de OpenAI de la plataforma (secreto <code>OPENAI_API_KEY</code> de
            la función <code>asistente</code>); el modelo se cambia con el secreto <code>AI_MODEL</code> sin tocar
            código. Para estimar el gasto, mira «mes» en el uso por empresa.
          </p>
        </CardBody>
      </Card>

      <PlanesAsistente />
    </>
  )
}
