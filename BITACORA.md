# Bitácora — Mi Socio Pyme

Registro de lo realizado en el proyecto, para no perder el hilo. Se actualiza a medida que
avanzamos. Fecha de la última actualización: **18-10-2026**.

---

## 1. Qué es el proyecto

**Mi Socio Pyme**: sistema web de **inventario y ventas (POS)** para PYMES de retail (ropa,
bisutería, accesorios). Multiempresa, multi-bodega/tienda, **PWA offline**, roles y permisos,
control de stock con trazabilidad.

- **Front:** React 18 + Vite 5 + TypeScript + Tailwind v4 + React Router.
- **Back:** Supabase (Auth + Postgres + RLS + Edge Functions).
- **Offline:** PWA real (service worker + IndexedDB con cola de sincronización).
- **Identidad:** paleta terracota/beige (Material 3), tema claro/oscuro.
- **Idioma:** español · fechas DD/MM/AAAA · moneda **CLP** · **IVA chileno 19%**.

## 2. Decisiones clave (cerradas con el cliente)

| Tema | Decisión |
|---|---|
| Alcance | Pantallas A–K + **Punto de Venta** (ventas) |
| Ventas | Registro de venta + descuento de stock, **sin pasarela de pago** |
| Medio de pago | `efectivo` (sin referencia) · `transferencia` (n° transferencia) · `débito` (n° voucher) — referencia **obligatoria** salvo efectivo |
| Impuestos/moneda | CLP sin decimales, IVA 19% incluido con desglose |
| Vencimientos | **No existen** (sin lotes ni alertas de caducidad) |
| Catálogo público | No; solo gestión interna de productos |
| Onboarding | **Sin auto-registro**: el **Admin general** crea cuentas y asigna período de prueba |
| Roles | Dos niveles: **Admin general** (plataforma) y **Admin de empresa** (gestiona su negocio). Los admins de empresa pueden crear usuarios, claves y permisos dentro de su empresa |
| Ubicaciones | Un usuario puede tener acceso total (sin filas en `ubicacion_acceso`) o restringido a ubicaciones específicas |
| Identidad visual | Terracota/beige (se descartó petróleo) |
| Offline | Solo **POS y ventas** (más la salida rápida en retail); ingreso, transferencias y configuración requieren conexión |
| Rubros | Retail y **restaurante**: cada producto decide si **controla stock** (un restaurante mezcla bebidas con inventario y platos sin inventario). Mesas/comandas/propina: más adelante, si hay un cliente que lo pida |

## 3. Supabase (proyecto cloud)

- **Proyecto:** ID y URL en `Datakeys.md` y `.env.local` (no versionados)
- Credenciales en `Datakeys.md` (excluido de git).
- **Edge Function** `admin-users` desplegada (acciones: `crear_empresa`, `crear_usuario`,
  `actualizar_plan`, `toggle_usuario`, `reset_password`, `nombrar_owner`, `revocar_owner`,
  `actualizar_ubicaciones`).
- **Owner bootstrap:** `supabase/owner_bootstrap.sql`.
- **Auth:** `site_url` y `uri_allow_list` configurados (`http://localhost:5173`).

### Migraciones aplicadas

| Archivo | Contenido |
|---|---|
| `0001_schema.sql` | Tablas, índices, constraints |
| `0002_rls.sql` | Helpers (`mi_empresa`, `es_owner`, `es_activo`, `es_admin_empresa`, `tiene_modulo`, `puede_ver_ubicacion`), triggers y RLS |
| `0003_operaciones.sql` | RPC: salida, entrada, transferencias, venta, `_stock_row`, `_folio` |
| `0004_demo.sql` | `sembrar_demo` (Boutique Aurora) |
| `0005_fix_demo.sql`, `0006_fix_demo.sql` | Fix bucle `for v_p` (variable escalar) |
| `0007_fix_service_role.sql` | `auth.role()` en triggers/guardas |
| `0008_rls_activo_ubicacion.sql` | RLS exige `es_activo()` y aplica `puede_ver_ubicacion()` |
| `0009_ubicaciones_acceso.sql` | La tabla `ubicaciones` respeta `ubicacion_acceso`: un usuario solo ve las ubicaciones asignadas |
| `0021_desactivar_ubicaciones.sql` | **Aplicada 24-10-2026.** Tiendas y bodegas no se borran vía API: se desactivan; el trigger exige sin stock, sin transferencias sin recibir, sin cuentas de mesa abiertas y otra ubicación activa. Quien estaba asignado solo a una desactivada queda sin acceso (no «ve todas») |
| `0020_modulos_y_permisos.sql` | **Aplicada 24-10-2026** (Edge Function `admin-users` v8 desplegada el mismo día). Rubro (`tipo_negocio` + `mixto`) y módulos solo los cambia el administrador general; ajustes por usuario también en módulos (`_evaluar_cap`); sin escalada de privilegios (`proteger_perfil`, `validar_permisos_nuevos`); referencias dentro de la misma empresa (variantes, categorías, ubicaciones, mesas); `registrar_salida` con bloqueo por `uuid_local` |
| `0017_ranking_pos.sql` | `ranking_ventas(ubicación, días)`: más vendidos por tienda para ordenar el POS |
| `0019_restaurante.sql` | Restaurante: mesas, cuentas abiertas, comandas a cocina (tiempo real), propina por garzón; módulos `mesas` y `cocina`, capacidades `mesas.atender` y `cocina.gestionar` |
| `0018_recepcion_documento.sql` | Recepción: tipo/número/fecha del documento del proveedor (opcional) y opción de actualizar el costo del producto con lo pagado |
| `0016_fotos_y_codigo_barras.sql` | Bucket `productos` (fotos) con políticas por empresa y código de barras único por empresa |
| `0015_variantes_opcionales.sql` | `empresas.usa_variantes` (tallas/colores opcionales por empresa), no apagar con variantes activas ni desactivar una variante con stock; `proteger_empresa` acepta conexiones sin JWT (migraciones) |
| `0014_variantes_y_devoluciones.sql` | Variantes obligatorias si existen (`_exigir_variante`), proyección/simulación por talla, `devolver_venta`, tablas `devoluciones`/`devolucion_items`, `ventas.estado`/`monto_devuelto`, reporte neto de devoluciones, capacidad `ventas.devolver` |
| `0013_offline_y_control_stock.sql` | `productos.controla_stock`, `empresas.tipo_negocio`, ventas/salidas offline que no se rechazan por stock (`venta_items.sin_stock`, `ventas.con_diferencia`) |
| `0012_reporte_ventas.sql` | `reporte_ventas()` (totales vs período anterior, ranking, venta diaria, día de la semana, top productos, medios, categorías); historia simulada con ventas completas; `ventas.simulado` |
| `0011_reposicion.sql` | Alertas de quiebre y proyección: `proyeccion_reposicion`, `simular_historia`, `borrar_historia_simulada`, `empresas.reposicion`, `movimientos.simulado` |
| `0010_endurecer_seguridad.sql` | Endurecimiento (ver §7): `tiene_cap`/`empresa_vigente`/`_contexto` en la base, tablas transaccionales de solo lectura, `ubicacion_acceso` sin escritura vía API, `proteger_perfil` ampliado, RPC con precio de catálogo, idempotencia y validaciones |

