"""
Pruebas de punta a punta (navegador real con Playwright) de Mi Socio Pyme.

Uso:
    npm run dev                 # en otra terminal: la app en http://localhost:5173
    npm run test:e2e            # = python -m pytest e2e

IMPORTANTE: la app local usa la base de PRODUCCIÓN (no hay base local). Por eso, por defecto
las pruebas solo navegan y leen. Las que escriben datos son opcionales:
    E2E_ESCRITURA=1   venta sin conexión + sincronización (la venta se anula al terminar)
    E2E_IA=1          envía una pregunta real a Socio IA (gasta 1 mensaje del plan)
Otras variables:
    E2E_URL           otra dirección de la app (por defecto http://localhost:5173)
    E2E_VER=1         abre el navegador visible (para mirar la prueba)
Credenciales: E2E_ADMIN_EMAIL/E2E_ADMIN_CLAVE y E2E_TIENDA_EMAIL/E2E_TIENDA_CLAVE, o las líneas
«Prueba admin: …» / «Prueba tienda: …» de Datakeys.md (con su «Pass:» en la línea siguiente
al correo). Si una cuenta no está o su clave no funciona, sus pruebas se saltan.
"""
import json
import os
import re
import urllib.request
from pathlib import Path

import pytest
from playwright.sync_api import Browser, Page, sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
URL = os.environ.get('E2E_URL', 'http://localhost:5173').rstrip('/')


# ---------------- Credenciales ----------------
def _credenciales(rol: str) -> tuple[str, str] | None:
    email = os.environ.get(f'E2E_{rol.upper()}_EMAIL')
    clave = os.environ.get(f'E2E_{rol.upper()}_CLAVE')
    if email and clave:
        return email, clave
    datakeys = RAIZ / 'Datakeys.md'
    if not datakeys.exists():
        return None
    lineas = datakeys.read_text(encoding='utf8').splitlines()
    m = next((re.search(rf'Prueba {rol}:\s*(\S+@\S+)', l, re.I) for l in lineas if re.search(rf'Prueba {rol}:', l, re.I)), None)
    if not m:
        return None
    email = m.group(1)
    for i, l in enumerate(lineas[:-1]):
        if email.lower() in l.lower() and not l.lower().startswith('prueba'):
            pw = re.search(r'Pass:\s*(.+)', lineas[i + 1])
            if pw:
                return email.lower(), pw.group(1).strip()
    return None


def entorno_supabase() -> tuple[str, str]:
    """URL y anon key de la app (para limpiar lo que crean las pruebas opcionales)."""
    valores = {}
    for l in (RAIZ / '.env.local').read_text(encoding='utf8').splitlines():
        if '=' in l and not l.strip().startswith('#'):
            k, v = l.split('=', 1)
            valores[k.strip()] = v.strip()
    return valores['VITE_SUPABASE_URL'], valores['VITE_SUPABASE_ANON_KEY']


# ---------------- Navegador ----------------
@pytest.fixture(scope='session')
def servidor() -> str:
    try:
        urllib.request.urlopen(URL, timeout=5)
    except Exception:
        pytest.exit(f'La app no responde en {URL}. Levántala con «npm run dev» y vuelve a correr.', returncode=2)
    return URL


@pytest.fixture(scope='session')
def navegador(servidor) -> Browser:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=os.environ.get('E2E_VER') != '1')
        yield b
        b.close()


def iniciar_sesion(page: Page, email: str, clave: str) -> None:
    page.goto(f'{URL}/login')
    page.get_by_label('Correo electrónico').fill(email)
    page.get_by_label('Contraseña').fill(clave)
    page.get_by_role('button', name='Ingresar').click()
    page.wait_for_url(lambda u: '/login' not in u, timeout=20_000)
    if '/cambiar-clave' in page.url:
        pytest.fail(f'La cuenta {email} debe cambiar su clave antes de usarse en pruebas')
    page.wait_for_load_state('networkidle')


def _estado_sesion(navegador: Browser, tmp_path_factory, rol: str):
    cred = _credenciales(rol)
    if not cred:
        return None
    ctx = navegador.new_context()
    page = ctx.new_page()
    try:
        iniciar_sesion(page, *cred)
    except Exception:
        ctx.close()
        return None
    ruta = tmp_path_factory.mktemp(rol) / 'estado.json'
    ctx.storage_state(path=str(ruta))
    ctx.close()
    return str(ruta)


@pytest.fixture(scope='session')
def estado_admin(navegador, tmp_path_factory):
    estado = _estado_sesion(navegador, tmp_path_factory, 'admin')
    if not estado:
        pytest.skip('Sin credenciales válidas de «Prueba admin»')
    return estado


@pytest.fixture(scope='session')
def estado_tienda(navegador, tmp_path_factory):
    estado = _estado_sesion(navegador, tmp_path_factory, 'tienda')
    if not estado:
        pytest.skip('Sin credenciales válidas de «Prueba tienda» (actualiza su clave en Datakeys.md)')
    return estado


def _pagina(navegador, estado):
    ctx = navegador.new_context(storage_state=estado, viewport={'width': 1366, 'height': 850}, locale='es-CL')
    page = ctx.new_page()
    page.set_default_timeout(15_000)
    yield page
    ctx.close()


@pytest.fixture
def pagina(navegador, servidor):
    """Página sin sesión."""
    yield from _pagina(navegador, None)


@pytest.fixture
def pagina_admin(navegador, estado_admin):
    yield from _pagina(navegador, estado_admin)


@pytest.fixture
def pagina_tienda(navegador, estado_tienda):
    yield from _pagina(navegador, estado_tienda)


def token_de(page: Page) -> str:
    """Token de la sesión del navegador (para llamar a la API como ese usuario)."""
    crudo = page.evaluate(
        "() => { const k = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k)); return k ? localStorage.getItem(k) : null }"
    )
    return json.loads(crudo)['access_token']
