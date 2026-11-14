# Plan de mejoras · 24-10-2026

Origen: revisión completa del proyecto (24-10-2026) + requerimiento del dueño del sistema.
**Regla:** nada se sube a git (ni se aplica a la base de producción) hasta que todo esté probado y aprobado.

---

## A. Requerimiento del dueño: quién habilita qué

> «Módulos habilitados — Funcionalidades activas para la empresa: esta parte debe ser administrada
> por la persona dueña del sistema. Yo como dueño la activo según necesidad: restaurante, tienda o
> ambas. El resto de los módulos: cuando el admin de la empresa crea un nuevo usuario, él le da
> acceso a lo que quiere, o que ya venga una configuración previa. El mensaje de la suscripción
> está correcto.»

### Decisión (dos niveles)

| Nivel | Quién | Qué decide |
|---|---|---|
| 1. Empresa | **Administrador general** (dueño del sistema) | Rubro (Tienda · Restaurante · Tienda y restaurante) y **módulos habilitados**. Plan y prueba (ya era así). |
| 2. Usuario | **Admin de la empresa** | Al crear o editar un usuario: parte de una **configuración previa según el puesto** (bodega, tienda, auditor, admin) y puede marcar/desmarcar módulos y acciones, **solo dentro de los módulos que el dueño habilitó** y sin dar permisos que él mismo no tiene. |

Ambas cosas a la vez: viene preconfigurado por puesto y el admin lo ajusta si quiere.

### Tareas
- [x] **A1. Consola general → detalle de empresa:** nueva tarjeta «Rubro y módulos». El rubro
      preselecciona módulos (Restaurante/Ambos encienden Mesas y Cocina; Tienda los apaga) y el
      dueño puede ajustar cada módulo.
- [x] **A2. Crear empresa:** el rubro admite «Tienda y restaurante» y define los módulos iniciales.
- [x] **A3. Configuración (admin de empresa):** rubro y módulos pasan a **solo lectura** con el
      aviso «Los define el administrador general». El mensaje del plan/suscripción se mantiene.
- [x] **A4. Base de datos:** el rubro (`tipo_negocio`) queda protegido igual que plan y módulos
      (solo el dueño lo cambia). Se agrega el valor `mixto` (tienda y restaurante).
- [x] **A5. Permisos por usuario que sí funcionen:** hoy marcar un *módulo* extra a un usuario
      se guarda pero **no tiene efecto** (front y base ignoran esos ajustes en módulos). Se corrige
      en `evaluarCapacidad` y `tiene_cap`.
- [x] **A6. Crear usuario con permisos:** el formulario muestra los permisos preconfigurados del
      puesto y permite ajustarlos antes de crear. El editor solo muestra módulos habilitados y
      las acciones de esos módulos.
- [x] **A7. Sin escalada de privilegios:** un admin de empresa no puede otorgar (ni al crear ni
      al editar) módulos o acciones que él no tiene. Validado en la base (`proteger_perfil`) y en
      la Edge Function.

## B. Correcciones de la revisión (prioridad alta)
- [x] **B1. Variantes/categorías entre empresas:** una empresa no puede crear variantes ni asignar
      categorías apuntando a productos/categorías de otra (trigger) y `_exigir_variante` filtra por
      empresa. `_etiqueta_variante` deja de ser ejecutable desde la API.
- [x] **B2. Cerrar sesión sin conexión:** borra la sesión guardada aunque `signOut` falle.
- [x] **B3. Cola offline:** un `42501` sin sesión (HTTP 401) es transitorio, no rechazo definitivo;
      la cola se detiene si la sesión no es del dueño de la operación (cambio de usuario).
- [x] ~~Anular venta sin stock crea stock fantasma~~ → **descartado tras re-análisis:** la venta sí
      ocurrió físicamente (la mercadería existía aunque el sistema marcara menos), así que lo
      devuelto vuelve físicamente a la tienda; el movimiento de venta registra la cantidad total.

## C. Correcciones medias que se aprovechan
- [x] **C1. `registrar_salida` idempotente bajo concurrencia** (bloqueo por `uuid_local`).
- [x] **C2. Descuento con decimales** se redondea antes de enviarlo (evita rechazo en la cola).
- [x] **C3. Alertas de stock en caché** separadas por usuario (no solo por empresa).

