#!/usr/bin/env python3
"""Prueba de punta a punta en loopback: login, RLS y fotos.

Uso (como root): e2e_servicios.py <proyecto> [auth] [rest] [storage]
Usa solo los usuarios ficticios @prueba.invalid. Les pone una clave al azar
durante la prueba y al terminar la quita, junto con sesiones y archivos creados.
No imprime claves ni tokens.
"""
import base64, json, re, secrets, subprocess, sys, urllib.error, urllib.request

P = sys.argv[1] if len(sys.argv) > 1 else sys.exit("falta proyecto")
if not re.fullmatch(r"[a-z][a-z0-9_]*", P):
    sys.exit("proyecto inválido")
AUTH = f"http://127.0.0.1:{sys.argv[2] if len(sys.argv) > 2 else 9999}"
REST = f"http://127.0.0.1:{sys.argv[3] if len(sys.argv) > 3 else 3010}"
STOR = f"http://127.0.0.1:{sys.argv[4] if len(sys.argv) > 4 else 5000}"
CORREOS = ("admin@prueba.invalid", "otra@prueba.invalid")
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)

env = {}
for linea in open(f"/srv/{P}/.env", encoding="utf-8"):
    if "=" in linea and not linea.startswith("#"):
        k, v = linea.rstrip("\r\n").split("=", 1)
        env[k] = v.strip('"')
SERVICE, ANON = env["SERVICE_KEY"], env["ANON_KEY"]
fallos = 0


