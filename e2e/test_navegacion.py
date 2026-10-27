"""
Recorrido de todas las pantallas: cada una carga su título y sus datos sin errores en la página.
Protege los cambios de la capa de datos (src/core/data) y del orden del código.
"""
import json
import urllib.request

import pytest
from playwright.sync_api import Page, expect

from conftest import URL, entorno_supabase, token_de

PANTALLAS_ADMIN = {
    '/': 'Dashboard',
    '/pos': 'Punto de Venta',
    '/salidas': 'Salidas y vouchers',
    '/ingreso': 'Ingreso de mercadería',
    '/inventario': 'Inventario',
    '/reposicion': 'Reposición',
    '/productos': 'Productos',
    '/bodega': 'Bodega y transferencias',
    '/movimientos': 'Movimientos',
    '/reportes': 'Ventas por tienda',
    '/usuarios': 'Usuarios y permisos',
    '/configuracion': 'Configuración',
    '/ayuda': 'Ayuda',
}

PANTALLAS_OWNER = {
    '/admin': 'Consola general',
    '/admin/empresas': 'Empresas',
    '/admin/asistente': 'Asistente con IA',
    '/admin/owners': 'Administradores generales',
    '/admin/actividad': 'Actividad',
}


def vigilar_errores(page: Page) -> list[str]:
    """Errores de JavaScript y de consola mientras se usa la página."""
    errores: list[str] = []
    page.on('pageerror', lambda e: errores.append(f'pageerror: {e}'))
    page.on('console', lambda m: errores.append(f'console: {m.text}') if m.type == 'error' else None)
    return errores


def abrir(page: Page, ruta: str, titulo: str) -> None:
    page.goto(f'{URL}{ruta}')
    page.get_by_role('heading', level=1).first.wait_for(timeout=20_000)
    if page.get_by_role('heading', level=1, name='Cuenta sin empresa asignada').count():
        pytest.skip('La cuenta «Admin general» de Datakeys.md ya no es administrador general: actualízala')
    expect(page.get_by_role('heading', level=1).filter(has_text=titulo).first).to_be_visible(timeout=20_000)
    page.wait_for_load_state('networkidle')


@pytest.mark.parametrize('ruta,titulo', PANTALLAS_ADMIN.items(), ids=list(PANTALLAS_ADMIN))
def test_pantalla_de_empresa_carga_sin_errores(pagina_admin, ruta, titulo):
    errores = vigilar_errores(pagina_admin)
    abrir(pagina_admin, ruta, titulo)
    assert not errores, errores


def test_voucher_de_venta_muestra_su_detalle(pagina_admin):
    errores = vigilar_errores(pagina_admin)
    abrir(pagina_admin, '/salidas', 'Salidas y vouchers')
    enlace = pagina_admin.locator('a[href^="/voucher/"]').first
    if enlace.count() == 0:
        pytest.skip('No hay comprobantes para abrir')
    enlace.click()
    expect(pagina_admin.get_by_text('Comprobante interno').first).to_be_visible()
    expect(pagina_admin.get_by_role('button', name='Imprimir')).to_be_visible()
    assert not errores, errores


def test_ficha_de_producto_muestra_stock_y_movimientos(pagina_admin):
    errores = vigilar_errores(pagina_admin)
    abrir(pagina_admin, '/', 'Dashboard')
    url, anon = entorno_supabase()
    req = urllib.request.Request(
        f'{url}/rest/v1/productos?select=id,nombre&activo=eq.true&controla_stock=eq.true&limit=1',
        headers={'apikey': anon, 'Authorization': f'Bearer {token_de(pagina_admin)}'},
    )
    productos = json.loads(urllib.request.urlopen(req, timeout=20).read())
    if not productos:
        pytest.skip('La empresa no tiene productos')
    pagina_admin.goto(f"{URL}/inventario/{productos[0]['id']}")
    expect(pagina_admin.get_by_role('heading', level=1, name=productos[0]['nombre'])).to_be_visible(timeout=20_000)
    assert not errores, errores


def test_ficha_de_producto_se_abre_para_editar(pagina_admin):
    errores = vigilar_errores(pagina_admin)
    abrir(pagina_admin, '/productos', 'Productos')
    pagina_admin.locator('[aria-label^="Editar "]').first.click()
    expect(pagina_admin.get_by_role('dialog')).to_be_visible()
    expect(pagina_admin.get_by_role('dialog').get_by_label('Nombre')).not_to_have_value('')
    assert not errores, errores


@pytest.mark.parametrize('ruta,titulo', PANTALLAS_OWNER.items(), ids=list(PANTALLAS_OWNER))
def test_consola_general_carga_sin_errores(pagina_owner, ruta, titulo):
    errores = vigilar_errores(pagina_owner)
    abrir(pagina_owner, ruta, titulo)
    assert not errores, errores


def test_ficha_de_empresa_en_la_consola(pagina_owner):
    errores = vigilar_errores(pagina_owner)
    abrir(pagina_owner, '/admin/empresas', 'Empresas')
    pagina_owner.locator('a[href^="/admin/empresas/"]').first.click()
    expect(pagina_owner.get_by_text('Asistente con IA')).to_be_visible(timeout=20_000)
    expect(pagina_owner.get_by_text('Rubro y módulos')).to_be_visible()
    expect(pagina_owner.get_by_text('Plan y suscripción')).to_be_visible()
    expect(pagina_owner.get_by_text('Historial de pagos')).to_be_visible()
    assert not errores, errores
