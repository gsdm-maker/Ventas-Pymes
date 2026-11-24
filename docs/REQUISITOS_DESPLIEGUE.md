# Mi Socio Pyme: requerimientos de arquitectura y despliegue (QA y PRD)

Fecha: 2026-11-23. Para el DBA / quien monta los ambientes. Sin IP, dominios ni claves (repo público): los valores van en variables de entorno de cada ambiente.

## 1. Qué es

Aplicación de inventario y ventas (POS) para pymes de retail y restaurante. Multi-empresa, multi-bodega, PWA con modo sin conexión. Moneda CLP sin decimales, IVA 19 %, fechas DD/MM/AAAA. Aún no tiene clientes: se puede montar limpio.

## 2. Arquitectura

```
Navegador (PWA, React)  ──https──►  nginx (TLS, CORS, límites)
   │  IndexedDB: copia local y cola de ventas offline        ├─ /auth/v1       → GoTrue        (login, usuarios, claves)
   │                                                         ├─ /rest/v1       → PostgREST     (API de tablas, filtrada por RLS)
   │                                                         ├─ /storage/v1    → storage-api   (fotos de productos)
   │                                                         └─ /functions/v1  → Deno          (admin-users, asistente, suscripcion)
   └─ Sitio estático (Netlify) ◄── git push a main                      │
                                                                         ▼
                                                  PostgreSQL 18, UNA base por proyecto
```

- **El frontend es solo archivos estáticos.** Habla con la API por HTTP usando la librería `@supabase/supabase-js`. Es una librería de código abierto que corre en el navegador: no se conecta a ningún servidor de Supabase. Nada del sistema apunta a `supabase.co` (revisado el 23/11: configuración, base y funciones).
- **El aislamiento entre empresas vive en la base** (RLS), no en la aplicación. Toda tabla nueva lleva RLS.
- **Sin tiempo real:** mesas y cocina se refrescan cada 20 s.

## 3. Componentes y versiones

| Pieza | Versión probada | Función | Por proyecto |
|---|---|---|---|
| PostgreSQL | 17.12 (pruebas) / 18 (VPS) | Base de datos | una base |
| GoTrue (`supabase/gotrue`) | v2.198.0 (mínima) | Login, renovación de sesión, alta de usuarios, recuperación de clave | un contenedor |
| PostgREST | v12.2.3 | API REST sobre el esquema `public` | un contenedor |
| storage-api (`supabase/storage-api`) | v1.96.4 | Fotos en disco local, bucket público `productos` | un contenedor |
| Deno | 2.3.3 | Funciones `admin-users`, `asistente`, `suscripcion` | un contenedor |
| nginx | 1.28 | TLS, HTTP/2 (`http2 on;`), CORS, enrutamiento | un sitio |
| Resend (SMTP) | externo | Correos de acceso y recuperación | clave de solo envío |
| Flow | externo | Cobro automático de suscripciones | claves por ambiente |
| OpenAI (opcional) | externo | Asistente «Socio IA» | clave por ambiente |
| Netlify | externo | Hospeda el frontend, despliega al hacer `git push` a `main` | un sitio |

GoTrue, PostgREST y storage-api son programas independientes de código abierto. Si se prefiere otra pieza para fotos, el frontend solo necesita: subir, obtener URL pública y borrar en el bucket `productos`.

## 4. Base de datos

- Un cluster con **una base por proyecto** (`<p>`). Roles compartidos sin login: `anon`, `authenticated`, `service_role`, `supabase_auth_admin`, `supabase_storage_admin`. Por proyecto: `<p>_owner` (dueño de `public`, sin login), `<p>_authenticator` (PostgREST), `<p>_auth` (GoTrue), `<p>_storage` (storage-api).
- Esquemas: `public` (la app), `auth` (GoTrue), `storage` (storage-api), `extensions`.
- **Migraciones:** `supabase/migrations/0001…0031`, en orden, cada una con `SET ROLE <p>_owner`. A producción pasan las **migraciones**, no una copia de la base (una copia pisaría datos de clientes). Solo la primera vez, sin clientes, se puede restaurar un respaldo.
- **Pruebas SQL:** `supabase/pruebas/*.sql` (15 suites, 352 casos). Se corren en una copia temporal y no dejan cambios: `infra/vps/pruebas/correr_suites.sh`.
- **Verificaciones:** `infra/vps/90_verificar_cluster.sql` (aislamiento entre proyectos) y `91_verificar_base.sql`.
- `pg_hba.conf`: cada rol de proyecto solo a su base (plantilla `infra/vps/pg_hba.plantilla.conf`). El rol `gsdm_admin` administra `misociopyme` como miembro de `misociopyme_owner`.
- Plantilla completa y razones: `docs/DISENO_PLANTILLA_VPS.md`, `docs/AUDITORIA_VPS.md`. Scripts: `infra/vps/servicios/` (`generar_env.sh`, `levantar_gotrue.sh`, `levantar_postgrest.sh`, `levantar_storage.sh`, plantilla de nginx) y `infra/vps/funciones/levantar_funciones.sh`.

