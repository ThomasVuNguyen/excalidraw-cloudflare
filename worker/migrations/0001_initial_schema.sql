-- ExcaliDash D1 Schema
-- Migrated from Prisma SQLite schema

-- System configuration (single-row table)
CREATE TABLE IF NOT EXISTS system_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  auth_enabled INTEGER NOT NULL DEFAULT 0,
  registration_enabled INTEGER NOT NULL DEFAULT 1,
  oidc_jit_provisioning_enabled INTEGER NOT NULL DEFAULT 1,
  bootstrap_setup_code_hash TEXT,
  bootstrap_setup_code_created_at TEXT,
  bootstrap_setup_code_attempts INTEGER NOT NULL DEFAULT 0,
  login_rate_limit_enabled INTEGER NOT NULL DEFAULT 1,
  login_rate_limit_max_attempts INTEGER NOT NULL DEFAULT 10,
  login_rate_limit_window_seconds INTEGER NOT NULL DEFAULT 900,
  login_rate_limit_lockout_seconds INTEGER NOT NULL DEFAULT 900,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'USER',
  is_active INTEGER NOT NULL DEFAULT 1,
  must_reset_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Auth identities (OIDC link)
CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'oidc',
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  email_at_link TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(issuer, subject)
);
CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);

-- Collections
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id);

-- Drawings
CREATE TABLE IF NOT EXISTS drawings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Untitled',
  elements TEXT NOT NULL DEFAULT '[]',
  app_state TEXT NOT NULL DEFAULT '{}',
  files TEXT NOT NULL DEFAULT '{}',
  preview TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_drawings_user ON drawings(user_id);
CREATE INDEX IF NOT EXISTS idx_drawings_collection ON drawings(collection_id);

-- Drawing snapshots (history)
CREATE TABLE IF NOT EXISTS drawing_snapshots (
  id TEXT PRIMARY KEY,
  drawing_id TEXT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  elements TEXT NOT NULL,
  app_state TEXT,
  files TEXT,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_snapshots_drawing ON drawing_snapshots(drawing_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON drawing_snapshots(created_at);

-- Drawing permissions (user-level sharing)
CREATE TABLE IF NOT EXISTS drawing_permissions (
  id TEXT PRIMARY KEY,
  drawing_id TEXT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'view',
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(drawing_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_perms_drawing ON drawing_permissions(drawing_id);
CREATE INDEX IF NOT EXISTS idx_perms_user ON drawing_permissions(user_id);

-- Drawing link shares (public links)
CREATE TABLE IF NOT EXISTS drawing_link_shares (
  id TEXT PRIMARY KEY,
  drawing_id TEXT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  permission TEXT NOT NULL DEFAULT 'view',
  passphrase_hash TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_link_shares_drawing ON drawing_link_shares(drawing_id);
CREATE INDEX IF NOT EXISTS idx_link_shares_token ON drawing_link_shares(token_hash);

-- User library (Excalidraw custom library items)
CREATE TABLE IF NOT EXISTS libraries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  items TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Refresh tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_hash ON refresh_tokens(token_hash);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reset_hash ON password_reset_tokens(token_hash);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- Initialize system config
INSERT OR IGNORE INTO system_config (id) VALUES ('default');
