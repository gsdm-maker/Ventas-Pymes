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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
      .select('plan, prueba_hasta')
      .eq('id', perfil.empresa_id)
      .single()
    const vencida =
      emp?.plan === 'prueba' && !!emp.prueba_hasta && new Date(emp.prueba_hasta).getTime() < Date.now()
    if (!emp || vencida) return json({ error: 'El período de prueba de la empresa terminó' }, 403)
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
        const dias = Number(payload.prueba_dias ?? 15)
        // Rubro: retail | restaurante | mixto. Sin módulos explícitos, restaurante y mixto
        // suman Mesas y Cocina
        const tipoNegocio = RUBROS.includes(String(payload.tipo_negocio)) ? String(payload.tipo_negocio) : 'retail'
        const modulos = payload.modulos === undefined
          ? MODULOS.filter((m) => tipoNegocio !== 'retail' || (m !== 'mesas' && m !== 'cocina'))
          : modulosValidos(payload.modulos)
        if (!modulos) return json({ error: 'Módulos inválidos' }, 400)
        const adminEmail = String(payload.admin_email || '').trim().toLowerCase()
        const adminNombre = String(payload.admin_nombre || '').trim()
        if (!nombre) return json({ error: 'Falta el nombre de la empresa' }, 400)
        if (!esEmailValido(adminEmail)) return json({ error: 'Correo de admin inválido' }, 400)
        if (Number.isNaN(dias) || dias < 0 || dias > 365) return json({ error: 'Días de prueba inválidos' }, 400)

        const pruebaHasta = dias > 0 ? new Date(Date.now() + dias * 86400000).toISOString() : null

        const { data: empresa, error: empErr } = await admin
          .from('empresas')
          .insert({ nombre, plan: 'prueba', prueba_hasta: pruebaHasta, modulos, tipo_negocio: tipoNegocio })
          .select()
          .single()
        if (empErr) throw empErr

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

        await auditar(empresa.id, { nombre, prueba_dias: dias, admin_email: adminEmail, tipo_negocio: tipoNegocio })
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

      // ---------- Cambiar plan / período de prueba (solo Owner) ----------
      case 'actualizar_plan': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const empresaId = String(payload.empresa_id || '')
        const plan = String(payload.plan || '')
        if (!['prueba', 'gratis', 'pago'].includes(plan)) return json({ error: 'Plan inválido' }, 400)
        const dias = Number(payload.prueba_dias ?? 15)
        if (plan === 'prueba' && (!Number.isInteger(dias) || dias < 1 || dias > 365)) {
          return json({ error: 'Días de prueba inválidos' }, 400)
        }
        const { data: existe } = await admin.from('empresas').select('id').eq('id', empresaId).maybeSingle()
        if (!existe) return json({ error: 'Empresa inexistente' }, 400)
        const pruebaHasta = plan === 'prueba' ? new Date(Date.now() + dias * 86400000).toISOString() : null
        const { error } = await admin
          .from('empresas')
          .update({ plan, prueba_hasta: pruebaHasta })
          .eq('id', empresaId)
        if (error) throw error
        await auditar(empresaId, { plan, prueba_hasta: pruebaHasta })
        return json({ ok: true })
      }

      // ---------- Plan del asistente IA de una empresa (solo Owner) ----------
      case 'actualizar_plan_ia': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const empresaId = String(payload.empresa_id || '')
        const planIa = payload.plan_ia === null ? null : String(payload.plan_ia || '')
        if (planIa !== null && !PLANES_IA.includes(planIa)) return json({ error: 'Plan de asistente inválido' }, 400)
        const { data: antes } = await admin.from('empresas').select('plan_ia').eq('id', empresaId).maybeSingle()
        if (!antes) return json({ error: 'Empresa inexistente' }, 400)
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
        const usuarioDia = Number(payload.mensajes_dia_usuario)
        const entero = (n: number) => Number.isInteger(n) && n >= 1 && n <= 100000
        if (!entero(empresaDia) || !entero(usuarioDia)) {
          return json({ error: 'Los topes deben ser números enteros entre 1 y 100.000' }, 400)
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

      // ---------- Rubro y módulos habilitados (solo Owner) ----------
      case 'actualizar_modulos': {
        if (!esAdminGeneral) return json({ error: 'No autorizado' }, 403)
        const empresaId = String(payload.empresa_id || '')
        const tipoNegocio = String(payload.tipo_negocio || '')
        const modulos = modulosValidos(payload.modulos)
        if (!RUBROS.includes(tipoNegocio)) return json({ error: 'Rubro inválido' }, 400)
        if (!modulos) return json({ error: 'Módulos inválidos' }, 400)
        const { data: antes } = await admin
          .from('empresas')
          .select('tipo_negocio, modulos')
          .eq('id', empresaId)
          .maybeSingle()
        if (!antes) return json({ error: 'Empresa inexistente' }, 400)
        const { error } = await admin
          .from('empresas')
          .update({ tipo_negocio: tipoNegocio, modulos })
          .eq('id', empresaId)
        if (error) throw error
        await auditar(empresaId, { antes, tipo_negocio: tipoNegocio, modulos })
        return json({ ok: true })
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
    return json({ error: (e as Error).message || 'Error interno' }, 500)
  }
})