## 4. Backend — modelo y reglas

- **Tenant:** `empresas`. `profiles` = `role` (admin/integrante) + `puesto`
  (admin/bodega/tienda/auditor) + `es_owner`.
- **Ubicaciones:** `tipo` bodega/tienda; `ubicacion_acceso` restringe por persona.
  - Si el usuario **no tiene filas** en `ubicacion_acceso`, ve **todas** las ubicaciones de su
    empresa (comportamiento legacy/gerente).
  - Si tiene filas, ve **solo** esas ubicaciones. La política RLS de `ubicaciones` se asegura de
    esto desde la migración `0009_ubicaciones_acceso.sql`.
- **Stock** por `(producto, variante, ubicación)`: **disponible / reservado / tránsito**.
- **Transferencias** con estados y **sin doble contabilización** (reserva → tránsito → recibe).
- **Venta** (POS) descuenta stock, calcula IVA 19% y genera comprobante; `CHECK` de referencia
  de pago.
- **Voucher interno** (no boleta/factura).
- **Movimientos** con `uuid_local` + `estado_sync` (offline).

## 5. Frontend — pantallas y módulos

- Login, Cambiar clave, **Restablecer** (recuperación), Dashboard, **POS**, Salida rápida,
  Salidas/vouchers, Ingreso, Inventario (+ detalle), Productos, Bodega/Transferencias,
  Movimientos, Reportes, Usuarios y permisos, Configuración, Sincronización, Voucher.
- **Consola del Admin general** (`/admin`): Resumen, Empresas (+ detalle), **Admins generales**,
  Actividad.
- **Auth:** `AuthGuard`, `ModuloGuard`, `useCapabilities` (defaults por puesto + overrides).
- **Offline:** `SyncProvider`, cola IndexedDB, banner offline, pantalla `/sync`.
- **Apariencia:** tema claro/oscuro + acentos (terracota/azul).
- **Reposición y alertas** (`/reposicion`): ver §7 «Alertas de quiebre».

## 6. Estado de cuenta

| Rol | Cuenta |
|---|---|
| **Admin general (usuario maestro)** | correo y clave en `Datakeys.md` (nunca en este archivo) |
| Admin de empresa (demo) | ver `Datakeys.md` — Tiendas Pedro Pichilemu |
| Usuario de tienda (demo) | ver `Datakeys.md` — Centro, Mall y Outlet |

- Recuperación de clave: autoservicio desde Login ("Olvidé mi contraseña" → `/restablecer`).
- Desde administración: `/admin → Empresas → (empresa) → Clave` (clave temporal) y
  Activar/Desactivar.
- Otro Admin general: `/admin/owners → Nombrar administrador general`.
- **Límite del Admin de empresa (desde 0010):** no puede modificarse a sí mismo ni a otro admin de
  su empresa (permisos, clave, activar/desactivar); eso lo hace el Admin general.
- **Admin de empresa (18-10-2026):** desde `Usuarios y permisos` puede **crear usuarios**, resetear
  claves, activar/desactivar y ajustar permisos, todo dentro de su empresa. La Edge Function
  `admin-users` ahora autoriza tanto al `es_owner` como a un `role='admin'` con `empresa_id`.
  Archivos: `supabase/functions/admin-users/index.ts`, `src/pages/Usuarios.tsx`.
  Deploy realizado a Supabase Cloud el 18-10-2026.

## 7. Verificación realizada

- **End-to-end (10/10):** login, crear empresa+admin+prueba, seed, venta POS con IVA,
  validación de medio de pago, salida, transferencia (crear→despachar→recibir), rechazo por
  stock insuficiente, aislamiento RLS entre empresas, bloqueo de `anon` en RPC.
- **RLS específico:** usuario restringido ve solo su tienda; admin ve todo; cuenta desactivada
  lee 0 filas.
