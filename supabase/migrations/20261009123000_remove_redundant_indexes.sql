-- Verified against production index definitions on 2026-10-09.
-- Each dropped index is byte-for-byte redundant with the retained index on the
-- same table and column order. The retained names are referenced below.

drop index if exists public.commitments_owner_due_idx;
-- Retained: public.commitments_owner_status_due_idx (owner_id, status, due_at)

drop index if exists public.solvani_oauth_codes_expires_idx;
-- Retained: public.solvani_oauth_codes_expiry_idx (expires_at)

drop index if exists public.solvani_oauth_tokens_refresh_expires_idx;
-- Retained: public.solvani_oauth_tokens_refresh_expiry_idx (refresh_expires_at)
