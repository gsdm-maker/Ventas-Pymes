"""Punto de venta: armar un ticket y validar el cobro, sin registrar ventas."""
import re

import pytest
from playwright.sync_api import Page, expect

from conftest import URL

PRECIO = re.compile(r'\$[\d.]+')


def abrir_pos(page: Page) -> None:
    page.goto(f'{URL}/pos')
    expect(page.get_by_role('heading', name='Punto de Venta')).to_be_visible()
    expect(page.get_by_placeholder('Buscar producto…')).to_be_visible()
    # El catálogo se carga después de la pantalla: esperar el primer producto
    page.locator('main button').filter(has_text=PRECIO).first.wait_for()


def agregar_primer_producto(page: Page) -> str:
    """Agrega el primer producto vendible sin tallas; devuelve su precio («$9.990»)."""
    fila = (
        page.locator('main button')
        .filter(has_text=PRECIO)
        .filter(has_not_text='Agotado')
        .filter(has_not_text='tallas')
        .filter(has_not_text='ítem')
        .first
    )
    if fila.count() == 0:
        pytest.skip('No hay productos sin tallas con stock en la ubicación activa')
    precio = PRECIO.search(fila.inner_text()).group(0)
    fila.click()
    return precio


def total(page: Page) -> str:
    return PRECIO.search(page.get_by_text('Total a cobrar').locator('..').inner_text()).group(0)


def boton_cobrar(page: Page):
    return page.get_by_role('button', name=re.compile(r'^Cobrar'))


def test_agregar_producto_suma_al_ticket(pagina_admin):
    abrir_pos(pagina_admin)
    expect(boton_cobrar(pagina_admin)).to_be_disabled()
    precio = agregar_primer_producto(pagina_admin)
    expect(pagina_admin.get_by_text('1 ítem(s)').first).to_be_visible()
    assert total(pagina_admin) == precio
    expect(boton_cobrar(pagina_admin)).to_be_enabled()


def test_debito_exige_numero_de_voucher(pagina_admin):
    abrir_pos(pagina_admin)
    agregar_primer_producto(pagina_admin)
    pagina_admin.get_by_role('button', name='Débito / crédito').click()
    referencia = pagina_admin.get_by_placeholder('Número de voucher de venta')
    expect(referencia).to_be_visible()
    expect(boton_cobrar(pagina_admin)).to_be_disabled()
    referencia.fill('123456')
    expect(boton_cobrar(pagina_admin)).to_be_enabled()
    # Volver a efectivo oculta la referencia
    pagina_admin.get_by_role('button', name='Efectivo').click()
    expect(referencia).to_have_count(0)


def test_efectivo_insuficiente_no_deja_cobrar(pagina_admin):
    abrir_pos(pagina_admin)
    precio = agregar_primer_producto(pagina_admin)
    monto = int(precio.replace('$', '').replace('.', ''))
    paga_con = pagina_admin.get_by_label('Monto recibido en efectivo')
    paga_con.fill(str(monto - 1))
    expect(boton_cobrar(pagina_admin)).to_be_disabled()
    expect(pagina_admin.get_by_text('Faltan')).to_be_visible()
    paga_con.fill(str(monto + 1000))
    expect(boton_cobrar(pagina_admin)).to_be_enabled()
    expect(pagina_admin.get_by_text('Vuelto')).to_be_visible()


def test_descuento_baja_el_total(pagina_admin):
    abrir_pos(pagina_admin)
    precio = agregar_primer_producto(pagina_admin)
    # El descuento va plegado para dejar más alto al detalle del ticket
    expect(pagina_admin.locator('#pos-descuento')).to_have_count(0)
    pagina_admin.get_by_role('button', name='Descuento', exact=True).click()
    pagina_admin.locator('#pos-descuento').fill('10')
    nuevo = total(pagina_admin)
    assert int(nuevo.replace('$', '').replace('.', '')) < int(precio.replace('$', '').replace('.', ''))


def test_sin_conexion_el_pos_sigue_vendiendo(pagina_admin):
    abrir_pos(pagina_admin)
    pagina_admin.context.set_offline(True)
    expect(pagina_admin.get_by_text('Sin conexión').first).to_be_visible()
    # El catálogo sigue disponible y se puede armar el ticket
    precio = agregar_primer_producto(pagina_admin)
    assert total(pagina_admin) == precio
    expect(boton_cobrar(pagina_admin)).to_be_enabled()
    pagina_admin.context.set_offline(False)
    expect(pagina_admin.get_by_text('En línea').first).to_be_visible(timeout=20_000)


def test_pos_no_muestra_botones_de_impresion(pagina_admin):
    abrir_pos(pagina_admin)
    expect(pagina_admin.get_by_role('button', name=re.compile(r'impresi|imprimir', re.I))).to_have_count(0)


def test_impresion_se_configura_por_equipo(pagina_admin):
    pagina_admin.goto(f'{URL}/configuracion')
    expect(pagina_admin.get_by_text('Impresión en este equipo')).to_be_visible()
    # Encendida por defecto
    expect(pagina_admin.get_by_label('Imprimir al cobrar')).to_be_checked()
    pagina_admin.get_by_role('button', name='58 mm').click()
    expect(pagina_admin.get_by_role('button', name='58 mm')).to_have_attribute('aria-pressed', 'true')
    pagina_admin.get_by_role('button', name='Imprimir ticket de prueba').click()
    # Se imprime desde un iframe oculto (sin ventanas emergentes) con el ancho elegido
    marco = pagina_admin.frame_locator('iframe[aria-hidden="true"]')
    expect(marco.locator('body')).to_contain_text('Venta PRUEBA')
    expect(marco.locator('body')).to_contain_text('no válido como boleta')
    estilos = pagina_admin.locator('iframe[aria-hidden="true"]').evaluate('f => f.contentDocument.querySelector("style").textContent')
    assert 'size:58mm' in estilos
    guardada = pagina_admin.evaluate("() => localStorage.getItem('misociopyme:impresion')")
    assert '"ancho":58' in guardada and '"alCobrar":true' in guardada