## C2. Tiendas y bodegas (pedido del dueño, 24-10-2026)
- [x] **Desactivar en vez de borrar** (`0021`): botón Desactivar/Reactivar en Configuración con
      confirmación; la base exige sin stock, sin transferencias sin recibir, sin cuentas de mesa
      abiertas y otra ubicación activa. El borrado vía API queda bloqueado. Usuarios asignados solo a
      una ubicación desactivada quedan sin acceso (aviso en Usuarios), no con acceso a todas.
      Suite `supabase/pruebas/ubicaciones.sql` (10/10). Aplicada en producción 24-10-2026.

## D. Pendientes que requieren decisión (no se ejecutan ahora)
- Ventas offline y cuentas de mesa se registran con el **precio del catálogo al sincronizar/cobrar**,
  no con el cobrado. Opciones: respetar el precio enviado (validado) o marcar diferencia.
- `p_permitir_sin_stock` y el **descuento** los decide el cliente: ¿capacidad `ventas.descontar`
  y tope de descuento por puesto?
- `reportes.ver` no se exige en la base; cancelar transferencias; `registrar_entrada` sin `uuid_local`.
- [x] ~~Bundle de 1,1 MB~~ → pantallas con `React.lazy` y consultas en paralelo (24-10-2026).
- (Opcional) Mostrar al instante la copia local del catálogo y actualizar por detrás (POS y Productos).
- Rotar el token `sbp_…` y la clave de la BD (acción manual en Supabase).
- ~~Tipo de ubicación «Restaurante»~~ → **descartado por el dueño (24-10-2026):** una sucursal es solo
  una tienda; lo de restaurante lo controlan los módulos Mesas y Cocina.

## E. Verificación antes de subir
1. [x] `npm run typecheck` (sin errores), `npm run lint` (0 errores; las 6 advertencias de antes),
   `npm run build` (compila).
2. [x] Migración `0020` probada con `--antes` contra **todas** las suites (se revierte). Suite nueva
   `supabase/pruebas/modulos_permisos.sql` (`npm run test:permisos`): 24/24. Resto sin cambios;
   `reportes.sql` «reporte coincide…» ya fallaba antes de 0020.
3. [x] Interfaz revisada con capturas (POS, Inventario, Usuarios, Reposición, Productos, Dashboard).
4. [ ] Revisión del dueño. Recién entonces, **en este orden**:
   1. [x] `supabase db push` (0020) — aplicada 24-10-2026; suites re-ejecutadas contra la base real: sin cambios.
   2. [x] `supabase functions deploy admin-users` — versión 8, activa (24-10-2026).
   3. [x] Commit y push a `main` (Netlify publica solo) — aprobado y subido 24-10-2026.

---

# Plan de lo pendiente · 25-10-2026

Junta lo que quedó abierto del asistente Socio IA, la revisión OWASP de skills, las skills de
Anthropic, los patrones de diseño (Refactoring.Guru) y los pendientes anteriores.
**Quién:** 🤖 lo hago yo (en local, se publica con tu ok) · 👤 decisión o acción tuya.

## F1. Para cerrar ya (listo en local, falta tu ok)
- [x] 🤖 Desplegar `asistente` y `admin-users` con `supabase-js` fijado en `2.118.0` (25-10-2026).
- [x] 🤖 Commit y push de la revisión OWASP (commit `53444ec`).
- [ ] 👤→🤖 Subir también al respaldo privado `Sebdev23/stockflow` (requiere `gh auth switch`).

## F2. Seguridad y costos (prioridad alta)
- [ ] 👤 Rotar el token `sbp_…` y la clave de la BD; actualizar `Datakeys.md` (pendiente desde el 18-10).
- [ ] 👤 Crear una clave de OpenAI propia para Mi Socio Pyme (hoy comparte cuenta y gasto con Lumix)
      con tope de gasto mensual en OpenAI; 🤖 cargarla con `supabase secrets set`.
- [ ] 🤖 Secreto `ALLOWED_ORIGIN` (URL de Netlify + localhost) para que las funciones no acepten
      llamadas de cualquier sitio (hoy CORS `*`).
- [x] 🤖 Regla: `esm.sh` siempre con versión exacta (nunca `@2`); aplicada en las dos funciones.