- **Fix de aislamiento por ubicación (18-10-2026):** se detectó que el usuario de tienda de prueba veía la
  **Bodega Principal** aunque solo tenía acceso a 3 tiendas. Causa: la política RLS de
  `ubicaciones` no aplicaba `ubicacion_acceso`. Se creó y deployó `0009_ubicaciones_acceso.sql`.
  Validación posterior: Juan pasó de ver 4 ubicaciones a ver solo las 3 tiendas asignadas
  (Centro, Mall, Outlet).
- **UI / a11y (18-10-2026):** aplicadas mejoras del informe `REVISION_UI_WEB_GUIDELINES.md`
  (`aria-label` en botones solo-icono, `aria-live` en toasts, skip link, `focus-visible:` en
  inputs, `width`/`height`/`loading="lazy"` en imágenes, sombras con tinte, transiciones
  explícitas, `overscroll-behavior` sólo en desktop, `touch-action: manipulation`).
- **Rediseño (18-10-2026):** tipografía cambiada a Geist, sombras con variables temáticas,
  estados hover/active en botones y navegación, estados de carga/vacío pulidos.
- **Panel lateral de inventario/productos/movimientos (18-10-2026):** al hacer clic en un
  producto (Inventario o Productos) se abre un `SidePanel` con `ProductoDetalleView`; al hacer
  clic en un movimiento se abre un panel con `MovimientoDetalleView`. En todos los casos el
  panel flota a la derecha en escritorio y es una hoja en móvil (estilo Lumix). Se conserva la
  ruta `/inventario/:id` para acceso directo.
- **POS con vista lista/tarjetas (18-10-2026):** el catálogo del punto de venta ahora permite
  alternar entre la vista de tarjetas original y una vista de lista compacta (tabla), útil
  cuando hay muchos productos o se usa con teclado.
- **Productos con vista lista/tarjetas y filtros (18-10-2026):** el catálogo de productos permite
  alternar entre tarjetas y tabla, y ahora tiene búsqueda, chips de categoría con conteo y filtro
  por estado (activos/inactivos/sin stock/bajo mínimo).
- **Layout del POS mejorado (18-10-2026):** en escritorio el catálogo y el ticket tienen scroll
  interno dentro de un contenedor de altura fija, así los productos nunca pasan por debajo de los
  filtros y tanto la búsqueda como el ticket permanecen visibles. En móvil los filtros son
  `sticky` con fondo opaco + sombra, y el resumen flotante inferior abre el ticket completo.
- **Revisión de seguridad y corrección (18-10-2026):** se encontraron y corrigieron:
  - `anon` podía ejecutar `_stock_row` (SECURITY DEFINER): leía/creaba stock de cualquier empresa.
  - Un usuario restringido podía borrar sus filas de `ubicacion_acceso` y pasar a ver todo.
  - Un usuario podía cambiar su propio `puesto`, `permissions` y `email` (escalada de permisos).
  - Cualquier rol podía editar `stock` y borrar `movimientos`/`vouchers`/`ventas` directo vía API.
  - `registrar_venta` usaba el precio enviado por el cliente (se podía vender a $1).
  - Módulos, capacidades y prueba vencida solo se validaban en el front.
  - Transferencias: se podía recibir más de lo enviado y despachar sin acceso al origen; el destino
    no se validaba como de la misma empresa.
  - Edge Function: ubicaciones de otra empresa en `crear_usuario`, error de inserción ignorado,
    admin de empresa podía resetear la clave de otro admin, `prueba_dias` sin validar.
  - Offline: ventas sin idempotencia (reintento = venta y descuento duplicados), salidas
    reintentadas quedaban trabadas, errores definitivos se reintentaban sin fin, cola compartida
    entre usuarios del mismo equipo, sin sincronización al abrir la app.
  - `owner_bootstrap.sql` fallaba desde 0007 (el trigger bloqueaba conexiones sin JWT).
  Corrección: migración `0010`, Edge Function redeployada, `SyncProvider`/`db.ts`/`errores.ts`,
  POS y Salida rápida con `uuid_local` y paso a la cola si cae la red, pantalla `/sync` con
  rechazadas (reintentar/descartar), `Usuarios` oculta acciones no permitidas.
  **Verificación reproducible:** `npm run test:seguridad` (24 casos, se ejecutan y se revierten):
  antes de 0010 fallaban 15, después pasan los 24 en producción. Edge Function probada en vivo
  (401/403/400 en los casos de rechazo).
- **Ajuste a las skills de UI (18-10-2026):** auditoría de todo `src/` con `web-design-guidelines`,
  `redesign-existing-projects` y `minimalist-ui`. Corregido:
  - `SidePanel` usaba clases `animate-in`/`slide-in-from-right` sin plugin (no animaba): ahora
    `anim-fade-in` / `anim-panel-in` propias en `index.css` (respetan `prefers-reduced-motion`).
  - Borrados en Configuración (motivos, categorías, proveedores) y descarte en `/sync` piden
    confirmación con modal propio (`ConfirmProvider` + `useConfirm`), sin `window.confirm`.
  - Modo oscuro con `color-scheme`; `theme-color` sigue el fondo del tema.
  - Montos con `tabular-nums`; títulos con `text-balance`.
  - Correos sin corrector (`spellCheck={false}`) y sin autocompletar en formularios de admin.
  - Página 404 propia (`NoEncontrado`) dentro de la app.
  - **Acentos índigo y violeta retirados** (estética "IA" genérica según `redesign`); quedan
    terracota y azul (con variante oscura). Quien los tenía guardados vuelve a terracota.
  No adoptado a propósito de `minimalist-ui`: paleta monocroma/botón negro (choca con la
  identidad terracota), animaciones de scroll (estorban en el POS), cambiar Lucide por Phosphor
  (opcional, solo estético).
