import { createClient, type Client } from '@libsql/client';
import path from 'path';
import fs from 'fs';
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

  // 6. Local project fallback
  const localDir = path.resolve(__dirname, '../data');
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

const resolvedLibsqlUrl = process.env.TURSO_DATABASE_URL || formatLibsqlFileUrl(dbPath);

// 1. Initialize Turso / LibSQL client
export const turso: Client = createClient({
  url: resolvedLibsqlUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// 2. High-performance asynchronous query wrapper matching Turso capabilities
export const db = {
  client: turso,
  isTurso,
  dbType,
  tursoUrl: resolvedLibsqlUrl,

  async execute(stmt: string | { sql: string; args?: any[] | Record<string, any> }) {
    return await turso.execute(typeof stmt === 'string' ? { sql: stmt, args: [] } : stmt);
  },

  async ping() {
    const start = Date.now();
    const res = await turso.execute('SELECT 1 as ping');
    const latencyMs = Date.now() - start;
    return { ok: true, latencyMs, rows: res.rows };
  },

  async exec(sql: string) {
    return await turso.executeMultiple(sql);
  },

  prepare(sql: string) {
    return {
      async all(...params: any[]) {
        const res = await turso.execute({ sql, args: params });
        return res.rows as any[];
      },
      async get(...params: any[]) {
        const res = await turso.execute({ sql, args: params });
        return (res.rows[0] as any) || undefined;
      },
      async run(...params: any[]) {
        const res = await turso.execute({ sql, args: params });
        return {
          changes: res.rowsAffected,
          lastInsertRowid: res.lastInsertRowid,
        };
      },
    };
  },

  transaction(fn: (...args: any[]) => Promise<any> | any) {
    return async (...args: any[]) => {
      return await fn(...args);
    };
  },
};

// 3. Database initialization & seedings
export async function initDatabase() {
  console.log(`[Database] Initializing ${dbType}...`);

  if (!isTurso) {
    try {
      await db.execute('PRAGMA secure_delete = ON');
    } catch {}
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
      reactions_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages (chat_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_account ON messages (account_id);

    -- 2. Customer Holographic Profile & Long-Term Memory
    CREATE TABLE IF NOT EXISTS customer_profiles (
      chat_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      client_name TEXT NOT NULL,
      relationship_stage TEXT DEFAULT '活跃联系人',
      age_estimate TEXT DEFAULT '-',
      occupation TEXT DEFAULT '商务合作客户',
      location_timezone TEXT DEFAULT 'UTC+8',
      tone_style TEXT DEFAULT '沟通清晰简洁',
      likes_interests TEXT DEFAULT '["高效沟通", "产品方案", "项目细节"]',
      dislikes_taboos TEXT DEFAULT '["拖沓回复"]',
      emotional_needs TEXT DEFAULT '关注服务效率与沟通质量',
      key_memories TEXT DEFAULT '[]',
      total_messages_count INTEGER DEFAULT 0,
      last_analyzed_at INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    -- 2.1 Account-Isolated Customer Holographic Profile (Composite PK: account_id + chat_id)
    CREATE TABLE IF NOT EXISTS account_customer_profiles (
      account_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      client_name TEXT NOT NULL,
      relationship_stage TEXT DEFAULT '活跃联系人',
      age_estimate TEXT DEFAULT '-',
      occupation TEXT DEFAULT '商务合作客户',
      location_timezone TEXT DEFAULT 'UTC+8',
      tone_style TEXT DEFAULT '沟通清晰简洁',
      likes_interests TEXT DEFAULT '["高效沟通", "产品方案", "项目细节"]',
      dislikes_taboos TEXT DEFAULT '["拖沓回复"]',
      emotional_needs TEXT DEFAULT '关注服务效率与沟通质量',
      key_memories TEXT DEFAULT '[]',
      total_messages_count INTEGER DEFAULT 0,
      last_analyzed_at INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL,
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
      log_type TEXT NOT NULL,
      details TEXT NOT NULL,
      items_learned INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- 6. Full Chat Dialogue Corpus
    CREATE TABLE IF NOT EXISTS chat_transcripts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      dialogue_text TEXT NOT NULL,
      learned_style TEXT,
      round_count INTEGER DEFAULT 0,
      character_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
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
  totalConversationsAnalyzed: 0,
  totalHabitsLearned: 0,
  autoEvolutionActive: true,
  habits: [] as any[],
};

export async function getGlobalPersonaFromDb(): Promise<any> {
  try {
    const row = (await db.prepare("SELECT value FROM system_config WHERE key = 'global_persona_config'").get()) as any;
    if (row && row.value) {
      return {
        ...DEFAULT_GLOBAL_PERSONA,
        ...JSON.parse(row.value),
        stagedPrompts: {
          ...DEFAULT_GLOBAL_PERSONA.stagedPrompts,
          ...(JSON.parse(row.value)?.stagedPrompts || {}),
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

export async function saveGlobalPersonaToDb(persona: any): Promise<boolean> {
  try {
    const valueStr = JSON.stringify(persona);
    await db.prepare(`
      INSERT INTO system_config (key, value, updated_at)
      VALUES ('global_persona_config', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(valueStr, Date.now());
    return true;
  } catch (err: any) {
    console.error('[Database] saveGlobalPersonaToDb error:', err.message);
    return false;
  }
}

export async function resetGlobalPersonaInDb(): Promise<any> {
  const blankPersona = {
    ...DEFAULT_GLOBAL_PERSONA,
    stagedPrompts: { ...DEFAULT_GLOBAL_PERSONA.stagedPrompts },
    personalityTraits: [],
    tabooKeywords: [],
  };
  try {
    await saveGlobalPersonaToDb(blankPersona);
    return blankPersona;
  } catch (err: any) {
    console.error('[Database] resetGlobalPersonaInDb error:', err.message);
    return blankPersona;
  }
}

export async function getEvolutionStateFromDb(): Promise<any> {
  try {
    const row = (await db.prepare("SELECT value FROM system_config WHERE key = 'evolution_engine_state'").get()) as any;
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

export async function saveEvolutionStateToDb(state: any): Promise<boolean> {
  try {
    const valueStr = JSON.stringify(state);
    await db.prepare(`
      INSERT INTO system_config (key, value, updated_at)
      VALUES ('evolution_engine_state', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(valueStr, Date.now());
    return true;
  } catch (err: any) {
    console.error('[Database] saveEvolutionStateToDb error:', err.message);
    return false;
  }
}

export const snapshotFilePath = path.join(dbDir, 'telegram_pro_snapshot.json');

// Export entire database contents into a portable JSON snapshot (Excludes sensitive telegram_user_sessions)
export async function exportDatabaseSnapshot() {
  const [messages, profiles, accountProfiles, knowledge, transcripts, config] = await Promise.all([
    turso.execute('SELECT * FROM messages'),
    turso.execute('SELECT * FROM customer_profiles'),
    turso.execute('SELECT * FROM account_customer_profiles'),
    turso.execute('SELECT * FROM knowledge_base'),
    turso.execute('SELECT * FROM chat_transcripts'),
    turso.execute('SELECT * FROM system_config'),
  ]);

  const safeConfigRows = (config.rows || [])
    .filter((row: any) => {
      const key = String(row?.key || '');
      return key !== 'telegram_api_credentials' && key !== 'custom_llm_config';
    })
    .map((row: any) => {
      if (String(row?.key || '') === 'translation_settings' && typeof row?.value === 'string') {
        try {
          const parsed = JSON.parse(row.value);
          if (parsed && typeof parsed === 'object') {
            const { geminiApiKey: _g, googleApiKey: _gk, ...safeSettings } = parsed;
            return { ...row, value: JSON.stringify(safeSettings) };
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
      userSessions: 0, // Explicitly excluded for security: sessions must never be exported
    },
    tables: {
      messages: messages.rows,
      customer_profiles: profiles.rows,
      account_customer_profiles: accountProfiles.rows,
      knowledge_base: knowledge.rows,
      chat_transcripts: transcripts.rows,
      system_config: safeConfigRows,
      // telegram_user_sessions & sensitive credentials intentionally excluded to protect authentication credentials
    },
  };

  // Persist to snapshot file in data directory
  try {
    fs.writeFileSync(snapshotFilePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  } catch (err: any) {
    console.warn('[Database Snapshot] Failed to write snapshot file to disk:', err.message);
  }

  return snapshot;
}

// Restore entire database from a portable JSON snapshot
export async function restoreDatabaseSnapshot(snapshot: any): Promise<{ success: boolean; restoredCounts: any }> {
  if (!snapshot || !snapshot.tables) {
    throw new Error('Invalid snapshot payload format: missing tables property');
  }

  const { tables } = snapshot;

  if (Array.isArray(tables.messages)) {
    for (const m of tables.messages) {
      await db.prepare(`
        INSERT OR REPLACE INTO messages (
          id, chat_id, account_id, sender, sender_name, text, translated_text,
          is_audio, audio_duration, audio_url, stt_text, voice_tone,
          is_image, image_url, image_caption, is_video, video_url, video_duration,
          is_file, file_name, file_size, file_url,
          timestamp, created_at, delivery_status, telegram_message_id,
          reply_to_json, is_edited, is_pinned, forward_from, reactions_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        m.id, m.chat_id, m.account_id, m.sender, m.sender_name, m.text, m.translated_text,
        m.is_audio, m.audio_duration, m.audio_url, m.stt_text, m.voice_tone,
        m.is_image, m.image_url, m.image_caption, m.is_video ?? 0, m.video_url || '', m.video_duration ?? 0,
        m.is_file ?? 0, m.file_name || '', m.file_size || '', m.file_url || '',
        m.timestamp, m.created_at,
        m.delivery_status || 'delivered',
        m.telegram_message_id ?? null,
        m.reply_to_json ?? null,
        m.is_edited ?? 0,
        m.is_pinned ?? 0,
        m.forward_from ?? null,
        m.reactions_json ?? null
      );
    }
  }

  if (Array.isArray(tables.customer_profiles)) {
    for (const p of tables.customer_profiles) {
      await db.prepare(`
        INSERT OR REPLACE INTO customer_profiles (
          chat_id, account_id, client_name, relationship_stage, age_estimate, occupation,
          location_timezone, tone_style, likes_interests, dislikes_taboos, emotional_needs,
          key_memories, total_messages_count, last_analyzed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        p.chat_id ?? '',
        p.account_id ?? 'acc_1',
        p.client_name ?? '',
        p.relationship_stage ?? '活跃联系人',
        p.age_estimate ?? '-',
        p.occupation ?? '商务合作客户',
        p.location_timezone ?? 'UTC+8',
        p.tone_style ?? '沟通清晰简洁',
        p.likes_interests ?? '[]',
        p.dislikes_taboos ?? '[]',
        p.emotional_needs ?? '',
        p.key_memories ?? '[]',
        p.total_messages_count ?? 0,
        p.last_analyzed_at ?? 0,
        p.updated_at ?? Date.now()
      );
    }
  }

  if (Array.isArray(tables.account_customer_profiles)) {
    for (const p of tables.account_customer_profiles) {
      await db.prepare(`
        INSERT OR REPLACE INTO account_customer_profiles (
          account_id, chat_id, client_name, relationship_stage, age_estimate, occupation,
          location_timezone, tone_style, likes_interests, dislikes_taboos, emotional_needs,
          key_memories, total_messages_count, last_analyzed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        p.account_id ?? 'acc_1',
        p.chat_id ?? '',
        p.client_name ?? '',
        p.relationship_stage ?? '活跃联系人',
        p.age_estimate ?? '-',
        p.occupation ?? '商务合作客户',
        p.location_timezone ?? 'UTC+8',
        p.tone_style ?? '沟通清晰简洁',
        p.likes_interests ?? '[]',
        p.dislikes_taboos ?? '[]',
        p.emotional_needs ?? '',
        p.key_memories ?? '[]',
        p.total_messages_count ?? 0,
        p.last_analyzed_at ?? 0,
        p.updated_at ?? Date.now()
      );
    }
  }

  if (Array.isArray(tables.knowledge_base)) {
    for (const k of tables.knowledge_base) {
      await db.prepare(`
        INSERT OR REPLACE INTO knowledge_base (
          id, category, title, content, keywords, source_type, source_file, is_active, hit_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        k.id, k.category, k.title, k.content, k.keywords, k.source_type, k.source_file,
        k.is_active, k.hit_count, k.created_at, k.updated_at
      );
    }
  }

  if (Array.isArray(tables.chat_transcripts)) {
    for (const t of tables.chat_transcripts) {
      await db.prepare(`
        INSERT OR REPLACE INTO chat_transcripts (
          id, title, description, dialogue_text, learned_style, round_count, character_count, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        t.id, t.title, t.description, t.dialogue_text, t.learned_style, t.round_count,
        t.character_count, t.is_active, t.created_at, t.updated_at
      );
    }
  }

  if (Array.isArray(tables.media_materials)) {
    for (const m of tables.media_materials) {
      await db.prepare(`
        INSERT OR REPLACE INTO media_materials (
          id, category, title, description, tags, image_url, usage_count, last_used_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        m.id, m.category, m.title, m.description, m.tags, m.image_url,
        m.usage_count, m.last_used_at, m.created_at
      );
    }
  }

  if (Array.isArray(tables.persona_schedule_vault)) {
    for (const p of tables.persona_schedule_vault) {
      await db.prepare(`
        INSERT OR REPLACE INTO persona_schedule_vault (
          id, account_id, persona_name, occupation, city, timezone, weather_condition,
          temperature, current_status, weekly_schedule, daily_timeline, tone_style,
          reply_rhythm_rules, is_active, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        p.id, p.account_id, p.persona_name, p.occupation, p.city, p.timezone, p.weather_condition,
        p.temperature, p.current_status, p.weekly_schedule, p.daily_timeline, p.tone_style,
        p.reply_rhythm_rules, p.is_active, p.updated_at
      );
    }
  }

  if (Array.isArray(tables.telegram_user_sessions)) {
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS telegram_user_sessions (
          phone TEXT PRIMARY KEY,
          session_string TEXT NOT NULL,
          user_id TEXT,
          username TEXT,
          first_name TEXT,
          is_active INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      for (const s of tables.telegram_user_sessions) {
        const rawSess = typeof s?.session_string === 'string' ? s.session_string : '';
        if (!rawSess || !rawSess.startsWith('enc:gcm:')) {
          continue;
        }
        await db.prepare(`
          INSERT OR REPLACE INTO telegram_user_sessions (
            phone, session_string, user_id, username, first_name, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          s.phone,
          rawSess,
          s.user_id ?? null,
          s.username ?? '',
          s.first_name ?? '',
          s.is_active ?? 1,
          s.created_at ?? Date.now(),
          s.updated_at ?? Date.now()
        );
      }
    } catch (e: any) {
      console.warn('[Snapshot Restore] Failed to restore telegram_user_sessions:', e.message);
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
      userSessions: tables.telegram_user_sessions?.length || 0,
    },
  };
}

// Automatically restore data from disk snapshot if SQLite file was wiped/empty
export async function autoRestoreSnapshotIfAvailable(): Promise<boolean> {
  try {
    if (fs.existsSync(snapshotFilePath)) {
      const raw = fs.readFileSync(snapshotFilePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data && data.tables) {
        console.log(`[Database Auto-Recovery] Detected snapshot at ${snapshotFilePath}, auto-restoring records...`);
        await restoreDatabaseSnapshot(data);
        console.log(`[Database Auto-Recovery] Successfully restored ${data.counts?.messages || 0} messages and ${data.counts?.profiles || 0} customer profiles!`);
        return true;
      }
    }
  } catch (err: any) {
    console.warn('[Database Auto-Recovery] Could not auto-restore snapshot:', err.message);
  }
  return false;
}

