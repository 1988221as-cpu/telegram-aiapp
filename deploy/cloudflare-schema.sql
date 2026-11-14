-- ============================================================================
-- 灵犀语境 (LingXi Context) 云端商业化卡密、单机绑定与 Telegram API 池数据库结构
-- 兼容 Turso (libSQL) 与 Cloudflare D1
--
-- Turso 执行方式：
--   turso db shell <你的数据库名> < deploy/cloudflare-schema.sql
--   （或直接复制本文件内容到 Turso 网页控制台 SQL 编辑器运行）
-- Cloudflare D1 执行方式：
--   npx wrangler d1 execute lingxi-auth-db --remote --file=deploy/cloudflare-schema.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  plan TEXT NOT NULL DEFAULT 'trial_3d',          -- 'trial_3d' | 'monthly_30d'
  vip_expires_at INTEGER NOT NULL,                -- Unix epoch milliseconds
  bound_device_id TEXT,                           -- 单机指纹绑定 (例如 LX-DEV-...)
  max_accounts INTEGER NOT NULL DEFAULT 20,       -- 单台电脑最多登录 20 个电报账户
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS card_keys (
  code TEXT PRIMARY KEY,                          -- 卡密编号 (如 LX3D-XXXX-XXXX-XXXX / LX30D-...)
  plan TEXT NOT NULL,                             -- 'trial_3d' | 'monthly_30d'
  duration_days INTEGER NOT NULL,                 -- 3 或 30
  status TEXT NOT NULL DEFAULT 'unused',          -- 'unused' | 'used' | 'revoked'
  batch_id TEXT,
  used_by_user_id TEXT,
  used_by_username TEXT,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (used_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS auth_audit_logs (
  id TEXT PRIMARY KEY,
  username TEXT,
  action TEXT NOT NULL,                           -- 'register' | 'login' | 'redeem' | 'unbind_device' | 'generate_cards' | 'assign_api_pool'
  device_id TEXT,
  card_key TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);

-- ============================================================================
-- Telegram API 凭据池与用户动态分配绑定 (模式 B：支持在 Turso 网页后台直接增删改)
--
-- 网页后台便捷操作说明：
-- 1. 新增凭据：点击 + Add record，只需填写 id（如 pool-02）、api_id、api_hash 即可保存，其余字段均有默认值。
-- 2. 停用旧凭据：双击该行 is_active 字段，将 1 改为 0 即可立即停用并跳过分配。
-- 3. 直接删除行：支持直接从网页删除废弃行，关联绑定记录会自动级联清理（ON DELETE CASCADE）。
-- ============================================================================
CREATE TABLE IF NOT EXISTS telegram_api_pool (
  id TEXT PRIMARY KEY,                            -- 池节点 ID，如 pool-01 / pool-02
  api_id INTEGER NOT NULL UNIQUE,                 -- my.telegram.org 申请的数字 API ID
  api_hash TEXT NOT NULL,                         -- my.telegram.org 申请的 32 位 API Hash
  label TEXT DEFAULT '',                          -- 可选备注标签
  max_devices INTEGER DEFAULT 50,                 -- 单组凭据建议承载上限（留空默认 50）
  is_active INTEGER DEFAULT 1,                    -- 1=启用（默认）, 0=停用/封禁跳过
  notes TEXT DEFAULT '',                          -- 可选备注说明
  created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  updated_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);

CREATE TABLE IF NOT EXISTS user_api_assignments (
  user_id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL,
  assigned_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  updated_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (pool_id) REFERENCES telegram_api_pool(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_bound_device ON users(bound_device_id);
CREATE INDEX IF NOT EXISTS idx_card_keys_status ON card_keys(status);
CREATE INDEX IF NOT EXISTS idx_card_keys_batch ON card_keys(batch_id);
CREATE INDEX IF NOT EXISTS idx_tg_pool_active ON telegram_api_pool(is_active);
CREATE INDEX IF NOT EXISTS idx_user_api_pool_id ON user_api_assignments(pool_id);