## F3. Correcciones detectadas (prioridad alta)
- [x] 🤖 **Estado de comandas (patrón State)** — hecho en `0024` (local, 34/34 en `restaurante.sql`): de a un paso hacia adelante o atrás; además **solo lo que se prepara va a cocina** (`productos.va_a_cocina`, bebidas directo a la cuenta). Transferencias y cuentas ya validaban sus estados. Detalle original: `cambiar_estado_comanda` permite cualquier salto
      (p. ej. «entregada» → «pendiente»). Tabla de transiciones permitidas
      (pendiente → preparando → lista → entregada, con retroceso de un paso si se decide) + pruebas.
      Revisar lo mismo en transferencias y cuentas. 👤 decidir si cocina puede retroceder un paso.
- [x] 🤖 `reportes.sql`: el reporte estaba bien; la prueba comparaba solo ventas simuladas y sin devoluciones. Corregida (7/7). Antes:
      diferencia de ~$450.000 y 6 tickets: probablemente devoluciones/anuladas en el cálculo de la prueba).

## F4. Socio IA: afinar con uso real
- [ ] 👤 Probarlo con un usuario de tienda (al que se le dé el permiso) y en el celular.
- [ ] 👤 Revisar en la consola (Resumen → Uso del asistente) el consumo de la primera semana y
      ajustar los topes Básico / Pro / Max.
- [ ] 👤 Activar el plan en las empresas reales que lo tengan contratado.
- [ ] 🤖 (Opcional) Guardar las preguntas (sin respuestas) para ver qué consultan y mejorar el prompt.
- [ ] 🤖 (Opcional) Respuestas en streaming (que se vayan escribiendo) para que no se sienta la espera de ~6 s.

## F5. Calidad: pruebas automáticas
- [x] 👤 ok para instalar `webapp-testing` (Anthropic, commit `dbd4588`) + Playwright para Python.
- [x] 🤖 Pruebas de punta a punta en `e2e/` (`npm run test:e2e`): login, POS, venta sin conexión y
      sincronización (opcional), permisos por puesto, Socio IA y Ayuda. 11/11 + 2 opcionales OK.
- [x] 👤 Actualizar en `Datakeys.md` la clave de la cuenta de tienda de prueba (`juan@…`) — 25-10-2026; 11/11 e2e.

## F6. Patrones de diseño y orden del código (prioridad media)
- [x] 🤖 Sección «Patrones de diseño» en `BUENAS_PRACTICAS_LUMIX.md` (§16) (Command en la cola offline,
      Chain of Responsibility en permisos, Facade en `api.ts`, Proxy en Edge Functions, Strategy en
      herramientas de IA, Observer en Realtime, Singleton en el cliente).
- [x] 🤖 Strategy para medios de pago: `src/lib/mediosPago.ts` (POS, cobro de mesas, Reportes y voucher).
- [x] 🤖 Cola offline: tabla `EJECUTORES` por tipo de operación en `SyncProvider`.
- [x] 🤖 Fachada: ninguna pantalla usa `supabase` directo; módulos por tema en `src/core/data/` (25-10-2026).
- [x] 🤖 `POS.tsx` de 934 a 194 líneas: `useCatalogoPos`, `useTicketPos`, `CatalogoPos`, `TicketPanel` (25-10-2026).
- [x] 🤖 Catálogo de módulos y permisos: `npm run verificar:catalogo` compara TS, SQL y Edge Function
      y falla si se desalinean.

## F6b. Pantallas más livianas y planes de suscripción (26-10-2026)
- [x] 🤖 POS: cobro compacto (descuento plegable, desglose en una línea, total junto a «Cobrar»,
      atajos en un ícono) y ticket más ancho: más alto para el detalle.
- [x] 🤖 Inventario: filtros y títulos de columna fijos; solo el detalle se desplaza (como Reposición).
- [x] 🤖 Reportes sin «Exportar CSV». Usuarios: «Crear usuario» como botón flotante.
- [x] 🤖 Planes (0025): prueba (días configurables) · mensual (30 días desde el alta) · anual ·
      dueño (pago único). Mensual/anual: días de gracia (5) antes del bloqueo; alertas al admin de la
      empresa (franja + aviso emergente cada N horas, por defecto 1 al día); «Registrar pago» suma un
      período respetando el ciclo; historial en `pagos_plan`. Pruebas: `supabase/pruebas/planes.sql`.
