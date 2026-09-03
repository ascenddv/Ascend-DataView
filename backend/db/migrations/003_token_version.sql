-- 003_token_version — revocable sessions (Phase 24).
--
-- Every session JWT carries `tv` (the token version it was minted at).
-- requireAuth rejects a token whose `tv` no longer matches the user's current
-- token_version, so bumping this column (logout-all, password reset) instantly
-- invalidates every outstanding session for that user across all instances.
--
-- Existing sessions were minted without a `tv` claim; requireAuth treats a
-- missing claim as 0, which matches this default, so they stay valid until the
-- first bump.

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
