import { supabase } from '@/core/supabase/client'
import type { Comanda, EstadoComanda, MedioPago, Mesa, Venta } from '@/core/types'
import { resultado, soloError, type Resultado } from '@/core/data/resultado'

/** Envía un pedido: a cocina va lo que se prepara; devuelve la comanda o null si no hubo. */
export async function enviarPedido(
  mesaId: string,
  items: { producto_id: string; variante_id: string | null; cantidad: number; nota: string | null }[],
  comensales: number | null
): Promise<Resultado<Comanda>> {
  return resultado<Comanda>(
    await supabase.rpc('enviar_comanda', { p_mesa: mesaId, p_items: items, p_comensales: comensales })
  )
}

export async function anularItemCuenta(itemId: string, motivo: string | null): Promise<string | null> {
  return soloError(await supabase.rpc('anular_item_cuenta', { p_item: itemId, p_motivo: motivo }))
}

/** La base solo acepta avanzar o retroceder de a un paso (0024). */
export async function cambiarEstadoComanda(comandaId: string, estado: EstadoComanda): Promise<string | null> {
  return soloError(await supabase.rpc('cambiar_estado_comanda', { p_comanda: comandaId, p_estado: estado }))
}

export async function moverCuenta(cuentaId: string, mesaId: string): Promise<string | null> {
  return soloError(await supabase.rpc('mover_cuenta', { p_cuenta: cuentaId, p_mesa: mesaId }))
}

export async function anularCuenta(cuentaId: string, motivo: string | null): Promise<string | null> {
  return soloError(await supabase.rpc('anular_cuenta', { p_cuenta: cuentaId, p_motivo: motivo }))
}

export async function cobrarCuenta(
  cuentaId: string,
  medio: MedioPago,
  referencia: string | null,
  propina: number
): Promise<Resultado<Venta>> {
  return resultado<Venta>(
    await supabase.rpc('cobrar_cuenta', { p_cuenta: cuentaId, p_medio_pago: medio, p_referencia: referencia, p_propina: propina })
  )
}

// ---------------- Configurar el salón ----------------
export async function crearMesas(filas: Pick<Mesa, 'empresa_id' | 'ubicacion_id' | 'nombre' | 'zona' | 'orden'>[]): Promise<string | null> {
  return soloError(await supabase.from('mesas').insert(filas))
}

export async function actualizarMesa(id: string, cambios: Partial<Mesa>): Promise<Resultado> {
  return resultado(await supabase.from('mesas').update(cambios).eq('id', id))
}

/** Las mesas no se borran: se desactivan (conservan su historial). */
export async function quitarMesa(id: string): Promise<string | null> {
  return soloError(await supabase.from('mesas').update({ activa: false }).eq('id', id))
}
