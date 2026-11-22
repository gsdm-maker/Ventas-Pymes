# Paso a productivo en el VPS (sin clientes)

Fecha: 2026-11-22. Reemplaza al `GUION_CORTE_VPS.md` mientras **no haya clientes**: sin ventas reales no hace falta congelar Supabase, avisar, ni ventana de 45 min. Si antes del paso aparece un cliente, volver al guion. Repo público: sin IP, dominios, ID de proyecto ni claves.

## Qué ya está listo
- Plantilla del VPS probada (`infra/vps/`): roles, aislamiento entre bases, GoTrue, storage, PostgREST, funciones Deno, correos en español, 15 suites en verde.
- Ensayo de datos con copia de producción (39 tablas, 8.298 filas idénticas) y venta offline.
- La app ya apunta al VPS QA (`msp_prueba`).

## Decisión previa (una sola)
¿Los datos de Supabase se llevan o se parte vacío?
- **Vacío (recomendado si son datos de prueba):** solo migraciones + crear la empresa y el admin. Sin dump, sin fotos, sin comparaciones.
- **Llevar los datos:** pasos 3 a 5 del guion (dump, restaurar filtrando `zz_corte_bloqueo`, fotos y `foto_url`, comparar). Sin `congelar.sql`.

## Pasos
1. **Respaldo:** snapshot del VPS y copia externa (dueño).
2. **Base de producción = la que dejó el DBA (`misociopyme`), adoptada en sitio** (hecho 22/11): respaldo `pg_dump -Fc` desde root; detener contenedores del DBA y de QA (puertos fijos); `servicios/generar_env.sh`; `01_proyecto.sql`; línea en `pg_hba.conf`; `adopcion/01_preparar.sql`; GoTrue y storage; `adopcion/02_restaurar.sql -v rol_antiguo=<rol del DBA>`; migraciones faltantes con `SET ROLE misociopyme_owner`. Secretos nuevos: no reutilizar los de QA.
3. **Servicios de producción:** GoTrue (≥ v2.198.0), storage (≥ v1.96.4), PostgREST, funciones Deno y nginx por subdominio con CORS solo al dominio de la app y `limit_req`. Repetir `infra/vps/correos/LEEME.md` (plantillas en español).
4. **Migraciones 0001 a 0030** con `SET ROLE <prod>_owner`, luego `91_verificar_base.sql`, `90_verificar_cluster.sql` y las 15 suites (`infra/vps/pruebas/correr_suites.sh`). Las suites se revierten solas.
5. **Secretos reales en el VPS** (no en el repo): clave de Resend de solo envío, Flow, OpenAI. `DISABLE_SIGNUP=true`.
6. **Crear el primer admin general** y la primera empresa (rubro y módulos).
7. **Frontend:** en Netlify, `VITE_*` con la URL y la clave anon de producción, y en `netlify.toml` agregar el dominio de la API a `connect-src` e `img-src` (hoy solo `*.supabase.co`). Revisar con `git grep` que no suba IP ni claves.
8. **Flow:** actualizar el `urlCallback` de cada plan al VPS.
9. **Verificar:** login, cambio de clave obligatorio, venta, foto, correo de recuperación, aviso de Flow, usuario de una empresa sin ver datos de otra.
10. **Retirar o dejar Supabase** como respaldo en pausa (decisión del dueño). Revocar el token de Netlify usado en las pruebas.

## Orden con git (necesita OK del dueño)
db push no aplica (la base es el VPS). Orden: servicios y base del VPS → Netlify con variables nuevas → `git push`. La rama local va 1 adelante y 8 atrás de `origin/main`: `git fetch` y revisar antes de subir.

## Marcha atrás
Mientras no exista una venta real en el VPS: restaurar variables de Netlify y callbacks de Flow; Supabase sigue intacto. Después de la primera venta real, exportar antes de volver.

## Pendientes del dueño
Snapshot y copia externa · clave de Resend de solo envío · revocar token de Netlify · decidir vacío o con datos · fecha.
