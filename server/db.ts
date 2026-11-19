import { createClient, type Client, type Transaction } from '@libsql/client';
import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const isTurso = Boolean(
  process.env.TURSO_DATABASE_URL &&
  (
    process.env.TURSO_DATABASE_URL.startsWith('libsql://') ||
    process.env.TURSO_DATABASE_URL.startsWith('https://') ||
    process.env.TURSO_DATABASE_URL.startsWith('http://') ||
    process.env.TURSO_DATABASE_URL.startsWith('wss://')
  )
);

export const isRailway = Boolean(
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_STATIC_URL ||
  process.env.RAILWAY_PROJECT_ID
);

/**
 * Multi-Tier Persistence Strategy:
 * Automatically resolves the persistent database directory across:
 * Tier 1: Turso Cloud DB (Remote Persistent)
 * Tier 2: Railway Volume / Docker Persistent Volume Mount Detection
 * Tier 3: Local project fallback with automated snapshots
 */
export function resolveDatabaseLocation(): {
  dbDir: string;
  dbPath: string;
  isPersistentVolume: boolean;
  persistenceTier: string;
} {
  // 1. Explicit Custom Path via ENV
  if (process.env.SQLITE_DB_PATH) {
    const customPath = path.resolve(process.env.SQLITE_DB_PATH);
    const customDir = path.dirname(customPath);
    if (!fs.existsSync(customDir)) {
      try { fs.mkdirSync(customDir, { recursive: true }); } catch { /* ignore */ }
    }
    return {
      dbDir: customDir,
      dbPath: customPath,
      isPersistentVolume: true,
      persistenceTier: 'CUSTOM_ENV_PATH',
    };
  }

  // 2. Railway Official Volume Mount Path (Injected when a Railway Volume is attached)
  const railwayVolumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (railwayVolumePath && fs.existsSync(railwayVolumePath)) {
    const dir = path.resolve(railwayVolumePath);
    return {
      dbDir: dir,
      dbPath: path.join(dir, 'telegram_pro.db'),
      isPersistentVolume: true,
      persistenceTier: 'RAILWAY_VOLUME_MOUNTED',
    };
  }

  // 3. User configured DATA_DIR / PERSISTENT_STORAGE_DIR
  const customDataDir = process.env.DATA_DIR || process.env.PERSISTENT_STORAGE_DIR;
  if (customDataDir) {
    const dir = path.resolve(customDataDir);
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    }
    return {
      dbDir: dir,
      dbPath: path.join(dir, 'telegram_pro.db'),
      isPersistentVolume: true,
      persistenceTier: 'PERSISTENT_DATA_DIR',
    };
  }

  // 4. Standard Linux / Docker volume mount point at root `/data` (common Railway volume mount)
  try {
    if (fs.existsSync('/data')) {
      const testFile = path.join('/data', '.test_writable_' + Date.now());
      fs.writeFileSync(testFile, '1');
      fs.unlinkSync(testFile);
      return {
        dbDir: '/data',
        dbPath: '/data/telegram_pro.db',
        isPersistentVolume: true,
        persistenceTier: 'ROOT_DATA_VOLUME',
      };
    }
  } catch {
    // /data not writable or not available
  }

  // 5. App-level `/app/data` volume mount point
  try {
    if (fs.existsSync('/app/data')) {
      const testFile = path.join('/app/data', '.test_writable_' + Date.now());
      fs.writeFileSync(testFile, '1');
      fs.unlinkSync(testFile);
      return {
        dbDir: '/app/data',
        dbPath: '/app/data/telegram_pro.db',
        isPersistentVolume: true,
        persistenceTier: 'APP_DATA_VOLUME',
      };
    }
  } catch {
    // ignore
  }

  // 6. Local project fallback (never attempt to write SQLite inside read-only app.asar bundle)
  let localDir = path.resolve(__dirname, '../data');
  if (/[\\/]app\.asar([\\/]|$)/i.test(localDir)) {
    localDir = path.join(os.homedir(), '.humansense', 'data');
  }
  if (!fs.existsSync(localDir)) {
    try { fs.mkdirSync(localDir, { recursive: true }); } catch { /* ignore */ }
  }

  return {
    dbDir: localDir,
    dbPath: path.join(localDir, 'telegram_pro.db'),
    isPersistentVolume: false,
    persistenceTier: isRailway ? 'RAILWAY_EPHEMERAL_CONTAINER' : 'LOCAL_CONTAINER_FILESYSTEM',
  };
}

export function formatLibsqlFileUrl(fsPath: string): string {
  const normalized = path.resolve(fsPath).replace(/\\/g, '/');
  const encoded = normalized
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F');
  return `file:${encoded}`;
}

export const locationInfo = resolveDatabaseLocation();
export const dbDir = locationInfo.dbDir;
export const dbPath = locationInfo.dbPath;
export const isPersistentVolume = locationInfo.isPersistentVolume;
export const persistenceTier = isTurso ? 'TURSO_CLOUD_HA' : locationInfo.persistenceTier;

export const dbType = isTurso
  ? 'Turso Cloud Database (libsql)'
  : isPersistentVolume
  ? `Turso LibSQL Client (Persistent Volume: ${dbDir})`
  : 'Turso LibSQL Client (Local File)';

export const SQLITE_BUSY_TIMEOUT_MS = 5000;

const resolvedLibsqlUrl = process.env.TURSO_DATABASE_URL || formatLibsqlFileUrl(dbPath);

// 1. Initialize Turso / LibSQL client
export const turso: Client = createClient({
  url: resolvedLibsqlUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
  ...(isTurso ? {} : { timeout: SQLITE_BUSY_TIMEOUT_MS }),
});

const activeTxStorage = new AsyncLocalStorage<Transaction>();