- **Alertas de quiebre y proyección de reposición (18-10-2026):**
  - Decisiones con el cliente: aviso **dentro de la app** (sin push ni correo por ahora),
    reposición **por tienda desde bodega** (si no alcanza, sugiere comprar), y **12 semanas de
    ventas simuladas** en la empresa demo (cargadas: 2.761 salidas con referencia `SIMULADO`;
    se borran desde Configuración, no alteran el stock).
  - Cálculo (`proyeccion_reposicion`, en la base): venta esperada de cada día = promedio de ese
    día de la semana en las últimas N semanas (más peso a las recientes: 0,85^semana); hoy
    descuenta lo ya vendido; demanda del período + % de seguridad (mínimo: stock mínimo) − stock
    disponible − en tránsito = **a reponer**. Fecha de quiebre simulando día a día (60 días).
    El stock de bodega se reparte entre tiendas, primero las que quiebran antes.
    Temporada: con > 1 año de datos compara con el mismo período del año anterior; además hay un
    **ajuste de temporada manual (%)**. Período por defecto: hasta el próximo domingo.
  - Estados: quebrado (0 ahora) · por quebrar (se agota dentro del período) · bajo mínimo · cubierto.
  - UI: campana con contador en la barra superior, tarjeta en el Dashboard, pantalla
    `/reposicion` (período, tienda, filtros, detalle con perfil semanal y proyección día a día,
    botón para **crear las transferencias sugeridas** desde bodega), parámetros en Configuración.
  - Se recalcula tras ventas, salidas y transferencias, y cada 5 minutos.
  - Móvil: la barra superior desbordaba la pantalla; se acotó el selector de ubicación y el
    botón de tema queda en Configuración → Apariencia en pantallas chicas.
  - Layout (mismo patrón que el POS): en escritorio encabezado, filtros y resumen quedan fijos
    y solo las filas hacen scroll, con títulos de columna fijos (`scroll-mt` para que el foco
    por teclado no quede tapado). Los 4 KPI grandes se reemplazaron por un resumen compacto.
    En móvil los chips de estado quedan pegados bajo la barra superior.
  - **Dashboard reordenado para gestionar** (se eliminó la duplicación «Alertas de quiebre» +
    «Productos críticos», y los KPI «Bajo mínimo»/«Sin stock»): 4 indicadores grandes y
    clicables (Quebrados, Por quebrar, Unidades a reponer, Transferencias pendientes) → llevan a
    `/reposicion` ya filtrada (`?estado=…&tienda=…`) o a Bodega; datos de contexto en una línea;
    «Reponer primero» (top 6) + «Alertas por tienda» (barras quebrados/por quebrar); gráficos al
    final. Una tienda seleccionada acota las alertas; una bodega muestra todas las tiendas.
  - Verificación: `npm run test:reposicion` (16 casos, caso controlado con resultado exacto),
    `npm run test:seguridad` sigue en 24/24, capturas reales en escritorio y móvil.
- **Reportes: seguimiento de ventas por tienda (18-10-2026)** (`/reportes`, guiado por la skill
  `dataviz`):
  - Período (hoy, 7 días, 28 días, este mes, mes anterior, rango) y tienda en la URL; todo se
    compara con el período anterior de igual largo (▲▼ con ícono y texto, no solo color).
  - Cifras: venta total (neto/IVA), N° de ventas, ticket promedio, unidades.
  - Ranking de tiendas (venta, participación, ventas, ticket, unidades, variación); clic filtra.
  - Venta diaria por tienda (líneas, leyenda, tooltip con total, vista tabla; «Hoy» marcado
    como en curso). Mapa de calor del promedio por día de la semana (turnos/reposición).
  - Top 10 productos, medios de pago, ventas por categoría, inventario valorizado.
  - Exportar CSV (separador «;» y BOM para Excel en español).
  - Colores por tienda: paleta categórica validada con `validate_palette.js` (claro y oscuro,
    apta para daltonismo), en tokens `--serie-1…8`; el color sigue a la tienda, no al ranking.
  - Datos: `reporte_ventas()` en la base (antes se sumaban solo las últimas 200 ventas en el
    navegador). La historia simulada ahora crea ventas completas (1.403 tickets de 12 semanas
    regenerados en la demo), así reportes y proyección usan los mismos datos.
  - Cifras grandes sin `tabular-nums` (anti-patrón de la skill); también en Dashboard y KpiCard.
  - Verificación: `npm run test:reportes` (7 casos; la coherencia reporte = ventas = ítems =
    movimientos pasó en 7 corridas con datos aleatorios); capturas en claro, oscuro y móvil
    (se corrigió un desborde horizontal en móvil).
- **POS offline confiable + productos sin control de stock (18-10-2026):**
  - Copia local por usuario en IndexedDB (perfil, empresa, ubicaciones, productos con stock por
    ubicación, categorías, motivos) que se actualiza cada vez que hay conexión
    (`src/core/offline/respaldo.ts`). El stock mostrado descuenta lo que aún está en la cola.
  - Sin conexión no se espera a Supabase (su `getSession` reintentaba renovar el token y la app
    quedaba en «Cargando Mi Socio Pyme…»): se usa la sesión guardada en el dispositivo aunque el token
    haya vencido; al volver la red Supabase la renueva y la cola reintenta cada 60 s.
  - La caché genérica de la API en el service worker se eliminó (podía mostrar datos de otro
    usuario en un equipo compartido); quedan el shell de la app y las fotos.
  - Ventas y salidas encoladas sin conexión se registran aunque el stock ya no alcance (el cliente
    ya pagó): el stock queda en 0, se guarda `sin_stock` y el Dashboard avisa «ventas sin conexión
    registradas sin stock suficiente».
  - `controla_stock` por producto: los productos sin inventario se venden siempre, no generan
    movimientos, no aparecen en Inventario/Ingreso/Bodega/Salida rápida ni en Reposición, pero sí
    en reportes. `tipo_negocio` (Configuración y al crear empresa) solo define el valor por defecto
    en productos nuevos. La historia simulada también vende productos sin inventario.
  - Verificación: `npm run test:control-stock` (10 casos) + las 3 suites anteriores sin
    regresiones; **prueba real sin conexión** con el build de producción y Chrome sin red: recarga
    del POS con 13 productos desde la copia local, venta encolada, token vencido sin red sin
    salir del POS, y al reconectar la venta se sincronizó (`VTA-261018-00114`, luego borrada).
  - Nota: la clave de el usuario de tienda de prueba en `Datakeys.md` ya no es válida (el login la rechaza).
