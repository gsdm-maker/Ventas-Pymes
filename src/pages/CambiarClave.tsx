import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'

export function CambiarClave() {
  const { session, profile, cambiarClave, cerrarSesion, listo } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  if (listo && !session) return <Navigate to="/login" replace />
  if (listo && profile && !profile.must_change_password) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (p1.length < 8) return setError('La contraseña debe tener al menos 8 caracteres')
    if (p1 !== p2) return setError('Las contraseñas no coinciden')
    setCargando(true)
    try {
      await cambiarClave(p1)
      toast('Contraseña actualizada correctamente')
      navigate('/')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-shell p-6">
      <div className="w-full max-w-sm">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
          <KeyRound size={22} />
        </span>
        <h1 className="text-center text-xl font-semibold text-fg">Cambia tu contraseña</h1>
        <p className="mt-1 text-center text-sm text-fg-muted">
          Por seguridad, debes reemplazar la contraseña temporal asignada por el administrador.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <Field label="Nueva contraseña" required hint="Mínimo 8 caracteres">
            <Input
              type="password"
              value={p1}
              onChange={(e) => setP1(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Repetir contraseña" required>
            <Input
              type="password"
              value={p2}
              onChange={(e) => setP2(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          {error && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>
          )}
          <Button type="submit" block size="lg" disabled={cargando}>
            {cargando ? 'Guardando…' : 'Guardar y continuar'}
          </Button>
          <Button type="button" variant="ghost" block onClick={() => void cerrarSesion()}>
            Cerrar sesión
          </Button>
        </form>
      </div>
    </div>
  )
}