- [x] 🤖 Consola: pestaña «Asistente IA» (cómo funciona, topes y uso); Resumen con empresas por vencer.
- [x] 🤖 Asistente (0026): el máximo por persona es opcional (vacío = sin límite; solo cuenta la bolsa
      diaria de la empresa, así una empresa de una persona no pierde cupo).
- [ ] Desplegar: `db push` (0025 y 0026) → `functions deploy admin-users` y `asistente` → `git push`.
- [ ] (Opcional) Aviso de vencimiento por correo (requiere servicio de envío y tarea programada).

## F7. Funciones de negocio pendientes (de la Bitácora)
- [ ] Ajuste de inventario por conteo físico (el permiso existe, falta pantalla y RPC).
- [ ] Cierre de caja diario por cajero y tienda.
- [ ] Decisiones de la sección D: precio de ventas offline, permiso y tope de descuento,
      cancelar transferencias.
- [ ] (Opcional) Historial de recepciones y «cargar compra sugerida» desde Reposición.
- [ ] (Opcional) Restaurante: modificadores con precio y dividir la cuenta.
- [ ] (Opcional) Aviso de quiebres por correo/push; SMTP propio para recuperación de clave.

## Orden sugerido
1. **F1** (minutos) → 2. **F2** (tus acciones en Supabase/OpenAI + 1 secreto) → 3. **F3** (bug de
comandas) → 4. **F5** (pruebas automáticas, protegen todo lo que sigue) → 5. **F6** (refactors con
pruebas detrás) → 6. **F7** según prioridad del negocio. **F4** corre en paralelo con el uso real.

---

# Plan comercial: planes que calzan con el sistema · 14-11-2026

