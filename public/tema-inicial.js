// Aplica tema y acento antes de cargar React para evitar el destello del tema equivocado.
;(function () {
  try {
    var t = localStorage.getItem('stockflow:tema') || 'light'
    var a = localStorage.getItem('stockflow:acento')
    if (a !== 'azul') a = 'terracota'
    var html = document.documentElement
    html.setAttribute('data-theme', t)
    html.setAttribute('data-accent', a)
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', t === 'dark' ? '#181614' : '#fcf9f3')
  } catch (e) {
    /* noop */
  }
})()