// 2. High-performance asynchronous query wrapper matching Turso capabilities with real atomic transactions
export const db = {
  client: turso,
  isTurso,
  dbType,
  tursoUrl: resolvedLibsqlUrl,

  async execute(stmt: string | { sql: string; args?: any[] | Record<string, any> }) {
    const executor = activeTxStorage.getStore() || turso;
    return await executor.execute(typeof stmt === 'string' ? { sql: stmt, args: [] } : stmt);
  },

  async ping() {
    const start = Date.now();
    const res = await turso.execute('SELECT 1 as ping');
    const latencyMs = Date.now() - start;
    return { ok: true, latencyMs, rows: res.rows };
  },

  async exec(sql: string) {
    const executor = activeTxStorage.getStore() || turso;
    return await executor.executeMultiple(sql);
  },

  prepare(sql: string) {
    return {
      async all(...params: any[]) {
        const executor = activeTxStorage.getStore() || turso;
        const res = await executor.execute({ sql, args: params });
        return res.rows as any[];
      },
      async get(...params: any[]) {
        const executor = activeTxStorage.getStore() || turso;
        const res = await executor.execute({ sql, args: params });
        return (res.rows[0] as any) || undefined;
      },
      async run(...params: any[]) {
        const executor = activeTxStorage.getStore() || turso;
        const res = await executor.execute({ sql, args: params });
        return {
          changes: res.rowsAffected,
          lastInsertRowid: res.lastInsertRowid,
        };
      },
    };
  },

  transaction<T extends (...args: any[]) => Promise<any>>(fn: T) {
    return async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
      const parentTx = activeTxStorage.getStore();
      if (parentTx) {
        const savepointName = `sp_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
        await parentTx.execute(`SAVEPOINT ${savepointName}`);
        try {
          const result = await fn(...args);
          await parentTx.execute(`RELEASE SAVEPOINT ${savepointName}`);
          return result;
        } catch (err) {
          try {
            await parentTx.execute(`ROLLBACK TO SAVEPOINT ${savepointName}`);
          } catch {}
          try {
            await parentTx.execute(`RELEASE SAVEPOINT ${savepointName}`);
          } catch {}
          throw err;
        }
      }

      const tx = await turso.transaction('write');
      try {
        const result = await activeTxStorage.run(tx, () => fn(...args));
        await tx.commit();
        return result;
      } catch (err) {
        try {
          if (!tx.closed) await tx.rollback();
        } catch {}
        try {
          if (!tx.closed) tx.close();
        } catch {}
        throw err;
      }
    };
  },
};


function extractFirstPragmaValue(result: any): unknown {
  const row = result?.rows?.[0];
  if (!row || typeof row !== 'object') return undefined;
  const values = Object.values(row);
  return values.length > 0 ? values[0] : undefined;
}

export async function getSqliteRuntimePragmas(): Promise<{
  journalMode: string;
  busyTimeoutMs: number;
  walEnabled: boolean;
}> {
  if (isTurso) {
    return {
      journalMode: 'turso_mvcc',
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
      walEnabled: true,
    };
  }
  let journalMode = 'unknown';
  let busyTimeoutMs = 0;
  try {
    const jmRes = await db.execute('PRAGMA journal_mode');
    const rawJm = extractFirstPragmaValue(jmRes);
    if (rawJm !== undefined && rawJm !== null) {
      journalMode = String(rawJm).trim().toLowerCase();
    }
  } catch (err: any) {
    console.warn('[Database] Failed to query PRAGMA journal_mode:', err?.message || err);
  }
  try {
    const btRes = await db.execute('PRAGMA busy_timeout');
    const rawBt = extractFirstPragmaValue(btRes);
    const parsedBt = Number(rawBt);
    if (Number.isFinite(parsedBt) && parsedBt >= 0) {
      busyTimeoutMs = parsedBt;
    }
  } catch (err: any) {
    console.warn('[Database] Failed to query PRAGMA busy_timeout:', err?.message || err);
  }
  return {
    journalMode,
    busyTimeoutMs,
    walEnabled: journalMode === 'wal',
  };
}

export async function configureLocalSqlitePragmas(): Promise<{
  journalMode: string;
  busyTimeoutMs: number;
  synchronousMode: string;
  walEnabled: boolean;
}> {
  if (isTurso) {
    return {
      journalMode: 'turso_mvcc',
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
      synchronousMode: 'normal',
      walEnabled: true,
    };
  }

  let journalMode = 'unknown';
  let busyTimeoutMs = 0;
  let synchronousMode = 'unknown';

  try {
    await db.execute(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  } catch (err: any) {
    console.warn('[Database] Failed to set PRAGMA busy_timeout:', err?.message || err);
  }
  try {
    const jmRes = await db.execute('PRAGMA journal_mode = WAL');
    const rawJm = extractFirstPragmaValue(jmRes);
    if (rawJm !== undefined && rawJm !== null) {
      journalMode = String(rawJm).trim().toLowerCase();
    }
  } catch (err: any) {
    console.warn('[Database] Failed to enable PRAGMA journal_mode = WAL:', err?.message || err);
  }
  try {
    await db.execute('PRAGMA synchronous = NORMAL');
    const syncRes = await db.execute('PRAGMA synchronous');
    const rawSync = extractFirstPragmaValue(syncRes);
    if (rawSync !== undefined && rawSync !== null) {
      synchronousMode = String(rawSync).trim().toLowerCase();
    }
  } catch (err: any) {
    console.warn('[Database] Failed to set PRAGMA synchronous = NORMAL:', err?.message || err);
  }
  try {
    await db.execute('PRAGMA secure_delete = ON');
  } catch (err: any) {
    console.warn('[Database] Failed to set PRAGMA secure_delete = ON:', err?.message || err);
  }

  const verified = await getSqliteRuntimePragmas();
  return {
    journalMode: verified.journalMode !== 'unknown' ? verified.journalMode : journalMode,
    busyTimeoutMs: verified.busyTimeoutMs || busyTimeoutMs,
    synchronousMode,
    walEnabled: verified.walEnabled,
  };
}

export async function checkpointSqliteWal(): Promise<void> {
  if (isTurso) return;
  try {
    await db.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {}
}

// 3. Database initialization & seedings
export async function initDatabase() {
  console.log(`[Database] Initializing ${dbType}...`);

  if (!isTurso) {
    const pragmaState = await configureLocalSqlitePragmas();
    if (!pragmaState.walEnabled || pragmaState.busyTimeoutMs < SQLITE_BUSY_TIMEOUT_MS) {
      console.warn(
        `[Database] SQLite pragma warning: journal_mode=${pragmaState.journalMode}, busy_timeout=${pragmaState.busyTimeoutMs}ms`
      );
    }
  }

  // Initialize Tables
  await db.exec(`
    -- 1. Full Chat Messages Storage Table (Every single message preserved forever)
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      sender_name TEXT,
      sender_id TEXT,
      text TEXT NOT NULL,
      translated_text TEXT,
      is_audio INTEGER DEFAULT 0,
      audio_duration INTEGER DEFAULT 0,
      audio_url TEXT,
      stt_text TEXT,
      voice_tone TEXT,
      is_image INTEGER DEFAULT 0,
      image_url TEXT,
      image_caption TEXT,
      is_video INTEGER DEFAULT 0,
      video_url TEXT,
      video_duration INTEGER DEFAULT 0,
      is_file INTEGER DEFAULT 0,
      file_name TEXT,
      file_size TEXT,
      file_url TEXT,
      timestamp TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      delivery_status TEXT DEFAULT 'delivered',
      telegram_message_id INTEGER,
      reply_to_json TEXT,
      is_edited INTEGER DEFAULT 0,
      is_pinned INTEGER DEFAULT 0,
      forward_from TEXT,
      reactions_json TEXT,
      system_event_type TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages (chat_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_account ON messages (account_id);

    -- 2. Customer Holographic Profile & Long-Term Memory
    CREATE TABLE IF NOT EXISTS customer_profiles (
      chat_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      client_name TEXT NOT NULL,
      relationship_stage TEXT DEFAULT '初次接触',
      age_estimate TEXT DEFAULT '-',
      occupation TEXT DEFAULT '',
      location_timezone TEXT DEFAULT 'UTC+8',
      tone_style TEXT DEFAULT '',
      likes_interests TEXT DEFAULT '[]',
      dislikes_taboos TEXT DEFAULT '[]',
      emotional_needs TEXT DEFAULT '',
      key_memories TEXT DEFAULT '[]',
      total_messages_count INTEGER DEFAULT 0,
      last_analyzed_at INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL,
      family_marital_status TEXT DEFAULT '',
      active_schedule TEXT DEFAULT '',
      financial_profile TEXT DEFAULT '',
      investment_attitude TEXT DEFAULT '',
      trust_level TEXT DEFAULT '',
      next_step_strategy TEXT DEFAULT ''
    );

    -- 2.1 Account-Isolated Customer Holographic Profile (Composite PK: account_id + chat_id)
    CREATE TABLE IF NOT EXISTS account_customer_profiles (
      account_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      client_name TEXT NOT NULL,
      relationship_stage TEXT DEFAULT '初次接触',
      age_estimate TEXT DEFAULT '-',
      occupation TEXT DEFAULT '',
      location_timezone TEXT DEFAULT 'UTC+8',
      tone_style TEXT DEFAULT '',
      likes_interests TEXT DEFAULT '[]',
      dislikes_taboos TEXT DEFAULT '[]',
      emotional_needs TEXT DEFAULT '',
      key_memories TEXT DEFAULT '[]',
      total_messages_count INTEGER DEFAULT 0,
      last_analyzed_at INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL,
      family_marital_status TEXT DEFAULT '',
      active_schedule TEXT DEFAULT '',
      financial_profile TEXT DEFAULT '',
      investment_attitude TEXT DEFAULT '',
      trust_level TEXT DEFAULT '',
      next_step_strategy TEXT DEFAULT '',
      PRIMARY KEY (account_id, chat_id)
    );

    -- 0. App Registered Membership Users Table (Server-side storage)
    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );

    -- 3. System Configuration & Database Metrics
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- 3.1 Telegram Real User Sessions (MTProto / GramJS)
    CREATE TABLE IF NOT EXISTS telegram_user_sessions (
      phone TEXT PRIMARY KEY,
      session_string TEXT NOT NULL,
      user_id TEXT,
      username TEXT,
      first_name TEXT,
      api_id INTEGER DEFAULT NULL,
      api_hash TEXT DEFAULT NULL,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- 4. AI Training Knowledge Base
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id TEXT PRIMARY KEY,
      account_id TEXT DEFAULT 'global',
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      keywords TEXT,
      source_type TEXT NOT NULL,
      source_file TEXT,
      is_active INTEGER DEFAULT 1,
      hit_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_base (category);
    CREATE INDEX IF NOT EXISTS idx_knowledge_active ON knowledge_base (is_active);

    -- 5. AI Training & Evolution History Logs
    CREATE TABLE IF NOT EXISTS training_logs (
      id TEXT PRIMARY KEY,
      account_id TEXT DEFAULT 'global',
      log_type TEXT NOT NULL,
      details TEXT NOT NULL,
      items_learned INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- 6. Full Chat Dialogue Corpus
    CREATE TABLE IF NOT EXISTS chat_transcripts (
      id TEXT PRIMARY KEY,
      account_id TEXT DEFAULT 'global',
      title TEXT NOT NULL,
      description TEXT,
      dialogue_text TEXT NOT NULL,
      learned_style TEXT,
      round_count INTEGER DEFAULT 0,
      character_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      source_chat_id TEXT,
      content_hash TEXT,
      last_message_created_at INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- 7. Per-chat Persistent Language Preferences
    CREATE TABLE IF NOT EXISTS chat_language_prefs (
      account_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      source_lang TEXT NOT NULL DEFAULT 'Auto',
      target_lang TEXT NOT NULL DEFAULT 'Auto',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, chat_id)
    );
  `);

  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN delivery_status TEXT DEFAULT 'delivered'`);
  } catch {
    // Column already exists
  }

  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN is_video INTEGER DEFAULT 0`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN video_url TEXT`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN video_duration INTEGER DEFAULT 0`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN telegram_message_id INTEGER`);
  } catch {}

  try {
    await db.exec(`ALTER TABLE customer_profiles ADD COLUMN account_id TEXT DEFAULT 'acc_1'`);
  } catch {
    // Column already exists
  }

  for (const colDef of [
    "family_marital_status TEXT DEFAULT ''",
    "active_schedule TEXT DEFAULT ''",
    "financial_profile TEXT DEFAULT ''",
    "investment_attitude TEXT DEFAULT ''",
    "trust_level TEXT DEFAULT ''",
    "next_step_strategy TEXT DEFAULT ''",
  ]) {
    try {
      await db.exec(`ALTER TABLE customer_profiles ADD COLUMN ${colDef}`);
    } catch {}
    try {
      await db.exec(`ALTER TABLE account_customer_profiles ADD COLUMN ${colDef}`);
    } catch {}
  }

  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN reply_to_json TEXT`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN is_edited INTEGER DEFAULT 0`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN is_pinned INTEGER DEFAULT 0`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN forward_from TEXT`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN is_file INTEGER DEFAULT 0`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN file_name TEXT`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN file_size TEXT`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN file_url TEXT`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN reactions_json TEXT`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN sender_id TEXT`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE messages ADD COLUMN system_event_type TEXT DEFAULT ''`);
  } catch {}

  try {
    await db.exec(`ALTER TABLE knowledge_base ADD COLUMN account_id TEXT DEFAULT 'global'`);
  } catch {}
  try {
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_account ON knowledge_base (account_id)`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE chat_transcripts ADD COLUMN account_id TEXT DEFAULT 'global'`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE chat_transcripts ADD COLUMN source_chat_id TEXT`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE chat_transcripts ADD COLUMN content_hash TEXT`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE chat_transcripts ADD COLUMN last_message_created_at INTEGER DEFAULT 0`);
  } catch {}
  try {
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_account ON chat_transcripts (account_id)`);
  } catch {}
  try {
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_hash ON chat_transcripts (account_id, content_hash)`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE training_logs ADD COLUMN account_id TEXT DEFAULT 'global'`);
  } catch {}
  try {
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_training_logs_account ON training_logs (account_id)`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE chat_language_prefs ADD COLUMN translation_enabled INTEGER`);
  } catch {}

  // Ensure telegram_user_sessions exists and has api_id/api_hash columns
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS telegram_user_sessions (
        phone TEXT PRIMARY KEY,
        session_string TEXT NOT NULL,
        user_id TEXT,
        username TEXT,
        first_name TEXT,
        api_id INTEGER DEFAULT NULL,
        api_hash TEXT DEFAULT NULL,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  } catch (err: any) {
    console.warn('[Database] telegram_user_sessions migration check:', err.message);
  }

  try {
    await db.exec(`ALTER TABLE telegram_user_sessions ADD COLUMN api_id INTEGER DEFAULT NULL`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE telegram_user_sessions ADD COLUMN api_hash TEXT DEFAULT NULL`);
  } catch {}
  try {
    await db.exec(`ALTER TABLE telegram_user_sessions ADD COLUMN expired_reason TEXT DEFAULT NULL`);
  } catch {}

  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS revoked_jwt_tokens (
        token_hash TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      )
    `);
  } catch (err: any) {
    console.warn('[Database] revoked_jwt_tokens table init check:', err.message);
  }

  // Ensure initial global persona and evolution engine configs exist in system_config (clean blank initial state)
  try {
    const existingPersona = (await db.prepare("SELECT value FROM system_config WHERE key = 'global_persona_config'").get()) as any;
    if (!existingPersona) {
      await db.prepare("INSERT INTO system_config (key, value, updated_at) VALUES ('global_persona_config', ?, ?)").run(
        JSON.stringify(DEFAULT_GLOBAL_PERSONA),
        Date.now()
      );
    }
    const existingEvolution = (await db.prepare("SELECT value FROM system_config WHERE key = 'evolution_engine_state'").get()) as any;
    if (!existingEvolution) {
      await db.prepare("INSERT INTO system_config (key, value, updated_at) VALUES ('evolution_engine_state', ?, ?)").run(
        JSON.stringify(DEFAULT_EVOLUTION_STATE),
        Date.now()
      );
    }
  } catch (err: any) {
    console.warn('[Database] System config persona init check:', err.message);
  }

  console.log(`[Database] ${dbType} ready. URL: ${db.tursoUrl}`);
}

export const DEFAULT_GLOBAL_PERSONA = {
  personaName: '',
  personaRole: '',
  age: '',
  location: '',
  personalityTraits: [] as string[],
  lifeStyleDetails: '',
  investmentPhilosophy: '',
  stagedPrompts: {
    icebreaker: '',
    dailyFriend: '',
    emotionalLove: '',
    wealthDiscussion: '',
    trustDefense: '',
  },
  tabooKeywords: [] as string[],
  customSystemInstruction: '',
  activeStage: 'icebreaker',
};

// Optional reference template ONLY loaded when the user explicitly clicks the import template button
export const PERSONA_TEMPLATE_PRESET = {
  personaName: '顾问助手模板',
  personaRole: '商务沟通与客户服务顾问',
  age: '28岁',
  location: '新加坡 / 远程协同',
  personalityTraits: ['真诚随和', '情绪稳定', '条理清晰', '换位思考'],
  lifeStyleDetails: '作息规律，关注行业动态与跨文化交流，沟通风格温暖自然、尊重对方节奏。',
  investmentPhilosophy: '注重长期信任积累与风险边界管理，结合客户真实需求提供客观建议。',
  stagedPrompts: {
    icebreaker: '【阶段1：初识破冰】\n- 目标：礼貌自然建立初步好感，避免过度推销。\n- 原则：简短真诚问候，根据对方公开话题或问候自然回应（1-2句）。',
    dailyFriend: '【阶段2：日常互动】\n- 目标：倾听对方日常与诉求，提供稳定情绪价值与清晰回应。\n- 原则：保持朋友般的自然沟通氛围，不催促、不施加压力。',
    emotionalLove: '【阶段3：深度陪伴与信任升温】\n- 目标：强化专属陪伴感与共情理解，记住双方过往真实约定。\n- 原则：温和体贴地呼应对方情绪变化与实际关切。',
    wealthDiscussion: '【阶段4：专业价值与方案探讨】\n- 目标：在对方主动询问或话题自然衔接时，客观介绍专业观点。\n- 原则：以客户风险承受能力与真实目标为前提，绝不夸大承诺。',
    trustDefense: '【阶段5：疑虑化解】\n- 目标：面对客户谨慎或顾虑时，保持坦诚从容。\n- 原则：肯定对方的审慎态度，不急于辩解，尊重对方节奏。',
  },
  tabooKeywords: ['包赚不赔', '稳赚', '马上转账', '内部消息', '绝对保证'],
  customSystemInstruction: '使用自然口语化的手机私聊短句回复，避免生硬的机械客服套话与分点列项。',
  activeStage: 'icebreaker',
};

export const DEFAULT_EVOLUTION_STATE = {
  version: 'v1.0.0',
  lastEvolvedAt: 0,
  lastLearnedMessageCreatedAt: 0,
  learnedCorpusHashes: [] as string[],
  totalConversationsAnalyzed: 0,
  totalHabitsLearned: 0,
  autoEvolutionActive: true,
  habits: [] as any[],
};

export function resolvePersonaConfigKey(accountId?: string): string {
  const clean = typeof accountId === 'string' ? accountId.trim() : '';
  if (!clean || clean === 'global') return 'global_persona_config';
  return `global_persona_config::${clean}`;
}

export function resolveEvolutionConfigKey(accountId?: string): string {
  const clean = typeof accountId === 'string' ? accountId.trim() : '';
  if (!clean || clean === 'global') return 'evolution_engine_state';
  return `evolution_engine_state::${clean}`;
}

export async function getGlobalPersonaFromDb(accountId?: string): Promise<any> {
  const configKey = resolvePersonaConfigKey(accountId);
  try {
    const row = (await db.prepare('SELECT value FROM system_config WHERE key = ?').get(configKey)) as any;
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      return {
        ...DEFAULT_GLOBAL_PERSONA,
        ...parsed,
        stagedPrompts: {
          ...DEFAULT_GLOBAL_PERSONA.stagedPrompts,
          ...(parsed?.stagedPrompts || {}),
        },
      };
    }
  } catch (err: any) {
    console.warn('[Database] getGlobalPersonaFromDb error:', err.message);
  }
  return {
    ...DEFAULT_GLOBAL_PERSONA,
    stagedPrompts: { ...DEFAULT_GLOBAL_PERSONA.stagedPrompts },
  };
}

export async function saveGlobalPersonaToDb(persona: any, accountId?: string): Promise<boolean> {
  const configKey = resolvePersonaConfigKey(accountId);
  try {
    const valueStr = JSON.stringify(persona);
    await db.prepare(`
      INSERT INTO system_config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(configKey, valueStr, Date.now());
    return true;
  } catch (err: any) {
    console.error('[Database] saveGlobalPersonaToDb error:', err.message);
    return false;
  }
}

