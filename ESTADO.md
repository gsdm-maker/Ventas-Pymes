Actualizado: 2026-11-24

## Último realizado
- Esta rama es la versión oficial. Se fusionó `origin/main` (63 commits del DBA, renombres a `db/` y `VITE_PG_*`) con `-s ours`: el contenido es el nuestro y el push avanza sin `--force`. Variables del frontend renombradas a `VITE_PG_URL` y `VITE_PG_KEY` (ya existen en Netlify). CSP de `netlify.toml` con las APIs propias, sin Supabase.
- QA repuesto (GoTrue, PostgREST, storage, funciones). E2E contra QA: 34 OK; venta offline con escritura OK (VTA-261124-00005, sincronizada y anulada, par salida/entrada en movimientos); subida de foto OK (bucket `productos`, RLS por empresa).
- Funciones recreadas con el script del repo: contenedor `misociopyme-fn` (usuario 1993, 128 MB, solo lectura). Secretos en `funciones.secretos`: Flow (sandbox), OpenAI, `AI_MODEL`, `SYNC_SECRET`. Respaldo previo: `/srv/misociopyme/respaldos/*_pre0030.dump`.
- Migraciones 0030 y 0031 ya aplicadas en `misociopyme`; suites de suscripción (61), auditoría (7) y seguridad ensayadas en copia sin diferencias.

## En curso / a medias
- Push pendiente (10 commits adelante de `origin/main`, 0 atrás). Sin push hasta el OK del dueño.

## Siguiente paso
- Producción apunta hoy a la API de QA: `VITE_PG_URL` de Netlify es `api-prueba…` (sin clientes: decisión A, temporal). `api-prd.misociopyme.cl` solo tiene PostgREST (sin login, fotos ni funciones) y no hay acceso a ese servidor.
- Antes del push: quitar `http://localhost:5173` de `APP_URLS_EXTRA`; conseguir claves de Flow de producción y actualizar los `urlCallback` de los planes; decidir si la clave de OpenAI de LUMIX se comparte.
- Avisar al DBA: contenedor renombrado `misociopyme-fn` y endurecido; la versión oficial es la nuestra. Servidor definitivo (VPS en Sudamérica) y alternativa de fotos siguen pendientes.

## Ojo
- Latencia ~230 ms Chile→VPS; solución real: proxy bajo el dominio de la app o VPS en Sudamérica.
- A producción pasan las migraciones, no la base. No usar `default_transaction_read_only` para congelar.
- Claves de Flow = sandbox (producción responde «apiKey not found»). Sin tiempo real: mesas y cocina se refrescan cada 20 s.
- Cuentas `e2e-admin` y `e2e4-admin` desactivadas (las referencian ventas). No escribir IP, dominios ni claves en el repo.

Detalle en bitácora: #vps #produccion #funciones #git #netlify
