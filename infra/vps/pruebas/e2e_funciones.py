#!/usr/bin/env python3
"""Prueba de punta a punta de admin-users, asistente y suscripcion, en loopback.

Uso (como root): e2e_funciones.py <proyecto> [rest] [auth]
Levanta una instancia temporal con claves falsas. Flow y OpenAI son simuladores locales:
no hay cobros, correos ni gasto real. Crea empresas y usuarios ficticios y los borra al final.
No imprime claves ni tokens.
"""
import hashlib, hmac, json, os, re, secrets, subprocess, sys, threading, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

P = sys.argv[1] if len(sys.argv) > 1 else sys.exit("falta proyecto")
if not re.fullmatch(r"[a-z][a-z0-9_]*", P):
    sys.exit("proyecto inválido")
REST_P = sys.argv[2] if len(sys.argv) > 2 else "3010"
AUTH_P = sys.argv[3] if len(sys.argv) > 3 else "9999"
PUERTO, MOCK_P = 3013, 3014
BASE = f"http://127.0.0.1:{PUERTO}/functions/v1"
AUTH = f"http://127.0.0.1:{AUTH_P}"
MOCK = f"http://127.0.0.1:{MOCK_P}"
NOMBRE = f"{P}-fn-e2e"
PREFIJO = "fn-e2e-"
DOMINIO = "@prueba.invalid"
EMPRESA = "E2E-FN "
FLOW_SECRET = secrets.token_hex(24)
SYNC = secrets.token_hex(24)
ORIGEN = "http://localhost:5173"
PUBLICA = "https://funciones-e2e.invalid"

env = {}
for linea in open(f"/srv/{P}/.env", encoding="utf-8"):
    if "=" in linea and not linea.startswith("#"):
        k, v = linea.rstrip("\r\n").split("=", 1)
        env[k] = v.strip('"')
SERVICE, ANON = env["SERVICE_KEY"], env["ANON_KEY"]
fallos = 0


def caso(nombre, ok, detalle=""):
    global fallos
    fallos += 0 if ok else 1
    print(f"{'OK  ' if ok else 'FALLA'} {nombre}{'' if ok else ' -> ' + str(detalle)[:160]}", flush=True)


