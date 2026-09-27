-- Audio attachments are private, server-ingested assets. The existing RLS and
-- MFA read policies on vault_assets/person_media remain unchanged.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'text/plain', 'text/csv', 'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'
]
where id = 'secure-vault';

alter table public.vault_assets
  drop constraint if exists vault_assets_asset_kind_check;

alter table public.vault_assets
  add constraint vault_assets_asset_kind_check
  check (asset_kind in ('document','person_image','image','audio','other'));
