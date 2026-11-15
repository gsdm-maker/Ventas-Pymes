# Bitácora de decisiones — Mi Socio Pyme

Solo decisiones, motivos y trampas que git no explica. Se agrega al final; no se reescribe.
**No leer completa**: buscar por etiqueta (`#offline`) o fecha. Lo último realizado está en `ESTADO.md`.
Registro detallado hasta el 31-10-2026 (qué se hizo y cómo se verificó): `docs/BITACORA-historica.md`.

## 2026-10-18 | #alcance #producto | Alcance cerrado con el cliente
Decisión: inventario + ventas (POS) sin pasarela de pago; solo voucher interno, sin boleta ni factura. Sin vencimientos ni lotes. Sin catálogo público.
Motivo: acordado con el cliente; el medio de pago y su referencia se guardan como dato (referencia obligatoria salvo efectivo).
Nota: CLP sin decimales, IVA 19 % incluido con desglose.

## 2026-10-18 | #auth #onboarding #roles | Sin auto-registro y dos niveles de administrador
Decisión: el Admin general (plataforma) crea las cuentas y asigna la prueba; el Admin de empresa crea usuarios, claves y permisos dentro de su empresa.
Motivo: control comercial del alta de clientes.
Trampa: un admin de empresa no puede modificarse a sí mismo ni a otro admin de su empresa; eso lo hace el Admin general (desde 0010).

## 2026-10-18 | #ubicaciones #rls | «Sin filas en ubicacion_acceso» significa «todas»
Decisión: un usuario sin filas ve todas las ubicaciones de su empresa; con filas, solo esas.
Trampa: la política de `ubicaciones` no aplicaba `ubicacion_acceso` (un usuario de tienda veía la bodega): corregido en 0009. Al editar accesos, primero agregar y después quitar, para no pasar nunca por «sin filas = todas». Un usuario restringido no debe poder borrar sus propias filas.

## 2026-10-18 | #seguridad #rls #rpc | Revisión de seguridad (migración 0010)
Decisión: toda regla se valida en la base; módulos, capacidades y prueba vencida ya no dependen del front.
Trampa: `registrar_venta` usaba el precio enviado por el cliente (se podía vender a $1): el precio se toma siempre de la base. `anon` podía ejecutar una función `security definer`. Un usuario podía cambiar su propio `puesto` y `permissions`. En transferencias se podía recibir más de lo enviado.
Verificación: `npm run test:seguridad`.

## 2026-10-18 | #offline #pos | Qué funciona sin conexión
Decisión: solo POS y ventas (más salida rápida en retail). Ingreso, transferencias, devoluciones y configuración requieren conexión.
Motivo: son las operaciones que no pueden detenerse en caja.
Decisión: una venta encolada se registra aunque el stock ya no alcance (el cliente ya pagó): el stock queda en 0, se marca `sin_stock` y el Dashboard avisa.
Trampa: sin red no esperar a `getSession` de Supabase (reintenta renovar el token y la app queda en «Cargando…»): usar la sesión guardada. Ventas con `uuid_local` para que un reintento no duplique. Se eliminó la caché genérica de la API en el service worker porque podía mostrar datos de otro usuario en un equipo compartido. La cola es por usuario.

## 2026-10-18 | #stock #restaurante | Cada producto decide si controla stock
Decisión: `controla_stock` es por producto; `tipo_negocio` solo define el valor por defecto de los productos nuevos.
Motivo: un restaurante mezcla bebidas con inventario y platos sin inventario.
Nota: los productos sin inventario no generan movimientos ni aparecen en Inventario, Ingreso, Bodega ni Reposición, pero sí en reportes.

## 2026-10-18 | #variantes | Tallas y colores opcionales por empresa
Decisión: apagado por defecto. Las variantes se desactivan, nunca se borran.
Trampa: no se puede apagar la opción con variantes activas ni desactivar una variante con stock (evita mercadería invisible). El stock antiguo sin talla puede salir hasta agotarse, pero no se le agrega más.

## 2026-10-18 | #devoluciones | Devolver o anular no borra nada
Decisión: genera un comprobante DEV enlazado; el stock vuelve con un movimiento de entrada; el reembolso se prorratea con el descuento de la venta. Requiere conexión y permiso propio (por defecto solo administradores).
Motivo: trazabilidad; el reporte descuenta lo devuelto y excluye las anuladas.

## 2026-10-18 | #reposicion | Cómo se calcula la reposición
Decisión: aviso solo dentro de la app (sin push ni correo); reposición por tienda desde bodega y, si no alcanza, sugiere comprar. El cálculo vive en la base (`proyeccion_reposicion`).
Motivo: venta esperada = promedio de ese día de la semana en las últimas N semanas, con más peso a las recientes (0,85^semana); más % de seguridad, menos disponible y tránsito.
Verificación: `npm run test:reposicion`.