export async function resetGlobalPersonaInDb(accountId?: string): Promise<any> {
  const blankPersona = {
    ...DEFAULT_GLOBAL_PERSONA,
    stagedPrompts: { ...DEFAULT_GLOBAL_PERSONA.stagedPrompts },
    personalityTraits: [],
    tabooKeywords: [],
  };
  try {
    await saveGlobalPersonaToDb(blankPersona, accountId);
    return blankPersona;
  } catch (err: any) {
    console.error('[Database] resetGlobalPersonaInDb error:', err.message);
    return blankPersona;
  }
}

export async function getEvolutionStateFromDb(accountId?: string): Promise<any> {
  const configKey = resolveEvolutionConfigKey(accountId);
  try {
    const row = (await db.prepare('SELECT value FROM system_config WHERE key = ?').get(configKey)) as any;
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      return {
        ...DEFAULT_EVOLUTION_STATE,
        ...parsed,
        habits: Array.isArray(parsed?.habits) ? parsed.habits : [],
      };
    }
  } catch (err: any) {
    console.warn('[Database] getEvolutionStateFromDb error:', err.message);
  }
  return { ...DEFAULT_EVOLUTION_STATE, habits: [] };
}

export async function saveEvolutionStateToDb(state: any, accountId?: string): Promise<boolean> {
  const configKey = resolveEvolutionConfigKey(accountId);
  try {
    const valueStr = JSON.stringify(state);
    await db.prepare(`
      INSERT INTO system_config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(configKey, valueStr, Date.now());
    return true;
  } catch (err: any) {
    console.error('[Database] saveEvolutionStateToDb error:', err.message);
    return false;
  }
}

export const snapshotFilePath = path.join(dbDir, 'telegram_pro_snapshot.json');

export const ENCRYPTED_BACKUP_FORMAT = 'humansense_encrypted_backup_v1' as const;
export const ENCRYPTED_BACKUP_VERSION = 'humansense_enc_v4' as const;
export const ENCRYPTED_BACKUP_TYPE = 'HumanSense_Encrypted_Desktop_Backup' as const;
export const ENCRYPTED_BACKUP_AAD = 'HumanSense_Encrypted_Desktop_Backup:v4' as const;
export const DISK_SNAPSHOT_FORMAT = 'humansense_disk_snapshot_v1' as const;
export const DISK_SNAPSHOT_AAD = 'HumanSense_Disk_Snapshot:v1' as const;
export const BACKUP_KDF_ITERATIONS = 210_000;
export const BACKUP_MIN_PASSPHRASE_LENGTH = 8;
export const BACKUP_MAX_ROWS_PER_TABLE = 100_000;
export const BACKUP_MAX_TOTAL_ROWS = 250_000;
export const BACKUP_MAX_TEXT_LENGTH = 2_000_000;

export class SnapshotValidationError extends Error {
  code = 'INVALID_SNAPSHOT_SCHEMA';
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotValidationError';
  }
}

export interface EncryptedBackupEnvelope {
  format: typeof ENCRYPTED_BACKUP_FORMAT;
  type: typeof ENCRYPTED_BACKUP_TYPE;
  version: typeof ENCRYPTED_BACKUP_VERSION;
  exportedAt: string;
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: string;
  };
  cipher: {
    name: 'AES-GCM';
    iv: string;
    aad: typeof ENCRYPTED_BACKUP_AAD;
  };
  ciphertext: string;
  hmac: string;
}

export interface SealedDiskSnapshotEnvelope {
  format: typeof DISK_SNAPSHOT_FORMAT;
  version: string;
  exportedAt: string;
  cipher: {
    name: 'AES-GCM';
    iv: string;
    aad: typeof DISK_SNAPSHOT_AAD;
  };
  ciphertext: string;
  hmac: string;
}

function getOrCreateLocalDeviceSecretForSnapshot(): string {
  const secretPath = path.join(dbDir, '.device_secret');
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
    const created = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretPath, created, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(secretPath, 0o600);
    } catch {}
    return created;
  } catch {
    return crypto.createHash('sha256').update(dbPath).digest('hex');
  }
}

function getDiskSnapshotKeys(): { aesKey: Buffer; hmacKey: Buffer } {
  const secret = getOrCreateLocalDeviceSecretForSnapshot();
  const aesKey = crypto.createHmac('sha256', secret).update('humansense-disk-snapshot-aes-v1').digest();
  const hmacKey = crypto.createHmac('sha256', secret).update('humansense-disk-snapshot-hmac-v1').digest();
  return { aesKey, hmacKey };
}

function buildBackupCanonicalHmacInput(envelope: Omit<EncryptedBackupEnvelope, 'hmac'>): string {
  return [
    envelope.format,
    envelope.version,
    envelope.exportedAt,
    envelope.kdf.name,
    envelope.kdf.hash,
    String(envelope.kdf.iterations),
    envelope.kdf.salt,
    envelope.cipher.name,
    envelope.cipher.iv,
    envelope.cipher.aad,
    envelope.ciphertext,
  ].join('|');
}

function buildDiskCanonicalHmacInput(envelope: Omit<SealedDiskSnapshotEnvelope, 'hmac'>): string {
  return [
    envelope.format,
    envelope.version,
    envelope.exportedAt,
    envelope.cipher.name,
    envelope.cipher.iv,
    envelope.cipher.aad,
    envelope.ciphertext,
  ].join('|');
}

export function isEncryptedBackupEnvelope(obj: any): obj is EncryptedBackupEnvelope {
  return Boolean(
    obj &&
      typeof obj === 'object' &&
      obj.format === ENCRYPTED_BACKUP_FORMAT &&
      obj.kdf &&
      typeof obj.kdf === 'object' &&
      obj.cipher &&
      typeof obj.cipher === 'object' &&
      typeof obj.ciphertext === 'string' &&
      typeof obj.hmac === 'string'
  );
}

export function isDiskSnapshotEnvelope(obj: any): obj is SealedDiskSnapshotEnvelope {
  return Boolean(
    obj &&
      typeof obj === 'object' &&
      obj.format === DISK_SNAPSHOT_FORMAT &&
      obj.cipher &&
      typeof obj.cipher === 'object' &&
      typeof obj.ciphertext === 'string' &&
      typeof obj.hmac === 'string'
  );
}

export function encryptBackupEnvelope(payload: unknown, passphrase: string): EncryptedBackupEnvelope {
  if (typeof passphrase !== 'string' || passphrase.length < BACKUP_MIN_PASSPHRASE_LENGTH) {
    throw new SnapshotValidationError(`备份加密口令至少需要 ${BACKUP_MIN_PASSPHRASE_LENGTH} 个字符`);
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const exportedAt = new Date().toISOString();
  const derived = crypto.pbkdf2Sync(
    Buffer.from(passphrase, 'utf8'),
    salt,
    BACKUP_KDF_ITERATIONS,
    64,
    'sha256'
  );
  const aesKey = derived.subarray(0, 32);
  const hmacKey = derived.subarray(32, 64);

  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  cipher.setAAD(Buffer.from(ENCRYPTED_BACKUP_AAD, 'utf8'));
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const unsignedEnvelope: Omit<EncryptedBackupEnvelope, 'hmac'> = {
    format: ENCRYPTED_BACKUP_FORMAT,
    type: ENCRYPTED_BACKUP_TYPE,
    version: ENCRYPTED_BACKUP_VERSION,
    exportedAt,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: BACKUP_KDF_ITERATIONS,
      salt: salt.toString('base64'),
    },
    cipher: {
      name: 'AES-GCM',
      iv: iv.toString('base64'),
      aad: ENCRYPTED_BACKUP_AAD,
    },
    ciphertext: encrypted.toString('base64'),
  };

  const hmac = crypto
    .createHmac('sha256', hmacKey)
    .update(buildBackupCanonicalHmacInput(unsignedEnvelope), 'utf8')
    .digest('base64');

  return { ...unsignedEnvelope, hmac };
}

export function decryptBackupEnvelope<T = any>(envelope: unknown, passphrase: string): T {
  if (!isEncryptedBackupEnvelope(envelope)) {
    throw new SnapshotValidationError('无效的加密备份文件格式');
  }
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new SnapshotValidationError('请输入备份解密口令');
  }
  if (
    envelope.kdf.name !== 'PBKDF2' ||
    envelope.kdf.hash !== 'SHA-256' ||
    !Number.isInteger(envelope.kdf.iterations) ||
    envelope.kdf.iterations < 100_000 ||
    envelope.kdf.iterations > 2_000_000 ||
    envelope.cipher.name !== 'AES-GCM' ||
    envelope.cipher.aad !== ENCRYPTED_BACKUP_AAD
  ) {
    throw new SnapshotValidationError('不支持或已被篡改的备份加密参数');
  }

  const salt = Buffer.from(envelope.kdf.salt, 'base64');
  const iv = Buffer.from(envelope.cipher.iv, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const providedHmac = Buffer.from(envelope.hmac, 'base64');

  if (salt.length < 16 || iv.length !== 12 || ciphertext.length <= 16 || providedHmac.length !== 32) {
    throw new SnapshotValidationError('加密备份字段长度非法');
  }

  const derived = crypto.pbkdf2Sync(
    Buffer.from(passphrase, 'utf8'),
    salt,
    envelope.kdf.iterations,
    64,
    'sha256'
  );
  const aesKey = derived.subarray(0, 32);
  const hmacKey = derived.subarray(32, 64);

  const expectedHmac = crypto
    .createHmac('sha256', hmacKey)
    .update(buildBackupCanonicalHmacInput(envelope), 'utf8')
    .digest();

  if (providedHmac.length !== expectedHmac.length || !crypto.timingSafeEqual(providedHmac, expectedHmac)) {
    throw new SnapshotValidationError('备份完整性校验失败：口令错误或备份文件已被篡改');
  }

  try {
    const authTag = ciphertext.subarray(ciphertext.length - 16);
    const encData = ciphertext.subarray(0, ciphertext.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAAD(Buffer.from(envelope.cipher.aad, 'utf8'));
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encData), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted) as T;
  } catch {
    throw new SnapshotValidationError('备份解密失败：口令错误或密文已损坏');
  }
}

export function sealDiskSnapshot(snapshot: any): SealedDiskSnapshotEnvelope {
  const { aesKey, hmacKey } = getDiskSnapshotKeys();
  const iv = crypto.randomBytes(12);
  const exportedAt = String(snapshot?.exportedAt || new Date().toISOString());
  const version = String(snapshot?.version || '1.3');
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  cipher.setAAD(Buffer.from(DISK_SNAPSHOT_AAD, 'utf8'));
  const plaintext = Buffer.from(JSON.stringify(snapshot), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const unsignedEnvelope: Omit<SealedDiskSnapshotEnvelope, 'hmac'> = {
    format: DISK_SNAPSHOT_FORMAT,
    version,
    exportedAt,
    cipher: {
      name: 'AES-GCM',
      iv: iv.toString('base64'),
      aad: DISK_SNAPSHOT_AAD,
    },
    ciphertext: encrypted.toString('base64'),
  };

  const hmac = crypto
    .createHmac('sha256', hmacKey)
    .update(buildDiskCanonicalHmacInput(unsignedEnvelope), 'utf8')
    .digest('base64');

  return { ...unsignedEnvelope, hmac };
}

export function unsealDiskSnapshot(envelope: unknown): any {
  if (!isDiskSnapshotEnvelope(envelope)) {
    throw new SnapshotValidationError('无效的磁盘加密快照格式');
  }
  if (envelope.cipher.name !== 'AES-GCM' || envelope.cipher.aad !== DISK_SNAPSHOT_AAD) {
    throw new SnapshotValidationError('不支持或已被篡改的磁盘快照加密参数');
  }

  const iv = Buffer.from(envelope.cipher.iv, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const providedHmac = Buffer.from(envelope.hmac, 'base64');
  if (iv.length !== 12 || ciphertext.length <= 16 || providedHmac.length !== 32) {
    throw new SnapshotValidationError('磁盘加密快照字段长度非法');
  }

  const { aesKey, hmacKey } = getDiskSnapshotKeys();
  const expectedHmac = crypto
    .createHmac('sha256', hmacKey)
    .update(buildDiskCanonicalHmacInput(envelope), 'utf8')
    .digest();

  if (providedHmac.length !== expectedHmac.length || !crypto.timingSafeEqual(providedHmac, expectedHmac)) {
    throw new SnapshotValidationError('磁盘快照完整性校验失败：文件已被篡改或密钥不匹配');
  }

  try {
    const authTag = ciphertext.subarray(ciphertext.length - 16);
    const encData = ciphertext.subarray(0, ciphertext.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAAD(Buffer.from(envelope.cipher.aad, 'utf8'));
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encData), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted);
  } catch {
    throw new SnapshotValidationError('磁盘快照解密失败：密文损坏或设备密钥不匹配');
  }
}

function writeSealedDiskSnapshotFile(snapshot: any): void {
  const sealed = sealDiskSnapshot(snapshot);
  fs.writeFileSync(snapshotFilePath, JSON.stringify(sealed, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(snapshotFilePath, 0o600);
  } catch {}
}

const ALLOWED_SNAPSHOT_TABLES = new Set([
  'messages',
  'customer_profiles',
  'account_customer_profiles',
  'knowledge_base',
  'chat_transcripts',
  'system_config',
  'chat_language_prefs',
  'media_materials',
  'persona_schedule_vault',
  'training_logs',
  'telegram_user_sessions',
]);

function isPlainObject(val: unknown): val is Record<string, any> {
  return Boolean(val && typeof val === 'object' && !Array.isArray(val));
}

function assertRequiredNonEmptyString(
  val: unknown,
  fieldLabel: string,
  maxLen = 512
): string {
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw new SnapshotValidationError(`快照校验失败：字段 ${fieldLabel} 必须是非空字符串`);
  }
  if (val.length > maxLen) {
    throw new SnapshotValidationError(`快照校验失败：字段 ${fieldLabel} 长度超过上限 (${maxLen})`);
  }
  return val;
}

function assertStringField(
  val: unknown,
  fieldLabel: string,
  defaultVal = '',
  maxLen = BACKUP_MAX_TEXT_LENGTH
): string {
  if (val === undefined || val === null) return defaultVal;
  if (typeof val !== 'string') {
    throw new SnapshotValidationError(`快照校验失败：字段 ${fieldLabel} 必须是字符串`);
  }
  if (val.length > maxLen) {
    throw new SnapshotValidationError(`快照校验失败：字段 ${fieldLabel} 长度超过上限 (${maxLen})`);
  }
  return val;
}

function assertNonNegFiniteNumber(
  val: unknown,
  fieldLabel: string,
  required = false,
  defaultVal = 0
): number {
  if (val === undefined || val === null) {
    if (required) {
      throw new SnapshotValidationError(`快照校验失败：字段 ${fieldLabel} 缺失或非有效数字`);
    }
    return defaultVal;
  }
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num) || num < 0) {
    throw new SnapshotValidationError(`快照校验失败：字段 ${fieldLabel} 必须是非负有限数字`);
  }
  return num;
}

function assertFlagInt(val: unknown, fieldLabel: string, defaultVal = 0): number {
  if (val === undefined || val === null) return defaultVal;
  if (typeof val === 'boolean') return val ? 1 : 0;
  const num = Number(val);
  if (!Number.isInteger(num) || (num !== 0 && num !== 1)) {
    throw new SnapshotValidationError(`快照校验失败：字段 ${fieldLabel} 必须是 0 或 1`);
  }
  return num;
}

export function validateDatabaseSnapshot(snapshot: any): { skippedUserSessions: number; totalRows: number } {
  if (!isPlainObject(snapshot) || !isPlainObject(snapshot.tables)) {
    throw new SnapshotValidationError('无效的数据快照格式：缺少合法的 tables 对象');
  }

  const tables = snapshot.tables;
  let totalRows = 0;
  let skippedUserSessions = 0;

  for (const [tableName, rows] of Object.entries(tables)) {
    if (!ALLOWED_SNAPSHOT_TABLES.has(tableName)) {
      throw new SnapshotValidationError(`快照校验失败：包含未授权或不支持的数据表 "${tableName}"`);
    }
    if (!Array.isArray(rows)) {
      throw new SnapshotValidationError(`快照校验失败：表 "${tableName}" 必须是数组`);
    }
    if (rows.length > BACKUP_MAX_ROWS_PER_TABLE) {
      throw new SnapshotValidationError(
        `快照校验失败：表 "${tableName}" 行数 (${rows.length}) 超过单表上限 (${BACKUP_MAX_ROWS_PER_TABLE})`
      );
    }
    totalRows += rows.length;
    if (totalRows > BACKUP_MAX_TOTAL_ROWS) {
      throw new SnapshotValidationError(
        `快照校验失败：总行数 (${totalRows}) 超过恢复上限 (${BACKUP_MAX_TOTAL_ROWS})`
      );
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!isPlainObject(row)) {
        throw new SnapshotValidationError(`快照校验失败：${tableName}[${i}] 必须是 JSON 对象`);
      }

      if (tableName === 'messages') {
        assertRequiredNonEmptyString(row.id, `messages[${i}].id`, 256);
        assertRequiredNonEmptyString(row.chat_id, `messages[${i}].chat_id`, 256);
        assertRequiredNonEmptyString(row.account_id, `messages[${i}].account_id`, 256);
        const sender = assertRequiredNonEmptyString(row.sender, `messages[${i}].sender`, 32);
        if (sender !== 'me' && sender !== 'peer' && sender !== 'system') {
          throw new SnapshotValidationError(`快照校验失败：messages[${i}].sender 仅允许 me/peer/system`);
        }
        assertStringField(row.text, `messages[${i}].text`);
        assertStringField(row.sender_name, `messages[${i}].sender_name`, '', 512);
        assertStringField(row.sender_id, `messages[${i}].sender_id`, '', 256);
        assertStringField(row.translated_text, `messages[${i}].translated_text`);
        assertFlagInt(row.is_audio, `messages[${i}].is_audio`, 0);
        assertNonNegFiniteNumber(row.audio_duration, `messages[${i}].audio_duration`, false, 0);
        assertStringField(row.audio_url, `messages[${i}].audio_url`);
        assertStringField(row.stt_text, `messages[${i}].stt_text`);
        assertStringField(row.voice_tone, `messages[${i}].voice_tone`, '', 256);
        assertFlagInt(row.is_image, `messages[${i}].is_image`, 0);
        assertStringField(row.image_url, `messages[${i}].image_url`);
        assertStringField(row.image_caption, `messages[${i}].image_caption`);
        assertFlagInt(row.is_video, `messages[${i}].is_video`, 0);
        assertStringField(row.video_url, `messages[${i}].video_url`);
        assertNonNegFiniteNumber(row.video_duration, `messages[${i}].video_duration`, false, 0);
        assertFlagInt(row.is_file, `messages[${i}].is_file`, 0);
        assertStringField(row.file_name, `messages[${i}].file_name`, '', 1024);
        assertStringField(row.file_size, `messages[${i}].file_size`, '', 128);
        assertStringField(row.file_url, `messages[${i}].file_url`);
        assertRequiredNonEmptyString(row.timestamp, `messages[${i}].timestamp`, 128);
        assertNonNegFiniteNumber(row.created_at, `messages[${i}].created_at`, true);
        assertFlagInt(row.is_edited, `messages[${i}].is_edited`, 0);
        assertFlagInt(row.is_pinned, `messages[${i}].is_pinned`, 0);
        assertStringField(row.system_event_type, `messages[${i}].system_event_type`, '', 64);
      } else if (tableName === 'customer_profiles') {
        assertRequiredNonEmptyString(row.chat_id, `customer_profiles[${i}].chat_id`, 256);
        assertStringField(row.account_id, `customer_profiles[${i}].account_id`, 'acc_1', 256);
        assertStringField(row.client_name, `customer_profiles[${i}].client_name`, '', 512);
        assertStringField(row.family_marital_status, `customer_profiles[${i}].family_marital_status`, '', 1024);
        assertStringField(row.active_schedule, `customer_profiles[${i}].active_schedule`, '', 1024);
        assertStringField(row.financial_profile, `customer_profiles[${i}].financial_profile`, '');
        assertStringField(row.investment_attitude, `customer_profiles[${i}].investment_attitude`, '');
        assertStringField(row.trust_level, `customer_profiles[${i}].trust_level`, '', 512);
        assertStringField(row.next_step_strategy, `customer_profiles[${i}].next_step_strategy`, '');
        assertNonNegFiniteNumber(row.total_messages_count, `customer_profiles[${i}].total_messages_count`, false, 0);
        assertNonNegFiniteNumber(row.last_analyzed_at, `customer_profiles[${i}].last_analyzed_at`, false, 0);
        assertNonNegFiniteNumber(row.updated_at, `customer_profiles[${i}].updated_at`, false, 0);
      } else if (tableName === 'account_customer_profiles') {
        assertRequiredNonEmptyString(row.account_id, `account_customer_profiles[${i}].account_id`, 256);
        assertRequiredNonEmptyString(row.chat_id, `account_customer_profiles[${i}].chat_id`, 256);
        assertStringField(row.client_name, `account_customer_profiles[${i}].client_name`, '', 512);
        assertStringField(row.family_marital_status, `account_customer_profiles[${i}].family_marital_status`, '', 1024);
        assertStringField(row.active_schedule, `account_customer_profiles[${i}].active_schedule`, '', 1024);
        assertStringField(row.financial_profile, `account_customer_profiles[${i}].financial_profile`, '');
        assertStringField(row.investment_attitude, `account_customer_profiles[${i}].investment_attitude`, '');
        assertStringField(row.trust_level, `account_customer_profiles[${i}].trust_level`, '', 512);
        assertStringField(row.next_step_strategy, `account_customer_profiles[${i}].next_step_strategy`, '');
        assertNonNegFiniteNumber(row.total_messages_count, `account_customer_profiles[${i}].total_messages_count`, false, 0);
        assertNonNegFiniteNumber(row.last_analyzed_at, `account_customer_profiles[${i}].last_analyzed_at`, false, 0);
        assertNonNegFiniteNumber(row.updated_at, `account_customer_profiles[${i}].updated_at`, false, 0);
      } else if (tableName === 'knowledge_base') {
        assertRequiredNonEmptyString(row.id, `knowledge_base[${i}].id`, 256);
        assertRequiredNonEmptyString(row.category, `knowledge_base[${i}].category`, 256);
        assertRequiredNonEmptyString(row.title, `knowledge_base[${i}].title`, 1024);
        assertStringField(row.content, `knowledge_base[${i}].content`);
        assertRequiredNonEmptyString(row.source_type, `knowledge_base[${i}].source_type`, 128);
        assertFlagInt(row.is_active, `knowledge_base[${i}].is_active`, 1);
        assertNonNegFiniteNumber(row.hit_count, `knowledge_base[${i}].hit_count`, false, 0);
        assertNonNegFiniteNumber(row.created_at, `knowledge_base[${i}].created_at`, false, 0);
        assertNonNegFiniteNumber(row.updated_at, `knowledge_base[${i}].updated_at`, false, 0);
      } else if (tableName === 'chat_transcripts') {
        assertRequiredNonEmptyString(row.id, `chat_transcripts[${i}].id`, 256);
        assertRequiredNonEmptyString(row.title, `chat_transcripts[${i}].title`, 1024);
        assertStringField(row.dialogue_text, `chat_transcripts[${i}].dialogue_text`);
        assertFlagInt(row.is_active, `chat_transcripts[${i}].is_active`, 1);
        assertNonNegFiniteNumber(row.round_count, `chat_transcripts[${i}].round_count`, false, 0);
        assertNonNegFiniteNumber(row.character_count, `chat_transcripts[${i}].character_count`, false, 0);
        assertNonNegFiniteNumber(row.created_at, `chat_transcripts[${i}].created_at`, false, 0);
        assertNonNegFiniteNumber(row.updated_at, `chat_transcripts[${i}].updated_at`, false, 0);
      } else if (tableName === 'system_config') {
        assertRequiredNonEmptyString(row.key, `system_config[${i}].key`, 256);
        if (typeof row.value !== 'string' || row.value.length > BACKUP_MAX_TEXT_LENGTH) {
          throw new SnapshotValidationError(`快照校验失败：system_config[${i}].value 必须是合法长度的字符串`);
        }
        assertNonNegFiniteNumber(row.updated_at, `system_config[${i}].updated_at`, false, 0);
      } else if (tableName === 'chat_language_prefs') {
        assertRequiredNonEmptyString(row.chat_id, `chat_language_prefs[${i}].chat_id`, 256);
        assertStringField(row.account_id, `chat_language_prefs[${i}].account_id`, 'acc_1', 256);
        assertStringField(row.source_lang, `chat_language_prefs[${i}].source_lang`, 'Auto', 64);
        assertStringField(row.target_lang, `chat_language_prefs[${i}].target_lang`, 'Auto', 64);
        assertNonNegFiniteNumber(row.updated_at, `chat_language_prefs[${i}].updated_at`, false, 0);
        if (row.translation_enabled !== undefined && row.translation_enabled !== null && row.translation_enabled !== 0 && row.translation_enabled !== 1) {
          throw new SnapshotValidationError(`快照校验失败：chat_language_prefs[${i}].translation_enabled 必须为 null/0/1`);
        }
      } else if (tableName === 'media_materials') {
        assertRequiredNonEmptyString(row.id, `media_materials[${i}].id`, 256);
        assertRequiredNonEmptyString(row.category, `media_materials[${i}].category`, 256);
        assertRequiredNonEmptyString(row.title, `media_materials[${i}].title`, 512);
        assertRequiredNonEmptyString(row.image_url, `media_materials[${i}].image_url`, 4096);
      } else if (tableName === 'persona_schedule_vault') {
        assertRequiredNonEmptyString(row.id, `persona_schedule_vault[${i}].id`, 256);
        assertRequiredNonEmptyString(row.account_id, `persona_schedule_vault[${i}].account_id`, 256);
        assertRequiredNonEmptyString(row.persona_name, `persona_schedule_vault[${i}].persona_name`, 512);
      } else if (tableName === 'training_logs') {
        assertRequiredNonEmptyString(row.id, `training_logs[${i}].id`, 256);
        assertStringField(row.log_type, `training_logs[${i}].log_type`, 'manual', 128);
        assertStringField(row.details, `training_logs[${i}].details`, '');
        assertNonNegFiniteNumber(row.items_learned, `training_logs[${i}].items_learned`, false, 0);
        assertNonNegFiniteNumber(row.created_at, `training_logs[${i}].created_at`, false, 0);
      } else if (tableName === 'telegram_user_sessions') {
        skippedUserSessions++;
      }
    }
  }

  return { skippedUserSessions, totalRows };
}

// Export entire database contents into a portable JSON snapshot (Excludes sensitive telegram_user_sessions)
export async function exportDatabaseSnapshot() {
  const [
    messages,
    profiles,
    accountProfiles,
    knowledge,
    transcripts,
    config,
    chatLangPrefs,
    mediaMaterials,
    personaScheduleVault,
    trainingLogs,
  ] = await Promise.all([
    turso.execute('SELECT * FROM messages'),
    turso.execute('SELECT * FROM customer_profiles'),
    turso.execute('SELECT * FROM account_customer_profiles'),
    turso.execute('SELECT * FROM knowledge_base'),
    turso.execute('SELECT * FROM chat_transcripts'),
    turso.execute('SELECT * FROM system_config'),
    turso.execute('SELECT * FROM chat_language_prefs').catch(() => ({ rows: [] as any[] })),
    turso.execute('SELECT * FROM media_materials').catch(() => ({ rows: [] as any[] })),
    turso.execute('SELECT * FROM persona_schedule_vault').catch(() => ({ rows: [] as any[] })),
    turso.execute('SELECT * FROM training_logs').catch(() => ({ rows: [] as any[] })),
  ]);

  const safeConfigRows = (config.rows || [])
    .filter((row: any) => {
      const key = String(row?.key || '');
      return key !== 'telegram_api_credentials' && key !== 'custom_llm_config';
    })
    .map((row: any) => {
      const key = String(row?.key || '');
      if (
        (key === 'translation_settings' || key.startsWith('translation_settings::')) &&
        typeof row?.value === 'string'
      ) {
        try {
          const parsed = JSON.parse(row.value);
          if (parsed && typeof parsed === 'object') {
            const { geminiApiKey: _g, googleApiKey: _gk, ...safeSettings } = parsed;
            return { ...row, value: JSON.stringify(safeSettings) };
          }
        } catch {}
      }
      if (key === 'network_proxy' && typeof row?.value === 'string') {
        try {
          const parsed = JSON.parse(row.value);
          if (parsed && typeof parsed === 'object') {
            const { password: _pwd, ...safeProxy } = parsed;
            return { ...row, value: JSON.stringify(safeProxy) };
          }
        } catch {}
      }
      return row;
    });

  const snapshot = {
    version: '1.3',
    exportedAt: new Date().toISOString(),
    timestamp: Date.now(),
    persistenceTier,
    counts: {
      messages: messages.rows.length,
      profiles: profiles.rows.length,
      accountProfiles: accountProfiles.rows.length,
      knowledge: knowledge.rows.length,
      transcripts: transcripts.rows.length,
      chatLanguagePrefs: (chatLangPrefs?.rows || []).length,
      materials: (mediaMaterials?.rows || []).length,
      personas: (personaScheduleVault?.rows || []).length,
      trainingLogs: (trainingLogs?.rows || []).length,
      userSessions: 0, // Explicitly excluded for security: sessions must never be exported
    },
    tables: {
      messages: messages.rows,
      customer_profiles: profiles.rows,
      account_customer_profiles: accountProfiles.rows,
      knowledge_base: knowledge.rows,
      chat_transcripts: transcripts.rows,
      system_config: safeConfigRows,
      chat_language_prefs: chatLangPrefs?.rows || [],
      media_materials: mediaMaterials?.rows || [],
      persona_schedule_vault: personaScheduleVault?.rows || [],
      training_logs: trainingLogs?.rows || [],
      // telegram_user_sessions & sensitive credentials intentionally excluded to protect authentication credentials
    },
  };

  // Persist sealed (AES-256-GCM + HMAC-SHA256 + 0o600) snapshot file to data directory (never plaintext on disk)
  try {
    writeSealedDiskSnapshotFile(snapshot);
  } catch (err: any) {
    console.warn('[Database Snapshot] Failed to write sealed snapshot file to disk:', err.message);
  }

  return snapshot;
}

// Restore entire database from a validated JSON snapshot inside a single atomic SQLite transaction
export async function restoreDatabaseSnapshot(snapshot: any): Promise<{ success: boolean; restoredCounts: any }> {
  const { skippedUserSessions } = validateDatabaseSnapshot(snapshot);
  const { tables } = snapshot;

  return await db.transaction(async () => {
    const tableExists = async (name: string): Promise<boolean> => {
      const row = (await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)) as any;
      return Boolean(row?.name);
    };

    if (Array.isArray(tables.messages)) {
      for (const m of tables.messages) {
        await db.prepare(`
          INSERT OR REPLACE INTO messages (
            id, chat_id, account_id, sender, sender_name, sender_id, text, translated_text,
            is_audio, audio_duration, audio_url, stt_text, voice_tone,
            is_image, image_url, image_caption, is_video, video_url, video_duration,
            is_file, file_name, file_size, file_url,
            timestamp, created_at, delivery_status, telegram_message_id,
            reply_to_json, is_edited, is_pinned, forward_from, reactions_json, system_event_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          m.id, m.chat_id, m.account_id, m.sender, m.sender_name ?? '', m.sender_id ?? '', m.text ?? '', m.translated_text ?? '',
          m.is_audio ?? 0, m.audio_duration ?? 0, m.audio_url ?? '', m.stt_text ?? '', m.voice_tone ?? '',
          m.is_image ?? 0, m.image_url ?? '', m.image_caption ?? '', m.is_video ?? 0, m.video_url || '', m.video_duration ?? 0,
          m.is_file ?? 0, m.file_name || '', m.file_size || '', m.file_url || '',
          m.timestamp, Number(m.created_at),
          m.delivery_status || 'delivered',
          m.telegram_message_id ?? null,
          m.reply_to_json ?? null,
          m.is_edited ?? 0,
          m.is_pinned ?? 0,
          m.forward_from ?? null,
          m.reactions_json ?? null,
          m.system_event_type ?? ''
        );
      }
    }

    if (Array.isArray(tables.customer_profiles)) {
      for (const p of tables.customer_profiles) {
        await db.prepare(`
          INSERT OR REPLACE INTO customer_profiles (
            chat_id, account_id, client_name, relationship_stage, age_estimate, occupation,
            location_timezone, family_marital_status, active_schedule, tone_style,
            likes_interests, dislikes_taboos, emotional_needs,
            financial_profile, investment_attitude, trust_level, next_step_strategy,
            key_memories, total_messages_count, last_analyzed_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          p.chat_id,
          p.account_id || 'acc_1',
          p.client_name ?? '',
          p.relationship_stage ?? '初次接触',
          p.age_estimate ?? '-',
          p.occupation ?? '',
          p.location_timezone ?? 'UTC+8',
          p.family_marital_status ?? '',
          p.active_schedule ?? '',
          p.tone_style ?? '',
          p.likes_interests ?? '[]',
          p.dislikes_taboos ?? '[]',
          p.emotional_needs ?? '',
          p.financial_profile ?? '',
          p.investment_attitude ?? '',
          p.trust_level ?? '',
          p.next_step_strategy ?? '',
          p.key_memories ?? '[]',
          Number(p.total_messages_count) || 0,
          Number(p.last_analyzed_at) || 0,
          Number(p.updated_at) || Date.now()
        );
      }
    }

    if (Array.isArray(tables.account_customer_profiles)) {
      for (const p of tables.account_customer_profiles) {
        await db.prepare(`
          INSERT OR REPLACE INTO account_customer_profiles (
            account_id, chat_id, client_name, relationship_stage, age_estimate, occupation,
            location_timezone, family_marital_status, active_schedule, tone_style,
            likes_interests, dislikes_taboos, emotional_needs,
            financial_profile, investment_attitude, trust_level, next_step_strategy,
            key_memories, total_messages_count, last_analyzed_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          p.account_id,
          p.chat_id,
          p.client_name ?? '',
          p.relationship_stage ?? '初次接触',
          p.age_estimate ?? '-',
          p.occupation ?? '',
          p.location_timezone ?? 'UTC+8',
          p.family_marital_status ?? '',
          p.active_schedule ?? '',
          p.tone_style ?? '',
          p.likes_interests ?? '[]',
          p.dislikes_taboos ?? '[]',
          p.emotional_needs ?? '',
          p.financial_profile ?? '',
          p.investment_attitude ?? '',
          p.trust_level ?? '',
          p.next_step_strategy ?? '',
          p.key_memories ?? '[]',
          Number(p.total_messages_count) || 0,
          Number(p.last_analyzed_at) || 0,
          Number(p.updated_at) || Date.now()
        );
      }
    }

    if (Array.isArray(tables.knowledge_base)) {
      for (const k of tables.knowledge_base) {
        await db.prepare(`
          INSERT OR REPLACE INTO knowledge_base (
            id, account_id, category, title, content, keywords, source_type, source_file, is_active, hit_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          k.id, k.account_id || 'global', k.category, k.title, k.content ?? '', k.keywords ?? '', k.source_type, k.source_file ?? '',
          k.is_active ?? 1, Number(k.hit_count) || 0, Number(k.created_at) || Date.now(), Number(k.updated_at) || Date.now()
        );
      }
    }

    if (Array.isArray(tables.chat_transcripts)) {
      for (const t of tables.chat_transcripts) {
        await db.prepare(`
          INSERT OR REPLACE INTO chat_transcripts (
            id, account_id, title, description, dialogue_text, learned_style, round_count, character_count, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          t.id, t.account_id || 'global', t.title, t.description ?? '', t.dialogue_text ?? '', t.learned_style ?? '',
          Number(t.round_count) || 0, Number(t.character_count) || 0, t.is_active ?? 1,
          Number(t.created_at) || Date.now(), Number(t.updated_at) || Date.now()
        );
      }
    }

    if (Array.isArray(tables.media_materials) && tables.media_materials.length > 0 && (await tableExists('media_materials'))) {
      for (const m of tables.media_materials) {
        await db.prepare(`
          INSERT OR REPLACE INTO media_materials (
            id, category, title, description, tags, image_url, usage_count, last_used_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          m.id, m.category, m.title, m.description ?? '', m.tags ?? '', m.image_url,
          Number(m.usage_count) || 0, Number(m.last_used_at) || 0, Number(m.created_at) || Date.now()
        );
      }
    }

    if (Array.isArray(tables.persona_schedule_vault) && tables.persona_schedule_vault.length > 0 && (await tableExists('persona_schedule_vault'))) {
      for (const p of tables.persona_schedule_vault) {
        await db.prepare(`
          INSERT OR REPLACE INTO persona_schedule_vault (
            id, account_id, persona_name, occupation, city, timezone, weather_condition,
            temperature, current_status, weekly_schedule, daily_timeline, tone_style,
            reply_rhythm_rules, is_active, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          p.id, p.account_id, p.persona_name, p.occupation ?? '', p.city ?? '', p.timezone ?? '', p.weather_condition ?? '',
          p.temperature ?? '', p.current_status ?? '', p.weekly_schedule ?? '', p.daily_timeline ?? '', p.tone_style ?? '',
          p.reply_rhythm_rules ?? '', p.is_active ?? 1, Number(p.updated_at) || Date.now()
        );
      }
    }

    if (Array.isArray(tables.training_logs) && tables.training_logs.length > 0) {
      for (const tl of tables.training_logs) {
        await db.prepare(`
          INSERT OR REPLACE INTO training_logs (
            id, account_id, log_type, details, items_learned, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          tl.id, tl.account_id || 'global', tl.log_type || 'manual', tl.details ?? '', Number(tl.items_learned) || 0, Number(tl.created_at) || Date.now()
        );
      }
    }

    // Security & cross-machine isolation: NEVER import telegram_user_sessions from backup snapshots.
    // Each machine binds session ciphertexts to its unique .device_secret; users must sign in on the target machine.
    if (skippedUserSessions > 0) {
      console.warn(
        `[Snapshot Restore] Skipped ${skippedUserSessions} telegram_user_sessions row(s) to prevent cross-machine .device_secret decryption conflicts.`
      );
    }

    let restoredConfigCount = 0;
    if (Array.isArray(tables.system_config)) {
      for (const c of tables.system_config) {
        const cfgKey = String(c?.key || '').trim();
        if (!cfgKey || cfgKey === 'telegram_api_credentials' || cfgKey === 'custom_llm_config') {
          continue;
        }
        if (typeof c?.value !== 'string') continue;
        let valueToSave = c.value;
        const isTranslationConfigKey =
          cfgKey === 'translation_settings' || cfgKey.startsWith('translation_settings::');
        if (isTranslationConfigKey || cfgKey === 'network_proxy') {
          try {
            const incomingObj = JSON.parse(c.value);
            if (incomingObj && typeof incomingObj === 'object') {
              const existingRow = (await db
                .prepare('SELECT value FROM system_config WHERE key = ?')
                .get(cfgKey)) as any;
              const existingObj =
                existingRow && typeof existingRow.value === 'string'
                  ? JSON.parse(existingRow.value)
                  : null;
              if (existingObj && typeof existingObj === 'object') {
                if (isTranslationConfigKey) {
                  const merged = { ...incomingObj };
                  if (merged.geminiApiKey === undefined && existingObj.geminiApiKey) {
                    merged.geminiApiKey = existingObj.geminiApiKey;
                  }
                  if (merged.googleApiKey === undefined && existingObj.googleApiKey) {
                    merged.googleApiKey = existingObj.googleApiKey;
                  }
                  valueToSave = JSON.stringify(merged);
                } else if (cfgKey === 'network_proxy') {
                  const merged = { ...incomingObj };
                  if (merged.password === undefined && existingObj.password) {
                    merged.password = existingObj.password;
                  }
                  valueToSave = JSON.stringify(merged);
                }
              }
            }
          } catch {}
        }
        await db.prepare(`
          INSERT OR REPLACE INTO system_config (key, value, updated_at)
          VALUES (?, ?, ?)
        `).run(cfgKey, valueToSave, Number(c.updated_at) || Date.now());
        restoredConfigCount++;
      }
    }

    let restoredLangPrefCount = 0;
    if (Array.isArray(tables.chat_language_prefs)) {
      for (const lp of tables.chat_language_prefs) {
        if (!lp?.chat_id) continue;
        const parsedTransEnabled =
          lp.translation_enabled === 1 || lp.translation_enabled === true
            ? 1
            : lp.translation_enabled === 0 || lp.translation_enabled === false
              ? 0
              : null;
        await db.prepare(`
          INSERT OR REPLACE INTO chat_language_prefs (account_id, chat_id, source_lang, target_lang, updated_at, translation_enabled)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          String(lp.account_id || 'acc_1'),
          String(lp.chat_id),
          String(lp.source_lang || 'Auto'),
          String(lp.target_lang || 'Auto'),
          Number(lp.updated_at) || Date.now(),
          parsedTransEnabled
        );
        restoredLangPrefCount++;
      }
    }

    return {
      success: true,
      restoredCounts: {
        messages: tables.messages?.length || 0,
        profiles: tables.customer_profiles?.length || 0,
        accountProfiles: tables.account_customer_profiles?.length || 0,
        knowledge: tables.knowledge_base?.length || 0,
        transcripts: tables.chat_transcripts?.length || 0,
        materials: tables.media_materials?.length || 0,
        personas: tables.persona_schedule_vault?.length || 0,
        trainingLogs: tables.training_logs?.length || 0,
        systemConfig: restoredConfigCount,
        chatLanguagePrefs: restoredLangPrefCount,
        userSessions: 0,
        skippedUserSessions,
      },
    };
  })();
}

// Automatically restore data from encrypted (or legacy) disk snapshot if SQLite file was wiped/empty
export async function autoRestoreSnapshotIfAvailable(): Promise<boolean> {
  try {
    if (fs.existsSync(snapshotFilePath)) {
      const raw = fs.readFileSync(snapshotFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      let snapshotData: any = null;
      let isLegacyPlaintext = false;

      if (isDiskSnapshotEnvelope(parsed)) {
        snapshotData = unsealDiskSnapshot(parsed);
      } else if (parsed && parsed.tables) {
        snapshotData = parsed;
        isLegacyPlaintext = true;
      }

      if (snapshotData && snapshotData.tables) {
        console.log(`[Database Auto-Recovery] Detected snapshot at ${snapshotFilePath}, auto-restoring records...`);
        await restoreDatabaseSnapshot(snapshotData);
        if (isLegacyPlaintext) {
          try {
            writeSealedDiskSnapshotFile(snapshotData);
          } catch {}
        }
        console.log(`[Database Auto-Recovery] Successfully restored ${snapshotData.counts?.messages || 0} messages and ${snapshotData.counts?.profiles || 0} customer profiles!`);
        return true;
      }
    }
  } catch (err: any) {
    console.warn('[Database Auto-Recovery] Could not auto-restore snapshot:', err.message);
  }
  return false;
}

// Completely shred all local business tables & disk snapshot (keeps membership/Telegram API auth config intact)
export async function purgeDatabaseBusinessData(): Promise<{
  deletedMessages: number;
  deletedProfiles: number;
  deletedKnowledge: number;
  deletedTranscripts: number;
}> {
  const countTable = async (tableName: string): Promise<number> => {
    try {
      const row = (await db.prepare(`SELECT count(*) as count FROM ${tableName}`).get()) as any;
      return Number(row?.count || 0);
    } catch {
      return 0;
    }
  };

  const deletedMessages = await countTable('messages');
  const deletedProfiles =
    (await countTable('customer_profiles')) + (await countTable('account_customer_profiles'));
  const deletedKnowledge = await countTable('knowledge_base');
  const deletedTranscripts = await countTable('chat_transcripts');

  const tablesToClear = [
    'messages',
    'customer_profiles',
    'account_customer_profiles',
    'knowledge_base',
    'chat_transcripts',
    'media_materials',
    'persona_schedule_vault',
    'chat_language_prefs',
    'training_logs',
    'custom_llm_daily_usage',
  ];

  for (const tbl of tablesToClear) {
    try {
      await db.execute(`DELETE FROM ${tbl}`);
    } catch {
      // ignore if table does not exist yet
    }
  }

  // Also clear global & per-account persona / evolution state entries in system_config while preserving auth & API gateway settings
  try {
    await db.execute(
      `DELETE FROM system_config WHERE key IN ('global_persona', 'global_persona_config', 'evolution_engine_state', 'evolution_state') OR key LIKE 'global_persona_config::%' OR key LIKE 'evolution_engine_state::%'`
    );
  } catch {
    // ignore
  }

  // Remove disk snapshot file so shredded records do not auto-restore on next boot
  try {
    if (fs.existsSync(snapshotFilePath)) {
      fs.unlinkSync(snapshotFilePath);
    }
  } catch (err: any) {
    console.warn('[Database Purge] Failed to remove snapshot file:', err.message);
  }

  return {
    deletedMessages,
    deletedProfiles,
    deletedKnowledge,
    deletedTranscripts,
  };
}


