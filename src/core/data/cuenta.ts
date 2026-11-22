import { db } from '@/core/db/client'

/** Recuperación de clave por correo (pantallas Login y Restablecer). */
export async function enviarRecuperacionClave(email: string, redirigirA: string): Promise<void> {
  await db.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: redirigirA })
}

export async function haySesionDeRecuperacion(): Promise<boolean> {
  const { data } = await db.auth.getSession()
  return !!data.session
}

/**
 * Guarda la clave nueva elegida desde el enlace del correo, deja de exigir el cambio al entrar
 * y cierra la sesión de recuperación (la persona vuelve a entrar con su clave).
 */
export async function guardarClaveRecuperada(clave: string): Promise<string | null> {
  const { error } = await db.auth.updateUser({ password: clave, data: { must_change_password: false } })
  if (error) return error.message
  const { data } = await db.auth.getUser()
  if (data.user) {
    await db.from('profiles').update({ must_change_password: false }).eq('id', data.user.id)
  }
  await db.auth.signOut()
  return null
}