- **Recepción con diferencias y ubicaciones editables (18-10-2026):**
  - Bodega: «Confirmar recepción» abre un modal con lo enviado por producto para ingresar lo que
    llegó (0 a lo enviado); avisa que quedará «Recibida con diferencias» y la lista muestra
    «Faltaron N u.». Probado de punta a punta (`TRF-261018-00126`: 2 enviadas, 1 recibida, queda
    en la demo como ejemplo).
  - Ubicaciones de un usuario ya creado: nueva acción `actualizar_ubicaciones` de la Edge Function
    (primero agrega y después quita, para no pasar nunca por «sin filas = todas»; mismas reglas
    que reset/activar: un admin de empresa no edita a otro admin ni a sí mismo). Selector con
    opción explícita «Todas las ubicaciones» en Usuarios (dentro de Permisos), al crear usuario y
    en el detalle de empresa del Admin general; cada usuario muestra su resumen de ubicaciones.
    Probado en vivo (ajena → 400, sobre sí mismo → 400, 3 → 2 → todas → 3 restaurado).
  - `Datakeys.md`: se agregó la clave del Admin general (al sacarla de la bitácora no se había
    copiado ahí).
- **Tallas y colores + devoluciones/anulaciones (18-10-2026):**
  - Variantes: cada talla/color tiene su stock. Si un producto tiene variantes hay que elegir una
    al vender (selector en el POS y en Salida rápida), ingresar o transferir (una opción por talla
    en los selectores). El stock antiguo sin talla puede seguir saliendo hasta agotarse, pero no se
    le agrega más. Gestor en Productos (crea combinaciones talla × color; se desactivan, nunca se
    borran), detalle por talla en Inventario, talla visible en Reposición y Dashboard, orden natural
    S, M, L / numéricas. La venta guarda «Producto · talla».
  - Demo: S/M/L para las 4 prendas (12 variantes, stock repartido) y 1.634 ventas simuladas por talla.
  - Devoluciones: desde el comprobante de una venta, «Devolver o anular» (requiere conexión y el
    permiso «Devolver o anular ventas», por defecto solo administradores). Parcial o total, motivo
    obligatorio, el stock vuelve a la tienda (movimiento de entrada), el reembolso se prorratea con
    el descuento de la venta, queda comprobante DEV-… enlazado y nada se borra. El reporte de ventas
    descuenta lo devuelto, excluye las anuladas y muestra el total devuelto.
  - Verificación: `npm run test:variantes` (17 casos) + las 4 suites anteriores sin regresiones; E2E
    en el navegador: venta «Vestido Lino Goa · M» ×2 (`VTA-261018-00180`) y devolución de 1
    (`DEV-261018-00181`, $25.990), quedan en la demo como ejemplo; prueba real sin conexión repetida
    con el build de producción (venta de prueba luego borrada).
- **Tallas y colores opcionales por empresa (18-10-2026):** «Usar tallas y colores» en
  Configuración → Empresa (apagado por defecto; la demo quedó encendida porque ya tenía tallas).
  Apagado: no se pueden crear variantes (RLS) ni se exige elegirlas, y el gestor no aparece en
  Productos. No se puede apagar con variantes activas, y no se puede desactivar una variante que
  aún tiene stock (evita mercadería invisible). `npm run test:variantes-opcionales` (8 casos) y las
  5 suites anteriores sin regresiones; probado en la app (el rechazo muestra el aviso y la casilla
  vuelve a su valor real). También: «vence hace instantes» del plan ahora muestra la fecha.
- **Productos = mantenedor del catálogo (18-10-2026):** se quitó lo que era de Inventario (panel
  de existencias y movimientos al hacer clic, filtros «Sin stock»/«Bajo mínimo», columna «Mínimo»).
  Clic en un producto abre su ficha (solo lectura sin permiso `productos.gestionar`); columnas
  precio, costo, margen, tipo (con inventario / sin inventario / N tallas) y estado; filtros activo,
  inactivo, sin inventario y con tallas; ficha en secciones (datos, precio con margen, inventario,
  tallas y colores). El stock y su historial siguen en Inventario.
  Ajuste pedido: la ficha se abre en el **panel lateral derecho** (como antes) y crear un producto es
  **súper simple**: solo nombre, precio y categoría; el código (SKU) se asigna solo si se deja vacío
  (p. ej. `ROP-005`, o `PRD-001` sin categoría); costo, marca, código de barras, foto, descripción,
  inventario y tallas quedan en «Más opciones», cerrado por defecto.
