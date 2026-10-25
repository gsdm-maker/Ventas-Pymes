"""Socio IA (botón flotante del Dashboard) y la página de Ayuda."""
import os

import pytest
from playwright.sync_api import expect

from conftest import URL


def test_socio_ia_abre_con_plan_y_sugerencias(pagina_admin):
    pagina_admin.goto(URL)
    expect(pagina_admin.get_by_role('heading', name='Dashboard', level=1)).to_be_visible()
    boton = pagina_admin.get_by_role('button', name='Abrir el asistente Socio IA')
    try:
        boton.wait_for(timeout=10_000)
    except Exception:
        pytest.skip('La empresa de prueba no tiene plan de asistente o el usuario no tiene el permiso')
    boton.click()
    panel = pagina_admin.get_by_role('dialog')
    expect(panel.get_by_text('Socio IA')).to_be_visible()
    expect(panel.get_by_text('Plan ', exact=False).first).to_be_visible()
    expect(panel.get_by_role('button', name='¿Qué debo tener en stock para este fin de semana?')).to_be_visible()
    expect(panel.get_by_label('Pregunta para el asistente')).to_be_enabled()
    pagina_admin.keyboard.press('Escape')
    expect(boton).to_be_visible()


@pytest.mark.skipif(os.environ.get('E2E_IA') != '1', reason='Gasta 1 mensaje del plan: activar con E2E_IA=1')
def test_socio_ia_responde_una_pregunta(pagina_admin):
    pagina_admin.goto(URL)
    pagina_admin.get_by_role('button', name='Abrir el asistente Socio IA').click()
    panel = pagina_admin.get_by_role('dialog')
    pregunta = panel.get_by_label('Pregunta para el asistente')
    pregunta.fill('¿Qué productos están bajo el mínimo? Responde en 3 líneas.')
    pregunta.press('Enter')
    expect(panel.get_by_text('Revisando tus datos…')).to_be_visible()
    expect(panel.get_by_text('Revisando tus datos…')).to_have_count(0, timeout=60_000)
    # Pregunta del usuario + respuesta del asistente (no un aviso de error)
    respuesta = panel.locator('.rounded-bl-md').last
    expect(respuesta).not_to_have_class('bg-warning-soft')
    assert len(respuesta.inner_text().strip()) > 20
    panel.get_by_role('button', name='Nueva conversación').click()
    expect(panel.get_by_text('Hola, ¿en qué te ayudo?')).to_be_visible()


def test_ayuda_busca_sin_importar_tildes(pagina_admin):
    pagina_admin.goto(f'{URL}/ayuda')
    buscador = pagina_admin.get_by_placeholder('¿Qué necesitas hacer?', exact=False)
    buscador.fill('devolucion')
    expect(pagina_admin.get_by_text('Salidas, vouchers y devoluciones').first).to_be_visible()
    buscador.fill('zzqqxx')
    expect(pagina_admin.get_by_text('Sin resultados')).to_be_visible()
