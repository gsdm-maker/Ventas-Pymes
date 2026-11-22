# Guion de corte a VPS (fase 6)

Estado: **ensayado a nivel de datos y API el 22/11/2026**. Falta probar en navegador la venta offline y la PWA antigua. Este repo es público: no escribir aquí IP, dominios, ID del proyecto ni claves.

## Alcance
Migra solo Mi Socio Pyme. No cambia SSH, firewall, cuentas ni otras apps del VPS.

## Trampas que este corte debe resolver

| # | Trampa | Efecto si se ignora | Solución |
|---|---|---|---|
| 1 | La PWA usa `registerType: 'prompt'`: un dispositivo sigue con el bundle antiguo hasta aceptar la actualización | Sigue escribiendo en Supabase después del corte y esas ventas se pierden | Congelar Supabase con `infra/vps/corte/congelar.sql` antes del dump final |
| 2 | `default_transaction_read_only` **no sirve**: PostgREST abre sus RPC en modo escritura | La venta entra con HTTP 200 durante el "solo lectura". Comprobado en el ensayo | Usar los triggers de `congelar.sql` |
| 3 | La cola offline marca como rechazada para siempre una venta con error `P0001`, `42501`, `22*` o `23*` | Un bloqueo con esos códigos haría perder ventas pendientes | `congelar.sql` responde `55006` (HTTP 500): la venta queda en cola y se reintenta |
| 4 | El dump hecho con Supabase congelado incluye los 35 triggers de bloqueo | El VPS quedaría sin poder escribir | Filtrar `zz_corte_bloqueo` del TOC al restaurar |
| 5 | `foto_url` guarda la URL absoluta de Supabase | Las fotos fallan al retirar Supabase | Copiar los archivos con su `version` y reescribir el prefijo con `session_replication_role = replica`, para no alterar `updated_at` |
| 6 | La CSP de `netlify.toml` solo permite `*.supabase.co` | El navegador bloquea la API y las fotos | Agregar el dominio de la API a `connect-src` e `img-src` en el mismo despliegue |
| 7 | La clave de sesión depende del hostname y cambia el secreto JWT | Todos deben iniciar sesión de nuevo | Avisar a los clientes. Las claves se conservan: 9 de 9 usuarios con hash bcrypt |
| 8 | La cola offline se filtra por `user_id` | Si cambiaran los ID, las ventas pendientes quedarían huérfanas | Conservar los ID de `auth.users` |
| 9 | Los planes de Flow conservan su `urlCallback` antiguo | Los avisos de pago no llegan al VPS | Revisar y actualizar cada plan en la ventana de corte |
| 10 | La plantilla de correo de GoTrue está en inglés | Correos de recuperación en otro idioma | Portarla antes del corte |
| 11 | Producción tiene más migraciones de auth y storage que `msp_prueba` | Las imágenes antiguas no calzan con el esquema copiado | Usar como mínimo las versiones de producción. Ensayado con GoTrue `v2.198.0` y storage `v1.96.4`; revisar de nuevo el día del corte |
| 12 | El VPS no tiene servicio de tiempo real | Mesas y cocina se actualizan cada 20 s en vez de al instante | Decisión de diseño de la primera vuelta. Avisar a los restaurantes |

## Resultado del ensayo

| Comprobación | Resultado |
|---|---|
| Copia contra producción | 39 tablas y 8.298 filas idénticas (conteo y md5) |
| Suites SQL | 352 casos: 337 exactos, 15 con el mismo tipo de error y otro texto, 0 fallos |
| Aislamiento entre empresas | 81 comprobaciones, 0 filas ajenas |
| Flujo por API con usuarios ficticios | Login, cambio de clave, venta, reintento sin duplicar, foto y permisos correctos |
| Congelar y descongelar | Bloquea las 35 tablas, lectura y login siguen, la venta en cola entra una sola vez al volver |
| Build apuntando a otra URL | Compila, sin referencias a Supabase en el bundle |

**No probado:**
- PWA antigua instalada, reintento automático de 60 s, validación en el VPS de tokens del backend anterior y `congelar.sql` en el Supabase real con PostgREST.

**Probado el 22/11/2026:**
- Venta offline en navegador (API simulada): queda en cola, sobrevive al cambio de URL, con 500 sigue pendiente y con API sana sincroniza. Al cambiar el host de la API todos los usuarios deben volver a iniciar sesión; la cola se sube con el mismo `user_id`.
- `congelar.sql` y `descongelar.sql` en Postgres 17.12 (Docker): bloquean insert/update/delete/truncate y RPC con `55006`, el select sigue, la reversa deja 0 triggers y ambos son repetibles.
- Login de un usuario real, envío de correo, Flow real y la marcha atrás de Netlify.

## Corte (requiere OK del dueño y ventana acordada)

| Paso | Acción | Tiempo |
|---|---|---|
| 1 | Avisar a los clientes y confirmar respaldo reciente de Supabase | previo |
| 2 | Aplicar `congelar.sql` en Supabase | 0,05 s medido |
| 3 | Dump de `auth`, `public` y `storage`, sin tokens ni sesiones | 33 s medido |
| 4 | Restaurar en orden: TOC sin esquemas, ACL ni `zz_corte_bloqueo`; dueños; ACL sin `dashboard_user` | 1 s la carga, unos 2 min con comprobaciones (estimado) |
| 5 | Copiar fotos y reescribir `foto_url` | 1,2 s y 43 ms medidos |
| 6 | Comparar origen y destino, incluidos `auth.users` y `storage.objects`, que el congelamiento no cubre | 5 min (estimado) |
| 7 | Cargar secretos reales de Flow, OpenAI y SMTP en el VPS | 5 min (estimado) |
| 8 | Actualizar callbacks de Flow | 5 min (estimado) |
| 9 | Desplegar frontend con nueva URL, clave anon y CSP | 5 min (estimado) |
| 10 | Verificar login, venta, foto, correo y aviso de Flow | 10 min (estimado) |

**Ventana sugerida: 45 minutos.** Los pasos de datos toman menos de 1 minuto; el resto es trabajo manual.

**Punto de no retorno:** la primera venta real escrita en el VPS.

## Marcha atrás
- **Antes del punto de no retorno:** restaurar las variables de Netlify, redesplegar, devolver los callbacks de Flow y aplicar `infra/vps/corte/descongelar.sql` en Supabase. Las ventas en cola se reintentan solas.
- **Después:** no volver sin antes exportar lo escrito en el VPS y cargarlo en Supabase. La decisión es del dueño.
- Supabase queda congelado e intacto como respaldo durante al menos 48 h de vigilancia.

## Antes de fijar la fecha
1. ~~Venta offline tras el cambio de URL~~ y ~~congelamiento en Postgres 17~~: probados el 22/11/2026.
3. Snapshot del VPS y copia externa, clave de Resend de solo envío y plantilla de correo en español.
