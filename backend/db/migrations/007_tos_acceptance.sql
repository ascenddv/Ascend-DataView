-- 007_tos_acceptance — record when a user agreed to the Terms + Privacy Policy
-- (Phase 30). Signup is rejected server-side without the checkbox; invited
-- users are stamped now() on accept. NULL for pre-existing rows.

ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMPTZ;