def http(metodo, url, token=None, datos=None, tipo="application/json", apikey=ANON):
    cab = {"apikey": apikey}
    if token:
        cab["Authorization"] = f"Bearer {token}"
    cuerpo = None
    if datos is not None:
        cuerpo = datos if isinstance(datos, bytes) else json.dumps(datos).encode()
        cab["Content-Type"] = tipo
    req = urllib.request.Request(url, data=cuerpo, headers=cab, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def js(b):
    try:
        return json.loads(b)
    except ValueError:
        return None


def caso(nombre, ok, detalle=""):
    global fallos
    fallos += 0 if ok else 1
    print(f"{'OK  ' if ok else 'FALLA'} {nombre}{'' if ok else ' -> ' + str(detalle)[:120]}")


def sql(q):
    return subprocess.run(
        ["runuser", "-u", "postgres", "--", "psql", "-p", "5433", "-d", P, "-v", "ON_ERROR_STOP=1", "-Atc", q],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def login(correo, clave):
    return http("POST", f"{AUTH}/token?grant_type=password", datos={"email": correo, "password": clave})


lista = ",".join(f"'{c}'" for c in CORREOS)
inicio = sql("select now()")
previas = sql(f"select count(*) from auth.users where email in ({lista}) and encrypted_password <> ''")
if previas != "0":
    sys.exit("Algún usuario ficticio ya tiene clave: no se modifica")
ids = dict(l.split("|") for l in sql(f"select email, id from auth.users where email in ({lista})").splitlines())
if len(ids) != 2:
    sys.exit("Faltan usuarios ficticios")

clave = secrets.token_urlsafe(24)
ruta_a = ruta_ajena = None
tok_a = None
try:
    for c in CORREOS:
        s, b = http("PUT", f"{AUTH}/admin/users/{ids[c]}", SERVICE, {"password": clave}, apikey=SERVICE)
        caso(f"admin API fija clave de {c.split('@')[0]}", s == 200, s)

    s, _ = http("PUT", f"{AUTH}/admin/users/{ids[CORREOS[0]]}", ANON, {"password": "x" * 12})
    caso("admin API rechaza anon key", s in (401, 403), s)

    s, b = login(CORREOS[0], clave)
    sesion_a = js(b) or {}
    tok_a = sesion_a.get("access_token")
    caso("login correcto", s == 200 and tok_a, s)
    s, b = login(CORREOS[1], clave)
    tok_b = (js(b) or {}).get("access_token")
    caso("login segunda empresa", s == 200 and tok_b, s)
    s, _ = login(CORREOS[0], clave + "x")
    caso("login con clave mala rechazado", s == 400, s)
    s, b = http("POST", f"{AUTH}/token?grant_type=refresh_token", datos={"refresh_token": sesion_a.get("refresh_token", "")})
    nuevo = (js(b) or {}).get("access_token")
    caso("refresh token", s == 200 and nuevo, s)

    s, b = http("GET", f"{REST}/empresas?select=id", tok_a)
    emp_a = [f["id"] for f in js(b) or []] if s == 200 else []
    caso("RLS: empresa A ve solo la suya", s == 200 and len(emp_a) == 1, (s, len(emp_a)))
    s, b = http("GET", f"{REST}/empresas?select=id", tok_b)
    emp_b = [f["id"] for f in js(b) or []] if s == 200 else []
    caso("RLS: empresa B ve solo la suya", s == 200 and len(emp_b) == 1 and emp_b != emp_a, (s, len(emp_b)))
    a, b_id = emp_a[0], emp_b[0]

    s, b = http("GET", f"{REST}/productos?select=id&limit=1", tok_a)
    caso("RLS: A lee sus productos", s == 200 and len(js(b) or []) == 1, s)
    s, b = http("GET", f"{REST}/productos?select=id&empresa_id=eq.{b_id}", tok_a)
    caso("RLS: A no lee productos de B", s == 200 and js(b) == [], (s, b[:60]))
    s, b = http("GET", f"{REST}/empresas?select=id&id=eq.{b_id}", tok_a)
    caso("RLS: A no lee la empresa B", s == 200 and js(b) == [], (s, b[:60]))
    s, _ = http("GET", f"{REST}/empresas?select=id")
    caso("REST sin token rechazado", s in (401, 403), s)

    nombre = f"e2e-{secrets.token_hex(6)}.png"
    ruta_a = f"{a}/{nombre}"
    s, b = http("POST", f"{STOR}/object/productos/{ruta_a}", tok_a, PNG, "image/png")
    subida = s == 200
    caso("foto: A sube a su carpeta", subida, (s, b[:100]))
    if not subida:
        ruta_a = None
    s, b = http("GET", f"{STOR}/object/public/productos/{a}/{nombre}")
    caso("foto: lectura pública devuelve el archivo", s == 200 and b == PNG, s)

    ruta_ajena = f"{b_id}/{nombre}"
    s, _ = http("POST", f"{STOR}/object/productos/{ruta_ajena}", tok_a, PNG, "image/png")
    caso("foto: A no sube a carpeta de B", s >= 400, s)
    if s < 400:
        pass
    else:
        ruta_ajena = None
    s, _ = http("POST", f"{STOR}/object/productos/{a}/anon-{nombre}", ANON, PNG, "image/png")
    caso("foto: anon no sube", s >= 400, s)
    s, _ = http("POST", f"{STOR}/object/productos/{a}/{nombre}.txt", tok_a, b"hola", "text/plain")
    caso("foto: tipo no permitido rechazado", s >= 400, s)
    if ruta_a:
        http("DELETE", f"{STOR}/object/productos/{ruta_a}", tok_b)
        n = sql(f"select count(*) from storage.objects where bucket_id='productos' and name='{ruta_a}'")
        caso("foto: B no borra la foto de A", n == "1", n)
        s, _ = http("DELETE", f"{STOR}/object/productos/{ruta_a}", tok_a)
        n = sql(f"select count(*) from storage.objects where bucket_id='productos' and name='{ruta_a}'")
        caso("foto: A borra su foto", s == 200 and n == "0", (s, n))
        if n == "0":
            ruta_a = None
except Exception as e:  # noqa: BLE001
    caso("ejecución", False, type(e).__name__)
finally:
    for ruta in (ruta_a, ruta_ajena):
        if ruta:
            http("DELETE", f"{STOR}/object/productos/{ruta}", SERVICE, apikey=SERVICE)
    sql(f"delete from auth.sessions where user_id in (select id from auth.users where email in ({lista})) and created_at >= '{inicio}'")
    sql(f"update auth.users set encrypted_password = '' where email in ({lista})")
    resto = sql(f"select count(*) from auth.users where email in ({lista}) and encrypted_password <> ''")
    objetos = sql("select count(*) from storage.objects where name like '%/e2e-%' or name like '%/anon-e2e-%'")
    caso("limpieza: claves quitadas", resto == "0", resto)
    caso("limpieza: sin archivos de prueba", objetos == "0", objetos)

print(f"\nFallos: {fallos}")
sys.exit(1 if fallos else 0)
