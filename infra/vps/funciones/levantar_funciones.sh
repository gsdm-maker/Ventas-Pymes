#!/bin/bash
# Instala y levanta el servicio de funciones de un proyecto, solo en loopback.
# Uso (como root): levantar_funciones.sh <proyecto> <puerto> <rest> <auth> <url_publica> <origen_app> <dir_fuente>
#   <dir_fuente> contiene main.ts, deno.json, deno.lock (opcional) y fns/<nombre>/index.ts.
# Secretos opcionales en /srv/<proyecto>/funciones.secretos (600): FLOW_*, OPENAI_API_KEY,
# SYNC_SECRET, AI_MODEL. Nunca se imprimen.
set -euo pipefail

P="${1:?falta proyecto}"; PUERTO="${2:?falta puerto}"; REST="${3:?falta rest}"; AUTH="${4:?falta auth}"
URL_PUBLICA="${5:?falta url publica}"; ORIGEN="${6:?falta origen}"; FUENTE="${7:?falta dir fuente}"
IMAGEN="denoland/deno:2.3.3"
DIR="/srv/$P"; CODIGO="$DIR/funciones"; CACHE="$DIR/funciones_cache"; NOMBRE="$P-fn"
UID_DENO=1993

[[ "$P" =~ ^[a-z][a-z0-9_]*$ ]] || { echo "proyecto inválido"; exit 1; }
[[ "$URL_PUBLICA" =~ ^https://[a-z0-9.-]+$ ]] || { echo "url pública inválida"; exit 1; }
[ -f "$DIR/.env" ] || { echo "no existe $DIR/.env"; exit 1; }
if docker ps -a --format '{{.Names}}' | grep -qx "$NOMBRE"; then echo "$NOMBRE ya existe, no se modifica"; exit 1; fi
if ss -ltnH | awk '{print $4}' | grep -qE "[:.]$PUERTO$"; then echo "puerto $PUERTO ocupado"; exit 1; fi

valor() { grep -E "^$1=" "$2" 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/^"//; s/"$//' || true; }
SECRETOS="$DIR/funciones.secretos"
FLOW_URL="$(valor FLOW_API_URL "$SECRETOS")"; FLOW_URL="${FLOW_URL:-https://sandbox.flow.cl/api}"
FLOW_HOST="$(printf '%s' "$FLOW_URL" | sed -E 's#^https://([^/]+).*#\1#')"
case "$FLOW_HOST" in sandbox.flow.cl|www.flow.cl) ;; *) echo "host de Flow no permitido"; exit 1 ;; esac

# Código de solo lectura y dependencias fijadas por el lockfile
umask 027
rm -rf "$CODIGO"; mkdir -p "$CODIGO" "$CACHE"
cp -r "$FUENTE/main.ts" "$FUENTE/deno.json" "$FUENTE/fns" "$CODIGO/"
[ -f "$FUENTE/deno.lock" ] && cp "$FUENTE/deno.lock" "$CODIGO/"
chown -R root:$UID_DENO "$CODIGO"; chmod -R g+rX,o-rwx "$CODIGO"
chown -R $UID_DENO:$UID_DENO "$CACHE"; chmod 750 "$CACHE"

LOCK_ARGS="--lock=/tmp/deno.lock"
docker run --rm --user $UID_DENO -v "$CODIGO:/app:ro" -v "$CACHE:/deno-dir" -e DENO_DIR=/deno-dir \
  --entrypoint sh "$IMAGEN" -c "cp /app/deno.lock /tmp/deno.lock 2>/dev/null || true; cd /app && deno cache --config /app/deno.json $LOCK_ARGS main.ts && cat /tmp/deno.lock" > "$DIR/funciones.lock.nuevo"
if [ -f "$CODIGO/deno.lock" ]; then
  cmp -s "$CODIGO/deno.lock" "$DIR/funciones.lock.nuevo" || { echo "el lockfile cambió: revisar dependencias"; rm -f "$DIR/funciones.lock.nuevo"; exit 1; }
  rm -f "$DIR/funciones.lock.nuevo"
else
  install -o root -g $UID_DENO -m 640 "$DIR/funciones.lock.nuevo" "$CODIGO/deno.lock"
  mv "$DIR/funciones.lock.nuevo" "$DIR/funciones.lock"
fi

umask 077
{
  echo "SUPABASE_URL=$URL_PUBLICA"
  echo "SUPABASE_ANON_KEY=$(valor ANON_KEY "$DIR/.env")"
  echo "SUPABASE_SERVICE_ROLE_KEY=$(valor SERVICE_KEY "$DIR/.env")"
  echo "REST_INTERNO=http://127.0.0.1:$REST"
  echo "AUTH_INTERNO=http://127.0.0.1:$AUTH"
  echo "PUERTO=$PUERTO"
  echo "APP_URL=$ORIGEN"
  echo "ALLOWED_ORIGIN=$ORIGEN"
  echo "DENO_DIR=/deno-dir"
  [ -f "$SECRETOS" ] && grep -E '^(FLOW_API_KEY|FLOW_SECRET_KEY|FLOW_API_URL|OPENAI_API_KEY|AI_MODEL|SYNC_SECRET|APP_URLS_EXTRA)=' "$SECRETOS" || true
} > "$DIR/funciones.env"
chmod 600 "$DIR/funciones.env"

VARS="SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,REST_INTERNO,AUTH_INTERNO,PUERTO,APP_URL,APP_URLS_EXTRA,ALLOWED_ORIGIN,FLOW_API_KEY,FLOW_SECRET_KEY,FLOW_API_URL,OPENAI_API_KEY,AI_MODEL,SYNC_SECRET"
RED="127.0.0.1:$PUERTO,127.0.0.1:$REST,127.0.0.1:$AUTH,api.openai.com:443,$FLOW_HOST:443"

docker run -d --name "$NOMBRE" --network host --user $UID_DENO \
  --env-file "$DIR/funciones.env" \
  -v "$CODIGO:/app:ro" -v "$CACHE:/deno-dir:ro" \
  --memory 128m --memory-swap 128m --pids-limit 64 \
  --restart unless-stopped --read-only --tmpfs /tmp:size=8m \
  --cap-drop ALL --security-opt no-new-privileges \
  --workdir /app --entrypoint deno "$IMAGEN" \
  run --cached-only --frozen --config /app/deno.json --lock=/app/deno.lock \
  --allow-env="$VARS" --allow-net="$RED" --allow-read=/app,/deno-dir \
  /app/main.ts >/dev/null

for _ in $(seq 1 20); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PUERTO/health")" = "200" ] && break
  sleep 1
done
echo "health: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PUERTO/health")"
docker inspect -f 'estado={{.State.Status}} reinicios={{.RestartCount}} mem={{.HostConfig.Memory}}' "$NOMBRE"
docker logs --tail 5 "$NOMBRE" 2>&1 | cut -c1-160
