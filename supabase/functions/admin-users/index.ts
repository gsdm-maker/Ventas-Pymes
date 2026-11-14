// ============================================================
// Mi Socio Pyme · Edge Function `admin-users`
// Usada por:
//   - ADMINISTRADOR GENERAL (es_owner): crear empresas, planes y owners.
//   - ADMINISTRADOR DE EMPRESA (role = 'admin' + empresa_id): crear y
//     gestionar cuentas de SU empresa (clave temporal, activar/desactivar).
// Aislamiento: un admin de empresa solo opera dentro de su empresa, sobre
// cuentas que no sean de otro administrador, y solo si conserva el permiso
// `usuarios.gestionar` y la empresa está vigente.
// Todo con service_role (salta RLS): el aislamiento se reimplementa aquí.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Alfabeto sin caracteres confundibles (0/O, 1/l/I)
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
function claveTemporal(): string {
  const grupos: string[] = []
  for (let g = 0; g < 3; g++) {
    let s = ''
    const bytes = new Uint8Array(4)
    crypto.getRandomValues(bytes)
    for (let i = 0; i < 4; i++) s += ALFABETO[bytes[i] % ALFABETO.length]
    grupos.push(s)
  }
  return grupos.join('-')
}

// Espejo de MODULOS en src/core/auth/capabilities.ts (la base lo valida con un CHECK)
const MODULOS = [
  'dashboard', 'pos', 'mesas', 'cocina', 'salidas', 'ingreso', 'inventario', 'productos',
  'bodega', 'movimientos', 'reportes', 'usuarios', 'configuracion'
]
const RUBROS = ['retail', 'restaurante', 'mixto']
// Espejo de planes_ia (migración 0023)
const PLANES_IA = ['basico', 'pro', 'max']
// Planes de suscripción (migración 0025)
const PLANES = ['prueba', 'mensual', 'anual', 'dueno']
// Niveles de plan (migración 0027): Socio · Socio Pro · Socio Pro Max · A medida
const NIVELES = ['s', 'm', 'l', 'medida']
// La prueba muestra Socio Pro (decidido 14-11-2026)
const NIVEL_PRUEBA = 'm'
// El plan manda: módulos y asistente solo se ajustan a mano en «A medida» (o en empresas
// antiguas sin nivel, para no dejarlas trabadas hasta que se les asigne uno)
const seAjustaAMano = (nivel: string | null) => nivel === null || nivel === 'medida'
const SOLO_A_MEDIDA = 'Los módulos y el asistente los fija el plan. Para ajustarlos a mano, pasa la empresa a «A medida».'

/** Tope opcional para «a medida»: null = sin límite; undefined = valor inválido. */
function topeOpcional(valor: unknown): number | null | undefined {
  if (valor === undefined || valor === null || valor === '') return null
  const n = Number(valor)
  return Number.isInteger(n) && n >= 1 && n <= 1000000 ? n : undefined
}

/** Errores de tope de plan (hint «tope_plan:…» de la base): son del usuario, no del servidor. */
function esErrorDeTope(error: { hint?: string | null } | null): boolean {
  return Boolean(error?.hint?.startsWith('tope_plan:'))
}

/** Espejo de _plan_vigente() (0025) y estadoPlan() del front. */
function planVigente(e: {
  plan: string
  prueba_hasta: string | null
  plan_vence: string | null
  dias_gracia: number | null
}): boolean {
  const ahora = Date.now()
  if (e.plan === 'dueno') return true
  if (e.plan === 'prueba') return !e.prueba_hasta || new Date(e.prueba_hasta).getTime() > ahora
  if (e.plan === 'mensual' || e.plan === 'anual') {
    if (!e.plan_vence) return false
    return new Date(e.plan_vence).getTime() + (e.dias_gracia ?? 0) * 86400000 > ahora
  }
  return false
}

/** Fecha YYYY-MM-DD opcional: undefined si no viene, null si es inválida. */
function fechaOpcional(valor: unknown): string | undefined | null {
  if (valor === undefined || valor === null || valor === '') return undefined
  const s = String(valor)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null
}

/** Precio en CLP (entero, 0 a 100 millones). null si es inválido. */
const PRECIO_MAX = 100_000_000
function precioValido(valor: unknown): number | null {
  if (valor === undefined || valor === null || valor === '') return null
  return enteroEntre(valor, 0, PRECIO_MAX)
}