def sql(q):
    return subprocess.run(
        ["runuser", "-u", "postgres", "--", "psql", "-p", "5433", "-d", P, "-v", "ON_ERROR_STOP=1", "-Atc", q],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


# ---------------- Simulador de Flow y OpenAI ----------------
class Estado:
    planes, clientes, subs = {}, {}, {}
    tokens = {}
    firmas_malas = 0
    creadas = 0
    mensajes_ia = []


def invoice(sub):
    hoy = datetime.now()
    return {
        "id": 9000 + sub["n"], "status": 1, "amount": sub["monto"], "attemp_count": 0, "error": 0,
        "period_start": hoy.strftime("%Y-%m-%d 00:00:00"),
        "period_end": (hoy + timedelta(days=30)).strftime("%Y-%m-%d 00:00:00"),
    }


class Mock(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def responder(self, cuerpo, status=200):
        b = json.dumps(cuerpo).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def flow(self, ruta, q):
        firma = q.pop("s", "")
        base = "".join(k + q[k] for k in sorted(q))
        if not hmac.compare_digest(firma, hmac.new(FLOW_SECRET.encode(), base.encode(), hashlib.sha256).hexdigest()):
            Estado.firmas_malas += 1
            return self.responder({"message": "firma"}, 401)
        if ruta == "/plans/get":
            return self.responder(Estado.planes[q["planId"]]) if q["planId"] in Estado.planes else self.responder({"message": "no existe"}, 400)
        if ruta == "/plans/create":
            Estado.planes[q["planId"]] = {"planId": q["planId"], "amount": int(q["amount"]), "urlCallback": q.get("urlCallback")}
            return self.responder(Estado.planes[q["planId"]])
        if ruta == "/customer/create":
            c = f"cus_{secrets.token_hex(4)}"
            Estado.clientes[c] = q
            return self.responder({"customerId": c})
        if ruta == "/customer/register":
            t = secrets.token_hex(8)
            Estado.tokens[t] = {"customerId": q["customerId"], "status": 1, "url_return": q.get("url_return")}
            return self.responder({"url": f"{MOCK}/registro", "token": t})
        if ruta == "/customer/getRegisterStatus":
            d = Estado.tokens.get(q["token"])
            if not d:
                return self.responder({"message": "token"}, 400)
            return self.responder({"status": d["status"], "customerId": d["customerId"], "creditCardType": "Visa", "last4CardDigits": "4242"})
        if ruta == "/subscription/create":
            Estado.creadas += 1
            s = f"sus_{secrets.token_hex(4)}"
            Estado.subs[s] = {"n": Estado.creadas, "monto": Estado.planes[q["planId"]]["amount"], "cancel": 0, "status": 1}
            return self.responder({"subscriptionId": s, "next_invoice_date": (datetime.now() + timedelta(days=31)).strftime("%Y-%m-%d 00:00:00")})
        if ruta == "/subscription/get":
            x = Estado.subs[q["subscriptionId"]]
            return self.responder({
                "subscriptionId": q["subscriptionId"], "status": x["status"], "morose": 0, "cancel_at_period_end": x["cancel"],
                "next_invoice_date": (datetime.now() + timedelta(days=31)).strftime("%Y-%m-%d 00:00:00"), "invoices": [invoice(x)],
            })
        if ruta == "/subscription/cancel":
            Estado.subs[q["subscriptionId"]]["cancel"] = 1
            return self.responder({"ok": True})
        return self.responder({"message": "ruta"}, 404)

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        self.flow(u.path.removeprefix("/flow"), dict(urllib.parse.parse_qsl(u.query)))

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        cuerpo = self.rfile.read(n)
        if self.path == "/v1/chat/completions":
            d = json.loads(cuerpo)
            Estado.mensajes_ia.append(json.dumps(d["messages"], ensure_ascii=False))
            if any(m["role"] == "tool" for m in d["messages"]):
                return self.responder({"choices": [{"message": {"role": "assistant", "content": "respuesta simulada"}}]})
            return self.responder({"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [{
                "id": "call_1", "type": "function",
                "function": {"name": "consultar_stock", "arguments": json.dumps({"texto": None, "solo_bajo_minimo": False})},
            }]}}]})
        self.flow(self.path.removeprefix("/flow"), dict(urllib.parse.parse_qsl(cuerpo.decode())))


# ---------------- Cliente ----------------
class SinRedireccion(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


abridor = urllib.request.build_opener(SinRedireccion)


def http(url, token=None, datos=None, metodo="POST", cab=None, form=None):
    h = {"apikey": ANON, "Origin": ORIGEN, **(cab or {})}
    if token:
        h["Authorization"] = f"Bearer {token}"
    cuerpo = None
    if form is not None:
        cuerpo = urllib.parse.urlencode(form).encode()
        h["Content-Type"] = "application/x-www-form-urlencoded"
    elif datos is not None:
        cuerpo = json.dumps(datos).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=cuerpo, headers=h, method=metodo)
    try:
        with abridor.open(req, timeout=30) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def js(b):
    try:
        return json.loads(b)
    except ValueError:
        return {}


def fn(nombre, token, datos):
    s, b, _ = http(f"{BASE}/{nombre}", token, datos)
    return s, js(b)


def login(correo, clave):
    s, b, _ = http(f"{AUTH}/token?grant_type=password", datos={"email": correo, "password": clave})
    return s, js(b).get("access_token")


def correo(n):
    return f"{PREFIJO}{n}{DOMINIO}"


def limpiar():
    usuarios = f"select id from auth.users where email like '{PREFIJO}%{DOMINIO}'"
    empresas = f"select id from public.empresas where nombre like '{EMPRESA}%'"
    sql(f"""begin;
      delete from public.eventos_flow where created_at >= '{inicio}';
      delete from public.cobros_flow where empresa_id in ({empresas});
      delete from public.suscripciones_flow where empresa_id in ({empresas});
      delete from public.uso_ia where empresa_id in ({empresas});
      delete from public.pagos_plan where empresa_id in ({empresas});
      delete from public.admin_auditoria where actor_id in ({usuarios}) or empresa_id in ({empresas});
      delete from public.ubicacion_acceso where empresa_id in ({empresas});
      update public.profiles set es_owner = false, empresa_id = null where id in ({usuarios});
      delete from public.empresas where id in ({empresas});
      delete from auth.users where id in ({usuarios});
      commit;""")