## 5. Variables de entorno

| Dónde | Variables (nombres) |
|---|---|
| Netlify (frontend) | `VITE_PG_URL` (URL pública de la API), `VITE_PG_KEY` (clave pública `anon`) |
| GoTrue | URL de la base (`<p>_auth`), secreto JWT, URL del sitio y orígenes permitidos, SMTP (Resend), `enable_signup = false` |
| PostgREST | URL de la base (`<p>_authenticator`), secreto JWT, esquema `public` |
| storage-api | URL de la base (`<p>_storage`), secreto JWT, directorio de archivos |
| Funciones Deno | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGIN`, `APP_URL`, `APP_URLS_EXTRA`, `FLOW_API_URL`, `FLOW_API_KEY`, `FLOW_SECRET_KEY`, `SYNC_SECRET`, `OPENAI_API_KEY`, `AI_MODEL` |

Los nombres con `SUPABASE_` son solo etiquetas que el código ya usa; los valores apuntan a la API propia. El mismo secreto JWT va en GoTrue, PostgREST y storage. La clave `service_role` nunca llega al navegador. Los archivos `.env` se generan con `generar_env.sh` y no se versionan.

## 6. Seguridad (condiciones que no se negocian)

- Registro público cerrado (`enable_signup = false`): los usuarios los crea el administrador desde la app.
- CORS solo para el dominio de la app (y `http://localhost:5173` en QA).
- CSP en `netlify.toml` debe listar el dominio de la API (hoy aún trae `*.supabase.co`: se cambia al desplegar).
- Sin límite de intentos de login no se sale a producción: nginx debe limitar `/auth/v1/token`.
- Ningún rol de aplicación con `BYPASSRLS` ni superusuario, salvo `service_role`.

## 7. Usuario principal (administrador general)

Es el dueño de la plataforma: crea empresas, define su rubro y módulos, y ve la auditoría. Las empresas tienen su propio administrador, que da accesos por usuario dentro de los módulos que el administrador general le habilitó.

Cómo se crea el primero (no hay registro público):
1. Crear el usuario con la API admin de GoTrue (solo desde el servidor, con la `service_role`): correo, clave temporal y `email_confirm = true`.
2. El alta crea su fila en `public.profiles`. Marcarla como administrador general: `es_owner = true`, sin `empresa_id`, `activo = true`, `must_change_password = true` (la app obliga a cambiar la clave en el primer ingreso).
3. Entra a la app y queda en `/admin`. Desde ahí crea la primera empresa y su administrador; ese administrador crea los demás usuarios.

## 8. Orden de montaje (QA y luego PRD)

1. Crear la base `<p>`, sus roles y `pg_hba` (`00_cluster_una_vez.sql`, `01_proyecto.sql`).
2. Generar los `.env` y levantar GoTrue (crea sus tablas en `auth`), PostgREST, storage-api y las funciones.
3. Aplicar las migraciones en orden con `SET ROLE <p>_owner`.
4. Correr `91_verificar_base.sql`, `90_verificar_cluster.sql` y las suites.
5. Configurar nginx (TLS, CORS, HTTP/2, límite de login) y correos (`infra/vps/correos/`).
6. Crear el administrador general (sección 7) y probar: login, crear empresa, POS, venta sin conexión.
7. PRD: repetir 1 a 6 con valores propios. Con clientes en producción, solo migraciones.

## 9. Requisitos de servidor

- Linux con Docker, Postgres accesible en el VPS, nginx con certificado (certbot) y HTTP/2.
- GoTrue se limita a 128 MB; el resto de los contenedores son livianos. Con un cluster para varios proyectos conviene reservar memoria por contenedor.
- **Latencia:** Chile → Alemania/Finlandia ronda los 230 ms por viaje y cada consulta distinta paga además un preflight CORS. Un VPS en Sudamérica o un proxy bajo el dominio de la app lo resuelve; no se arregla en el código.
- Respaldos: `pg_dump` periódico fuera del servidor y snapshot del VPS.

## 10. Decisiones pendientes

- **PRD en un VPS propio**, separado de otros sistemas (por ejemplo la clínica), para no mezclar contenedores ni credenciales.
- **Fotos:** conservar storage-api o elegir otra alternativa (disco con nginx más una función de subida, o un bucket externo).
- **Hostname de la API** definitivo (hoy el de QA) y cambio del CSP y de las variables de Netlify.
- Actualizar los `urlCallback` de los planes de Flow al pasar a producción.