Objetivo: que la landing (misociopyme.cl/#planes) y el sistema digan lo mismo. Hoy la landing vende
S/M/L, pero el sistema solo tiene «forma de pago» (prueba/mensual/anual/dueño) + módulos sueltos +
plan de IA; el S/M/L se arma a mano y hay promesas que no calzan (reposición «solo en M», POS solo en
L, «tiendas y restaurantes» en L cuando mesas/cocina dependen del rubro).

## G0. Idea central: dos ejes que se combinan

| Eje | Qué define | Valores |
|---|---|---|
| **Nivel** (nuevo) | Qué funciones y cuánto: módulos, topes, IA | S · M · L · **A medida** |
| **Membresía** (ya existe, 0025; hoy se llama «plan») | Cómo paga y cuándo vence | Prueba · Mensual · Anual · Dueño (pago único) |

Ejemplos: «Socio Pro · Mensual», «Socio Pro Max · Anual», «A medida · Dueño».

## G1. Niveles (acordado 14-11-2026)

| | **Socio** (S) $10.000/mes | **Socio Pro** (M) $20.000/mes | **Socio Pro Max** (L) $30.000/mes |
|---|---|---|---|
| POS (venta y caja) | ✅ | ✅ | ✅ |
| Inventario, entradas, salidas, vouchers | ✅ | ✅ | ✅ |
| Alertas y reposición | ✅ | ✅ | ✅ |
| Tallas y colores (una prenda = 1 producto) | ✅ | ✅ | ✅ |
| Sin internet | ✅ | ✅ | ✅ |
| **Productos** | 200 | 2.000 | sin límite |
| **Locales** (tiendas + bodegas) | 2 | 5 | sin límite |
| **Usuarios** | 3 | 8 | sin límite |
| Restaurante (mesas, cocina, cuentas abiertas) | — | ✅ | ✅ |
| Bodega y transferencias | ✅ (desde 14-11-2026) | ✅ | ✅ |
| Reportes | día y mes | completos | completos |
| Permisos por usuario | — (dueño + cajero fijos) | ✅ | ✅ |
| **Asistente IA** (mensajes/día, empresa) | **8** | **40** | **150** |

- **A medida:** el admin general elige módulos, topes e IA a mano (cualquier combinación) y fija el
  precio acordado. La empresa ve «Plan a medida». Los niveles estándar ya no se tocan a mano
  (ver G4.4, «el plan manda»).
- **Restaurante en M y L:** al elegir nivel, mesas/cocina se habilitan si el rubro es restaurante o
  mixto (se mantiene `modulosPorRubro`).
- **Prueba:** 15 días con funciones del nivel que se le asigne (por defecto M) e IA de 40/día, para
  que conozca un plan mejor que el que probablemente contrate.
- **Nombres (decidido 14-11-2026):** S = **Socio** · M = **Socio Pro** · L = **Socio Pro Max**.

## G2. Membresías (lo que ya existe, más precios por decidir)

| Membresía | Cómo funciona (ya hecho en 0025) | Precio sugerido (decidir) |
|---|---|---|
| Prueba | Días configurables; al terminar se bloquea | Gratis, 15 días |
| Mensual | 30 días desde el alta; 5 días de gracia | Precio del nivel |
| Anual | Un año desde el alta; 5 días de gracia | **Decidido 14-11-2026:** un solo anual, siempre **Socio Pro Max** (beneficios del máximo), **11 × $30.000 = $330.000/año** (1 mes gratis) |
| Dueño | Pago único, sin vencimiento | **Decidido 14-11-2026: sin precio publicado.** La landing invita a contactar y se envía cotización a medida (referencia interna: 24–30 meses del nivel) |

**Ojo con Dueño + IA:** la IA cuesta todos los meses (proveedor de IA). Un pago único con IA para siempre
es pérdida segura. Al cotizar, la IA (y la boleta electrónica) se ofrecen como mensualidad aparte o
no se incluyen; se define caso a caso en la cotización. Lo mismo para la boleta electrónica (costo mensual de SharkPOS).

## G3. La IA como gancho para subir de plan
- [ ] Bajar cupos en `planes_ia`: Básico 8 · Pro 40 · Max 150 (hoy 30/150/600). Prueba con 40.
- [ ] Aviso cuando quedan 2 mensajes: «Te quedan 2 hoy. En <nivel siguiente> tienes N al día».
- [ ] Al agotarse: mensaje con botón «Subir de plan» → WhatsApp con texto listo
      («Hola, quiero subir a <nivel>»).
- [ ] Consola del admin general: empresas que llegan seguido al tope (candidatas a subir).
- Mismo gancho con los topes: «143 de 200 productos», aviso al 90 % y botón para subir.

## G4. Sistema: tareas
1. [x] **Migración** `0027_niveles_plan.sql` (hecha, sin aplicar en producción):
   - tabla `niveles_plan` (s, m, l): módulos, `plan_ia`, `max_productos`, `max_ubicaciones`,
     `max_usuarios`, reportes completos sí/no, precio mensual (referencia). RLS: todos leen, nadie escribe.
   - `empresas.nivel` (s/m/l/medida) + topes propios para «a medida» (`max_*` en la empresa, null = del nivel).
   - Función `_topes_empresa(empresa)` que devuelve los topes vigentes (nivel o a medida).
   - Triggers antes de insertar en `productos` (cuenta productos base, no variantes), `ubicaciones`
     (activas) y perfiles: si se pasa del tope → error claro «Tu plan permite 200 productos…».
   - Lo existente sobre el tope **no se borra**: solo se impide crear más (y reactivar ubicaciones).
   - `proteger_empresa`: solo el admin general cambia nivel y topes.
   - RPC `aplicar_nivel(empresa, nivel)`: copia módulos e IA del nivel.
   - Membresía anual fuerza nivel L (al registrar pago anual se aplica L; no se puede anual con S/M).
   - Cupos nuevos de `planes_ia` (G3).
2. [x] **Pruebas** en `supabase/pruebas/niveles.sql` (37 casos, `npm run test:niveles`); antes se pensó en `supabase/pruebas/planes.sql` (topes por nivel, a medida, empresa ya sobre el
       tope, no-admin no puede cambiar nivel) y `permisos.sql`. Probar con `--antes`.
3. [x] **Edge Function `admin-users`**: validar tope de usuarios al crear (mensaje claro). También: `nivel` al crear empresa, acción `actualizar_nivel`, errores de tope como 400.
4. [x] **Consola admin general**: selector de nivel (aplica módulos e IA; aviso si L/M con rubro
       retail no trae restaurante), campos de topes para «a medida», etiqueta «personalizado»;
       renombrar «Plan» → «Membresía» en pantalla.
       **14-11-2026 · el plan manda** (como Square y los «entitlements» de Stripe): una sola tarjeta
       «Plan de la empresa» (1 plan → 2 rubro → 3 qué incluye) junto a «Membresía». Con Socio, Socio Pro
       o Socio Pro Max, módulos y asistente son de solo lectura; cambiar el rubro los recalcula en la
       base (`cambiar_rubro`, acción `actualizar_rubro`). `actualizar_modulos` y `actualizar_plan_ia`
       solo se aceptan con «A medida» o sin nivel. Crear empresa pide plan, rubro y membresía
       (ya no envía módulos). niveles.sql: 44 casos.
       **14-11-2026 · pestaña «Planes y precios»** (`/admin/planes`): los tres planes lado a lado leídos de
       `niveles_plan`, ingreso mensual estimado, editar el precio de referencia (acción
       `actualizar_precio_nivel`; `niveles_plan.precio_anual`, solo Pro Max) y crear un plan a medida
       de una vez (acción `crear_a_medida` → `aplicar_a_medida`: módulos, asistente, topes y precio
       cotizado en `empresas.precio_medida`, protegido por `proteger_empresa`). El precio a medida
       también se edita en el detalle. Los precios son de referencia: la landing se actualiza aparte.
       niveles.sql: 57 casos.
5. [x] **App de la empresa**: «Socio Pro · Mensual · vence el…» en Configuración; medidores de
       productos/locales/usuarios; avisos al 90 % y al tope (también offline: validar antes de crear
       con los topes cacheados); botón «Subir de plan» por WhatsApp; reportes del S limitados a día y mes.
       Hecho, salvo la validación offline (crear productos y locales ya exige conexión). El botón usa
       `VITE_WHATSAPP_VENTAS` (configurarlo en Netlify); sin esa variable el aviso sale sin botón.
       En S se ocultan los permisos a medida en Usuarios; el asistente avisa con 2 mensajes o menos y al
       agotarse, y ya no muestra los nombres internos Básico/Pro/Max.
6. [ ] Typecheck, lint, `test:planes`, `test:permisos`, `test:seguridad` (hecho 14-11-2026, todo pasa); `/security-review`
       (toca permisos); revisión del dueño en el navegador.
7. [ ] Desplegar con OK: `db push` → `functions deploy admin-users asistente` → `git push`.
       Asignar nivel a las empresas actuales según lo que pagan hoy.

## G5. Landing: tareas (se envían en `LANDING_CORRECCIONES.md`)
- [ ] Tabla de planes = G1 (mismos nombres, números y orden que el sistema).
- [ ] Destacar que **todos los planes traen POS** y funcionan sin internet.
- [ ] M como «Más elegido»: tiendas con sucursal/bodega **y restaurantes**.
- [ ] IA como función destacada («Tu socio que responde sobre tu negocio»), con el cupo de cada plan.
- [ ] Tarjeta aparte «Anual: todo Socio Pro Max por $330.000 al año (1 mes gratis, $27.500/mes)».
- [ ] Bloque bajo la tabla, sin precio: «¿Necesitas algo distinto? Plan a medida» y «¿Prefieres pagar
      una vez? Licencia de dueño» → botón «Pedir cotización» (WhatsApp con texto listo y/o formulario).
      La cotización la arma el dueño del sistema; en la app se configura como «A medida» y/o «Dueño».
- [ ] Preguntas nuevas: diferencia entre planes, qué pasa al llegar al tope (no se pierde nada),
      cambio de plan en cualquier momento, ¿emite boleta electrónica? (próximamente / extra).

## G6. Extra futuro: boleta electrónica (SharkPOS)
Extra en cualquier nivel (~$7.990–9.990/mes; SharkPOS cobra $5.990/RUT). Requiere Edge Function con
la clave, tabla de documentos con RLS, webhook, timbre en el ticket y nota de crédito en devoluciones.
Definir con un contador qué hacer con ventas sin internet (contingencia SII). Va después de G4.

## G7. Decisiones pendientes del dueño
1. ~~Nombres~~ (decidido: Socio · Socio Pro · Socio Pro Max).
2. ~~Precio anual~~ (decidido: anual = Socio Pro Max, $330.000).
3. ~~Licencia Dueño~~ (decidido: por cotización desde la landing; IA aparte se define en cada cotización).
4. ~~Nivel de la prueba~~ (decidido: Socio Pro, 15 días).
5. ~~Landing~~ (decidido: las correcciones se envían en `LANDING_CORRECCIONES.md`).

**Orden:** decisiones G7 → G4 (pasos 1–2 primero, son la base) → G5 en paralelo con G4.5 → G4.6–7 →
G6 más adelante.
