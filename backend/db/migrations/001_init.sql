-- 001_init — the AscendDV schema as converged through Stage 4 + serverless
-- durability. Every statement is guarded so this file is a safe no-op against a
-- database already provisioned by the old initDb() (production / dev), and the
-- complete schema on a fresh database.
--
-- The `standardized_data` columns are the 28 canonical fields from
-- backend/config/schema.js *as of this migration*. A new field added there
-- later gets its own numbered migration; db/migrate.js fails if the two drift.

CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  org_type TEXT NOT NULL DEFAULT 'small_nonprofit',
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS standardized_data (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  period_date TEXT,
  revenue DOUBLE PRECISION,
  expenses DOUBLE PRECISION,
  cash_balance DOUBLE PRECISION,
  revenue_donations DOUBLE PRECISION,
  revenue_grants DOUBLE PRECISION,
  revenue_events DOUBLE PRECISION,
  revenue_other DOUBLE PRECISION,
  donors_total DOUBLE PRECISION,
  donors_new DOUBLE PRECISION,
  donors_returning DOUBLE PRECISION,
  volunteers_active DOUBLE PRECISION,
  volunteer_hours DOUBLE PRECISION,
  program_participants DOUBLE PRECISION,
  website_visitors DOUBLE PRECISION,
  social_followers DOUBLE PRECISION,
  employees_total DOUBLE PRECISION,
  employees_new DOUBLE PRECISION,
  employees_departed DOUBLE PRECISION,
  marketing_spend DOUBLE PRECISION,
  email_subscribers DOUBLE PRECISION,
  email_open_rate DOUBLE PRECISION,
  grant_applications_submitted DOUBLE PRECISION,
  grant_applications_awarded DOUBLE PRECISION,
  program_outcomes_achieved DOUBLE PRECISION,
  program_outcomes_targeted DOUBLE PRECISION,
  goals_total DOUBLE PRECISION,
  goals_completed DOUBLE PRECISION,
  source_meta TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mapping_cache (
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  header_hash TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ascendai_usage (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  iterations INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_uploads (
  id UUID PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_org_user_idx ON chat_messages (org_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS ascendai_usage_org_time_idx ON ascendai_usage (org_id, created_at);
CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON rate_limits (expires_at);
CREATE INDEX IF NOT EXISTS pending_uploads_created_idx ON pending_uploads (created_at);

-- mapping_cache: composite (org_id, header_hash) primary key. Two orgs with
-- coincidentally identical header shapes must stay separate cache entries.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mapping_cache_org_header_pk') THEN
    ALTER TABLE mapping_cache ADD CONSTRAINT mapping_cache_org_header_pk PRIMARY KEY (org_id, header_hash);
  END IF;
END $$;

-- standardized_data: one row per (org, period), so manual entry upserts cleanly.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'standardized_data_org_period_uq') THEN
    ALTER TABLE standardized_data ADD CONSTRAINT standardized_data_org_period_uq UNIQUE (org_id, period_date);
  END IF;
END $$;
