import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, AlertTriangle } from 'lucide-react'
import { supabase } from '@/core/supabase/client'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'

/**
 * Restablecer contraseña tras hacer clic en el enlace de recuperación.
 * Supabase detecta el token de recuperación (detectSessionInUrl) y crea una
 * sesión temporal; aquí el usuario define su nueva clave.
 */
export function Restablecer() {
  const navigate = useNavigate()
  const toast = useToast()
  const [haySesion, setHaySesion] = useState<boolean | null>(null)
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHaySesion(!!data.session))
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (p1.length < 8) return setError('La contraseña debe tener al menos 8 caracteres')
    if (p1 !== p2) return setError('Las contraseñas no coinciden')
    setCargando(true)
    const { error: err } = await supabase.auth.updateUser({ password: p1 })
    if (err) {
      setCargando(false)
      return setError(err.message)
    }
    const { data } = await supabase.auth.getUser()
    if (data.user) {
      await supabase.from('profiles').update({ must_change_password: false }).eq('id', data.user.id)
    }
    setCargando(false)
    toast('Contraseña actualizada. Inicia sesión.')
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="grid min-h-screen place-items-center bg-shell p-6">
      <div className="w-full max-w-sm">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
          <KeyRound size={22} />
        </span>
        <h1 className="text-center text-xl font-semibold text-fg">Nueva contraseña</h1>
        <p className="mt-1 text-center text-sm text-fg-muted">
          Define una contraseña nueva para tu cuenta.
        </p>

        {haySesion === false && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-xs text-warning">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            El enlace no es válido o expiró. Solicita uno nuevo desde la pantalla de inicio de
            sesión.
          </div>
        )}

        {haySesion !== false && (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <Field label="Nueva contraseña" required hint="Mínimo 8 caracteres">
              <Input type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Repetir contraseña" required>
              <Input type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" />
            </Field>
            {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
            <Button type="submit" block size="lg" disabled={cargando}>
              {cargando ? 'Guardando…' : 'Guardar contraseña'}
            </Button>
          </form>
        )}

        <Button type="button" variant="ghost" block className="mt-3" onClick={() => navigate('/login')}>
          Ir a iniciar sesión
        </Button>
      </div>
    </div>
  )
}
