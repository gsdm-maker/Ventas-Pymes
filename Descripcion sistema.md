# Proyecto: Mi Socio Pyme — Sistema de inventario para tiendas

## Objetivo

Diseña un mockup de alta calidad para una aplicación web tipo SaaS llamada Mi Socio Pyme, destinada a pequeños negocios de ropa, bisutería, accesorios y artículos de venta minorista.

El sistema debe permitir administrar múltiples empresas, bodegas y tiendas, registrar entradas y salidas de mercadería, controlar el stock y operar sin conexión a internet mediante una PWA.

El diseño debe representar un producto realista, simple, moderno y preparado para convertirse posteriormente en una aplicación funcional.

## 1. Diseño visual

- Interfaz moderna, limpia, profesional y fácil de utilizar.
- Evitar una estética genérica de inteligencia artificial.
- Fondo claro, superficies blancas, bordes suaves y colores de estado bien diferenciados.
- Utilizar fotografías reales de ropa, bolsos, joyería, bisutería y accesorios en las tarjetas de productos.
- Tipografía legible y jerarquía visual clara.
- Navegación lateral en escritorio y navegación simplificada en dispositivos móviles.
- Botones grandes y acciones evidentes para los usuarios de tienda.
- Diseño responsive para escritorio, tablet y celular.
- Idioma español y formato de fechas DD/MM/AAAA.
- Utilizar datos ficticios realistas en español.
- Diseñar componentes reutilizables y consistentes en todas las pantallas.

## 2. Roles de usuario

Diseñar la experiencia según estos roles:

1. Administrador de plataforma: administra clientes, planes y funcionalidades habilitadas.
2. Administrador de empresa: configura su negocio, tiendas, bodegas, usuarios y parámetros.
3. Encargado de bodega: registra recepciones y despacha transferencias.
4. Encargado de tienda: consulta inventario, recibe mercadería y registra salidas.
5. Auditor o supervisor: consulta movimientos, existencias, comprobantes y reportes.

Cada usuario solo debe acceder a las empresas, ubicaciones y funcionalidades autorizadas.

## 3. Pantallas obligatorias

### A. Inicio de sesión

- Logo Mi Socio Pyme.
- Correo y contraseña.
- Recuperación de contraseña.
- Diseño limpio y adaptable.

### B. Dashboard de inventario

Mostrar tarjetas KPI:
- Productos activos.
- Unidades disponibles.
- Productos bajo stock mínimo.
- Productos sin stock.
- Productos próximos a vencer.
- Transferencias pendientes.
- Movimientos pendientes de sincronización.

Incluir:
- Gráfico de evolución de movimientos.
- Distribución del stock por tienda y bodega.
- Tabla de productos críticos.
- Alertas por stock mínimo configurable.
- Alertas de vencimiento a 7, 15 y 30 días, cuando corresponda.
- Selector de empresa, tienda, bodega y período.
- Indicador visual de conexión y última sincronización.

Los umbrales y períodos de alerta deben ser configurables. No todos los productos tienen fecha de vencimiento.

### C. Salida rápida de mercadería

Esta es la pantalla más importante del sistema.

Diseñar una interfaz mobile-first extremadamente simple.

Flujo:
1. Buscar un producto por nombre o SKU, o seleccionarlo visualmente desde un catálogo de fotografías.
2. Mostrar imagen, nombre, variante, talla o color cuando corresponda.
3. Mostrar el stock disponible en la tienda seleccionada.
4. Ingresar la cantidad mediante teclado numérico o controles + y -.
5. Seleccionar un motivo de salida si la empresa lo tiene habilitado.
6. Confirmar la operación con un botón grande.
7. Mostrar confirmación del movimiento y generar un voucher interno.

El voucher debe incluir:
- Número único.
- Empresa y tienda.
- Fecha y hora.
- Usuario responsable.
- Producto, variante y cantidad.
- Tipo de movimiento.
- Estado de sincronización.

No implementar emisión de boletas, facturas ni pagos. El voucher es exclusivamente un comprobante interno de movimiento de inventario.

Permitir guardar y consultar el voucher sin internet.

### D. Ingreso de mercadería

Crear un formulario sencillo que permita:
- Registrar una recepción.
- Seleccionar proveedor u origen.
- Agregar varios productos y cantidades.
- Registrar costo unitario de forma opcional.
- Seleccionar el destino: bodega central o una tienda.
- Registrar lote y fecha de vencimiento solo cuando corresponda.
- Adjuntar observaciones.
- Confirmar la recepción.

Al confirmar, actualizar las existencias de la ubicación de destino y guardar el historial del movimiento.

### E. Bodega y transferencias

Diseñar una pantalla de administración de bodega central y ubicaciones.

