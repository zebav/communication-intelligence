-- Slack is already a connected service. Add it to the shared message source
-- enum before the importer writes conversations or messages.
alter type public.communication_source add value if not exists 'slack';

-- Keep the bucket private, while allowing the video formats that the media
-- worker can retain, play back, and transcribe.
update storage.buckets
set allowed_mime_types = array(
  select distinct value
  from unnest(coalesce(allowed_mime_types, '{}'::text[]) || array['video/mp4', 'video/webm', 'video/quicktime']) as value
)
where id = 'secure-vault';
