import { useEffect, useState } from 'react'
import { Plus, Trash2, Store, Sparkles, Palette, Cloud, X, Check, Lock } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useSync } from '@/core/offline/SyncProvider'
import { useTheme } from '@/core/theme/ThemeProvider'
import { ACENTOS } from '@/core/theme/acentos'
import { supabase } from '@/core/supabase/client'
import { listarCategorias, listarMotivos, listarProveedores, listarUbicaciones } from '@/core/data/api'
import { MODULOS, MODULO_LABEL, RUBRO_LABEL } from '@/core/auth/capabilities'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/confirm'
import { ConfigReposicion } from '@/components/reposicion/ConfigReposicion'
import { cn } from '@/lib/cn'
import { formatFecha, hace } from '@/lib/format'

export function Configuracion() {
  const { empresa, can, refrescar } = useAuth()
  const { ultimaSync, pendientes, online } = useSync()
  const { tema, acento, setTema, setAcento } = useTheme()
  const toast = useToast()
  const confirmar = useConfirm()
  const [nombre, setNombre] = useState(empresa?.nombre ?? '')
  const [moneda, setMoneda] = useState(empresa?.moneda ?? 'CLP')
  const [usaVariantes, setUsaVariantes] = useState(empresa?.usa_variantes ?? false)
  const [categorias, setCategorias] = useState<{ id: string; nombre: string }[]>([])
  const [motivos, setMotivos] = useState<{ id: string; nombre: string }[]>([])
  const [proveedores, setProveedores] = useState<{ id: string; nombre: string }[]>([])
  const [ubicaciones, setUbicaciones] = useState<{ id: string; nombre: string; tipo: string; activa: boolean }[]>([])
  const [nuevo, setNuevo] = useState('')
  const [nuevaUbi, setNuevaUbi] = useState({ nombre: '', tipo: 'tienda' })

  async function recargar() {
    const [c, m, p, u] = await Promise.all([listarCategorias(), listarMotivos(), listarProveedores(), listarUbicaciones()])
    setCategorias(c); setMotivos(m); setProveedores(p)
    setUbicaciones(u.map((x: { id: string; nombre: string; tipo: string; activa: boolean }) => x))
  }

  useEffect(() => {
    void recargar()
  }, [])

  async function guardarEmpresa() {
    if (!empresa) return
    const { error } = await supabase
      .from('empresas')
      .update({ nombre, moneda, usa_variantes: usaVariantes })
      .eq('id', empresa.id)
    if (error) {
      // Lo rechazado no quedó guardado: la pantalla vuelve al valor real
      setUsaVariantes(empresa.usa_variantes ?? false)
      return toast(error.message, 'error')
    }
    toast('Empresa actualizada')
    await refrescar()
  }

  async function agregar(tabla: 'categorias' | 'motivos_salida' | 'proveedores', campo = 'nombre') {
    if (!nuevo.trim() || !empresa) return
    const payload: Record<string, unknown> = { empresa_id: empresa.id }
    payload[campo] = nuevo.trim()
    const { error } = await supabase.from(tabla).insert(payload)
    if (error) return toast(error.message, 'error')
    setNuevo('')
    void recargar()
  }

  async function eliminar(tabla: string, id: string, etiqueta: string) {
    const ok = await confirmar({
      titulo: `Eliminar ${etiqueta}`,
      mensaje: 'Esta acción no se puede deshacer.',
      accion: 'Eliminar'
    })
    if (!ok) return
    const { error } = await supabase.from(tabla).delete().eq('id', id)
    if (error) return toast(error.message, 'error')
    void recargar()
  }

  async function agregarUbicacion() {
    if (!nuevaUbi.nombre.trim() || !empresa) return
    const { error } = await supabase.from('ubicaciones').insert({ empresa_id: empresa.id, nombre: nuevaUbi.nombre.trim(), tipo: nuevaUbi.tipo })
    if (error) return toast(error.message, 'error')
    setNuevaUbi({ nombre: '', tipo: 'tienda' })
    toast('Ubicación agregada')
    await refrescar()
    void recargar()
  }

  // Las ubicaciones no se borran (perderían su historial): se desactivan. La base exige que
  // no tengan stock, transferencias sin recibir ni cuentas de mesa abiertas.
  async function cambiarEstadoUbicacion(u: { id: string; nombre: string; activa: boolean }) {
    if (u.activa) {
      const ok = await confirmar({
        titulo: `Desactivar ${u.nombre}`,
        mensaje:
          'Dejará de aparecer para vender, recibir o transferir. Su historial de ventas y movimientos se conserva y puedes reactivarla cuando quieras. Los usuarios asignados solo a esta ubicación quedarán sin acceso hasta que les asignes otra.',
        accion: 'Desactivar'
      })
      if (!ok) return
    }
    const { error } = await supabase.from('ubicaciones').update({ activa: !u.activa }).eq('id', u.id)
    if (error) return toast(error.message, 'error')
    toast(u.activa ? `${u.nombre} desactivada` : `${u.nombre} reactivada`)
    await refrescar()
    void recargar()
  }

  async function cargarDemo() {
    if (!empresa) return
    const { error } = await supabase.rpc('sembrar_demo', { p_empresa: empresa.id })
    if (error) return toast(error.message, 'error')
    toast('Datos de demostración cargados')
    await refrescar()
    void recargar()
  }

  const admin = can('config.gestionar')
  const modulosActivos = MODULOS.filter((m) => empresa?.modulos.includes(m))
  const modulosNoIncluidos = MODULOS.filter((m) => !empresa?.modulos.includes(m))

  return (
    <>
      <PageHeader title="Configuración" subtitle={empresa?.nombre} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Empresa" subtitle="Datos generales" />
          <CardBody className="space-y-4">
            <Field label="Nombre"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={!admin} /></Field>
            <Field label="Moneda">
              <Select value={moneda} onChange={(e) => setMoneda(e.target.value)} disabled={!admin}>
                <option value="CLP">CLP — Peso chileno</option>
                <option value="MXN">MXN — Peso mexicano</option>
                <option value="USD">USD — Dólar</option>
              </Select>
            </Field>
            <Field
              label="Tipo de negocio"
              hint="Lo define el administrador general. En restaurante, los productos nuevos parten sin control de stock; siempre puedes cambiarlo producto a producto."
            >
              <Input value={RUBRO_LABEL[empresa?.tipo_negocio ?? 'retail']} disabled />
            </Field>
            <label className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm text-fg-body">
              <input
                type="checkbox"
                checked={usaVariantes}
                onChange={(e) => setUsaVariantes(e.target.checked)}
                disabled={!admin}
                className="mt-0.5 size-4 accent-[rgb(var(--accent))]"
              />
              <span>
                <span className="font-medium text-fg">Usar tallas y colores</span>
                <span className="block text-xs text-fg-muted">
                  Cada talla/color tendrá su propio stock y habrá que elegirla al vender. Si no lo necesitas,
                  déjalo apagado y cada producto tendrá un solo stock. Para apagarlo, primero desactiva las
                  tallas de los productos que las tengan.
                </span>
              </span>
            </label>
            <Button onClick={() => void guardarEmpresa()} disabled={!admin}>Guardar</Button>
            <p className="text-xs text-fg-muted">Plan actual: <b>{empresa?.plan}</b>{empresa?.prueba_hasta ? ` · vence el ${formatFecha(empresa.prueba_hasta)}` : ''}. El plan y el período de prueba los asigna el administrador general.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Módulos habilitados" subtitle="Funcionalidades activas para la empresa" />
          <CardBody>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {modulosActivos.map((m) => (
                <div key={m} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-fg-body">
                  <Check size={15} className="text-success" />
                  <span>{MODULO_LABEL[m]}</span>
                </div>
              ))}
            </div>
            {modulosNoIncluidos.length > 0 && (
              <p className="mt-3 text-xs text-fg-muted">
                No incluidos: {modulosNoIncluidos.map((m) => MODULO_LABEL[m]).join(', ')}.
              </p>
            )}
            <p className="mt-3 flex items-start gap-1.5 text-xs text-fg-muted">
              <Lock size={13} className="mt-0.5 shrink-0" />
              Los módulos los habilita el administrador general. A cada usuario le das acceso desde
              Usuarios y permisos.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tiendas y bodegas" subtitle="Agrega o desactiva ubicaciones (no se borran, para conservar su historial)" />
          <CardBody className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Nombre de la ubicación" value={nuevaUbi.nombre} onChange={(e) => setNuevaUbi({ ...nuevaUbi, nombre: e.target.value })} />
              <Select value={nuevaUbi.tipo} onChange={(e) => setNuevaUbi({ ...nuevaUbi, tipo: e.target.value })} className="w-32">
                <option value="tienda">Tienda</option>
                <option value="bodega">Bodega</option>
              </Select>
              <Button variant="secondary" onClick={() => void agregarUbicacion()} disabled={!admin}><Plus size={16} /></Button>
            </div>
            <div className="divide-y divide-border">
              {ubicaciones.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className={cn('flex items-center gap-2', u.activa ? 'text-fg' : 'text-fg-faint')}>
                    <Store size={14} className="text-fg-muted" />{u.nombre}
                  </span>
                  <span className="flex items-center gap-2">
                    {!u.activa && <Badge tone="blocked">inactiva</Badge>}
                    <Badge tone="neutral">{u.tipo}</Badge>
                    {admin && (
                      <Button size="sm" variant="ghost" onClick={() => void cambiarEstadoUbicacion(u)}>
                        {u.activa ? 'Desactivar' : 'Reactivar'}
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Motivos de salida" />
          <CardBody className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Nuevo motivo" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
              <Button variant="secondary" onClick={() => void agregar('motivos_salida')} disabled={!admin}><Plus size={16} /></Button>
            </div>
            <div className="divide-y divide-border">
              {motivos.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-fg">{m.nombre}</span>
                  {admin && <button onClick={() => void eliminar('motivos_salida', m.id, `el motivo «${m.nombre}»`)} aria-label={`Eliminar motivo ${m.nombre}`} className="text-fg-muted hover:text-danger"><Trash2 size={14} /></button>}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Categorías" />
          <CardBody className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Nueva categoría" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
              <Button variant="secondary" onClick={() => void agregar('categorias')} disabled={!admin}><Plus size={16} /></Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {categorias.map((c) => (
                <span key={c.id} className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs text-fg-body">
                  {c.nombre}
                  {admin && <button onClick={() => void eliminar('categorias', c.id, `la categoría «${c.nombre}»`)} aria-label={`Eliminar categoría ${c.nombre}`} className="text-fg-muted hover:text-danger"><X size={12} /></button>}
                </span>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Proveedores" />
          <CardBody className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Nuevo proveedor" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
              <Button variant="secondary" onClick={() => void agregar('proveedores')} disabled={!admin}><Plus size={16} /></Button>
            </div>
            <div className="divide-y divide-border">
              {proveedores.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-fg">{p.nombre}</span>
                  {admin && <button onClick={() => void eliminar('proveedores', p.id, `el proveedor «${p.nombre}»`)} aria-label={`Eliminar proveedor ${p.nombre}`} className="text-fg-muted hover:text-danger"><Trash2 size={14} /></button>}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <ConfigReposicion />

        <Card>
          <CardHeader title="Apariencia" subtitle="Tema y color de acento" />
          <CardBody className="space-y-4">
            <div className="flex items-center gap-2">
              <Palette size={16} className="text-fg-muted" />
              {(['light', 'dark'] as const).map((t) => (
                <button key={t} onClick={() => setTema(t)} className={cn('rounded-lg px-3 py-1.5 text-xs', tema === t ? 'bg-accent text-on-accent' : 'bg-surface text-fg-muted')}>
                  {t === 'light' ? 'Claro' : 'Oscuro'}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {ACENTOS.map((a) => (
                <button key={a} onClick={() => setAcento(a)} className={cn('rounded-lg px-3 py-1.5 text-xs capitalize', acento === a ? 'bg-accent text-on-accent' : 'bg-surface text-fg-muted')}>
                  {a}
                </button>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Sincronización" subtitle="Preferencias y estado" />
          <CardBody className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Cloud size={16} className={online ? 'text-success' : 'text-warning'} />
              <span className="text-fg-body">{online ? 'Conectado' : 'Sin conexión'}</span>
            </div>
            <p className="text-fg-muted">Última sincronización: {hace(ultimaSync)}</p>
            <p className="text-fg-muted">Operaciones pendientes: {pendientes}</p>
          </CardBody>
        </Card>

        {admin && (
          <Card className="lg:col-span-2">
            <CardHeader title="Datos de demostración" subtitle="Carga Boutique Aurora con productos y stock de ejemplo" />
            <CardBody>
              <Button variant="secondary" onClick={() => void cargarDemo()}>
                <Sparkles size={16} /> Cargar datos de ejemplo
              </Button>
              <p className="mt-2 text-xs text-fg-muted">Solo funciona si la empresa aún no tiene ubicaciones creadas.</p>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  )
}
