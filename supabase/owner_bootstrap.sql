-- ============================================================
-- Bootstrap del Administrador General (ejecutar UNA vez)
-- 1) Crea el usuario en Supabase Dashboard → Authentication → Add user
--    (email + password, "Auto Confirm User" activado).
-- 2) Reemplaza el correo y ejecuta este script en el SQL Editor.
-- ============================================================
update public.profiles
   set es_owner = true,
       role = 'admin',
       puesto = 'admin',
       activo = true
 where email = 'admin@tu-dominio.cl'  -- reemplazar por el correo del administrador general;

-- Verificación
select id, email, es_owner, role, puesto from public.profiles where es_owner = true;
