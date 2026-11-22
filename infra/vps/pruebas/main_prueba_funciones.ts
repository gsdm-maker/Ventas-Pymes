// Solo para e2e_funciones.py: desvía OpenAI al simulador local y carga el servicio real.
const MOCK = Deno.env.get('MOCK_URL')!
const original = globalThis.fetch.bind(globalThis)

globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = entrada instanceof Request ? entrada.url : String(entrada)
  if (url === 'https://api.openai.com/v1/chat/completions') return original(`${MOCK}/v1/chat/completions`, init)
  return original(entrada, init)
}) as typeof fetch

await import('/app/main.ts')
