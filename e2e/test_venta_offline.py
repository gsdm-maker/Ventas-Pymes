"""
Venta sin conexión de punta a punta (OPCIONAL: escribe en la base de producción).
Activar con E2E_ESCRITURA=1. La venta se registra en la empresa de prueba y al final se ANULA
(devuelve el stock), con el motivo «Prueba automática E2E».
"""
import json
import os
import urllib.request

import pytest
from playwright.sync_api import expect

from conftest import entorno_supabase, token_de
from test_pos import abrir_pos, agregar_primer_producto, boton_cobrar

pytestmark = pytest.mark.skipif(
    os.environ.get('E2E_ESCRITURA') != '1', reason='Escribe en producción: activar con E2E_ESCRITURA=1'
)


def _api(metodo: str, ruta: str, token: str, cuerpo=None):
    url, anon = entorno_supabase()
    req = urllib.request.Request(
        f'{url}{ruta}',
        method=metodo,
        data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
        headers={'apikey': anon, 'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        texto = r.read().decode()
        return json.loads(texto) if texto else None


def test_venta_sin_conexion_se_sincroniza_y_se_anula(pagina_admin):
    page = pagina_admin
    abrir_pos(page)
    token = token_de(page)
    yo = _api('GET', '/auth/v1/user', token)['id']

    # 1) Se corta internet y se vende en efectivo exacto
    page.context.set_offline(True)
    expect(page.get_by_text('Sin conexión').first).to_be_visible()
    precio = agregar_primer_producto(page)
    monto = int(precio.replace('$', '').replace('.', ''))
    boton_cobrar(page).click()
    expect(page.get_by_text('Venta guardada sin conexión')).to_be_visible()
    # El comprobante se imprime solo (impresión al cobrar encendida por defecto)
    expect(page.frame_locator('iframe[aria-hidden="true"]').locator('body')).to_contain_text('Venta sin conexión')

    # 2) Vuelve internet: la cola se sube sola
    page.context.set_offline(False)
    expect(page.get_by_text('En línea').first).to_be_visible(timeout=30_000)

    # 3) La venta quedó en la base (la más reciente de este usuario, por ese monto)
    ventas = _api(
        'GET',
        f'/rest/v1/ventas?select=id,folio,total,estado,uuid_local&usuario_id=eq.{yo}&order=created_at.desc&limit=1',
        token,
    )
    assert ventas and ventas[0]['total'] == monto and ventas[0]['uuid_local'], ventas
    venta = ventas[0]

    # 4) Limpieza: se anula (devuelve el stock) para no ensuciar reportes
    _api('POST', '/rest/v1/rpc/devolver_venta', token,
         {'p_venta': venta['id'], 'p_items': None, 'p_motivo': 'Prueba automática E2E'})
    estado = _api('GET', f"/rest/v1/ventas?select=estado&id=eq.{venta['id']}", token)[0]['estado']
    assert estado == 'anulada', f"La venta {venta['folio']} quedó en estado {estado}: anúlala a mano"
