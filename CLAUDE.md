# Mi Socio Pyme

Inventario y ventas (POS) para pymes de retail y restaurante. Multi-empresa, multi-bodega, PWA offline. CLP sin decimales, IVA 19 %, fechas DD/MM/AAAA.

## Stack y comandos
React + Vite + TS + Tailwind v4 · Supabase (Auth, Postgres con RLS, Edge Functions) · IndexedDB para el modo offline.

| Acción | Comando |
|---|---|
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Pruebas SQL (se revierten solas) | `npm run test:seguridad`, `test:permisos`, `test:planes`, etc. |
| Probar una migración antes de aplicarla | `node scripts/sql-remoto.mjs --antes supabase/migrations/00XX.sql supabase/pruebas/seguridad.sql` |
| E2E (pytest + Playwright) | `npm run test:e2e`, **solo si el usuario lo pide** |

## Mapa
- `src/pages/`: pantallas · `src/components/<dominio>/`: pos, ventas, productos, reposicion, mesas, usuarios, asistente…
- `src/core/`: auth, data, offline, supabase, theme · `src/lib/`: reglas puras (precio, sku, variantes, medios de pago…).
- `supabase/migrations/`, `supabase/pruebas/*.sql`, `supabase/functions/`.
- Estado actual: `ESTADO.md` (leer al empezar). Decisiones y trampas: `BITACORA.md` (buscar por etiqueta, no leer completa). Pendientes: `PLAN_MEJORAS.md`.
- Al terminar una tarea con cambios: skill `memoria-cierre-tarea`.

## Reglas
- El repo `origin` es **público** y un push a `main` despliega a producción (Netlify). No hacer commit, push, `db push` ni deploy de funciones sin el OK del usuario. Orden de despliegue: db push → functions deploy → git push.
- Nunca subir correos reales, el ID del proyecto Supabase ni `Datakeys.md`. Revisar con `git grep` antes de subir.
- Toda RLS/RPC nueva lleva casos en `supabase/pruebas/`.
- Permisos: el admin general define el rubro y los módulos de cada empresa; el admin de empresa da accesos por usuario dentro de esos módulos.
