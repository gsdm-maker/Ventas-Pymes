# Plan: migración a VPS sin Supabase

Creado: 2026-11-22. Estado: propuesto. Sin commit (el repo es público: no escribir aquí IP, dominios internos, claves ni IDs de proyecto).

## Objetivo y motivo
Dejar de depender de Supabase (límite de 2 proyectos activos, 4 proyectos y 2 más por venir). Un Postgres en un VPS con una base separada por proyecto. Pesa más el costo y la escalabilidad que el tiempo de configuración.

## Punto de partida
- El VPS (Ubuntu, 4 CPU, ~7,6 GB RAM, ~56 GB libres) ya tiene un ambiente de Mi Socio Pyme: Postgres 18 con base `misociopyme`, contenedores `misociopyme-api` y `misociopyme-postgrest`, nginx con TLS y un servicio de login compatible en `/auth/v1/`.
- Se desconoce hasta dónde llega: versión del esquema frente a las 30 migraciones, roles, RLS, auth, storage y respaldos.
- Acoplamiento con Supabase: 88 `.from()` y 26 `.rpc()` en 14 archivos, 66 políticas RLS, 143 funciones SQL, 91 usos de `auth.uid()`, 3 Edge Functions (`admin-users`, `asistente`, `suscripcion`), 1 bucket de fotos (migración 0016).

## Reglas de todas las fases
- Producción (Supabase) no se toca hasta la fase 6. Todo lo anterior es solo lectura sobre producción.
- Nada se despliega ni se sube a git sin OK del dueño.
- Criterio de salida de seguridad: las 15 suites de `supabase/pruebas` pasan contra la base del VPS.
- Nunca mostrar ni copiar contenido de `Datakeys.md`.
- Cada fase termina con `memoria-cierre-tarea` y `/clear`.

## Fases

| # | Fase | Modelo | Entregable | Criterio de salida |
|---|---|---|---|---|
| 0 | Respaldo y línea base: snapshot del VPS desde el panel, `pg_dump` de la base actual del VPS, copia fuera del servidor | **Sonnet** | Respaldos verificados | Se restaura una copia en una base temporal sin errores |
| 1 | Auditoría de lo existente: esquema vs migraciones 0001–0030, roles (`anon`, `authenticated`, `service_role`), `auth`, `storage`, qué es `misociopyme-api`, firewall, puertos, respaldos | **Opus** | Informe en `docs/` con brechas y riesgos | Lista cerrada de lo que falta |
| 2 | Diseño de la plantilla: roles, esquema `auth` mínimo, `auth.uid()` desde el JWT, reemplazo de `storage.objects` (MinIO o carpeta), aislamiento entre bases con `REVOKE CONNECT` | **Opus** | Documento de diseño y SQL de arranque | Revisado con `/security-review` |
| 3 | Base y pruebas: aplicar las 30 migraciones, correr las 15 suites, corregir lo que falle por falta de `auth`/`storage` | **Sonnet** (corre) + **Opus** (decide cada arreglo de seguridad) | Migraciones adaptadas (nuevas, sin reescribir las aplicadas) | 15 suites en verde |
| 4 | Servicios: PostgREST, login (GoTrue o equivalente), MinIO, nginx por subdominio, correos de Auth, límites de memoria | **Sonnet** | Compose y plantillas de configuración | `/health` responde; login, consulta con RLS y subida de foto funcionan en un entorno de prueba |
| 5 | Funciones: portar `admin-users`, `asistente` y `suscripcion` a un servicio Deno, con los secretos de Flow fuera del repo | **Opus** para `admin-users` y `suscripcion` (service key y cobros), **Sonnet** para `asistente` | Servicio con las 3 funciones | Pruebas de cada función; `/security-review` sin hallazgos de confianza alta |
| 6 | Piloto y ensayo de corte: copia de producción restaurada en el VPS, cliente apuntando a la nueva URL en un entorno de prueba, medir tiempos | **Sonnet** (ejecuta) + **Opus** (revisa el plan de corte) | Guion de corte con tiempos y marcha atrás | Ensayo completo sin pérdida de datos |
| 7 | Corte a producción: ventana acordada con el dueño, `pg_dump` y `pg_restore` desde Supabase, cambio de URL y claves, Flow apuntando al nuevo callback | **Opus** | Producción en el VPS | Verificaciones posteriores y vigilancia 48 h; Supabase queda como respaldo |
| 8 | Operación: respaldos diarios con copia externa, prueba de restauración mensual, monitoreo, actualizaciones | **Sonnet** | Manual de operación | Una restauración de prueba registrada |

## Búsquedas y exploración
Subagentes con **haiku** o **sonnet**, que devuelvan solo texto. No leer las 30 migraciones completas: buscar por tabla o política.

## Cuándo subir a Opus aunque la fase sea de Sonnet
- Una prueba de RLS o permisos falla.
- Un bug no cede tras dos intentos.
- Hay que tocar auth, `service_role`, cobros o datos de otras empresas.

## Riesgos principales
1. Romper el aislamiento entre empresas al cambiar de dónde sale `auth.uid()`.
2. Pérdida de datos en el corte (mitigado con la fase 6).
3. Servidor único: sin respaldo fuera del VPS no hay recuperación.
4. Funciones con `service_role`: una configuración floja expone todo.

## Por decidir
- Quién montó el ambiente actual del VPS y si se reutiliza o se rehace con plantilla limpia.
- Login: GoTrue o alternativa.
- Fotos: MinIO o disco con nginx.
- Cuáles son los otros proyectos y cuál sirve de piloto.