function enteroEntre(valor: unknown, min: number, max: number): number | null {
  const n = Number(valor)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

function modulosValidos(valor: unknown): string[] | null {
  if (!Array.isArray(valor)) return null
  const lista = [...new Set(valor.map(String))]
  return lista.every((m) => MODULOS.includes(m)) ? lista : null
}

function esEmailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  // 1) Autorización: token de usuario + perfil Owner o Admin de empresa
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return json({ error: 'No autorizado' }, 401)
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData.user) return json({ error: 'Sesión inválida' }, 401)

  const { data: perfil } = await admin
    .from('profiles')
    .select('id, es_owner, role, empresa_id, activo, permissions')
    .eq('id', userData.user.id)
    .single()

  if (!perfil?.activo) {
    return json({ error: 'Cuenta inactiva' }, 403)
  }

  const esAdminGeneral = perfil.es_owner === true
  const permisos = (perfil.permissions ?? {}) as Record<string, boolean>
  const esAdminEmpresa =
    perfil.role === 'admin' && !!perfil.empresa_id && permisos['usuarios.gestionar'] !== false
  if (!esAdminGeneral && !esAdminEmpresa) {
    return json({ error: 'No autorizado para administrar cuentas' }, 403)
  }

  if (!esAdminGeneral) {
    const { data: emp } = await admin
      .from('empresas')
      .select('plan, prueba_hasta, plan_vence, dias_gracia')
      .eq('id', perfil.empresa_id)
      .single()
    if (!emp || !planVigente(emp)) {
      return json({
        error: emp?.plan === 'prueba'
          ? 'El período de prueba de la empresa terminó'
          : 'La suscripción de la empresa está vencida'
      }, 403)
    }
  }

  const empresaRestringida = esAdminGeneral ? null : perfil.empresa_id

  type Objetivo = { id: string; email: string; empresa_id: string | null; role: string; es_owner: boolean }
  async function perfilObjetivo(userId: string): Promise<Objetivo | null> {
    if (!userId) return null
    const { data } = await admin
      .from('profiles')
      .select('id, email, empresa_id, role, es_owner')
      .eq('id', userId)
      .maybeSingle()
    return (data as Objetivo | null) ?? null
  }

  // Reglas comunes para operar sobre otra cuenta (activar/desactivar, clave)
  function validarObjetivo(obj: Objetivo | null): Response | null {
    if (!obj || !obj.empresa_id) return json({ error: 'Usuario inexistente' }, 400)
    if (obj.es_owner) return json({ error: 'No se puede modificar al administrador general' }, 400)
    if (!puedeOperarEnEmpresa(obj.empresa_id)) return json({ error: 'No autorizado' }, 403)
    if (!esAdminGeneral && obj.id === perfil.id) {
      return json({ error: 'No puedes aplicar esta acción sobre tu propia cuenta' }, 400)
    }
    if (!esAdminGeneral && obj.role === 'admin') {
      return json({ error: 'Solo el administrador general puede modificar a otro administrador' }, 403)
    }
    return null
  }

  function resolverEmpresaId(empresaIdSolicitada: string): string | null {
    if (esAdminGeneral) return empresaIdSolicitada || null
    return empresaRestringida ?? null
  }

  function puedeOperarEnEmpresa(empresaId: string | null): boolean {
    if (esAdminGeneral) return true
    return !!empresaId && empresaId === empresaRestringida
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Cuerpo inválido' }, 400)
  }

  const accion = String(payload.accion || '')
  const auditar = (empresaId: string | null, detalle: Record<string, unknown>) =>
    admin.from('admin_auditoria').insert({
      actor_id: perfil.id,
      accion,
      objetivo_id: null,
      detalle,
      empresa_id: empresaId
    })

  try {
    switch (accion) {
      // ---------- Crear empresa + Admin, con período de prueba (solo Owner) ----------
      case 'crear_empresa': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const nombre = String(payload.nombre || '').trim()
        const plan = String(payload.plan || 'prueba')
        const dias = Number(payload.prueba_dias ?? 15)
        const inicio = fechaOpcional(payload.inicio)
        // Rubro: retail | restaurante | mixto. Los módulos y el asistente los fija el nivel
        // (aplicar_nivel o, con anual, el trigger); esta lista es solo el punto de partida
        const tipoNegocio = RUBROS.includes(String(payload.tipo_negocio)) ? String(payload.tipo_negocio) : 'retail'
        const modulos = MODULOS.filter((m) => tipoNegocio !== 'retail' || (m !== 'mesas' && m !== 'cocina'))
        const adminEmail = String(payload.admin_email || '').trim().toLowerCase()
        const adminNombre = String(payload.admin_nombre || '').trim()
        if (!nombre) return json({ error: 'Falta el nombre de la empresa' }, 400)
        if (!esEmailValido(adminEmail)) return json({ error: 'Correo de admin inválido' }, 400)
        if (!PLANES.includes(plan)) return json({ error: 'Plan inválido' }, 400)
        if (plan === 'prueba' && (!Number.isInteger(dias) || dias < 1 || dias > 365)) {
          return json({ error: 'Los días de prueba van de 1 a 365' }, 400)
        }
        if (inicio === null) return json({ error: 'Fecha de alta inválida' }, 400)
        // «medida» se configura después de crear la empresa (con sus topes)
        const nivel = payload.nivel === undefined ? NIVEL_PRUEBA : String(payload.nivel)
        if (!['s', 'm', 'l'].includes(nivel)) return json({ error: 'Nivel inválido' }, 400)

        const { data: empresa, error: empErr } = await admin
          .from('empresas')
          .insert({ nombre, plan: 'prueba', prueba_hasta: null, modulos, tipo_negocio: tipoNegocio })
          .select()
          .single()
        if (empErr) throw empErr
        // El plan (vencimiento o pago inicial) lo fija la misma regla que al cambiarlo
        const { error: planErr } = await admin.rpc('cambiar_plan_empresa', {
          p_empresa: empresa.id,
          p_plan: plan,
          p_actor: perfil.id,
          p_prueba_dias: plan === 'prueba' ? dias : 15,
          p_inicio: inicio ?? null
        })
        if (planErr) {
          await admin.from('empresas').delete().eq('id', empresa.id)
          return json({ error: planErr.message }, 400)
        }
        // Nivel: el anual ya quedó en Socio Pro Max (trigger de la base); si no, el pedido
        // o Socio Pro (lo que muestra la prueba)
        if (plan !== 'anual') {
          const { error: nivelErr } = await admin.rpc('aplicar_nivel', {
            p_empresa: empresa.id,
            p_nivel: nivel,
            p_max_productos: null,
            p_max_ubicaciones: null,
            p_max_usuarios: null
          })
          if (nivelErr) {
            await admin.from('empresas').delete().eq('id', empresa.id)
            return json({ error: nivelErr.message }, 400)
          }
        }

        // Admin de la empresa
        const clave = claveTemporal()
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email: adminEmail,
          password: clave,
          email_confirm: true,
          user_metadata: { nombre: adminNombre || adminEmail, must_change_password: true }
        })
        if (cErr || !created.user) {
          await admin.from('empresas').delete().eq('id', empresa.id)
          throw cErr ?? new Error('No se pudo crear el administrador')
        }
        const { error: profErr } = await admin
          .from('profiles')
          .update({
            empresa_id: empresa.id,
            role: 'admin',
            puesto: 'admin',
            nombre: adminNombre || adminEmail,
            must_change_password: true
          })
          .eq('id', created.user.id)
        if (profErr) {
          await admin.auth.admin.deleteUser(created.user.id)
          await admin.from('empresas').delete().eq('id', empresa.id)
          throw profErr
        }

        await auditar(empresa.id, {
          nombre,
          plan,
          prueba_dias: plan === 'prueba' ? dias : null,
          inicio,
          nivel: plan === 'anual' ? 'l' : nivel,
          admin_email: adminEmail,
          tipo_negocio: tipoNegocio
        })
        return json({ ok: true, empresa, admin_email: adminEmail, clave_temporal: clave })
      }

      // ---------- Crear usuario dentro de una empresa ----------
      case 'crear_usuario': {
        const empresaId = resolverEmpresaId(String(payload.empresa_id || ''))
        if (!empresaId) return json({ error: 'Falta la empresa' }, 400)
        if (!puedeOperarEnEmpresa(empresaId)) return json({ error: 'No puedes administrar esta empresa' }, 403)
        if (payload.es_owner === true) return json({ error: 'No autorizado' }, 403)

        const email = String(payload.email || '').trim().toLowerCase()
        const nombre = String(payload.nombre || '').trim()
        const role = payload.role === 'admin' ? 'admin' : 'integrante'
        const puesto = ['admin', 'bodega', 'tienda', 'auditor'].includes(String(payload.puesto))
          ? String(payload.puesto)
          : 'tienda'
        const ubicaciones = Array.isArray(payload.ubicaciones)
          ? [...new Set((payload.ubicaciones as unknown[]).map(String))]
          : []
        // Ajustes sobre los permisos del puesto (suma o revoca); la base valida que sean
        // capacidades conocidas y que quien crea la cuenta no otorgue lo que no tiene
        const permissions =
          payload.permissions && typeof payload.permissions === 'object' && !Array.isArray(payload.permissions)
            ? (payload.permissions as Record<string, unknown>)
            : {}

        const { data: empresa } = await admin.from('empresas').select('id').eq('id', empresaId).single()
        if (!empresa) return json({ error: 'Empresa inexistente' }, 400)
        if (!esEmailValido(email)) return json({ error: 'Correo inválido' }, 400)

        const { data: rechazo, error: vErr } = await admin.rpc('validar_permisos_nuevos', {
          p_actor: perfil.id,
          p_empresa: empresaId,
          p_role: role,
          p_puesto: puesto,
          p_permisos: permissions
        })
        if (vErr) throw vErr
        if (rechazo) return json({ error: rechazo }, 403)

        // Topes del nivel (la base los vuelve a exigir con un trigger): se revisan antes de
        // crear la cuenta de Auth para no dejar cuentas a medio crear
        const { data: topes, error: tErr } = await admin.rpc('_topes_empresa', { p_emp: empresaId })
        if (tErr) throw tErr
        const tope = (topes as Array<{ nivel: string | null; nombre: string; max_usuarios: number | null; permisos_a_medida: boolean }> | null)?.[0]
        if (tope?.nivel) {
          if (!tope.permisos_a_medida && Object.keys(permissions).length > 0) {
            return json({ error: `Tu plan ${tope.nombre} no incluye permisos a medida por usuario: se usan los del puesto. Para ajustarlos, sube de plan.`, tope: 'permisos' }, 400)
          }
          if (tope.max_usuarios !== null) {
            const { count, error: nErr } = await admin
              .from('profiles')
              .select('id', { count: 'exact', head: true })
              .eq('empresa_id', empresaId)
              .eq('activo', true)
              .eq('es_owner', false)
            if (nErr) throw nErr
            if ((count ?? 0) >= tope.max_usuarios) {
              return json({ error: `Tu plan ${tope.nombre} permite hasta ${tope.max_usuarios} ${tope.max_usuarios === 1 ? 'usuario' : 'usuarios'}. Para agregar más, sube de plan.`, tope: 'usuarios' }, 400)
            }
          }
        }

        // Las ubicaciones autorizadas deben ser de la misma empresa
        if (ubicaciones.length) {
          const { data: validas, error: uErr } = await admin
            .from('ubicaciones')
            .select('id')
            .eq('empresa_id', empresaId)
            .in('id', ubicaciones)
          if (uErr || (validas ?? []).length !== ubicaciones.length) {
            return json({ error: 'Alguna ubicación no pertenece a la empresa' }, 400)
          }
        }

        const clave = claveTemporal()
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email,
          password: clave,
          email_confirm: true,
          user_metadata: { nombre: nombre || email, must_change_password: true }
        })
        if (cErr || !created.user) {
          return json({ error: `No se pudo crear el usuario: ${cErr?.message ?? ''}` }, 400)
        }

        const { error: profErr } = await admin
          .from('profiles')
          .update({ empresa_id: empresaId, role, puesto, permissions, nombre: nombre || email, must_change_password: true })
          .eq('id', created.user.id)
        if (profErr) {
          await admin.auth.admin.deleteUser(created.user.id)
          if (esErrorDeTope(profErr)) return json({ error: profErr.message, tope: profErr.hint!.slice(10) }, 400)
          return json({ error: `No se pudo asignar la cuenta: ${profErr.message}` }, 500)
        }

        if (ubicaciones.length) {
          const { error: accErr } = await admin.from('ubicacion_acceso').insert(
            ubicaciones.map((u) => ({ user_id: created.user.id, ubicacion_id: u, empresa_id: empresaId }))
          )
          if (accErr) {
            // Sin sus restricciones la cuenta vería todas las ubicaciones: se deshace
            await admin.auth.admin.deleteUser(created.user.id)
            return json({ error: `No se pudieron asignar las ubicaciones: ${accErr.message}` }, 500)
          }
        }
        await auditar(empresaId, { email, role, puesto, permissions, ubicaciones })
        return json({ ok: true, email, clave_temporal: clave })
      }

      // ---------- Cambiar plan (solo Owner) ----------
      // prueba: N días · mensual/anual: desde la fecha de alta, ciclo en curso pagado · dueno: pago único
      case 'actualizar_plan': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const empresaId = String(payload.empresa_id || '')
        const plan = String(payload.plan || '')
        if (!PLANES.includes(plan)) return json({ error: 'Plan inválido' }, 400)
        const dias = Number(payload.prueba_dias ?? 15)
        if (plan === 'prueba' && (!Number.isInteger(dias) || dias < 1 || dias > 365)) {
          return json({ error: 'Los días de prueba van de 1 a 365' }, 400)
        }
        const inicio = fechaOpcional(payload.inicio)
        if (inicio === null) return json({ error: 'Fecha de alta inválida' }, 400)
        const nota = String(payload.nota ?? '').trim().slice(0, 200) || null
        const { data: antes } = await admin
          .from('empresas')
          .select('plan, prueba_hasta, plan_inicio, plan_vence')
          .eq('id', empresaId)
          .maybeSingle()
        if (!antes) return json({ error: 'Empresa inexistente' }, 400)
        const { data, error } = await admin.rpc('cambiar_plan_empresa', {
          p_empresa: empresaId,
          p_plan: plan,
          p_actor: perfil.id,
          p_prueba_dias: plan === 'prueba' ? dias : 15,
          p_inicio: inicio ?? null,
          p_nota: nota
        })
        if (error) return json({ error: error.message }, 400)
        await auditar(empresaId, { antes, plan, prueba_dias: plan === 'prueba' ? dias : null, inicio, resultado: data })
        return json({ ok: true, ...(data as Record<string, unknown>) })
      }

      // ---------- Registrar el pago de un período mensual o anual (solo Owner) ----------
      case 'registrar_pago': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const empresaId = String(payload.empresa_id || '')
        const nota = String(payload.nota ?? '').trim().slice(0, 200) || null
        const { data, error } = await admin.rpc('registrar_pago_plan', {
          p_empresa: empresaId,
          p_actor: perfil.id,
          p_nota: nota
        })
        if (error) return json({ error: error.message }, 400)
        await auditar(empresaId, { nota, ...(data as Record<string, unknown>) })
        return json({ ok: true, ...(data as Record<string, unknown>) })
      }

      // ---------- Días de gracia y alertas de vencimiento (solo Owner) ----------
      case 'configurar_avisos': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const empresaId = String(payload.empresa_id || '')
        const diasGracia = enteroEntre(payload.dias_gracia, 0, 60)
        const avisoDias = enteroEntre(payload.aviso_dias_antes, 0, 90)
        const avisoHoras = enteroEntre(payload.aviso_cada_horas, 1, 720)
        if (diasGracia === null) return json({ error: 'Los días de gracia van de 0 a 60' }, 400)
        if (avisoDias === null) return json({ error: 'Los días de aviso van de 0 a 90' }, 400)
        if (avisoHoras === null) return json({ error: 'La frecuencia va de 1 a 720 horas' }, 400)
        const { data: antes } = await admin
          .from('empresas')
          .select('dias_gracia, aviso_dias_antes, aviso_cada_horas')
          .eq('id', empresaId)
          .maybeSingle()
        if (!antes) return json({ error: 'Empresa inexistente' }, 400)
        const cambios = { dias_gracia: diasGracia, aviso_dias_antes: avisoDias, aviso_cada_horas: avisoHoras }
        const { error } = await admin.from('empresas').update(cambios).eq('id', empresaId)
        if (error) throw error
        await auditar(empresaId, { antes, ...cambios })
        return json({ ok: true })
      }

      // ---------- Plan del asistente IA de una empresa (solo Owner) ----------
      case 'actualizar_plan_ia': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const empresaId = String(payload.empresa_id || '')
        const planIa = payload.plan_ia === null ? null : String(payload.plan_ia || '')
        if (planIa !== null && !PLANES_IA.includes(planIa)) return json({ error: 'Plan de asistente inválido' }, 400)
        const { data: antes } = await admin.from('empresas').select('plan_ia, nivel').eq('id', empresaId).maybeSingle()
        if (!antes) return json({ error: 'Empresa inexistente' }, 400)
        if (!seAjustaAMano(antes.nivel)) return json({ error: SOLO_A_MEDIDA }, 400)
        const { error } = await admin.from('empresas').update({ plan_ia: planIa }).eq('id', empresaId)
        if (error) throw error
        await auditar(empresaId, { antes: antes.plan_ia, plan_ia: planIa })
        return json({ ok: true })
      }

      // ---------- Topes diarios de un plan del asistente IA (solo Owner) ----------
      case 'actualizar_planes_ia': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const plan = String(payload.plan || '')
        if (!PLANES_IA.includes(plan)) return json({ error: 'Plan de asistente inválido' }, 400)
        const empresaDia = Number(payload.mensajes_dia_empresa)
        // Por persona: null = sin límite individual (solo cuenta la bolsa de la empresa)
        const sinLimite = payload.mensajes_dia_usuario === null || payload.mensajes_dia_usuario === ''
        const usuarioDia = sinLimite ? null : Number(payload.mensajes_dia_usuario)
        const entero = (n: number) => Number.isInteger(n) && n >= 1 && n <= 100000
        if (!entero(empresaDia) || (usuarioDia !== null && !entero(usuarioDia))) {
          return json({ error: 'Los topes deben ser números enteros entre 1 y 100.000' }, 400)
        }
        if (usuarioDia !== null && usuarioDia > empresaDia) {
          return json({ error: 'El tope por persona no puede superar el de la empresa' }, 400)
        }
        const cambios = {
          mensajes_dia_empresa: empresaDia,
          mensajes_dia_usuario: usuarioDia
        }
        const { data: antes } = await admin.from('planes_ia').select('*').eq('plan', plan).maybeSingle()
        if (!antes) return json({ error: 'Plan inexistente' }, 400)
        const { error } = await admin.from('planes_ia').update(cambios).eq('plan', plan)
        if (error) throw error
        await auditar(null, { plan, antes, ...cambios })
        return json({ ok: true })
      }

      // ---------- Rubro (solo Owner) ----------
      // Con nivel estándar la base recalcula los módulos del nivel para el rubro nuevo;
      // con «medida» o sin nivel solo suma o quita Mesas y Cocina
      case 'actualizar_rubro': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const empresaId = String(payload.empresa_id || '')
        const tipoNegocio = String(payload.tipo_negocio || '')
        if (!RUBROS.includes(tipoNegocio)) return json({ error: 'Rubro inválido' }, 400)
        const { data: antes } = await admin
          .from('empresas')
          .select('tipo_negocio, modulos')
          .eq('id', empresaId)
          .maybeSingle()
        if (!antes) return json({ error: 'Empresa inexistente' }, 400)
        const { data, error } = await admin.rpc('cambiar_rubro', { p_empresa: empresaId, p_rubro: tipoNegocio })
        if (error) return json({ error: error.message }, 400)
        await auditar(empresaId, { antes, tipo_negocio: tipoNegocio, modulos: data })
        return json({ ok: true, modulos: data })
      }

      // ---------- Módulos a mano (solo Owner, solo «A medida» o sin nivel) ----------
      case 'actualizar_modulos': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const empresaId = String(payload.empresa_id || '')
        const modulos = modulosValidos(payload.modulos)
        if (!modulos || modulos.length === 0) return json({ error: 'Módulos inválidos' }, 400)
        const { data: antes } = await admin
          .from('empresas')
          .select('modulos, nivel')
          .eq('id', empresaId)
          .maybeSingle()
        if (!antes) return json({ error: 'Empresa inexistente' }, 400)
        if (!seAjustaAMano(antes.nivel)) return json({ error: SOLO_A_MEDIDA }, 400)
        const { error } = await admin.from('empresas').update({ modulos }).eq('id', empresaId)
        if (error) throw error
        await auditar(empresaId, { antes: antes.modulos, modulos })
        return json({ ok: true })
      }

      // ---------- Nivel del plan (solo Owner) ----------
      // s/m/l copian módulos (según rubro), asistente y topes del catálogo; «medida» deja
      // módulos y asistente como estén y fija los topes indicados (vacío = sin límite)
      case 'actualizar_nivel': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const empresaId = String(payload.empresa_id || '')
        const nivel = String(payload.nivel || '')
        if (!NIVELES.includes(nivel)) return json({ error: 'Nivel inválido' }, 400)
        const maxProductos = nivel === 'medida' ? topeOpcional(payload.max_productos) : null
        const maxUbicaciones = nivel === 'medida' ? topeOpcional(payload.max_ubicaciones) : null
        const maxUsuarios = nivel === 'medida' ? topeOpcional(payload.max_usuarios) : null
        if (maxProductos === undefined || maxUbicaciones === undefined || maxUsuarios === undefined) {
          return json({ error: 'Los topes deben ser números enteros mayores que cero, o quedar vacíos' }, 400)
        }
        // Precio cotizado de «A medida»: si no viene, se conserva el que tenía
        const sinPrecio = payload.precio_medida === undefined
        const precio = nivel === 'medida' && !sinPrecio ? precioValido(payload.precio_medida) : null
        if (nivel === 'medida' && !sinPrecio && payload.precio_medida !== null && precio === null) {
          return json({ error: 'El precio debe ser un número entero en pesos' }, 400)
        }
        const { data: antes } = await admin
          .from('empresas')
          .select('nivel, modulos, plan_ia, max_productos, max_ubicaciones, max_usuarios, precio_medida')
          .eq('id', empresaId)
          .maybeSingle()
        if (!antes) return json({ error: 'Empresa inexistente' }, 400)
        const { data, error } = await admin.rpc('aplicar_nivel', {
          p_empresa: empresaId,
          p_nivel: nivel,
          p_max_productos: maxProductos,
          p_max_ubicaciones: maxUbicaciones,
          p_max_usuarios: maxUsuarios,
          p_precio: nivel === 'medida' ? (sinPrecio ? (antes.precio_medida ?? null) : precio) : null
        })
        if (error) return json({ error: error.message }, 400)
        await auditar(empresaId, { antes, resultado: data })
        return json({ ok: true, resultado: data })
      }

      // ---------- Precio de referencia de Socio / Socio Pro / Socio Pro Max (solo Owner) ----------
      case 'actualizar_precio_nivel': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const nivel = String(payload.nivel || '')
        if (!['s', 'm', 'l'].includes(nivel)) return json({ error: 'Plan inválido' }, 400)
        const mensual = precioValido(payload.precio_mensual)
        if (mensual === null) return json({ error: 'El precio mensual debe ser un número entero en pesos' }, 400)
        const sinAnual = payload.precio_anual === null || payload.precio_anual === '' || payload.precio_anual === undefined
        const anual = sinAnual ? null : precioValido(payload.precio_anual)
        if (!sinAnual && anual === null) return json({ error: 'El precio anual debe ser un número entero en pesos' }, 400)
        if (nivel === 'l' && anual === null) {
          return json({ error: 'Socio Pro Max se vende anual: indica su precio anual' }, 400)
        }
        const { data: antes } = await admin
          .from('niveles_plan')
          .select('precio_mensual, precio_anual')
          .eq('nivel', nivel)
          .maybeSingle()
        if (!antes) return json({ error: 'Plan inexistente' }, 400)
        const { error } = await admin
          .from('niveles_plan')
          .update({ precio_mensual: mensual, precio_anual: anual })
          .eq('nivel', nivel)
        if (error) throw error
        await auditar(null, { nivel, antes, precio_mensual: mensual, precio_anual: anual })
        return json({ ok: true })
      }

      // ---------- Crear un plan «A medida» para una empresa, de una vez (solo Owner) ----------
      case 'crear_a_medida': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const empresaId = String(payload.empresa_id || '')
        const modulos = modulosValidos(payload.modulos)
        if (!modulos || modulos.length === 0) return json({ error: 'Marca al menos un módulo' }, 400)
        const planIa = payload.plan_ia === null || payload.plan_ia === '' ? null : String(payload.plan_ia || '')
        if (planIa !== null && !PLANES_IA.includes(planIa)) return json({ error: 'Plan de asistente inválido' }, 400)
        const maxProductos = topeOpcional(payload.max_productos)
        const maxUbicaciones = topeOpcional(payload.max_ubicaciones)
        const maxUsuarios = topeOpcional(payload.max_usuarios)
        if (maxProductos === undefined || maxUbicaciones === undefined || maxUsuarios === undefined) {
          return json({ error: 'Los topes deben ser números enteros mayores que cero, o quedar vacíos' }, 400)
        }
        const precio = precioValido(payload.precio_medida)
        if (precio === null) return json({ error: 'Indica el precio mensual cotizado (entero en pesos)' }, 400)
        const { data: antes } = await admin
          .from('empresas')
          .select('nivel, modulos, plan_ia, max_productos, max_ubicaciones, max_usuarios, precio_medida')
          .eq('id', empresaId)
          .maybeSingle()
        if (!antes) return json({ error: 'Empresa inexistente' }, 400)
        const { data, error } = await admin.rpc('aplicar_a_medida', {
          p_empresa: empresaId,
          p_modulos: modulos,
          p_plan_ia: planIa,
          p_max_productos: maxProductos,
          p_max_ubicaciones: maxUbicaciones,
          p_max_usuarios: maxUsuarios,
          p_precio: precio
        })
        if (error) return json({ error: error.message }, 400)
        await auditar(empresaId, { antes, resultado: data, modulos, plan_ia: planIa, precio_medida: precio })
        return json({ ok: true, resultado: data })
      }

      // ---------- Activar / desactivar usuario ----------
      case 'toggle_usuario': {
        const userId = String(payload.user_id || '')
        const activo = Boolean(payload.activo)
        const objetivo = await perfilObjetivo(userId)
        const rechazo = validarObjetivo(objetivo)
        if (rechazo) return rechazo
        const { error } = await admin.from('profiles').update({ activo }).eq('id', userId)
        if (error) throw error
        await auditar(objetivo!.empresa_id, { user_id: userId, activo })
        return json({ ok: true })
      }

      // ---------- Resetear clave temporal ----------
      case 'reset_password': {
        const userId = String(payload.user_id || '')
        const objetivo = await perfilObjetivo(userId)
        const rechazo = validarObjetivo(objetivo)
        if (rechazo) return rechazo
        const clave = claveTemporal()
        const { error } = await admin.auth.admin.updateUserById(userId, {
          password: clave,
          user_metadata: { must_change_password: true }
        })
        if (error) throw error
        await admin.from('profiles').update({ must_change_password: true }).eq('id', userId)
        await auditar(objetivo!.empresa_id, { user_id: userId, accion: 'reset_password' })
        return json({ ok: true, clave_temporal: clave })
      }

      // ---------- Cambiar las ubicaciones autorizadas de una cuenta ----------
      // ubicaciones = null o [] → acceso a todas las ubicaciones de la empresa
      case 'actualizar_ubicaciones': {
        const userId = String(payload.user_id || '')
        const objetivo = await perfilObjetivo(userId)
        const rechazo = validarObjetivo(objetivo)
        if (rechazo) return rechazo
        const empresaId = objetivo!.empresa_id!
        const ubicaciones = Array.isArray(payload.ubicaciones)
          ? [...new Set((payload.ubicaciones as unknown[]).map(String))]
          : []

        if (ubicaciones.length) {
          const { data: validas, error: uErr } = await admin
            .from('ubicaciones')
            .select('id')
            .eq('empresa_id', empresaId)
            .in('id', ubicaciones)
          if (uErr || (validas ?? []).length !== ubicaciones.length) {
            return json({ error: 'Alguna ubicación no pertenece a la empresa' }, 400)
          }
          // Primero se agregan las nuevas y después se quitan las demás: la cuenta nunca
          // queda sin filas (que significaría acceso a todas) a mitad del cambio
          const { error: insErr } = await admin.from('ubicacion_acceso').upsert(
            ubicaciones.map((u) => ({ user_id: userId, ubicacion_id: u, empresa_id: empresaId })),
            { onConflict: 'user_id,ubicacion_id', ignoreDuplicates: true }
          )
          if (insErr) throw insErr
          const { error: delErr } = await admin
            .from('ubicacion_acceso')
            .delete()
            .eq('user_id', userId)
            .not('ubicacion_id', 'in', `(${ubicaciones.join(',')})`)
          if (delErr) throw delErr
        } else {
          const { error: delErr } = await admin.from('ubicacion_acceso').delete().eq('user_id', userId)
          if (delErr) throw delErr
        }

        await auditar(empresaId, { user_id: userId, ubicaciones: ubicaciones.length ? ubicaciones : 'todas' })
        return json({ ok: true, ubicaciones })
      }

      // ---------- Nombrar otro administrador general (solo Owner) ----------
      case 'nombrar_owner': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const email = String(payload.email || '').trim().toLowerCase()
        const nombre = String(payload.nombre || '').trim()
        if (!esEmailValido(email)) return json({ error: 'Correo inválido' }, 400)

        const { data: existente } = await admin
          .from('profiles')
          .select('id, es_owner')
          .eq('email', email)
          .maybeSingle()

        if (existente) {
          if (existente.es_owner) return json({ ok: true, ya_es_owner: true, email })
          const { error } = await admin
            .from('profiles')
            .update({ es_owner: true, role: 'admin', puesto: 'admin', activo: true })
            .eq('id', existente.id)
          if (error) throw error
          await auditar(null, { user_id: existente.id, es_owner: true })
          return json({ ok: true, promovido: true, email })
        }

        const clave = claveTemporal()
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email,
          password: clave,
          email_confirm: true,
          user_metadata: { nombre: nombre || email, must_change_password: true }
        })
        if (cErr || !created.user) {
          return json({ error: `No se pudo crear: ${cErr?.message ?? ''}` }, 400)
        }
        const { error: profErr } = await admin
          .from('profiles')
          .update({
            es_owner: true,
            role: 'admin',
            puesto: 'admin',
            nombre: nombre || email,
            must_change_password: true
          })
          .eq('id', created.user.id)
        if (profErr) {
          await admin.auth.admin.deleteUser(created.user.id)
          return json({ error: profErr.message }, 500)
        }
        await auditar(null, { email, es_owner: true })
        return json({ ok: true, creado: true, email, clave_temporal: clave })
      }

      // ---------- Revocar administrador general (solo Owner) ----------
      case 'revocar_owner': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const userId = String(payload.user_id || '')
        const objetivo = await perfilObjetivo(userId)
        if (!objetivo?.es_owner) return json({ error: 'El usuario no es administrador general' }, 400)
        const { count } = await admin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('es_owner', true)
        if ((count ?? 0) <= 1) {
          return json({ error: 'Debe existir al menos un administrador general' }, 400)
        }
        const { error } = await admin
          .from('profiles')
          .update({ es_owner: false, role: 'integrante', puesto: 'auditor' })
          .eq('id', userId)
        if (error) throw error
        await auditar(null, { user_id: userId, es_owner: false })
        return json({ ok: true })
      }

      default:
        return json({ error: 'Acción desconocida' }, 400)
    }
  } catch (e) {
    // Un tope de plan no es una falla del servidor: se informa tal cual para que la app ofrezca subir de plan
    const err = e as { message?: string; hint?: string | null }
    if (esErrorDeTope(err)) return json({ error: err.message, tope: err.hint!.slice(10) }, 400)
    return json({ error: err.message || 'Error interno' }, 500)
  }
})
