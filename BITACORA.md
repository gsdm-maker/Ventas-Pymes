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

## 2026-11-22 | #vps #migracion #arquitectura | Salir de Supabase hacia un VPS con una base por proyecto
Decisión: llevar los proyectos a un VPS con un Postgres y una base separada por proyecto (PostgREST + login propio + almacenamiento), no a un Supabase autoalojado por proyecto.
Motivo: el plan gratis de Supabase permite 2 proyectos activos y hay 4 (luego 6); pesa más el costo y la escalabilidad que el tiempo. Un stack Supabase completo por proyecto no cabe en ~6 GB de RAM libres; PostgREST + login liviano sí.
Trampa: el VPS ya tenía un ambiente de Mi Socio Pyme y un stack Supabase detenido; auditar antes de rehacer. Cambiar de modelo a mitad de conversación obliga a releer todo el historial: cerrar la tarea y `/clear` antes de `/model`.

## 2026-11-22 | #vps #migracion #arquitectura #seguridad | Plantilla VPS: GoTrue + storage-api y roles compartidos con login por proyecto
Decisión: retirar el API Deno del VPS y usar GoTrue y storage-api de Supabase por proyecto; funciones en Deno (no Node); Realtime después. Roles sin login con nombres de Supabase compartidos en el cluster y roles con login `<p>_authenticator/_auth/_storage` con CONNECT solo a su base, más pg_hba por base y secreto JWT propio.
Motivo: GoTrue lee el `auth.users` de un dump de Supabase tal cual (nadie cambia su clave) y cubre refresh, recuperación y admin; los nombres compartidos evitan reescribir 30 migraciones. Las migraciones corren con `SET ROLE <p>_owner` para que las SECURITY DEFINER no sean del superusuario.
Trampa: los roles de Postgres son de todo el cluster: nunca `ALTER ROLE` global ni CONNECT a los compartidos. El ambiente del VPS tenía `auth.role()` con 'authenticated' por defecto y `auth.uid()` con respaldo en `app.user_id`: cambia la semántica de `proteger_*` respecto a Supabase.

## 2026-11-22 | #vps #migracion #seguridad | Suites del VPS con datos ficticios, no con copia de producción
Decisión: correr las 15 suites en `msp_prueba` con dos empresas y usuarios ficticios (`@prueba.invalid`), más una prueba propia de aislamiento entre empresas.
Motivo: copiar producción antes de la fase 6 traería datos personales al VPS sin necesidad.
Trampa: las suites suponen la demo con tallas con stock (`ROP-*`), `usa_variantes` encendido y al menos una venta; sin eso fallan o pasan sin probar nada. Sus valores «esperado» a veces son descriptivos: no compararlos como texto exacto.

## 2026-11-22 | #vps #migracion #seguridad | Servicios por proyecto: CORS y límites en nginx, admin de GoTrue cerrado
Decisión: nginx es el único que responde CORS, sobrescribe la IP real y bloquea `/auth/v1/admin` desde fuera; el servicio de funciones usará la API admin por loopback.
Motivo: los servicios reflejan orígenes por su cuenta y un encabezado enviado por el cliente permitiría esquivar el límite de intentos.
Trampa: GoTrue da 500 si un usuario insertado por SQL tiene columnas de token en NULL (deben ser ''). En nginx, `add_header` no se admite dentro de un `if` a nivel `server`: usar `map`.

## 2026-11-22 | #vps #migracion | El enlace de recuperación es de un solo uso
Decisión: validar el enlace mirando el log de `/verify` y con `generate_link` sobre un usuario ficticio, sin enviar más correos.
Motivo: `otp_expired` apareció en una apertura posterior, cuando el token ya se había canjeado; no era falla de configuración.
Trampa: un segundo clic, o un escáner de correo que abra el enlace antes, produce `otp_expired`. Si los clientes lo reportan en producción, considerar una página intermedia con botón.

## 2026-11-22 | #vps #migracion #seguridad #flow | Funciones en Deno sin tocar su código
Decisión: un contenedor Deno por proyecto carga las 3 funciones tal como están en producción. `SUPABASE_URL` es la URL pública y un `fetch` envuelto desvía `/rest/v1` y `/auth/v1` a loopback; cualquier otra ruta pública falla cerrada.
Motivo: portarlas a Node (lo que decía el plan) habría dejado dos versiones de código que cobra y administra cuentas. La URL pública además es la que Flow necesita como callback.
Trampa: nginx bloquea `/auth/v1/admin` desde afuera, así que las funciones no pueden llamar a GoTrue por la URL pública. Los planes ya creados en Flow mantienen su `urlCallback` antiguo.

