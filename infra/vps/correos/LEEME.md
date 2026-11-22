# Correos de GoTrue en español

Plantillas HTML. Solo `recuperacion` se usa hoy (`resetPasswordForEmail`); las demás evitan que
GoTrue caiga a su texto en inglés si algún día se usan.

Variables de entorno del contenedor GoTrue (las plantillas se sirven por HTTP en loopback, p. ej. nginx en `127.0.0.1:8099` apuntando a esta carpeta):

```
GOTRUE_MAILER_TEMPLATES_RECOVERY=http://127.0.0.1:8099/recuperacion.html
GOTRUE_MAILER_TEMPLATES_INVITE=http://127.0.0.1:8099/invitacion.html
GOTRUE_MAILER_TEMPLATES_CONFIRMATION=http://127.0.0.1:8099/confirmacion.html
GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=http://127.0.0.1:8099/enlace_acceso.html
GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE=http://127.0.0.1:8099/cambio_correo.html
GOTRUE_MAILER_TEMPLATES_REAUTHENTICATION=http://127.0.0.1:8099/reautenticacion.html

GOTRUE_MAILER_SUBJECTS_RECOVERY=Recupera tu clave de Mi Socio Pyme
GOTRUE_MAILER_SUBJECTS_INVITE=Te invitaron a Mi Socio Pyme
GOTRUE_MAILER_SUBJECTS_CONFIRMATION=Confirma tu correo
GOTRUE_MAILER_SUBJECTS_MAGIC_LINK=Tu enlace de acceso
GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE=Confirma el cambio de correo
GOTRUE_MAILER_SUBJECTS_REAUTHENTICATION=Código de verificación
```

Verificado 22/11/2026 en el VPS con GoTrue v2.197.0 (contenedor temporal, SMTP simulado): `file://` NO funciona (GoTrue manda el correo en inglés sin avisar); por HTTP sí sale en español con el asunto configurado. El contenedor usa red host, así que llega a `127.0.0.1`. Recuperar clave tiene límite de 1 envío por minuto por usuario (responde 429).

## Aplicado en el VPS (22/11/2026, `msp_prueba`)
- Plantillas en `/srv/correos_msp` (755) servidas por nginx en `127.0.0.1:8099` (`nginx_correos.conf`).
- Variables añadidas a `/srv/msp_prueba/gotrue.env` (copia previa: `gotrue.env.antes-correos`); contenedor `msp_prueba-auth` recreado con los mismos flags (host, read-only, cap-drop ALL, 128 MB, restart unless-stopped).
- Un nginx leyendo desde `/srv/msp_prueba/...` falla con 404 por permisos: de ahí la carpeta aparte.
- No se mandó un correo real de prueba (la base es copia de producción y el SMTP es el real).
