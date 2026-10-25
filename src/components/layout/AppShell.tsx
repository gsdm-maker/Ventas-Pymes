import { Suspense, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Moon,
  Sun,
  LogOut,
  CloudOff,
  RefreshCw,
  Check,
  ShieldCheck,
  Menu
} from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useSync } from '@/core/offline/SyncProvider'
import { useTheme } from '@/core/theme/ThemeProvider'
import { GRUPOS, NAV } from '@/components/layout/nav'
import { cn } from '@/lib/cn'
import { hace } from '@/lib/format'
import { Select } from '@/components/ui/Input'
import { PLAN_LABEL } from '@/core/auth/plan'
import { CampanaAlertas } from '@/components/reposicion/AlertasStock'
import { TituloSlotContext } from '@/components/layout/tituloSlot'
import { LoadingState } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'

function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-on-accent">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 16 8 6h8l4 10" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 12h12" strokeLinecap="round" />
        </svg>
      </span>
      {!compact && <span className="text-lg font-semibold text-fg">Mi Socio Pyme</span>}
    </div>
  )
}

function SyncIndicator() {
  const { online, pendientes, ultimaSync, sincronizando, sincronizar } = useSync()
  return (
    <button
      onClick={() => void sincronizar()}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        online
          ? 'border-border bg-surface text-fg-body hover:bg-surface-2'
          : 'border-warning/40 bg-warning-soft text-warning'
      )}
      aria-label={ultimaSync ? `Última sincronización: ${hace(ultimaSync)}` : 'Sin sincronizar'}
      title={ultimaSync ? `Última sincronización: ${hace(ultimaSync)}` : 'Sin sincronizar'}
    >
      {sincronizando ? (
        <RefreshCw size={14} className="animate-spin" />
      ) : online ? (
        <Check size={14} />
      ) : (
        <CloudOff size={14} />
      )}
      <span className="hidden sm:inline">
        {online ? (pendientes > 0 ? `${pendientes} pendientes` : 'En línea') : 'Sin conexión'}
      </span>
      {pendientes > 0 && (
        <span className="grid size-4 place-items-center rounded-full bg-accent text-[10px] text-on-accent">
          {pendientes}
        </span>
      )}
    </button>
  )
}

function OfflineBanner() {
  const { online } = useSync()
  if (online) return null
  return (
    <div className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-xs font-medium text-warning">
      <CloudOff size={14} />
      Trabajando sin conexión — los movimientos se guardan localmente y se sincronizan al reconectar.
    </div>
  )
}

function UbicacionSelector() {
  const { ubicaciones, ubicacionActiva, setUbicacionActiva } = useAuth()
  if (ubicaciones.length === 0) return null
  return (
    <Select
      value={ubicacionActiva ?? ''}
      onChange={(e) => setUbicacionActiva(e.target.value)}
      aria-label="Ubicación activa"
      className="h-9 w-full min-w-0 max-w-56 py-0 text-xs sm:w-auto sm:min-w-40"
    >
      {ubicaciones.map((u) => (
        <option key={u.id} value={u.id}>
          {u.nombre}
          {u.tipo === 'bodega' ? ' · bodega' : ''}
        </option>
      ))}
    </Select>
  )
}

