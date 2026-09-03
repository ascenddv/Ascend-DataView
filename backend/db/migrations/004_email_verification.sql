-- 004_email_verification — email verification + password reset (Phase 25).
--
-- users.email_verified_at is NULL until the user follows the link from their
-- signup email. Unverified users can sign in and view the dashboard, but
-- requireVerified blocks upload, AscendAI, invites and export until it is set.
--
-- Both token tables: token is a 32-byte random hex string (the PK), single-use
-- (used_at), time-boxed (expires_at). FKs cascade so deleting a user (Phase 27)
-- takes its outstanding tokens with it.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS email_verifications (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verifications_user_idx ON email_verifications (user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id);