Flujo de transferencia:
1. Seleccionar ubicación de origen.
2. Seleccionar tienda de destino.
3. Agregar productos y cantidades.
4. Validar stock disponible.
5. Confirmar despacho.
6. Cambiar el estado a En tránsito.
7. Permitir que la tienda confirme la recepción.
8. Registrar diferencias y actualizar las existencias.

Estados visuales: Borrador, Pendiente de despacho, En tránsito, Recibida, Recibida con diferencias y Cancelada.

Una transferencia no debe contabilizarse dos veces. El stock debe distinguir entre disponible, reservado y en tránsito según corresponda.

### F. Inventario

Crear una tabla y una vista en tarjetas con:
- Fotografía.
- SKU.
- Nombre del producto.
- Categoría.
- Variante, talla y color.
- Stock disponible.
- Stock mínimo.
- Ubicación.
- Estado del stock.
- Fecha de vencimiento opcional.

Permitir filtros, búsqueda y acceso al detalle de cada producto.

El detalle debe incluir existencias por ubicación, historial de movimientos y configuración de alertas.

### G. Catálogo y productos

Permitir administrar:
- Nombre.
- SKU único dentro de la empresa.
- Código de barras opcional.
- Fotografía.
- Descripción.
- Categoría y subcategoría.
- Marca opcional.
- Variantes de talla, color o modelo.
- Unidad de medida.
- Stock mínimo y objetivo.
- Control de vencimiento opcional.
- Estado activo o inactivo.

Los productos deben pertenecer a una empresa y poder manejar existencias independientes en cada ubicación.

### H. Movimientos y vouchers

Crear una tabla con entradas, salidas, transferencias y ajustes autorizados.

Incluir filtros por fecha, producto, usuario, ubicación y tipo de movimiento.

Permitir abrir el detalle del movimiento, consultar su voucher e identificar si fue registrado localmente, sincronizado o rechazado.

Mantener trazabilidad y no permitir eliminar movimientos confirmados sin un procedimiento de reversa auditado.

### I. Maestros y configuración

Diseñar módulos para administrar:
- Empresas y suscripciones.
- Tiendas y bodegas.
- Productos y categorías.
- Usuarios, roles y permisos.
- Proveedores.
- Motivos de salida.
- Unidades de medida.
- Parámetros de stock mínimo.
- Umbrales de vencimiento.
- Funcionalidades habilitadas por empresa.
- Configuración de vouchers.
- Preferencias de sincronización.

Debe ser posible agregar una cuarta, quinta o más tiendas sin rediseñar el sistema.

### J. Administración de usuarios

Crear una tabla de usuarios con nombre, correo, rol, empresa, ubicaciones autorizadas y estado.

Permitir invitar usuarios, activar o desactivar accesos y asignar permisos por módulo y ubicación.

### K. Sincronización y operación offline

Diseñar una pantalla de estado de sincronización con:
- Conectado o sin conexión.
- Última sincronización exitosa.
- Operaciones pendientes.
- Errores que requieren revisión.
- Acción para reintentar sincronización.

Cuando no haya internet, mostrar una franja discreta pero visible indicando que el sistema trabaja sin conexión.

La PWA debe poder abrirse y registrar movimientos sin conexión, siempre que los datos necesarios estén almacenados localmente. No mostrar información global como si estuviera actualizada en tiempo real cuando la tienda esté desconectada.

Cada movimiento debe tener un identificador único y un estado de sincronización.

## 4. Navegación

Menú administrativo:
- Dashboard
- Inventario
- Productos
- Ingreso de mercadería
- Bodega y transferencias
- Salidas y vouchers
- Movimientos
- Reportes
- Usuarios y permisos
- Configuración

Menú de tienda:
- Inicio
- Nueva salida
- Inventario
- Recepción de mercadería
- Historial y vouchers

Ocultar los módulos que no correspondan al rol del usuario.

## 5. Datos ficticios para el prototipo

Utilizar:
- Empresa: Boutique Aurora.
- Bodega central: Bodega Principal.
- Tiendas: Tienda Centro, Tienda Mall y Tienda Outlet.
- Categorías: Ropa, Bisutería, Carteras y Accesorios.
- Productos ficticios con fotografías, SKU y stock.
- Ejemplos de stock crítico, productos agotados, transferencias pendientes y operaciones offline.

## 6. Resultado esperado

Generar un prototipo coherente y navegable con todas las pantallas anteriores, estados visuales y recorridos entre módulos.

Priorizar la pantalla de salida rápida y la experiencia móvil.

Usar datos ficticios para demostrar el funcionamiento. Las acciones deben tener interacciones de prototipo cuando la herramienta lo permita.

El diseño debe ser una base clara para desarrollar posteriormente una PWA con almacenamiento local, sincronización, base de datos central, control de permisos y arquitectura multiempresa.

No limitar el resultado a un único dashboard. Crear las distintas pantallas, relacionarlas mediante navegación y mantener una identidad visual consistente.