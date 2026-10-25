# Buenas prácticas — Mi Socio Pyme (versión final aplicada)

Documento de referencia del proyecto **Mi Socio Pyme** (sistema de inventario y ventas para
PYMES). Recoge las decisiones de arquitectura, datos, permisos, diseño y seguridad que
**están implementadas en este repositorio**, adaptadas del criterio de Lumix
(`OPERA AI/Lumixapp/`) al dominio de inventario/retail.

Fuente viva del código: `supabase/migrations/`, `supabase/functions/admin-users/`,
`src/core/` y `src/components/`. Ante diferencias, manda el código.

Índice:

1. [Filosofía general](#1-filosofía-general)
2. [Multiempresa: empresas y ubicaciones](#2-multiempresa-empresas-y-ubicaciones)
3. [Configurar el acceso de una empresa (paso a paso)](#3-configurar-el-acceso-de-una-empresa-paso-a-paso)
4. [Roles y permisos por capacidad](#4-roles-y-permisos-por-capacidad)
5. [Planes y módulos](#5-planes-y-módulos)
6. [Consola de administración](#6-consola-de-administración)
7. [Prueba y onboarding](#7-prueba-y-onboarding)
8. [Operaciones de negocio e integridad de stock](#8-operaciones-de-negocio-e-integridad-de-stock)
9. [PWA offline y sincronización](#9-pwa-offline-y-sincronización)
10. [Sistema de diseño y frontend](#10-sistema-de-diseño-y-frontend)
11. [Patrones transversales de seguridad](#11-patrones-transversales-de-seguridad)
12. [Decisiones de producto](#12-decisiones-de-producto)
13. [Diferencias respecto a Lumix](#13-diferencias-respecto-a-lumix)
14. [Checklist final](#14-checklist-final)
15. [Estado actual del proyecto](#15-estado-actual-del-proyecto)
16. [Patrones de diseño](#16-patrones-de-diseño)

---

## 1. Filosofía general

Cinco principios que atraviesan todo el sistema:

1. **Los datos se aíslan en la base, no en la app.** El aislamiento entre empresas vive en
   *Row Level Security* (RLS) de PostgreSQL. Ocultar un botón no protege nada; las reglas y
   funciones de base sí.
2. **Defensa en profundidad.** Cada permiso se aplica **dos veces**: en el front (UX) y en el
   back (RLS + RPC). Un mismo permiso existe como *capability* en el front y como chequeo SQL.
3. **Permisos por capacidad, no roles rígidos.** El rol (*puesto*) define un conjunto por
   defecto; los *overrides* por persona suman o revocan. Un solo catálogo tipado.
4. **Un color, un significado; todo color sale de un token.** Nada de colores de Tailwind
   escritos a mano. El color se usa para comunicar estado, nunca para decorar.
5. **Fallo cerrado en autenticación, fallo abierto en disponibilidad.** Si no se puede verificar
   quién llama, se corta (cerrado). Si falla un chequeo de plan, **no** se corta el servicio.

---

## 2. Multiempresa: empresas y ubicaciones

### 2.1 El tenant

Una **empresa** (`empresas`) es el tenant. Una persona pertenece a **una sola** empresa
(`profiles.empresa_id`).

```
empresas
  ├─ id, nombre
  ├─ moneda            -- 'CLP' (default), 'MXN', 'USD'
  ├─ modulos TEXT[]    -- módulos habilitados (ver §5)
  ├─ plan TEXT         -- 'prueba' | 'gratis' | 'pago'
  └─ prueba_hasta TIMESTAMPTZ

profiles  (extiende auth.users)
  ├─ empresa_id → empresas(id)
  ├─ role       -- 'admin' (de su empresa) | 'integrante'
  ├─ puesto     -- 'admin' | 'bodega' | 'tienda' | 'auditor'
  ├─ es_owner   -- dueño de la PLATAFORMA (ve todas las empresas)
  ├─ activo     -- desactivar el acceso sin borrar
  ├─ must_change_password
  └─ permissions JSONB  -- overrides de capacidades (ver §4)

ubicaciones  (tiendas y bodegas)
  ├─ empresa_id → empresas(id)  NOT NULL
  ├─ tipo       -- 'bodega' | 'tienda'
  ├─ parent_id  → ubicaciones(id)  -- opcional (jerarquía de bodegas)
  └─ activa

ubicacion_acceso  (usuario ↔ ubicaciones autorizadas)
  ├─ user_id, ubicacion_id, empresa_id
  └─ UNIQUE(user_id, ubicacion_id)
```

**Diferencia clave con Lumix:** en Mi Socio Pyme **no** hay árbol de equipos ni patrón
"linking pin". El equivalente operativo son las **ubicaciones** (tiendas/bodegas) y el
**puesto** de la persona. Si `ubicacion_acceso` está vacío, la persona ve todas las
ubicaciones de su empresa; si tiene filas, solo esas (`puede_ver_ubicacion`).

### 2.2 Ubicaciones

`ubicaciones.tipo` distingue **bodega** (origen de transferencias) de **tienda** (punto de
venta). El stock se guarda por `(producto, variante, ubicación)` en la tabla `stock`, con tres
contadores separados: **disponible**, **reservado** y **en tránsito** (§8). Agregar una
cuarta, quinta o más tiendas **no requiere rediseño**.

### 2.3 Aislamiento con RLS + funciones helper

Funciones `SECURITY DEFINER SET search_path = public` (evitan recursión de RLS):

| Función | Para qué |
|---|---|
| `mi_empresa()` | `empresa_id` del usuario autenticado |
| `es_owner()` | ¿dueño de la plataforma? (ve todas las empresas) |
| `es_activo()` | ¿la cuenta está activa? |
| `es_admin_empresa(e)` | ¿es Admin de **esa** empresa (o Owner)? |
| `tiene_modulo(m)` | ¿el módulo está habilitado para **mi** empresa? |
| `puede_ver_ubicacion(u)` | ¿puedo operar esa ubicación? (accesos o toda la empresa) |

Las políticas RLS de las tablas con `empresa_id` se crean en bloque (`do $$ ... $$`) con una
política `tenant_rw`:

```sql
create policy tenant_rw on public.<tabla>
  for all
  using (empresa_id = public.mi_empresa() or public.es_owner())
  with check (empresa_id = public.mi_empresa() or public.es_owner());
```

Las tablas hijas sin `empresa_id` (`recepcion_items`, `transferencia_items`, `venta_items`)
validan a través del padre. `empresas`, `profiles` y `plataforma` tienen políticas propias.
Así, la empresa A nunca ve datos de la B.

Además, **toda** lectura/escritura exige **cuenta activa** (`es_activo()`) y, en las tablas con
ubicación (`stock`, `movimientos`, `ventas`, `vouchers`, `recepciones`, `transferencias`),
respeta **`puede_ver_ubicacion()`**: un usuario con `ubicacion_acceso` solo ve y opera sus
ubicaciones (migración `0008_rls_activo_ubicacion.sql`).

### 2.4 Integridad garantizada por triggers (no confiar en el cliente)

- **`handle_new_user()`** (`auth.users` → `after insert`): crea la fila en `profiles`.
- **`proteger_perfil()`** (`profiles`): impide cambiar `es_owner`, `empresa_id` o el propio
  `role` desde la app, salvo `service_role` o Owner.
- **`proteger_empresa()`** (`empresas`): solo el Admin general (Owner) cambia `plan`,
  `prueba_hasta` o `modulos`.
- **`validar_ubicacion()`** (`ubicaciones`): el padre debe ser de la misma empresa.

> **Aprendizaje (bug real corregido en `0007_fix_service_role.sql`):** `current_setting(
> 'request.jwt.claim.role', true)` devuelve **NULL** en Supabase actual. Contra `NULL` las
> guardas `if rol <> 'service_role'` se evalúan a `NULL` (no disparan) y los triggers **no**
> reconocen al `service_role`. La forma correcta es **`auth.role()`**. Usar siempre
> `coalesce(auth.role(), '')`.

### 2.5 `service_role` y la consola

La Edge Function `admin-users` usa la clave **`service_role`**, que **salta RLS**. Ahí el
aislamiento hay que **reimplementarlo explícitamente** en el servidor: se valida el token,
se lee el perfil con `service_role` y se exige `es_owner`. Es el costo de usar `service_role`;
hay que tratarlo como código sensible.

---

## 3. Configurar el acceso de una empresa (paso a paso)

**No hay auto-registro.** El **Administrador general** (Owner) crea todo desde `/admin`:

1. **Crear la empresa** — `crear_empresa` (Edge Function): crea `empresas` con
   `plan='prueba'`, `prueba_hasta` según los días elegidos y la lista de `modulos`.
2. **Crear el Admin de la empresa** — en la misma llamada, se crea la cuenta en Auth con
   **clave temporal**, `email_confirm: true`, `must_change_password: true` y
   `profiles.role='admin'`, `puesto='admin'`, `empresa_id`.
   - **Rollback:** si falla la asignación de perfil, se borra el usuario y la empresa.
3. **Crear el resto de cuentas** — `crear_usuario`: email + nombre + `role` + `puesto` +
   ubicaciones autorizadas (`ubicacion_acceso`).
4. **Cargar datos de ejemplo** (opcional) — RPC `sembrar_demo(empresa)` crea
   *Boutique Aurora*: bodega, 3 tiendas, categorías, productos con foto y stock.
5. **Definir plan** — `actualizar_plan`: `prueba` (con días) / `gratis` / `pago`.
6. **Verificar** — `/admin/actividad` muestra la auditoría de cada acción.

La app **nunca** toca Auth directamente para crear cuentas: todo pasa por `admin-users`.

---

## 4. Roles y permisos por capacidad

### 4.1 Tres planos de rol (separados a propósito)

| Plano | Dónde vive | Valores | Significa |
|---|---|---|---|
| Plataforma | `profiles.es_owner` | bool | Dueño de la plataforma; ve todas las empresas |
| Empresa | `profiles.role` | `admin` \| `integrante` | Admin **de su** empresa vs persona normal |
| Puesto | `profiles.puesto` | `admin` \| `bodega` \| `tienda` \| `auditor` | Tipo de trabajo (define defaults) |

Los roles de negocio del brief se mapean así: *Administrador de empresa* → `role=admin`;
*Encargado de bodega* → `puesto=bodega`; *Encargado de tienda* → `puesto=tienda`;
*Auditor/supervisor* → `puesto=auditor`.

### 4.2 Capacidades: un catálogo único

Fuente: `src/core/auth/capabilities.ts`. Tipado, con `label` y `group`, compartido por front y
documentación. Dos grupos:

- **Módulos** (visibilidad completa): `modulos.dashboard`, `modulos.pos`, `modulos.salidas`,
  `modulos.ingreso`, `modulos.inventario`, `modulos.productos`, `modulos.bodega`,
  `modulos.movimientos`, `modulos.reportes`, `modulos.usuarios`, `modulos.configuracion`.
- **Acciones:** `pos.vender`, `salidas.registrar`, `ingreso.registrar`,
  `transferencias.gestionar`, `inventario.ajustar`, `productos.gestionar`,
  `usuarios.gestionar`, `config.gestionar`, `reportes.ver`.

### 4.3 Defaults por puesto + overrides que suman y restan

`ROLE_DEFAULTS` (por `puesto`):

- `admin` → **todas**.
- `bodega` → dashboard, ingreso, inventario, productos, bodega, movimientos + ingreso/ajustar/
  transferencias/productos.
- `tienda` → dashboard, pos, salidas, inventario, movimientos + `pos.vender`, `salidas.registrar`.
- `auditor` → dashboard, inventario, movimientos, reportes + `reportes.ver`.

`profiles.permissions` (JSONB) guarda **overrides**: `true` **suma**, `false` **revoca** un
default. Permite dar `pos.vender` a un auditor puntual o quitárselo a un vendedor.

### 4.4 Cómo se evalúa una capacidad (orden estricto)

`evaluarCapacidad(cap, { esOwner, role, puesto, modulosHabilitados, overrides })`:

1. Si es de **módulo** y el módulo está **apagado** (empresa) → `false`.
   **Ni el Admin ni el Owner ven un módulo apagado.**
2. Owner → `true`.
3. Override explícito en `permissions` → ese valor (permite revocar).
4. Si no, gana `ROLE_DEFAULTS[puesto]`.

### 4.5 Protección de rutas y acciones

- `AuthGuard` envuelve las rutas privadas y resuelve sesión, empresa, `must_change_password`
  y prueba vencida.
- `ModuloGuard cap="modulos.X"` cierra el hueco de entrar por URL a un módulo apagado. En
  `App.tsx` **cada** ruta de módulo va envuelta.
- La navegación (`src/components/layout/nav.ts`) lleva `cap?` y se filtra con `can()`; es una
  sola fuente para el menú lateral y la barra inferior móvil.
- Las acciones puntuales (botones) se gatean con `can(...)`.

**Regla de oro:** un permiso de módulo se aplica a la **ruta**, no solo al enlace.

---

## 5. Planes y módulos

### 5.1 Planes

`empresas.plan ∈ {prueba, gratis, pago}` + `empresas.prueba_hasta`.

- `prueba`: días definidos por el Admin general al crear la empresa (0 = sin prueba).
- `gratis` / `pago`: sin vencimiento.

`src/core/auth/plan.ts`: `diasRestantes()`, `pruebaVencida(empresa, esOwner)`. **El Owner nunca
se bloquea.** El cambio de plan es solo del Admin general.

### 5.2 Módulos en una capa (por empresa)

`empresas.modulos TEXT[]`, con lista cerrada
(`dashboard, pos, salidas, ingreso, inventario, productos, bodega, movimientos, reportes,
usuarios, configuracion`). Se habilitan por empresa en `/admin` o en
*Configuración → Módulos*. `tiene_modulo(m)` (SQL) y `evaluarCapacidad` (front) leen lo mismo.

---

## 6. Consola de administración

Consola separada (`/admin`), visible solo si `es_owner` (`AdminTabs`):

| Ruta | Página | Qué hace |
|---|---|---|
| `/admin` | Resumen | Contadores (empresas, en prueba, pagas) y accesos |
| `/admin/empresas` | Empresas | Crear empresa + admin + prueba; listar |
| `/admin/empresas/:id` | Detalle | Cambiar plan, crear cuentas, resetear clave, activar/desactivar, cargar demo |
| `/admin/owners` | Admins generales | Nombrar/revocar administradores generales |
| `/admin/actividad` | Actividad | Auditoría (lectura) de acciones |

**Creación de usuarios con clave temporal** (Edge Function `admin-users`):

1. Autoriza: token de usuario → perfil con `service_role` → exige `es_owner`.
2. Valida email, nombre, `role` y `puesto` (listas cerradas).
3. Genera una **clave temporal** legible (3 grupos de 4, alfabeto sin caracteres
   confundibles, `crypto.getRandomValues`).
4. `auth.admin.createUser` con `email_confirm: true` y `user_metadata.must_change_password`.
5. Ajusta `profiles` (empresa, rol, puesto) y, si corresponde, `ubicacion_acceso`.
6. **Rollback:** si algo falla tras crear la cuenta, se borra.
7. Devuelve la clave **una sola vez**; el front la muestra sin persistir.

**Auditoría:** cada acción inserta en `admin_auditoria` (`actor_id`, `accion`, `detalle jsonb`,
`empresa_id`). **Nunca se registran claves.** La tabla tiene RLS sin políticas + `REVOKE ALL`
para `anon`/`authenticated`: solo la lee/escribe `service_role`.

---

## 7. Prueba y onboarding

**No hay registro abierto ni "modo demo".** El flujo es:

1. El Admin general crea la empresa y le asigna el **período de prueba**.
2. El Admin de empresa recibe **clave temporal** y `must_change_password`; al entrar,
   `AuthGuard` lo fuerza a `/cambiar-clave`.
3. `AvisoPrueba` avisa cuando quedan ≤ 7 días. Al vencer, `AuthGuard` renderiza
   `<PruebaTerminada />` ("tu información sigue guardada") y no deja operar. El Owner nunca se
   bloquea.
4. Conversión a pago: **manual**, desde `/admin` (marcar `prueba`/`gratis`/`pago`).

---

## 8. Operaciones de negocio e integridad de stock

Toda la lógica de stock vive en **RPC transaccionales** (`0003_operaciones.sql`). El cliente
solo llama funciones; nunca escribe `stock` directo.

**Modelo de stock por ubicación:** `disponible`, `reservado`, `transito`.

| RPC | Efecto |
|---|---|
| `registrar_entrada` | Recepción: suma `disponible` en el destino + historial |
| `registrar_salida` | Descuenta `disponible`, genera **voucher interno** |
| `crear_transferencia` | `disponible -q` / `reservado +q` en **origen** (pendiente de despacho) |
| `despachar_transferencia` | `reservado -q` en origen / `transito +q` en destino |
| `recibir_transferencia` | `transito -q` / `disponible + recibida`; registra diferencias |
| `registrar_venta` | POS: descuenta stock, calcula **IVA 19%**, genera comprobante |
| `sembrar_demo` | Datos de ejemplo (Boutique Aurora) |

**Reglas duras:**

- Una transferencia **no se contabiliza dos veces** (estados: `borrador`,
  `pendiente_despacho`, `en_transito`, `recibida`, `recibida_con_diferencias`, `cancelada`).
- Stock insuficiente → excepción (probado: la operación se rechaza).
- Cada movimiento lleva **`uuid_local`** único `(empresa_id, uuid_local)` y **`estado_sync`**
  (`local` | `sincronizado` | `rechazado`) para el modo offline.
- **Voucher interno** (no boleta/factura): número único, empresa, ubicación, fecha, usuario,
  producto/cantidad, tipo y estado de sincronización.

**Venta (POS) y medio de pago:**

- `medio_pago ∈ {efectivo, transferencia, debito}`.
- `referencia_pago` es **obligatorio** en transferencia (n° de transferencia) y débito (n° de
  voucher de venta), y **nulo** en efectivo. Validado en base con `CHECK`:

```sql
constraint venta_referencia_pago check (
  (medio_pago = 'efectivo' and referencia_pago is null)
  or (medio_pago <> 'efectivo' and referencia_pago is not null)
);
```

- El desglose tributario se calcula con **IVA chileno 19%** (`desglosarIVA`), montos en enteros
  de pesos (CLP).

---

## 9. PWA offline y sincronización

- **Service worker real** (`vite-plugin-pwa`): precache del shell + `NetworkFirst` para la API
  de Supabase y `CacheFirst` para las fotos.
- **Cola en IndexedDB** (`src/core/offline/db.ts`, `idb`): las operaciones sin conexión se
  encolan (`salida`, `venta`) con `uuid_local` y `intentos`.
- **`SyncProvider`**: expone `online`, `pendientes`, `ultimaSync`, `errores`, `sincronizar()`
  y `encolarOperacion()`. Al volver la conexión, reintenta por lotes llamando las RPC.
- **`OfflineBanner`** discreto y visible; **`SyncBadge`** en la cabecera; pantalla
  **`/sync`** con conectado/última sincronización/pendientes/errores y "reintentar".
- **No mostrar datos globales como si estuvieran en vivo** cuando la tienda está offline.
- Cada movimiento tiene `uuid_local` y `estado_sync` (idempotencia en el reenvío).

---

## 10. Sistema de diseño y frontend

### 10.1 Stack

| Pieza | Rol |
|---|---|
| React 18 + React DOM | UI |
| Vite 5 | Bundler / dev server |
| TypeScript 5 (estricto) | Lenguaje |
| Tailwind CSS v4 (`@tailwindcss/vite`) | Estilos (config en CSS) |
| React Router 6 | Rutas SPA |
| `@supabase/supabase-js` | Datos / Auth |
| `recharts` | Gráficos del Dashboard/Reportes |
| `lucide-react` | Íconos |
| `date-fns` | Fechas |
| `idb` | IndexedDB (offline) |
| `vite-plugin-pwa` | Service worker + manifest |

### 10.2 Identidad visual

- Paleta **terracota / beige** (Material 3), **claro por defecto**, con modo oscuro.
- Acentos disponibles: **terracota** (default), `indigo`, `violeta`, `azul`.
- Se cambia en *Configuración → Apariencia*.

### 10.3 Tokens y temas (patrón Tailwind v4)

- Los **canales RGB crudos** viven en `:root`, `[data-theme='dark']` y `[data-accent='x']`
  (`src/index.css`).
- Un bloque `@theme inline` los mapea a colores de Tailwind (`--color-fg: rgb(var(--fg))`).
  Con `@theme` **inline** el valor no se "hornea": el cambio de tema funciona en runtime.
- El tema/acento se aplica escribiendo atributos en `<html>` (`data-theme`, `data-accent`)
  **antes** de React (`public/tema-inicial.js`) y luego los mantiene `ThemeProvider`.
- Claves de `localStorage`: `misociopyme:tema`, `misociopyme:acento`.

| Token | Uso |
|---|---|
| `bg-shell` | Fondo general |
| `bg-panel` | Encabezados, tablas, paneles, diálogos |
| `bg-surface` / `bg-surface-2` | Controles en reposo / hover |
| `bg-field` | Inputs |
| `border-border` / `border-border-strong` | Divisores / bordes de controles |
| `text-fg` / `text-fg-body` / `text-fg-muted` / `text-fg-faint` | Título · cuerpo · secundario · metadato |
| `text-accent`, `bg-accent`, `bg-accent-soft`, `text-on-accent` | Acento |
| `success` / `warning` / `danger` / `blocked` / `info` (+ `-soft`) | Solo semántica de estado |

**Regla clave:** nunca escribir colores de Tailwind a mano. Si necesitás un color, es un token.

### 10.4 Componentes

Fuente: `src/components/ui`.

| Necesitás… | Usá |
|---|---|
| Botón | `Button` (`primary` · `secondary` · `ghost` · `danger` · `soft`; `sm`–`xl`; `block`) |
| Contenedor | `Card`, `CardHeader`, `CardBody` |
| Etiqueta de estado | `Badge` (`tone`: neutral/accent/success/warning/danger/info/blocked; `dot`) |
| KPI | `KpiCard` |
| Formularios | `Field`, `Input`, `Select`, `Textarea` |
| Decisión / formulario | `Modal` (hoja inferior en móvil, centrado en escritorio) |
| Vacío / cargando / encabezado | `EmptyState`, `LoadingState`, `Spinner`, `PageHeader` |
| Avisos | `ToastProvider` + `useToast()` |

Convenciones: variantes como **mapas `Record<Variant, string>`**; clases unidas con `cn()`
(`clsx` + `tailwind-merge`); `forwardRef` en controles.

### 10.5 Armazón y navegación

- `AppShell` (`src/components/layout/AppShell.tsx`): **sidebar** en escritorio, **bottom-nav**
  en móvil, selector de empresa/ubicación, `SyncBadge`, toggle de tema y menú de usuario.
- Una sola fuente de navegación (`nav.ts`) filtrada por `can(cap)`.
- Selección de **ubicación activa** persistida (`misociopyme:ubicacion`).

### 10.6 Escala, esquinas y movimiento

- **Números tabulares** para fechas/montos (alineación en columna).
- **Texto:** escala cerrada; `text-base` (16px) solo en inputs móviles (evita zoom en iOS).
- **Esquinas:** de 6 a 24 px según contenedor; diálogos redondeados.
- **Movimiento:** solo donde informa; todo se anula con `prefers-reduced-motion`.

---

## 11. Patrones transversales de seguridad

1. **Anon sin EXECUTE.** Ninguna función de base se ejecuta sin sesión:
   `REVOKE EXECUTE ... FROM anon, PUBLIC` + `GRANT ... TO authenticated, service_role`.
2. **`SECURITY DEFINER` con `SET search_path = public`** en todas las funciones definer
   (evita *search_path hijacking*).
3. **Detección correcta de `service_role`:** usar **`auth.role()`**, nunca
   `current_setting('request.jwt.claim.role')` (devuelve NULL hoy).
4. **Triggers anti-escalación**: el cliente no puede subirse privilegios (`role`, `empresa_id`,
   `es_owner`, plan/prueba los cambia solo `service_role`/Owner).
5. **Auditoría solo-service_role:** `admin_auditoria` con RLS sin políticas + `REVOKE`.
6. **Aislamiento explícito en la consola**: con `service_role` (salta RLS), cada objetivo se
   valida contra la empresa del actor.
7. **Claves temporales nunca se registran** ni se persisten; se muestran una sola vez.
8. **CSP y cabeceras** en `netlify.toml`: `default-src 'self'`, `frame-ancestors 'none'`,
   `X-Frame-Options: DENY`, `connect-src` restringido a Supabase.
9. **Fallar cerrado vs abierto** (§1): auth cerrado; plan abierto ante error propio.
10. **Secretos fuera del repo:** `.env.local` y `Datakeys.md` en `.gitignore`.

---

## 12. Decisiones de producto

- **Rol:** inventario + **ventas (POS)**. El POS registra la venta y descuenta stock, **sin
  pasarela de pago**; el medio de pago y su referencia se guardan como dato.
- **Comprobantes:** solo **voucher interno** de movimiento/venta. No se emiten boletas ni
  facturas.
- **Impuestos/moneda:** **CLP** (sin decimales), precios con **IVA 19%** incluido y desglose.
- **Sin vencimientos/lotes:** no hay control de caducidad; las alertas son solo por
  **stock mínimo**. *(Decisión del cliente: el sistema no maneja productos que vencen.)*
- **Catálogo:** gestión **interna** de productos (no hay catálogo público compartible).
- **Pantallas principales:** Login, Dashboard, **Punto de Venta**, Salida rápida, Ingreso,
  Inventario (+ detalle), Productos, Bodega/Transferencias, Movimientos, Reportes, Usuarios,
  Configuración, Sincronización, Voucher, y la consola `/admin`.
- **Datos ficticios:** Boutique Aurora (bodega + 3 tiendas, categorías Ropa/Bisutería/
  Carteras/Accesorios).

---

## 13. Diferencias respecto a Lumix

| Tema | Lumix | Mi Socio Pyme |
|---|---|---|
| Jerarquía | Árbol de equipos (`teams.parent_id`) + linking pin | **Ubicaciones** (bodega/tienda) + **puesto** |
| Rol por unidad | `team_members.role` (lider/integrante/…) | `profiles.puesto` (admin/bodega/tienda/auditor) |
| Onboarding | Registro abierto + `crear_mi_espacio` (prueba 15 días) | **Sin registro**: el Admin general crea cuentas y asigna prueba |
| Módulos | 3 capas (empresa/unidad/persona) | 1 capa (**empresa**) + overrides |
| Dominio | Actividades/minutas/proyectos + IA | **Inventario, ventas, stock, transferencias** |
| Acento | Violeta (Órbita) | **Terracota** |
| Gráficos | SVG propio | **Recharts** |
| IA / cuotas | Edge Functions OpenAI + `uso_ia` | No aplica (sin IA) |

---

## 14. Checklist final

**Aislamiento y datos**
- [x] Tenant (`empresas`) y todo dato colgado de `empresa_id`.
- [x] RLS con helpers `SECURITY DEFINER SET search_path`.
- [x] Jerarquía de ubicaciones (`parent_id`) y tipos bodega/tienda.
- [x] Integridad crítica en **triggers**, no en el cliente.
- [x] `service_role` con aislamiento **reimplementado** en la Edge Function.

**Roles y permisos**
- [x] Planos de rol separados (plataforma / empresa / puesto).
- [x] Catálogo único y tipado de capacidades.
- [x] Defaults por puesto + overrides JSONB que suman y **revocan**.
- [x] Evaluación en orden estricto; módulo apagado gana incluso al Admin/Owner.
- [x] Permiso aplicado a la **ruta** (`ModuloGuard`), no solo al enlace.

**Planes y acceso**
- [x] Planes con expiración en base (`prueba_hasta`) evaluada en front.
- [x] Módulos con lista cerrada.
- [x] Owner nunca bloqueado; datos preservados al vencer la prueba.

**Administración**
- [x] Consola separada (`/admin`).
- [x] Alta de usuarios con **clave temporal** + forzar cambio.
- [x] Auditoría de acciones administrativas (sin claves).
- [x] Autorización y aislamiento en el **servidor**.

**Operación de inventario**
- [x] RPC transaccionales; el cliente no escribe `stock` directo.
- [x] Stock `disponible` / `reservado` / `transito`.
- [x] Transferencias sin doble contabilización + diferencias.
- [x] Voucher interno con número único.
- [x] Venta con IVA 19% y referencia de pago condicional.

**Offline**
- [x] Service worker + manifest (PWA).
- [x] Cola en IndexedDB + `uuid_local` + `estado_sync`.
- [x] Banner offline, badge y pantalla de sincronización.

**Frontend y diseño**
- [x] React + Vite + TS estricto + Tailwind v4 (config en CSS).
- [x] Carpeta `core / components / pages / lib`.
- [x] Todo color por token; tema/acento en runtime.
- [x] Kit propio de componentes; `cn()`; variantes como mapas.
- [x] Una lista de navegación filtrada por capacidades.
- [x] Móvil: bottom-nav, safe-area, `text-base` en inputs.
- [x] `prefers-reduced-motion` y foco visible.

**Seguridad transversal**
- [x] Anon sin EXECUTE; `search_path` fijo en las definer.
- [x] `auth.role()` para detectar `service_role`.
- [x] Cabeceras/CSP en el hosting.
- [x] Fallo cerrado en auth, abierto en disponibilidad.
- [x] Secretos fuera del repo.

---

## 15. Estado actual del proyecto

**Migraciones aplicadas** (`supabase/migrations/`):

| Archivo | Contenido |
|---|---|
| `0001_schema.sql` | Tablas, índices y constraints |
| `0002_rls.sql` | Helpers, triggers, RLS (políticas y privilegios) |
| `0003_operaciones.sql` | RPC de negocio (`_stock_row`, `_folio`, salidas, entradas, transferencias, venta) |
| `0004_demo.sql` | `sembrar_demo` (Boutique Aurora) |
| `0005_fix_demo.sql`, `0006_fix_demo.sql` | Fix del bucle `for v_p` (variable escalar) |
| `0007_fix_service_role.sql` | `auth.role()` en triggers/guardas de `service_role` |
| `0008_rls_activo_ubicacion.sql` | RLS exige `es_activo()`; tablas con ubicación aplican `puede_ver_ubicacion()` |

**Edge Function:** `supabase/functions/admin-users/index.ts`
(acciones: `crear_empresa`, `crear_usuario`, `actualizar_plan`, `toggle_usuario`,
`reset_password`, `nombrar_owner`, `revocar_owner`).

**Recuperación de contraseña:**
- **Por el propio usuario:** en el login → *"Olvidé mi contraseña"* (`resetPasswordForEmail`
  con `redirectTo=/restablecer`). La ruta `/restablecer` (`src/pages/Restablecer.tsx`) define la
  clave nueva. Requiere que la URL esté en *Auth → URL Configuration* (configurada vía
  Management API: `site_url` + `uri_allow_list`).
- **Desde administración:** en `/admin/empresas/:id`, botón **Clave** por usuario
  (`reset_password`) genera una **clave temporal**; y **Desactivar/Activar**
  (`toggle_usuario`). El Admin general no se puede resetear ni desactivar desde ahí.
- **Otro Admin general:** `/admin/owners` → *Nombrar administrador general* (`nombrar_owner`
  promueve una cuenta existente o crea una nueva) y *Revocar* (`revocar_owner`); siempre debe
  quedar al menos uno.

**Bootstrap del Owner:** `supabase/owner_bootstrap.sql` (crear el usuario en Auth y marcar
`es_owner`).

**Verificación end-to-end realizada:** login, creación de empresa+admin+prueba, seed, venta POS
con IVA y validación de medio de pago, salida, transferencia (crear→despachar→recibir), rechazo
por stock insuficiente, aislamiento RLS entre empresas y bloqueo de `anon` en RPC.

---

---

## 16. Patrones de diseño

Referencia: catálogo de [Refactoring.Guru](https://refactoring.guru/es/design-patterns). Estos son
los patrones que **ya usa** el sistema; un cambio nuevo debe seguir el mismo criterio en vez de
inventar otro. (Revisado el 25-10-2026.)

| Patrón | Dónde | Regla para cambios futuros |
|---|---|---|
| **Command** | Cola offline (`core/offline/db.ts` + `EJECUTORES` en `SyncProvider.tsx`): cada venta o salida se guarda como operación y se ejecuta al volver la red. | Una operación offline nueva = una entrada en `EJECUTORES` + `uuid_local` en su RPC para que reintentar no la duplique. |
| **Chain of Responsibility** | Permisos: `evaluarCapacidad()` (front) y `_evaluar_cap()` (SQL), en este orden: módulo apagado → owner → ajuste del usuario → admin de empresa → puesto. También `_estado_ia()` (asistente: cuenta → empresa → plan → permiso → topes). | El orden es contrato: si cambia en un lado, cambia en el otro. `npm run verificar:catalogo` revisa que el catálogo calce. |
| **State** | Comandas (`_transicion_comanda`, 0024): pendiente ⇄ preparando ⇄ lista ⇄ entregada, de a un paso. Transferencias: pendiente_despacho → en_transito → recibida (o recibida_con_diferencias). Cuentas: abierta → cobrada / anulada. | Cada flujo con estados declara sus transiciones permitidas en la base y rechaza el resto. Nunca un `update estado = …` libre desde la app. |
| **Strategy** | Medios de pago (`src/lib/mediosPago.ts`): cada medio define si pide referencia y si da vuelto. Herramientas del asistente (`ejecutar()` en la Edge Function `asistente`). | Un medio de pago nuevo se agrega solo en `MEDIOS_PAGO` (y en el CHECK de `ventas`). Una herramienta nueva de IA = su esquema + su caso en `ejecutar()`, sin tocar el ciclo de conversación. |
| **Facade** | `core/data/api.ts` esconde Supabase detrás de funciones con nombre de negocio. | Las pantallas piden datos a `api.ts`, no con `supabase.from(...)` directo (hay deuda: ver `PLAN_MEJORAS.md` F6). |
| **Proxy (de protección)** | Edge Functions `admin-users` y `asistente`: se ponen delante de Auth y de OpenAI y verifican sesión, permisos, plan y cupo. | Ningún servicio con clave secreta se llama desde el navegador. La función repite el aislamiento porque `service_role` salta RLS. |
| **Observer** | Realtime (`useTiempoReal`) y contextos de React (`AuthProvider`, `SyncProvider`). | Suscribirse en un solo lugar y limpiar al desmontar. |
| **Singleton** | Cliente de Supabase (`core/supabase/client.ts`). | Un solo cliente por app; no crear otros con la anon key. |

**Señales de alerta** (refactorizar antes de agregar más): pantallas de más de ~600 líneas
(`POS.tsx`, `Reportes.tsx`, `Mesas.tsx`), la misma lista o regla copiada en dos archivos, y
`if/else` por tipo que crece con cada caso nuevo (pasarlo a una tabla como `EJECUTORES` o `MEDIOS_PAGO`).

_Documento derivado de las buenas prácticas de `OPERA AI/Lumixapp/` y ajustado a la
implementación real de Mi Socio Pyme (`supabase/migrations/0001`–`0007`,
`supabase/functions/admin-users`, `src/core`, `src/components`). Ante dudas, la fuente de verdad
es el código._