inicio = sql("select now()")
if sql(f"select count(*) from auth.users where email like '{PREFIJO}%'") != "0":
    sys.exit("Quedaron usuarios de una corrida anterior: revisar")
if subprocess.run(["docker", "ps", "-aq", "--filter", f"name=^{NOMBRE}$"], capture_output=True, text=True).stdout.strip():
    sys.exit("Ya existe la instancia de prueba")

servidor = ThreadingHTTPServer(("127.0.0.1", MOCK_P), Mock)
threading.Thread(target=servidor.serve_forever, daemon=True).start()

archivo_env = f"/srv/{P}/.fn-e2e.env"
fd = os.open(archivo_env, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.write("\n".join([
        f"SUPABASE_URL={PUBLICA}", f"SUPABASE_ANON_KEY={ANON}", f"SUPABASE_SERVICE_ROLE_KEY={SERVICE}",
        f"REST_INTERNO=http://127.0.0.1:{REST_P}", f"AUTH_INTERNO=http://127.0.0.1:{AUTH_P}", f"PUERTO={PUERTO}",
        f"APP_URL={ORIGEN}", f"ALLOWED_ORIGIN={ORIGEN}", "FLOW_API_KEY=clave-falsa", f"FLOW_SECRET_KEY={FLOW_SECRET}",
        f"FLOW_API_URL={MOCK}/flow", "OPENAI_API_KEY=clave-falsa", f"SYNC_SECRET={SYNC}", f"MOCK_URL={MOCK}", "DENO_DIR=/deno-dir", "",
    ]))

VARS = "SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,REST_INTERNO,AUTH_INTERNO,PUERTO,APP_URL,APP_URLS_EXTRA,ALLOWED_ORIGIN,FLOW_API_KEY,FLOW_SECRET_KEY,FLOW_API_URL,OPENAI_API_KEY,AI_MODEL,SYNC_SECRET,MOCK_URL"
RED = f"127.0.0.1:{PUERTO},127.0.0.1:{REST_P},127.0.0.1:{AUTH_P},127.0.0.1:{MOCK_P}"
dir_prueba = os.path.dirname(os.path.abspath(__file__))

try:
    subprocess.run([
        "docker", "run", "-d", "--name", NOMBRE, "--network", "host", "--user", "1993", "--env-file", archivo_env,
        "-v", f"/srv/{P}/funciones:/app:ro", "-v", f"/srv/{P}/funciones_cache:/deno-dir:ro",
        "-v", f"{dir_prueba}/main_prueba_funciones.ts:/prueba/main.ts:ro",
        "--memory", "128m", "--memory-swap", "128m", "--read-only", "--tmpfs", "/tmp:size=8m",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--workdir", "/app", "--entrypoint", "deno",
        "denoland/deno:2.3.3", "run", "--cached-only", "--frozen", "--config", "/app/deno.json", "--lock=/app/deno.lock",
        f"--allow-env={VARS}", f"--allow-net={RED}", "--allow-read=/app,/deno-dir,/prueba", "/prueba/main.ts",
    ], check=True, capture_output=True)
    for _ in range(25):
        try:
            if http(f"http://127.0.0.1:{PUERTO}/health", metodo="GET")[0] == 200:
                break
        except OSError:
            time.sleep(1)
    caso("servicio responde /health", http(f"http://127.0.0.1:{PUERTO}/health", metodo="GET")[0] == 200)

    # ---------- Enrutador ----------
    caso("función desconocida da 404", http(f"{BASE}/otra", datos={})[0] == 404)
    caso("ruta con subcamino da 404", http(f"{BASE}/admin-users/x", datos={})[0] == 404)
    for f_ in ("admin-users", "asistente"):
        caso(f"{f_}: sin token 401", fn(f_, None, {"accion": "x", "mensaje": "x"})[0] == 401)
        caso(f"{f_}: token falso 401", fn(f_, "abc.def.ghi", {"accion": "x", "mensaje": "x"})[0] == 401)
        caso(f"{f_}: anon key no es sesión", fn(f_, ANON, {"accion": "x", "mensaje": "x"})[0] == 401)

    # ---------- admin-users ----------
    clave_owner = secrets.token_urlsafe(24)
    s, b, _ = http(f"{AUTH}/admin/users", SERVICE, {"email": correo("owner"), "password": clave_owner, "email_confirm": True}, cab={"apikey": SERVICE})
    owner_id = js(b).get("id")
    caso("crea dueño temporal", s == 200 and owner_id, (s, b[:100]))
    sql(f"update public.profiles set es_owner = true, role = 'admin', puesto = 'admin' where id = '{owner_id}'")
    _, tok_owner = login(correo("owner"), clave_owner)
    caso("login dueño", bool(tok_owner))

    s, e1 = fn("admin-users", tok_owner, {"accion": "crear_empresa", "nombre": EMPRESA + "Uno", "admin_email": correo("a1"), "admin_nombre": "A1", "nivel": "m"})
    caso("dueño crea empresa 1", s == 200 and e1.get("clave_temporal"), (s, e1.get("error")))
    s, e2 = fn("admin-users", tok_owner, {"accion": "crear_empresa", "nombre": EMPRESA + "Dos", "admin_email": correo("a2"), "admin_nombre": "A2", "nivel": "m"})
    caso("dueño crea empresa 2", s == 200 and e2.get("clave_temporal"), (s, e2.get("error")))
    id1, id2 = e1["empresa"]["id"], e2["empresa"]["id"]
    _, tok1 = login(correo("a1"), e1["clave_temporal"])
    _, tok2 = login(correo("a2"), e2["clave_temporal"])
    caso("login con clave temporal", bool(tok1 and tok2))

    caso("admin de empresa no crea empresas", fn("admin-users", tok1, {"accion": "crear_empresa", "nombre": EMPRESA + "X", "admin_email": correo("x")})[0] == 403)
    caso("admin de empresa no nombra dueños", fn("admin-users", tok1, {"accion": "nombrar_owner", "email": correo("x")})[0] == 403)
    caso("admin de empresa no cambia planes", fn("admin-users", tok1, {"accion": "actualizar_plan", "empresa_id": id1, "plan": "dueno"})[0] == 403)

    s, u1 = fn("admin-users", tok1, {"accion": "crear_usuario", "empresa_id": id2, "email": correo("u1"), "nombre": "U1", "puesto": "tienda"})
    caso("crea usuario", s == 200 and u1.get("clave_temporal"), (s, u1.get("error")))
    fila = sql(f"select id, empresa_id from public.profiles where email = '{correo('u1')}'").split("|")
    uid1 = fila[0]
    caso("empresa ajena pedida se ignora: queda en la propia", len(fila) == 2 and fila[1] == id1, fila[1:])

    caso("empresa 2 no resetea clave de empresa 1", fn("admin-users", tok2, {"accion": "reset_password", "user_id": uid1})[0] == 403)
    caso("empresa 2 no desactiva usuario de empresa 1", fn("admin-users", tok2, {"accion": "toggle_usuario", "user_id": uid1, "activo": False})[0] == 403)
    caso("usuario sigue activo", sql(f"select activo from public.profiles where id = '{uid1}'") == "t")

    _, tok_u = login(correo("u1"), u1["clave_temporal"])
    caso("integrante no administra cuentas", fn("admin-users", tok_u, {"accion": "crear_usuario", "email": correo("x")})[0] == 403)

    s, r = fn("admin-users", tok1, {"accion": "reset_password", "user_id": uid1})
    caso("reset de clave", s == 200 and r.get("clave_temporal"), (s, r.get("error")))
    caso("clave anterior deja de servir", login(correo("u1"), u1["clave_temporal"])[0] == 400)
    s_vieja = fn("admin-users", tok_u, {"accion": "crear_usuario", "email": correo("x")})[0]
    caso("reset de clave invalida la sesión anterior", s_vieja == 401, s_vieja)
    s, tok_u = login(correo("u1"), r.get("clave_temporal", ""))
    caso("clave nueva funciona", s == 200 and tok_u, s)

    # ---------- asistente ----------
    # Las empresas nuevas nacen vacías: sin datos, la prueba de aislamiento no probaría nada
    sql(f"""begin;
      select set_config('request.jwt.claims', '{{"role":"service_role"}}', true);
      select public.sembrar_demo('{id1}');
      select public.sembrar_demo('{id2}');
      commit;""")
    marca1, marca2 = f"MARCA{secrets.token_hex(5)}", f"MARCA{secrets.token_hex(5)}"
    sql(f"update public.productos set nombre = nombre || ' {marca1}' where empresa_id = '{id1}'")
    sql(f"update public.productos set nombre = nombre || ' {marca2}' where empresa_id = '{id2}'")
    caso("hay productos marcados en ambas empresas",
         sql(f"select count(distinct empresa_id) from public.productos where nombre like '%MARCA%' and empresa_id in ('{id1}','{id2}')") == "2")
    ub1 = sql(f"select id from public.ubicaciones where empresa_id = '{id1}' limit 1")
    ub2 = sql(f"select id from public.ubicaciones where empresa_id = '{id2}' limit 1")
    caso("hay ubicaciones en ambas empresas", bool(ub1 and ub2))

    Estado.mensajes_ia.clear()
    s, r = fn("asistente", tok1, {"mensaje": "¿cuánto stock tengo?", "ubicacion_id": ub1})
    caso("asistente responde con herramienta", s == 200 and r.get("respuesta") == "respuesta simulada", (s, r.get("error")))
    caso("asistente cuenta el uso", (r.get("uso") or {}).get("usados_usuario") == 1, r.get("uso"))
    texto = "\n".join(Estado.mensajes_ia)
    caso("asistente lee el stock de su empresa", marca1 in texto)
    caso("asistente no lee el stock de otra empresa", marca2 not in texto)
    caso("asistente reconoce su ubicación activa", ub1 in texto)

    Estado.mensajes_ia.clear()
    s, r = fn("asistente", tok1, {"mensaje": "¿y en esa bodega?", "ubicacion_id": ub2})
    texto = "\n".join(Estado.mensajes_ia)
    caso("asistente ignora una ubicación ajena", s == 200 and ub2 not in texto and marca2 not in texto, s)
    caso("asistente rechaza mensaje largo", fn("asistente", tok1, {"mensaje": "x" * 801})[0] == 400)

    # ---------- suscripcion ----------
    url = f"{BASE}/suscripcion"
    caso("suscripción sin sesión 401", fn("suscripcion", None, {"accion": "contratar", "nivel": "m", "periodo": "mensual"})[0] == 401)
    caso("integrante no contrata", fn("suscripcion", tok_u, {"accion": "contratar", "nivel": "m", "periodo": "mensual"})[0] == 403)
    caso("plan inválido rechazado", fn("suscripcion", tok1, {"accion": "contratar", "nivel": "zz", "periodo": "mensual"})[0] == 400)
    s, r = fn("suscripcion", tok1, {"accion": "contratar", "nivel": "m", "periodo": "mensual", "empresa_id": id2})
    caso("contratar devuelve URL de Flow", s == 200 and "token=" in r.get("url", ""), (s, r.get("error")))
    token = r.get("url", "").split("token=")[-1]
    fila = sql(f"select empresa_id, estado from public.suscripciones_flow where empresa_id in ('{id1}','{id2}')")
    caso("contrato queda en la empresa propia", fila == f"{id1}|pendiente_tarjeta", fila)
    caso("callback usa la URL pública", all((p.get("urlCallback") or "").startswith(f"{PUBLICA}/functions/v1/suscripcion") for p in Estado.planes.values()) and Estado.tokens[token]["url_return"].startswith(PUBLICA))

    s, _, h = http(f"{url}?accion=retorno", form={"token": "inventado"})
    caso("retorno con token falso no activa", s == 303 and "suscripcion=error" in h.get("Location", ""), (s, h.get("Location")))
    Estado.tokens[token]["status"] = 0
    s, _, h = http(f"{url}?accion=retorno", form={"token": token})
    caso("tarjeta no registrada no activa", s == 303 and "rechazada" in h.get("Location", "") and Estado.creadas == 0, (s, h.get("Location")))
    Estado.tokens[token]["status"] = 1
    s, _, h = http(f"{url}?accion=retorno", form={"token": token})
    caso("retorno válido activa", s == 303 and "suscripcion=ok" in h.get("Location", ""), (s, h.get("Location")))
    caso("suscripción activa", sql(f"select estado from public.suscripciones_flow where empresa_id = '{id1}'") == "activa")
    caso("cobro registrado", sql(f"select count(*) from public.cobros_flow where empresa_id = '{id1}'") == "1")
    http(f"{url}?accion=retorno", form={"token": token})
    caso("retorno repetido no crea otra suscripción", Estado.creadas == 1, Estado.creadas)

    s, _, _ = http(f"{url}?accion=cobro", form={"subscriptionId": "sus_falsa", "status": "1", "amount": "1"})
    caso("aviso falsificado no agrega cobros", s == 200 and sql(f"select count(*) from public.cobros_flow where empresa_id = '{id1}'") == "1", s)
    caso("sincronizar sin secreto 401", http(f"{url}?accion=sincronizar", datos={})[0] == 401)
    caso("sincronizar con secreto malo 401", http(f"{url}?accion=sincronizar", datos={}, cab={"x-sync-secret": "x" * len(SYNC)})[0] == 401)
    caso("admin de empresa no sincroniza", http(f"{url}?accion=sincronizar", tok1, {})[0] == 401)
    s, b, _ = http(f"{url}?accion=sincronizar", datos={}, cab={"x-sync-secret": SYNC})
    caso("sincronizar con secreto", s == 200 and js(b).get("errores") == 0, (s, b[:100]))
    caso("sincronizar no duplica cobros", sql(f"select count(*) from public.cobros_flow where empresa_id = '{id1}'") == "1")

    caso("otra empresa no cancela la suscripción", fn("suscripcion", tok2, {"accion": "cancelar", "empresa_id": id1})[0] == 400 and all(x["cancel"] == 0 for x in Estado.subs.values()))
    s, r = fn("suscripcion", tok1, {"accion": "cancelar"})
    caso("cancelar al fin del período", s == 200 and all(x["cancel"] == 1 for x in Estado.subs.values()), (s, r.get("error")))
    caso("todas las firmas a Flow son válidas", Estado.firmas_malas == 0, Estado.firmas_malas)

    # ---------- Cuenta desactivada ----------
    s, _ = fn("admin-users", tok1, {"accion": "toggle_usuario", "user_id": uid1, "activo": False})
    caso("desactiva usuario", s == 200, s)
    caso("cuenta inactiva no opera", fn("admin-users", tok_u, {"accion": "crear_usuario", "email": correo("x")})[0] == 403)
except Exception as e:  # noqa: BLE001
    caso("ejecución", False, f"{type(e).__name__}: {str(e)[:120]}")
    log = subprocess.run(["docker", "logs", "--tail", "6", NOMBRE], capture_output=True, text=True)
    print((log.stdout + log.stderr)[-700:])
finally:
    subprocess.run(["docker", "rm", "-f", NOMBRE], capture_output=True)
    servidor.shutdown()
    if os.path.exists(archivo_env):
        os.remove(archivo_env)
    try:
        limpiar()
    except subprocess.CalledProcessError as e:
        caso("limpieza SQL", False, (e.stderr or "")[:200])
    caso("limpieza: sin usuarios temporales", sql(f"select count(*) from auth.users where email like '{PREFIJO}%'") == "0")
    caso("limpieza: sin empresas temporales", sql(f"select count(*) from public.empresas where nombre like '{EMPRESA}%'") == "0")
    caso("limpieza: quedan los 3 ficticios", sql("select count(*) from auth.users") == "3")

print(f"\nFallos: {fallos}")
sys.exit(1 if fallos else 0)
