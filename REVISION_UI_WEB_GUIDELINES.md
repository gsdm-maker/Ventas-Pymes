# Revisión UI — Web Interface Guidelines (Vercel)

Skill: `web-design-guidelines` · Fecha: 18-10-2026 · Reglas: `vercel-labs/web-interface-guidelines`
Estado: **informe generado, cambios aún no aplicados**.

## Resumen por prioridad

**Alta (a11y)**
- Botones solo-icono sin `aria-label` (varios archivos).
- Toasts sin `aria-live` → no se anuncian.
- Falta *skip link* al contenido principal.
- `autoFocus` en móvil.

**Media**
- `<img>` sin `width`/`height` (CLS) y sin `loading="lazy"` (salvo POS).
- `transition-all` (usar propiedades explícitas).
- Modal sin `overscroll-behavior: contain`.

**Baja**
- Fechas con formato manual → `Intl.DateTimeFormat`.
- `touch-action: manipulation` global.
- `preconnect` a dominios de imágenes/Supabase.
- `focus:` vs `focus-visible:` en inputs.

---

## Hallazgos por archivo

### src/components/ui/Button.tsx
- Button.tsx:38 - `transition-all` → listar propiedades (`transition-colors`)
- Button.tsx:39 - ✓ usa `focus-visible:` con anillo (correcto)

### src/components/ui/Input.tsx
- Input.tsx:11 - `focus:outline-none focus:ring-*` → usar `focus-visible:` (evita anillo al clic)

### src/components/ui/Toast.tsx
- Toast.tsx:44 - contenedor de avisos sin `aria-live="polite"` (lectores de pantalla no lo anuncian)
- Toast.tsx:57 - ✓ botón cerrar con `aria-label`

### src/components/ui/Modal.tsx
- Modal.tsx:33 - falta `overscroll-behavior: contain` en el contenedor/scroll (bloquea propagación en móvil)
- Modal.tsx:49 - ✓ botón cerrar con `aria-label`

### src/components/layout/AppShell.tsx
- AppShell.tsx:232 - falta *skip link* ("Saltar al contenido") antes de `<main>`
- AppShell.tsx:38 - SyncIndicator: en móvil queda solo icono → `aria-label`, no solo `title`
- AppShell.tsx:184 - botón tema solo-icono usa `title` → agregar `aria-label`
- AppShell.tsx:215, AppShell.tsx:222, AppShell.tsx:257 - botones cerrar sesión solo-icono → `aria-label`

### src/pages/Login.tsx
- ✓ pass (labels clickables, `type="email"`, `autoComplete`, botón recuperación con texto)

### src/pages/Dashboard.tsx
- Dashboard.tsx:162 - `<img>` sin `width`/`height` ni `loading="lazy"`

### src/pages/POS.tsx
- POS.tsx:223 - `transition-all`
- POS.tsx:362 - `transition-all`
- POS.tsx:296 - botón solo-icono (Menos) sin `aria-label`
- POS.tsx:303 - botón solo-icono (Más) sin `aria-label`
- POS.tsx:309 - botón solo-icono (Eliminar) sin `aria-label`
- POS.tsx:239 - `<img>` con `loading="lazy"` pero sin `width`/`height`

### src/pages/Inventario.tsx
- Inventario.tsx:136 - `transition-all`
- Inventario.tsx:77 - botón solo-icono (vista tabla) sin `aria-label`
- Inventario.tsx:80 - botón solo-icono (vista tarjetas) sin `aria-label`
- Inventario.tsx:111 - `<img>` sin `width`/`height` ni `loading="lazy"`
- Inventario.tsx:138 - `<img>` sin `width`/`height` ni `loading="lazy"`

### src/pages/Productos.tsx
- Productos.tsx:131 - `<img>` sin `width`/`height` ni `loading="lazy"`
- Productos.tsx:145 - botón solo-icono (editar) sin `aria-label`

### src/pages/Ingreso.tsx
- Ingreso.tsx:128 - `<img>` sin `width`/`height` ni `loading="lazy"`
- Ingreso.tsx:164 - botón solo-icono (eliminar) sin `aria-label`

### src/pages/SalidaRapida.tsx
- SalidaRapida.tsx:150 - `autoFocus` en input (evitar en móvil)
- SalidaRapida.tsx:164 - `<img>` sin `width`/`height` ni `loading="lazy"`
- SalidaRapida.tsx:181 - `<img>` sin `width`/`height` ni `loading="lazy"`
- SalidaRapida.tsx:196 - botón solo-icono (Menos) sin `aria-label`
- SalidaRapida.tsx:208 - botón solo-icono (Más) sin `aria-label`

### src/pages/ProductoDetalle.tsx
- ProductoDetalle.tsx:72 - `<img>` sin `width`/`height` ni `loading="lazy"`

### src/pages/Configuracion.tsx
- Configuracion.tsx:171 - botón solo-icono (eliminar motivo) sin `aria-label`
- Configuracion.tsx:189 - botón solo-icono (eliminar categoría, "✕") sin `aria-label`
- Configuracion.tsx:207 - botón solo-icono (eliminar proveedor) sin `aria-label`

### src/pages/Bodega.tsx
- Bodega.tsx:219 - botón solo-icono (quitar ítem, "✕") sin `aria-label`

### src/lib/format.ts
- format.ts:40 - fecha manual DD/MM/AAAA → `Intl.DateTimeFormat('es-CL')`
- format.ts:49 - hora manual → `Intl.DateTimeFormat`
- format.ts:57 - hora manual → `Intl.DateTimeFormat`
- ✓ montos ya usan `Intl.NumberFormat('es-CL')`

### src/index.css
- falta `touch-action: manipulation` en elementos interactivos (evita retraso de doble tap)
- index.css:164 - `overscroll-behavior: none` en `body`: considerar moverlo a `@media (pointer: fine)`

### Global (index.html)
- ✓ viewport sin `user-scalable=no` (bueno)
- index.html:10 - ✓ `preconnect` a fuentes; agregar `preconnect` a `images.unsplash.com` y `*.supabase.co`

---

## Cómo usar este informe
Aplicar los cambios de prioridad **Alta** primero (accesibilidad), luego **Media** (CLS/anima),
y por último **Baja**. Los cambios son localizados y no alteran funcionalidad.
