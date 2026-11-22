#!/bin/bash
# Genera /srv/<proyecto>/.env con claves nuevas y propias del proyecto (no pisa uno existente).
# Uso (como root): generar_env.sh <proyecto>
# Contiene: CLAVE_AUTHENTICATOR, CLAVE_AUTH, CLAVE_STORAGE, JWT_SECRET, ANON_KEY, SERVICE_KEY. Nunca imprime valores.
set -euo pipefail
P="${1:?falta proyecto}"
DIR="/srv/$P"
[[ "$P" =~ ^[a-z][a-z0-9_]*$ ]] || { echo "proyecto inválido"; exit 1; }
[ -e "$DIR/.env" ] && { echo "$DIR/.env ya existe, no se modifica"; exit 1; }
mkdir -p "$DIR"
umask 077
python3 - "$DIR/.env" <<'PY'
import base64, hashlib, hmac, json, secrets, sys, time
def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def jwt(rol, secreto):
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(',', ':')).encode())
    p = b64(json.dumps({"role": rol, "iss": "misociopyme", "iat": int(time.time()), "exp": int(time.time()) + 10*365*86400}, separators=(',', ':')).encode())
    s = b64(hmac.new(secreto.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
    return f"{h}.{p}.{s}"
tok = lambda: secrets.token_urlsafe(32).replace('-', 'x').replace('_', 'y')
jwt_secret = secrets.token_urlsafe(48)
lineas = {
    "CLAVE_AUTHENTICATOR": tok(), "CLAVE_AUTH": tok(), "CLAVE_STORAGE": tok(),
    "JWT_SECRET": jwt_secret, "ANON_KEY": jwt("anon", jwt_secret), "SERVICE_KEY": jwt("service_role", jwt_secret),
}
with open(sys.argv[1], "w") as f:
    for k, v in lineas.items(): f.write(f"{k}={v}\n")
PY
chmod 600 "$DIR/.env"
echo "creado $DIR/.env con: $(cut -d= -f1 "$DIR/.env" | tr '\n' ' ')"
