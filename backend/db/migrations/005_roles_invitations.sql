-- 005_roles_invitations — team invites + owner/member roles (Phase 26).
--
-- users.role existed since Stage 4 (default 'owner', no constraint). From here:
--   * the default is 'member' — signup passes 'owner' explicitly for the
--     founding user; accept-invite passes the invitation's role;
--   * a CHECK pins it to exactly ('owner','member').
-- Any pre-existing row keeps whatever role it had (all 'owner' in practice).

ALTER TABLE users ALTER COLUMN role SET DEFAULT 'member';
UPDATE users SET role = 'owner' WHERE role IS NULL OR role NOT IN ('owner', 'member');
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'member'));

-- One pending invite per (token). email is the address the link was sent to;
-- role is what the accepted user will get. FKs cascade so deleting the org (or
-- the inviting user) clears its outstanding invites.
CREATE TABLE IF NOT EXISTS invitations (
  token              TEXT PRIMARY KEY,
  org_id             INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email              TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  invited_by_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  expires_at         TIMESTAMPTZ NOT NULL,
  accepted_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invitations_org_idx ON invitations (org_id);
CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations (lower(email));
