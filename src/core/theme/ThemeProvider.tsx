import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from 'react'
import { ACENTOS, type Acento } from '@/core/theme/acentos'

export type Tema = 'light' | 'dark'
export type { Acento }

// Color de la barra del navegador = fondo de la app (--shell)
const THEME_COLOR: Record<Tema, string> = { light: '#fcf9f3', dark: '#181614' }

interface ThemeCtx {
  tema: Tema
  acento: Acento
  setTema: (t: Tema) => void
  setAcento: (a: Acento) => void
  toggleTema: () => void
}

const Ctx = createContext<ThemeCtx | null>(null)

function aplicar(tema: Tema, acento: Acento) {
  const html = document.documentElement
  html.setAttribute('data-theme', tema)
  html.setAttribute('data-accent', acento)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[tema])
}

function leerAcento(): Acento {
  const guardado = localStorage.getItem('misociopyme:acento') as Acento | null
  // Acentos retirados (índigo/violeta) vuelven a terracota
  return guardado && ACENTOS.includes(guardado) ? guardado : 'terracota'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTemaState] = useState<Tema>(
    () => (localStorage.getItem('misociopyme:tema') as Tema) || 'light'
  )
  const [acento, setAcentoState] = useState<Acento>(
    leerAcento
  )

  useEffect(() => {
    aplicar(tema, acento)
    localStorage.setItem('misociopyme:tema', tema)
    localStorage.setItem('misociopyme:acento', acento)
  }, [tema, acento])

  const setTema = useCallback((t: Tema) => setTemaState(t), [])
  const setAcento = useCallback((a: Acento) => setAcentoState(a), [])
  const toggleTema = useCallback(
    () => setTemaState((t) => (t === 'light' ? 'dark' : 'light')),
    []
  )

  return (
    <Ctx.Provider value={{ tema, acento, setTema, setAcento, toggleTema }}>
      {children}
    </Ctx.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider')
  return ctx
}
