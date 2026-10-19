import { Link, useLocation } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/ui/Feedback'

export function NoEncontrado() {
  const { pathname } = useLocation()
  return (
    <EmptyState
      className="mx-auto mt-8 max-w-lg"
      icon={<Compass size={28} aria-hidden />}
      title="Esta página no existe"
      description={
        <>
          No encontramos <span className="font-mono">{pathname}</span>. Puede que el enlace esté
          desactualizado o que no tengas acceso a ese módulo.
        </>
      }
      action={
        <Link
          to="/"
          className="inline-flex h-8 items-center rounded-xl bg-accent px-3 text-xs font-medium text-on-accent transition-colors duration-200 hover:bg-accent-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          Volver al inicio
        </Link>
      }
    />
  )
}
