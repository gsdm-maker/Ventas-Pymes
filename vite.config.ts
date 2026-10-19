import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'tema-inicial.js'],
      manifest: {
        name: 'Mi Socio Pyme',
        short_name: 'Socio Pyme',
        description: 'Ventas, inventario y restaurante para pymes',
        lang: 'es',
        theme_color: '#94452c',
        background_color: '#fcf9f3',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // La API no se cachea aquí (podía mostrar datos de otro usuario en un equipo
        // compartido): el POS usa una copia local por usuario en IndexedDB.
        runtimeCaching: [
          {
            // Fotos de productos subidas a Storage (públicas): disponibles sin conexión en el POS
            urlPattern: /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\/productos\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fotos-productos',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 60 }
            }
          },
          {
            urlPattern: /^https:\/\/images\.unsplash\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'product-photos',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: { port: 5173 }
})