## 2026-11-22 | #vps #migracion #corte #offline | Congelar Supabase con triggers, no con solo lectura
Decisión: durante el corte, las escrituras de `public` se bloquean con triggers que responden `55006` (HTTP 500).
Motivo: `default_transaction_read_only` se descartó porque PostgREST abre sus RPC en modo escritura y la venta entró con 200 en el ensayo.
Trampa: con `P0001`, `42501`, `22*` o `23*` la cola offline marca la venta como rechazada para siempre. El error debe ser 5xx para que se reintente.
Trampa: el dump hecho con Supabase congelado trae los triggers de bloqueo; filtrarlos del TOC al restaurar. No cubren `auth` ni `storage`: comparar ambos después del dump.

## 2026-11-22 | #vps #migracion #corte #offline | Cierre de sesión en el corte: se acepta
Decisión: no fijar `auth.storageKey`; todos los usuarios volverán a iniciar sesión tras el cambio de URL. Los datos actuales son de prueba.
Motivo: la clave de sesión de Supabase en localStorage deriva del host de la API; fijarla no conservaría sesiones porque los tokens los emite otro servidor.
Trampa: la cola offline sobrevive al cambio de URL (mismo `user_id`) y se sube al volver a entrar. Con clientes reales, avisar antes del corte. Sin verificar: si el VPS acepta tokens del backend anterior (secret JWT).

## 2026-11-22 | #vps #migracion #correo | Probar el correo real en msp_prueba exige crear un usuario
Decisión: la prueba se hizo creando un usuario temporal con la API admin de GoTrue, pidiendo `/recover` y borrándolo después; el correo llegó en español.
Motivo: `msp_prueba` es copia de producción con SMTP real, y pedir recuperación a un usuario existente habría escrito a un cliente real.
Trampa: `/recover` con un correo inexistente responde 200 en ~7 ms sin enviar nada (no revela si existe); con usuario real tarda ~1,5 s. Los logs no distinguen el caso, solo el tiempo.

## 2026-11-22 | #vps #cors #e2e | Login del navegador contra el VPS fallaba por CORS
Causa: `supabase-js` manda `x-supabase-api-version` en `/auth/v1/token` y la lista `Access-Control-Allow-Headers` de nginx no lo traía; `curl` con la lista corta no lo mostraba. Se agregó a la plantilla y al nginx de `msp_prueba`. Lección: probar el login desde un navegador real, no solo con `curl`.
Motivo extra: el E2E saltaba todo en silencio («sin credenciales válidas») porque el login fallaba; mirar consola y red antes de culpar a las claves.

2026-11-22 | #vps #adopcion #migracion | Se adoptó en sitio la base `misociopyme` del DBA en vez de crear una aparte. Motivo: respetar el trabajo del DBA y que QA y prod compartan nombre. Trampas: los `auth` y `storage` de juguete se guardan en un esquema temporal y se retiran para que GoTrue y storage-api creen los reales; `auth.uid/role` deben ser de `supabase_auth_admin`; el fixture de las suites no corre en la base real (se usa una copia `misociopyme_ensayo`); nginx bloquea `/auth/v1/admin` público, usar 127.0.0.1:9999. Quedó `gsdm_admin` (BYPASSRLS) del DBA sin tocar.

2026-11-22 | #vps #cierre | Retirado `msp_prueba` y rol `misociopyme_app`; `gsdm_admin` sin BYPASSRLS/CREATEDB/acceso a la base. Motivo: una sola base y verificación de clúster en verde. Las suites ya no corren en la base real: `sql-remoto.mjs --ensayo` usa una copia temporal. Trampa: `pg_dump` como `postgres` no escribe en directorios de root; redirigir desde el shell root.

2026-11-22 | #rls #auditoria | `admin_auditoria` solo la leía service_role pero la pantalla Actividad la consulta con la sesión: 403 para el dueño (no se veía porque el E2E de dueño nunca había corrido). 0031 agrega política `es_owner()` solo para SELECT; escribir sigue siendo de service_role.