export function AppShell() {
  const { profile, empresa, cerrarSesion, can } = useAuth()
  const { tema, toggleTema } = useTheme()
  const navigate = useNavigate()
  const [tituloSlot, setTituloSlot] = useState<HTMLElement | null>(null)
  const [menuMovil, setMenuMovil] = useState(false)

  const visibles = NAV.filter((item) => !item.cap || can(item.cap))
  // Barra inferior del celular: 4 accesos directos + «Más» con todos los módulos
  const mobileItems = visibles.filter((i) => i.mobile).slice(0, 4)

  const iniciales = (profile?.nombre || profile?.email || '?')
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="flex min-h-screen bg-shell">
      {/* Sidebar escritorio */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-panel lg:flex">
        {/* La empresa reemplaza al nombre del producto: el logo ya identifica la app */}
        <div className="flex h-16 items-center gap-2.5 px-5" title="Mi Socio Pyme">
          <Logo compact />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-fg">{empresa?.nombre ?? 'Mi Socio Pyme'}</p>
            {empresa && (
              <p className="mt-0.5 text-[11px] leading-tight text-fg-muted">Plan {PLAN_LABEL[empresa.plan].toLowerCase()}</p>
            )}
          </div>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
          {GRUPOS.map((g) => {
            const items = visibles.filter((i) => i.grupo === g.key)
            if (!items.length) return null
            return (
              <div key={g.key}>
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
                  {g.label}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-200',
                          isActive
                            ? 'bg-accent-soft font-medium text-accent'
                            : 'text-fg-body hover:bg-surface hover:text-fg active:bg-surface-2'
                        )
                      }
                    >
                      <item.icon size={18} />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            )
          })}
          {profile?.es_owner && (
            <div>
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
                Plataforma
              </p>
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-200',
                    isActive
                      ? 'bg-accent-soft font-medium text-accent'
                      : 'text-fg-body hover:bg-surface hover:text-fg active:bg-surface-2'
                  )
                }
              >
                <ShieldCheck size={18} />
                Consola general
              </NavLink>
            </div>
          )}
        </nav>
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-on-accent">
              {iniciales}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-fg">{profile?.nombre}</p>
              <p className="truncate text-[11px] text-fg-muted">
                {profile?.es_owner ? 'Admin general' : profile?.puesto}
              </p>
            </div>
            <button
              onClick={() => void cerrarSesion()}
              className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Contenido */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:pl-64">
        <OfflineBanner />
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-panel/90 px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3 lg:hidden">
            <Logo compact />
            <span className="hidden text-base font-semibold text-fg sm:inline">Mi Socio Pyme</span>
          </div>
          {/* Título de la pantalla (lo coloca PageHeader); en móvil queda dentro de la página */}
          <div ref={setTituloSlot} className="hidden min-w-0 flex-1 lg:flex" />
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <UbicacionSelector />
            <CampanaAlertas />
            <SyncIndicator />
            <button
              onClick={toggleTema}
              className="hidden size-9 place-items-center rounded-lg border border-border text-fg-muted hover:bg-surface sm:grid"
              aria-label="Cambiar tema"
              title="Cambiar tema"
            >
              {tema === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
        </header>

        <a
          href="#contenido-principal"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent"
        >
          Saltar al contenido
        </a>
        <main id="contenido-principal" className="flex-1 px-4 py-5 pb-24 lg:px-6 lg:pb-8">
          <TituloSlotContext.Provider value={tituloSlot}>
            {/* Mientras baja el código de una pantalla, la barra lateral y la superior quedan fijas */}
            <Suspense fallback={<LoadingState />}>
              <Outlet />
            </Suspense>
          </TituloSlotContext.Provider>
        </main>
      </div>

      {/* Bottom nav móvil */}
      {mobileItems.length > 0 && (
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          {mobileItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors duration-200',
                  isActive ? 'text-accent' : 'text-fg-muted active:text-fg'
                )
              }
            >
              <item.icon size={20} />
              <span className="max-w-[72px] truncate">{item.label.split(' ')[0]}</span>
            </NavLink>
          ))}
          <button
            onClick={() => setMenuMovil(true)}
            aria-label="Más módulos"
            className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium text-fg-muted active:text-fg"
          >
            <Menu size={20} />
            Más
          </button>
        </nav>
      )}

      {/* Menú completo en el celular: todos los módulos habilitados para el usuario */}
      <Modal open={menuMovil} onClose={() => setMenuMovil(false)} title="Menú">
        <nav className="space-y-4">
          {GRUPOS.map((g) => {
            const items = visibles.filter((i) => i.grupo === g.key)
            if (!items.length) return null
            return (
              <div key={g.key}>
                <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">{g.label}</p>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      onClick={() => setMenuMovil(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm',
                          isActive ? 'border-accent/40 bg-accent-soft font-medium text-accent' : 'border-border text-fg-body active:bg-surface'
                        )
                      }
                    >
                      <item.icon size={17} className="shrink-0" />
                      <span className="line-clamp-2 leading-tight">{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            )
          })}
          {profile?.es_owner && (
            <button
              onClick={() => {
                setMenuMovil(false)
                navigate('/admin')
              }}
              className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm text-fg-body active:bg-surface"
            >
              <ShieldCheck size={17} /> Consola general
            </button>
          )}
          <button
            onClick={toggleTema}
            className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm text-fg-body active:bg-surface"
          >
            {tema === 'light' ? <Moon size={17} /> : <Sun size={17} />} Tema {tema === 'light' ? 'oscuro' : 'claro'}
          </button>
          <div className="flex items-center gap-2 border-t border-border pt-4">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-on-accent">{iniciales}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{profile?.nombre}</p>
              <p className="truncate text-xs text-fg-muted">{empresa?.nombre}</p>
            </div>
            <button
              onClick={() => void cerrarSesion()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-fg-body active:bg-surface"
            >
              <LogOut size={16} /> Salir
            </button>
          </div>
        </nav>
      </Modal>
    </div>
  )
}
