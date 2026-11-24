# Mi Socio Pyme

Sistema de **inventario y ventas (POS)** para PYMES de ropa, bisutería, accesorios y retail.
Multiempresa (multi-tenant), multi-bodega/tienda, con **PWA offline**, roles y permisos,
y control de stock con trazabilidad total.

- **Front:** React + Vite + TypeScript + Tailwind v4 + React Router.
- **Back:** Postgres con RLS en un VPS propio (GoTrue, PostgREST, storage-api y funciones Deno; ver `infra/vps/`). El front usa `supabase-js` como cliente.
- **Offline:** PWA real (service worker + IndexedDB con cola de sincronización).
- **Identidad:** paleta terracota/beige (Material 3), tema claro/oscuro.
- **Idioma:** español · fechas DD/MM/AAAA · moneda CLP · IVA chileno 19%.

> El **Administrador general** (dueño de la plataforma) crea las cuentas y asigna el
> período de prueba. No hay auto-registro.

---

## 1. Requisitos

- Node.js 20+ y npm
- Acceso SSH al VPS (para las pruebas SQL y la infraestructura)

## 2. Instalación

```bash
npm install
```

## 3. Configurar la API

La base, los servicios y nginx se levantan con la plantilla de `infra/vps/` (guía: `docs/PASO_A_PRODUCTIVO.md`; diseño: `docs/DISENO_PLANTILLA_VPS.md`). Las migraciones están en `supabase/migrations/` y se aplican con `SET ROLE <proyecto>_owner`.

Crea `.env.local` a partir de `.env.example` con la URL de la API y la clave anon pública:

```env
VITE_PG_URL=https://api.tu-dominio
VITE_PG_KEY=tu-anon-key
```

## 4. Crear el Administrador general (una vez)

Crear el usuario en GoTrue con la clave de servicio, desde el VPS (puerto interno de GoTrue, nunca desde internet), y luego ejecutar `supabase/owner_bootstrap.sql` cambiando el correo.

## 5. Ejecutar

```bash
npm run dev
```

Entra con el usuario creado. Como Admin general verás **Consola general** en el menú:

- **Empresas:** crear empresa + su administrador + rubro + plan inicial (prueba de N días, mensual,
  anual o dueño).
- **Detalle de empresa:** plan y suscripción (registrar pago, días de gracia, alertas al admin,
  historial de pagos), **rubro y módulos habilitados** (Tienda · Restaurante ·
  Tienda y restaurante), crear cuentas (con clave temporal), ubicaciones autorizadas, y
  *"Cargar datos de ejemplo"* (Boutique Aurora).
- **Actividad:** auditoría de acciones.

---

## 6. Roles y permisos

| Plano | Dónde vive | Valores |
|---|---|---|
| Plataforma | `profiles.es_owner` | Dueño de la plataforma |
| Empresa | `profiles.role` | `admin` \| `integrante` |
| Puesto | `profiles.puesto` | `admin` \| `bodega` \| `tienda` \| `auditor` |

Los permisos se modelan como **capacidades** (`src/core/auth/capabilities.ts`) con
*defaults por puesto* + *ajustes* por persona (`profiles.permissions`, JSONB que suma o
revoca módulos y acciones). El permiso se aplica a la **ruta** (`ModuloGuard`), no solo al enlace.

Dos niveles:
1. **Empresa** — el Administrador general define el rubro y los **módulos habilitados**. Un
   módulo apagado no lo ve nadie de la empresa, ni su admin. El admin de empresa solo los ve.
2. **Usuario** — el admin de empresa crea la cuenta con los permisos del puesto ya marcados y
   puede ajustarlos, solo dentro de los módulos habilitados y **sin otorgar lo que él no tiene**
   (validado en la base: `proteger_perfil` y `validar_permisos_nuevos`).

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
- Tiendas y bodegas **no se borran**: se desactivan (sin stock, sin transferencias ni cuentas
  abiertas), conservando su historial.
- Triggers anti-escalación (`role`, `empresa_id`, `es_owner`, plan/prueba, rubro/módulos) y
  referencias solo dentro de la misma empresa (variantes, categorías, ubicaciones, mesas).
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

Corre `supabase/pruebas/seguridad.sql` por SSH en el VPS, sobre una copia temporal de la base (`--ensayo`; la base real no se toca). Intenta ataques y operaciones legítimas como usuarios de prueba y **revierte todo** al final. Conexión: `VPS_SSH`, `VPS_SSH_KEY` y `VPS_SUDO_PASS` (o `Datakeys.md`, no versionado).

## 10. Estado del prototipo

Prototipo **funcional** (no solo mockup): datos reales en Postgres, RLS, auth, PWA con
operación offline y cola de sincronización. Las fotos de producto son URLs de Unsplash
(cacheadas por el service worker).
