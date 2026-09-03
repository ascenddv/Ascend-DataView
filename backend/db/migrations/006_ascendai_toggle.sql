-- 006_ascendai_toggle — per-organization AscendAI switch (Phase 28).
--
-- Alongside the global ASCENDAI_ENABLED env flag, an owner can turn AscendAI
-- off for their own organization. Default true — existing orgs are unaffected.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ascendai_enabled BOOLEAN NOT NULL DEFAULT true;