## 2026-10-18 | #reportes | Los reportes se calculan en la base
Decisión: `reporte_ventas()` en la base.
Motivo: antes se sumaban solo las últimas 200 ventas en el navegador.
Nota: la historia simulada crea ventas completas, para que reportes y proyección usen los mismos datos. CSV con separador «;» y BOM para Excel en español.

## 2026-10-18 | #productos #precio | Precio por margen y código de barras
Decisión: precio = costo ÷ (1 − margen) × 1,19, redondeado a $10; el margen se muestra sobre neto. SKU automático si se deja vacío. EAN-13 interno con prefijo 2, único por empresa en la base.
Decisión: Productos es el mantenedor del catálogo; el stock y su historial viven en Inventario.

## 2026-10-18 | #diseno #ui | Identidad y lo que se descartó
Decisión: terracota/beige (se descartó petróleo). Acentos índigo y violeta retirados; quedan terracota y azul.
Motivo: índigo/violeta daban una estética genérica «de IA».
Descartado a propósito: paleta monocroma y botón negro (choca con la identidad), animaciones de scroll (estorban en el POS). Confirmaciones con modal propio, sin `window.confirm`.

## 2026-10-18 | #repo #despliegue | Repositorio público con despliegue automático
Decisión: el repo `origin` es público y cada push a `main` publica en Netlify.
Trampa: nunca subir correos reales, el id del proyecto Supabase ni `Datakeys.md`. Orden de despliegue: db push → functions deploy → git push.

## 2026-10-24 | #permisos #modulos | Quién habilita qué
Decisión: el Admin general define rubro y módulos de cada empresa; el Admin de empresa da accesos por usuario solo dentro de esos módulos.
Trampa: antes, marcar un módulo extra a un usuario no tenía efecto real. Detalle en `PLAN_MEJORAS.md` sección A.
Verificación: `npm run test:permisos`.

## 2026-10-25 | #restaurante #cocina | Las comandas avanzan de a un paso
Decisión: pendiente ⇄ preparando ⇄ lista ⇄ entregada, un paso por vez (0024).
Motivo: antes se aceptaba cualquier salto de estado.

## 2026-10-25 | #arquitectura | Capa de datos por tema
Decisión: ninguna pantalla llama a Supabase directo; todo pasa por `src/core/data/`. Reglas puras en `src/lib/`.

## 2026-10-31 | #camara #csp | El escáner necesita permiso de cámara en las cabeceras
Trampa: `Permissions-Policy` bloqueaba la cámara; debe ser `camera=(self)` en `netlify.toml`. Requiere https.

## 2026-11-14 | #planes #comercial | Niveles de plan
Decisión: Socio · Socio Pro · Socio Pro Max; anual = Socio Pro Max; prueba de 15 días en Socio Pro; licencia Dueño por cotización.
Detalle: `PLAN_MEJORAS.md` secciones G0–G7.

## 2026-11-15 | #planes #alcance | Cobro de la suscripción del sistema con Flow
Decisión: la suscripción de Mi Socio Pyme se cobra con Flow (cliente + tarjeta registrada + plan + suscripción). La base solo registra lo que Flow confirma: el plan se activa o extiende con un cobro pagado, hasta el fin del período que informa Flow, y nunca se acorta. «A medida» y «dueño» siguen manuales.
Motivo: Flow guarda la tarjeta en su página y trae reintentos y morosidad; Mercado Pago exigía tokenizar la tarjeta en nuestro sitio para planes y su comisión no se pudo confirmar. La entrada de 2026-10-18 «sin pasarela» habla del POS del cliente, no de esto.
Precio: un cambio de precio rige para todas las suscripciones (decisión del dueño). Flow no deja editar el monto de un plan con suscriptores: se crea el plan nuevo (id con el precio) y cada suscripción vigente se mueve con `subscription/changePlan`.
Trampa: Flow avisa solo con un `token` sin firma (hay que consultar el estado con la clave) y no documenta qué envía el `urlCallback` del plan; por eso el importe es único en `cobros_flow` y hace falta una sincronización diaria de respaldo.

## 2026-11-15 | #suscripcion #flow #seguridad | Cobro automático con Flow: la verdad viene de Flow
Decisión: la Edge Function nunca registra un pago por lo que llega en un aviso o retorno; consulta a Flow con la clave del comercio y recién ahí llama a las funciones `flow_*` (solo `service_role`). Contratar no da acceso: el plan se activa o extiende solo con un importe pagado.
Motivo: `verify_jwt = false` es obligatorio porque Flow no manda sesión, y el aviso de cobro es público y sin documentar; confiar en su contenido permitiría activar planes sin pagar.
Trampa: Flow no deja editar el monto de un plan con suscriptores; el id del plan lleva el precio (`msp-m-mensual-20000`) y un precio nuevo crea otro plan y mueve las suscripciones con `changePlan`. `APP_URL` debe ser el origen de la app (CORS y retorno): para probar en local hay que ponerlo en `http://localhost:5173` y devolverlo después.
