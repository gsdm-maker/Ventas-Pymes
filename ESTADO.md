Actualizado: 2026-11-15

## Último realizado
- Suscripción con cobro automático por Flow, ya en producción (base y función) y probada en el sandbox: migración `0030_suscripcion_flow.sql` aplicada (61 casos de prueba OK), Edge Function `suscripcion` desplegada, secretos de Flow sandbox cargados (`FLOW_API_URL` = sandbox, `APP_URL` = `https://app.misociopyme.cl`).
- Configuración rediseñada con menú lateral (Empresa, Plan y suscripción, Tiendas y bodegas, Inventario, Este equipo); la sección va en `?seccion=` y el retorno de Flow abre «Plan y suscripción». Solo interfaz.
- `/security-review` de la suscripción: sin hallazgos de confianza alta. `npm run typecheck` y `npm run lint` sin errores.

## En curso / a medias
- Sin commit ni `git push`: `CLAUDE.md`, `ESTADO.md`, `BITACORA.md`, `docs/`, 0030 y sus pruebas, la función, `SuscripcionFlow.tsx`, el rediseño de `Configuracion.tsx`, `config.toml`, `package.json`. Hasta el push, producción no tiene la pantalla nueva.

## Siguiente paso
- Orden con OK del dueño: `git push` (revisar antes con `git grep` que no suba correos ni el ID del proyecto).
- Pasar a Flow producción (el dueño aún debe crear y validar su cuenta en flow.cl; confirmar con Flow que habilita suscripciones): cuenta aprobada, cambiar `FLOW_API_KEY`, `FLOW_SECRET_KEY` y `FLOW_API_URL` a `https://www.flow.cl/api`, y probar con un cobro real pequeño.
- Agendar `sincronizar` a diario (pg_cron/pg_net o scheduler externo con `x-sync-secret`): decisión pendiente.
- Por verificar en Flow: qué envía el `urlCallback`, si `changePlan` cobra el precio nuevo de inmediato o desde el siguiente ciclo, y el vencimiento (`period_end` + 1 día).

## Pendientes heredados (sin verificar si siguen vigentes)
- `supabase/pruebas/reportes.sql`: el caso «reporte coincide con ventas, ítems y movimientos» fallaba desde antes de 0020.
- Ajuste de inventario por conteo físico (existe el permiso; faltan pantalla y RPC).
- Cierre de caja diario por cajero y tienda.

## Ojo
- La prueba del sandbox dejó una suscripción de prueba en una empresa de la base real.
- `/security-review` no encontró nada, pero el aviso de cobro (`?accion=cobro`) es público y dispara consultas a Flow: conviene vigilar el uso.
- `supabase/functions/admin-users` responde con CORS `*`; conviene restringirlo al origen del sitio.
- Push a `main` despliega a producción y el repo es público: no subir nada sin OK.

Detalle en bitácora: #planes #permisos #seguridad #suscripcion #flow
