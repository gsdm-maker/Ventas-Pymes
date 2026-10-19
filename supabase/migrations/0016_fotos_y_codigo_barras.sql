-- ============================================================
-- Mi Socio Pyme · 0016 · Fotos de productos en Storage y código de barras único
-- - Bucket «productos» (lectura pública: son fotos de catálogo y el POS las
--   necesita también sin conexión). Cada empresa escribe solo en su carpeta
--   <empresa_id>/… y solo con la capacidad productos.gestionar.
-- - Las fotos llegan comprimidas desde el navegador (WebP, ~1000 px); límite 2 MB.
-- - Código de barras único por empresa (vacío = sin código).
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('productos', 'productos', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists productos_fotos_select on storage.objects;
create policy productos_fotos_select on storage.objects for select to authenticated
  using (bucket_id = 'productos' and (storage.foldername(name))[1] = public.mi_empresa()::text);

drop policy if exists productos_fotos_insert on storage.objects;
create policy productos_fotos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'productos'
              and (storage.foldername(name))[1] = public.mi_empresa()::text
              and public.puede_escribir(public.mi_empresa(), array['productos.gestionar']));

drop policy if exists productos_fotos_update on storage.objects;
create policy productos_fotos_update on storage.objects for update to authenticated
  using (bucket_id = 'productos'
         and (storage.foldername(name))[1] = public.mi_empresa()::text
         and public.puede_escribir(public.mi_empresa(), array['productos.gestionar']))
  with check (bucket_id = 'productos'
              and (storage.foldername(name))[1] = public.mi_empresa()::text
              and public.puede_escribir(public.mi_empresa(), array['productos.gestionar']));

drop policy if exists productos_fotos_delete on storage.objects;
create policy productos_fotos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'productos'
         and (storage.foldername(name))[1] = public.mi_empresa()::text
         and public.puede_escribir(public.mi_empresa(), array['productos.gestionar']));

-- Código de barras: vacío se guarda como null; único dentro de la empresa
update public.productos set codigo_barras = null where codigo_barras is not null and trim(codigo_barras) = '';
create unique index if not exists productos_codigo_barras_unico
  on public.productos (empresa_id, codigo_barras) where codigo_barras is not null;
