import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  ChefHat,
  ChevronDown,
  CloudOff,
  HelpCircle,
  LayoutDashboard,
  PackageMinus,
  PackagePlus,
  Rocket,
  Search,
  Settings,
  Sparkles,
  ShoppingCart,
  Tags,
  Users,
  UtensilsCrossed,
  Warehouse
} from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import type { Capability } from '@/core/auth/capabilities'
import { Input } from '@/components/ui/Input'
import { EmptyState, PageHeader } from '@/components/ui/Feedback'

interface Seccion {
  titulo: string
  pasos: string[]
  nota?: string
  /** Solo para quien tiene esta capacidad (además de la del tema) */
  cap?: Capability
}

interface Tema {
  id: string
  titulo: string
  icono: ReactNode
  resumen: string
  /** Módulo o capacidad necesaria para ver el tema; sin cap lo ve todo usuario */
  cap?: Capability
  ruta?: string
  secciones: Seccion[]
}

// Guía de uso. Cada usuario ve solo los temas de los módulos y acciones que tiene habilitados.
const TEMAS: Tema[] = [
  {
    id: 'inicio',
    titulo: 'Primeros pasos',
    icono: <Rocket size={18} />,
    resumen: 'Ingreso, clave, ubicación de trabajo y cómo se ordena la pantalla.',
    secciones: [
      {
        titulo: 'Ingresar por primera vez',
        pasos: [
          'Entra con el correo y la clave temporal que te entregó el administrador de tu empresa.',
          'El sistema te pedirá crear una clave propia de al menos 8 caracteres. Hasta hacerlo no podrás usar los módulos.',
          'Si olvidas tu clave, usa «Olvidé mi contraseña» en la pantalla de ingreso o pide al administrador que te genere una nueva.'
        ]
      },
      {
        titulo: 'Elegir dónde estás trabajando',
        pasos: [
          'En la barra superior está el selector de ubicación (tienda o bodega).',
          'Ventas, salidas, inventario y alertas usan la ubicación elegida ahí.',
          'Solo verás las ubicaciones que el administrador te asignó.'
        ]
      },
      {
        titulo: 'Moverse por el sistema',
        pasos: [
          'En computador, los módulos están en la barra lateral izquierda y el título de cada pantalla en la barra superior.',
          'En el celular, la barra inferior tiene accesos directos; el botón «Más» abre todos los módulos, el cambio de tema y «Salir».',
          'La campana de la barra superior muestra los productos quebrados o por quebrar.',
          'El botón de la luna cambia entre tema claro y oscuro; el del salvavidas, a su lado, abre esta guía.'
        ]
      },
      {
        titulo: 'Versiones nuevas',
        pasos: [
          'Cuando se publica una mejora aparece abajo el aviso «Hay una versión nueva · Actualizar».',
          'Pulsa «Actualizar» cuando no estés a mitad de una venta. Si prefieres seguir, ciérralo con la «×» y actualiza después.'
        ]
      }
    ]
  },
  {
    id: 'dashboard',
    titulo: 'Dashboard',
    icono: <LayoutDashboard size={18} />,
    resumen: 'El resumen del día: quiebres, reposición, transferencias y stock.',
    cap: 'modulos.dashboard',
    ruta: '/',
    secciones: [
      {
        titulo: 'Qué muestra',
        pasos: [
          'Las tarjetas superiores cuentan productos quebrados, por quebrar, unidades a reponer y transferencias pendientes. Al pulsarlas te llevan al detalle.',
          '«Reponer primero» lista lo más urgente; «Alertas por tienda» muestra qué local necesita más atención.',
          'Los gráficos muestran las entradas y salidas de los últimos 14 días y el stock por ubicación.'
        ],
        nota: 'Si aparece «venta(s) sin conexión registradas sin stock suficiente», revisa el inventario: se vendió algo que el sistema no tenía registrado.'
      }
    ]
  },
  {
    id: 'pos',
    titulo: 'Punto de Venta',
    icono: <ShoppingCart size={18} />,
    resumen: 'Vender rápido: buscar, armar el ticket, cobrar y dar vuelto.',
    cap: 'modulos.pos',
    ruta: '/pos',
    secciones: [
      {
        titulo: 'Hacer una venta',
        pasos: [
          'Busca el producto por nombre o código (también sirve el lector de código de barras) y pulsa sobre él para agregarlo al ticket.',
          'Con «Enter» se agrega el primer resultado. Escribe «3*» antes del nombre para agregar 3 unidades de una vez.',
          'Si el producto tiene tallas o colores, el sistema te pedirá elegir una.',
          'Ajusta cantidades con «−» y «+», o quita la línea con el basurero.',
          'Elige el medio de pago y pulsa «Cobrar» (o la tecla F9).'
        ]
      },
      {
        titulo: 'Medios de pago',
        pasos: [
          'Efectivo: usa los botones de billetes («Exacto», $10.000, etc.) o escribe con cuánto paga; el sistema calcula el vuelto. Si el monto no alcanza, no deja cobrar.',
          'Transferencia: escribe el número de la transferencia.',
          'Débito: escribe el número del voucher de la máquina.'
        ]
      },
      {
        titulo: 'Descuentos',
        pasos: [
          'Escribe el descuento y elige si es porcentaje (%) o monto ($).',
          'El descuento no puede superar el 100 % ni el total del ticket, y una venta en $0 no se puede cobrar.'
        ]
      },
      {
        titulo: 'Atajos y comodidades',
        pasos: [
          'F2 o «/» lleva al buscador; Esc lo limpia; F9 cobra.',
          'El botón de cuadrícula cambia entre la lista compacta y los botones con foto.',
          'Si recargas la página o se cierra el navegador, el ticket en curso se conserva.',
          'Arriba del ticket se muestra el folio y el total de la última venta.'
        ]
      },
      {
        titulo: 'Comprobante impreso',
        pasos: [
          'Al cobrar, el comprobante se imprime solo (también en Mesas y sin conexión; sin conexión sale como «Venta sin conexión»).',
          'Para reimprimir: Salidas y vouchers → abre la venta → «Imprimir» (sale marcado como COPIA).',
          'El ancho del papel (80 o 58 mm) y apagar la impresión en un equipo sin impresora se configuran en Configuración → «Impresión en este equipo» (la primera tarjeta). Cada caja guarda lo suyo.'
        ],
        nota: 'Para que imprima directo sin la ventana de elegir impresora, el computador de caja abre Chrome con un acceso directo con --kiosk-printing y la térmica como predeterminada (pasos en Configuración → Impresión en este equipo). Es un comprobante interno, no una boleta del SII.'
      }
    ]
  },
  {
    id: 'mesas',
    titulo: 'Mesas (restaurante)',
    icono: <UtensilsCrossed size={18} />,
    resumen: 'Abrir mesas, tomar pedidos, enviarlos a cocina y cobrar la cuenta.',
    cap: 'modulos.mesas',
    ruta: '/mesas',
    secciones: [
      {
        titulo: 'Atender una mesa',
        pasos: [
          'En el salón, pulsa una mesa libre para abrir su cuenta.',
          'Agrega los productos del pedido y pulsa «Enviar pedido»: lo que se prepara va a cocina como una comanda numerada.',
          'Las bebidas y lo que se sirve sin preparar (productos sin «Se prepara en cocina») se agregan directo a la cuenta y no aparecen en Cocina.',
          'Puedes seguir agregando pedidos a la misma cuenta durante la comida.',
          'Si los clientes se cambian de mesa, usa «Mover» para trasladar la cuenta.'
        ]
      },
      {
        titulo: 'Cobrar la cuenta',
        pasos: [
          'Pulsa «Cobrar», elige el medio de pago y, si corresponde, la propina.',
          'La propina queda aparte del total (no lleva IVA) y se asocia al garzón que abrió la mesa.',
          'Al cobrar se genera una venta normal, que aparece en Reportes.'
        ]
      },
      {
        titulo: 'Configurar el salón',
        pasos: ['Con «Configurar mesas» se agregan mesas, se cambia su nombre, zona y capacidad, y se quitan las que no se usan (solo si no tienen una cuenta abierta).']
      }
    ]
  },
  {
    id: 'cocina',
    titulo: 'Cocina',
    icono: <ChefHat size={18} />,
    resumen: 'La pantalla de comandas para cocina o barra.',
    cap: 'modulos.cocina',
    ruta: '/cocina',
    secciones: [
      {
        titulo: 'Preparar comandas',
        pasos: [
          'Las comandas llegan solas, en tiempo real, a la columna «Por preparar», en el orden en que se enviaron.',
          'Pulsa «Empezar» al comenzar a prepararla y «Listo» cuando esté terminada: pasa a «Listas para servir».',
          'Al servirla, márcala como «Entregada» (desde Cocina o, el garzón, desde Mesas).',
          'Si la moviste por error, la flecha la devuelve a la columna anterior. Los estados avanzan o retroceden de a un paso.'
        ],
        nota: 'A Cocina solo llega lo que se prepara. Para que una bebida no llegue, desmarca «Se prepara en cocina» en el producto (Productos → editar).'
      }
    ]
  },
  {
    id: 'salidas',
    titulo: 'Salidas, vouchers y devoluciones',
    icono: <PackageMinus size={18} />,
    resumen: 'Mermas, uso interno, comprobantes de venta y devoluciones.',
    cap: 'modulos.salidas',
    ruta: '/salidas',
    secciones: [
      {
        titulo: 'Registrar una salida (merma, uso interno, etc.)',
        pasos: [
          'En «Salidas y vouchers» pulsa «Nueva salida».',
          'Busca el producto, indica la cantidad y el motivo, y confirma.',
          'Se descuenta del stock de la ubicación elegida y queda un voucher como comprobante.'
        ]
      },
      {
        titulo: 'Ver o imprimir un comprobante',
        pasos: ['La lista muestra ventas, salidas y devoluciones. Ábrelas para ver el detalle o imprimirlas.']
      },
      {
        titulo: 'Devolver o anular una venta',
        cap: 'ventas.devolver',
        pasos: [
          'Abre el comprobante de la venta y pulsa «Devolver».',
          'Elige qué productos y cuántas unidades se devuelven (o la venta completa) y escribe el motivo.',
          'El stock vuelve a la tienda donde se vendió y queda un comprobante de devolución. Las ventas nunca se borran.'
        ]
      }
    ]
  },
  {
    id: 'ingreso',
    titulo: 'Ingreso de mercadería',
    icono: <PackagePlus size={18} />,
    resumen: 'Recibir compras de proveedores y sumarlas al stock.',
    cap: 'modulos.ingreso',
    ruta: '/ingreso',
    secciones: [
      {
        titulo: 'Recibir mercadería',
        pasos: [
          'Elige el destino (tienda o bodega) y, si quieres, el proveedor y el documento (factura o guía, número y fecha).',
          'Busca cada producto (sirve el lector de código de barras) y escribe la cantidad recibida.',
          'Pulsa confirmar: el stock del destino se actualiza al instante.'
        ],
        nota: 'Opcionalmente puedes actualizar el costo del producto con lo que pagaste en esta compra.'
      }
    ]
  },
  {
    id: 'inventario',
    titulo: 'Inventario y reposición',
    icono: <Boxes size={18} />,
    resumen: 'Stock por ubicación, quiebres y qué reponer.',
    cap: 'modulos.inventario',
    ruta: '/inventario',
    secciones: [
      {
        titulo: 'Consultar el stock',
        pasos: [
          'Inventario muestra el stock de la ubicación elegida en la barra superior, con su estado (disponible, bajo mínimo, sin stock).',
          'Busca por nombre o código, filtra por categoría o estado y pulsa un producto para ver su detalle y movimientos.'
        ]
      },
      {
        titulo: 'Reposición y alertas',
        pasos: [
          'En «Reposición y alertas» el sistema proyecta las ventas y te dice qué se quebrará y cuánto reponer.',
          'Elige hasta cuándo quieres cubrir (hasta el domingo, 7, 14 o 30 días u otra fecha) y la tienda.',
          'Cada fila indica si conviene traer desde bodega o comprar.',
          '«Transferir desde bodega» crea de una vez las transferencias sugeridas.'
        ],
        nota: 'Mientras haya poca historia de ventas, las alertas usan el stock mínimo de cada producto.'
      }
    ]
  },
  {
    id: 'productos',
    titulo: 'Productos',
    icono: <Tags size={18} />,
    resumen: 'El catálogo: crear y editar productos, precios, fotos, tallas y códigos.',
    cap: 'modulos.productos',
    ruta: '/productos',
    secciones: [
      {
        titulo: 'Crear o editar un producto',
        pasos: [
          'Pulsa el botón flotante «Nuevo producto» (abajo a la derecha) o un producto de la lista para editarlo.',
          'Completa nombre, código (SKU), categoría, precio de venta, costo y stock mínimo.',
          'Puedes subir una foto y escanear o escribir su código de barras; si no tiene, «Generar» crea uno y «Imprimir etiqueta» lo imprime.'
        ]
      },
      {
        titulo: 'Tallas y colores',
        pasos: [
          'Si tu empresa usa tallas y colores, en el producto puedes crear sus variantes. Cada una tiene su propio stock y hay que elegirla al vender.',
          'Para dejar de usar una variante, desactívala (solo se puede si no le queda stock).'
        ]
      },
      {
        titulo: 'Productos sin control de stock',
        pasos: [
          'Platos, servicios o similares pueden marcarse como «sin control de stock»: se venden siempre y no generan movimientos ni alertas.'
        ]
      }
    ]
  },
  {
    id: 'bodega',
    titulo: 'Bodega y transferencias',
    icono: <Warehouse size={18} />,
    resumen: 'Mover mercadería entre bodega y tiendas.',
    cap: 'modulos.bodega',
    ruta: '/bodega',
    secciones: [
      {
        titulo: 'Enviar mercadería a una tienda',
        pasos: [
          'Pulsa «Nueva transferencia», elige el origen y el destino, agrega los productos y cantidades, y pulsa «Crear transferencia». El stock queda reservado en el origen.',
          'Cuando la mercadería sale, pulsa «Despachar»: pasa a «en tránsito».',
          'En el destino, pulsa «Recibir» y confirma las cantidades que llegaron. Si llegó menos, se registra la diferencia.'
        ]
      }
    ]
  },
  {
    id: 'movimientos',
    titulo: 'Movimientos',
    icono: <ArrowLeftRight size={18} />,
    resumen: 'El historial completo de entradas, salidas y transferencias.',
    cap: 'modulos.movimientos',
    ruta: '/movimientos',
    secciones: [
      {
        titulo: 'Revisar el historial',
        pasos: [
          'Filtra por tipo o estado, o busca por referencia o folio (por ejemplo, VTA-261025-00345).',
          'Se muestran de a 100; usa «Cargar más» para ver los anteriores.',
          'Pulsa un movimiento para ver su detalle y el producto.'
        ]
      }
    ]
  },
  {
    id: 'reportes',
    titulo: 'Reportes',
    icono: <BarChart3 size={18} />,
    resumen: 'Ventas por período y tienda, ranking, productos y medios de pago.',
    cap: 'modulos.reportes',
    ruta: '/reportes',
    secciones: [
      {
        titulo: 'Ver las ventas',
        pasos: [
          'Elige el período (hoy, 7 o 28 días, este mes, mes anterior o un rango) y, si quieres, una tienda.',
          'Cada cifra se compara con el período anterior del mismo largo.',
          'Pulsa una tienda del ranking para ver solo sus ventas.',
          '«Exportar CSV» descarga los datos para abrirlos en Excel.'
        ],
        nota: 'El filtro de tienda de Reportes es propio: no depende de la ubicación elegida en la barra superior. Si aparece un aviso de ventas simuladas, el período incluye datos de demostración.'
      }
    ]
  },
  {
    id: 'usuarios',
    titulo: 'Usuarios y permisos',
    icono: <Users size={18} />,
    resumen: 'Crear cuentas, definir qué puede hacer cada persona y dónde.',
    cap: 'modulos.usuarios',
    ruta: '/usuarios',
    secciones: [
      {
        titulo: 'Crear un usuario',
        cap: 'usuarios.gestionar',
        pasos: [
          'Pulsa «Crear usuario», escribe nombre y correo, y elige el puesto (tienda, bodega, auditor o administrador).',
          'Los permisos vienen marcados según el puesto; puedes ajustarlos antes de crear la cuenta.',
          'Elige en qué ubicaciones trabajará («Todas» o solo algunas).',
          'Entrega al usuario la clave temporal que aparece al final: deberá cambiarla al ingresar.'
        ]
      },
      {
        titulo: 'Cambiar permisos, clave o estado',
        cap: 'usuarios.gestionar',
        pasos: [
          '«Permisos» cambia el puesto, los módulos y acciones, y las ubicaciones. Lo que difiere del puesto queda marcado como «ajustado».',
          '«Clave» genera una nueva clave temporal. «Desactivar» bloquea el acceso sin borrar su historial.',
          'Solo verás los módulos que tu empresa tiene habilitados, y no puedes dar permisos que tú no tienes.'
        ]
      }
    ]
  },
  {
    id: 'configuracion',
    titulo: 'Configuración',
    icono: <Settings size={18} />,
    resumen: 'Datos de la empresa, tiendas y bodegas, listas y apariencia.',
    cap: 'modulos.configuracion',
    ruta: '/configuracion',
    secciones: [
      {
        titulo: 'Datos de la empresa',
        pasos: [
          'Cambia el nombre, la moneda y si usas tallas y colores.',
          'El plan, el período de prueba, el rubro y los módulos habilitados los define el administrador general del sistema.'
        ]
      },
      {
        titulo: 'Tiendas y bodegas',
        pasos: [
          'Agrega una ubicación con su nombre y tipo, y pulsa «+».',
          'El lápiz permite renombrarla; el historial se mantiene.',
          '«Desactivar» la oculta para vender, recibir y transferir. Solo se puede si no tiene stock, transferencias sin recibir ni cuentas de mesa abiertas. Las ubicaciones no se borran, para conservar su historial.'
        ]
      },
      {
        titulo: 'Motivos, categorías y proveedores',
        pasos: ['Agrega cada elemento escribiéndolo y pulsando «+»; quítalo con el basurero o la «×».']
      },
      {
        titulo: 'Proyección de reposición',
        pasos: [
          'Define cuántas semanas de ventas usar, el stock de seguridad y un ajuste de temporada.',
          '«Historia simulada» carga ventas de demostración para probar la proyección; bórrala antes de trabajar con datos reales.'
        ]
      }
    ]
  },
  {
    id: 'asistente',
    titulo: 'Asistente con IA (Socio IA)',
    icono: <Sparkles size={18} />,
    resumen: 'Pregúntale a tu socio por tu stock, tus ventas, qué reponer y qué horario te conviene.',
    cap: 'asistente.usar',
    ruta: '/',
    secciones: [
      {
        titulo: 'Hacer una pregunta',
        pasos: [
          'En el Dashboard pulsa el botón «Pregúntale a tu socio», abajo a la derecha.',
          'Escribe tu pregunta como se la harías a una persona, o elige una de las sugeridas. Enter envía; Mayúscula + Enter agrega una línea.',
          'Puedes seguir preguntando sobre lo mismo («¿y en la tienda Centro?»): el asistente recuerda la conversación mientras la pestaña siga abierta.',
          '«Nueva conversación» borra el chat y empieza de cero.'
        ],
        nota: 'El asistente solo lee información y ve lo mismo que tú: tus ubicaciones y los módulos que tienes habilitados. No registra ventas ni mueve stock.'
      },
      {
        titulo: 'Qué puedes preguntar',
        pasos: [
          'Stock: «¿cuántas poleras negras quedan?», «¿qué está bajo el mínimo?».',
          'Ventas: «¿cómo van las ventas de esta semana comparado con la anterior?», «¿qué fue lo más vendido este mes?».',
          'Reposición: «¿qué debo tener en stock para este fin de semana?», «¿qué se me va a acabar primero?».',
          'Horarios: «¿en qué horario me conviene abrir?», «¿qué día necesito más personal?».',
          'Rentabilidad: «¿qué productos me dejan más margen?», «¿qué tengo parado en bodega?», «¿cómo va mi negocio este mes?».'
        ],
        nota: 'Las preguntas de ventas y horarios requieren el permiso de Reportes. Las respuestas las genera una IA: revisa las cifras importantes antes de decidir.'
      },
      {
        titulo: 'Límites del plan',
        pasos: [
          'Los planes Básico, Pro y Max tienen las mismas funciones; cambia el tope de mensajes al día por usuario y por empresa. Arriba del chat ves cuántos te quedan.',
          'Los mensajes se renuevan cada día. Si hay un error al responder, ese mensaje no se descuenta.',
          'El plan lo define el administrador del sistema; el administrador de tu empresa decide quién puede usar el asistente (Usuarios → permisos → «Usar el asistente con IA»).'
        ]
      }
    ]
  },
  {
    id: 'offline',
    titulo: 'Trabajar sin conexión',
    icono: <CloudOff size={18} />,
    resumen: 'Qué pasa si se corta internet.',
    secciones: [
      {
        titulo: 'Seguir vendiendo',
        pasos: [
          'Si se corta internet, la barra superior lo indica y el Punto de Venta sigue funcionando con la última copia del catálogo y del stock.',
          'Cada venta queda guardada en el equipo y se envía sola al volver la conexión.',
          'La copia del stock se renueva cada 5 minutos mientras hay conexión. Ingresa al sistema al menos una vez con internet en cada tienda para que quede guardada.'
        ]
      },
      {
        titulo: 'Revisar lo pendiente',
        pasos: [
          'El indicador de la barra superior muestra cuántas operaciones faltan por subir; púlsalo para sincronizar.',
          'En «Sincronización» (/sync) ves la cola. Si una operación fue rechazada, revisa el motivo antes de reintentarla o descartarla.'
        ],
        nota: 'Si al sincronizar ya no había stock, la venta igual se registra (ya se cobró) y queda marcada para revisar el inventario.'
      }
    ]
  },
  {
    id: 'faq',
    titulo: 'Preguntas frecuentes',
    icono: <HelpCircle size={18} />,
    resumen: 'Dudas habituales.',
    secciones: [
      {
        titulo: 'No veo un módulo que necesito',
        pasos: [
          'Cada usuario ve solo los módulos que el administrador de su empresa le habilitó. Pídele que revise tus permisos en «Usuarios y permisos».',
          'Si el módulo no existe para tu empresa (por ejemplo Mesas o Cocina), lo habilita el administrador general del sistema.'
        ]
      },
      {
        titulo: 'No me deja vender un producto',
        pasos: [
          '«Agotado» o «Solo quedan N u.»: no hay stock suficiente en la ubicación elegida. Revisa que estés en la tienda correcta o ingresa la mercadería.',
          'Si pide talla o color, elige la variante que estás vendiendo.'
        ]
      },
      {
        titulo: 'Sigo viendo una versión antigua',
        pasos: ['Pulsa «Actualizar» en el aviso de versión nueva. Si no aparece, cierra todas las pestañas del sistema y vuelve a abrirlo.']
      },
      {
        titulo: '¿A quién le pregunto?',
        pasos: ['Al administrador de tu empresa: puede ajustar permisos, ubicaciones y claves.']
      }
    ]
  }
]

