#!/bin/bash
# Levanta storage-api de un proyecto con disco local, solo en loopback.
# Uso (como root): levantar_storage.sh <proyecto> <puerto>
set -euo pipefail
P="${1:?falta proyecto}"; PUERTO="${2:?falta puerto}"
IMAGEN="supabase/storage-api:v1.96.4"
DIR="/srv/$P"; NOMBRE="$P-storage"; UID_ST=10001
[[ "$P" =~ ^[a-z][a-z0-9_]*$ ]] || { echo "proyecto inválido"; exit 1; }
[ -f "$DIR/.env" ] || { echo "no existe $DIR/.env"; exit 1; }
docker ps -a --format '{{.Names}}' | grep -qx "$NOMBRE" && { echo "$NOMBRE ya existe, no se modifica"; exit 1; }
ss -ltnH | awk '{print $4}' | grep -qE "[:.]$PUERTO$" && { echo "puerto $PUERTO ocupado"; exit 1; }
valor() { grep -E "^$1=" "$DIR/.env" | head -1 | cut -d= -f2-; }
CLAVE_URL="$(valor CLAVE_STORAGE | python3 -c 'import sys,urllib.parse as u; print(u.quote(sys.stdin.read().strip(), safe=""))')"
mkdir -p "$DIR/archivos"; chown -R $UID_ST:$UID_ST "$DIR/archivos"; chmod 700 "$DIR/archivos"
umask 077
cat > "$DIR/storage.env" <<ENV
SERVER_HOST=127.0.0.1
SERVER_PORT=${PUERTO}
ANON_KEY=$(valor ANON_KEY)
SERVICE_KEY=$(valor SERVICE_KEY)
AUTH_JWT_SECRET=$(valor JWT_SECRET)
AUTH_JWT_ALGORITHM=HS256
DATABASE_URL=postgres://${P}_storage:${CLAVE_URL}@127.0.0.1:5433/${P}
DATABASE_MAX_CONNECTIONS=5
DB_INSTALL_ROLES=false
DB_ANON_ROLE=anon
DB_AUTHENTICATED_ROLE=authenticated
DB_SERVICE_ROLE=service_role
DB_SUPER_USER=${P}_storage_admin
TENANT_ID=${P}
REGION=local
GLOBAL_S3_BUCKET=${P}
STORAGE_BACKEND=file
STORAGE_FILE_BACKEND_PATH=/var/lib/storage
FILE_STORAGE_BACKEND_PATH=/var/lib/storage
FILE_SIZE_LIMIT=5242880
UPLOAD_FILE_SIZE_LIMIT=5242880
ENABLE_IMAGE_TRANSFORMATION=false
IMAGE_TRANSFORMATION_ENABLED=false
LOG_LEVEL=info
ENV
chmod 600 "$DIR/storage.env"
docker run -d --name "$NOMBRE" --network host --user $UID_ST --env-file "$DIR/storage.env" \
  -v "$DIR/archivos:/var/lib/storage" --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --memory 192m --memory-swap 192m --restart unless-stopped \
  --read-only --cap-drop ALL --security-opt no-new-privileges "$IMAGEN" >/dev/null
for _ in $(seq 1 40); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PUERTO/status")" = "200" ] && break
  sleep 1
done
echo "status: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PUERTO/status")"
docker inspect -f 'estado={{.State.Status}} reinicios={{.RestartCount}}' "$NOMBRE"
docker logs --tail 4 "$NOMBRE" 2>&1 | sed -E 's#postgres://[^ "]+#postgres://<oculto>#g' | cut -c1-200
