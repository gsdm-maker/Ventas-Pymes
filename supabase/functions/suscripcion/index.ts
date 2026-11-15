// ============================================================
// Mi Socio Pyme · Edge Function `suscripcion` (cobro automático con Flow, migración 0030)
// Acciones (parámetro `accion`):
//   POST  JSON  {accion:'contratar', nivel, periodo, empresa_id?}  → {url}  (admin de la empresa)
//   POST  JSON  {accion:'cancelar', empresa_id?}                   → {ok}   (admin de la empresa)
//   POST  form  ?accion=retorno  Flow devuelve al cliente tras registrar la tarjeta (sin sesión)
//   POST  form  ?accion=cobro    Flow avisa un cobro del plan (sin sesión; el contenido NO se cree)
//   POST        ?accion=sincronizar  tarea diaria (cabecera x-sync-secret) o administrador general
// Reglas:
//   - verify_jwt = false (Flow no manda sesión): cada acción valida lo suyo aquí.
//   - Nada que llegue de Flow se toma como verdad: se consulta a Flow con la clave del comercio
//     y recién eso se registra con las funciones flow_* (solo service_role).
//   - Los secretos viven solo en esta función. Nunca se registran claves, tokens ni tarjetas.
// Secretos: FLOW_API_KEY, FLOW_SECRET_KEY, FLOW_API_URL (sandbox o producción), APP_URL,
//           SYNC_SECRET, APP_URLS_EXTRA (opcional, orígenes extra para CORS, separados por coma).
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FLOW_API_KEY = Deno.env.get('FLOW_API_KEY') ?? ''
const FLOW_SECRET_KEY = Deno.env.get('FLOW_SECRET_KEY') ?? ''
const FLOW_API_URL = (Deno.env.get('FLOW_API_URL') ?? 'https://sandbox.flow.cl/api').replace(/\/$/, '')
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
const SYNC_SECRET = Deno.env.get('SYNC_SECRET') ?? ''
const ORIGENES = [APP_URL, ...(Deno.env.get('APP_URLS_EXTRA') ?? '').split(',').map((s) => s.trim().replace(/\/$/, ''))].filter(Boolean)
// URL pública de esta función (la que Flow llama)
const URL_FUNCION = `${SUPABASE_URL}/functions/v1/suscripcion`

const NIVELES = ['s', 'm', 'l']
const PERIODOS = ['mensual', 'anual']

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

// ---------------- Utilidades ----------------
function cors(req: Request): Record<string, string> {
  const origen = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ORIGENES.includes(origen) ? origen : (ORIGENES[0] ?? 'null'),
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } })

