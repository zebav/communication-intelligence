-- Keep secure-vault private while allowing the audio formats processed by the
-- automatic transcription pipeline. Access continues through owner-scoped RLS
-- and short-lived signed URLs only.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif',
  'text/plain','text/csv','application/json',
  'audio/mpeg','audio/mp4','audio/m4a','audio/wav','audio/x-wav','audio/ogg','audio/webm',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]
where id = 'secure-vault';
