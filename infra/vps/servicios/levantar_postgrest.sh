#!/bin/bash
# Levanta PostgREST de un proyecto, solo en loopback.
# Uso (como root): levantar_postgrest.sh <proyecto> <puerto> <puerto_admin>
# Lee las claves de /srv/<proyecto>/.env y nunca las imprime.
set -euo pipefail

P="${1:?falta proyecto}"
PUERTO="${2:?falta puerto}"
ADMIN="${3:?falta puerto admin}"
IMAGEN="postgrest/postgrest:v12.2.3"
DIR="/srv/$P"
NOMBRE="$P-rest"

[[ "$P" =~ ^[a-z][a-z0-9_]*$ ]] || { echo "proyecto inválido"; exit 1; }
[ -f "$DIR/.env" ] || { echo "no existe $DIR/.env"; exit 1; }

if docker ps -a --format '{{.Names}}' | grep -qx "$NOMBRE"; then
  echo "$NOMBRE ya existe, no se modifica"; exit 1
fi
for x in "$PUERTO" "$ADMIN"; do
  if ss -ltnH | awk '{print $4}' | grep -qE "[:.]$x$"; then
    echo "puerto $x ocupado"; exit 1
  fi
done

valor() { grep -E "^$1=" "$DIR/.env" | head -1 | cut -d= -f2- | sed -E 's/^"//; s/"$//'; }
CLAVE="$(valor CLAVE_AUTHENTICATOR)"
JWT="$(valor JWT_SECRET)"
[ -n "$CLAVE" ] && [ -n "$JWT" ] || { echo "faltan claves en .env"; exit 1; }
CLAVE_URL="$(printf '%s' "$CLAVE" | python3 -c 'import sys,urllib.parse as u; print(u.quote(sys.stdin.read(), safe=""))')"

umask 077
cat > "$DIR/postgrest.env" <<ENV
PGRST_DB_URI=postgres://${P}_authenticator:${CLAVE_URL}@127.0.0.1:5433/${P}
PGRST_DB_SCHEMAS=public
PGRST_DB_ANON_ROLE=anon
PGRST_JWT_SECRET=${JWT}
PGRST_DB_POOL=5
PGRST_DB_MAX_ROWS=1000
PGRST_OPENAPI_MODE=disabled
PGRST_SERVER_HOST=127.0.0.1
PGRST_SERVER_PORT=${PUERTO}
PGRST_ADMIN_SERVER_PORT=${ADMIN}
PGRST_LOG_LEVEL=warn
ENV
chmod 600 "$DIR/postgrest.env"

docker run -d --name "$NOMBRE" \
  --network host \
  --env-file "$DIR/postgrest.env" \
  --memory 64m --memory-swap 64m \
  --restart unless-stopped \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  "$IMAGEN" >/dev/null

for _ in $(seq 1 15); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$ADMIN/ready")" = "200" ]; then
    echo "ready 200"; break
  fi
  sleep 1
done

echo "ready final: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$ADMIN/ready")"
echo "escucha:"; ss -ltnH | awk '{print $4}' | grep -E "[:.]($PUERTO|$ADMIN)$" || true
echo "sin token, tabla empresas: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PUERTO/empresas?select=id&limit=1")"
echo "sin token, filas visibles: $(curl -s "http://127.0.0.1:$PUERTO/empresas?select=id&limit=5" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else "error: "+str(d.get("code")))')"
echo "token falso: $(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer abc.def.ghi' "http://127.0.0.1:$PUERTO/empresas?select=id&limit=1")"
docker inspect -f 'estado={{.State.Status}} reinicios={{.RestartCount}} mem={{.HostConfig.Memory}}' "$NOMBRE"
docker logs --tail 5 "$NOMBRE" 2>&1 | sed -E 's#postgres://[^ ]+#postgres://<oculto>#g' | cut -c1-160
