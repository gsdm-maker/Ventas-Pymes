Actualizado: 2026-11-24

## Último realizado
- Base `misociopyme` adoptada en el VPS propio (GoTrue, PostgREST, storage, funciones Deno, nginx con HTTP/2). Sin Supabase: `sql-remoto.mjs` corre por SSH y `npm run test:*` usa una copia temporal. E2E contra el VPS: 33 OK.
- Migración 0031 aplicada (el administrador general lee `admin_auditoria`), con `supabase/pruebas/auditoria.sql`.
- Auth: una sola carga de perfil y ubicaciones al iniciar (38 → 27 pedidos al entrar). Las pantallas no cargaban dos veces; era un error de la medición.
- `gsdm_admin` (DBA) administra `misociopyme` con control total (22/11, decisión del dueño): miembro de `misociopyme_owner`, sin superusuario ni BYPASSRLS ni otras bases. Excepción en `90_verificar_cluster.sql` (OK).
- Cuentas de prueba borradas; solo queda `e2e-admin@prueba.invalid` desactivada (la referencian 1 venta, 1 devolución y 2 movimientos).

- QA repuesto el 24/11 (GoTrue, PostgREST, storage, funciones; el DBA los había quitado el 23/11). E2E contra QA: 34 OK, 3 saltadas; subida de foto verificada (bucket `productos`, política por empresa). Cuentas temporales borradas.
- Restos de Supabase en el frontend corregidos: caché PWA de fotos, `useTiempoReal` (solo sondeo cada 20 s) y texto del login. Informe para el DBA: `docs/REQUISITOS_DESPLIEGUE.md`.

## En curso / a medias
- Nada a medias. Rama 6 commits adelante y 8 atrás de `origin/main`: sin push.

## Siguiente paso
- Quien despliega: CSP de `netlify.toml` (quitar `*.supabase.co`, agregar la API), variables `VITE_*` en Netlify, decidir el hostname de la API (hoy el de QA `api-prueba…`). Orden: migraciones → funciones → `git push`.
- Decidir PRD: VPS propio separado de la clínica (el DBA no quiere piezas GoTrue/storage en el VPS compartido) y alternativa de fotos si no se usa storage-api.
- Dueño: avisar al DBA (su API Deno y `misociopyme_app` ya no existen), snapshot del VPS y copia externa de la base, revocar el token de Netlify, decidir el servidor definitivo (VPS en Sudamérica) y si se parte vacío o con datos (`docs/PASO_A_PRODUCTIVO.md`).
- Integrar `origin/main` (`git fetch` y revisar) antes de cualquier push.

## Ojo
- Latencia ~230 ms Chile→VPS; el servidor responde en 2 ms. Cada consulta distinta paga además un preflight CORS (2 viajes). Solución real: proxy bajo el dominio de la app o VPS en Sudamérica. Tras `certbot` agregar `http2 on;` bajo `listen 443 ssl`.
- A producción pasan las migraciones, no la base: una copia solo sirve la primera vez, sin clientes. QA y productivo deben ser bases distintas.
- No usar `default_transaction_read_only` para congelar; el bloqueo debe responder 5xx (con `P0001` la cola offline rechaza la venta para siempre). El dump final trae triggers `zz_corte_bloqueo`: filtrarlos al restaurar.
- GoTrue mínimo `v2.198.0`, storage `v1.96.4`. Sin tiempo real en el VPS: mesas y cocina se refrescan cada 20 s. Planes de Flow conservan su `urlCallback` de Supabase: actualizarlos en el corte.
- `odin`, `gonzalo` y `agente_oc` tienen sudo en el VPS. CloudBeaver, 8001 y 8002: no tocar. No escribir IP, dominios ni claves en el repo.

Detalle en bitácora: #vps #migracion #corte #offline #dba #latencia
