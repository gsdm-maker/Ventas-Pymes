// Servicio de funciones de un proyecto en el VPS (reemplaza a las Edge Functions).
// Carga las funciones de supabase/functions SIN modificarlas:
//   - Captura el handler de cada `Deno.serve` y lo enruta en /functions/v1/<nombre>.
//   - SUPABASE_URL es la URL pública (Flow la recibe como callback). Las llamadas a esa URL
//     se desvían por loopback a PostgREST y GoTrue, porque nginx bloquea /auth/v1/admin.
// Escucha solo en 127.0.0.1. No registra cuerpos, tokens ni claves.

type Handler = (req: Request, info: Deno.ServeHandlerInfo) => Response | Promise<Response>

function requerida(nombre: string): string {
  const valor = Deno.env.get(nombre)
  if (!valor) throw new Error(`Falta la variable ${nombre}`)
  return valor
}

const ORIGEN_PUBLICO = new URL(requerida('SUPABASE_URL')).origin
const DESTINOS: Array<[string, string]> = [
  ['/rest/v1/', requerida('REST_INTERNO').replace(/\/$/, '') + '/'],
  ['/auth/v1/', requerida('AUTH_INTERNO').replace(/\/$/, '') + '/']
]
const PUERTO = Number(requerida('PUERTO'))

// ---------------- Desvío a los servicios internos ----------------
const fetchExterno = globalThis.fetch.bind(globalThis)

globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
  const texto = entrada instanceof Request ? entrada.url : String(entrada)
  const url = new URL(texto)
  if (url.origin !== ORIGEN_PUBLICO) return fetchExterno(entrada, init)

  const destino = DESTINOS.find(([prefijo]) => url.pathname.startsWith(prefijo))
  // Fallo cerrado: nada más de la URL pública se alcanza desde las funciones
  if (!destino) return Promise.reject(new Error('Ruta interna no permitida'))
  const interna = destino[1] + url.pathname.slice(destino[0].length) + url.search
  return entrada instanceof Request
    ? fetchExterno(new Request(interna, entrada), init)
    : fetchExterno(interna, init)
}) as typeof fetch

// ---------------- Captura de los handlers ----------------
const serveOriginal = Deno.serve.bind(Deno)
const handlers = new Map<string, Handler>()
let cargando = ''

Object.defineProperty(Deno, 'serve', {
  configurable: true,
  writable: true,
  value: (...args: unknown[]) => {
    const handler = args.find((a) => typeof a === 'function') as Handler | undefined
    if (!cargando || !handler) throw new Error('Deno.serve fuera de la carga de funciones')
    handlers.set(cargando, handler)
    return { finished: Promise.resolve(), ref() {}, unref() {}, shutdown: () => Promise.resolve() }
  }
})

const FUNCIONES: Record<string, () => Promise<unknown>> = {
  'admin-users': () => import('./fns/admin-users/index.ts'),
  asistente: () => import('./fns/asistente/index.ts'),
  suscripcion: () => import('./fns/suscripcion/index.ts')
}

for (const [nombre, cargar] of Object.entries(FUNCIONES)) {
  cargando = nombre
  await cargar()
  if (!handlers.has(nombre)) throw new Error(`La función ${nombre} no registró su handler`)
}
cargando = ''

// ---------------- Servidor ----------------
const RUTA = /^\/functions\/v1\/([a-z-]+)$/

serveOriginal({ hostname: '127.0.0.1', port: PUERTO, onListen: () => console.log(`funciones listas: ${[...handlers.keys()].join(', ')}`) }, async (req, info) => {
  const { pathname } = new URL(req.url)
  if (pathname === '/health') return new Response('ok')

  const handler = handlers.get(RUTA.exec(pathname)?.[1] ?? '')
  if (!handler) return new Response('No encontrado', { status: 404 })
  try {
    return await handler(req, info)
  } catch (e) {
    console.error(`error en ${pathname}: ${(e as Error).name}`)
    return new Response(JSON.stringify({ error: 'Error interno' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