- **Ficha simple de producto con precio por margen, foto y código de barras (18-10-2026):**
  - Parte simple: foto, nombre, **costo neto → margen % → precio de venta** (enlazados: precio =
    costo ÷ (1 − margen) × 1,19, redondeado a $10; si se edita el precio se recalcula el margen; avisa si
    el precio no cubre el costo), categoría, stock mínimo y código de barras. El resto (código interno,
    marca, descripción, controla stock, unidad, tallas) en «Más opciones». Margen de la lista = sobre neto.
  - Foto: «Tomar foto» abre la cámara trasera del celular (o «Elegir imagen»); se comprime en el
    navegador (WebP, lado mayor 1000 px, ~100 KB) y se guarda en Storage (bucket público `productos`,
    carpeta de la empresa; solo escribe quien gestiona productos). El service worker cachea esas fotos
    para el POS sin conexión. Si se cancela un producto nuevo, su foto se borra.
  - Código de barras: botón «Generar» crea un EAN-13 interno (prefijo 2, único en la empresa, validado);
    vista previa y «Imprimir etiqueta» (62×40 mm, nombre, código y precio). Único por empresa en la base.
  - Migración `0016`; `npm run test:fotos` (5 casos); E2E: costo 5.000 + 40% → $9.920, EAN generado,
    foto subida (WebP) y URL pública 200; datos de prueba borrados (producto y archivo).
- **Vista lista por defecto (18-10-2026):** POS, Productos e Inventario arrancan en lista; un
  único `SelectorVista` (lista primero, tarjetas después, con `aria-pressed`) reemplaza los tres
  selectores distintos que había.
- **POS rápido para caja sin lector + tablero en Bodega (18-10-2026):**
  - El POS deja de parecerse a Inventario: sin columnas de stock/estado; solo nombre y precio, y el
    stock aparece únicamente si importa («Quedan 3», «Agotado»).
  - Catálogo ordenado por lo **más vendido en esa tienda (30 días)** (`ranking_ventas`, migración
    `0017`; con copia local para offline).
  - Vistas: **Lista compacta** (por defecto, filas altas para tocar) y **Botones** (grilla tipo caja con
    miniatura, nombre y precio).
  - Teclado: buscador siempre enfocado (en PC), Enter agrega el primer resultado, «3*» multiplica,
    Esc limpia, F9 cobra.
  - Efectivo: billetes rápidos (Exacto, $15.000, $20.000…) y vuelto; botón «Cobrar $X».
  - Sin modal al cobrar: aviso «Última venta: VTA-… $X» y la caja queda lista (foco en el buscador).
  - Bodega: vista **Tablero por estado** (Pendiente de despacho · En tránsito · Recibidas recientes) con
    unidades, fecha, faltantes y acciones; la lista sigue siendo la vista por defecto.
  - `SelectorVista` ahora acepta opciones propias. E2E: orden por ventas en Tienda Centro, «2*aret»+Enter
    → 2 u., vuelto $20, F9 cobró sin modal (venta de prueba borrada); móvil sin desborde.
- **Ingreso de mercadería rápido (18-10-2026):**
  - Captura: buscador por nombre, código o lector; Enter agrega el primer resultado y deja el foco en
    la cantidad. Una fila por producto; con tallas, una casilla por talla en la misma fila.
  - El costo viene con el último costo del producto; si cambia muestra «Antes $X · margen N%» (en
    rojo si ya no hay margen). Totales: unidades, neto, IVA y total.
  - **Documento del proveedor opcional** (plegable): factura/guía/boleta/otro, número, fecha y
    «Actualizar el costo de los productos con lo pagado» (solo con `productos.gestionar`; el precio de
    venta no cambia). Migración `0018`.
  - **Crear producto en la recepción:** si no existe, «Crear producto «texto»» (o Enter sin
    resultados) abre la ficha simple (`CrearProductoRapido`: foto, nombre, costo/margen/precio,
    categoría, stock mínimo, código de barras) y lo agrega a la recepción. El SKU automático se
    comparte con Productos (`src/lib/sku.ts`).
  - Al confirmar, resumen «Recepción registrada» y botón para otra.
  - Pruebas: SQL de 0018 (documento, costo 6000→6500, llamada antigua de 5 parámetros, tipo inválido
    rechazado) + regresión seguridad/control de stock/variantes. E2E: «aret»+Enter → foco en
    cantidad, 3 u. con costo nuevo, producto creado en el momento con 4 u., factura 998877; totales
    $11.800 + IVA = $14.042; base verificada y datos de prueba borrados.
- **Módulo restaurante: mesas, comandas y propina (18-10-2026):**
  - Se activa por empresa con los módulos **Mesas** y **Cocina** (los asigna el administrador general).
    Puesto «tienda» = garzón/cajero/cocina; las mesas las configura quien tiene `config.gestionar`.
  - **Mesas** (`/mesas`): salón por zonas (libre / ocupada con total, minutos y «En cocina» o «Lista»).
    Tocar una mesa libre abre el catálogo (más vendidos primero, categorías, buscador con Enter):
    el pedido se arma a la derecha con cantidades y **nota para cocina** («sin cebolla») y se envía
    como **comanda numerada** (por tienda y día). La cuenta queda abierta y se puede seguir
    agregando. Acciones: marcar entregada, quitar un ítem (con motivo si cocina ya empezó),
    **mover a otra mesa**, **precuenta** impresa (80 mm, con propina sugerida) y anular la cuenta
    (con pedidos solo quien tiene `ventas.devolver`, con motivo). «Configurar mesas» agrega varias de
    una vez (sigue la numeración) y edita nombre, zona y personas.
  - **Cobro**: propina sugerida 10 % (o sin propina u otro monto), efectivo con billetes y vuelto,
    débito o transferencia con referencia. Genera una venta normal (`registrar_venta`: precio
    vigente, stock de bebidas, voucher) y la propina queda aparte del total (sin IVA) con el garzón
    que abrió la mesa. El comprobante muestra mesa, propina y total pagado.
  - **Cocina** (`/cocina`): tablero Por preparar → En preparación → Listas, en **tiempo real**
    (Supabase Realtime + recarga cada 20 s de respaldo), minutos de espera (ámbar ≥12, rojo ≥20),
    notas destacadas, pitido al llegar una comanda (se puede silenciar) y botón para deshacer.
  - **Reportes**: tarjeta «Propinas por garzón» (mesas, consumo, propinas y %).
  - Mesas necesita conexión (el POS sigue siendo el que vende sin conexión).
  - Pruebas: `npm run test:restaurante` (25 casos: apertura con comanda, correlativo, estados,
    anulación con motivo, mover, propina > total, cobro con stock/voucher/garzón, no se cobra dos
    veces, permisos, RLS, otra tienda, módulo apagado) + regresión. E2E con dos pestañas: la comanda
    llegó sola a Cocina, «Lista» apareció en el salón, cobro $104.970 + propina $10.500, reporte y
    comprobante correctos, móvil sin desborde; venta y cuentas de prueba borradas.
  - Demo: módulos activos en la empresa de prueba y 8 mesas en Tienda Centro (Salón 1–6, Terraza 7–8).
