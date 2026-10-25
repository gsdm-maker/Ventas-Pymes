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
