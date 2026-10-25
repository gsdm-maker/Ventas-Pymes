"""Ingreso, rutas protegidas y lo que ve cada puesto en el menú."""
import re

from playwright.sync_api import expect

from conftest import URL

MENU_ADMIN = ['Dashboard', 'Punto de Venta', 'Inventario', 'Reportes', 'Usuarios y permisos', 'Configuración']
SOLO_ADMIN = ['Reportes', 'Usuarios y permisos', 'Configuración']


def test_sin_sesion_redirige_al_login(pagina):
    pagina.goto(f'{URL}/pos')
    expect(pagina).to_have_url(re.compile(r'/login$'))
    expect(pagina.get_by_role('button', name='Ingresar')).to_be_visible()


def test_clave_incorrecta_muestra_error(pagina):
    pagina.goto(f'{URL}/login')
    pagina.get_by_label('Correo electrónico').fill('nadie@ejemplo.cl')
    pagina.get_by_label('Contraseña').fill('clave-equivocada-123')
    pagina.get_by_role('button', name='Ingresar').click()
    expect(pagina.get_by_text('Correo o contraseña incorrectos')).to_be_visible()
    expect(pagina).to_have_url(re.compile(r'/login$'))


def test_admin_entra_al_dashboard_con_su_menu(pagina_admin):
    pagina_admin.goto(URL)
    expect(pagina_admin.get_by_role('heading', name='Dashboard', level=1)).to_be_visible()
    menu = pagina_admin.locator('aside')
    for item in MENU_ADMIN:
        expect(menu.get_by_role('link', name=item, exact=True)).to_be_visible()


def test_tienda_no_ve_ni_entra_a_modulos_de_administracion(pagina_tienda):
    pagina_tienda.goto(URL)
    menu = pagina_tienda.locator('aside')
    expect(menu.get_by_role('link', name='Punto de Venta', exact=True)).to_be_visible()
    for item in SOLO_ADMIN:
        expect(menu.get_by_role('link', name=item, exact=True)).to_have_count(0)
    # Entrar por la dirección tampoco sirve: vuelve al inicio
    pagina_tienda.goto(f'{URL}/reportes')
    expect(pagina_tienda).to_have_url(re.compile(r'/$'))