/** Minúsculas y sin tildes, para buscar «devolucion» o «devolución» por igual. */
function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function Ayuda() {
  const { can: puede, empresa } = useAuth()
  const [busqueda, setBusqueda] = useState('')
  // El asistente además necesita que la empresa tenga plan de IA
  const can = useCallback(
    (cap: Capability) => (cap === 'asistente.usar' && !empresa?.plan_ia ? false : puede(cap)),
    [puede, empresa?.plan_ia]
  )
  const termino = normalizar(busqueda.trim())

  // Solo lo que el usuario puede usar; con búsqueda, solo las secciones que coinciden
  const temas = useMemo(() => {
    return TEMAS.filter((t) => !t.cap || can(t.cap))
      .map((t) => ({ ...t, secciones: t.secciones.filter((s) => !s.cap || can(s.cap)) }))
      .map((t) => {
        if (!termino) return t
        const enTema = normalizar(`${t.titulo} ${t.resumen}`).includes(termino)
        const secciones = enTema
          ? t.secciones
          : t.secciones.filter((s) => normalizar([s.titulo, ...s.pasos, s.nota ?? ''].join(' ')).includes(termino))
        return { ...t, secciones }
      })
      .filter((t) => t.secciones.length > 0)
  }, [can, termino])

  return (
    <>
      <PageHeader title="Ayuda y guía de uso" subtitle="Cómo usar cada parte del sistema que tienes habilitada" />

      <div className="relative mb-4 max-w-xl">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" aria-hidden />
        <Input
          className="pl-9"
          placeholder="¿Qué necesitas hacer? Ej.: devolver una venta, transferir, descuento…"
          aria-label="Buscar en la ayuda"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      {temas.length === 0 ? (
        <EmptyState
          icon={<HelpCircle size={28} aria-hidden />}
          title="Sin resultados"
          description="Prueba con otras palabras, o pregunta al administrador de tu empresa."
        />
      ) : (
        <div className="space-y-3">
          {temas.map((t) => (
            <section key={t.id} className="rounded-2xl border border-border bg-panel">
              <header className="flex flex-wrap items-center justify-between gap-2 px-5 pb-2 pt-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-accent">{t.icono}</span>
                  <div>
                    <h2 className="text-base font-semibold text-fg">{t.titulo}</h2>
                    <p className="text-xs text-fg-muted">{t.resumen}</p>
                  </div>
                </div>
                {t.ruta && (
                  <Link to={t.ruta} className="text-xs font-medium text-accent hover:underline">
                    Ir al módulo →
                  </Link>
                )}
              </header>
              <div className="divide-y divide-border px-2 pb-2">
                {t.secciones.map((s) => (
                  <details key={s.titulo} open={termino ? true : undefined} className="group px-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium text-fg-body hover:text-fg [&::-webkit-details-marker]:hidden">
                      {s.titulo}
                      <ChevronDown size={16} className="shrink-0 text-fg-muted transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-fg-body marker:text-fg-faint">
                      {s.pasos.map((p) => (
                        <li key={p} className="pl-1">{p}</li>
                      ))}
                    </ol>
                    {s.nota && (
                      <p className="mb-3 rounded-lg bg-surface px-3 py-2 text-xs text-fg-muted">{s.nota}</p>
                    )}
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-fg-muted">
        ¿No encuentras lo que buscas? Pregunta al administrador de tu empresa.
      </p>
    </>
  )
}
