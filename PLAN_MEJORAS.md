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