- **Nombre nuevo y repositorio público (18-10-2026):**
  - El sistema pasa a llamarse **Mi Socio Pyme** (antes StockFlow): título, login, menú, PWA
    («Socio Pyme» en el ícono), README y documentos. Claves del navegador con prefijo
    `misociopyme:` y base offline `misociopyme` (sin usuarios reales, no hubo que migrar nada).
  - Código publicado en `github.com/gsdm-maker/Ventas-Pymes` (público) con un historial limpio;
    el historial completo queda en un repositorio privado de respaldo.
  - Sin datos sensibles en el repositorio: las pruebas SQL usan `{{USUARIO_TIENDA}}` y
    `{{USUARIO_ADMIN}}`, que `scripts/sql-remoto.mjs` toma de `Datakeys.md` («Prueba tienda:» /
    «Prueba admin:») o de `PRUEBAS_USUARIO_*`; `index.html` usa `%VITE_SUPABASE_URL%`.
- **Publicado en Netlify (18-10-2026):** https://mi-socio-pyme.netlify.app (equipo `gsdm-maker`,
  proyecto `mi-socio-pyme`). Variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` cargadas en
  Netlify. Supabase Auth: `site_url` = la URL de Netlify y redirecciones permitidas para Netlify y
  localhost (recuperar clave). CSP: se agregó `blob:` a `img-src` e `images.unsplash.com` a
  `connect-src` (el service worker descarga las fotos con `fetch` y lo rige `connect-src`; sin eso
  las fotos de Unsplash no cargaban en producción). Verificado en producción: login, POS, fotos
  14/14, Mesas, Cocina, Reportes, service worker activo y sin violaciones de CSP.
  Cada push a `main` publica solo (repositorio conectado); a mano: `npx netlify-cli deploy --prod --build`.
- **Revisión completa y plan de mejoras (24-10-2026)** — ver `PLAN_MEJORAS.md`:
  - **Rubro y módulos los define el administrador general** (Consola → detalle de empresa → «Rubro y
    módulos»; acción auditada `actualizar_modulos` en la Edge Function). En Configuración el admin de
    empresa los ve en solo lectura; el aviso del plan/prueba se mantiene.
  - **Permisos por usuario:** al crear o editar, vienen marcados según el puesto y el admin los ajusta,
    solo dentro de los módulos habilitados. Antes, marcar un *módulo* extra a un usuario no tenía
    efecto (front y base lo ignoraban). Un admin no puede otorgar lo que no tiene.
  - Correcciones: variantes/categorías apuntando a otra empresa; cerrar sesión sin conexión; la cola
    offline ya no marca como rechazadas las ventas enviadas sin sesión (401) ni envía operaciones con
    el token de otro usuario; descuento con decimales; alertas de stock por usuario; salida offline
    reenviada en paralelo.
  - Probado con `--antes` (revertido): suite nueva `modulos_permisos.sql` (24 casos) y todas las
    anteriores. `reportes.sql` «reporte coincide…» ya fallaba antes de 0020 (pendiente revisar).
- **POS más compacto (24-10-2026):** en escritorio todo cabe en la pantalla (antes, a 1280×720 el botón
  Cobrar quedaba fuera de la vista); el detalle del ticket se desplaza y descuento, medio de pago, totales y
  Cobrar quedan fijos abajo. Descuento en un solo control alineado (valor + %/$), medios de pago en una fila,
  neto e IVA en una línea, vuelto junto a los totales, filas y tarjetas del catálogo más bajas. Revisado con
  capturas a 1440×900, 1280×720 y 390×844 (lista, tarjetas y ticket en móvil).
- **Encabezado más bajo en todas las pantallas (24-10-2026):** en escritorio, la empresa y su plan pasan a la
  barra lateral (en lugar de «Mi Socio Pyme», el logo se mantiene) y el título de cada pantalla con su subtítulo
  va en la barra superior (`PageHeader` lo coloca con un portal en `TituloSlotContext`); en la página quedan solo
  las acciones. En móvil no cambia. POS: código (SKU) junto al nombre en catálogo y ticket, ticket más ancho
  (380–420 px) y con más aire.
- **Reposición y Productos (24-10-2026):** «Transferir desde bodega» pasa a la fila de cifras (más compactas) en
  vez de ir en el encabezado; «Nuevo producto» es un botón flotante abajo a la derecha (sobre la barra inferior en
  móvil, se oculta con la ficha abierta).
- **Carga más rápida (24-10-2026)**, medido en la versión de producción (mediana de 3, 1280×720):
  - Consultas en paralelo: catálogo (4 → 1 viaje), resumen del Dashboard (6 → 1) y datos de sesión (perfil con su
    empresa embebida + ubicaciones: 3 → 1).
  - Pantallas con `React.lazy` (salvo login, cambiar y restablecer clave); recharts queda en su propio archivo.
    JS principal 313 → 143 KB comprimido; el service worker sigue guardando todo (62 archivos) para usar sin conexión.
  - Datos listos: Dashboard 2,7 → 0,85 s · POS 1,7 → 0,8 s · Productos 1,7 → 0,9 s · Inventario 1,7 → 0,8 s ·
    Reposición 1,2 → 0,8 s.
- **Aviso de versión nueva (24-10-2026):** antes, tras publicar, una pestaña abierta seguía con la versión vieja
  (había que recargar dos veces). Ahora el service worker es `registerType: prompt` + `clientsClaim`, la app lo
  registra (`AvisoActualizacion`), revisa cada 30 min y muestra «Hay una versión nueva · Actualizar». No recarga
  sola para no borrar un ticket en curso. Probado: aviso visible y recarga al pulsar Actualizar.
- `typecheck`, lint y `vite build` sin errores. Dev server en `http://localhost:5173`.

