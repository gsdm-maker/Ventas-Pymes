#!/bin/bash
# Levanta GoTrue de un proyecto, solo en loopback.
# Uso (como root): levantar_gotrue.sh <proyecto> <puerto> <url_publica_api> <origen_app>
# Lee /srv/<p>/.env. Opcional /srv/<p>/gotrue.extra (600): SMTP y plantillas de correo (ver correos/LEEME.md).
set -euo pipefail
P="${1:?falta proyecto}"; PUERTO="${2:?falta puerto}"; URL="${3:?falta url publica de la api}"; ORIGEN="${4:?falta origen de la app}"
IMAGEN="supabase/gotrue:v2.198.0"
DIR="/srv/$P"; NOMBRE="$P-auth"
[[ "$P" =~ ^[a-z][a-z0-9_]*$ ]] || { echo "proyecto inválido"; exit 1; }
[[ "$URL" =~ ^https://[a-z0-9.-]+$ ]] || { echo "url inválida"; exit 1; }
[ -f "$DIR/.env" ] || { echo "no existe $DIR/.env"; exit 1; }
docker ps -a --format '{{.Names}}' | grep -qx "$NOMBRE" && { echo "$NOMBRE ya existe, no se modifica"; exit 1; }
ss -ltnH | awk '{print $4}' | grep -qE "[:.]$PUERTO$" && { echo "puerto $PUERTO ocupado"; exit 1; }
valor() { grep -E "^$1=" "$DIR/.env" | head -1 | cut -d= -f2-; }
CLAVE_URL="$(valor CLAVE_AUTH | python3 -c 'import sys,urllib.parse as u; print(u.quote(sys.stdin.read().strip(), safe=""))')"
umask 077
{
cat <<ENV
GOTRUE_API_HOST=127.0.0.1
PORT=${PUERTO}
GOTRUE_SITE_URL=${ORIGEN}
GOTRUE_URI_ALLOW_LIST=${ORIGEN}
GOTRUE_DB_DRIVER=postgres
GOTRUE_DB_NAMESPACE=auth
GOTRUE_DB_DATABASE_URL=postgres://${P}_auth:${CLAVE_URL}@127.0.0.1:5433/${P}
GOTRUE_DB_MAX_POOL_SIZE=5
GOTRUE_JWT_SECRET=$(valor JWT_SECRET)
GOTRUE_JWT_EXP=3600
GOTRUE_JWT_AUD=authenticated
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
GOTRUE_JWT_ADMIN_ROLES=service_role
GOTRUE_DISABLE_SIGNUP=true
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_EXTERNAL_PHONE_ENABLED=false
GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false
GOTRUE_MAILER_AUTOCONFIRM=false
GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true
GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL=10
GOTRUE_PASSWORD_MIN_LENGTH=8
GOTRUE_LOG_LEVEL=info
API_EXTERNAL_URL=${URL}/auth/v1
GOTRUE_RATE_LIMIT_HEADER=X-Real-IP
ENV
[ -f "$DIR/gotrue.extra" ] && cat "$DIR/gotrue.extra" || true
} > "$DIR/gotrue.env"
chmod 600 "$DIR/gotrue.env"
docker run -d --name "$NOMBRE" --network host --env-file "$DIR/gotrue.env" \
  --memory 128m --memory-swap 128m --restart unless-stopped \
  --read-only --cap-drop ALL --security-opt no-new-privileges "$IMAGEN" auth >/dev/null
for _ in $(seq 1 40); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PUERTO/health")" = "200" ] && break
  sleep 1
done
echo "health: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PUERTO/health")"
docker inspect -f 'estado={{.State.Status}} reinicios={{.RestartCount}}' "$NOMBRE"
docker logs --tail 4 "$NOMBRE" 2>&1 | sed -E 's#postgres://[^ "]+#postgres://<oculto>#g' | cut -c1-200
