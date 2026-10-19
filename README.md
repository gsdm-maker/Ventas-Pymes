# Mi Socio Pyme

Sistema de **inventario y ventas (POS)** para PYMES de ropa, bisutería, accesorios y retail.
Multiempresa (multi-tenant), multi-bodega/tienda, con **PWA offline**, roles y permisos,
y control de stock con trazabilidad total.

- **Front:** React + Vite + TypeScript + Tailwind v4 + React Router.
- **Back:** Supabase (Auth + Postgres + RLS + Edge Functions).
- **Offline:** PWA real (service worker + IndexedDB con cola de sincronización).
- **Identidad:** paleta terracota/beige (Material 3), tema claro/oscuro.
- **Idioma:** español · fechas DD/MM/AAAA · moneda CLP · IVA chileno 19%.

> El **Administrador general** (dueño de la plataforma) crea las cuentas y asigna el
> período de prueba. No hay auto-registro.

---

## 1. Requisitos

- Node.js 20+ y npm
- Docker (opcional, para Supabase local)
- Supabase CLI (`npm i -g supabase`)

## 2. Instalación

```bash
npm install
```

## 3. Configurar Supabase (proyecto cloud)

1. Inicia sesión y crea un proyecto en https://supabase.com/dashboard
2. Enlaza el proyecto local con el remoto:

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
```

3. Aplica el esquema (tablas + RLS + triggers + funciones + demo):

```bash
supabase db push
```

4. Despliega la Edge Function del administrador general:

```bash
supabase functions deploy admin-users
```

> La función usa `SUPABASE_SERVICE_ROLE_KEY` (la inyecta Supabase automáticamente).
> No la expongas nunca en el front.

5. Crea el archivo `.env.local` a partir de `.env.example`:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key
```

## 4. Crear el Administrador general (una vez)

1. Supabase Dashboard → **Authentication → Add user** (email + contraseña, *Auto Confirm*).
2. En el **SQL Editor**, ejecuta `supabase/owner_bootstrap.sql` cambiando el correo.

## 5. Ejecutar

```bash
npm run dev
```

Entra con el usuario creado. Como Admin general verás **Consola general** en el menú:

- **Empresas:** crear empresa + su administrador + período de prueba (7/15/30/60/90 días).
- **Detalle de empresa:** cambiar plan, crear cuentas (con clave temporal), ubicaciones
  autorizadas, y *"Cargar datos de ejemplo"* (Boutique Aurora).
- **Actividad:** auditoría de acciones.

---

## 6. Roles y permisos

| Plano | Dónde vive | Valores |
|---|---|---|
| Plataforma | `profiles.es_owner` | Dueño de la plataforma |
| Empresa | `profiles.role` | `admin` \| `integrante` |
| Puesto | `profiles.puesto` | `admin` \| `bodega` \| `tienda` \| `auditor` |

Los permisos se modelan como **capacidades** (`src/core/auth/capabilities.ts`) con
*defaults por puesto* + *overrides* por persona (`profiles.permissions`, JSONB que suma o
revoca). Un módulo apagado no lo ve ni el admin. El permiso se aplica a la **ruta**
(`ModuloGuard`), no solo al enlace.

## 7. Seguridad (resumen)

- Aislamiento por empresa en **RLS** (Postgres), nunca solo en el front.
- Capacidades, módulos y período de prueba también se validan en la base (`tiene_cap`,
  `empresa_vigente`, `_contexto` en cada RPC).
- `stock`, `movimientos`, `ventas`, `vouchers`, recepciones y transferencias son de **solo
  lectura** vía API: toda escritura pasa por las RPC. `ubicacion_acceso` solo la escribe la
  Edge Function.
- Las RPC de venta y salida son **idempotentes** por `uuid_local` (la cola offline puede
  reenviar sin duplicar).
- **Offline:** solo POS y ventas (y salida rápida). El catálogo queda en una copia local por
  usuario (IndexedDB); la API no se guarda en la caché del navegador. Una venta hecha sin
  conexión nunca se rechaza por stock al sincronizar: se registra y queda marcada.
- **Productos sin control de stock** (`controla_stock = false`): para platos o servicios; se
  venden siempre y no generan movimientos ni alertas.
- **Tallas y colores:** si un producto tiene variantes, toda operación debe indicar una
  (`_exigir_variante`); cada variante tiene su propio stock.
- **Devoluciones:** `devolver_venta` (parcial o total, motivo obligatorio, capacidad
  `ventas.devolver`); nunca se borran ventas ni movimientos.
- Funciones helper `SECURITY DEFINER` con `search_path` fijo.
- Triggers anti-escalación (`role`, `empresa_id`, `es_owner`, plan/prueba).
- `admin_auditoria` con RLS sin políticas + `REVOKE` (solo service_role).
- Funciones `anon` sin `EXECUTE`.
- CSP y cabeceras en `netlify.toml`.

## 8. Operaciones de negocio (RPC)

| RPC | Efecto |
|---|---|
| `registrar_salida` | Descuenta stock y genera voucher interno |
| `registrar_entrada` | Recepción: suma existencias + historial |
| `crear_transferencia` | Reserva stock en origen (pendiente de despacho) |
| `despachar_transferencia` | Reservado → tránsito |
| `recibir_transferencia` | Tránsito → disponible, registra diferencias |
| `registrar_venta` | POS: precio desde catálogo, descuenta stock, IVA 19%, comprobante |
| `devolver_venta` | Devolución parcial o anulación: devuelve stock, prorratea el reembolso, comprobante DEV |
| `sembrar_demo` | Datos de ejemplo de Boutique Aurora |

**Medio de pago:** `efectivo` (sin referencia) · `transferencia` (n° de transferencia) ·
`debito` (n° de voucher de venta). Validado en base con un `CHECK`.

## 9. Pruebas de seguridad

```bash
npm run test:seguridad
```

Ejecuta `supabase/pruebas/seguridad.sql` en el proyecto (vía Management API, con
`SUPABASE_ACCESS_TOKEN` o el token de `Datakeys.md`): intenta ataques y operaciones
legítimas como usuarios reales y **revierte todo** al final.

## 10. Estado del prototipo

Prototipo **funcional** (no solo mockup): datos reales en Postgres, RLS, auth, PWA con
operación offline y cola de sincronización. Las fotos de producto son URLs de Unsplash
(cacheadas por el service worker).