## 8. Skills de agente instaladas (`.agents/skills/`)

- **15 skills** vía `npx skills` (CLI de Vercel Labs):
  - De `Leonxlnx/taste-skill` (14): `redesign-existing-projects`, `minimalist-ui`,
    `high-end-visual-design`, `full-output-enforcement`, `design-taste-frontend`
    (+ v1/v2-exp), `gpt-taste`, `industrial-brutalist-ui`, `stitch-design-taste`,
    `image-to-code`, `imagegen-frontend-web/-mobile`, `brandkit`.
  - De `vercel-labs/agent-skills` (1): **`web-design-guidelines`** (revisión de UI accesible).
- Recomendadas para Mi Socio Pyme (dashboard/POS): `redesign-existing-projects`,
  `minimalist-ui`, `web-design-guidelines`.

## 9. Pendientes / próximos pasos

- [x] **Revisión UI** con `web-design-guidelines` sobre Login, Dashboard, POS, Inventario y
      AppShell → informe en `REVISION_UI_WEB_GUIDELINES.md`.
- [x] **Aplicar mejoras de UI** según el informe (alta y media).
- [x] **Rediseño** con `redesign-existing-projects` (tipografía Geist, sombras temáticas,
      estados hover/active, estados de carga/vacío).
- [x] **Revisión de seguridad** + migración `0010` + Edge Function + sync offline (18-10-2026).
- [ ] **Rotar el token personal `sbp_…`** (Supabase → Account → Access Tokens) y la clave de la
      BD si `Datakeys.md` se compartió; actualizar `Datakeys.md`.
- [x] Editar ubicaciones autorizadas de un usuario ya creado (`actualizar_ubicaciones`).
- [x] Repositorio git con commits (falta un remoto de respaldo, p. ej. GitHub privado).
- [x] Publicar el front (Netlify) y agregar su URL en Auth de Supabase.
- [x] POS offline confiable y productos sin control de stock (retail/restaurante).
- [x] Tallas y colores (variantes) y devoluciones/anulaciones auditadas.
- [x] `supabase db push` (0020) y despliegue de `admin-users` (24-10-2026).
- [x] Front publicado (commit y push a `main`, 24-10-2026).
- [x] `0021` (desactivar ubicaciones) aplicada (24-10-2026).
- [ ] Revisar `reportes.sql` «reporte coincide con ventas, ítems y movimientos» (falla desde antes de 0020).
- [ ] Ajuste de inventario por conteo físico (permiso existe, falta pantalla y RPC).
- [ ] Cierre de caja diario por cajero y tienda.
- [ ] (Opcional) Historial de recepciones y «cargar compra sugerida» desde Reposición.
- [x] Módulo restaurante: mesas, comandas a cocina y propina.
- [ ] (Opcional) Restaurante: modificadores con precio (agregados, término) y dividir la cuenta.
- [ ] Actualizar en `Datakeys.md` la clave de el usuario de tienda de prueba.
- [ ] (Opcional) Aviso de quiebres por push o correo diario (hoy solo dentro de la app).
- [x] Recepción de transferencias con cantidades reales (modal en Bodega).
- [ ] (Opcional) SMTP propio para correos de recuperación confiables.
- [x] Repositorio conectado en Netlify: cada push a `main` publica automáticamente.

## 10. Archivos de referencia

- `Descripcion sistema.md` — brief original.
- `BUENAS_PRACTICAS_LUMIX.md` — buenas prácticas (versión final aplicada a Mi Socio Pyme).
- `REVISION_UI_WEB_GUIDELINES.md` — informe de la revisión de UI.
- `README.md` — puesta en marcha.
- `Datakeys.md` — credenciales (no versionar).
- `supabase/pruebas/seguridad.sql` — pruebas de RLS/RPC como usuarios reales (se revierten).
- `supabase/pruebas/reposicion.sql` — pruebas del cálculo de reposición (se revierten).
- `supabase/pruebas/reportes.sql` — pruebas del reporte de ventas (se revierten).
- `supabase/pruebas/control_stock.sql` — productos sin control de stock y ventas offline (se revierten).
- `supabase/pruebas/variantes_devoluciones.sql` — tallas/colores y devoluciones (se revierten).
- `supabase/pruebas/variantes_opcionales.sql` — opción por empresa de tallas/colores (se revierten).
- `supabase/pruebas/fotos_codigos.sql` — fotos en Storage y código de barras único (se revierten).
- `scripts/sql-remoto.mjs` — ejecuta SQL en el proyecto vía Management API (`npm run test:seguridad`).