/** Comparación en tiempo constante para secretos. */
function iguales(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

class ErrorFlow extends Error {}

// ---------------- Cliente de Flow ----------------
async function firmar(params: Record<string, string>): Promise<string> {
  const base = Object.keys(params).sort().map((k) => k + params[k]).join('')
  const llave = await crypto.subtle.importKey('raw', new TextEncoder().encode(FLOW_SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const firma = await crypto.subtle.sign('HMAC', llave, new TextEncoder().encode(base))
  return [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function flow(metodo: 'GET' | 'POST', ruta: string, datos: Record<string, string | number>): Promise<any> {
  if (!FLOW_API_KEY || !FLOW_SECRET_KEY) throw new ErrorFlow('Flow no está configurado')
  const params: Record<string, string> = { apiKey: FLOW_API_KEY }
  for (const [k, v] of Object.entries(datos)) params[k] = String(v)
  params.s = await firmar(params)
  const cuerpo = new URLSearchParams(params).toString()
  const r = metodo === 'GET'
    ? await fetch(`${FLOW_API_URL}${ruta}?${cuerpo}`)
    : await fetch(`${FLOW_API_URL}${ruta}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: cuerpo
      })
  const texto = await r.text()
  let data: any = null
  try { data = JSON.parse(texto) } catch { /* respuesta no JSON */ }
  if (!r.ok) throw new ErrorFlow(`Flow ${ruta}: ${data?.message ?? r.status}`.slice(0, 300))
  return data
}

/** Fecha de Flow «yyyy-mm-dd hh:mm:ss» (hora de Chile, se toma -03:00) → ISO. */
function fechaFlow(valor: unknown, sumarDias = 0): string | null {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(valor)) return null
  const hora = /\d{2}:\d{2}:\d{2}/.exec(valor)?.[0] ?? '00:00:00'
  const d = new Date(`${valor.slice(0, 10)}T${hora}-03:00`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + sumarDias)
  return d.toISOString()
}

// ---------------- Bitácora de avisos ----------------
async function evento(tipo: string, resultado: 'ok' | 'ignorado' | 'error', empresa: string | null, referencia?: string | null, detalle?: string | null) {
  await admin.from('eventos_flow').insert({
    tipo, resultado, empresa_id: empresa, referencia: referencia?.slice(0, 100) ?? null, detalle: detalle?.slice(0, 500) ?? null
  })
}

// ---------------- Planes de Flow ----------------
type Fila = {
  empresa_id: string; nivel: string; periodo: string; estado: string
  flow_customer_id: string | null; flow_subscription_id: string | null; flow_plan_id: string | null
}

/** Precio vigente del catálogo para un nivel y período. */
async function precioVigente(nivel: string, periodo: string): Promise<{ monto: number; nombre: string } | null> {
  const { data } = await admin.from('niveles_plan').select('nombre, precio_mensual, precio_anual').eq('nivel', nivel).maybeSingle()
  const monto = periodo === 'mensual' ? data?.precio_mensual : data?.precio_anual
  return data && monto ? { monto, nombre: data.nombre } : null
}

/** Crea el plan en Flow si no existe (el id lleva el precio: un precio nuevo es un plan nuevo). */
async function asegurarPlan(planId: string, nombre: string, monto: number, periodo: string) {
  try {
    await flow('GET', '/plans/get', { planId })
    return
  } catch (e) {
    if (!(e instanceof ErrorFlow)) throw e
  }
  await flow('POST', '/plans/create', {
    planId, name: nombre, amount: monto, currency: 'CLP', interval: periodo === 'anual' ? 4 : 3,
    interval_count: 1, trial_period_days: 0, days_until_due: 3, charges_retries_number: 3,
    urlCallback: `${URL_FUNCION}?accion=cobro`
  })
}

// ---------------- Sincronización con Flow ----------------
function estadoDeInvoice(i: any): 'pendiente' | 'pagado' | 'fallido' | 'anulado' {
  if (i.status === 1) return 'pagado'
  if (i.status === 2) return 'anulado'
  return i.error === 1 || (i.attemp_count ?? 0) > 0 ? 'fallido' : 'pendiente'
}

/** Refleja en la base lo que Flow dice de una suscripción: importes, estado y próximo cobro. */
async function sincronizar(subId: string): Promise<string> {
  const s = await flow('GET', '/subscription/get', { subscriptionId: subId })
  const importes = [...(s.invoices ?? [])].sort((a: any, b: any) => a.id - b.id)
  let aplicados = 0
  for (const i of importes) {
    // El período es inclusivo: un día más para que el acceso llegue hasta el siguiente cobro
    const desde = fechaFlow(i.period_start)
    const hasta = fechaFlow(i.period_end, 1)
    if (!desde || !hasta || hasta <= desde) {
      await evento('sincronizacion', 'ignorado', null, subId, `Importe ${i.id} con fechas inválidas`)
      continue
    }
    const { data, error } = await admin.rpc('flow_registrar_cobro', {
      p_subscription: subId, p_invoice: i.id, p_monto: Math.round(Number(i.amount) || 0),
      p_desde: desde, p_hasta: hasta, p_estado: estadoDeInvoice(i), p_intentos: i.attemp_count ?? 0,
      p_error: i.error === 1 ? (i.errorDescription ?? 'Cobro rechazado') : null,
      p_orden: i.payment?.flowOrder ?? null
    })
    if (error) { await evento('sincronizacion', 'error', null, subId, `Importe ${i.id}: ${error.message}`); continue }
    if (data?.aplicado) aplicados++
  }
  const estado = s.status === 4 ? 'cancelada' : s.morose === 1 ? 'morosa' : 'activa'
  const { error } = await admin.rpc('flow_sincronizar_suscripcion', {
    p_subscription: subId, p_estado: estado, p_proximo: fechaFlow(s.next_invoice_date),
    p_cancela_al_vencer: s.cancel_at_period_end === 1
  })
  if (error) throw new ErrorFlow(error.message)
  return `${estado}, ${importes.length} importes, ${aplicados} aplicados`
}

/** Si el precio del catálogo cambió, mueve la suscripción al plan nuevo (rige para todas). */
async function reconciliarPrecio(f: Fila) {
  if (!f.flow_subscription_id || !['activa', 'morosa'].includes(f.estado)) return
  const p = await precioVigente(f.nivel, f.periodo)
  if (!p) return
  const deseado = `msp-${f.nivel}-${f.periodo}-${p.monto}`
  if (f.flow_plan_id === deseado) return
  await asegurarPlan(deseado, `Mi Socio Pyme · ${p.nombre} ${f.periodo}`, p.monto, f.periodo)
  await flow('POST', '/subscription/changePlan', { subscriptionId: f.flow_subscription_id, newPlanId: deseado })
  const { error } = await admin.rpc('flow_actualizar_plan', { p_subscription: f.flow_subscription_id, p_plan: deseado })
  if (error) throw new ErrorFlow(error.message)
}

/** Recorre las suscripciones (todas, o solo las que tocan cobro pronto). */
async function sincronizarVarias(soloPendientes: boolean): Promise<{ revisadas: number; errores: number }> {
  let q = admin.from('suscripciones_flow')
    .select('empresa_id, nivel, periodo, estado, flow_customer_id, flow_subscription_id, flow_plan_id, proximo_cobro')
    .in('estado', ['activa', 'morosa']).not('flow_subscription_id', 'is', null).limit(300)
  if (soloPendientes) {
    q = q.or(`estado.eq.morosa,proximo_cobro.is.null,proximo_cobro.lte.${new Date(Date.now() + 86400000).toISOString()}`)
  }
  const { data } = await q
  let errores = 0
  for (const f of (data ?? []) as Fila[]) {
    try {
      await reconciliarPrecio(f)
      await sincronizar(f.flow_subscription_id!)
    } catch (e) {
      errores++
      await evento('sincronizacion', 'error', f.empresa_id, f.flow_subscription_id, (e as Error).message)
    }
  }
  return { revisadas: data?.length ?? 0, errores }
}

// ---------------- Acciones de la persona usuaria ----------------
async function perfilAdmin(req: Request, empresaPedida: string | undefined) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return { error: 'No autorizado', status: 401 }
  const { data: u, error } = await admin.auth.getUser(token)
  if (error || !u.user) return { error: 'Sesión inválida', status: 401 }
  const { data: p } = await admin.from('profiles')
    .select('id, email, es_owner, role, empresa_id, activo').eq('id', u.user.id).maybeSingle()
  if (!p?.activo) return { error: 'Cuenta inactiva', status: 403 }
  const empresa = p.es_owner ? empresaPedida : p.empresa_id
  if (!empresa) return { error: 'Indica la empresa', status: 400 }
  if (!p.es_owner && p.role !== 'admin') return { error: 'Solo el administrador de la empresa puede gestionar la suscripción', status: 403 }
  return { perfil: p, empresa: empresa as string }
}

async function contratar(req: Request, b: any): Promise<Response> {
  const a = await perfilAdmin(req, b.empresa_id)
  if ('error' in a) return json(req, { error: a.error }, a.status)
  if (!NIVELES.includes(b.nivel) || !PERIODOS.includes(b.periodo)) return json(req, { error: 'Plan o período inválido' }, 400)

  const { data: prep, error } = await admin.rpc('flow_preparar_suscripcion', {
    p_empresa: a.empresa, p_actor: a.perfil.id, p_nivel: b.nivel, p_periodo: b.periodo
  })
  if (error) return json(req, { error: error.message }, 400)

  try {
    await asegurarPlan(prep.flow_plan_id, `Mi Socio Pyme · ${prep.nivel_nombre} ${prep.periodo}`, prep.monto, prep.periodo)
    let cliente: string | null = prep.flow_customer_id
    if (!cliente) {
      const c = await flow('POST', '/customer/create', {
        name: prep.empresa_nombre, email: a.perfil.email, externalId: a.empresa
      })
      cliente = c.customerId as string
      const { error: e2 } = await admin.rpc('flow_guardar_cliente', { p_empresa: a.empresa, p_customer: cliente })
      if (e2) throw new ErrorFlow(e2.message)
    }
    const r = await flow('POST', '/customer/register', { customerId: cliente!, url_return: `${URL_FUNCION}?accion=retorno` })
    return json(req, { url: `${r.url}?token=${r.token}` })
  } catch (e) {
    await evento('tarjeta', 'error', a.empresa, null, (e as Error).message)
    return json(req, { error: 'No se pudo iniciar el registro de la tarjeta. Intenta de nuevo en unos minutos.' }, 502)
  }
}

async function cancelar(req: Request, b: any): Promise<Response> {
  const a = await perfilAdmin(req, b.empresa_id)
  if ('error' in a) return json(req, { error: a.error }, a.status)
  const { data: f } = await admin.from('suscripciones_flow')
    .select('estado, flow_subscription_id').eq('empresa_id', a.empresa).maybeSingle()
  if (!f || f.estado === 'cancelada') return json(req, { error: 'No hay una suscripción para cancelar' }, 400)
  if (f.estado === 'pendiente_tarjeta' || !f.flow_subscription_id) {
    await admin.from('suscripciones_flow').update({ estado: 'cancelada', updated_at: new Date().toISOString() }).eq('empresa_id', a.empresa)
    return json(req, { ok: true })
  }
  try {
    // Al terminar el período pagado: el acceso se conserva hasta el vencimiento
    await flow('POST', '/subscription/cancel', { subscriptionId: f.flow_subscription_id, at_period_end: 1 })
    await sincronizar(f.flow_subscription_id)
    await evento('cancelacion', 'ok', a.empresa, f.flow_subscription_id)
    return json(req, { ok: true })
  } catch (e) {
    await evento('cancelacion', 'error', a.empresa, f.flow_subscription_id, (e as Error).message)
    return json(req, { error: 'No se pudo cancelar la suscripción. Intenta de nuevo.' }, 502)
  }
}

// ---------------- Llamadas de Flow (sin sesión) ----------------
const volver = (resultado: string) =>
  new Response(null, { status: 303, headers: { Location: `${APP_URL}/configuracion?suscripcion=${resultado}` } })

/** Flow devuelve al cliente (POST con `token`) tras registrar la tarjeta. */
async function retorno(req: Request): Promise<Response> {
  let token = ''
  try { token = String((await req.formData()).get('token') ?? '') } catch { /* sin cuerpo */ }
  if (!token || token.length > 200) return volver('error')
  try {
    const r = await flow('GET', '/customer/getRegisterStatus', { token })
    if (String(r.status) !== '1') { await evento('tarjeta', 'ignorado', null, r.customerId, 'Tarjeta no registrada'); return volver('rechazada') }
    const { data: f } = await admin.from('suscripciones_flow')
      .select('empresa_id, nivel, periodo, estado, flow_subscription_id, flow_plan_id')
      .eq('flow_customer_id', r.customerId).maybeSingle()
    if (!f) { await evento('tarjeta', 'ignorado', null, r.customerId, 'Cliente sin contrato'); return volver('error') }
    // Aviso repetido o suscripción ya creada: no crear una segunda (cobraría dos veces)
    if (f.estado !== 'pendiente_tarjeta' || f.flow_subscription_id) { await evento('tarjeta', 'ignorado', f.empresa_id, r.customerId, 'Aviso repetido'); return volver('ok') }

    const sub = await flow('POST', '/subscription/create', { planId: f.flow_plan_id!, customerId: r.customerId })
    const { error } = await admin.rpc('flow_activar_suscripcion', {
      p_customer: r.customerId, p_subscription: sub.subscriptionId,
      p_marca: r.creditCardType ?? '', p_ultimos4: r.last4CardDigits ?? '', p_proximo: fechaFlow(sub.next_invoice_date)
    })
    if (error) {
      // Carrera con otro aviso: no dejar una suscripción huérfana que siga cobrando
      await flow('POST', '/subscription/cancel', { subscriptionId: sub.subscriptionId, at_period_end: 0 }).catch(() => {})
      await evento('tarjeta', 'error', f.empresa_id, sub.subscriptionId, error.message)
      return volver('error')
    }
    await evento('tarjeta', 'ok', f.empresa_id, sub.subscriptionId)
    // El primer cobro suele estar listo al instante; si no, lo recoge el aviso o la tarea diaria
    await sincronizar(sub.subscriptionId).catch((e) => evento('sincronizacion', 'error', f.empresa_id, sub.subscriptionId, (e as Error).message))
    return volver('ok')
  } catch (e) {
    await evento('tarjeta', 'error', null, null, (e as Error).message)
    return volver('error')
  }
}

/** Aviso de cobro del plan. Flow no documenta su contenido: se ignora y se consulta a Flow. */
async function avisoCobro(): Promise<Response> {
  const hace = new Date(Date.now() - 30_000).toISOString()
  const { count } = await admin.from('eventos_flow').select('id', { count: 'exact', head: true })
    .eq('tipo', 'cobro').gte('created_at', hace)
  if ((count ?? 0) > 0) return new Response('ok')
  const r = await sincronizarVarias(true)
  await evento('cobro', r.errores ? 'error' : 'ok', null, null, `${r.revisadas} revisadas, ${r.errores} con error`)
  return new Response('ok')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Método no permitido' }, 405)
  if (!APP_URL) return json(req, { error: 'Falta configurar APP_URL' }, 500)

  const accion = new URL(req.url).searchParams.get('accion')
  if (accion === 'retorno') return await retorno(req)
  if (accion === 'cobro') return await avisoCobro()

  if (accion === 'sincronizar') {
    let autorizado = iguales(req.headers.get('x-sync-secret') ?? '', SYNC_SECRET)
    if (!autorizado) {
      const token = req.headers.get('Authorization')?.replace('Bearer ', '')
      const { data: u } = token ? await admin.auth.getUser(token) : { data: { user: null } }
      const { data: p } = u.user ? await admin.from('profiles').select('es_owner, activo').eq('id', u.user.id).maybeSingle() : { data: null }
      autorizado = p?.es_owner === true && p.activo === true
    }
    if (!autorizado) return json(req, { error: 'No autorizado' }, 401)
    const r = await sincronizarVarias(false)
    await evento('sincronizacion', r.errores ? 'error' : 'ok', null, null, `${r.revisadas} revisadas, ${r.errores} con error`)
    return json(req, r)
  }

  let b: any = {}
  try { b = await req.json() } catch { return json(req, { error: 'Solicitud inválida' }, 400) }
  if (b.accion === 'contratar') return await contratar(req, b)
  if (b.accion === 'cancelar') return await cancelar(req, b)
  return json(req, { error: 'Acción desconocida' }, 400)
})
