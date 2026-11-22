Actualizado: 2026-11-22

## Último realizado
- Migración a VPS sin Supabase: fases 0 a 6 ensayadas. Sin commit.
- Congelamiento probado en Postgres 17.12 (Docker local): `congelar.sql` bloquea insert/update/delete/truncate y RPC con `55006`, `descongelar.sql` revierte y ambos son repetibles.
- Venta offline probada en navegador (Playwright, API simulada): queda en cola, sobrevive al cambio de URL, con 500 sigue pendiente y con API sana sincroniza.
- Ensayo con copia de producción: 39 tablas y 8.298 filas idénticas, 352 casos SQL sin fallos.

## En curso / a medias
- 22/11: **adoptada en sitio la base `misociopyme` del DBA** con la plantilla (`infra/vps/adopcion/`): roles propios, GoTrue 2.198.0, storage 1.96.4, PostgREST, funciones, migración 0030, 3 usuarios con mismo id y hash, políticas de fotos, dueño `misociopyme_owner`, `misociopyme_app` sin permisos ni login. `91_verificar_base` OK; 15 suites sobre copia temporal: 352 casos, 0 fallos; humo (login, refresh, RLS, signup cerrado) OK. Respaldo previo en `/srv/respaldos_vps` del VPS. Sin commit.
- Retirado `msp_prueba` (base, roles, contenedores, nginx renombrado a `misociopyme`, `/srv/msp_prueba`; respaldos en `/srv/respaldos_vps`) y los contenedores del DBA. El clúster solo tiene `misociopyme` y `postgres`. `90_verificar_cluster` y `91_verificar_base` en OK. API en el host de siempre (nginx, mismos puertos); CORS y GoTrue aceptan `https://app.misociopyme.cl` y `http://localhost:5173`. `.env.local` apunta ahí. Sin cuentas de prueba en la base: el E2E se salta hasta crearlas.
- Rol `misociopyme_app` del DBA eliminado. `gsdm_admin` (DBA, CloudBeaver) conserva login solo a la base `postgres`: sin BYPASSRLS, sin CREATEDB, sin acceso a `misociopyme` (excepción anotada en `90_verificar_cluster.sql`).
- `scripts/sql-remoto.mjs` reescrito para SSH al VPS; `npm run test:*` corren en una copia temporal (`--ensayo`). README y `.env.example` actualizados.
- Corregido: nginx de QA no permitía el encabezado CORS `x-supabase-api-version` (el login del navegador fallaba). Ya está en `infra/vps/servicios/nginx_proyecto.plantilla.conf` y en el VPS (sin commit).
- Corregido el test `test_impresion_se_configura_por_equipo` (Configuración ahora tiene menú lateral).
- E2E contra el VPS (22/11): 33 OK, 2 saltadas. Cuentas temporales borradas; queda `e2e-admin@prueba.invalid` desactivada (la venta de prueba y sus movimientos la referencian). Arreglado el test de la ficha de empresa.
- Migración 0031 (`admin_auditoria` legible por el administrador general; arregla el 403 de `/admin/actividad`) con `supabase/pruebas/auditoria.sql` y `npm run test:auditoria`. Probada en copia y **aplicada en `misociopyme`** el 22/11 (con `SET ROLE misociopyme_owner`).
- Pendiente: `netlify.toml` (CSP aún con `*.supabase.co`; agregar el dominio de la API) y las variables `VITE_*` de Netlify, junto con el despliegue. Hostname de la API sigue siendo el de QA (`api-prueba…`): decidir si se cambia el DNS. Avisar al DBA (su API Deno, `misociopyme_app` y sus permisos ya no existen). Contenedores `supabase-*` ajenos siguen en el VPS: no tocar.

## Siguiente paso
- Dueño: snapshot del VPS y copia externa, clave de Resend de solo envío, revocar token de Netlify.
- Sin clientes todavía: el paso a productivo sigue `docs/PASO_A_PRODUCTIVO.md` (sin congelar ni ventana). Decidir si se parte vacío o con datos de Supabase.

## Ojo
- Latencia: ~230 ms de ida y vuelta Chile→VPS; el servidor responde en 2 ms. Tras `certbot` agregar `http2 on;` bajo `listen 443 ssl` (ya puesto en el sitio `misociopyme`, 22/11; respaldo en `/srv/respaldos_vps`). Con HTTP/2 cada pedido cuesta ~1 viaje (230 ms): lo que más pesa son los pedidos en serie de cada pantalla.
- Al cambiar el host de la API todos los usuarios quedan deslogueados (aceptado: datos de prueba).
- Verificado 22/11 en el VPS (base ya retirada, ahora `misociopyme`): correo de recuperación en español (`infra/vps/correos/`, plantillas por HTTP loopback; `file://` no funciona) y congelamiento con PostgREST real (GET 200, escritura 500/55006, descongelar vuelve a 204).
- Sin verificar en ejecución: reintento de 60 s (solo leído en `SyncProvider.tsx`) y tokens del backend anterior (irrelevante: todos quedan deslogueados).
- Correos en español aplicados en `misociopyme` (nginx 127.0.0.1:8099 + variables en `gotrue.env`). Correo real de recuperación probado 22/11: llegó en español. Al crear el GoTrue de producción repetir lo de `infra/vps/correos/LEEME.md`.
- No usar `default_transaction_read_only` para congelar: PostgREST lo ignora y la venta entra.
- El bloqueo debe responder 5xx: con `P0001` la cola offline marca la venta como rechazada para siempre.
- El dump final trae los triggers `zz_corte_bloqueo`: filtrarlos del TOC al restaurar.
- GoTrue mínimo `v2.198.0` y storage `v1.96.4`.
- Sin tiempo real en el VPS: mesas y cocina se actualizan cada 20 s.
- Los planes de Flow conservan su `urlCallback` de Supabase: actualizarlos en el corte.
- `odin`, `gonzalo` y `agente_oc` tienen sudo en el VPS y podrán leer los datos reales tras el corte.
- CloudBeaver, 8001 (VehicleScope) y 8002 (`despacho-fresco`): no tocar. No escribir IP, dominios ni claves en el repo.
- La rama local iba 1 adelante y 8 atrás de `origin/main`: `git fetch` y revisar antes de cualquier push.

Detalle en bitácora: #vps #migracion #corte #offline
