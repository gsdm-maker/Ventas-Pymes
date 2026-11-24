/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_PG_URL: string
  readonly VITE_PG_KEY: string
  readonly VITE_WHATSAPP_VENTAS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
