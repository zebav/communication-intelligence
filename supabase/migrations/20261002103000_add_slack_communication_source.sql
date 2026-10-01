-- Slack is already a connected service. Add it to the shared message source
-- enum before the importer writes conversations or messages.
alter type public.communication_source add value if not exists 'slack';
