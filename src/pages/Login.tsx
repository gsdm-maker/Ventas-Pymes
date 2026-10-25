import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { LogIn, Mail } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabaseConfigurado } from '@/core/supabase/client'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { enviarRecuperacionClave } from '@/core/data/cuenta'

export function Login() {
  const { iniciarSesion, session, listo } = useAuth()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [recuperar, setRecuperar] = useState(false)

  if (listo && session) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setCargando(true)
    try {
      await iniciarSesion(email.trim().toLowerCase(), password)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCargando(false)
    }
  }

  async function enviarRecuperacion() {
    if (!email.trim()) {
      setError('Escribe tu correo para recuperar la contraseña')
      return
    }
    await enviarRecuperacionClave(email, `${window.location.origin}/restablecer`)
    toast('Si el correo existe, enviaremos instrucciones.', 'info')
    setRecuperar(false)
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Panel de marca */}
      <div className="relative hidden flex-col justify-between bg-accent p-10 text-on-accent lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-white/15">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 16 8 6h8l4 10" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6 12h12" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-xl font-semibold">Mi Socio Pyme</span>
        </div>
        <div>
          <h1 className="max-w-md text-3xl font-semibold leading-tight">
            Tu socio para vender, ordenar el stock y crecer.
          </h1>
          <p className="mt-3 max-w-md text-sm text-on-accent/80">
            Caja, inventario por tienda y bodega, mesas y cocina, y reportes claros. Sigue vendiendo
            aunque se caiga internet.
          </p>
        </div>
        <p className="text-xs text-on-accent/70">
          ¿No tienes cuenta? El administrador de la plataforma crea tu acceso y asigna el período
          de prueba.
        </p>
      </div>

      {/* Formulario */}
      <div className="flex items-center justify-center bg-shell p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="grid size-9 place-items-center rounded-xl bg-accent text-on-accent">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 16 8 6h8l4 10" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 12h12" strokeLinecap="round" />
              </svg>
            </span>
            <span className="text-xl font-semibold text-fg">Mi Socio Pyme</span>
          </div>

          <h2 className="text-xl font-semibold text-fg">Iniciar sesión</h2>
          <p className="mt-1 text-sm text-fg-muted">Accede con tu correo y contraseña.</p>

          {!supabaseConfigurado && (
            <div className="mt-4 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-xs text-warning">
              Falta configurar Supabase. Copia <code>.env.example</code> a <code>.env.local</code> con
              tu URL y anon key.
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <Field label="Correo electrónico" required>
              <Input
                type="email"
                spellCheck={false}
                autoComplete="email"
                placeholder="tu@correo.cl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Contraseña" required>
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>

            {error && (
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>
            )}

            <Button type="submit" block size="lg" disabled={cargando}>
              <LogIn size={18} />
              {cargando ? 'Ingresando…' : 'Ingresar'}
            </Button>
          </form>

          <button
            onClick={() => (recuperar ? void enviarRecuperacion() : setRecuperar(true))}
            className="mt-4 flex items-center gap-1.5 text-xs text-accent hover:underline"
          >
            <Mail size={14} />
            {recuperar ? 'Enviar instrucciones de recuperación' : 'Olvidé mi contraseña'}
          </button>
        </div>
      </div>
    </div>
  )
}
