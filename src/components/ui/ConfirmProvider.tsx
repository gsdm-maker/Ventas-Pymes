import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ConfirmCtx, type OpcionesConfirmacion } from '@/components/ui/confirm'

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opciones, setOpciones] = useState<OpcionesConfirmacion | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const confirmar = useCallback((o: OpcionesConfirmacion) => {
    setOpciones(o)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const cerrar = useCallback((ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setOpciones(null)
  }, [])

  return (
    <ConfirmCtx.Provider value={confirmar}>
      {children}
      <Modal
        open={!!opciones}
        onClose={() => cerrar(false)}
        title={opciones?.titulo}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => cerrar(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => cerrar(true)} autoFocus>
              {opciones?.accion ?? 'Confirmar'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-body">{opciones?.mensaje ?? '¿Confirmas esta acción?'}</p>
      </Modal>
    </ConfirmCtx.Provider>
  )
}
