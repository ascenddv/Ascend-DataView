-- 002_cascades — re-create every org/user foreign key with ON DELETE CASCADE.
-- Deleting an organizations row (Phase 27 account deletion) then removes all of
-- its tenant rows in one statement, instead of erroring on the FK.
--
-- The constraint names are Postgres's inline-FK defaults (<table>_<column>_fkey),
-- created either by migration 001 or by the pre-migration initDb(). DROP ...
-- IF EXISTS makes this safe both ways.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_org_id_fkey;
ALTER TABLE users ADD CONSTRAINT users_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE standardized_data DROP CONSTRAINT IF EXISTS standardized_data_org_id_fkey;
ALTER TABLE standardized_data ADD CONSTRAINT standardized_data_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE mapping_cache DROP CONSTRAINT IF EXISTS mapping_cache_org_id_fkey;
ALTER TABLE mapping_cache ADD CONSTRAINT mapping_cache_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_org_id_fkey;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_user_id_fkey;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ascendai_usage DROP CONSTRAINT IF EXISTS ascendai_usage_org_id_fkey;
ALTER TABLE ascendai_usage ADD CONSTRAINT ascendai_usage_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ascendai_usage DROP CONSTRAINT IF EXISTS ascendai_usage_user_id_fkey;
ALTER TABLE ascendai_usage ADD CONSTRAINT ascendai_usage_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE pending_uploads DROP CONSTRAINT IF EXISTS pending_uploads_org_id_fkey;
ALTER TABLE pending_uploads ADD CONSTRAINT pending_uploads_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
