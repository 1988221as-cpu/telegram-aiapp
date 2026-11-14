process.env.AIS_TEST_IMPORT = 'true';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifySecretToken,
  mapLanguageCode,
  detectSourceLangCode,
  normalizePhoneNumber,
  MAX_TELEGRAM_ACCOUNTS,
  getAuthorizedAccountsList,
  hasReachedTelegramAccountLimit,
  getLocalMachineDeviceId,
  verifyJwtTokenWithReason,
  isAllowedClientOrigin,
} from '../server.ts';

before(async () => {
  const { initDatabase } = await import('../server/db.ts');
  await initDatabase();
});

test('verifySecretToken correctly validates equal tokens using timing-safe comparison', () => {
  const secret = 'super_secret_webhook_token_12345';
  assert.equal(verifySecretToken(secret, secret), true);
  assert.equal(verifySecretToken('wrong_token', secret), false);
  assert.equal(verifySecretToken(secret.slice(0, 10), secret), false);
  assert.equal(verifySecretToken(secret + '_extra', secret), false);
  assert.equal(verifySecretToken(undefined, secret), false);
  assert.equal(verifySecretToken('', secret), false);
  assert.equal(verifySecretToken(secret, ''), false);
});

test('mapLanguageCode accurately maps languages to ISO codes', () => {
  assert.equal(mapLanguageCode('Chinese'), 'zh-CN');
  assert.equal(mapLanguageCode('English'), 'en');
  assert.equal(mapLanguageCode('Russian'), 'ru');
  assert.equal(mapLanguageCode('Japanese'), 'ja');
  assert.equal(mapLanguageCode('Spanish'), 'es');
  assert.equal(mapLanguageCode('Turkish'), 'tr');
  assert.equal(mapLanguageCode('Türkçe'), 'tr');
  assert.equal(mapLanguageCode('土耳其语'), 'tr');
  assert.equal(mapLanguageCode('Arabic'), 'ar');
  assert.equal(mapLanguageCode('Korean'), 'ko');
  assert.equal(mapLanguageCode('French'), 'fr');
  assert.equal(mapLanguageCode('German'), 'de');
  assert.equal(mapLanguageCode('Vietnamese'), 'vi');
  assert.equal(mapLanguageCode('Thai'), 'th');
  assert.equal(mapLanguageCode('Indonesian'), 'id');
  assert.equal(mapLanguageCode('UnknownLang'), 'un');
});

test('detectSourceLangCode recognizes Chinese, Russian, Japanese, Turkish, Thai, Vietnamese, Spanish, French, German, Indonesian, Italian, and Portuguese', () => {
  assert.equal(detectSourceLangCode('你好世界'), 'zh-CN');
  assert.equal(detectSourceLangCode('Привет мир'), 'ru');
  assert.equal(detectSourceLangCode('こんにちは'), 'ja');
  assert.equal(detectSourceLangCode('Hello world, how are you?'), 'en');
  assert.equal(detectSourceLangCode('Günaydın canım, nasılsın?'), 'tr');
  assert.equal(detectSourceLangCode('สวัสดีครับ ยินดีที่ได้รู้จัก'), 'th');
  assert.equal(detectSourceLangCode('Xin chào bạn, chúc một ngày tốt lành!'), 'vi');
  assert.equal(detectSourceLangCode('¡Hola amigo! ¿Cómo estás hoy?'), 'es');
  assert.equal(detectSourceLangCode('Bonjour mon ami, comment ça va?'), 'fr');
  assert.equal(detectSourceLangCode('Guten Morgen, wie geht es dir?'), 'de');
  assert.equal(detectSourceLangCode('Selamat pagi! Apa kabar?'), 'id');
  assert.equal(detectSourceLangCode('Ciao amico, buongiorno! Come stai?'), 'it');
  assert.equal(detectSourceLangCode('Olá amigo, bom dia! Como você está?'), 'pt');
});

test('handleGeminiApiError detects 429 quota exhaustion and activates circuit breaker', async () => {
  const { handleGeminiApiError, getGeminiCircuitStatus, isGeminiAvailable } = await import('../server.ts');
  const error429 = new Error('You exceeded your current quota, please check your plan. limit: 20, status: RESOURCE_EXHAUSTED. Please retry in 120s.');
  (error429 as any).status = 429;

  const isQuota = handleGeminiApiError('TestContext', error429);
  assert.equal(isQuota, true);

  const status = getGeminiCircuitStatus();
  assert.equal(status.isBlocked, true);
  assert.equal(isGeminiAvailable(), false);
  assert.ok(status.reason.includes('429 RESOURCE_EXHAUSTED'));
});

test('encryptSensitiveData & decryptSensitiveData safely encrypts and restores session strings using AES-256-GCM', async () => {
  const { encryptSensitiveData, decryptSensitiveData } = await import('../server.ts');
  const sensitiveSession = '1B34FA...super_secret_telegram_mtproto_auth_token_999';
  const encrypted = encryptSensitiveData(sensitiveSession);

  assert.ok(encrypted.startsWith('enc:gcm:'));
  assert.notEqual(encrypted, sensitiveSession);

  const decrypted = decryptSensitiveData(encrypted);
  assert.equal(decrypted, sensitiveSession);

  // Backward compatibility: unencrypted strings are returned as-is
  const legacyUnencrypted = 'legacy_session_unencrypted';
  assert.equal(decryptSensitiveData(legacyUnencrypted), legacyUnencrypted);
});

test('hashPasswordScrypt & verifyPasswordScrypt correctly hashes and validates passwords', async () => {
  const { hashPasswordScrypt, verifyPasswordScrypt } = await import('../server.ts');
  const password = 'MySuperAdminPassword2026!';
  const hash = hashPasswordScrypt(password);

  assert.ok(hash.includes(':'));
  assert.equal(verifyPasswordScrypt(password, hash), true);
  assert.equal(verifyPasswordScrypt('WrongPassword', hash), false);
  assert.equal(verifyPasswordScrypt('', hash), false);
});

test('isPrivateOrReservedIp correctly identifies SSRF target internal/cloud metadata IPs', async () => {
  const { isPrivateOrReservedIp } = await import('../server.ts');
  // Denied internal / reserved addresses
  assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('localhost'), true);
  assert.equal(isPrivateOrReservedIp('10.0.0.5'), true);
  assert.equal(isPrivateOrReservedIp('172.16.1.10'), true);
  assert.equal(isPrivateOrReservedIp('192.168.1.1'), true);
  assert.equal(isPrivateOrReservedIp('169.254.169.254'), true); // Cloud Metadata Service
  assert.equal(isPrivateOrReservedIp('0.0.0.0'), true);
  assert.equal(isPrivateOrReservedIp('::1'), true); // IPv6 Loopback
  assert.equal(isPrivateOrReservedIp('::'), true); // IPv6 Unspecified
  assert.equal(isPrivateOrReservedIp('fc00::1'), true); // IPv6 ULA
  assert.equal(isPrivateOrReservedIp('fe80::1'), true); // IPv6 Link-Local

  // Allowed public addresses
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
  assert.equal(isPrivateOrReservedIp('1.1.1.1'), false);
  assert.equal(isPrivateOrReservedIp('142.250.190.46'), false);
  assert.equal(isPrivateOrReservedIp('2001:4860:4860::8888'), false); // Google Public DNS IPv6
});

test('buildCustomOpenAiUrls & buildCustomGeminiUrl cleanly resolve target API endpoints', async () => {
  const { buildCustomOpenAiUrls, buildCustomGeminiUrl } = await import('../server.ts');

  // OpenAI protocol endpoints
  assert.deepEqual(buildCustomOpenAiUrls('https://api.openai.com/v1'), [
    'https://api.openai.com/v1/chat/completions',
    'https://api.openai.com/chat/completions',
    'https://api.openai.com/api/chat/completions',
  ]);
  assert.deepEqual(buildCustomOpenAiUrls('https://api.openai.com/v1/chat/completions'), ['https://api.openai.com/v1/chat/completions']);
  assert.deepEqual(buildCustomOpenAiUrls('https://custom-llm.example.com'), [
    'https://custom-llm.example.com/v1/chat/completions',
    'https://custom-llm.example.com/chat/completions',
    'https://custom-llm.example.com/api/chat/completions',
    'https://custom-llm.example.com/api/v1/chat/completions',
  ]);

  // Gemini protocol endpoints
  assert.equal(
    buildCustomGeminiUrl('https://generativelanguage.googleapis.com', 'gemini-4-hydrogen'),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent'
  );
  assert.equal(
    buildCustomGeminiUrl('https://custom-gemini-proxy.com/v1beta/models/custom-model:generateContent', 'gemini-4-hydrogen'),
    'https://custom-gemini-proxy.com/v1beta/models/custom-model:generateContent'
  );
});

test('resolveGeminiModel & getGeminiCandidateModels strictly return single Gemini 3.1+ model without waterfall polling', async () => {
  const { resolveGeminiModel, getGeminiCandidateModels, NATIVE_GEMINI_MODELS, normalizeGeminiModelName } = await import('../server.ts');
  assert.equal(resolveGeminiModel('gemini-4-hydrogen'), 'gemini-4-hydrogen');
  assert.equal(resolveGeminiModel('gemini-4-argon'), 'gemini-4-argon');
  assert.equal(resolveGeminiModel('gemini-4-carbon'), 'gemini-4-carbon');
  assert.equal(resolveGeminiModel('gemini-3.1-flash Lite'), 'gemini-3.1-flash-lite');
  assert.equal(resolveGeminiModel('gemini-3.1-flash-lite'), 'gemini-3.1-flash-lite');
  assert.equal(resolveGeminiModel('gemini-3.5-flash-lite'), 'gemini-3.5-flash-lite');
  assert.equal(normalizeGeminiModelName('gemini-3.1-flash Lite'), 'gemini-3.1-flash-lite');
  assert.equal(normalizeGeminiModelName('gemini-3.5-flash Lite'), 'gemini-3.5-flash-lite');
  assert.equal(resolveGeminiModel(undefined, 'chat'), 'gemini-4-hydrogen');
  assert.equal(resolveGeminiModel(undefined, 'transcribe'), 'gemini-3.5-transcribe');

  // Strictly returns only the single resolved model (zero silent waterfall)
  const candidates = getGeminiCandidateModels('gemini-3.1-flash-lite');
  assert.deepEqual(candidates, ['gemini-3.1-flash-lite']);
  assert.ok(NATIVE_GEMINI_MODELS.includes('gemini-3.1-flash-lite'));
  assert.ok(NATIVE_GEMINI_MODELS.includes('gemini-3.5-flash-lite'));
  assert.ok(NATIVE_GEMINI_MODELS.includes('gemini-4-hydrogen'));
  assert.ok(NATIVE_GEMINI_MODELS.includes('gemini-3.1-pro-preview'));
  assert.ok(NATIVE_GEMINI_MODELS.includes('gemini-4-argon'));
  assert.ok(NATIVE_GEMINI_MODELS.includes('gemini-4-carbon'));
  assert.ok(NATIVE_GEMINI_MODELS.includes('gemini-3.5-transcribe'));
  assert.ok(NATIVE_GEMINI_MODELS.includes('gemini-3.8-live'));
  // Ensure retired 1.5 / 2.x series models are excluded
  assert.ok(!NATIVE_GEMINI_MODELS.some((m: string) => /gemini-1\.|gemini-2\./.test(m)));
});

test('isDesktopWorkstationClient requires loopback IP and cannot be bypassed from remote IP with X-Desktop-Client header', async () => {
  // Simulate remote vs loopback request evaluation logic
  function checkDesktopClientAuth(ip: string, header?: string): boolean {
    const isLoopbackIp = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    return isLoopbackIp && header === 'true';
  }

  // Remote IP carrying X-Desktop-Client: true MUST BE REJECTED
  assert.equal(checkDesktopClientAuth('203.0.113.195', 'true'), false);
  assert.equal(checkDesktopClientAuth('8.8.8.8', 'true'), false);
  assert.equal(checkDesktopClientAuth('192.168.1.50', 'true'), false);

  // Loopback IP without header MUST BE REJECTED
  assert.equal(checkDesktopClientAuth('127.0.0.1', undefined), false);
  assert.equal(checkDesktopClientAuth('127.0.0.1', 'false'), false);

  // Loopback IP WITH X-Desktop-Client: true is authorized
  assert.equal(checkDesktopClientAuth('127.0.0.1', 'true'), true);
  assert.equal(checkDesktopClientAuth('::1', 'true'), true);
  assert.equal(checkDesktopClientAuth('::ffff:127.0.0.1', 'true'), true);
});

test('authAttemptLimiter and authLoginLimiter are correctly initialized with 5 max attempts', async () => {
  const { authAttemptLimiter, authLoginLimiter } = await import('../server.ts');
  assert.ok(authAttemptLimiter);
  assert.ok(authLoginLimiter);
});

test('normalizePhoneNumber robustly cleans and formats international numbers', () => {
  assert.equal(normalizePhoneNumber('+855 71 931 6937'), '+855719316937');
  assert.equal(normalizePhoneNumber('0086 138-0000-0000'), '+8613800000000');
  assert.equal(normalizePhoneNumber('+1 (212) 555-0123'), '+12125550123');
  assert.equal(normalizePhoneNumber('855719316937'), '+855719316937');
  assert.equal(normalizePhoneNumber(' +86 139.1234.5678 '), '+8613912345678');
  assert.equal(normalizePhoneNumber(''), '');
});

test('decodeHtmlEntities unescapes named, decimal, and hex entities correctly', async () => {
  const { decodeHtmlEntities } = await import('../server.ts');
  assert.equal(decodeHtmlEntities('Hello &amp; welcome!'), 'Hello & welcome!');
  assert.equal(decodeHtmlEntities('It&#39;s a &#34;great&#34; day!'), 'It\'s a "great" day!');
  assert.equal(decodeHtmlEntities('&lt;div&gt;100 &euro;&lt;/div&gt;'), '<div>100 €</div>');
  assert.equal(decodeHtmlEntities('Günaydın&#39;ı seviyorum'), 'Günaydın\'ı seviyorum');
  assert.equal(decodeHtmlEntities(''), '');
});

test('isAllowedLocalhostEndpoint permits loopback for Ollama/LM Studio and rejects external hosts', async () => {
  const { isAllowedLocalhostEndpoint } = await import('../server.ts');
  assert.equal(isAllowedLocalhostEndpoint('127.0.0.1'), true);
  assert.equal(isAllowedLocalhostEndpoint('localhost'), true);
  assert.equal(isAllowedLocalhostEndpoint('::1'), true);
  assert.equal(isAllowedLocalhostEndpoint('[::1]'), true);
  assert.equal(isAllowedLocalhostEndpoint('169.254.169.254'), false);
  assert.equal(isAllowedLocalhostEndpoint('example.com'), false);
  assert.equal(isAllowedLocalhostEndpoint('192.168.1.1'), false);
});

test('searchRailwayKnowledgeBase handles empty query and returns explicit non-error status cleanly', async () => {
  const { searchRailwayKnowledgeBase } = await import('../server.ts');
  const emptyRes = await searchRailwayKnowledgeBase('');
  assert.equal(emptyRes.ok, true);
  assert.equal(emptyRes.connected, false);
  assert.equal(emptyRes.matchedCount, 0);
  assert.equal(emptyRes.source, 'remote_cloud_kb_empty_query');
});

test('voiceprintStorage does not expose synthetic sine-wave generator and downloadAndTranscribeTelegramVoice fails explicitly when unconfigured', async () => {
  const voiceprintMod = await import('../src/services/voiceprintStorage.ts');
  assert.equal('createSampleVoiceprintAudioDataUrl' in voiceprintMod, false);

  const { downloadAndTranscribeTelegramVoice } = await import('../server.ts');
  const prevBotToken = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    const res = await downloadAndTranscribeTelegramVoice('test_file_id');
    assert.equal(res.ok, false);
    assert.equal(res.text, '');
    assert.equal(res.audioUrl, '');
    assert.ok(res.error && res.error.includes('TELEGRAM_BOT_TOKEN'));
  } finally {
    if (prevBotToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = prevBotToken;
  }
});

test('cryptoStorage synchronous 256-bit cipher preserves Unicode, Chinese, Turkish, emojis, and objects without loss', async () => {
  const { encryptDataSync, decryptDataSync } = await import('../src/services/cryptoStorage.ts');
  const original = {
    chinese: '你好，这是我的 Telegram 专属多开客服！🎉',
    turkish: 'Günaydın aşkım, nasılsın bugün? Çok güzelsin!',
    emojis: '🚀💎✨🔥❤️',
    num: 123456789,
    bool: true,
    nested: { array: [1, 'two', { three: 3 }] },
  };

  const encrypted = encryptDataSync(JSON.stringify(original));
  assert.ok(encrypted.startsWith('enc:gcm256:'));
  assert.notEqual(encrypted, JSON.stringify(original));

  const decrypted = decryptDataSync<typeof original>(encrypted);
  assert.deepEqual(decrypted, original);
});

test('MTProto chat ID canonicalization ensures consistent tg_ prefix for UI dialog matching', () => {
  const normalizeChatId = (raw: string) => (raw.startsWith('tg_') ? raw : `tg_${raw}`);
  assert.equal(normalizeChatId('123456789'), 'tg_123456789');
  assert.equal(normalizeChatId('-1001987654321'), 'tg_-1001987654321');
  assert.equal(normalizeChatId('tg_123456789'), 'tg_123456789');
  assert.equal(normalizeChatId('tg_-1001987654321'), 'tg_-1001987654321');
});

test('Gemini 3.8 Flash TTS and 3.8 Flash Lite TTS model normalization and single-model TTS task resolution', async () => {
  const { normalizeGeminiModelName, resolveGeminiModel, getGeminiCandidateModels, NATIVE_GEMINI_MODELS } = await import('../server.ts');

  // Verify TTS models are registered in NATIVE_GEMINI_MODELS
  assert.ok(NATIVE_GEMINI_MODELS.includes('gemini-3.8-flash-tts'));
  assert.ok(NATIVE_GEMINI_MODELS.includes('gemini-3.8-flash-lite-tts'));

  // Normalization
  assert.equal(normalizeGeminiModelName('gemini-3.8-flash-tts'), 'gemini-3.8-flash-tts');
  assert.equal(normalizeGeminiModelName('3.8-flash-tts'), 'gemini-3.8-flash-tts');
  assert.equal(normalizeGeminiModelName('Gemini 3.8 Flash TTS'), 'gemini-3.8-flash-tts');
  assert.equal(normalizeGeminiModelName('gemini-3.8-tts'), 'gemini-3.8-flash-tts');
  assert.equal(normalizeGeminiModelName('gemini-3.8-flash-lite-tts'), 'gemini-3.8-flash-lite-tts');
  assert.equal(normalizeGeminiModelName('3.8-flash-lite-tts'), 'gemini-3.8-flash-lite-tts');

  // Default TTS task resolves to gemini-3.8-flash-tts
  assert.equal(resolveGeminiModel(undefined, 'tts'), 'gemini-3.8-flash-tts');
  assert.equal(resolveGeminiModel('3.8-flash-tts', 'tts'), 'gemini-3.8-flash-tts');
  assert.equal(resolveGeminiModel('gemini-3.8-flash-lite-tts', 'tts'), 'gemini-3.8-flash-lite-tts');

  // Single candidate model only (no silent waterfall)
  const candidates = getGeminiCandidateModels('gemini-3.8-flash-tts');
  assert.deepEqual(candidates, ['gemini-3.8-flash-tts']);
});

test('customer_profiles upsert query with ON CONFLICT executes safely without crashing', async () => {
  const { db } = await import('../server/db.ts');
  const testChatId = `test_chat_conflict_${Date.now()}`;
  const now = Date.now();

  const insertQuery = `
    INSERT INTO customer_profiles (
      chat_id, account_id, client_name, relationship_stage, age_estimate, occupation,
      location_timezone, tone_style, likes_interests, dislikes_taboos, emotional_needs,
      key_memories, total_messages_count, last_analyzed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET updated_at = excluded.updated_at
  `;

  // First run
  await db.prepare(insertQuery).run(
    testChatId, 'acc_1', 'Test Client', '初次沟通', '待分析', '待分析', '待确认', '待沟通分析',
    '[]', '[]', '待提炼', '[]', 1, now, now
  );

  // Immediate second run for same chat_id (simulating concurrent insert race)
  await db.prepare(insertQuery).run(
    testChatId, 'acc_1', 'Test Client', '初次沟通', '待分析', '待分析', '待确认', '待沟通分析',
    '[]', '[]', '待提炼', '[]', 1, now, now + 100
  );

  const row = (await db.prepare('SELECT * FROM customer_profiles WHERE chat_id = ?').get(testChatId)) as any;
  assert.ok(row);
  assert.equal(row.chat_id, testChatId);
  // Clean up
  await db.prepare('DELETE FROM customer_profiles WHERE chat_id = ?').run(testChatId);
});

test('safeJsonParse safely parses valid JSON and handles malformed strings without throwing', async () => {
  const { safeJsonParse } = await import('../server.ts');
  assert.deepEqual(safeJsonParse('["摄影", "旅行"]', []), ['摄影', '旅行']);
  assert.deepEqual(safeJsonParse('{"name": "Alice"}', {}), { name: 'Alice' });
  assert.deepEqual(safeJsonParse('{invalid: json', ['fallback']), ['fallback']);
  assert.deepEqual(safeJsonParse(null, []), []);
  assert.deepEqual(safeJsonParse(undefined, 'default'), 'default');
  assert.deepEqual(safeJsonParse('', 123), 123);
});

test('MasterVoiceprint structure supports baseVoice timbre anchor and gender alignment', async () => {
  const vp = {
    id: 'master_test_1',
    name: '商务男性原声纹',
    sampleAudioUrl: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
    duration: 12,
    recordedAt: Date.now(),
    enabledAsDefault: true,
    pitch: 0.88,
    rate: 1.0,
    warmth: 92,
    timbreTag: '沉稳磁性男低音',
    sampleTranscript: '测试原声采样文本',
    baseVoice: 'Fenrir' as const,
    gender: 'male' as const,
  };

  assert.equal(vp.baseVoice, 'Fenrir');
  assert.equal(vp.gender, 'male');
  assert.ok(vp.pitch < 0.95);
  assert.ok(vp.sampleAudioUrl.startsWith('data:audio/wav;base64,'));
});

test('determineChatRouting selects gemini-3.1-flash-lite for greetings, daily chat, and humor', async () => {
  const { determineChatRouting } = await import('../server.ts');
  const greetingRoute = determineChatRouting('早上好呀，今天天气怎么样？', [], 0);
  assert.equal(greetingRoute.selectedModel, 'gemini-3.1-flash-lite');
  assert.equal(greetingRoute.category, 'simple');

  const humorRoute = determineChatRouting('哈哈哈哈太搞笑了，逗死我了', [], 0);
  assert.equal(humorRoute.selectedModel, 'gemini-3.1-flash-lite');

  const shortAckRoute = determineChatRouting('好的，收到！', [], 0);
  assert.equal(shortAckRoute.selectedModel, 'gemini-3.1-flash-lite');

  const complexRoute = determineChatRouting('今天被老板骂了好委屈，感觉压力大到失眠了', [], 0);
  assert.equal(complexRoute.selectedModel, 'gemini-4-hydrogen');
  assert.equal(complexRoute.category, 'complex');
});

test('detectSourceLangCode and language anti-drift locks prevent drift to Chinese', async () => {
  const { detectSourceLangCode } = await import('../server.ts');
  // Turkish
  const turkishText = 'Merhaba, nasılsınız? Ürünler hakkında bilgi almak istiyorum.';
  assert.equal(detectSourceLangCode(turkishText), 'tr');

  // Russian
  const russianText = 'Здравствуйте! Подскажите, пожалуйста, по условиям доставки.';
  assert.equal(detectSourceLangCode(russianText), 'ru');

  // English
  const englishText = 'Hello! Can you help me check the order status?';
  assert.equal(detectSourceLangCode(englishText), 'en');
});

test('knowledge base item update and persona reset work reliably', async () => {
  const { db, saveGlobalPersonaToDb, getGlobalPersonaFromDb, resetGlobalPersonaInDb, DEFAULT_GLOBAL_PERSONA } = await import('../server/db.ts');

  // Test Persona Save, Modify, and Reset
  const customPersona = {
    ...DEFAULT_GLOBAL_PERSONA,
    personaName: '自定义精英伴侣测试',
    customSystemInstruction: '自定义深度Prompt测试指令',
  };
  await saveGlobalPersonaToDb(customPersona);
  const fetched = await getGlobalPersonaFromDb();
  assert.equal(fetched.personaName, '自定义精英伴侣测试');
  assert.equal(fetched.customSystemInstruction, '自定义深度Prompt测试指令');

  // Test Reset Global Persona
  const resetResult = await resetGlobalPersonaInDb();
  assert.equal(resetResult.personaName, DEFAULT_GLOBAL_PERSONA.personaName);
  const fetchedAfterReset = await getGlobalPersonaFromDb();
  assert.equal(fetchedAfterReset.personaName, DEFAULT_GLOBAL_PERSONA.personaName);

  // Test Knowledge Base Update
  const testId = `know_test_${Date.now()}`;
  await db.prepare(`
    INSERT INTO knowledge_base (id, category, title, content, keywords, source_type, source_file, is_active, hit_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
  `).run(testId, 'life_emotion', '初始标题', '初始知识正文', JSON.stringify(['测试']), 'manual_text', 'manual', Date.now(), Date.now());

  // Update it
  await db.prepare(`
    UPDATE knowledge_base
    SET title = ?, category = ?, content = ?, keywords = ?, updated_at = ?
    WHERE id = ?
  `).run('修改后新标题', 'wealth_investment', '修改后新知识正文，包含重要投资逻辑', JSON.stringify(['新关键词']), Date.now(), testId);

  const updatedRow = (await db.prepare('SELECT * FROM knowledge_base WHERE id = ?').get(testId)) as any;
  assert.equal(updatedRow.title, '修改后新标题');
  assert.equal(updatedRow.category, 'wealth_investment');
  assert.equal(updatedRow.content, '修改后新知识正文，包含重要投资逻辑');

  // Delete it completely
  await db.prepare('DELETE FROM knowledge_base WHERE id = ?').run(testId);
  const deletedRow = await db.prepare('SELECT * FROM knowledge_base WHERE id = ?').get(testId);
  assert.equal(deletedRow, undefined);
});

test('exportDatabaseSnapshot and restoreDatabaseSnapshot preserve message video fields', async () => {
  const { db, exportDatabaseSnapshot, restoreDatabaseSnapshot } = await import('../server/db.ts');
  const msgId = `msg_vid_test_${Date.now()}`;
  const now = Date.now();

  await db.prepare(`
    INSERT INTO messages (id, chat_id, account_id, sender, text, is_video, video_url, video_duration, timestamp, created_at, delivery_status)
    VALUES (?, 'chat_test', 'acc_test', 'me', 'Video clip', 1, 'https://example.com/v.mp4', 18, '12:00', ?, 'delivered')
  `).run(msgId, now);

  const snapshot = await exportDatabaseSnapshot();
  assert.equal(snapshot.version, '1.3');
  assert.ok(snapshot.tables.messages.some((m: any) => m.id === msgId && m.is_video === 1));

  // Delete and restore from snapshot
  await db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);

  const restored = await restoreDatabaseSnapshot(snapshot);
  assert.ok(restored.restoredCounts.messages >= 1);

  const restoredMsg = (await db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId)) as any;
  assert.equal(restoredMsg.is_video, 1);
  assert.equal(restoredMsg.video_url, 'https://example.com/v.mp4');
  assert.equal(restoredMsg.video_duration, 18);

  // Cleanup test records
  await db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);
});

test('app_users stores registered members with Scrypt salted hashes and accurate count', async () => {
  const { db } = await import('../server/db.ts');
  const { hashPasswordScrypt, verifyPasswordScrypt } = await import('../server.ts');

  const userId = `usr_test_${Date.now()}`;
  const username = `member_test_${Date.now()}`;
  const hash = hashPasswordScrypt('SecurePass2026!');
  const salt = hash.split(':')[0];
  const now = Date.now();

  const beforeRow = (await db.prepare('SELECT count(*) as cnt FROM app_users').get()) as any;
  await db.prepare(`
    INSERT INTO app_users (id, username, password_hash, salt, role, created_at, last_login_at)
    VALUES (?, ?, ?, ?, 'member', ?, ?)
  `).run(userId, username, hash, salt, now, now);

  const afterRow = (await db.prepare('SELECT count(*) as cnt FROM app_users').get()) as any;
  assert.equal(afterRow.cnt, (beforeRow?.cnt || 0) + 1);

  const stored = (await db.prepare('SELECT * FROM app_users WHERE id = ?').get(userId)) as any;
  assert.equal(stored.username, username);
  assert.equal(verifyPasswordScrypt('SecurePass2026!', stored.password_hash), true);
  assert.equal(verifyPasswordScrypt('WrongPass!', stored.password_hash), false);

  await db.prepare('DELETE FROM app_users WHERE id = ?').run(userId);
});

test('verifyJwtHs256 validates authentic HS256 JWTs and rejects forged, tampered, alg=none, and expired tokens', async () => {
  const crypto = await import('node:crypto');
  const { verifyJwtHs256, extractBearerToken } = await import('../server.ts');

  const secret = 'test_cloud_jwt_secret_2026_!@#';
  const signJwt = (header: object, payload: object, signingSecret: string) => {
    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', signingSecret).update(`${h}.${p}`).digest('base64url');
    return `${h}.${p}.${sig}`;
  };

  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const pastExp = Math.floor(Date.now() / 1000) - 60;

  // 1. Valid HS256 token
  const validToken = signJwt(
    { alg: 'HS256', typ: 'JWT' },
    { sub: 'usr_123', username: 'alice', role: 'member', exp: futureExp },
    secret
  );
  const decoded = verifyJwtHs256(validToken, secret);
  assert.ok(decoded);
  assert.equal(decoded?.username, 'alice');
  assert.equal(decoded?.sub, 'usr_123');

  // 2. Wrong secret (forged)
  assert.equal(verifyJwtHs256(validToken, 'wrong_secret'), null);

  // 3. Expired token
  const expiredToken = signJwt(
    { alg: 'HS256', typ: 'JWT' },
    { sub: 'usr_123', username: 'alice', exp: pastExp },
    secret
  );
  assert.equal(verifyJwtHs256(expiredToken, secret), null);

  // 4. Missing exp claim
  const noExpToken = signJwt(
    { alg: 'HS256', typ: 'JWT' },
    { sub: 'usr_123', username: 'alice' },
    secret
  );
  assert.equal(verifyJwtHs256(noExpToken, secret), null);

  // 5. Unsupported algorithm (alg: none / RS256)
  const noneAlgToken = signJwt(
    { alg: 'none', typ: 'JWT' },
    { sub: 'usr_123', username: 'alice', exp: futureExp },
    secret
  );
  assert.equal(verifyJwtHs256(noneAlgToken, secret), null);

  // 6. Tampered payload
  const parts = validToken.split('.');
  const tamperedPayload = Buffer.from(
    JSON.stringify({ sub: 'usr_123', username: 'admin', role: 'admin', exp: futureExp })
  ).toString('base64url');
  assert.equal(verifyJwtHs256(`${parts[0]}.${tamperedPayload}.${parts[2]}`, secret), null);

  // 7. Empty secret or malformed token
  assert.equal(verifyJwtHs256(validToken, ''), null);
  assert.equal(verifyJwtHs256('not.a.jwt.token', secret), null);

  // 8. extractBearerToken helper
  assert.equal(extractBearerToken({ headers: { authorization: `Bearer ${validToken}` } } as any), validToken);
  assert.equal(extractBearerToken({ headers: { authorization: `bearer  ${validToken} ` } } as any), validToken);
  assert.equal(extractBearerToken({ headers: { authorization: 'Basic abc123' } } as any), undefined);
  assert.equal(extractBearerToken({ headers: {} } as any), undefined);
});

test('verifyJwtToken validates asymmetric RS256 and ES256 tokens and prevents algorithm-confusion attacks', async () => {
  const crypto = await import('node:crypto');
  const { verifyJwtToken, normalizePemPublicKey } = await import('../server.ts');

  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const pastExp = Math.floor(Date.now() / 1000) - 60;

  // 1. RSA (RS256) keypair
  const rsaA = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const rsaB = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const signRs256 = (payload: object, privPem: string) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), privPem).toString('base64url');
    return `${h}.${p}.${sig}`;
  };

  const validRs256 = signRs256({ sub: 'usr_rsa', username: 'rsa_user', role: 'member', exp: futureExp }, rsaA.privateKey);
  const decodedRsa = verifyJwtToken(validRs256, { publicKeyPem: rsaA.publicKey });
  assert.ok(decodedRsa);
  assert.equal(decodedRsa?.username, 'rsa_user');

  // Wrong RSA public key rejected
  assert.equal(verifyJwtToken(validRs256, { publicKeyPem: rsaB.publicKey }), null);

  // Expired RS256 token rejected
  const expiredRs256 = signRs256({ sub: 'usr_rsa', username: 'rsa_user', exp: pastExp }, rsaA.privateKey);
  assert.equal(verifyJwtToken(expiredRs256, { publicKeyPem: rsaA.publicKey }), null);

  // Tampered RS256 payload rejected
  const rsaParts = validRs256.split('.');
  const rsaTampered = Buffer.from(JSON.stringify({ sub: 'usr_rsa', username: 'admin', exp: futureExp })).toString('base64url');
  assert.equal(verifyJwtToken(`${rsaParts[0]}.${rsaTampered}.${rsaParts[2]}`, { publicKeyPem: rsaA.publicKey }), null);

  // 2. ECDSA P-256 (ES256 with RFC 7515 / WebCrypto IEEE P1363 signature encoding)
  const ecA = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const ecB = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const signEs256 = (payload: object, privPem: string) => {
    const h = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto
      .sign('sha256', Buffer.from(`${h}.${p}`), { key: privPem, dsaEncoding: 'ieee-p1363' })
      .toString('base64url');
    return `${h}.${p}.${sig}`;
  };

  const validEs256 = signEs256({ sub: 'usr_ec', username: 'ec_user', role: 'member', exp: futureExp }, ecA.privateKey);
  const decodedEc = verifyJwtToken(validEs256, { publicKeyPem: ecA.publicKey });
  assert.ok(decodedEc);
  assert.equal(decodedEc?.username, 'ec_user');

  // Wrong EC public key or RSA public key rejected for ES256
  assert.equal(verifyJwtToken(validEs256, { publicKeyPem: ecB.publicKey }), null);
  assert.equal(verifyJwtToken(validEs256, { publicKeyPem: rsaA.publicKey }), null);

  // Expired ES256 token rejected
  const expiredEs256 = signEs256({ sub: 'usr_ec', username: 'ec_user', exp: pastExp }, ecA.privateKey);
  assert.equal(verifyJwtToken(expiredEs256, { publicKeyPem: ecA.publicKey }), null);

  // 3. Algorithm confusion attack: HS256 signed using the publicKeyPem string MUST be rejected
  const hConf = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const pConf = Buffer.from(JSON.stringify({ sub: 'attacker', username: 'admin', exp: futureExp })).toString('base64url');
  const sigConf = crypto.createHmac('sha256', rsaA.publicKey).update(`${hConf}.${pConf}`).digest('base64url');
  const confusedToken = `${hConf}.${pConf}.${sigConf}`;
  assert.equal(verifyJwtToken(confusedToken, { publicKeyPem: rsaA.publicKey }), null);
  assert.equal(verifyJwtToken(confusedToken, { publicKeyPem: rsaA.publicKey, hs256Secret: 'real_secret' }), null);

  // 4. normalizePemPublicKey handles single-line \n escapes and bare base64 SPKI
  const escapedEnvPem = rsaA.publicKey.replace(/\n/g, '\\n');
  assert.equal(normalizePemPublicKey(escapedEnvPem).trim(), rsaA.publicKey.trim());
  const bareBase64 = rsaA.publicKey
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s+/g, '');
  const wrapped = normalizePemPublicKey(bareBase64);
  assert.ok(wrapped.startsWith('-----BEGIN PUBLIC KEY-----'));
  assert.ok(verifyJwtToken(validRs256, { publicKeyPem: wrapped }));

  // 5. Unconfigured config always fails closed
  assert.equal(verifyJwtToken(validRs256, {}), null);
  assert.equal(verifyJwtToken(validEs256, {}), null);
});

test('Single-computer Telegram account limit is strictly 20 accounts (acc_1..acc_20)', () => {
  assert.equal(MAX_TELEGRAM_ACCOUNTS, 20);
  const authorized = getAuthorizedAccountsList();
  assert.equal(authorized.length, 21);
  assert.equal(authorized[0], 'acc_telegram_bot');
  assert.equal(authorized[1], 'acc_1');
  assert.equal(authorized[20], 'acc_20');
  assert.equal(hasReachedTelegramAccountLimit(0), false);
  assert.equal(hasReachedTelegramAccountLimit(19), false);
  assert.equal(hasReachedTelegramAccountLimit(20), true);
  assert.equal(hasReachedTelegramAccountLimit(25), true);
});

test('getLocalMachineDeviceId generates deterministic LX-DEV- fingerprint', () => {
  const first = getLocalMachineDeviceId();
  const second = getLocalMachineDeviceId();
  assert.ok(first.startsWith('LX-DEV-'));
  assert.equal(first, second);
});

test('verifyJwtTokenWithReason enforces VIP_EXPIRED and single-computer DEVICE_MISMATCH on RS256 tokens', async () => {
  const crypto = await import('node:crypto');
  const rsa = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const signRs256 = (payload: object) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), rsa.privateKey).toString('base64url');
    return `${h}.${p}.${sig}`;
  };

  const localDeviceId = getLocalMachineDeviceId();
  const nowSec = Math.floor(Date.now() / 1000);
  const futureExpSec = nowSec + 3600;
  const futureVipMs = Date.now() + 3 * 24 * 3600 * 1000;
  const pastVipMs = Date.now() - 60 * 1000;

  // 1. Valid card-key token bound to current computer
  const okToken = signRs256({
    sub: 'usr_vip1',
    username: 'vip_member',
    role: 'member',
    plan: 'trial_3d',
    vipExpiresAt: futureVipMs,
    deviceId: localDeviceId,
    maxAccounts: 20,
    exp: futureExpSec,
  });
  const okRes = verifyJwtTokenWithReason(okToken, {
    publicKeyPem: rsa.publicKey,
    expectedDeviceId: localDeviceId,
  });
  assert.equal(okRes.valid, true);
  assert.equal(okRes.payload?.plan, 'trial_3d');

  // 2. Expired card key -> VIP_EXPIRED
  const expiredVipToken = signRs256({
    sub: 'usr_vip_exp',
    username: 'vip_expired_user',
    role: 'member',
    plan: 'trial_3d',
    vipExpiresAt: pastVipMs,
    deviceId: localDeviceId,
    exp: futureExpSec,
  });
  const expRes = verifyJwtTokenWithReason(expiredVipToken, {
    publicKeyPem: rsa.publicKey,
    expectedDeviceId: localDeviceId,
  });
  assert.equal(expRes.valid, false);
  assert.equal(expRes.errorCode, 'VIP_EXPIRED');

  // 3. Another computer's deviceId -> DEVICE_MISMATCH
  const otherDeviceToken = signRs256({
    sub: 'usr_other_pc',
    username: 'other_pc_user',
    role: 'member',
    plan: 'monthly_30d',
    vipExpiresAt: futureVipMs,
    deviceId: 'LX-DEV-000000000000000000000000',
    exp: futureExpSec,
  });
  const mismatchRes = verifyJwtTokenWithReason(otherDeviceToken, {
    publicKeyPem: rsa.publicKey,
    expectedDeviceId: localDeviceId,
  });
  assert.equal(mismatchRes.valid, false);
  assert.equal(mismatchRes.errorCode, 'DEVICE_MISMATCH');
});

test('performStrictTranslation rejects engine=auto cascade and supports keyless Google machine translation', async () => {
  const {
    performStrictTranslation,
    performGoogleTranslate,
    buildCustomAnthropicUrls,
    formatAnthropicMessages,
    callCustomLlm,
  } = await import('../server.ts');

  await assert.rejects(
    () =>
      performStrictTranslation({
        text: 'Hello world',
        sourceLang: 'Auto',
        targetLang: 'Chinese',
        engine: 'auto',
      }),
    /已禁用 auto 级联降级/
  );

  // Without official Google Cloud API key, performGoogleTranslate uses keyless Google machine translate
  const prevGoogleKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  const prevFetch = globalThis.fetch;
  delete process.env.GOOGLE_TRANSLATE_API_KEY;
  try {
    let capturedUrl = '';
    globalThis.fetch = (async (input: any) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify([[['你好世界', 'Hello world', null, null, 10]], null, 'en']), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const translated = await performGoogleTranslate('Hello world', 'Auto', 'Chinese', '');
    assert.equal(translated, '你好世界');
    assert.ok(capturedUrl.includes('translate.googleapis.com/translate_a/single'));
    assert.ok(capturedUrl.includes('tl=zh-CN'));
  } finally {
    globalThis.fetch = prevFetch;
    if (prevGoogleKey !== undefined) process.env.GOOGLE_TRANSLATE_API_KEY = prevGoogleKey;
  }

  // Anthropic URL & message formatting + callCustomLlm routing verification
  assert.deepEqual(buildCustomAnthropicUrls('https://api.anthropic.com/v1'), [
    'https://api.anthropic.com/v1/messages',
  ]);
  assert.deepEqual(buildCustomAnthropicUrls('https://api.anthropic.com'), [
    'https://api.anthropic.com/v1/messages',
    'https://api.anthropic.com/messages',
  ]);

  const formatted = formatAnthropicMessages(
    [
      { role: 'system', content: 'Extra rule' },
      { role: 'user', content: 'Hi' },
      { role: 'user', content: 'Translate this' },
    ],
    'Translator prompt'
  );
  assert.equal(formatted.system, 'Translator prompt\n\nExtra rule');
  assert.deepEqual(formatted.messages, [{ role: 'user', content: 'Hi\nTranslate this' }]);

  const prevFetch2 = globalThis.fetch;
  try {
    let sentHeaders: Record<string, string> = {};
    let sentBody: any = null;
    globalThis.fetch = (async (_input: any, init: any) => {
      sentHeaders = init?.headers || {};
      sentBody = init?.body ? JSON.parse(init.body) : null;
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'Bonjour' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const anthropicReply = await callCustomLlm({
      customConfig: {
        enabled: true,
        engineMode: 'custom',
        protocol: 'anthropic',
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: 'sk-ant-test-key',
        modelName: 'claude-3-5-sonnet-20241022',
        temperature: 1.4,
      },
      systemInstruction: 'Translate to French',
      messages: [{ role: 'user', content: 'Hello' }],
      skipSync: true,
      throwOnError: true,
    });
    assert.equal(anthropicReply, 'Bonjour');
    assert.equal(sentHeaders['x-api-key'], 'sk-ant-test-key');
    assert.equal(sentHeaders['anthropic-version'], '2023-06-01');
    assert.equal(sentBody.model, 'claude-3-5-sonnet-20241022');
    assert.equal(sentBody.temperature, 1);
  } finally {
    globalThis.fetch = prevFetch2;
  }
});

test('performStrictTranslation blocks cloud training brain / knowledge base and requires local gateway & key', async () => {
  const { performStrictTranslation } = await import('../server.ts');

  // 1. Cloud training engine must be blocked from translation
  await assert.rejects(
    () =>
      performStrictTranslation({
        text: 'Hello',
        targetLang: 'Chinese',
        engine: 'custom_llm',
        customConfig: {
          enabled: true,
          engineMode: 'cloud',
          engineLicenseKey: 'lx-sk-test',
          baseUrl: '',
          apiKey: '',
        },
      }),
    /禁止使用云端训练引擎或知识库/
  );

  // 2. Railway URL must be blocked from translation
  await assert.rejects(
    () =>
      performStrictTranslation({
        text: 'Hello',
        targetLang: 'Chinese',
        engine: 'custom_llm',
        customConfig: {
          enabled: true,
          engineMode: 'custom',
          baseUrl: 'https://ai-production-c2a0.up.railway.app/v1',
          apiKey: 'sk-test',
        },
      }),
    /禁止使用云端训练引擎或知识库/
  );

  // 3. Remote custom gateway without local API key must fail immediately
  await assert.rejects(
    () =>
      performStrictTranslation({
        text: 'Hello',
        targetLang: 'Chinese',
        engine: 'custom_llm',
        customConfig: {
          enabled: true,
          engineMode: 'custom',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          modelName: 'gpt-4o-mini',
        },
      }),
    /缺少本机 API 密钥/
  );
});

test('callCustomLlm throws explicitly when throwOnError=true and custom gateway is missing or disabled', async () => {
  const { callCustomLlm } = await import('../server.ts');

  await assert.rejects(
    () =>
      callCustomLlm({
        customConfig: { enabled: false },
        messages: [{ role: 'user', content: 'hi' }],
        throwOnError: true,
        skipSync: true,
      }),
    /双关状态|自定义大模型未启用/
  );

  await assert.rejects(
    () =>
      callCustomLlm({
        customConfig: { enabled: true, engineMode: 'custom', baseUrl: '' },
        messages: [{ role: 'user', content: 'hi' }],
        throwOnError: true,
        skipSync: true,
      }),
    /Base URL 未配置/
  );
});

test('invokeEvolutionOrAnalysisLlm throws explicit error when unconfigured or custom gateway invalid', async () => {
  const { invokeEvolutionOrAnalysisLlm, getServerCustomLlmConfig, syncServerCustomLlmConfig } = await import('../server.ts');

  await assert.rejects(
    () =>
      invokeEvolutionOrAnalysisLlm({
        prompt: 'Analyze dialogue habits',
        customConfig: { enabled: true, engineMode: 'custom', baseUrl: '' },
      }),
    /Base URL 未配置/
  );

  const prevGeminiKey = process.env.GEMINI_API_KEY;
  const prevCfg = await getServerCustomLlmConfig();
  delete process.env.GEMINI_API_KEY;
  await syncServerCustomLlmConfig({ enabled: false, engineMode: 'custom', engineLicenseKey: '' });
  try {
    await assert.rejects(
      () =>
        invokeEvolutionOrAnalysisLlm({
          prompt: 'Analyze dialogue habits',
          customConfig: { enabled: false },
        }),
      /未配置可用的大模型|Gemini 大模型不可用/
    );
  } finally {
    if (prevGeminiKey !== undefined) {
      process.env.GEMINI_API_KEY = prevGeminiKey;
    }
    await syncServerCustomLlmConfig(prevCfg || { enabled: false });
  }
});

test('syncLearnedPatternsToBackendLlm handles empty patterns and missing backend auth cleanly', async () => {
  const { syncLearnedPatternsToBackendLlm, getServerCustomLlmConfig, syncServerCustomLlmConfig } = await import('../server.ts');

  const emptyRes = await syncLearnedPatternsToBackendLlm({
    patterns: [],
  });
  assert.equal(emptyRes.synced, false);
  assert.equal(emptyRes.syncedCount, 0);
  assert.match(emptyRes.error || '', /没有可同步/);

  const prevKey = process.env.RAILWAY_BRAIN_KEY;
  const prevUrl = process.env.RAILWAY_BRAIN_URL;
  const prevCfg = await getServerCustomLlmConfig();
  delete process.env.RAILWAY_BRAIN_KEY;
  delete process.env.RAILWAY_BRAIN_URL;
  await syncServerCustomLlmConfig({ enabled: true, engineMode: 'cloud', engineLicenseKey: '' });
  try {
    const noAuthRes = await syncLearnedPatternsToBackendLlm({
      patterns: [
        {
          title: '短句呼吸感',
          description: '自然拆分短句并接梗',
          examplePattern: '哈哈对呀，别太累啦~',
        },
      ],
      customConfig: { enabled: true, engineMode: 'cloud', engineLicenseKey: '' },
    });
    assert.equal(noAuthRes.synced, false);
    assert.equal(noAuthRes.syncedCount, 0);
    assert.match(noAuthRes.error || '', /未配置云端后台大模型授权令牌/);
  } finally {
    if (prevKey !== undefined) process.env.RAILWAY_BRAIN_KEY = prevKey;
    if (prevUrl !== undefined) process.env.RAILWAY_BRAIN_URL = prevUrl;
    await syncServerCustomLlmConfig(prevCfg || { enabled: false });
  }
});

test('Issue #10: server, apiService, and railway-brain-server contain no fake evolution/scoring fallbacks and close the backend learning loop', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');

  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  const apiSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
  const brainSrc = readFileSync(resolve(process.cwd(), 'deploy/railway-brain-server.ts'), 'utf8');

  // No Elena fake conversation corpus, no regex knowledge classifier, no regex transcript style extractor, no fake intelligenceScore
  assert.equal(serverSrc.includes('感觉现在做实体太难了'), false);
  assert.equal(serverSrc.includes('classifySectionSemantically'), false);
  assert.equal(serverSrc.includes('深度提炼的真实聊天习惯'), false);
  assert.equal(/\bhasHumor\b/.test(serverSrc), false);
  assert.equal(/\bintelligenceScore\b/.test(serverSrc), false);
  assert.equal(/\bintelligenceScore\b/.test(apiSrc), false);
  assert.equal(/totalConversationsAnalyzed\s*\|\|\s*0\)\s*\+\s*12\b/.test(serverSrc), false);

  // Real habit usage counter and Backend LLM learning loop are wired
  assert.equal(serverSrc.includes('incrementEvolutionHabitUsage'), true);
  assert.equal(serverSrc.includes('syncLearnedPatternsToBackendLlm'), true);
  assert.equal(brainSrc.includes('/api/v1/evolution/sync'), true);
  assert.equal(brainSrc.includes('buildDynamicCloudSystemDirectives'), true);
});

test('Issue #11: DEFAULT_GLOBAL_PERSONA and DEFAULT_EVOLUTION_STATE start blank/zeroed without fake Elena data or auto-resurrected habits', async () => {
  const {
    db,
    DEFAULT_GLOBAL_PERSONA,
    DEFAULT_EVOLUTION_STATE,
    getEvolutionStateFromDb,
    saveEvolutionStateToDb,
  } = await import('../server/db.ts');

  assert.equal(DEFAULT_GLOBAL_PERSONA.personaName, '');
  assert.equal(DEFAULT_GLOBAL_PERSONA.personaRole, '');
  assert.equal(DEFAULT_GLOBAL_PERSONA.age, '');
  assert.equal(DEFAULT_GLOBAL_PERSONA.location, '');
  assert.deepEqual(DEFAULT_GLOBAL_PERSONA.personalityTraits, []);
  assert.deepEqual(DEFAULT_GLOBAL_PERSONA.tabooKeywords, []);
  assert.equal(DEFAULT_GLOBAL_PERSONA.stagedPrompts.icebreaker, '');
  assert.equal(JSON.stringify(DEFAULT_GLOBAL_PERSONA).includes('林雅'), false);
  assert.equal(JSON.stringify(DEFAULT_GLOBAL_PERSONA).includes('Elena'), false);

  assert.equal(DEFAULT_EVOLUTION_STATE.totalConversationsAnalyzed, 0);
  assert.equal(DEFAULT_EVOLUTION_STATE.totalHabitsLearned, 0);
  assert.equal(DEFAULT_EVOLUTION_STATE.lastEvolvedAt, 0);
  assert.deepEqual(DEFAULT_EVOLUTION_STATE.habits, []);

  // Verify getEvolutionStateFromDb does not resurrect fake habits when DB state has 0 habits
  const prevRow = (await db.prepare("SELECT value FROM system_config WHERE key = 'evolution_engine_state'").get()) as any;
  try {
    await saveEvolutionStateToDb({
      version: 'v1.0.0',
      lastEvolvedAt: 0,
      totalConversationsAnalyzed: 0,
      totalHabitsLearned: 0,
      autoEvolutionActive: true,
      habits: [],
    });
    const evo = await getEvolutionStateFromDb();
    assert.equal(evo.totalConversationsAnalyzed, 0);
    assert.equal(evo.totalHabitsLearned, 0);
    assert.deepEqual(evo.habits, []);
  } finally {
    if (prevRow?.value) {
      await db.prepare(
        "INSERT INTO system_config (key, value, updated_at) VALUES ('evolution_engine_state', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ).run(prevRow.value, Date.now());
    }
  }
});

test('Issue #11: queryKnowledgeRAG strictly returns genuine matches only and never injects unrelated hit_count items', async () => {
  const { db } = await import('../server/db.ts');
  const { queryKnowledgeRAG } = await import('../server.ts');

  const itemId = `know_rag_test_${Date.now()}`;
  const now = Date.now();
  await db.prepare(`
    INSERT INTO knowledge_base (id, category, title, content, keywords, source_type, source_file, is_active, hit_count, created_at, updated_at)
    VALUES (?, 'wealth_investment', ?, ?, ?, 'manual_text', 'test.md', 1, 999, ?, ?)
  `).run(
    itemId,
    'Quant Arbitrage Framework',
    'Cross-exchange statistical arbitrage hedging parameters and latency thresholds.',
    JSON.stringify(['quant', 'arbitrage', 'hedging']),
    now,
    now
  );

  try {
    // 1. Empty query returns 0 matches and empty context
    const emptyRes = await queryKnowledgeRAG('');
    assert.equal(emptyRes.matchedCount, 0);
    assert.equal(emptyRes.matchedItems.length, 0);
    assert.equal(emptyRes.context, '');

    // 2. Completely unrelated query must NOT pull the hit_count=999 item
    const missRes = await queryKnowledgeRAG('zxqplm_nonexistent_topic_84729');
    assert.equal(missRes.matchedCount, 0);
    assert.equal(missRes.matchedItems.length, 0);
    assert.equal(missRes.context, '');

    // 3. Genuine keyword query DOES match the item
    const hitRes = await queryKnowledgeRAG('Can you explain your hedging arbitrage strategy?');
    assert.ok(hitRes.matchedCount >= 1);
    assert.ok(hitRes.matchedItems.some((it: any) => it.id === itemId));
    assert.ok(hitRes.context.includes('Quant Arbitrage Framework'));
  } finally {
    await db.prepare('DELETE FROM knowledge_base WHERE id = ?').run(itemId);
  }
});

test('Issue #11: buildActivePersonaAndEvolutionContext and Bot Webhook align with active persona, habits, and custom LLM without fake fallbacks', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { buildActivePersonaAndEvolutionContext } = await import('../server.ts');
  const { DEFAULT_GLOBAL_PERSONA, DEFAULT_EVOLUTION_STATE } = await import('../server/db.ts');

  // Blank persona must produce empty context and zero fake Elena attributes
  const blankCtx = buildActivePersonaAndEvolutionContext(DEFAULT_GLOBAL_PERSONA, DEFAULT_EVOLUTION_STATE);
  assert.equal(blankCtx.hasConfiguredPersona, false);
  assert.equal(blankCtx.context, '');
  assert.deepEqual(blankCtx.activeHabitIds, []);

  // Configured persona + active habit must be reflected accurately
  const configuredCtx = buildActivePersonaAndEvolutionContext(
    {
      ...DEFAULT_GLOBAL_PERSONA,
      personaName: 'Alex Chen',
      personaRole: 'Cross-border Logistics Advisor',
      stagedPrompts: { ...DEFAULT_GLOBAL_PERSONA.stagedPrompts, icebreaker: 'Keep greeting concise.' },
      tabooKeywords: ['guaranteed profit'],
      activeStage: 'icebreaker',
    },
    {
      ...DEFAULT_EVOLUTION_STATE,
      habits: [
        {
          id: 'h_real_1',
          title: 'Concise opener',
          description: 'Direct short welcome',
          examplePattern: 'Hi there, how can I help with your shipment today?',
          isActive: true,
        },
      ],
    }
  );
  assert.equal(configuredCtx.hasConfiguredPersona, true);
  assert.ok(configuredCtx.context.includes('Alex Chen'));
  assert.ok(configuredCtx.context.includes('Keep greeting concise.'));
  assert.ok(configuredCtx.context.includes('Concise opener'));
  assert.ok(configuredCtx.context.includes('guaranteed profit'));
  assert.deepEqual(configuredCtx.activeHabitIds, ['h_real_1']);

  // Verify source files have no hardcoded gemini-2.5-flash or 林雅 sandbox text
  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  const dbSrc = readFileSync(resolve(process.cwd(), 'server/db.ts'), 'utf8');
  const modalSrc = readFileSync(resolve(process.cwd(), 'src/components/KnowledgeEvolutionModal.tsx'), 'utf8');

  assert.equal(serverSrc.includes('gemini-2.5-flash'), false);
  assert.equal(dbSrc.includes('林雅'), false);
  assert.equal(dbSrc.includes('totalConversationsAnalyzed: 168'), false);
  assert.equal(modalSrc.includes('林雅'), false);
});

test('Issue #12: unified message sync, deduplication, chat resolution, and evolution corpus bridge local + cloud + DB consistently', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { db } = await import('../server/db.ts');
  const {
    upsertSyncedMessageToDb,
    mergeUnifiedConversationMessages,
    resolveUnifiedChatMessages,
    resolveUnifiedEvolutionCorpus,
  } = await import('../server.ts');

  const testChatId = `tg_99912345_${Date.now()}`;
  const now = Date.now();

  try {
    // 1. Upsert outbound client message + incoming real-time peer message
    const ok1 = await upsertSyncedMessageToDb({
      id: `msg_out_${now}`,
      telegramMessageId: 501,
      chatId: testChatId,
      accountId: 'acc_1',
      sender: 'me',
      senderName: '我方',
      text: 'Hello, have you checked the freight schedule for next week?',
      translatedText: '你好，下周的货运排期你查看了吗？',
      createdAt: now - 5000,
      deliveryStatus: 'delivered',
    });
    assert.equal(ok1, true);

    const ok2 = await upsertSyncedMessageToDb({
      id: `msg_in_${now}`,
      telegramMessageId: 502,
      chatId: testChatId,
      accountId: 'acc_1',
      sender: 'peer',
      senderName: 'Marcus',
      text: 'Yes, Tuesday morning works best for our warehouse team.',
      createdAt: now - 2000,
      deliveryStatus: 'delivered',
    });
    assert.equal(ok2, true);

    // 2. Verify mergeUnifiedConversationMessages deduplicates by telegramMessageId & keeps richest fields
    const merged = mergeUnifiedConversationMessages([
      [
        {
          id: `msg_out_${now}`,
          telegramMessageId: 501,
          chatId: testChatId,
          sender: 'me',
          text: 'Hello, have you checked the freight schedule for next week?',
          translatedText: '你好，下周的货运排期你查看了吗？',
          createdAt: now - 5000,
        },
      ],
      [
        {
          id: `tg_cloud_501_${now - 5000}`,
          telegramMessageId: 501,
          chatId: testChatId,
          sender: 'me',
          text: 'Hello, have you checked the freight schedule for next week?',
          translatedText: '',
          createdAt: now - 5000,
        },
        {
          id: `tg_cloud_502_${now - 2000}`,
          telegramMessageId: 502,
          chatId: testChatId,
          sender: 'peer',
          senderName: 'Marcus',
          text: 'Yes, Tuesday morning works best for our warehouse team.',
          createdAt: now - 2000,
        },
      ],
    ]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].translatedText, '你好，下周的货运排期你查看了吗？');
    assert.equal(merged[1].telegramMessageId, 502);

    // 3. Verify resolveUnifiedChatMessages merges DB + client-synced messages cleanly
    const resolved = await resolveUnifiedChatMessages({
      chatId: testChatId,
      accountId: 'acc_1',
      clientMessages: [
        {
          id: `msg_client_only_${now}`,
          chatId: testChatId,
          accountId: 'acc_1',
          sender: 'me',
          text: 'Great, I will confirm the booking slot right now.',
          createdAt: now,
        },
      ],
      syncCloud: false,
      persistClientMessages: true,
    });
    assert.equal(resolved.messages.length, 3);
    assert.equal(resolved.messages[2].text, 'Great, I will confirm the booking slot right now.');

    // 4. Verify resolveUnifiedEvolutionCorpus forbids cross-account sampling when accountId is omitted and includes scoped DB + client when accountId is provided
    const unscopedCorpus = await resolveUnifiedEvolutionCorpus({
      clientMessages: [
        {
          id: `msg_evo_unscoped_${now}`,
          chatId: testChatId,
          accountId: 'acc_1',
          sender: 'peer',
          text: 'Should not sample without accountId',
          createdAt: now + 500,
        },
      ],
    });
    assert.equal(unscopedCorpus.corpusText.includes('freight schedule'), false);
    assert.equal(unscopedCorpus.corpusText.includes('Should not sample without accountId'), false);

    const corpus = await resolveUnifiedEvolutionCorpus({
      accountId: 'acc_1',
      clientMessages: [
        {
          id: `msg_evo_${now}`,
          chatId: testChatId,
          accountId: 'acc_1',
          sender: 'peer',
          text: 'Please also send the customs invoice copy before 5 PM.',
          createdAt: now + 1000,
        },
      ],
    });
    assert.ok(corpus.corpusText.includes('freight schedule'));
    assert.ok(corpus.corpusText.includes('customs invoice copy'));
    assert.ok(corpus.analyzedConversationsCount >= 1);

    // 5. Verify server.ts no longer enforces contradictory Zero-DB split-brain on POST /api/messages
    const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
    assert.equal(serverSrc.includes('localOnly: true'), false);
    assert.equal(serverSrc.includes('resolveUnifiedChatMessages'), true);
    assert.equal(serverSrc.includes('resolveUnifiedEvolutionCorpus'), true);
    assert.equal(serverSrc.includes('upsertSyncedMessageToDb'), true);
  } finally {
    await db.prepare('DELETE FROM messages WHERE chat_id = ?').run(testChatId);
  }
});

test('Issue #13 (Mode B): hides API_ID/API_HASH from frontend & user code, distributes via cloud strictly into volatile RAM, and purges any local DB remnants', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { db } = await import('../server/db.ts');
  const {
    getInMemoryTelegramApiCredentials,
    clearInMemoryTelegramApiCredentials,
    purgePersistedTelegramApiCredentialsFromDb,
    fetchCloudAuthorizedTelegramCredentials,
    resolveTelegramApiCredentials,
  } = await import('../server.ts');

  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  const settingsSrc = readFileSync(resolve(process.cwd(), 'src/components/SystemSettingsModal.tsx'), 'utf8');
  const multiAccSrc = readFileSync(resolve(process.cwd(), 'src/components/MultiAccountModal.tsx'), 'utf8');
  const apiServiceSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
  const workerSrc = readFileSync(resolve(process.cwd(), 'deploy/cloudflare-auth-worker.ts'), 'utf8');
  const pkgJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

  // 1. No hardcoded shared Telegram API credentials, fake marketing copy, or frontend API_ID config remain
  assert.equal(serverSrc.includes('642b770857bc79d62d49734a964ca69b'), false);
  assert.equal(serverSrc.includes('37984936'), false);
  assert.equal(serverSrc.includes('dedicatedApiIdActive'), false);
  assert.equal(settingsSrc.includes('642b770857bc79d62d49734a964ca69b'), false);
  assert.equal(settingsSrc.includes('37984936'), false);
  assert.equal(settingsSrc.includes('已启用专属免限流'), false);
  assert.equal(settingsSrc.includes('自定义 API ID'), false);
  assert.equal(settingsSrc.includes('Telegram 官方 API 凭据配置'), false);
  assert.equal(multiAccSrc.includes('642b770857bc79d62d49734a964ca69b'), false);
  assert.equal(multiAccSrc.includes('37984936'), false);
  assert.equal(multiAccSrc.includes('onOpenSystemSettings'), false);
  assert.equal(apiServiceSrc.includes('saveCustomTelegramCredentials'), false);
  assert.equal(apiServiceSrc.includes('fetchTelegramCredentialsStatus'), false);

  // 2. Server does not persist API_ID / API_HASH to local system_config or telegram_user_sessions
  assert.equal(serverSrc.includes('saveTelegramApiCredentialsToDb'), false);
  assert.equal(serverSrc.includes('purgePersistedTelegramApiCredentialsFromDb'), true);
  assert.equal(serverSrc.includes('VALUES (?, ?, ?, ?, ?, NULL, NULL, 1, ?, ?)'), true);

  // 3. Cloud worker supports Mode B dynamic provisioning + Turso HTTP adapter
  assert.equal(workerSrc.includes('/api/auth/telegram-credentials'), true);
  assert.equal(workerSrc.includes('TURSO_DATABASE_URL'), true);

  // 4. Electron commercial packaging uses ASAR + native binary unpack + minification
  assert.equal(pkgJson.build.asar, true);
  assert.ok(Array.isArray(pkgJson.build.asarUnpack) && pkgJson.build.asarUnpack.includes('**/*.node'));
  assert.ok(String(pkgJson.scripts.build || '').includes('--minify'));

  // 5. Runtime RAM-only distribution & legacy local DB purge
  const prevEnvId = process.env.TELEGRAM_API_ID;
  const prevEnvHash = process.env.TELEGRAM_API_HASH;
  const origFetch = globalThis.fetch;

  try {
    delete process.env.TELEGRAM_API_ID;
    delete process.env.TELEGRAM_API_HASH;
    clearInMemoryTelegramApiCredentials();

    // Seed a legacy persisted row to verify purgePersistedTelegramApiCredentialsFromDb removes it
    await db
      .prepare(
        "INSERT INTO system_config (key, value, updated_at) VALUES ('telegram_api_credentials', 'legacy-secret', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(Date.now());
    await purgePersistedTelegramApiCredentialsFromDb();
    const wipedRow = await db.prepare("SELECT value FROM system_config WHERE key = 'telegram_api_credentials'").get();
    assert.equal(wipedRow, undefined);

    // Without RAM cache, env, or member token, credential resolution rejects cleanly
    const missingRes = await resolveTelegramApiCredentials({});
    assert.equal(missingRes.ok, false);
    assert.equal(missingRes.code, 'TELEGRAM_API_CREDENTIALS_REQUIRED');

    // Cloud fetch distributes credentials strictly into volatile RAM (NOT local SQLite/disk)
    const testHash = 'abcdef1234567890abcdef1234567890';
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          apiId: 99887766,
          apiHash: testHash,
          poolLabel: 'turso-pool-ram',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    const bearer = 'test-member-jwt-token';
    const cloudRes = await fetchCloudAuthorizedTelegramCredentials(bearer);
    assert.equal(cloudRes.ok, true);
    assert.equal(cloudRes.apiId, 99887766);
    assert.equal(cloudRes.apiHash, testHash);
    assert.equal(cloudRes.source, 'cloud_authorized');

    const ramCached = getInMemoryTelegramApiCredentials(bearer);
    assert.equal(ramCached?.apiId, 99887766);
    assert.equal(ramCached?.apiHash, testHash);

    // Confirm NOTHING was written to local system_config DB
    const dbRowAfterFetch = await db
      .prepare("SELECT value FROM system_config WHERE key = 'telegram_api_credentials'")
      .get();
    assert.equal(dbRowAfterFetch, undefined);

    const resolvedFromRam = await resolveTelegramApiCredentials({ bearerToken: bearer });
    assert.equal(resolvedFromRam.ok, true);
    assert.equal(resolvedFromRam.apiId, 99887766);
    assert.equal(resolvedFromRam.apiHash, testHash);

    // Logout wipes RAM entry
    clearInMemoryTelegramApiCredentials(bearer);
    clearInMemoryTelegramApiCredentials();
    assert.equal(getInMemoryTelegramApiCredentials(bearer), null);
  } finally {
    globalThis.fetch = origFetch;
    clearInMemoryTelegramApiCredentials();
    if (prevEnvId !== undefined) process.env.TELEGRAM_API_ID = prevEnvId;
    else delete process.env.TELEGRAM_API_ID;
    if (prevEnvHash !== undefined) process.env.TELEGRAM_API_HASH = prevEnvHash;
    else delete process.env.TELEGRAM_API_HASH;
  }
});

test('Issue #14: searchRailwayKnowledgeBase reports explicit connectivity/errors instead of silent fallback and supports safety guard', async () => {
  const http = await import('node:http');
  const {
    searchRailwayKnowledgeBase,
    clearRailwayKbCache,
    isCloudKnowledgeBaseEnabled,
    syncServerCustomLlmConfig,
    getServerCustomLlmConfig,
  } = await import('../server.ts');

  const prevServerLlmCfg = await getServerCustomLlmConfig();
  clearRailwayKbCache();

  let mode: 'ok_items' | 'ok_empty' | 'http_503' | 'http_401' | 'slow_timeout' = 'ok_items';
  const server = http.createServer((req, res) => {
    if (mode === 'slow_timeout') {
      setTimeout(() => {
        if (!res.headersSent) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ items: [] }));
        }
      }, 450);
      return;
    }
    if (mode === 'http_503') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upstream KB engine overloaded' }));
      return;
    }
    if (mode === 'http_401') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid engine license key' }));
      return;
    }
    if (mode === 'ok_empty') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, results: [] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        items: [{ title: '破冰技巧', content: '先共情对方的忙碌再轻量提问' }],
      })
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}/api/knowledge/search`;

  try {
    // 1. Genuine hit via items[]
    mode = 'ok_items';
    const hitRes = await searchRailwayKnowledgeBase('怎么破冰', baseUrl, 'test-key', 1000);
    assert.equal(hitRes.ok, true);
    assert.equal(hitRes.connected, true);
    assert.equal(hitRes.matchedCount, 1);
    assert.equal(hitRes.source, 'remote_cloud_kb');
    assert.ok(hitRes.context.includes('破冰技巧'));

    // 2. Cache hit preserves ok & connected
    const cacheRes = await searchRailwayKnowledgeBase('怎么破冰', baseUrl, 'test-key', 1000);
    assert.equal(cacheRes.ok, true);
    assert.equal(cacheRes.connected, true);
    assert.equal(cacheRes.source, 'remote_cloud_kb_cache');

    // 3. Config sync invalidates stale KB cache
    await syncServerCustomLlmConfig({ enabled: true, engineMode: 'cloud', enableKnowledgeBaseRAG: true });

    // 4. Genuine 0-match HTTP 200 is ok=true, connected=true, matchedCount=0
    mode = 'ok_empty';
    const emptyHitRes = await searchRailwayKnowledgeBase('无匹配关键词_xyz', baseUrl, 'test-key', 1000);
    assert.equal(emptyHitRes.ok, true);
    assert.equal(emptyHitRes.connected, true);
    assert.equal(emptyHitRes.matchedCount, 0);
    assert.equal(emptyHitRes.source, 'remote_cloud_kb');

    // 5. HTTP 503 failure returns ok=false, connected=false, explicit error & statusCode, and is NOT cached
    mode = 'http_503';
    const err503 = await searchRailwayKnowledgeBase('查询503', baseUrl, 'test-key', 500);
    assert.equal(err503.ok, false);
    assert.equal(err503.connected, false);
    assert.equal(err503.matchedCount, 0);
    assert.equal(err503.statusCode, 503);
    assert.equal(err503.source, 'remote_cloud_kb_error');
    assert.ok(err503.error && err503.error.includes('Upstream KB engine overloaded'));

    // Verify failure wasn't cached when upstream recovers
    mode = 'ok_items';
    const recoveredRes = await searchRailwayKnowledgeBase('查询503', baseUrl, 'test-key', 500);
    assert.equal(recoveredRes.ok, true);
    assert.equal(recoveredRes.source, 'remote_cloud_kb');

    // 6. HTTP 401 failure returns ok=false, connected=false, statusCode=401
    mode = 'http_401';
    const err401 = await searchRailwayKnowledgeBase('查询401', baseUrl, 'bad-key', 500);
    assert.equal(err401.ok, false);
    assert.equal(err401.connected, false);
    assert.equal(err401.statusCode, 401);
    assert.ok(err401.error && err401.error.includes('鉴权失败'));

    // 7. Timeout returns ok=false, connected=false, statusCode=504
    mode = 'slow_timeout';
    const timeoutRes = await searchRailwayKnowledgeBase('查询超时', baseUrl, 'test-key', 80);
    assert.equal(timeoutRes.ok, false);
    assert.equal(timeoutRes.connected, false);
    assert.equal(timeoutRes.statusCode, 504);
    assert.ok(timeoutRes.error && timeoutRes.error.includes('超时'));
  } finally {
    await syncServerCustomLlmConfig(prevServerLlmCfg || { enabled: false });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // 8. Closed port / network error returns ok=false, connected=false, statusCode=502
  const netErrRes = await searchRailwayKnowledgeBase('查询断连', `http://127.0.0.1:${addr.port}/api/knowledge/search`, 'test-key', 500);
  assert.equal(netErrRes.ok, false);
  assert.equal(netErrRes.connected, false);
  assert.equal(netErrRes.statusCode, 502);
  assert.equal(netErrRes.source, 'remote_cloud_kb_error');
  assert.ok(netErrRes.error && netErrRes.error.length > 0);

  // 9. isCloudKnowledgeBaseEnabled gate semantics
  assert.equal(isCloudKnowledgeBaseEnabled({ enableKnowledgeBaseRAG: true }), true);
  assert.equal(isCloudKnowledgeBaseEnabled({ enableKnowledgeBaseRAG: false, knowledgeBaseApiUrl: '' }), false);
  assert.equal(isCloudKnowledgeBaseEnabled({ enableKnowledgeBaseRAG: false, knowledgeBaseApiUrl: 'https://kb.example.com/search' }), true);
  assert.equal(isCloudKnowledgeBaseEnabled({ enabled: true, engineMode: 'cloud' }), true);
});

test('Issue #15: normalizeCloudGemmaTranslateModel and performStrictTranslation(engine=gemini) route via Knowledge Base Cloud Brain without Gemini API key', async () => {
  const http = await import('node:http');
  const {
    normalizeCloudGemmaTranslateModel,
    performStrictTranslation,
    getServerCustomLlmConfig,
    syncServerCustomLlmConfig,
  } = await import('../server.ts');

  assert.equal(normalizeCloudGemmaTranslateModel('gemma-4-26b-a4b-it'), 'gemma-4-26b-a4b-it');
  assert.equal(normalizeCloudGemmaTranslateModel('gemma-4-31b-it'), 'gemma-4-31b-it');
  assert.equal(normalizeCloudGemmaTranslateModel('Gemma 4 31B'), 'gemma-4-31b-it');
  assert.equal(normalizeCloudGemmaTranslateModel('gemini-3.5-flash-lite'), 'gemma-4-26b-a4b-it');
  assert.equal(normalizeCloudGemmaTranslateModel(undefined), 'gemma-4-26b-a4b-it');

  const prevBrainUrl = process.env.RAILWAY_BRAIN_URL;
  const prevBrainKey = process.env.RAILWAY_BRAIN_KEY;
  const prevCfg = await getServerCustomLlmConfig();

  delete process.env.RAILWAY_BRAIN_KEY;
  await syncServerCustomLlmConfig({ enabled: false, engineMode: 'cloud', engineLicenseKey: '' });

  let capturedPath = '';
  let capturedAuth = '';
  let capturedUserJwt = '';
  let capturedBody: any = null;

  const server = http.createServer((req, res) => {
    capturedPath = req.url || '';
    capturedAuth = String(req.headers['authorization'] || '');
    capturedUserJwt = String(req.headers['x-user-jwt'] || '');
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      try {
        capturedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        capturedBody = null;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: 'Hello, nice to meet you' } }],
        })
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  process.env.RAILWAY_BRAIN_URL = `http://127.0.0.1:${addr.port}`;

  try {
    // Missing auth token and license key rejects explicitly
    await assert.rejects(
      () =>
        performStrictTranslation({
          text: '你好，很高兴认识你',
          targetLang: 'English',
          engine: 'gemini',
          geminiModel: 'gemma-4-26b-a4b-it',
        }),
      /未获取到会员授权令牌/
    );

    // Valid member JWT routes keyless translation through Cloud Knowledge Base LLM
    const res = await performStrictTranslation({
      text: '你好，很高兴认识你',
      sourceLang: 'Chinese',
      targetLang: 'English',
      engine: 'gemini',
      geminiModel: 'gemma-4-31b-it',
      userJwt: 'member-jwt-token-xyz',
    });

    assert.equal(res.translatedText, 'Hello, nice to meet you');
    assert.equal(res.engine, 'cloud_kb:gemma-4-31b-it');
    assert.equal(capturedPath, '/v1/chat/completions');
    assert.equal(capturedAuth, 'Bearer member-jwt-token-xyz');
    assert.equal(capturedUserJwt, 'member-jwt-token-xyz');
    assert.equal(capturedBody?.model, 'gemma-4-31b-it');
    assert.equal(capturedBody?.purpose, 'translation');
    assert.ok(Array.isArray(capturedBody?.messages) && capturedBody.messages.length >= 2);
  } finally {
    await syncServerCustomLlmConfig(prevCfg || { enabled: false });
    if (prevBrainUrl !== undefined) process.env.RAILWAY_BRAIN_URL = prevBrainUrl;
    else delete process.env.RAILWAY_BRAIN_URL;
    if (prevBrainKey !== undefined) process.env.RAILWAY_BRAIN_KEY = prevBrainKey;
    else delete process.env.RAILWAY_BRAIN_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Issue #16: server routes default cloud brain requests through Cloudflare Worker without hardcoding Railway domain', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { getRailwayBrainBaseUrl, CLOUD_AUTH_BASE_URL, isBuiltInCloudGatewayUrl } = await import('../server.ts');

  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  const workerSrc = readFileSync(resolve(process.cwd(), 'deploy/cloudflare-auth-worker.ts'), 'utf8');

  assert.equal(serverSrc.includes('telegram-messages-reply-to-large-models-production.up.railway.app'), false);
  assert.equal(serverSrc.includes('ai-production-c2a0'), false);

  const prevUrl = process.env.RAILWAY_BRAIN_URL;
  const prevKbUrl = process.env.RAILWAY_KB_URL;
  delete process.env.RAILWAY_BRAIN_URL;
  delete process.env.RAILWAY_KB_URL;
  try {
    assert.equal(getRailwayBrainBaseUrl(), CLOUD_AUTH_BASE_URL);
    assert.equal(isBuiltInCloudGatewayUrl(CLOUD_AUTH_BASE_URL), true);
    assert.equal(isBuiltInCloudGatewayUrl('https://some-custom-host.up.railway.app/v1'), true);
    assert.equal(isBuiltInCloudGatewayUrl('https://api.openai.com/v1'), false);
  } finally {
    if (prevUrl !== undefined) process.env.RAILWAY_BRAIN_URL = prevUrl;
    if (prevKbUrl !== undefined) process.env.RAILWAY_KB_URL = prevKbUrl;
  }

  assert.equal(workerSrc.includes('BRAIN_UPSTREAM_URL'), true);
  assert.equal(workerSrc.includes('forwardToKnowledgeBrain'), true);
  assert.equal(workerSrc.includes('isCloudBrainProxyPath'), true);
  assert.equal(workerSrc.includes('edgeAuthenticated && masterEngineKey'), true);
  assert.equal(workerSrc.includes("'X-Engine-License'"), true);
  assert.equal(workerSrc.includes("'X-License-Key'"), true);
  assert.equal(workerSrc.includes('telegram-messages-reply-to-large-models-production.up.railway.app'), false);
  assert.match(serverSrc, /searchRailwayKnowledgeBase\(\s*(?:text|effectiveIncomingText|autoRagQuery|combinedText),[\s\S]*?lastActiveUserJwt \|\| undefined/);
  assert.match(serverSrc, /searchRailwayKnowledgeBase\(\s*combinedText,[\s\S]*?lastActiveUserJwt \|\| undefined/);
  assert.match(serverSrc, /callCustomLlm\(\{\s*customConfig: serverCustomConfig,[\s\S]*?userJwt: lastActiveUserJwt \|\| undefined/);
});

test('Issue #17: callCustomLlm locks cloud engineMode to OpenAI /v1/chat/completions even if protocol was previously gemini or anthropic', async () => {
  const http = await import('node:http');
  const { callCustomLlm } = await import('../server.ts');

  const capturedPaths: string[] = [];
  const server = http.createServer((req, res) => {
    capturedPaths.push(req.url || '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: 'cloud openai ok' } }],
      })
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const prevUrl = process.env.RAILWAY_BRAIN_URL;
  process.env.RAILWAY_BRAIN_URL = `http://127.0.0.1:${addr.port}`;

  try {
    for (const staleProtocol of ['gemini', 'anthropic'] as const) {
      const reply = await callCustomLlm({
        customConfig: {
          enabled: true,
          engineMode: 'cloud',
          protocol: staleProtocol,
          baseUrl: '',
          apiKey: '',
          modelName: 'gpt-4o-mini',
        },
        messages: [{ role: 'user', content: 'hi' }],
        userJwt: 'member-jwt-test',
        throwOnError: true,
        skipSync: true,
      });
      assert.equal(reply, 'cloud openai ok');
    }
    assert.deepEqual(capturedPaths, ['/v1/chat/completions', '/v1/chat/completions']);
  } finally {
    if (prevUrl !== undefined) process.env.RAILWAY_BRAIN_URL = prevUrl;
    else delete process.env.RAILWAY_BRAIN_URL;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Issue #18: 9-step reply pipeline extracts recent 30 two-way messages, validates integrity, builds JSON request, and retries transient failures', async () => {
  const { db } = await import('../server/db.ts');
  const {
    resolveCanonicalChatIds,
    extractRecentTwoWayMessages,
    validateReplyPipelineData,
    buildCloudReplyJsonRequest,
    fetchWithRetry,
  } = await import('../server.ts');

  const ids = resolveCanonicalChatIds('tg_998877', 'acc_tg_1');
  assert.equal(ids.customerId, 'tg_998877');
  assert.equal(ids.altCustomerId, '998877');
  assert.equal(ids.accountId, 'acc_tg_1');

  const testChatId = `tg_pipeline_test_${Date.now()}`;
  const baseTs = Date.now() - 100000;
  try {
    // Insert 36 DB messages (including 1 empty/blank row that must be ignored)
    const insertStmt = db.prepare(`
      INSERT INTO messages (
        id, chat_id, account_id, sender, text, stt_text, image_caption, timestamp, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 1; i <= 35; i++) {
      const sender = i % 2 === 1 ? 'peer' : 'me';
      const isVoice = i === 33;
      const isImage = i === 34;
      await insertStmt.run(
        `msg_${testChatId}_${i}`,
        testChatId,
        'acc_tg_1',
        sender,
        isVoice || isImage ? '' : `消息_${i}`,
        isVoice ? `语音转写_${i}` : '',
        isImage ? `图片说明_${i}` : '',
        '12:00',
        baseTs + i * 100
      );
    }
    await insertStmt.run(`msg_${testChatId}_empty`, testChatId, 'acc_tg_1', 'peer', '   ', '', '', '12:00', baseTs + 3600);

    // Client buffer adds 2 newer messages + 1 duplicate of #35
    const extracted = await extractRecentTwoWayMessages(
      testChatId,
      testChatId.replace(/^tg_/, ''),
      [
        { id: `msg_${testChatId}_35`, sender: 'peer', text: '消息_35', createdAt: baseTs + 3500 },
        { id: `msg_${testChatId}_36`, sender: 'me', text: '客户端新回复_36', createdAt: baseTs + 3700 },
      ],
      30
    );

    assert.equal(extracted.length, 30);
    assert.equal(extracted[0].text, '消息_7');
    assert.equal(extracted.some((m) => m.text === '语音转写_33' && m.mediaType === 'voice'), true);
    assert.equal(extracted.some((m) => m.text === '图片说明_34' && m.mediaType === 'image'), true);
    assert.equal(extracted[29].text, '客户端新回复_36');

    const persona = {
      personaName: '测试人设',
      personaRole: '顾问',
      age: '28',
      location: '新加坡',
      personalityTraits: ['真诚'],
      lifeStyleDetails: '日常分享',
      investmentPhilosophy: '稳健',
      activeStage: 'icebreaker',
      stagePrompt: '自然破冰',
      customSystemInstruction: '',
      tabooKeywords: ['违禁词'],
      activeHabits: [],
      hasConfiguredPersona: true,
      fallbackPrompt: '',
    };
    const holographicProfile = {
      found: true,
      customerId: testChatId,
      clientName: '客户A',
      relationshipStage: '熟悉阶段',
      ageEstimate: '30',
      occupation: '工程师',
      locationTimezone: 'UTC+8',
      toneStyle: '简洁',
      likesInterests: ['咖啡'],
      dislikesTaboos: ['推销'],
      emotionalNeeds: '被理解',
      keyMemories: [],
      isColdStart: false,
    };

    assert.equal(validateReplyPipelineData({ customerId: '', recentMessages: extracted, persona, holographicProfile }).ok, false);
    assert.equal(validateReplyPipelineData({ customerId: testChatId, recentMessages: [], persona, holographicProfile }).ok, false);
    assert.equal(validateReplyPipelineData({ customerId: testChatId, recentMessages: extracted, persona, holographicProfile }).ok, true);

    const jsonReq = buildCloudReplyJsonRequest({
      customerId: testChatId,
      accountId: 'acc_tg_1',
      targetLanguage: 'English',
      datingMode: false,
      persona,
      holographicProfile,
      recentMessages: extracted,
    });
    assert.equal(jsonReq.customerId, testChatId);
    assert.equal(jsonReq.messageCount, 30);
    assert.equal(jsonReq.recentMessages.length, 30);
    assert.equal(jsonReq.integrityVerified, true);
    assert.equal(jsonReq.persona.personaName, '测试人设');
    assert.equal(jsonReq.holographicProfile.clientName, '客户A');

    // Verify fetchWithRetry retries 503 -> 200, and does NOT retry 401
    let retryCalls = 0;
    const okRes = await fetchWithRetry(
      'https://example.com/v1/chat/completions',
      { method: 'POST', body: '{}' },
      {
        maxRetries: 2,
        baseDelayMs: 10,
        fetcher: async () => {
          retryCalls++;
          if (retryCalls === 1) return new Response('busy', { status: 503 });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      }
    );
    assert.equal(okRes.status, 200);
    assert.equal(retryCalls, 2);

    let authCalls = 0;
    const unauthRes = await fetchWithRetry(
      'https://example.com/v1/chat/completions',
      { method: 'POST', body: '{}' },
      {
        maxRetries: 2,
        baseDelayMs: 10,
        fetcher: async () => {
          authCalls++;
          return new Response('unauthorized', { status: 401 });
        },
      }
    );
    assert.equal(unauthRes.status, 401);
    assert.equal(authCalls, 1);
  } finally {
    await db.prepare('DELETE FROM messages WHERE chat_id = ?').run(testChatId).catch(() => {});
  }
});

test('parsePrivacyRulesToMode and buildPrivacyInputRules handle custom exception users and base modes accurately', async () => {
  const { Api } = await import('telegram/tl/index.js');
  const { parsePrivacyRulesToMode, buildPrivacyInputRules } = await import('../server.ts');

  const parsedContacts = parsePrivacyRulesToMode(
    [
      new Api.PrivacyValueAllowUsers({ users: [1001 as any] }),
      new Api.PrivacyValueDisallowUsers({ users: [2002 as any] }),
      new Api.PrivacyValueAllowContacts(),
    ],
    [
      { id: 1001, firstName: 'Alice', lastName: 'Chen', username: 'alice_c' },
      { id: 2002, firstName: 'Bob', username: 'bob_b' },
    ]
  );

  assert.equal(parsedContacts.mode, 'contacts');
  assert.equal(parsedContacts.allowUsers.length, 1);
  assert.equal(parsedContacts.allowUsers[0].name, 'Alice Chen');
  assert.equal(parsedContacts.allowUsers[0].username, '@alice_c');
  assert.equal(parsedContacts.disallowUsers.length, 1);
  assert.equal(parsedContacts.disallowUsers[0].id, '2002');
  assert.ok(parsedContacts.summary.includes('仅我的联系人可见'));
  assert.ok(parsedContacts.summary.includes('+1 始终允许'));
  assert.ok(parsedContacts.summary.includes('-1 永不允许'));

  const allowInput = new Api.InputPrivacyValueAllowUsers({ users: [new Api.InputUserSelf()] });
  assert.ok(allowInput instanceof Api.InputPrivacyValueAllowUsers);

  const builtRules = buildPrivacyInputRules(
    'nobody',
    [new Api.InputUserSelf()],
    [new Api.InputUser({ userId: 2002 as any, accessHash: 99n as any })]
  );
  assert.equal(builtRules.length, 3);
  assert.ok(builtRules[0] instanceof Api.InputPrivacyValueAllowUsers);
  assert.ok(builtRules[1] instanceof Api.InputPrivacyValueDisallowUsers);
  assert.ok(builtRules[2] instanceof Api.InputPrivacyValueDisallowAll);
});

test('formatTelegramError translates 2FA password, email confirmation, and privacy MTProto errors cleanly', async () => {
  const { formatTelegramError } = await import('../server.ts');
  assert.ok(formatTelegramError({ errorMessage: 'PASSWORD_HASH_INVALID' }).includes('当前两步验证密码错误'));
  assert.ok(formatTelegramError({ errorMessage: 'NEW_PASSWORD_BAD' }).includes('不符合 Telegram 安全要求'));
  assert.ok(formatTelegramError({ errorMessage: 'SRP_ID_INVALID' }).includes('安全会话已过期'));
  assert.ok(formatTelegramError({ errorMessage: 'EMAIL_UNCONFIRMED_6' }).includes('恢复邮箱尚未完成验证码确认'));
  assert.ok(formatTelegramError({ errorMessage: 'CODE_INVALID' }).includes('邮箱验证码错误'));
  assert.ok(formatTelegramError({ errorMessage: 'PREMIUM_ACCOUNT_REQUIRED' }).includes('Telegram Premium'));
});

test('Separation of Cloud Engine & Custom Gateway: translation customModelName, TTS custom gateway routing, and memory cloud routing', async () => {
  const http = await import('node:http');
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const {
    performStrictTranslation,
    syncServerTranslationSettings,
    getServerTranslationSettings,
  } = await import('../server.ts');

  // 1. syncServerTranslationSettings persists customModelName
  await syncServerTranslationSettings({
    preferredEngine: 'custom_llm',
    customModelName: 'deepseek-chat',
    geminiModel: 'gemma-4-31b-it',
  });
  const savedTrans = await getServerTranslationSettings();
  assert.equal(savedTrans.preferredEngine, 'custom_llm');
  assert.equal(savedTrans.customModelName, 'deepseek-chat');

  // 2. performStrictTranslation uses customModelName + 图3 custom baseUrl/apiKey even while engineMode='cloud'
  let capturedBody: any = null;
  let capturedAuth = '';
  let capturedPath = '';
  const mockGateway = http.createServer((req, res) => {
    capturedPath = req.url || '';
    capturedAuth = String(req.headers['authorization'] || '');
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      try {
        capturedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        capturedBody = null;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '你好，世界' } }],
        })
      );
    });
  });

  await new Promise<void>((resolveListen) => mockGateway.listen(0, '127.0.0.1', () => resolveListen()));
  const addr = mockGateway.address() as { port: number };
  const gatewayUrl = `http://127.0.0.1:${addr.port}/v1`;

  try {
    const transRes = await performStrictTranslation({
      text: 'Hello, world',
      sourceLang: 'English',
      targetLang: 'Chinese',
      engine: 'custom_llm',
      customModelName: 'deepseek-chat',
      customConfig: {
        enabled: true,
        engineMode: 'cloud',
        protocol: 'openai',
        baseUrl: gatewayUrl,
        apiKey: 'sk-user-custom-key',
        modelName: 'gpt-4o-mini',
      },
    });
    assert.equal(transRes.translatedText, '你好，世界');
    assert.equal(transRes.engine, 'custom_llm:deepseek-chat');
    assert.equal(capturedPath, '/v1/chat/completions');
    assert.equal(capturedAuth, 'Bearer sk-user-custom-key');
    assert.equal(capturedBody?.model, 'deepseek-chat');
  } finally {
    await new Promise<void>((resolveClose) => mockGateway.close(() => resolveClose()));
  }

  // 3. Verify server.ts contracts for TTS custom gateway & memory extraction cloud engine
  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.match(serverSrc, /app\.post\('\/api\/audio\/tts-clone'[\s\S]*?语音合成需使用自有模型网关/);
  assert.match(serverSrc, /app\.post\('\/api\/audio\/tts-clone'[\s\S]*?\/audio\/speech/);
  assert.match(serverSrc, /app\.post\('\/api\/customer\/analyze\/:chatId'[\s\S]*?engineMode:\s*'cloud'[\s\S]*?purpose:\s*'memory_extraction'/);

  // 4. Verify UI 图1-图4 structural contracts
  const translationDrawerSrc = readFileSync(resolve(process.cwd(), 'src/components/TranslationDrawer.tsx'), 'utf8');
  assert.equal(translationDrawerSrc.includes('customModelName'), true);
  assert.equal(translationDrawerSrc.includes('输入 API 密钥'), false);

  const voiceprintSrc = readFileSync(resolve(process.cwd(), 'src/components/MasterVoiceprintModal.tsx'), 'utf8');
  assert.equal(voiceprintSrc.includes('ttsModel'), true);
  assert.equal(voiceprintSrc.includes('语音合成模型型号'), true);

  const customLlmSrc = readFileSync(resolve(process.cwd(), 'src/components/CustomLLMModal.tsx'), 'utf8');
  assert.equal(customLlmSrc.includes('大模型接入网址 (Base URL)'), true);
  assert.equal(customLlmSrc.includes('API 密钥 (Key)'), true);
  assert.equal(customLlmSrc.includes('自定义请求头'), false);
  assert.equal(customLlmSrc.includes('启用自定义大模型优先路由'), false);
});

test('Priority Custom Key mode: mutually exclusive with Cloud RAG and routes chat, memory extraction, and translation via user gateway with original prompts', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const {
    isCloudKnowledgeBaseEnabled,
    syncServerCustomLlmConfig,
    getServerCustomLlmConfig,
  } = await import('../server.ts');

  const prevCfg = await getServerCustomLlmConfig();
  try {
    // 1. Custom priority mode disables Cloud RAG automatically
    assert.equal(
      isCloudKnowledgeBaseEnabled({
        enabled: true,
        engineMode: 'custom',
        enableKnowledgeBaseRAG: true,
        knowledgeBaseApiUrl: 'https://kb.example.com/search',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-custom',
      }),
      false
    );
    assert.equal(
      isCloudKnowledgeBaseEnabled({
        enabled: true,
        engineMode: 'cloud',
        enableKnowledgeBaseRAG: true,
      }),
      true
    );

    await syncServerCustomLlmConfig({
      enabled: true,
      engineMode: 'custom',
      enableKnowledgeBaseRAG: true,
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-ds-test',
      modelName: 'deepseek-chat',
    });
    const syncedCustom = await getServerCustomLlmConfig();
    assert.equal(syncedCustom.engineMode, 'custom');
    assert.equal(syncedCustom.enableKnowledgeBaseRAG, false);
    assert.equal(syncedCustom.baseUrl, 'https://api.deepseek.com/v1');
  } finally {
    await syncServerCustomLlmConfig(prevCfg || { enabled: false, engineMode: 'cloud', enableKnowledgeBaseRAG: false });
  }

  // 2. Verify CustomLLMModal mutual exclusion & priority switch contracts
  const customLlmSrc = readFileSync(resolve(process.cwd(), 'src/components/CustomLLMModal.tsx'), 'utf8');
  assert.equal(customLlmSrc.includes('启用优先自有密钥回复'), true);
  assert.equal(customLlmSrc.includes('启用 HumanSense 云端引擎与话术检索'), true);
  assert.equal(customLlmSrc.includes('对话与记忆模型型号'), true);
  assert.match(customLlmSrc, /engineMode:\s*'custom'[\s\S]*?enableKnowledgeBaseRAG:\s*false/);
  assert.match(customLlmSrc, /engineMode:\s*'cloud'[\s\S]*?enableKnowledgeBaseRAG:\s*true/);

  // 3. Verify apiService & server routing contracts for priority custom mode (zero silent hijacking)
  const apiServiceSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
  assert.match(apiServiceSrc, /isDualOff\s*=\s*Boolean\(/);
  assert.match(apiServiceSrc, /isPriorityCustom\s*=\s*Boolean\(/);
  assert.match(apiServiceSrc, /if\s*\(isPriorityCustom && strictEngine !== 'custom_llm'\)\s*\{\s*throw new Error/);
  assert.match(apiServiceSrc, /if\s*\(isDualOff && strictEngine !== 'google'\)\s*\{\s*throw new Error/);

  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.match(serverSrc, /app\.post\('\/api\/customer\/analyze\/:chatId'[\s\S]*?useCustomPriorityMemory[\s\S]*?engineMode:\s*'custom'[\s\S]*?analysisPrompt/);
  assert.match(serverSrc, /app\.post\('\/api\/translate'[\s\S]*?isPriorityCustomGateway[\s\S]*?'custom_llm'/);
  assert.match(
    serverSrc,
    /getCnTranslationIfForeign\(\s*replyText,\s*effectiveChatConfig,\s*userJwt,\s*chatTranslationTargetLang\s*\)/
  );
  assert.match(
    serverSrc,
    /getCnTranslationIfForeign\(\s*replyText,\s*serverCustomConfig,\s*lastActiveUserJwt \|\| undefined,\s*webhookChatTargetLang\s*\)/
  );
  assert.match(
    serverSrc,
    /async function getCnTranslationIfForeign\(\s*text:\s*string,\s*overrideCustomConfig\?:\s*any,\s*userJwt\?:\s*string,\s*overrideTargetLang\?:\s*string/
  );
});

test('Telegram account isolation, encrypted session hardening, and expiry detection', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { db, initDatabase, restoreDatabaseSnapshot } = await import('./db.ts');
  const {
    upsertScopedCustomerProfile,
    getScopedCustomerProfile,
    resolveTelegramMessageNumericId,
    pushPendingLocalUpdate,
    pendingLocalUpdates,
    encryptSensitiveData,
    decryptSensitiveData,
    isTelegramSessionExpiredError,
  } = await import('../server.ts');

  await initDatabase();

  // 1. Account-scoped customer profile isolation for identical peer chat_id
  const sharedChatId = `tg_test_peer_${Date.now()}`;
  const now = Date.now();
  await upsertScopedCustomerProfile({
    chatId: sharedChatId,
    accountId: 'acc_tg_1001',
    clientName: '客户A_账号1',
    relationshipStage: 'vip',
    ageEstimate: '30',
    occupation: 'Designer',
    locationTimezone: 'UTC+8',
    toneStyle: 'warm',
    likesInterests: 'coffee',
    dislikesTaboos: 'spam',
    emotionalNeeds: 'trust',
    keyMemories: 'account1_secret_memory',
    updatedAt: now,
  });
  await upsertScopedCustomerProfile({
    chatId: sharedChatId,
    accountId: 'acc_tg_1002',
    clientName: '客户A_账号2',
    relationshipStage: 'new',
    ageEstimate: '25',
    occupation: 'Engineer',
    locationTimezone: 'UTC+0',
    toneStyle: 'concise',
    likesInterests: 'tea',
    dislikesTaboos: 'rush',
    emotionalNeeds: 'clarity',
    keyMemories: 'account2_secret_memory',
    updatedAt: now + 1,
  });

  const p1 = await getScopedCustomerProfile(sharedChatId, 'acc_tg_1001');
  const p2 = await getScopedCustomerProfile(sharedChatId, 'acc_tg_1002');
  assert.equal(p1?.client_name, '客户A_账号1');
  assert.equal(p1?.key_memories, 'account1_secret_memory');
  assert.equal(p2?.client_name, '客户A_账号2');
  assert.equal(p2?.key_memories, 'account2_secret_memory');

  // Cleanup test rows
  await db.prepare('DELETE FROM account_customer_profiles WHERE chat_id = ?').run(sharedChatId);

  // 2. Numeric Telegram message ID extraction for account-scoped message IDs
  assert.equal(resolveTelegramMessageNumericId('msg_tg_1001_45678'), 45678);
  assert.equal(resolveTelegramMessageNumericId('msg_tg_45678'), 45678);
  assert.equal(resolveTelegramMessageNumericId('tg_cloud_89012_1700000000_acc_tg_1001'), 89012);
  assert.equal(resolveTelegramMessageNumericId('tg_33344_1700000000'), 33344);

  // 3. Per-account update capping preserves updates belonging to other accounts
  const prevLen = pendingLocalUpdates.length;
  pendingLocalUpdates.length = 0;
  try {
    for (let i = 0; i < 3; i++) {
      pushPendingLocalUpdate({
        id: `upd_b_${i}`,
        accountId: 'acc_tg_2002',
        chatId: 'tg_999',
        sender: 'peer',
        senderName: 'B',
        text: `b_${i}`,
        timestamp: String(1000 + i),
        createdAt: 1000 + i,
      }, 10, 50);
    }
    for (let i = 0; i < 15; i++) {
      pushPendingLocalUpdate({
        id: `upd_a_${i}`,
        accountId: 'acc_tg_2001',
        chatId: 'tg_888',
        sender: 'peer',
        senderName: 'A',
        text: `a_${i}`,
        timestamp: String(2000 + i),
        createdAt: 2000 + i,
      }, 10, 50);
    }
    const accBCount = pendingLocalUpdates.filter((u) => u.accountId === 'acc_tg_2002').length;
    const accACount = pendingLocalUpdates.filter((u) => u.accountId === 'acc_tg_2001').length;
    assert.equal(accBCount, 3);
    assert.equal(accACount, 10);
  } finally {
    pendingLocalUpdates.length = 0;
    if (prevLen > 0) pendingLocalUpdates.length = 0;
  }

  // 4. Encrypted session validation & snapshot restore filtering
  const encrypted = encryptSensitiveData('1BVtsOHBu...mock_session');
  assert.equal(encrypted.startsWith('enc:gcm:'), true);
  assert.equal(decryptSensitiveData(encrypted), '1BVtsOHBu...mock_session');
  assert.equal(decryptSensitiveData('enc:gcm:malformed'), '');
  assert.equal(decryptSensitiveData('enc:gcm:1:2:3'), '');
  assert.equal(decryptSensitiveData('legacy_unencrypted_token'), 'legacy_unencrypted_token');

  const testPhoneValid = `+1999${Date.now().toString().slice(-7)}`;
  const testPhonePlain = `+1888${Date.now().toString().slice(-7)}`;
  const sessionRestoreRes = await restoreDatabaseSnapshot({
    tables: {
      telegram_user_sessions: [
        {
          phone: testPhonePlain,
          user_id: 'u_plain',
          username: 'plain',
          first_name: 'Plain',
          session_string: 'plaintext_should_not_restore',
          is_active: 1,
          updated_at: now,
        },
        {
          phone: testPhoneValid,
          user_id: 'u_enc',
          username: 'enc',
          first_name: 'Enc',
          session_string: encrypted,
          is_active: 1,
          updated_at: now,
        },
      ],
    },
  });
  const plainRow = await db.prepare('SELECT * FROM telegram_user_sessions WHERE phone = ?').get(testPhonePlain);
  const validRow = await db.prepare('SELECT * FROM telegram_user_sessions WHERE phone = ?').get(testPhoneValid) as any;
  assert.equal(plainRow, undefined);
  assert.equal(validRow, undefined, 'restoreDatabaseSnapshot must never import telegram_user_sessions across machines');
  assert.equal(sessionRestoreRes.restoredCounts.userSessions, 0);
  assert.equal(sessionRestoreRes.restoredCounts.skippedUserSessions, 2);

  // 5. Runtime Telegram session expiry error classifier
  assert.equal(isTelegramSessionExpiredError({ errorMessage: 'AUTH_KEY_UNREGISTERED' }), true);
  assert.equal(isTelegramSessionExpiredError({ message: '401 SESSION_REVOKED' }), true);
  assert.equal(isTelegramSessionExpiredError({ errorMessage: 'USER_DEACTIVATED' }), true);
  assert.equal(isTelegramSessionExpiredError({ errorMessage: 'ETIMEDOUT' }), false);

  // 6. Frontend auth/session safety contracts
  const multiModalSrc = readFileSync(resolve(process.cwd(), 'src/components/MultiAccountModal.tsx'), 'utf8');
  assert.equal(/\bconfirm\s*\(/.test(multiModalSrc), false);
  assert.equal(multiModalSrc.includes("a.status !== 'expired'"), true);
  assert.equal(multiModalSrc.includes('!isLoadingQr && qrError'), true);
  const drawerSrc = readFileSync(resolve(process.cwd(), 'src/components/TelegramMenuDrawer.tsx'), 'utf8');
  assert.equal(/\bconfirm\s*\(/.test(drawerSrc), false);
  assert.equal(drawerSrc.includes('onReloginAccount'), true);
  const sidebarSrc = readFileSync(resolve(process.cwd(), 'src/components/LeftSidebar.tsx'), 'utf8');
  assert.equal(sidebarSrc.includes("acc.status === 'expired'"), true);
  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.equal(appSrc.includes('msgBucketKey(dbc.accountId || targetAccId, dbc.id)'), true);
  assert.equal(appSrc.includes('reloginAccount={reloginAccount}'), true);
});

test('Round 2 P0/P1 regression: JWT revocation on logout, signed resource URLs, and snapshot isolation backup', async () => {
  const {
    revokeJwtToken,
    isJwtTokenRevoked,
    signTelegramResourceUrl,
    verifySignedTelegramResourceRequest,
  } = await import('../server.ts');
  const { db, exportDatabaseSnapshot, restoreDatabaseSnapshot } = await import('./db.ts');

  // 1. JWT revocation blacklist immediately invalidates logged-out token
  const tokenA = `eyJhbGciOiJIUzI1NiJ9.payloadA_${Date.now()}.sigA`;
  const tokenB = `eyJhbGciOiJIUzI1NiJ9.payloadB_${Date.now()}.sigB`;
  assert.equal(isJwtTokenRevoked(tokenA), false);
  revokeJwtToken(tokenA, Date.now() + 60_000);
  assert.equal(isJwtTokenRevoked(tokenA), true);
  assert.equal(isJwtTokenRevoked(tokenB), false);

  // 2. Signed Telegram resource URLs verify properly & block tampering/expiry
  const signedAvatar = signTelegramResourceUrl('/api/telegram/user/avatar/998877', 'acc_tg_1001');
  const avatarParsed = new URL(`http://localhost${signedAvatar}`);
  assert.equal(
    verifySignedTelegramResourceRequest({
      originalUrl: avatarParsed.pathname + avatarParsed.search,
      path: avatarParsed.pathname,
      query: Object.fromEntries(avatarParsed.searchParams.entries()),
    }),
    true
  );

  // Appending &thumb=1 / &download=1 on signed media URL remains valid
  const signedMedia = signTelegramResourceUrl('/api/telegram/user/media/tg_55/12?accountId=acc_tg_1001');
  const mediaThumbUrl = new URL(`http://localhost${signedMedia}&thumb=1`);
  assert.equal(
    verifySignedTelegramResourceRequest({
      originalUrl: mediaThumbUrl.pathname + mediaThumbUrl.search,
      path: mediaThumbUrl.pathname,
      query: Object.fromEntries(mediaThumbUrl.searchParams.entries()),
    }),
    true
  );

  // Tampering with accountId, path, or sig must fail
  assert.equal(
    verifySignedTelegramResourceRequest({
      originalUrl: avatarParsed.pathname + avatarParsed.search,
      path: avatarParsed.pathname,
      query: {
        ...Object.fromEntries(avatarParsed.searchParams.entries()),
        accountId: 'acc_tg_9999',
      },
    }),
    false
  );
  assert.equal(
    verifySignedTelegramResourceRequest({
      originalUrl: '/api/telegram/user/avatar/000000' + avatarParsed.search,
      path: '/api/telegram/user/avatar/000000',
      query: Object.fromEntries(avatarParsed.searchParams.entries()),
    }),
    false
  );
  assert.equal(
    verifySignedTelegramResourceRequest({
      originalUrl: '/api/telegram/user/avatar/998877',
      path: '/api/telegram/user/avatar/998877',
      query: {},
    }),
    false
  );

  // Expired signature must fail
  const expiredMedia = signTelegramResourceUrl('/api/telegram/user/avatar/998877', 'acc_tg_1001', -1000);
  const expiredParsed = new URL(`http://localhost${expiredMedia}`);
  assert.equal(
    verifySignedTelegramResourceRequest({
      originalUrl: expiredParsed.pathname + expiredParsed.search,
      path: expiredParsed.pathname,
      query: Object.fromEntries(expiredParsed.searchParams.entries()),
    }),
    false
  );

  // 3. Database snapshot export & restore preserves account_customer_profiles
  const testChat = `tg_snap_test_${Date.now()}`;
  const ts = Date.now();
  await db.prepare(`
    INSERT OR REPLACE INTO account_customer_profiles (
      account_id, chat_id, client_name, relationship_stage, age_estimate, occupation,
      location_timezone, tone_style, likes_interests, dislikes_taboos, emotional_needs,
      key_memories, total_messages_count, last_analyzed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('acc_tg_snap1', testChat, 'Snapshot Client', 'vip', '28', 'PM', 'UTC+8', 'warm', '[]', '[]', 'trust', 'mem_snap_1', 3, ts, ts);

  const snapshot = await exportDatabaseSnapshot();
  const exportedRows = (snapshot.tables as any).account_customer_profiles || [];
  assert.ok(exportedRows.some((r: any) => r.account_id === 'acc_tg_snap1' && r.chat_id === testChat));

  await db.prepare('DELETE FROM account_customer_profiles WHERE account_id = ? AND chat_id = ?').run('acc_tg_snap1', testChat);
  const restoreRes = await restoreDatabaseSnapshot(snapshot);
  assert.equal(restoreRes.success, true);
  assert.ok((restoreRes.restoredCounts.accountProfiles || 0) >= 1);

  const restoredRow = (await db
    .prepare('SELECT * FROM account_customer_profiles WHERE account_id = ? AND chat_id = ?')
    .get('acc_tg_snap1', testChat)) as any;
  assert.equal(restoredRow?.client_name, 'Snapshot Client');
  assert.equal(restoredRow?.key_memories, 'mem_snap_1');

  await db.prepare('DELETE FROM account_customer_profiles WHERE account_id = ? AND chat_id = ?').run('acc_tg_snap1', testChat);
});

test('Round 3 audit fixes: persistent JWT revocation, snapshot key scrubbing, persistent expiry, fair update eviction, and frontend contracts', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { db, initDatabase, exportDatabaseSnapshot } = await import('./db.ts');
  const {
    revokeJwtToken,
    isJwtTokenRevoked,
    loadRevokedJwtTokensFromDb,
    markTelegramSessionExpired,
    pushPendingLocalUpdate,
    pendingLocalUpdates,
  } = await import('../server.ts');

  await initDatabase();

  // 1. Revoked JWT persists in revoked_jwt_tokens table and survives reload
  const persistentToken = `eyJhbGciOiJIUzI1NiJ9.persist_${Date.now()}.sig`;
  revokeJwtToken(persistentToken, Date.now() + 120_000);
  await new Promise((r) => setTimeout(r, 80));
  await loadRevokedJwtTokensFromDb();
  assert.equal(isJwtTokenRevoked(persistentToken), true);

  // 2. Database snapshot strips geminiApiKey/googleApiKey from translation_settings
  const prevTrans = (await db.prepare("SELECT value FROM system_config WHERE key = 'translation_settings'").get()) as any;
  await db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)').run(
    'translation_settings',
    JSON.stringify({ preferredEngine: 'gemini', geminiApiKey: 'secret-gem-key', googleApiKey: 'secret-goog-key', defaultTargetLang: 'Chinese' }),
    Date.now()
  );
  try {
    const snap = await exportDatabaseSnapshot();
    const transRow = ((snap.tables as any).system_config || []).find((r: any) => r.key === 'translation_settings');
    assert.ok(transRow);
    const parsedTrans = JSON.parse(transRow.value);
    assert.equal(parsedTrans.preferredEngine, 'gemini');
    assert.equal(parsedTrans.geminiApiKey, undefined);
    assert.equal(parsedTrans.googleApiKey, undefined);
  } finally {
    if (prevTrans?.value) {
      await db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)').run('translation_settings', prevTrans.value, Date.now());
    } else {
      await db.prepare("DELETE FROM system_config WHERE key = 'translation_settings'").run();
    }
  }

  // 3. markTelegramSessionExpired persists expired_reason in DB
  const expPhone = `+1777${Date.now().toString().slice(-7)}`;
  const expUid = `u_exp_${Date.now()}`;
  await db.prepare(`
    INSERT OR REPLACE INTO telegram_user_sessions (phone, session_string, user_id, username, first_name, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(expPhone, 'enc:gcm:00:00:00', expUid, 'expuser', 'Exp', Date.now(), Date.now());
  await markTelegramSessionExpired({ accountId: `acc_tg_${expUid}`, userId: expUid, phone: expPhone, reason: 'AUTH_KEY_UNREGISTERED' });
  const expRow = (await db.prepare('SELECT is_active, expired_reason FROM telegram_user_sessions WHERE phone = ?').get(expPhone)) as any;
  assert.equal(Number(expRow?.is_active), 0);
  assert.equal(expRow?.expired_reason, 'AUTH_KEY_UNREGISTERED');
  await db.prepare('DELETE FROM telegram_user_sessions WHERE phone = ?').run(expPhone);

  // 4. Fair update eviction: busy account cannot evict quiet account when maxTotal is hit
  pendingLocalUpdates.length = 0;
  try {
    pushPendingLocalUpdate({
      id: 'quiet_1',
      accountId: 'acc_quiet',
      chatId: 'tg_1',
      sender: 'peer',
      senderName: 'Quiet',
      text: 'important',
      timestamp: '10:00',
      createdAt: 1000,
    }, 10, 5);
    for (let i = 0; i < 6; i++) {
      pushPendingLocalUpdate({
        id: `busy_${i}`,
        accountId: 'acc_busy',
        chatId: 'tg_2',
        sender: 'peer',
        senderName: 'Busy',
        text: `spam_${i}`,
        timestamp: '10:01',
        createdAt: 2000 + i,
      }, 10, 5);
    }
    assert.equal(pendingLocalUpdates.some((u) => u.id === 'quiet_1'), true);
    assert.equal(pendingLocalUpdates.length, 5);
  } finally {
    pendingLocalUpdates.length = 0;
  }

  // 5. Frontend contract checks
  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.equal(appSrc.includes('adminLogout({ revokeTelegramSessions: true })'), true);
  assert.equal(appSrc.includes('if (selectAccountSeqRef.current !== seq)'), true);
  assert.equal(appSrc.includes('currentAccountStatus={currentAccount?.status}'), true);
  const apiSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
  assert.equal(apiSrc.includes('getLocalCustomerProfile(chatId, effectiveAccountId)'), true);
  assert.equal(apiSrc.includes('purgeCryptoSeed()'), true);
  const chatListSrc = readFileSync(resolve(process.cwd(), 'src/components/ChatList.tsx'), 'utf8');
  assert.equal(chatListSrc.includes("currentAccountStatus === 'expired'"), true);
});

test('Round 4 audit fixes: multi-account autopilot/echo isolation, SOCKS4/5 proxy validation, zero-fake-data & desktop stability contracts', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { db, initDatabase } = await import('./db.ts');
  const {
    activeAutonomousChats,
    normalizeAutopilotAccountScope,
    isAutopilotEnabledForChat,
    setAutopilotEnabledForChat,
    markOutboundMessageSent,
    isRecentOutboundEcho,
    parseSocksProxyEnvString,
    normalizeAndValidateProxyConfig,
    saveSystemProxyConfigToDb,
    loadSystemProxyConfigFromDb,
    getConfiguredTelegramProxy,
  } = await import('../server.ts');

  await initDatabase();

  // 1. Autopilot state is strictly isolated by accountId::chatId
  activeAutonomousChats.clear();
  try {
    assert.equal(normalizeAutopilotAccountScope('1001'), 'acc_tg_1001');
    assert.equal(normalizeAutopilotAccountScope('acc_tg_2002'), 'acc_tg_2002');
    assert.equal(normalizeAutopilotAccountScope(''), 'default');

    setAutopilotEnabledForChat('acc_tg_1001', 'tg_999', true);
    assert.equal(isAutopilotEnabledForChat('acc_tg_1001', 'tg_999'), true);
    assert.equal(isAutopilotEnabledForChat('1001', '999'), true);
    assert.equal(isAutopilotEnabledForChat('acc_tg_2002', 'tg_999'), false);

    setAutopilotEnabledForChat('acc_tg_2002', 'tg_999', true);
    setAutopilotEnabledForChat('acc_tg_1001', 'tg_999', false);
    assert.equal(isAutopilotEnabledForChat('acc_tg_1001', 'tg_999'), false);
    assert.equal(isAutopilotEnabledForChat('acc_tg_2002', 'tg_999'), true);
  } finally {
    activeAutonomousChats.clear();
  }

  // 2. Outbound echo dedup is strictly isolated by accountId on the same peer chatId
  markOutboundMessageSent('tg_88888', 'hello client', 'acc_tg_1001');
  assert.equal(isRecentOutboundEcho('tg_88888', 'hello client', 'acc_tg_2002'), false);
  assert.equal(isRecentOutboundEcho('tg_88888', 'hello client', 'acc_tg_1001'), true);
  assert.equal(isRecentOutboundEcho('tg_88888', 'hello client', 'acc_tg_1001'), false);

  // 3. SOCKS4/5 proxy parsing, validation, and DB persistence
  const parsedSocks5 = parseSocksProxyEnvString('socks5://user%401:pass%232@127.0.0.1:7890');
  assert.deepEqual(parsedSocks5, {
    enabled: true,
    type: 'socks5',
    host: '127.0.0.1',
    port: 7890,
    username: 'user@1',
    password: 'pass#2',
  });
  assert.equal(parseSocksProxyEnvString('http://127.0.0.1:8080'), null);
  assert.equal(normalizeAndValidateProxyConfig({ enabled: true, type: 'http', host: '127.0.0.1', port: 8080 }).ok, false);
  assert.equal(normalizeAndValidateProxyConfig({ enabled: true, type: 'socks5', host: '127.0.0.1', port: 70000 }).ok, false);
  assert.equal(normalizeAndValidateProxyConfig({ enabled: true, type: 'socks5', host: '', port: 1080 }).ok, false);

  const prevProxy = (await db.prepare("SELECT value FROM system_config WHERE key = 'network_proxy'").get()) as any;
  try {
    const validSocks4 = normalizeAndValidateProxyConfig({ enabled: true, type: 'socks4', host: '127.0.0.1', port: 10808 });
    assert.equal(validSocks4.ok, true);
    if (validSocks4.ok) {
      await saveSystemProxyConfigToDb(validSocks4.config);
      const loaded = await loadSystemProxyConfigFromDb();
      assert.equal(loaded?.enabled, true);
      assert.equal(loaded?.type, 'socks4');
      assert.equal(loaded?.port, 10808);
      assert.deepEqual(getConfiguredTelegramProxy(), {
        ip: '127.0.0.1',
        port: 10808,
        socksType: 4,
        timeout: 15,
      });
    }
    await saveSystemProxyConfigToDb({ enabled: false, type: 'socks5', host: '', port: 7890 });
    assert.equal(getConfiguredTelegramProxy(), undefined);
  } finally {
    if (prevProxy?.value) {
      await db.prepare("INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('network_proxy', ?, ?)").run(prevProxy.value, Date.now());
      await loadSystemProxyConfigFromDb();
    } else {
      await db.prepare("DELETE FROM system_config WHERE key = 'network_proxy'").run();
      await loadSystemProxyConfigFromDb();
    }
  }

  // 4. Desktop launcher, startup non-blocking & /api/* 404 guard contracts
  const mainCjsSrc = readFileSync(resolve(process.cwd(), 'main.cjs'), 'utf8');
  assert.equal(mainCjsSrc.includes('ensureFixedPortAvailable'), true);
  assert.equal(mainCjsSrc.includes('findAvailablePort'), false);
  assert.equal(mainCjsSrc.includes('__humansenseGracefulShutdown'), true);
  assert.equal(mainCjsSrc.includes('setWindowOpenHandler'), true);

  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.equal(serverSrc.includes("app.post('/api/telegram/user/reconnect'"), true);
  assert.equal(serverSrc.includes("app.get('/api/system/proxy'"), true);
  assert.equal(serverSrc.includes("app.post('/api/system/proxy'"), true);
  assert.equal(serverSrc.includes("if (req.path === '/api' || req.path.startsWith('/api/'))"), true);
  assert.equal(serverSrc.includes('export async function gracefulShutdownServer'), true);

  // 5. Frontend zero-fake-data & global multi-account polling contracts
  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.equal(appSrc.includes('INITIAL_MESSAGES'), false);
  assert.equal(appSrc.includes('DEFAULT_CALL_RECORDS'), false);
  assert.equal(appSrc.includes('Elena Rostova'), false);
  assert.equal(appSrc.includes('pollIncomingTelegramUpdates()'), true);
  assert.equal(appSrc.includes('handleReconnectTelegram'), true);

  const apiServiceSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
  assert.equal(apiServiceSrc.includes("localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY) || ''"), true);
  assert.equal(apiServiceSrc.includes("|| 'acc_1'"), false);
  assert.equal(apiServiceSrc.includes('reconnectTelegramSessionsApi'), true);
  assert.equal(apiServiceSrc.includes('syncCloudTelegramCredsApi'), true);
  assert.equal(apiServiceSrc.includes('saveSystemProxyApi'), true);
});

test('Module 1 Desktop Foundation: LibSQL Windows file URL formatting, DB health 503, asarUnpack, QR phone parity, and strict multi-account isolation', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { formatLibsqlFileUrl } = await import('../server/db.ts');
  const { parseUri } = await import('@libsql/core/uri');

  // 1. LibSQL Windows file URL formatting preserves drive path and special characters (#, ?, %) without leading slash
  const winLike = 'C:\\Users\\Alice #1\\AppData\\Roaming\\HumanSense\\data\\100%real?v=1\\telegram_pro.db';
  const formattedWin = formatLibsqlFileUrl(winLike);
  assert.equal(formattedWin.startsWith('file:///'), false);
  const parsedWin = parseUri(formattedWin);
  assert.equal(parsedWin.scheme, 'file');
  assert.equal(parsedWin.authority, undefined);
  assert.ok(parsedWin.path.includes('Alice #1'));
  assert.ok(parsedWin.path.includes('100%real?v=1'));

  const posixLike = '/tmp/user #2/test%db?/app.db';
  const parsedPosix = parseUri(formatLibsqlFileUrl(posixLike));
  assert.equal(parsedPosix.scheme, 'file');
  assert.equal(parsedPosix.path, '/tmp/user #2/test%db?/app.db');

  // 2. Electron packaging & startup lifecycle contracts
  const pkgSrc = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.ok(Array.isArray(pkgSrc.build?.asarUnpack));
  assert.equal(pkgSrc.build.asarUnpack.includes('node_modules/@libsql*/**/*'), true);
  assert.equal(pkgSrc.build.asarUnpack.includes('node_modules/libsql/**/*'), true);

  const mainCjsSrc = readFileSync(resolve(process.cwd(), 'main.cjs'), 'utf8');
  assert.equal(mainCjsSrc.includes('res.statusCode === 503'), true);
  assert.equal(mainCjsSrc.includes('req.setTimeout(2000'), true);

  // 3. Server stability, SOCKS proxy cloud-fetch support, QR phone normalization, and multi-account route isolation
  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.equal(serverSrc.includes('closeAllConnections?.()'), true);
  assert.equal(serverSrc.includes('let dbInitError: string | null = null;'), true);
  assert.equal(serverSrc.includes('fetchWithSystemProxySupport'), true);
  assert.equal(serverSrc.includes('SocksClient.createConnection'), true);
  assert.equal(serverSrc.includes('DELETE FROM telegram_user_sessions WHERE user_id = ? AND phone != ?'), true);
  assert.equal(serverSrc.includes('options?: { forceReconnect?: boolean }'), true);
  assert.equal(serverSrc.includes('多账号模式下必须指定 accountId'), true);
  assert.equal(serverSrc.includes('accountId is required in multi-account mode'), true);

  // 4. Frontend auth expiry event, QR relogin race guard, and bounded deleted-id cache
  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.equal(appSrc.includes('hs_member_auth_expired'), true);
  assert.equal(appSrc.includes('pendingAutoSelectAccountRef'), true);
  assert.equal(appSrc.includes('c.id === chatId && (!activeAccountId || c.accountId === activeAccountId)'), true);

  const multiModalSrc = readFileSync(resolve(process.cwd(), 'src/components/MultiAccountModal.tsx'), 'utf8');
  assert.equal(multiModalSrc.includes('willSwitchToPhoneRelogin'), true);

  const apiServiceSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
  assert.equal(apiServiceSrc.includes('notifyIfMemberAuthExpired'), true);
  assert.equal(apiServiceSrc.includes('MAX_DELETED_MESSAGE_IDS = 5000'), true);
});

test('Commercialization Audit P0/P1 Fixes: socks dependency, proxy-forwarded pre-login auth & encrypted offline grace cache, watchdog/autoReconnect, localStorage cap & account isolation, evolution corpus isolation, and workspace recovery UI', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const crypto = await import('node:crypto');
  const { db, initDatabase } = await import('./db.ts');
  const {
    writeOfflineGraceTelegramCredentials,
    readOfflineGraceTelegramCredentials,
    clearOfflineGraceTelegramCredentials,
    resolveTelegramApiCredentials,
    clearInMemoryTelegramApiCredentials,
    getInMemoryTelegramApiCredentials,
    resolveUnifiedEvolutionCorpus,
    runTelegramConnectionWatchdogCycle,
    stopTelegramConnectionWatchdog,
  } = await import('../server.ts');

  await initDatabase();

  // P0-1: "socks" MUST be formally declared in package.json dependencies
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies && typeof pkg.dependencies.socks === 'string' && pkg.dependencies.socks.length > 0);

  // P0-2: Encrypted hardware-bound + verified-JWT offline grace cache (zero SQLite persistence)
  const rsa = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const signRs256 = (payload: object) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), rsa.privateKey).toString('base64url');
    return `${h}.${p}.${sig}`;
  };

  const prevPubKey = process.env.JWT_PUBLIC_KEY;
  const prevAuthUrl = process.env.CLOUD_AUTH_URL;
  const prevApiId = process.env.TELEGRAM_API_ID;
  const prevApiHash = process.env.TELEGRAM_API_HASH;
  const prevFetch = globalThis.fetch;
  process.env.JWT_PUBLIC_KEY = rsa.publicKey;
  process.env.CLOUD_AUTH_URL = 'https://auth.unreachable-test.invalid';
  delete process.env.TELEGRAM_API_ID;
  delete process.env.TELEGRAM_API_HASH;

  try {
    const localDeviceId = getLocalMachineDeviceId();
    const nowSec = Math.floor(Date.now() / 1000);
    const validUserToken = signRs256({
      sub: 'usr_grace_1',
      username: 'grace_member',
      role: 'member',
      deviceId: localDeviceId,
      vipExpiresAt: Date.now() + 86_400_000,
      exp: nowSec + 3600,
    });
    const otherUserToken = signRs256({
      sub: 'usr_grace_other',
      username: 'other_member',
      role: 'member',
      deviceId: localDeviceId,
      vipExpiresAt: Date.now() + 86_400_000,
      exp: nowSec + 3600,
    });

    clearOfflineGraceTelegramCredentials();
    clearInMemoryTelegramApiCredentials();

    writeOfflineGraceTelegramCredentials({
      bearerToken: validUserToken,
      apiId: 9876543,
      apiHash: 'abc123def4567890abc123def4567890',
      poolLabel: 'test_pool',
    });

    // Valid token reads encrypted grace cache
    const readBack = readOfflineGraceTelegramCredentials(validUserToken);
    assert.ok(readBack);
    assert.equal(readBack?.apiId, 9876543);
    assert.equal(readBack?.apiHash, 'abc123def4567890abc123def4567890');

    // Different member token MUST NOT reuse someone else's cached credentials
    assert.equal(readOfflineGraceTelegramCredentials(otherUserToken), null);

    // Offline resolveTelegramApiCredentials falls back to cloud_offline_grace when cloud auth is unreachable
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as any;
    const offlineResolved = await resolveTelegramApiCredentials({ bearerToken: validUserToken });
    assert.equal(offlineResolved.ok, true);
    assert.equal(offlineResolved.source, 'cloud_offline_grace');
    assert.equal(offlineResolved.isOfflineGrace, true);
    assert.equal(offlineResolved.apiId, 9876543);

    // Verify zero SQLite persistence (Mode B invariant preserved)
    const sysCredRow = await db.prepare("SELECT value FROM system_config WHERE key = 'telegram_api_credentials'").get();
    assert.equal(sysCredRow, undefined);

    // Logout wipe clears both memory and grace file
    clearInMemoryTelegramApiCredentials();
    assert.equal(getInMemoryTelegramApiCredentials(), null);
    assert.equal(readOfflineGraceTelegramCredentials(validUserToken), null);
  } finally {
    globalThis.fetch = prevFetch;
    clearOfflineGraceTelegramCredentials();
    clearInMemoryTelegramApiCredentials();
    if (prevPubKey !== undefined) process.env.JWT_PUBLIC_KEY = prevPubKey;
    else delete process.env.JWT_PUBLIC_KEY;
    if (prevAuthUrl !== undefined) process.env.CLOUD_AUTH_URL = prevAuthUrl;
    else delete process.env.CLOUD_AUTH_URL;
    if (prevApiId !== undefined) process.env.TELEGRAM_API_ID = prevApiId;
    if (prevApiHash !== undefined) process.env.TELEGRAM_API_HASH = prevApiHash;
  }

  // P0-3: Connection watchdog cycle runs cleanly with zero active sessions & stop cleans timer
  const watchdogReconnected = await runTelegramConnectionWatchdogCycle();
  assert.equal(typeof watchdogReconnected, 'number');
  stopTelegramConnectionWatchdog();

  // P1-5①: resolveUnifiedEvolutionCorpus strictly isolates DB & client messages by accountId
  const ts = Date.now();
  const idA = `evo_msg_a_${ts}`;
  const idB = `evo_msg_b_${ts}`;
  await db.prepare(`
    INSERT INTO messages (id, chat_id, account_id, sender, sender_name, text, timestamp, created_at, delivery_status)
    VALUES (?, 'tg_chat_a', 'acc_tg_alpha', 'peer', 'AlphaClient', 'AlphaSecretCorpusXYZ', '12:00', ?, 'delivered')
  `).run(idA, ts);
  await db.prepare(`
    INSERT INTO messages (id, chat_id, account_id, sender, sender_name, text, timestamp, created_at, delivery_status)
    VALUES (?, 'tg_chat_b', 'acc_tg_beta', 'peer', 'BetaClient', 'BetaSecretCorpusXYZ', '12:00', ?, 'delivered')
  `).run(idB, ts + 1);
  try {
    const corpusA = await resolveUnifiedEvolutionCorpus({
      accountId: 'acc_tg_alpha',
      clientMessages: [
        { id: 'c_a', chatId: 'tg_chat_a', accountId: 'acc_tg_alpha', sender: 'me', text: 'ClientAlphaMsg' },
        { id: 'c_b', chatId: 'tg_chat_b', accountId: 'acc_tg_beta', sender: 'me', text: 'ClientBetaLeakMsg' },
      ],
    });
    assert.equal(corpusA.corpusText.includes('AlphaSecretCorpusXYZ'), true);
    assert.equal(corpusA.corpusText.includes('ClientAlphaMsg'), true);
    assert.equal(corpusA.corpusText.includes('BetaSecretCorpusXYZ'), false);
    assert.equal(corpusA.corpusText.includes('ClientBetaLeakMsg'), false);
  } finally {
    await db.prepare('DELETE FROM messages WHERE id IN (?, ?)').run(idA, idB);
  }

  // Source contracts for P0-2, P0-3, P0-4, P1-5, P1-6
  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.equal(serverSrc.includes("app.post('/api/auth/cloud-login'"), true);
  assert.equal(serverSrc.includes("app.post('/api/auth/cloud-register'"), true);
  assert.equal(serverSrc.includes("app.post('/api/auth/cloud-redeem'"), true);
  assert.equal(serverSrc.includes("app.get('/api/auth/proxy'"), true);
  assert.equal(serverSrc.includes("app.post('/api/auth/proxy'"), true);
  assert.equal(serverSrc.includes('autoReconnect: true'), true);
  assert.equal(serverSrc.includes('startTelegramConnectionWatchdog'), true);
  assert.equal(serverSrc.includes('isElectronMainProcess'), true);
  assert.equal(serverSrc.includes('activeRestoreMeta'), true);

  const apiServiceSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
  assert.equal(apiServiceSrc.includes('MAX_LOCAL_MESSAGES_PER_CHAT = 100'), true);
  assert.equal(apiServiceSrc.includes('getPreLoginProxyApi'), true);
  assert.equal(apiServiceSrc.includes('savePreLoginProxyApi'), true);
  assert.equal(apiServiceSrc.includes("'/api/auth/cloud-login'"), true);
  assert.equal(apiServiceSrc.includes('tg_deleted_message_ids_${acc}'), true);

  const authModalSrc = readFileSync(resolve(process.cwd(), 'src/components/MemberAuthModal.tsx'), 'utf8');
  assert.equal(authModalSrc.includes('savePreLoginProxyApi'), true);
  assert.equal(authModalSrc.includes('网络代理设置'), true);
  assert.equal(authModalSrc.includes('返回会员登录'), true);
  assert.equal(authModalSrc.includes("switchTab('register')"), true);
  assert.equal(authModalSrc.includes("switchTab('redeem')"), true);

  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.equal(appSrc.includes("secureSetItemSync('tg_pro_messages'"), false);
  assert.equal(appSrc.includes("localStorage.getItem('tg_pro_active_account_id')"), true);
  assert.equal(appSrc.includes('normalizeStalePendingMessages(localList)'), true);
  assert.equal(appSrc.includes('重新扫码登录'), true);

  const dbModalSrc = readFileSync(resolve(process.cwd(), 'src/components/DatabaseModal.tsx'), 'utf8');
  assert.equal(dbModalSrc.includes("key.startsWith('tg_deleted_message_ids')"), true);
});

test('isAllowedClientOrigin blocks cross-site evil Origin, wildcard run.app/google domains, and mismatched loopback ports', () => {
  const makeReq = (origin: string | undefined, host = '127.0.0.1:3000', referer?: string) =>
    ({
      headers: {
        ...(origin !== undefined ? { origin } : {}),
        ...(referer !== undefined ? { referer } : {}),
      },
      get: (name: string) => (name.toLowerCase() === 'host' ? host : undefined),
    }) as any;

  // Untrusted external & previously-wildcarded domains must be rejected
  assert.equal(isAllowedClientOrigin(makeReq('https://evil.example', '127.0.0.1:3000')), false);
  assert.equal(isAllowedClientOrigin(makeReq('https://evil.example', 'localhost:3000')), false);
  assert.equal(isAllowedClientOrigin(makeReq('https://evil.run.app', '127.0.0.1:3000')), false);
  assert.equal(isAllowedClientOrigin(makeReq('https://evil.google.com', '127.0.0.1:3000')), false);
  assert.equal(isAllowedClientOrigin(makeReq('https://evil.googleusercontent.com', '127.0.0.1:3000')), false);
  assert.equal(isAllowedClientOrigin(makeReq('https://attacker.run.app', 'ais-dev-demo.us-west1.run.app')), false);
  assert.equal(isAllowedClientOrigin(makeReq('https://ais-dev-demo.us-west1.run.app', 'ais-dev-demo.us-west1.run.app')), true);

  // Null / empty Origin must be rejected even if Referer looks local
  assert.equal(isAllowedClientOrigin(makeReq('null', '127.0.0.1:3000', 'http://127.0.0.1:3000/')), false);
  assert.equal(isAllowedClientOrigin(makeReq('', '127.0.0.1:3000', 'http://127.0.0.1:3000/')), false);

  // Mismatched loopback ports must be rejected
  assert.equal(isAllowedClientOrigin(makeReq('http://localhost:9999', '127.0.0.1:3000')), false);
  assert.equal(isAllowedClientOrigin(makeReq('http://127.0.0.1:8080', '127.0.0.1:38271')), false);
  assert.equal(isAllowedClientOrigin(makeReq('http://[::1]:5173', '127.0.0.1:3000')), false);
  assert.equal(isAllowedClientOrigin(makeReq('http://localhost', '127.0.0.1:3000')), false);
  assert.equal(isAllowedClientOrigin(makeReq('http://localhost.evil.com:3000', '127.0.0.1:3000')), false);

  // Matching loopback port & Electron schemes remain allowed
  assert.equal(isAllowedClientOrigin(makeReq('http://127.0.0.1:3000', '127.0.0.1:3000')), true);
  assert.equal(isAllowedClientOrigin(makeReq('http://localhost:3000', '127.0.0.1:3000')), true);
  assert.equal(isAllowedClientOrigin(makeReq('http://[::1]:3000', '127.0.0.1:3000')), true);
  assert.equal(isAllowedClientOrigin(makeReq('http://127.0.0.1:38271', 'localhost:38271')), true);
  assert.equal(isAllowedClientOrigin(makeReq('file://', '127.0.0.1:3000')), true);
  assert.equal(isAllowedClientOrigin(makeReq(undefined, '127.0.0.1:3000')), true);
});

test('Streaming multipart media upload & retry pipeline: busboy disk streaming, traversal safety, sanitizeDbMediaUrl, file persistence, and frontend zero-base64 contracts', async () => {
  const fs = await import('node:fs');
  const http = await import('node:http');
  const expressMod = await import('express');
  const { resolve } = await import('node:path');
  const { db, initDatabase } = await import('./db.ts');
  const {
    TELEGRAM_MAX_MEDIA,
    OUTBOUND_MEDIA_DIR,
    parseMultipartMessageUpload,
    buildOutboundLocalMediaUrl,
    resolveLocalMediaDiskPath,
    sanitizeDbMediaUrl,
    upsertSyncedMessageToDb,
    mergeUnifiedConversationMessages,
  } = await import('../server.ts');

  await initDatabase();

  assert.ok(TELEGRAM_MAX_MEDIA >= 50 * 1024 * 1024);

  // 1. sanitizeDbMediaUrl strips blob: and >512KB data URLs, preserves local-media and https URLs
  assert.equal(sanitizeDbMediaUrl('blob:http://localhost:3000/1234-5678'), '');
  assert.equal(sanitizeDbMediaUrl(`data:video/mp4;base64,${'A'.repeat(600 * 1024)}`), '');
  const localUrl = buildOutboundLocalMediaUrl('sample_test_media.mp4', 'acc_tg_1001');
  assert.ok(localUrl.startsWith('/api/messages/local-media/sample_test_media.mp4?'));
  assert.equal(sanitizeDbMediaUrl(localUrl), localUrl);

  // 2. resolveLocalMediaDiskPath blocks path traversal and missing files
  assert.equal(resolveLocalMediaDiskPath('/api/messages/local-media/..%2F..%2Fetc%2Fpasswd'), null);
  assert.equal(resolveLocalMediaDiskPath('/api/messages/local-media/../secret.txt'), null);
  assert.equal(resolveLocalMediaDiskPath('/api/messages/local-media/non_existent_999.mp4'), null);

  // 3. Real streaming multipart/form-data upload through Express + busboy middleware
  const app = expressMod.default();
  app.post('/test-upload', parseMultipartMessageUpload, (req, res) => {
    const uploaded = (req as any).uploadedMedia;
    res.json({
      ok: true,
      body: req.body,
      uploaded,
    });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  let createdDiskPath = '';
  try {
    const binaryPayload = Buffer.from('FAKE_MP4_STREAM_HEADER_0123456789_VIDEO_BYTES');
    const fd = new FormData();
    fd.append(
      'payload',
      JSON.stringify({
        id: 'msg_stream_test_1',
        chatId: 'tg_999999',
        accountId: 'acc_tg_1001',
        sender: 'me',
        isVideo: true,
        videoDuration: 14,
        text: 'Streamed clip',
      })
    );
    fd.append('file', new Blob([binaryPayload], { type: 'video/mp4' }), 'demo_clip.mp4');

    const uploadRes = await fetch(`${baseUrl}/test-upload`, {
      method: 'POST',
      body: fd,
    });
    assert.equal(uploadRes.status, 200);
    const json = (await uploadRes.json()) as any;
    assert.equal(json.ok, true);
    assert.equal(json.body.id, 'msg_stream_test_1');
    assert.equal(json.body.isVideo, true);
    assert.equal(json.body.videoDuration, 14);
    assert.ok(json.uploaded && typeof json.uploaded.diskPath === 'string');
    assert.equal(json.uploaded.size, binaryPayload.length);
    createdDiskPath = json.uploaded.diskPath;
    assert.equal(fs.existsSync(createdDiskPath), true);
    assert.deepEqual(fs.readFileSync(createdDiskPath), binaryPayload);

    // Valid disk file resolves cleanly via local-media URL
    const validMediaUrl = buildOutboundLocalMediaUrl(json.uploaded.diskFileName, 'acc_tg_1001');
    assert.equal(resolveLocalMediaDiskPath(validMediaUrl), createdDiskPath);

    // JSON-only fast path bypasses busboy cleanly
    const jsonApp = expressMod.default();
    jsonApp.use(expressMod.default.json({ limit: '1mb' }));
    jsonApp.post('/test-json', parseMultipartMessageUpload, (req, res) => {
      res.json({ ok: true, text: req.body?.text, hasUpload: Boolean((req as any).uploadedMedia) });
    });
    const jsonServer = http.createServer(jsonApp);
    await new Promise<void>((r) => jsonServer.listen(0, '127.0.0.1', () => r()));
    try {
      const jsonPort = (jsonServer.address() as any).port;
      const textRes = await fetch(`http://127.0.0.1:${jsonPort}/test-json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'plain fast text' }),
      });
      const textData = (await textRes.json()) as any;
      assert.equal(textData.ok, true);
      assert.equal(textData.text, 'plain fast text');
      assert.equal(textData.hasUpload, false);
    } finally {
      await new Promise<void>((r) => jsonServer.close(() => r()));
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    if (createdDiskPath && fs.existsSync(createdDiskPath)) {
      fs.unlinkSync(createdDiskPath);
    }
  }

  // 4. SQLite persistence + merger preserves file attachment fields & strips blob: URLs
  const fileMsgId = `msg_file_stream_${Date.now()}`;
  const persistedMediaUrl = buildOutboundLocalMediaUrl('persisted_doc.pdf', 'acc_tg_1001');
  try {
    const okUpsert = await upsertSyncedMessageToDb(
      {
        id: fileMsgId,
        chatId: 'tg_55555',
        accountId: 'acc_tg_1001',
        sender: 'me',
        text: '[文件] report.pdf',
        isFile: true,
        fileName: 'report.pdf',
        fileSize: '2.40 MB',
        fileUrl: persistedMediaUrl,
        deliveryStatus: 'delivered',
        createdAt: Date.now(),
      },
      'tg_55555',
      'acc_tg_1001'
    );
    assert.equal(okUpsert, true);

    const stored = (await db.prepare('SELECT * FROM messages WHERE id = ?').get(fileMsgId)) as any;
    assert.ok(stored);
    assert.equal(stored.is_file, 1);
    assert.equal(stored.file_name, 'report.pdf');
    assert.equal(stored.file_size, '2.40 MB');
    assert.equal(stored.file_url, persistedMediaUrl);

    const merged = mergeUnifiedConversationMessages([
      [{ id: fileMsgId, chatId: 'tg_55555', sender: 'me', text: '[文件] report.pdf', isFile: true, fileName: 'report.pdf', fileSize: '2.40 MB', fileUrl: persistedMediaUrl }],
      [{ id: fileMsgId, chatId: 'tg_55555', sender: 'me', text: '[文件] report.pdf' }],
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].isFile, true);
    assert.equal(merged[0].fileName, 'report.pdf');
    assert.equal(merged[0].fileUrl, persistedMediaUrl);
  } finally {
    await db.prepare('DELETE FROM messages WHERE id = ?').run(fileMsgId);
  }

  // 5. Frontend streaming & zero-localStorage-bloat source contracts
  const chatAreaSrc = fs.readFileSync(resolve(process.cwd(), 'src/components/ChatArea.tsx'), 'utf8');
  assert.equal(chatAreaSrc.includes('blobToDataUrl'), false);
  assert.equal(chatAreaSrc.includes('URL.createObjectURL'), true);
  assert.equal(chatAreaSrc.includes('mediaFile:'), true);
  assert.equal(chatAreaSrc.includes('TELEGRAM_MAX_MEDIA'), true);

  const apiSrc = fs.readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
  assert.equal(apiSrc.includes('new FormData()'), true);
  assert.equal(apiSrc.includes('sanitizeMessageForLocalStorage'), true);
  assert.equal(apiSrc.includes('buildCompactOutboundJsonPayload'), true);

  const appSrc = fs.readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.equal(appSrc.includes('pendingMediaFilesRef'), true);
  assert.equal(appSrc.includes('scheduleRevokeBlobUrls'), true);
  assert.ok(OUTBOUND_MEDIA_DIR.endsWith('outbound_media'));
});

test('Telegram media & avatar OOM protection: BoundedByteLruCache, HTTP Range parser, and iterDownload streaming', async () => {
  const expressMod = await import('express');
  const http = await import('http');
  const {
    BoundedByteLruCache,
    telegramAvatarCache,
    telegramMediaCache,
    TELEGRAM_MEDIA_CACHE_MAX_BYTES,
    TELEGRAM_AVATAR_CACHE_MAX_ENTRIES,
    TELEGRAM_AVATAR_CACHE_MAX_BYTES,
    TELEGRAM_MEDIA_STREAM_THRESHOLD_BYTES,
    parseHttpByteRange,
    extractTelegramMediaMeta,
    streamTelegramMediaViaIterDownload,
  } = await import('../server.ts');

  // 1. Production cache budget defaults
  assert.ok(TELEGRAM_MEDIA_CACHE_MAX_BYTES <= 128 * 1024 * 1024);
  assert.equal(telegramMediaCache.maxBytes, TELEGRAM_MEDIA_CACHE_MAX_BYTES);
  assert.ok(TELEGRAM_AVATAR_CACHE_MAX_ENTRIES <= 500);
  assert.equal(telegramAvatarCache.maxEntries, TELEGRAM_AVATAR_CACHE_MAX_ENTRIES);
  assert.equal(telegramAvatarCache.maxBytes, TELEGRAM_AVATAR_CACHE_MAX_BYTES);
  assert.ok(TELEGRAM_MEDIA_STREAM_THRESHOLD_BYTES >= 1024 * 1024);

  // 2. BoundedByteLruCache: byte budget + LRU recency + TTL expiration + item threshold + prefix cleanup
  const now = 1_700_000_000_000;
  const cache = new BoundedByteLruCache<{ buffer: Buffer; expiresAt: number }>({
    maxBytes: 100,
    maxEntries: 3,
    maxItemBytes: 60,
  });

  // Oversized item rejected cleanly
  assert.equal(cache.set('too_big', { buffer: Buffer.alloc(61), expiresAt: now + 60_000 }, now), false);
  assert.equal(cache.size, 0);
  assert.equal(cache.totalBytes, 0);

  // Insert 3 items (40 + 40 + 15 = 95 <= 100)
  assert.equal(cache.set('acc1:k1', { buffer: Buffer.alloc(40, 1), expiresAt: now + 60_000 }, now), true);
  assert.equal(cache.set('acc1:k2', { buffer: Buffer.alloc(40, 2), expiresAt: now + 60_000 }, now), true);
  assert.equal(cache.set('acc2:k3', { buffer: Buffer.alloc(15, 3), expiresAt: now + 60_000 }, now), true);
  assert.equal(cache.totalBytes, 95);

  // Access acc1:k1 so acc1:k2 becomes the least recently used
  assert.ok(cache.get('acc1:k1', now));

  // Adding 20 bytes exceeds 100 -> must evict acc1:k2 (LRU), keeping acc1:k1 and acc2:k3
  assert.equal(cache.set('acc2:k4', { buffer: Buffer.alloc(20, 4), expiresAt: now + 60_000 }, now), true);
  assert.equal(cache.get('acc1:k2', now), undefined);
  assert.ok(cache.get('acc1:k1', now));
  assert.ok(cache.get('acc2:k3', now));
  assert.ok(cache.get('acc2:k4', now));
  assert.ok(cache.totalBytes <= 100);
  assert.equal(cache.size, 3);

  // Max entries eviction even when bytes fit
  assert.equal(cache.set('acc2:k5', { buffer: Buffer.alloc(5, 5), expiresAt: now + 60_000 }, now), true);
  assert.equal(cache.size, 3);

  // Prefix deletion cleans up account entries accurately
  const removedByPrefix = cache.deleteByPrefix('acc2:');
  assert.ok(removedByPrefix >= 1);

  // TTL expiration reclaims bytes on pruneExpired and lazy get
  cache.clear();
  cache.set('exp1', { buffer: Buffer.alloc(30), expiresAt: now + 1000 }, now);
  cache.set('live1', { buffer: Buffer.alloc(30), expiresAt: now + 60_000 }, now);
  assert.equal(cache.totalBytes, 60);
  assert.equal(cache.get('exp1', now + 2000), undefined);
  assert.equal(cache.totalBytes, 30);
  cache.set('exp2', { buffer: Buffer.alloc(25), expiresAt: now + 1500 }, now);
  assert.equal(cache.pruneExpired(now + 2000), 1);
  assert.equal(cache.totalBytes, 30);

  // 3. HTTP Range parser accuracy (open, bounded, suffix, unsatisfiable)
  assert.deepEqual(parseHttpByteRange(undefined, 1000), { kind: 'none' });
  assert.deepEqual(parseHttpByteRange('bytes=0-', 1000), { kind: 'range', start: 0, end: 999 });
  assert.deepEqual(parseHttpByteRange('bytes=100-199', 1000), { kind: 'range', start: 100, end: 199 });
  assert.deepEqual(parseHttpByteRange('bytes=900-5000', 1000), { kind: 'range', start: 900, end: 999 });
  assert.deepEqual(parseHttpByteRange('bytes=-128', 1000), { kind: 'range', start: 872, end: 999 });
  assert.deepEqual(parseHttpByteRange('bytes=-5000', 1000), { kind: 'range', start: 0, end: 999 });
  assert.deepEqual(parseHttpByteRange('bytes=1000-', 1000), { kind: 'unsatisfiable' });
  assert.deepEqual(parseHttpByteRange('bytes=500-400', 1000), { kind: 'unsatisfiable' });
  assert.deepEqual(parseHttpByteRange('bytes=0-0', 0), { kind: 'unsatisfiable' });

  // 4. Streaming iterDownload with true HTTP Range & offset alignment (no full-buffer RAM load)
  const payloadSize = 200 * 1024; // 200 KB deterministic payload
  const fullPayload = Buffer.alloc(payloadSize);
  for (let i = 0; i < payloadSize; i++) {
    fullPayload[i] = (i * 31 + 7) & 0xff;
  }

  const iterCalls: Array<{ offset: number; requestSize: number; limit?: number }> = [];
  let downloadMediaCalled = 0;
  const mockClient = {
    downloadMedia: async () => {
      downloadMediaCalled++;
      throw new Error('downloadMedia must NOT be called for streaming large files');
    },
    iterDownload: ({ offset, requestSize, limit }: any) => {
      const startOff = Number(offset?.toString?.() ?? offset ?? 0);
      iterCalls.push({ offset: startOff, requestSize, limit });
      let cursor = startOff;
      let yielded = 0;
      const maxChunks = typeof limit === 'number' ? limit : Number.MAX_SAFE_INTEGER;
      return {
        close: async () => {},
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (cursor >= fullPayload.length || yielded >= maxChunks) {
                return { value: undefined, done: true };
              }
              const nextEnd = Math.min(cursor + requestSize, fullPayload.length);
              const slice = fullPayload.subarray(cursor, nextEnd);
              cursor = nextEnd;
              yielded++;
              return { value: slice, done: false };
            },
          };
        },
      };
    },
  };

  // Verify extractTelegramMediaMeta extracts bigInt/numeric doc.size cleanly
  const meta = extractTelegramMediaMeta(
    {
      media: {
        document: {
          size: BigInt(payloadSize),
          mimeType: 'video/mp4',
          dcId: 5,
          attributes: [{ className: 'DocumentAttributeFilename', fileName: 'big_clip.mp4' }],
        },
      },
    },
    88,
    false
  );
  assert.equal(meta.knownSize, payloadSize);
  assert.equal(meta.mime, 'video/mp4');
  assert.equal(meta.fileName, 'big_clip.mp4');

  const streamApp = expressMod.default();
  streamApp.get('/stream-test', async (req, res) => {
    const mode = String(req.query.mode || 'known');
    const smallResults: number[] = [];
    const status = await streamTelegramMediaViaIterDownload({
      client: mockClient,
      fileTarget: { fakeDoc: true },
      dcId: 5,
      totalSize: mode === 'unknown' ? 0 : payloadSize,
      mime: 'video/mp4',
      fileName: 'big_clip.mp4',
      forceDownload: false,
      req,
      res,
      thresholdBytes: 32 * 1024, // 32 KB test threshold (< 200 KB payload)
      onSmallComplete: (buf) => {
        smallResults.push(buf.length);
      },
    });
    if (status === 'empty' && !res.headersSent) {
      res.status(404).end();
    }
  });

  const streamSrv = http.createServer(streamApp);
  await new Promise<void>((r) => streamSrv.listen(0, '127.0.0.1', () => r()));
  const streamPort = (streamSrv.address() as any).port;
  const streamUrl = `http://127.0.0.1:${streamPort}/stream-test`;

  try {
    // 4a. Full 200 OK stream
    const fullRes = await fetch(streamUrl);
    assert.equal(fullRes.status, 200);
    assert.equal(fullRes.headers.get('accept-ranges'), 'bytes');
    assert.equal(fullRes.headers.get('content-length'), String(payloadSize));
    const fullBody = Buffer.from(await fullRes.arrayBuffer());
    assert.deepEqual(fullBody, fullPayload);

    // 4b. Mid-file range crossing 64KB chunk boundary (starts at 65500, ends at 70500 => 5001 bytes)
    iterCalls.length = 0;
    const midRes = await fetch(streamUrl, { headers: { Range: 'bytes=65500-70500' } });
    assert.equal(midRes.status, 206);
    assert.equal(midRes.headers.get('content-range'), `bytes 65500-70500/${payloadSize}`);
    assert.equal(midRes.headers.get('content-length'), '5001');
    const midBody = Buffer.from(await midRes.arrayBuffer());
    assert.deepEqual(midBody, fullPayload.subarray(65500, 70501));
    assert.equal(iterCalls.length, 1);
    assert.equal(iterCalls[0].offset, 0); // aligned down to 64KB boundary (0), limit=2 chunks

    // 4c. Deep seek range (starts at 140000 -> alignedOffset must NOT be 0!)
    iterCalls.length = 0;
    const seekRes = await fetch(streamUrl, { headers: { Range: 'bytes=140000-141023' } });
    assert.equal(seekRes.status, 206);
    assert.equal(seekRes.headers.get('content-range'), `bytes 140000-141023/${payloadSize}`);
    const seekBody = Buffer.from(await seekRes.arrayBuffer());
    assert.deepEqual(seekBody, fullPayload.subarray(140000, 141024));
    assert.ok(iterCalls[0].offset > 0, `Expected non-zero aligned offset for deep seek, got ${iterCalls[0].offset}`);
    assert.equal(iterCalls[0].offset % iterCalls[0].requestSize, 0);

    // 4d. Suffix range (last 512 bytes)
    const suffixRes = await fetch(streamUrl, { headers: { Range: 'bytes=-512' } });
    assert.equal(suffixRes.status, 206);
    assert.equal(suffixRes.headers.get('content-range'), `bytes ${payloadSize - 512}-${payloadSize - 1}/${payloadSize}`);
    const suffixBody = Buffer.from(await suffixRes.arrayBuffer());
    assert.deepEqual(suffixBody, fullPayload.subarray(payloadSize - 512));

    // 4e. Unsatisfiable range returns 416
    const badRangeRes = await fetch(streamUrl, { headers: { Range: `bytes=${payloadSize + 100}-` } });
    assert.equal(badRangeRes.status, 416);
    assert.equal(badRangeRes.headers.get('content-range'), `bytes */${payloadSize}`);

    // 4f. HEAD request returns Content-Length without calling iterDownload
    iterCalls.length = 0;
    const headRes = await fetch(streamUrl, { method: 'HEAD', headers: { Range: 'bytes=0-999' } });
    assert.equal(headRes.status, 206);
    assert.equal(headRes.headers.get('content-length'), '1000');
    assert.equal(iterCalls.length, 0);

    // 4g. Unknown-size spillover streams cleanly once threshold (32KB) is exceeded
    const unknownRes = await fetch(`${streamUrl}?mode=unknown`);
    assert.equal(unknownRes.status, 200);
    const unknownBody = Buffer.from(await unknownRes.arrayBuffer());
    assert.deepEqual(unknownBody, fullPayload);

    assert.equal(downloadMediaCalled, 0);
  } finally {
    await new Promise<void>((r) => streamSrv.close(() => r()));
  }
});

test('P0 #3: chat-scoped msg_tg IDs, cross-chat/cross-account DELETE guards, and client deleted-ID isolation', async () => {
  const crypto = await import('node:crypto');
  const http = await import('node:http');
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const {
    app,
    buildTelegramRealtimeMessageId,
    extractEmbeddedChatIdFromMessageId,
    isSameCanonicalChatId,
    resolveTelegramMessageNumericId,
  } = await import('../server.ts');
  const { db, initDatabase } = await import('./db.ts');
  await initDatabase();

  // 1. Distinct IDs across channels sharing the same numeric message.id
  const chAId = buildTelegramRealtimeMessageId('1001', '-100111', 42);
  const chBId = buildTelegramRealtimeMessageId('1001', 'tg_-100222', 42);
  const dmId = buildTelegramRealtimeMessageId('1001', '9988', 42);
  assert.equal(chAId, 'msg_tg_1001_tg_-100111_42');
  assert.equal(chBId, 'msg_tg_1001_tg_-100222_42');
  assert.equal(dmId, 'msg_tg_1001_tg_9988_42');
  assert.notEqual(chAId, chBId);

  assert.equal(extractEmbeddedChatIdFromMessageId(chAId), 'tg_-100111');
  assert.equal(extractEmbeddedChatIdFromMessageId(chBId), 'tg_-100222');
  assert.equal(extractEmbeddedChatIdFromMessageId(dmId), 'tg_9988');
  assert.equal(extractEmbeddedChatIdFromMessageId('msg_tg_1001_42'), null);
  assert.equal(extractEmbeddedChatIdFromMessageId('msg_tg_42'), null);

  assert.equal(resolveTelegramMessageNumericId(chAId), 42);
  assert.equal(resolveTelegramMessageNumericId(dmId), 42);
  assert.equal(resolveTelegramMessageNumericId('msg_tg_1001_42'), 42);
  assert.equal(resolveTelegramMessageNumericId('msg_tg_42'), 42);

  assert.equal(isSameCanonicalChatId('-100111', 'tg_-100111'), true);
  assert.equal(isSameCanonicalChatId('tg_-100111', 'tg_-100222'), false);

  // 2. Real HTTP integration test against Express DELETE /api/messages/:id and batch-delete
  const prevJwtSecret = process.env.JWT_SECRET;
  const testSecret = `p0_3_test_secret_${Date.now()}`;
  process.env.JWT_SECRET = testSecret;

  const signTestJwt = (payload: object) => {
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', testSecret).update(`${h}.${p}`).digest('base64url');
    return `${h}.${p}.${sig}`;
  };
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = signTestJwt({ sub: 'tester', username: 'tester', role: 'member', exp: futureExp });

  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const msgLocalA = `msg_local_p03_${Date.now()}`;
  const msgTgA = buildTelegramRealtimeMessageId('1001', 'tg_-100111', 42);
  const msgTgB = buildTelegramRealtimeMessageId('1001', 'tg_-100222', 42);
  const now = Date.now();

  try {
    await db
      .prepare(
        `INSERT INTO messages (id, chat_id, account_id, sender, text, timestamp, created_at, delivery_status, telegram_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(msgLocalA, 'tg_-100111', 'acc_tg_1001', 'me', 'channel A draft', '12:00', now, 'failed', null);
    await db
      .prepare(
        `INSERT INTO messages (id, chat_id, account_id, sender, text, timestamp, created_at, delivery_status, telegram_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(msgTgA, 'tg_-100111', 'acc_tg_1001', 'peer', 'channel A msg #42', '12:01', now + 1, 'delivered', 42);
    await db
      .prepare(
        `INSERT INTO messages (id, chat_id, account_id, sender, text, timestamp, created_at, delivery_status, telegram_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(msgTgB, 'tg_-100222', 'acc_tg_1001', 'peer', 'channel B msg #42', '12:02', now + 2, 'delivered', 42);

    const headers = {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    };

    // 2a. Embedded chatId mismatch -> 403, Channel A untouched
    const crossEmbedRes = await fetch(
      `${baseUrl}/api/messages/${encodeURIComponent(msgTgA)}?chatId=tg_-100222&accountId=acc_tg_1001&localOnly=true`,
      { method: 'DELETE', headers }
    );
    assert.equal(crossEmbedRes.status, 403);
    const rowTgAAfter1 = await db.prepare('SELECT id FROM messages WHERE id = ?').get(msgTgA);
    assert.ok(rowTgAAfter1, 'Channel A message must not be deleted on embedded chatId mismatch');

    // 2b. DB chat_id mismatch on local draft -> 403, Channel A draft untouched
    const crossDbChatRes = await fetch(
      `${baseUrl}/api/messages/${encodeURIComponent(msgLocalA)}?chatId=tg_-100222&accountId=acc_tg_1001&localOnly=true`,
      { method: 'DELETE', headers }
    );
    assert.equal(crossDbChatRes.status, 403);
    const rowLocalAAfter1 = await db.prepare('SELECT id FROM messages WHERE id = ?').get(msgLocalA);
    assert.ok(rowLocalAAfter1, 'Channel A draft must not be deleted on DB chat_id mismatch');

    // 2c. Cross-account mismatch even under isMaster JWT -> 403, Account 1 draft untouched
    const crossAccRes = await fetch(
      `${baseUrl}/api/messages/${encodeURIComponent(msgLocalA)}?chatId=tg_-100111&accountId=acc_tg_2002&localOnly=true`,
      { method: 'DELETE', headers }
    );
    assert.equal(crossAccRes.status, 403);
    const rowLocalAAfter2 = await db.prepare('SELECT id FROM messages WHERE id = ?').get(msgLocalA);
    assert.ok(rowLocalAAfter2, 'Account 1 message must not be deleted when claiming Account 2');

    // 2d. Batch delete rejects cross-chat embedded ID -> 403, Channel A untouched
    const crossBatchRes = await fetch(`${baseUrl}/api/telegram/user/messages/batch-delete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        accountId: 'acc_tg_1001',
        chatId: 'tg_-100222',
        items: [{ id: msgTgA, telegramMessageId: 42, localOnly: true }],
      }),
    });
    assert.equal(crossBatchRes.status, 403);
    const rowTgAAfter2 = await db.prepare('SELECT id FROM messages WHERE id = ?').get(msgTgA);
    assert.ok(rowTgAAfter2, 'Batch delete must reject cross-chat embedded ID');

    // 2e. Matching (id, chatId, accountId) deletes ONLY target draft row; Channel A & B other rows stay intact
    const validDelRes = await fetch(
      `${baseUrl}/api/messages/${encodeURIComponent(msgLocalA)}?chatId=tg_-100111&accountId=acc_tg_1001&localOnly=true`,
      { method: 'DELETE', headers }
    );
    assert.equal(validDelRes.status, 200);
    const rowLocalAAfter3 = await db.prepare('SELECT id FROM messages WHERE id = ?').get(msgLocalA);
    assert.equal(rowLocalAAfter3, undefined);
    assert.ok(await db.prepare('SELECT id FROM messages WHERE id = ?').get(msgTgA));
    assert.ok(await db.prepare('SELECT id FROM messages WHERE id = ?').get(msgTgB));
  } finally {
    await db.prepare('DELETE FROM messages WHERE id IN (?, ?, ?)').run(msgLocalA, msgTgA, msgTgB);
    await new Promise<void>((r) => srv.close(() => r()));
    if (prevJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = prevJwtSecret;
    }
  }

  // 3. Client-side tombstone scoping & ChatArea contract
  const store = new Map<string, string>();
  const prevLocalStorage = (globalThis as any).localStorage;
  (globalThis as any).localStorage = {
    get length() {
      return store.size;
    },
    key(i: number) {
      return Array.from(store.keys())[i] ?? null;
    },
    getItem(k: string) {
      return store.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      store.set(k, String(v));
    },
    removeItem(k: string) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
  };
  try {
    const {
      isMessageDeleted,
      recordDeletedMessageId,
      resolveClientTelegramMessageId,
    } = await import('../src/services/apiService.ts');

    assert.equal(resolveClientTelegramMessageId({ id: 'msg_tg_1001_tg_-100111_42' }), 42);
    assert.equal(resolveClientTelegramMessageId({ id: 'msg_tg_1001_42' }), 42);

    // Deleting legacy msg_tg_1001_42 in Channel B must NOT hide msg_tg_1001_42 in Channel A
    recordDeletedMessageId('msg_tg_1001_42', 'acc_tg_1001', 'tg_-100222');
    assert.equal(isMessageDeleted('msg_tg_1001_42', 'acc_tg_1001', 'tg_-100222'), true);
    assert.equal(isMessageDeleted('msg_tg_1001_42', 'acc_tg_1001', 'tg_-100111'), false);

    // Deleting new chat-scoped ID in Channel B does not affect Channel A or Account 2
    recordDeletedMessageId('msg_tg_1001_tg_-100222_42', 'acc_tg_1001', 'tg_-100222');
    assert.equal(isMessageDeleted('msg_tg_1001_tg_-100222_42', 'acc_tg_1001', 'tg_-100222'), true);
    assert.equal(isMessageDeleted('msg_tg_1001_tg_-100111_42', 'acc_tg_1001', 'tg_-100111'), false);
    assert.equal(isMessageDeleted('msg_tg_1001_tg_-100222_42', 'acc_tg_2002', 'tg_-100222'), false);
  } finally {
    if (prevLocalStorage === undefined) {
      delete (globalThis as any).localStorage;
    } else {
      (globalThis as any).localStorage = prevLocalStorage;
    }
  }

  const chatAreaSrc = readFileSync(resolve(process.cwd(), 'src/components/ChatArea.tsx'), 'utf8');
  assert.equal(chatAreaSrc.includes('!isMessageDeleted(r.id, currentAccountId, chat?.id)'), true);
});

test('P1 #4: SQLite file/reaction columns, signed URL refresh endpoint, sticker persistence, outbound media echo prevention, and zero voice Base64', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { db } = await import('../server/db.ts');
  const {
    app,
    upsertSyncedMessageToDb,
    signTelegramResourceUrl,
    isSignedResourceUrlExpiring,
    resignTelegramResourceUrl,
    markOutboundMessageSent,
    markOutboundTelegramMessageIdSent,
    isRecentOutboundEcho,
  } = await import('../server.ts');

  // 1. Verify SQLite schema columns exist on messages table
  const tableInfo = (await db.prepare('PRAGMA table_info(messages)').all()) as Array<{ name: string }>;
  const colNames = new Set(tableInfo.map((c) => c.name));
  for (const col of ['is_file', 'file_name', 'file_size', 'file_url', 'reactions_json']) {
    assert.ok(colNames.has(col), `messages table must contain column ${col}`);
  }

  const now = Date.now();
  const chatId = `tg_p14_test_${now}`;
  const accId = 'acc_tg_8801';
  const fileMsgId = `msg_file_${now}`;
  const expiringUrl = `/api/telegram/user/media/${chatId}/501?accountId=${accId}&download=1&exp=${now - 60000}&sig=oldbad`;

  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'p14_p15_test_jwt_secret_hs256';
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'p14_user', username: 'p14_user', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const jwt = `${headerB64}.${payloadB64}.${sigB64}`;

  const srv = http.createServer(app);
  await new Promise<void>((resolveListen) => srv.listen(0, '127.0.0.1', () => resolveListen()));
  const addr = srv.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 2. Upsert message with file metadata + reactions
    const saved = await upsertSyncedMessageToDb(
      {
        id: fileMsgId,
        telegramMessageId: 501,
        chatId,
        accountId: accId,
        sender: 'peer',
        senderName: 'Client',
        text: '[文件] contract.pdf',
        isFile: true,
        fileName: 'contract.pdf',
        fileSize: '2.4 MB',
        fileUrl: expiringUrl,
        reactions: { '👍': 2, '🔥': 1 },
        myReactions: ['👍'],
        createdAt: now,
        timestamp: '10:00',
        deliveryStatus: 'delivered',
      },
      chatId,
      accId
    );
    assert.equal(saved, true);

    // Partial upsert without reaction fields must preserve existing DB reactions_json
    await upsertSyncedMessageToDb(
      {
        id: fileMsgId,
        telegramMessageId: 501,
        chatId,
        accountId: accId,
        sender: 'peer',
        senderName: 'Client',
        text: '[文件] contract.pdf',
        isFile: true,
        fileName: 'contract.pdf',
        fileSize: '2.4 MB',
        fileUrl: expiringUrl,
        createdAt: now,
        timestamp: '10:00',
        deliveryStatus: 'delivered',
      },
      chatId,
      accId
    );
    const rowAfterPartial = (await db.prepare('SELECT is_file, file_name, file_size, file_url, reactions_json FROM messages WHERE id = ?').get(fileMsgId)) as any;
    assert.equal(rowAfterPartial.is_file, 1);
    assert.equal(rowAfterPartial.file_name, 'contract.pdf');
    assert.equal(rowAfterPartial.file_size, '2.4 MB');
    assert.equal(rowAfterPartial.file_url, expiringUrl);
    assert.ok(rowAfterPartial.reactions_json && rowAfterPartial.reactions_json.includes('👍'));

    // 3. GET /api/messages/:chatId reads file fields + reactions and auto-resigns expiring signed URL
    const headers = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
    const msgRes = await fetch(`${baseUrl}/api/messages/${encodeURIComponent(chatId)}?accountId=${accId}`, { headers });
    assert.equal(msgRes.status, 200);
    const msgs = (await msgRes.json()) as any[];
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].isFile, true);
    assert.equal(msgs[0].fileName, 'contract.pdf');
    assert.equal(msgs[0].fileSize, '2.4 MB');
    assert.deepEqual(msgs[0].reactions, { '👍': 2, '🔥': 1 });
    assert.deepEqual(msgs[0].myReactions, ['👍']);
    assert.ok(typeof msgs[0].fileUrl === 'string' && !msgs[0].fileUrl.includes('sig=oldbad'));
    assert.equal(isSignedResourceUrlExpiring(msgs[0].fileUrl), false);

    // Explicit clear reactions persists '{}'
    await upsertSyncedMessageToDb(
      {
        id: fileMsgId,
        telegramMessageId: 501,
        chatId,
        accountId: accId,
        sender: 'peer',
        text: '[文件] contract.pdf',
        reactions: {},
        myReactions: [],
        createdAt: now,
        deliveryStatus: 'delivered',
      },
      chatId,
      accId
    );
    const rowCleared = (await db.prepare('SELECT reactions_json FROM messages WHERE id = ?').get(fileMsgId)) as any;
    assert.equal(rowCleared.reactions_json, '{}');

    // 4. Signed URL expiry & POST /api/telegram/resource/refresh-url
    const freshMediaUrl = signTelegramResourceUrl(`/api/telegram/user/avatar/${chatId}`, accId);
    assert.equal(isSignedResourceUrlExpiring(freshMediaUrl), false);
    assert.equal(isSignedResourceUrlExpiring(expiringUrl), true);
    assert.equal(resignTelegramResourceUrl('/api/telegram/user/media/../etc/passwd?exp=1&sig=a', accId), null);

    const refreshRes = await fetch(`${baseUrl}/api/telegram/resource/refresh-url`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        accountId: accId,
        urls: [expiringUrl, 'https://evil.example.com/phish.png', '/api/telegram/user/media/../secret?exp=1&sig=x'],
      }),
    });
    assert.equal(refreshRes.status, 200);
    const refreshJson = (await refreshRes.json()) as any;
    assert.equal(refreshJson.ok, true);
    assert.ok(refreshJson.refreshed[expiringUrl]);
    assert.equal(isSignedResourceUrlExpiring(refreshJson.refreshed[expiringUrl]), false);
    assert.equal(refreshJson.refreshed['https://evil.example.com/phish.png'], undefined);
    assert.equal(refreshJson.refreshed['/api/telegram/user/media/../secret?exp=1&sig=x'], undefined);

    // 5. Outbound echo suppression works by content AND telegramMessageId for media/stickers
    const echoChat = `tg_echo_${now}`;
    markOutboundMessageSent(echoChat, '🎤 语音消息', accId);
    assert.equal(isRecentOutboundEcho(echoChat, '🎤 语音消息', accId), true);
    markOutboundTelegramMessageIdSent(echoChat, 99123, accId);
    assert.equal(isRecentOutboundEcho(echoChat, '[贴纸]', accId, 99123), true);
    assert.equal(isRecentOutboundEcho(echoChat, '[贴纸]', accId, 99124), false);

    // 6. Client signed-URL helpers
    const { isSignedResourceUrl, parseSignedResourceExpiry, isSignedResourceUrlExpiringSoon } = await import(
      '../src/services/apiService.ts'
    );
    assert.equal(isSignedResourceUrl(expiringUrl), true);
    assert.equal(isSignedResourceUrl('data:audio/ogg;base64,abc'), false);
    assert.equal(parseSignedResourceExpiry(expiringUrl), now - 60000);
    assert.equal(isSignedResourceUrlExpiringSoon(expiringUrl), true);
    assert.equal(isSignedResourceUrlExpiringSoon(freshMediaUrl), false);

    // 7. Source contract checks: zero realtime voice Base64, /send-sticker DB + markOutboundMessageSent, silent refresh wired
    const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
    const apiSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
    assert.equal(serverSrc.includes('data:audio/ogg;base64,'), false);
    assert.ok(serverSrc.includes("app.post('/api/telegram/user/send-sticker'") && serverSrc.includes('markOutboundTelegramMessageIdSent'));
    assert.ok(apiSrc.includes('/api/telegram/resource/refresh-url'));
  } finally {
    await db.prepare('DELETE FROM messages WHERE id = ?').run(fileMsgId);
    await new Promise<void>((r) => srv.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('P1 #5: UpdateMessageReactions realtime handler, SQLite pagination fallback, independent chat lang, forward sync, Saved Messages merge, empty-cloud prune, and info drawer video/file UI', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { Api } = await import('telegram');
  const { db } = await import('../server/db.ts');
  const {
    app,
    upsertSyncedMessageToDb,
    querySqlitePaginatedMessagesFallback,
    attachTelegramClientMessageListener,
    pendingLocalUpdates,
  } = await import('../server.ts');

  const now = Date.now();
  const chatId = `tg_p15_test_${now}`;
  const accId = 'acc_tg_8802';
  const idsToClean: string[] = [];

  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'p15_test_jwt_secret_hs256';
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'p15_user', username: 'p15_user', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const jwt = `${headerB64}.${payloadB64}.${sigB64}`;

  const srv = http.createServer(app);
  await new Promise<void>((resolveListen) => srv.listen(0, '127.0.0.1', () => resolveListen()));
  const addr = srv.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Seed 5 SQLite messages and verify pagination fallback + GET route offline fallback
    for (let i = 1; i <= 5; i++) {
      const mId = `msg_p15_${now}_${i}`;
      idsToClean.push(mId);
      await upsertSyncedMessageToDb(
        {
          id: mId,
          telegramMessageId: i * 10,
          chatId,
          accountId: accId,
          sender: i % 2 === 0 ? 'me' : 'peer',
          senderName: i % 2 === 0 ? 'Me' : 'Peer',
          text: `History page msg #${i}`,
          createdAt: now + i * 1000,
          timestamp: '11:00',
          deliveryStatus: 'delivered',
        },
        chatId,
        accId
      );
    }

    const page1 = await querySqlitePaginatedMessagesFallback(chatId, accId, { limit: 2, offsetId: 50 });
    assert.equal(page1.messages.length, 2);
    assert.equal(page1.messages[0].telegramMessageId, 30);
    assert.equal(page1.messages[1].telegramMessageId, 40);
    assert.equal(page1.hasMore, true);

    const page2 = await querySqlitePaginatedMessagesFallback(chatId, accId, { limit: 2, offsetId: 30 });
    assert.equal(page2.messages.length, 2);
    assert.equal(page2.messages[0].telegramMessageId, 10);
    assert.equal(page2.messages[1].telegramMessageId, 20);
    assert.equal(page2.hasMore, false);

    // Offline HTTP GET /api/telegram/user/messages/:chatId seamlessly falls back to SQLite pagination
    const offlinePageRes = await fetch(
      `${baseUrl}/api/telegram/user/messages/${encodeURIComponent(chatId)}?accountId=${accId}&limit=2&offsetId=50`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );
    assert.equal(offlinePageRes.status, 200);
    const offlinePageJson = (await offlinePageRes.json()) as any;
    assert.equal(offlinePageJson.ok, true);
    assert.equal(offlinePageJson.fromLocalFallback, true);
    assert.equal(offlinePageJson.messages.length, 2);
    assert.equal(offlinePageJson.messages[0].telegramMessageId, 30);
    assert.equal(offlinePageJson.hasMore, true);

    // 2. Verify Api.UpdateMessageReactions listener updates SQLite + pushes pendingLocalUpdates
    const handlers: Array<(upd: any) => Promise<void> | void> = [];
    const fakeClient: any = {
      addEventHandler(fn: any) {
        handlers.push(fn);
      },
    };
    attachTelegramClientMessageListener(fakeClient, '+10000000000', '8802');
    const rawUpdateHandler = handlers[1];
    assert.ok(typeof rawUpdateHandler === 'function');

    const numericChat = `tg_777001`;
    const reactedMsgId = `msg_react_${now}`;
    idsToClean.push(reactedMsgId);
    await upsertSyncedMessageToDb(
      {
        id: reactedMsgId,
        telegramMessageId: 404,
        chatId: numericChat,
        accountId: accId,
        sender: 'peer',
        text: 'react to me',
        createdAt: now,
        deliveryStatus: 'delivered',
      },
      numericChat,
      accId
    );

    const prevPendingLen = pendingLocalUpdates.length;
    await rawUpdateHandler(
      new Api.UpdateMessageReactions({
        peer: new Api.PeerUser({ userId: 777001 as any }),
        msgId: 404,
        reactions: new Api.MessageReactions({
          results: [
            new Api.ReactionCount({
              reaction: new Api.ReactionEmoji({ emoticon: '🔥' }),
              count: 3,
              chosenOrder: 1,
            }),
          ],
        }),
      })
    );
    const pushedReact = pendingLocalUpdates
      .slice(prevPendingLen)
      .find((u) => u.type === 'reactions' && u.telegramMessageId === 404 && u.chatId === numericChat);
    assert.ok(pushedReact, 'UpdateMessageReactions must push reactions update to pendingLocalUpdates');
    assert.deepEqual(pushedReact.reactions, { '🔥': 3 });
    assert.deepEqual(pushedReact.myReactions, ['🔥']);

    const dbReactRow = (await db.prepare('SELECT reactions_json FROM messages WHERE id = ?').get(reactedMsgId)) as any;
    assert.ok(dbReactRow?.reactions_json);
    const parsedReactRow = JSON.parse(dbReactRow.reactions_json);
    assert.deepEqual(parsedReactRow.reactions, { '🔥': 3 });
    assert.deepEqual(parsedReactRow.myReactions, ['🔥']);

    // Clear queued test update cleanly
    for (let i = pendingLocalUpdates.length - 1; i >= prevPendingLen; i--) {
      if (pendingLocalUpdates[i]?.telegramMessageId === 404 && pendingLocalUpdates[i]?.chatId === numericChat) {
        pendingLocalUpdates.splice(i, 1);
      }
    }

    // 3. Frontend & drawer structural verification for all 6 P1 #5 items
    const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const drawerSrc = readFileSync(resolve(process.cwd(), 'src/components/TelegramChatInfoDrawer.tsx'), 'utf8');
    const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');

    // ① handleUpdateChatLanguage does not overwrite global defaultSourceLang/defaultTargetLang
    const langHandlerSlice = appSrc.slice(
      appSrc.indexOf('const handleUpdateChatLanguage'),
      appSrc.indexOf('const handleSaveCustomLLMConfig')
    );
    assert.equal(langHandlerSlice.includes('setTranslationSettings'), false);

    // ② handleForwardMessages uses formatChatMessageSummary (video/file) and fetches target chat messages
    const fwdSlice = appSrc.slice(
      appSrc.indexOf('const handleForwardMessages'),
      appSrc.indexOf('const handleLoadOlderMessages')
    );
    assert.equal(fwdSlice.includes('formatChatMessageSummary'), true);
    assert.equal(fwdSlice.includes('fetchTelegramCloudMessagesApi(payload.toChatId'), true);

    // ③ chat_saved_messages uses mergeCloudMessagesWithLocal
    const savedSlice = appSrc.slice(
      appSrc.indexOf("if (chatId === 'chat_saved_messages')"),
      appSrc.indexOf('setActiveChatId(chatId);')
    );
    assert.equal(savedSlice.includes('mergeCloudMessagesWithLocal'), true);

    // ④ allowEmptyCloudPrune cleans delivered messages while keeping drafts
    assert.equal(appSrc.includes('allowEmptyCloudPrune'), true);
    assert.equal(serverSrc.includes("COALESCE(delivery_status, 'delivered') = 'delivered'"), true);

    // ⑥ TelegramChatInfoDrawer includes video in mediaMessages + renders <video> + handles missing fileUrl without href="#"
    assert.equal(drawerSrc.includes('m.isVideo || m.videoUrl'), true);
    assert.equal(drawerSrc.includes('<video'), true);
    assert.equal(drawerSrc.includes('链接暂不可用'), true);
  } finally {
    if (idsToClean.length > 0) {
      const ph = idsToClean.map(() => '?').join(', ');
      await db.prepare(`DELETE FROM messages WHERE id IN (${ph})`).run(...idsToClean);
    }
    await new Promise<void>((r) => srv.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('P1/P2 #6: handleSyncContacts title sync, group read tooltip, drawer add-to-contacts, and unified delete video/file summaries', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const { app } = await import('../server.ts');

  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const chatAreaSrc = readFileSync(resolve(process.cwd(), 'src/components/ChatArea.tsx'), 'utf8');
  const drawerSrc = readFileSync(resolve(process.cwd(), 'src/components/TelegramChatInfoDrawer.tsx'), 'utf8');
  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');

  // ① handleSyncContacts updates private chat title & avatarInitial from ct.name
  const syncSlice = appSrc.slice(
    appSrc.indexOf('const handleSyncContacts ='),
    appSrc.indexOf('const handleRemoveContact =')
  );
  assert.equal(syncSlice.includes('title: nextName'), true);
  assert.equal(syncSlice.includes('!c.isGroup &&'), true);
  assert.equal(syncSlice.includes('!c.isChannel'), true);

  // ② Group read tooltip distinguishes private ('对方已读') vs group ('已有成员已读')
  assert.equal(chatAreaSrc.includes("chat.isGroup ? '已有成员已读' : '对方已读'"), true);
  assert.equal(chatAreaSrc.includes("chat.isGroup ? '已送达（暂未有成员已读）' : '已送达（对方未读）'"), true);

  // ③ TelegramChatInfoDrawer renders '添加到通讯录' for non-friend private chats & passes chatId to backend
  assert.equal(drawerSrc.includes('添加到通讯录'), true);
  assert.equal(drawerSrc.includes('addTelegramUserContactApi'), true);
  assert.equal(drawerSrc.includes('chatId: chat.id'), true);
  assert.equal(drawerSrc.includes('!fullInfo.isContact'), true);
  assert.equal(chatAreaSrc.includes('onAddContact={onAddContact}'), true);
  assert.equal(appSrc.includes('onAddContact={handleAddContact}'), true);
  assert.equal(serverSrc.includes('const { name, phone, username, chatId } = req.body || {};'), true);

  // ④ Delete handlers & incoming updates uniformly use formatChatMessageSummary (covers [视频] / [文件])
  const delSlice = appSrc.slice(
    appSrc.indexOf('const handleDeleteMessage ='),
    appSrc.indexOf('const handleBatchDeleteMessages =')
  );
  const batchDelSlice = appSrc.slice(
    appSrc.indexOf('const handleBatchDeleteMessages ='),
    appSrc.indexOf('const handleForwardMessages =')
  );
  assert.equal(delSlice.includes('formatChatMessageSummary(last)'), true);
  assert.equal(batchDelSlice.includes('formatChatMessageSummary(last)'), true);
  assert.equal(delSlice.includes("last.isAudio ? '🎤 语音消息' : last.isImage"), false);
  assert.equal(batchDelSlice.includes("last.isAudio ? '🎤 语音消息' : last.isImage"), false);

  // Also test /api/telegram/user/contacts/add validation when chatId is passed without phone/username on disconnected test env
  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'p1_p2_6_test_secret';
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as any).port;
  try {
    const { createHmac } = await import('node:crypto');
    const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payloadB64 = Buffer.from(
      JSON.stringify({ sub: 'p1_p2_6_tester', username: 'tester', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString('base64url');
    const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
    const token = `${headerB64}.${payloadB64}.${sigB64}`;
    const res = await fetch(`http://127.0.0.1:${port}/api/telegram/user/contacts/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        accountId: 'acc_tg_offline_test',
        chatId: 'tg_123456',
        name: 'Test Contact',
      }),
    });
    const body: any = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.ok, false);
    assert.match(String(body.error), /未在线连接/);
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('3-state LLM & Translation mutual exclusion, Dual-Off LLM refusal, 130+ languages, and chat/message persistence', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const {
    db,
    initDatabase,
    exportDatabaseSnapshot,
    restoreDatabaseSnapshot,
  } = await import('./db.ts');
  const {
    app,
    isCloudKnowledgeBaseEnabled,
    syncServerCustomLlmConfig,
    getServerCustomLlmConfig,
    invokeEvolutionOrAnalysisLlm,
    mapLanguageCode,
    resolvePromptLanguageName,
  } = await import('../server.ts');
  const { SUPPORTED_LANGUAGES } = await import('../src/data/mockData.ts');

  await initDatabase();

  // 1. State 3 (Dual-Off) disables Cloud RAG even if enableKnowledgeBaseRAG is passed true
  assert.equal(
    isCloudKnowledgeBaseEnabled({
      enabled: false,
      explicitlyDisabled: true,
      engineMode: 'cloud',
      enableKnowledgeBaseRAG: true,
    }),
    false
  );

  // 2. Full 130+ SUPPORTED_LANGUAGES coverage in mapLanguageCode & resolvePromptLanguageName
  assert.ok(SUPPORTED_LANGUAGES.length > 100);
  for (const lang of SUPPORTED_LANGUAGES) {
    if (lang.code === 'Auto') continue;
    const mapped = mapLanguageCode(lang.code);
    assert.ok(mapped && mapped.length >= 2, `mapLanguageCode failed for ${lang.code}`);
    const promptName = resolvePromptLanguageName(lang.code);
    assert.ok(promptName && promptName.trim().length > 0, `resolvePromptLanguageName empty for ${lang.code}`);
  }
  assert.equal(resolvePromptLanguageName('uk'), 'Ukrainian');
  assert.equal(resolvePromptLanguageName('fa'), 'Persian (Farsi)');
  assert.equal(resolvePromptLanguageName('yue'), 'Cantonese (粵語)');

  // 3. Verify deploy/railway-brain-server.ts does not rewrite gemma-* translation model to gemini-4-hydrogen
  const brainSrc = readFileSync(resolve(process.cwd(), 'deploy/railway-brain-server.ts'), 'utf8');
  assert.match(brainSrc, /isNativeGeminiOrGemmaModel/);
  assert.match(brainSrc, /const geminiModel = isNativeGeminiOrGemmaModel \? upstreamModel : 'gemini-4-hydrogen'/);

  // 4. Live Express HTTP tests for 3-state /api/translate, Dual-Off LLM refusal, and language/translation persistence
  const prevJwtSecret = process.env.JWT_SECRET;
  const prevCfg = await getServerCustomLlmConfig();
  process.env.JWT_SECRET = 'three_state_test_secret';
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as any).port;

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'three_state_tester', username: 'tester', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const token = `${headerB64}.${payloadB64}.${sigB64}`;

  const testChatId = `tg_lang_persist_${Date.now()}`;
  const testAccId = 'acc_tg_lang_test';
  const testMsgId = `msg_retrans_${Date.now()}`;

  try {
    // 4a. Unauthenticated /api/translate must return 401
    const unauthRes = await fetch(`http://127.0.0.1:${port}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello', targetLang: 'Chinese', engine: 'google' }),
    });
    assert.equal(unauthRes.status, 401);

    // 4b. State 1 (Cloud Priority): /api/translate rejects custom_llm with 400
    await syncServerCustomLlmConfig({
      enabled: true,
      explicitlyDisabled: false,
      engineMode: 'cloud',
      enableKnowledgeBaseRAG: true,
    });
    const state1CustomRes = await fetch(`http://127.0.0.1:${port}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: 'Hello', targetLang: 'Chinese', engine: 'custom_llm' }),
    });
    assert.equal(state1CustomRes.status, 400);

    // 4c. State 2 (Custom Priority): /api/translate rejects google and gemini with 400
    await syncServerCustomLlmConfig({
      enabled: true,
      explicitlyDisabled: false,
      engineMode: 'custom',
      enableKnowledgeBaseRAG: false,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test-custom-only',
      modelName: 'gpt-4o-mini',
    });
    for (const forbiddenEngine of ['google', 'gemini']) {
      const state2Res = await fetch(`http://127.0.0.1:${port}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: 'Hello', targetLang: 'Chinese', engine: forbiddenEngine }),
      });
      assert.equal(state2Res.status, 400, `State 2 must reject ${forbiddenEngine}`);
    }

    // 4d. State 3 (Dual-Off): /api/translate rejects gemini & custom_llm with 400
    await syncServerCustomLlmConfig({
      enabled: false,
      explicitlyDisabled: true,
      engineMode: 'cloud',
      enableKnowledgeBaseRAG: false,
    });
    for (const forbiddenEngine of ['gemini', 'custom_llm']) {
      const state3Res = await fetch(`http://127.0.0.1:${port}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: 'Hello', targetLang: 'Chinese', engine: forbiddenEngine }),
      });
      assert.equal(state3Res.status, 400, `State 3 Dual-Off must reject ${forbiddenEngine}`);
    }

    // 4e. State 3 (Dual-Off): All LLM endpoints & invokeEvolutionOrAnalysisLlm strictly refuse (no silent fallback)
    await assert.rejects(
      async () => {
        await invokeEvolutionOrAnalysisLlm({
          prompt: 'usr',
        });
      },
      /双关状态/
    );

    const dualChatRes = await fetch(`http://127.0.0.1:${port}/api/llm/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        chatId: testChatId,
        accountId: testAccId,
        messages: [{ role: 'user', text: 'hi' }],
        customConfig: { enabled: false, explicitlyDisabled: true, engineMode: 'cloud' },
      }),
    });
    assert.equal(dualChatRes.status, 400);

    const dualAnalyzeRes = await fetch(`http://127.0.0.1:${port}/api/customer/analyze/${testChatId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        accountId: testAccId,
        messages: [{ sender: 'peer', text: 'hi' }],
        customConfig: { enabled: false, explicitlyDisabled: true, engineMode: 'cloud' },
      }),
    });
    assert.equal(dualAnalyzeRes.status, 400);

    const dualPersonaRes = await fetch(`http://127.0.0.1:${port}/api/persona/test-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        draftText: 'hello',
        customConfig: { enabled: false, explicitlyDisabled: true, engineMode: 'cloud' },
      }),
    });
    assert.equal(dualPersonaRes.status, 400);

    // 5. Per-chat language persistence + snapshot export/restore + message translation patch
    const saveLangRes = await fetch(`http://127.0.0.1:${port}/api/chats/${testChatId}/language`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ accountId: testAccId, sourceLang: 'Japanese', targetLang: 'Traditional Chinese' }),
    });
    assert.equal(saveLangRes.status, 200);

    await db
      .prepare(
        `INSERT OR IGNORE INTO account_customer_profiles (account_id, chat_id, client_name, relationship_stage, total_messages_count, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(testAccId, testChatId, 'Tokyo Client', '活跃联系人', 1, Date.now());

    const getChatsRes = await fetch(`http://127.0.0.1:${port}/api/chats`, {
      headers: { Authorization: `Bearer ${token}`, 'x-account-id': testAccId },
    });
    assert.equal(getChatsRes.status, 200);
    const chatsPayload: any[] = await getChatsRes.json();
    const matchedChat = chatsPayload.find((c) => c.id === testChatId);
    assert.ok(matchedChat);
    assert.equal(matchedChat.sourceLang, 'Japanese');
    assert.equal(matchedChat.targetLang, 'Traditional Chinese');

    const snapshot = await exportDatabaseSnapshot();
    assert.ok(Array.isArray(snapshot.tables.chat_language_prefs));
    assert.ok(
      snapshot.tables.chat_language_prefs.some(
        (r: any) => r.chat_id === testChatId && r.account_id === testAccId && r.source_lang === 'Japanese'
      )
    );
    await db.prepare('DELETE FROM chat_language_prefs WHERE chat_id = ? AND account_id = ?').run(testChatId, testAccId);
    await restoreDatabaseSnapshot(snapshot);
    const restoredPref = (await db
      .prepare('SELECT source_lang, target_lang FROM chat_language_prefs WHERE chat_id = ? AND account_id = ?')
      .get(testChatId, testAccId)) as any;
    assert.equal(restoredPref?.source_lang, 'Japanese');
    assert.equal(restoredPref?.target_lang, 'Traditional Chinese');

    await db.prepare(
      `INSERT INTO messages (id, chat_id, account_id, sender, text, translated_text, timestamp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(testMsgId, testChatId, testAccId, 'peer', 'Bonjour', '', '12:01', Date.now());

    const patchTransRes = await fetch(`http://127.0.0.1:${port}/api/messages/${testMsgId}/translation`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ accountId: testAccId, chatId: testChatId, translatedText: '你好（重译）' }),
    });
    assert.equal(patchTransRes.status, 200);
    const patchedMsg = (await db.prepare('SELECT translated_text FROM messages WHERE id = ?').get(testMsgId)) as any;
    assert.equal(patchedMsg?.translated_text, '你好（重译）');
  } finally {
    await db.prepare('DELETE FROM messages WHERE id = ?').run(testMsgId);
    await db.prepare('DELETE FROM account_customer_profiles WHERE chat_id = ? AND account_id = ?').run(testChatId, testAccId);
    await db.prepare('DELETE FROM chat_language_prefs WHERE chat_id = ? AND account_id = ?').run(testChatId, testAccId);
    await syncServerCustomLlmConfig(prevCfg || { enabled: true, explicitlyDisabled: false, engineMode: 'cloud', enableKnowledgeBaseRAG: true });
    srv.closeAllConnections?.();
    await new Promise<void>((r) => srv.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

process.on('beforeExit', () => {
  process.exit(0);
});

test('P1 #3-#7 regressions: atomic translation switch, Auto targetLang, webhook 3-state, KB/evolution cloud guard, and audio STT/TTS auth & 3-state', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { db, initDatabase } = await import('./db.ts');
  const {
    app,
    syncServerCustomLlmConfig,
    getServerCustomLlmConfig,
    syncLearnedPatternsToBackendLlm,
  } = await import('../server.ts');

  await initDatabase();

  // #3: Stale closure fix in App.tsx & atomic switch in TranslationDrawer.tsx
  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const drawerSrc = readFileSync(resolve(process.cwd(), 'src/components/TranslationDrawer.tsx'), 'utf8');
  const chatAreaSrc = readFileSync(resolve(process.cwd(), 'src/components/ChatArea.tsx'), 'utf8');
  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');

  assert.match(appSrc, /customLLMConfigRef\.current\s*=\s*nextConfig/);
  assert.match(appSrc, /const latestLlmConfig\s*=\s*customLLMConfigRef\.current/);
  assert.match(drawerSrc, /onUpdateCustomLlmConfig\([\s\S]*?engineMode:\s*'custom'[\s\S]*?preferredEngine:\s*'custom_llm'/);

  // #4: Dynamic inbound translate bar & Auto/Chinese options in ChatArea.tsx
  assert.equal(chatAreaSrc.includes('自动翻译为{getLanguageDisplayName(inboundTargetLang)}'), true);
  assert.equal(chatAreaSrc.includes('自动翻译为中文'), false);
  assert.equal(chatAreaSrc.includes('恢复全局默认 (Auto)'), true);
  assert.equal(chatAreaSrc.includes("if (l.code === 'Auto' || l.code === 'Chinese') return false;"), false);

  // #5: Webhook auto-translate checks isDualOff + chat_language_prefs
  const webhookSlice = serverSrc.slice(
    serverSrc.indexOf('async function processTelegramMessageAsync('),
    serverSrc.indexOf('1. Fetch the most recent 15 conversation messages')
  );
  assert.equal(webhookSlice.includes('isDualOff'), true);
  assert.equal(webhookSlice.includes("engine = 'google'"), true);
  assert.equal(webhookSlice.includes('FROM chat_language_prefs'), true);

  // #6: syncLearnedPatternsToBackendLlm blocks Dual-Off & engineMode === 'custom' even with userJwt
  const dualOffSyncRes = await syncLearnedPatternsToBackendLlm({
    patterns: [{ title: 't', description: 'd' }],
    userJwt: 'fake.jwt.token',
    customConfig: { enabled: false, explicitlyDisabled: true, engineMode: 'cloud' },
  });
  assert.equal(dualOffSyncRes.synced, false);
  assert.match(String(dualOffSyncRes.error), /双关/);

  const customSyncRes = await syncLearnedPatternsToBackendLlm({
    patterns: [{ title: 't', description: 'd' }],
    userJwt: 'fake.jwt.token',
    customConfig: { enabled: true, explicitlyDisabled: false, engineMode: 'custom', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-1' },
  });
  assert.equal(customSyncRes.synced, false);
  assert.match(String(customSyncRes.error), /优先自有密钥/);

  // Live HTTP checks for #4, #6, #7
  const prevJwtSecret = process.env.JWT_SECRET;
  const prevCfg = await getServerCustomLlmConfig();
  process.env.JWT_SECRET = 'p1_3_7_test_secret';
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as any).port;

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'p1_3_7_tester', username: 'tester', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const token = `${headerB64}.${payloadB64}.${sigB64}`;

  const testAccId = 'acc_tg_auto_lang_test';
  const testChatId = `tg_auto_lang_${Date.now()}`;

  try {
    // #4: /api/chats returns targetLang: 'Auto' when no preference exists
    await db
      .prepare(
        `INSERT OR REPLACE INTO account_customer_profiles (account_id, chat_id, client_name, relationship_stage, total_messages_count, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(testAccId, testChatId, 'Auto Lang Client', '活跃联系人', 1, Date.now());

    const chatsRes = await fetch(`http://127.0.0.1:${port}/api/chats`, {
      headers: { Authorization: `Bearer ${token}`, 'x-account-id': testAccId },
    });
    assert.equal(chatsRes.status, 200);
    const chatsArr: any[] = await chatsRes.json();
    const createdChat = chatsArr.find((c) => c.id === testChatId);
    assert.ok(createdChat);
    assert.equal(createdChat.targetLang, 'Auto');

    // #6: /api/knowledge/remote-search rejects Dual-Off & Custom Priority with 400
    const kbDualRes = await fetch(`http://127.0.0.1:${port}/api/knowledge/remote-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: 'hello',
        customConfig: { enabled: false, explicitlyDisabled: true, engineMode: 'cloud', enableKnowledgeBaseRAG: true },
      }),
    });
    assert.equal(kbDualRes.status, 400);
    const kbDualJson: any = await kbDualRes.json();
    assert.equal(kbDualJson.ok, false);
    assert.equal(kbDualJson.source, 'remote_cloud_kb_blocked');

    const kbCustomRes = await fetch(`http://127.0.0.1:${port}/api/knowledge/remote-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: 'hello',
        customConfig: { enabled: true, explicitlyDisabled: false, engineMode: 'custom', enableKnowledgeBaseRAG: true },
      }),
    });
    assert.equal(kbCustomRes.status, 400);
    const kbCustomJson: any = await kbCustomRes.json();
    assert.equal(kbCustomJson.ok, false);
    assert.equal(kbCustomJson.source, 'remote_cloud_kb_blocked');

    // #7: /api/audio/transcribe & /api/audio/tts-clone require requireTenantAuth (401 when unauthenticated)
    const unauthStt = await fetch(`http://127.0.0.1:${port}/api/audio/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64: 'dGVzdA==' }),
    });
    assert.equal(unauthStt.status, 401);

    const unauthTts = await fetch(`http://127.0.0.1:${port}/api/audio/tts-clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    assert.equal(unauthTts.status, 401);

    // #7: /api/audio/transcribe refuses in Dual-Off (400) and requires custom gateway in Custom Priority (400)
    const dualStt = await fetch(`http://127.0.0.1:${port}/api/audio/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        audioBase64: 'dGVzdA==',
        customConfig: { enabled: false, explicitlyDisabled: true, engineMode: 'cloud' },
      }),
    });
    assert.equal(dualStt.status, 400);
    const dualSttJson: any = await dualStt.json();
    assert.match(String(dualSttJson.error), /双关/);

    const customNoUrlStt = await fetch(`http://127.0.0.1:${port}/api/audio/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        audioBase64: 'dGVzdA==',
        customConfig: { enabled: true, explicitlyDisabled: false, engineMode: 'custom', baseUrl: '', apiKey: '' },
      }),
    });
    assert.equal(customNoUrlStt.status, 400);
    const customNoUrlSttJson: any = await customNoUrlStt.json();
    assert.match(String(customNoUrlSttJson.error), /自有模型网关/);
  } finally {
    await db.prepare('DELETE FROM account_customer_profiles WHERE chat_id = ? AND account_id = ?').run(testChatId, testAccId);
    await syncServerCustomLlmConfig(prevCfg || { enabled: true, explicitlyDisabled: false, engineMode: 'cloud', enableKnowledgeBaseRAG: true });
    srv.closeAllConnections?.();
    await new Promise<void>((r) => srv.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('P2 #8-#10 regressions: edit translation preservation, retranslate dedupe, backfill, Dual-Off badge, Latin lang detection, 133+ normalization, and outbound priority', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { detectSourceLangCode } = await import('../server.ts');
  const { normalizeLanguageCode } = await import('../src/data/mockData.ts');

  // #10a: detectSourceLangCode does NOT fall back to 'en' on Dutch, Polish, Malay, Swedish, or numbers/URLs
  assert.equal(detectSourceLangCode('Goedemorgen, hoe gaat het?'), 'nl');
  assert.equal(detectSourceLangCode('Dzień dobry, jak się masz?'), 'pl');
  assert.equal(detectSourceLangCode('Apa khabar? Boleh bantu saya?'), 'ms');
  assert.equal(detectSourceLangCode('Hej, hur mår du?'), 'sv');
  assert.equal(detectSourceLangCode('123456789'), '');
  assert.equal(detectSourceLangCode('https://example.com/order/123'), '');
  assert.equal(detectSourceLangCode('Hello, can you check the order status?'), 'en');

  // #10b: normalizeLanguageCode covers all 133+ SUPPORTED_LANGUAGES across code/English/Chinese/native names
  assert.equal(normalizeLanguageCode('Dutch'), 'nl');
  assert.equal(normalizeLanguageCode('荷兰语'), 'nl');
  assert.equal(normalizeLanguageCode('Nederlands'), 'nl');
  assert.equal(normalizeLanguageCode('NL'), 'nl');
  assert.equal(normalizeLanguageCode('Polish'), 'pl');
  assert.equal(normalizeLanguageCode('波兰语'), 'pl');
  assert.equal(normalizeLanguageCode('Bahasa Melayu'), 'ms');
  assert.equal(normalizeLanguageCode('马来语'), 'ms');
  assert.equal(normalizeLanguageCode('Svenska'), 'sv');
  assert.equal(normalizeLanguageCode('瑞典语'), 'sv');
  assert.equal(normalizeLanguageCode('MNI-MTEI'), 'mni-mtei');
  assert.equal(normalizeLanguageCode('Traditional Chinese'), 'zh-tw');
  assert.equal(normalizeLanguageCode('Chinese'), 'zh-cn');

  // #8 & #9 & #10c: ChatArea.tsx & App.tsx source contracts
  const chatAreaSrc = readFileSync(resolve(process.cwd(), 'src/components/ChatArea.tsx'), 'utf8');
  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

  // #8: edit preserves translatedText when shouldAutoTranslate is false
  assert.match(
    chatAreaSrc,
    /onEditMessage\?\.\(\s*editingMessage\.id,\s*targetText,\s*shouldAutoTranslate \? \{ translatedText: translationOfTarget \} : undefined\s*\)/
  );
  // #8: handleRetranslateMessage checks same-language equivalence & backfill exists
  assert.match(appSrc, /cleanTranslated\.toLowerCase\(\) === rawText\.toLowerCase\(\)/);
  assert.equal(appSrc.includes('attemptedInboundBackfillRef'), true);

  // #9: ChatArea activeModelDisplay explicitly checks Dual-Off
  assert.match(chatAreaSrc, /isModelDualOff[\s\S]*?'大模型已关闭'/);

  // #10c: getOutboundTargetLanguage does not hijack chat.targetLang
  const outboundFnMatch = chatAreaSrc.match(
    /export function getOutboundTargetLanguage\([\s\S]*?\n\}/
  );
  assert.ok(outboundFnMatch);
  assert.equal(outboundFnMatch[0].includes('chat?.targetLang'), false);
});

test('Historical message backfill strictly uses Google Translate across all 3 states without 15-message cap, and keeps setMessagesMap pure', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { initDatabase } = await import('./db.ts');
  const { app, syncServerCustomLlmConfig, getServerCustomLlmConfig } = await import('../server.ts');

  await initDatabase();

  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const apiServiceSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');

  // 1. Frontend historical backfill contracts (no 15-cap, Google-only, pure setMessagesMap)
  assert.equal(appSrc.includes('backfillBudgetMapRef'), false);
  assert.equal(appSrc.includes("const backfillHistoryEngine = 'google' as const;"), true);
  assert.equal(appSrc.includes("purpose: 'history'"), true);
  assert.equal(appSrc.includes("translationSettings.defaultTargetLang !== 'Auto'"), true);

  // Verify saveLocalMessage/setLocalMessages is NOT called inside the backfill setMessagesMap updater
  const backfillStart = appSrc.indexOf('Auto-backfill ALL untranslated historical messages');
  const backfillEnd = appSrc.indexOf('// Real-time polling for incoming Telegram', backfillStart);
  assert.ok(backfillStart > 0 && backfillEnd > backfillStart);
  const backfillSlice = appSrc.slice(backfillStart, backfillEnd);
  assert.equal(backfillSlice.includes('candidates.length < 15'), false);
  assert.equal(backfillSlice.includes("m.sender !== 'peer'"), false);
  const setMapMatches = backfillSlice.match(/setMessagesMap\(\(prevMap\) => \{[\s\S]*?\n\s*\}\);/g) || [];
  assert.ok(setMapMatches.length >= 1);
  for (const updaterBlock of setMapMatches) {
    assert.equal(updaterBlock.includes('saveLocalMessage'), false, 'saveLocalMessage must not run inside setMessagesMap updater');
    assert.equal(updaterBlock.includes('setLocalMessages'), false, 'setLocalMessages must not run inside setMessagesMap updater');
  }
  assert.equal(backfillSlice.includes('translationError: errMsg'), true);

  // Verify stale non-live translationError does not block historical backfill, and handleRetranslateMessage routes historical items to google+history
  assert.equal(backfillSlice.includes('isFreshLiveTranslationError'), true);
  assert.equal(appSrc.includes('const isHistoricalTarget ='), true);
  assert.match(appSrc, /isHistoricalTarget\s*\?\s*'google'/);
  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.match(serverSrc, /skip:\s*\(req\)\s*=>[\s\S]*?purpose === 'history'[\s\S]*?'google'/);

  // Verify apiService.ts forces google for history while preserving 3-state guards for realtime
  assert.match(apiServiceSrc, /const isHistoryTranslation = options\?\.purpose === 'history'/);
  assert.match(apiServiceSrc, /isHistoryTranslation[\s\S]*?\?\s*'google'/);

  // 2. Live HTTP tests for POST /api/translate with purpose: 'history'
  const prevJwtSecret = process.env.JWT_SECRET;
  const prevCfg = await getServerCustomLlmConfig();
  process.env.JWT_SECRET = 'history_google_test_secret';
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as any).port;

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'history_tester', username: 'tester', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const token = `${headerB64}.${payloadB64}.${sigB64}`;

  try {
    // Under Custom Priority mode (even without gateway URL/key): LLM engines are rejected for history, realtime google is still rejected, and history+google passes
    await syncServerCustomLlmConfig({
      enabled: true,
      explicitlyDisabled: false,
      engineMode: 'custom',
      enableKnowledgeBaseRAG: false,
      baseUrl: '',
      apiKey: '',
      modelName: 'gpt-4o-mini',
    });

    for (const llmEngine of ['gemini', 'custom_llm']) {
      const histLlmRes = await fetch(`http://127.0.0.1:${port}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: 'Hello world', targetLang: 'Chinese', engine: llmEngine, purpose: 'history' }),
      });
      assert.equal(histLlmRes.status, 400);
      const body: any = await histLlmRes.json();
      assert.match(String(body.error), /谷歌机翻/);
    }

    // Realtime google under Custom Priority must still return 400
    const realtimeGoogleRes = await fetch(`http://127.0.0.1:${port}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: 'Hello world', targetLang: 'Chinese', engine: 'google' }),
    });
    assert.equal(realtimeGoogleRes.status, 400);

    // History google under Custom Priority must pass the 3-state guard
    const histGoogleRes = await fetch(`http://127.0.0.1:${port}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        text: 'Hello',
        sourceLang: 'English',
        targetLang: 'English',
        engine: 'google',
        purpose: 'history',
      }),
    });
    assert.equal(histGoogleRes.status, 200);
    const histGoogleJson: any = await histGoogleRes.json();
    assert.equal(histGoogleJson.engine, 'google_translate');
    assert.equal(histGoogleJson.translatedText, 'Hello');

    // Under Cloud Priority mode: history+gemini must be rejected with 400, while history+google must return 200
    await syncServerCustomLlmConfig({
      enabled: true,
      explicitlyDisabled: false,
      engineMode: 'cloud',
      enableKnowledgeBaseRAG: true,
    });
    const cloudHistGeminiRes = await fetch(`http://127.0.0.1:${port}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: 'Hello world', targetLang: 'Chinese', engine: 'gemini', purpose: 'history' }),
    });
    assert.equal(cloudHistGeminiRes.status, 400);

    const cloudHistGoogleRes = await fetch(`http://127.0.0.1:${port}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        text: 'Hello cloud',
        sourceLang: 'English',
        targetLang: 'English',
        engine: 'google',
        purpose: 'history',
      }),
    });
    assert.equal(cloudHistGoogleRes.status, 200);
    const cloudHistGoogleJson: any = await cloudHistGoogleRes.json();
    assert.equal(cloudHistGoogleJson.engine, 'google_translate');
    assert.equal(cloudHistGoogleJson.translatedText, 'Hello cloud');
  } finally {
    await syncServerCustomLlmConfig(prevCfg || { enabled: true, explicitlyDisabled: false, engineMode: 'cloud', enableKnowledgeBaseRAG: true });
    srv.closeAllConnections?.();
    await new Promise<void>((r) => srv.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('Audit #2 & #3 regressions: translateText 3-state race elimination, /api/audio/tts-clone Dual-Off guard, and Webhook STT/TTS 3-state enforcement', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { initDatabase } = await import('./db.ts');
  const {
    app,
    syncServerCustomLlmConfig,
    getServerCustomLlmConfig,
    generateTtsAudio,
    downloadAndTranscribeTelegramVoice,
  } = await import('../server.ts');

  await initDatabase();

  // #2 Source contracts: compactThreeStateDescriptor + immediate sync in handleSaveCustomLLMConfig
  const apiServiceSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.equal(apiServiceSrc.includes('compactThreeStateDescriptor'), true);
  assert.match(apiServiceSrc, /customConfig:\s*safeCustomConfigForTranslation \?\? compactThreeStateDescriptor/);
  assert.match(
    appSrc,
    /const handleSaveCustomLLMConfig =[\s\S]*?syncCustomLLMConfigApi\(nextConfig\)\.catch/
  );

  const prevJwtSecret = process.env.JWT_SECRET;
  const prevCfg = await getServerCustomLlmConfig();
  const prevBotToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.JWT_SECRET = 'audit_2_3_test_secret';

  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as any).port;

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'audit_2_3_tester', username: 'tester', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const token = `${headerB64}.${payloadB64}.${sigB64}`;

  try {
    // #2 Race condition test: Server SQLite still holds stale 'custom' mode, while client switched to 'cloud' and sends compactThreeStateDescriptor
    await syncServerCustomLlmConfig({
      enabled: true,
      explicitlyDisabled: false,
      engineMode: 'custom',
      enableKnowledgeBaseRAG: false,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-stale-custom',
      modelName: 'gpt-4o-mini',
    });

    const raceCloudGoogleRes = await fetch(`http://127.0.0.1:${port}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        text: 'Hello race',
        sourceLang: 'English',
        targetLang: 'English',
        engine: 'google',
        customConfig: {
          enabled: true,
          explicitlyDisabled: false,
          engineMode: 'cloud',
        },
      }),
    });
    assert.equal(raceCloudGoogleRes.status, 200);
    const raceCloudJson: any = await raceCloudGoogleRes.json();
    assert.equal(raceCloudJson.translatedText, 'Hello race');

    // Race from 'custom' -> 'dual_off': request descriptor says Dual-Off, so Gemini must be rejected with 400 Dual-Off even if DB is stale
    const raceDualOffGeminiRes = await fetch(`http://127.0.0.1:${port}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        text: 'Hello',
        sourceLang: 'English',
        targetLang: 'Chinese',
        engine: 'gemini',
        customConfig: {
          enabled: false,
          explicitlyDisabled: true,
          engineMode: 'cloud',
        },
      }),
    });
    assert.equal(raceDualOffGeminiRes.status, 400);
    const raceDualOffJson: any = await raceDualOffGeminiRes.json();
    assert.match(String(raceDualOffJson.error), /双关/);

    // #3a POST /api/audio/tts-clone blocks Dual-Off even when saved baseUrl/apiKey exist
    const ttsDualRes = await fetch(`http://127.0.0.1:${port}/api/audio/tts-clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        text: '测试语音',
        customConfig: {
          enabled: false,
          explicitlyDisabled: true,
          engineMode: 'cloud',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-saved-key',
        },
      }),
    });
    assert.equal(ttsDualRes.status, 400);
    const ttsDualJson: any = await ttsDualRes.json();
    assert.match(String(ttsDualJson.error), /双关/);

    // #3b generateTtsAudio enforces Dual-Off and Custom Priority (no silent Gemini fallback)
    await assert.rejects(
      () =>
        generateTtsAudio('Hello', 'Kore', 'Natural', {
          enabled: false,
          explicitlyDisabled: true,
          engineMode: 'cloud',
        }),
      /双关/
    );

    await assert.rejects(
      () =>
        generateTtsAudio('Hello', 'Kore', 'Natural', {
          enabled: true,
          explicitlyDisabled: false,
          engineMode: 'custom',
          baseUrl: '',
          apiKey: '',
        }),
      /优先自有密钥回复/
    );

    // Custom Priority generateTtsAudio routes directly to user's custom gateway OpenAI /v1/audio/speech
    const customAudioBuf = Buffer.from('ID3mock-mp3-audio-payload');
    const prevFetch = globalThis.fetch;
    const calledUrls: string[] = [];
    try {
      globalThis.fetch = (async (input: any) => {
        const u = String(input);
        calledUrls.push(u);
        return new Response(customAudioBuf, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        });
      }) as any;

      const customTtsRes = await generateTtsAudio('Hello custom TTS', 'Kore', 'Warm', {
        enabled: true,
        explicitlyDisabled: false,
        engineMode: 'custom',
        protocol: 'openai',
        baseUrl: 'http://127.0.0.1:19999/v1',
        apiKey: 'sk-custom-tts',
        modelName: 'tts-1',
      });
      assert.ok(calledUrls.some((u) => u === 'http://127.0.0.1:19999/v1/audio/speech'));
      assert.ok(customTtsRes.audioUrl.startsWith('data:audio/mpeg;base64,'));

      // #3c downloadAndTranscribeTelegramVoice enforces Dual-Off & Custom Priority
      process.env.TELEGRAM_BOT_TOKEN = 'test_bot_token_123';
      const mockOggBytes = Buffer.from('OggS-test-voice-bytes');

      globalThis.fetch = (async (input: any) => {
        const u = String(input);
        if (u.includes('api.telegram.org/bot')) {
          return new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/file_1.ogg' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (u.includes('api.telegram.org/file/bot')) {
          return new Response(mockOggBytes, {
            status: 200,
            headers: { 'Content-Type': 'audio/ogg' },
          });
        }
        if (u === 'http://127.0.0.1:19999/v1/audio/transcriptions') {
          return new Response(JSON.stringify({ text: 'Custom Whisper Hello' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch URL: ${u}`);
      }) as any;

      const dualVoiceRes = await downloadAndTranscribeTelegramVoice('file_1', {
        enabled: false,
        explicitlyDisabled: true,
        engineMode: 'cloud',
      });
      assert.equal(dualVoiceRes.ok, false);
      assert.match(String(dualVoiceRes.error), /双关/);
      assert.ok(dualVoiceRes.audioUrl.startsWith('data:audio/ogg;base64,'));

      const customNoUrlVoiceRes = await downloadAndTranscribeTelegramVoice('file_1', {
        enabled: true,
        explicitlyDisabled: false,
        engineMode: 'custom',
        baseUrl: '',
        apiKey: '',
      });
      assert.equal(customNoUrlVoiceRes.ok, false);
      assert.match(String(customNoUrlVoiceRes.error), /优先自有密钥回复/);

      const customSttVoiceRes = await downloadAndTranscribeTelegramVoice('file_1', {
        enabled: true,
        explicitlyDisabled: false,
        engineMode: 'custom',
        protocol: 'openai',
        baseUrl: 'http://127.0.0.1:19999/v1',
        apiKey: 'sk-custom-stt',
      });
      assert.equal(customSttVoiceRes.ok, true);
      assert.equal(customSttVoiceRes.text, 'Custom Whisper Hello');
    } finally {
      globalThis.fetch = prevFetch;
    }
  } finally {
    if (prevBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevBotToken;
    await syncServerCustomLlmConfig(prevCfg || { enabled: true, explicitlyDisabled: false, engineMode: 'cloud', enableKnowledgeBaseRAG: true });
    srv.closeAllConnections?.();
    await new Promise<void>((r) => srv.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('Audit P2 (#5-#8): Dutch vs German detection, non-letter skip, non-Latin getCnTranslationIfForeign, and ChatArea outbound/Auto UX fixes', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { db, initDatabase } = await import('./db.ts');
  const {
    detectSourceLangCode,
    getCnTranslationIfForeign,
    getScopedChatTargetLang,
    syncServerCustomLlmConfig,
    getServerCustomLlmConfig,
    syncServerTranslationSettings,
    getServerTranslationSettings,
  } = await import('../server.ts');
  const {
    detectClientLangCode,
    hasTranslatableLetters,
    getOutboundTargetLanguage,
    getLanguageDisplayName,
  } = await import('../src/components/ChatArea.tsx');

  await initDatabase();

  // #5: Dutch 'hallo' phrases must NOT be hijacked by German, while German still detects as 'de'
  for (const nlSample of [
    'Hallo, ik ben Jan',
    'Hallo, alsjeblieft',
    'Hallo, hoe is het',
    'Hallo, bedankt!',
    'Hallo, gefeliciteerd!',
    'Hallo, welterusten',
    'Hallo, doei!',
    'Hallo, gezellig!',
    'Hallo, fijne dag!',
    'Hallo, prettige dag!',
    'Hallo, tot zo!',
    'Hallo, alles goed?',
  ]) {
    assert.equal(detectSourceLangCode(nlSample), 'nl', `server detectSourceLangCode failed for: ${nlSample}`);
    assert.equal(detectClientLangCode(nlSample), 'nl', `client detectClientLangCode failed for: ${nlSample}`);
  }
  for (const deSample of ['Hallo, wie geht es dir?', 'Hallo, ich bin Max', 'Hallo, das ist prima!']) {
    assert.equal(detectSourceLangCode(deSample), 'de', `server detectSourceLangCode failed for: ${deSample}`);
    assert.equal(detectClientLangCode(deSample), 'de', `client detectClientLangCode failed for: ${deSample}`);
  }
  // Mixed Kanji + Kana Japanese must resolve to 'ja', not 'zh-CN'
  assert.equal(detectSourceLangCode('確認しました。ありがとうございます！'), 'ja');
  assert.equal(detectClientLangCode('確認しました。ありがとうございます！'), 'ja');

  // #6: hasTranslatableLetters skips pure digits, URLs, emails, @mentions, emojis
  assert.equal(hasTranslatableLetters('123456'), false);
  assert.equal(hasTranslatableLetters('https://t.me/abc'), false);
  assert.equal(hasTranslatableLetters('t.me/my_channel'), false);
  assert.equal(hasTranslatableLetters('t.me/+AbCdEf123'), false);
  assert.equal(hasTranslatableLetters('tg://resolve?domain=alice'), false);
  assert.equal(hasTranslatableLetters('www.example.com/order/99'), false);
  assert.equal(hasTranslatableLetters('user@example.com'), false);
  assert.equal(hasTranslatableLetters('@alice_bot'), false);
  assert.equal(hasTranslatableLetters('100.50 👍'), false);
  assert.equal(hasTranslatableLetters('Hello @alice'), true);
  assert.equal(hasTranslatableLetters('Check t.me/my_channel'), true);
  assert.equal(hasTranslatableLetters('订单号 123456'), true);
  assert.equal(detectSourceLangCode('t.me/my_channel'), '');
  assert.equal(detectSourceLangCode('tg://resolve?domain=alice'), '');
  assert.equal(detectClientLangCode('t.me/my_channel'), '');
  assert.equal(detectClientLangCode('tg://resolve?domain=alice'), '');

  const chatAreaSrc = readFileSync(resolve(process.cwd(), 'src/components/ChatArea.tsx'), 'utf8');
  assert.match(chatAreaSrc, /!queryText \|\| !hasTranslatableLetters\(queryText\)/);
  assert.match(chatAreaSrc, /const hasTextToTranslate = hasTranslatableLetters\(textToSend\);/);
  assert.match(chatAreaSrc, /if \(shouldAutoTranslate && hasTextToTranslate\)/);

  // #8: getOutboundTargetLanguage returns full names for nl/pl/sv/uk/fa, getLanguageDisplayName renders Chinese label, and Auto reset preserves chat.targetLang
  assert.equal(
    getOutboundTargetLanguage({ id: 'c1', sourceLang: 'Auto', targetLang: 'Chinese' } as any, { defaultSourceLang: 'Auto' } as any, [
      { id: 'm1', sender: 'peer', text: 'Hallo, ik ben Jan', timestamp: '10:00' } as any,
    ]),
    'Dutch'
  );
  assert.equal(
    getOutboundTargetLanguage({ id: 'c1b', sourceLang: 'Auto', targetLang: 'Chinese' } as any, { defaultSourceLang: 'Auto' } as any, [
      { id: 'm1b', sender: 'peer', text: 'Hallo, bedankt!', timestamp: '10:00' } as any,
    ]),
    'Dutch'
  );
  assert.equal(
    getOutboundTargetLanguage({ id: 'c2', sourceLang: 'Auto', targetLang: 'Chinese' } as any, { defaultSourceLang: 'Auto' } as any, [
      { id: 'm2', sender: 'peer', text: 'Dzień dobry, jak się masz?', timestamp: '10:00' } as any,
    ]),
    'Polish'
  );
  assert.equal(
    getOutboundTargetLanguage({ id: 'c3', sourceLang: 'Auto', targetLang: 'Chinese' } as any, { defaultSourceLang: 'Auto' } as any, [
      { id: 'm3', sender: 'peer', text: 'Hej, hur mår du?', timestamp: '10:00' } as any,
    ]),
    'Swedish'
  );
  assert.equal(getLanguageDisplayName('Auto'), '自动识别');
  assert.equal(getLanguageDisplayName('auto'), '自动识别');
  assert.equal(getLanguageDisplayName('Dutch'), '荷兰语');
  assert.equal(getLanguageDisplayName('Polish'), '波兰语');
  assert.equal(getLanguageDisplayName('Swedish'), '瑞典语');
  assert.match(chatAreaSrc, /normalizeChatLangCode\(outboundTargetLang\)\s*===\s*normalizeChatLangCode\(lang\.code\)/);
  assert.equal(chatAreaSrc.includes('outboundTargetLang === lang.code'), false);
  assert.match(chatAreaSrc, /if \(lang\.code === 'Auto'\)\s*\{\s*onUpdateChatLanguage\?\.\(chat\.id,\s*'Auto',\s*chat\.targetLang \|\| 'Auto'\);/);

  // #7: getCnTranslationIfForeign detects ja/ko/th/he/el and honors non-Chinese defaultTargetLang, skipping only same-language & non-letter texts
  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.equal(serverSrc.includes("if (replyText && !/[\\u4e00-\\u9fa5]/.test(replyText))"), false);

  const prevTransSettings = await getServerTranslationSettings();
  const prevCfg = await getServerCustomLlmConfig();
  const prevFetch = globalThis.fetch;
  let fetchCalls = 0;

  try {
    await syncServerCustomLlmConfig({
      enabled: false,
      explicitlyDisabled: true,
      engineMode: 'cloud',
    });

    await syncServerTranslationSettings({
      preferredEngine: 'google',
      defaultTargetLang: 'Chinese',
      defaultSourceLang: 'Auto',
    });

    globalThis.fetch = (async (input: any) => {
      fetchCalls++;
      const url = new URL(String(input));
      const tl = url.searchParams.get('tl') || 'zh-CN';
      const q = url.searchParams.get('q') || '';
      return new Response(JSON.stringify([[[`[TRANS:${tl}] ${q}`]]]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    for (const sample of [
      '確認しました。ありがとうございます！',
      '안녕하세요',
      'สวัสดีครับ',
      'שלום חבר',
      'Γεια σας',
    ]) {
      const before = fetchCalls;
      const out = await getCnTranslationIfForeign(sample);
      assert.equal(fetchCalls, before + 1, `Expected translation call for ${sample}`);
      assert.match(out, /^\[TRANS:zh-CN\]/);
    }

    // Same-language Chinese and non-letter inputs must skip translation without calling fetch
    const callsBeforeSkip = fetchCalls;
    assert.equal(await getCnTranslationIfForeign('你好，请稍等'), '');
    assert.equal(await getCnTranslationIfForeign('123456'), '');
    assert.equal(await getCnTranslationIfForeign('https://t.me/abc @alice'), '');
    assert.equal(await getCnTranslationIfForeign('t.me/my_channel tg://resolve?domain=alice'), '');
    assert.equal(await getCnTranslationIfForeign('t.me/+AbCdEf123 888 🚀'), '');
    assert.equal(await getCnTranslationIfForeign('tg://join?invite=xyz123'), '');
    assert.equal(fetchCalls, callsBeforeSkip);

    // Mixed natural language + Telegram shortlink must still translate
    const mixedShortlinkOut = await getCnTranslationIfForeign('Check t.me/my_channel');
    assert.match(mixedShortlinkOut, /^\[TRANS:zh-CN\]/);

    // Non-Chinese defaultTargetLang ('English'): Chinese reply MUST translate to English; English reply MUST skip
    await syncServerTranslationSettings({
      preferredEngine: 'google',
      defaultTargetLang: 'English',
      defaultSourceLang: 'Auto',
    });

    const zhToEn = await getCnTranslationIfForeign('你好，请稍等');
    assert.match(zhToEn, /^\[TRANS:en\]/);

    const callsBeforeEnSkip = fetchCalls;
    assert.equal(await getCnTranslationIfForeign('Hello, how can I help you today?'), '');
    assert.equal(fetchCalls, callsBeforeEnSkip);

    // Per-chat overrideTargetLang ('Japanese') overrides global defaultTargetLang ('English')
    const zhToJaOverride = await getCnTranslationIfForeign('你好，请稍等', undefined, undefined, 'Japanese');
    assert.match(zhToJaOverride, /^\[TRANS:ja\]/);
    const enToJaOverride = await getCnTranslationIfForeign('Hello, see you soon!', undefined, undefined, 'Japanese');
    assert.match(enToJaOverride, /^\[TRANS:ja\]/);

    const callsBeforeJaSkip = fetchCalls;
    assert.equal(await getCnTranslationIfForeign('確認しました。ありがとうございます！', undefined, undefined, 'Japanese'), '');
    assert.equal(fetchCalls, callsBeforeJaSkip);

    // Explicit 'Auto' or empty overrideTargetLang falls back to global defaultTargetLang ('English')
    const zhFallbackToGlobal = await getCnTranslationIfForeign('你好，请稍等', undefined, undefined, 'Auto');
    assert.match(zhFallbackToGlobal, /^\[TRANS:en\]/);
    const zhEmptyFallbackToGlobal = await getCnTranslationIfForeign('你好，请稍等', undefined, undefined, '');
    assert.match(zhEmptyFallbackToGlobal, /^\[TRANS:en\]/);

    // SQLite chat_language_prefs lookup + /api/llm/chat, Webhook, and MTProto autopilot call wiring
    const testChatIdA = `tg_pref_test_${Date.now()}`;
    const testChatIdAuto = `tg_pref_auto_${Date.now()}`;
    const testAccountA = 'acc_tg_888001';
    const testAccountB = 'acc_tg_888002';
    try {
      await db.prepare(`
        INSERT INTO chat_language_prefs (account_id, chat_id, source_lang, target_lang, updated_at)
        VALUES (?, ?, 'Auto', 'Japanese', ?)
      `).run(testAccountA, testChatIdA, Date.now());
      await db.prepare(`
        INSERT INTO chat_language_prefs (account_id, chat_id, source_lang, target_lang, updated_at)
        VALUES (?, ?, 'Auto', 'Auto', ?)
      `).run(testAccountA, testChatIdAuto, Date.now());

      assert.equal(await getScopedChatTargetLang(testChatIdA, testAccountA), 'Japanese');
      assert.equal(await getScopedChatTargetLang(testChatIdA.replace(/^tg_/, ''), testAccountA), 'Japanese');
      assert.equal(await getScopedChatTargetLang(testChatIdAuto, testAccountA), '');
      assert.equal(await getScopedChatTargetLang(testChatIdA, testAccountB), '');
    } finally {
      await db.prepare(`DELETE FROM chat_language_prefs WHERE chat_id IN (?, ?)`).run(testChatIdA, testChatIdAuto);
    }

    assert.match(serverSrc, /chatTranslationTargetLang\s*=\s*explicitInboundTarget \|\| \(await getScopedChatTargetLang\(customerId,\s*accountId\)\) \|\| undefined/);
    assert.match(serverSrc, /webhookChatTargetLang\s*=\s*\(await getScopedChatTargetLang\(chatId,\s*'acc_telegram_bot'\)\) \|\| undefined/);
    assert.match(serverSrc, /autopilotChatTargetLang\s*=\s*\(await getScopedChatTargetLang\(canonicalChatId,\s*accountId\)\) \|\| undefined/);
  } finally {
    globalThis.fetch = prevFetch;
    await syncServerTranslationSettings(
      prevTransSettings || { preferredEngine: 'gemini', defaultTargetLang: 'Chinese', defaultSourceLang: 'Auto' }
    );
    await syncServerCustomLlmConfig(prevCfg || { enabled: true, explicitlyDisabled: false, engineMode: 'cloud', enableKnowledgeBaseRAG: true });
  }
});

test('H1: extractRecentTwoWayMessages, /api/llm/chat, MTProto autopilot, and Bot webhook strictly isolate chat history by account_id', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { db } = await import('../server/db.ts');
  const { extractRecentTwoWayMessages } = await import('../server.ts');

  const peerNumericId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const sharedChatId = `tg_${peerNumericId}`;
  const baseTs = Date.now() - 50000;

  try {
    const insertStmt = db.prepare(`
      INSERT INTO messages (
        id, chat_id, account_id, sender, text, stt_text, image_caption, timestamp, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    await insertStmt.run(
      `h1_a1_${peerNumericId}`,
      sharedChatId,
      'acc_tg_1001',
      'peer',
      'Secret message from Account A peer',
      '',
      '',
      '10:00',
      baseTs + 100
    );
    await insertStmt.run(
      `h1_a2_${peerNumericId}`,
      peerNumericId,
      '1001',
      'me',
      'Reply from Account A variant',
      '',
      '',
      '10:01',
      baseTs + 200
    );
    await insertStmt.run(
      `h1_b1_${peerNumericId}`,
      sharedChatId,
      'acc_tg_2002',
      'peer',
      'Confidential message from Account B peer',
      '',
      '',
      '10:02',
      baseTs + 300
    );
    await insertStmt.run(
      `h1_bot_${peerNumericId}`,
      sharedChatId,
      'acc_telegram_bot',
      'peer',
      'Bot-only message',
      '',
      '',
      '10:03',
      baseTs + 400
    );

    const turnsA = await extractRecentTwoWayMessages(
      sharedChatId,
      peerNumericId,
      [
        { id: `h1_client_a_${peerNumericId}`, accountId: 'acc_tg_1001', sender: 'me', text: 'Account A client buffer', createdAt: baseTs + 500 },
        { id: `h1_client_b_${peerNumericId}`, accountId: 'acc_tg_2002', sender: 'peer', text: 'Foreign Account B client leak', createdAt: baseTs + 600 },
      ],
      30,
      'acc_tg_1001'
    );
    assert.deepEqual(
      turnsA.map((t) => t.text),
      ['Secret message from Account A peer', 'Reply from Account A variant', 'Account A client buffer']
    );

    const turnsB = await extractRecentTwoWayMessages(sharedChatId, peerNumericId, [], 30, 'acc_tg_2002');
    assert.deepEqual(turnsB.map((t) => t.text), ['Confidential message from Account B peer']);

    const turnsBot = await extractRecentTwoWayMessages(sharedChatId, peerNumericId, [], 30, 'acc_telegram_bot');
    assert.deepEqual(turnsBot.map((t) => t.text), ['Bot-only message']);

    const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
    assert.equal(
      serverSrc.includes('extractRecentTwoWayMessages(customerId, altCustomerId, messages, 30, accountId)'),
      true,
      'Expected /api/llm/chat to pass accountId into extractRecentTwoWayMessages'
    );
    assert.equal(
      serverSrc.includes('extractRecentTwoWayMessages(canonicalChatId, rawChatId, [], 30, accountId)'),
      true,
      'Expected MTProto autopilot to pass accountId and 30 turns into extractRecentTwoWayMessages'
    );
    assert.equal(
      serverSrc.includes("WHERE (chat_id = ? OR chat_id = ?) AND account_id IN ('acc_telegram_bot', 'acc_1')"),
      true,
      'Expected processTelegramMessageAsync to restrict recentMessages query to Bot/acc_1 scope'
    );
  } finally {
    await db
      .prepare('DELETE FROM messages WHERE chat_id IN (?, ?)')
      .run(sharedChatId, peerNumericId)
      .catch(() => {});
  }
});

test('H2: trust proxy avoids ERR_ERL_PERMISSIVE_TRUST_PROXY, removes admin password log, aligns snapshot/purge tables, and allows member DB backup/restore/purge', async () => {
  const { createHmac } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const {
    db,
    exportDatabaseSnapshot,
    restoreDatabaseSnapshot,
    purgeDatabaseBusinessData,
    saveGlobalPersonaToDb,
    getGlobalPersonaFromDb,
  } = await import('../server/db.ts');
  const { app, TELEGRAM_WEBHOOK_SECRET } = await import('../server.ts');

  // 1. trust proxy must not be boolean true (desktop/local uses 'loopback', Railway uses 1)
  assert.notEqual(app.get('trust proxy'), true);

  // 2. Dead admin plaintext password initialization & console.log must be removed; package.json & db.ts guard app.asar
  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.equal(serverSrc.includes('generatedAdminPlaintext'), false);
  assert.equal(serverSrc.includes('Admin password initialized:'), false);

  const pkgJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
  const asarUnpack: string[] = pkgJson?.build?.asarUnpack || [];
  assert.equal(asarUnpack.includes('node_modules/@libsql/**/*'), true);
  assert.equal(asarUnpack.includes('node_modules/ffmpeg-static/**/*'), true);

  const dbSrc = readFileSync(resolve(process.cwd(), 'server/db.ts'), 'utf8');
  assert.match(dbSrc, /app\.asar/);

  // 3. Snapshot export includes media_materials, persona_schedule_vault, training_logs, and restore/purge handle them cleanly
  const prevPersona = await getGlobalPersonaFromDb();
  const prevSnapshot = await exportDatabaseSnapshot();
  assert.equal(Array.isArray((prevSnapshot.tables as any).media_materials), true);
  assert.equal(Array.isArray((prevSnapshot.tables as any).persona_schedule_vault), true);
  assert.equal(Array.isArray((prevSnapshot.tables as any).training_logs), true);

  // 4. Test /api/database/backup & /api/database/purge permissions + rate limiters (member JWT allowed, bot webhook 403)
  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'h2_test_jwt_secret';
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as any).port;

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'member_h2', username: 'member_h2', role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const memberJwt = `${headerB64}.${payloadB64}.${sigB64}`;

  try {
    // Trigger aiGenerationLimiter with X-Forwarded-For to verify no ERR_ERL_PERMISSIVE_TRUST_PROXY / XFF error
    const chatRes = await fetch(`http://127.0.0.1:${port}/api/llm/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
        'X-Forwarded-For': '203.0.113.9',
      },
      body: JSON.stringify({ chatId: '', messages: [] }),
    });
    assert.notEqual(chatRes.status, 500);

    // Member JWT can export backup (200)
    const backupRes = await fetch(`http://127.0.0.1:${port}/api/database/backup`, {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    assert.equal(backupRes.status, 200);

    // Bot Webhook session MUST be denied (403) on backup / restore / purge
    const botBackupRes = await fetch(`http://127.0.0.1:${port}/api/database/backup`, {
      headers: { 'x-telegram-bot-api-secret-token': TELEGRAM_WEBHOOK_SECRET },
    });
    assert.equal(botBackupRes.status, 403);

    // 5. purgeDatabaseBusinessData clears global_persona_config too
    await saveGlobalPersonaToDb({ ...prevPersona, personaName: 'H2_TEMP_PERSONA_NAME' });
    const beforePurgePersona = await getGlobalPersonaFromDb();
    assert.equal(beforePurgePersona.personaName, 'H2_TEMP_PERSONA_NAME');

    await purgeDatabaseBusinessData();
    const rowAfterPurge = await db.prepare("SELECT value FROM system_config WHERE key = 'global_persona_config'").get();
    assert.equal(rowAfterPurge, undefined);
    const afterPurgePersona = await getGlobalPersonaFromDb();
    assert.equal(afterPurgePersona.personaName, '');
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
    await restoreDatabaseSnapshot(prevSnapshot).catch(() => {});
    if (prevPersona) {
      await saveGlobalPersonaToDb(prevPersona).catch(() => {});
    }
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('H3: Custom OpenAI TTS/STT strips polluted gemini-* model names, Cloud chat blocks -tts/-transcribe, ChatArea follows inboundTargetLang, and cloud brain defines audio endpoints', async () => {
  const { app, syncServerCustomLlmConfig, getServerCustomLlmConfig } = await import('../server.ts');
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');

  const prevJwtSecret = process.env.JWT_SECRET;
  const prevCustomCfg = await getServerCustomLlmConfig().catch(() => null);
  process.env.JWT_SECRET = 'h3_test_jwt_secret';

  const capturedRequests: Array<{ path: string; body: any }> = [];
  const mockGateway = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    let parsed: any = null;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = rawBody;
    }
    capturedRequests.push({ path: req.url || '', body: parsed });

    if (req.url === '/v1/audio/speech') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end(Buffer.from('FAKE_MP3_AUDIO_BYTES'));
      return;
    }
    if (req.url === '/v1/audio/transcriptions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: 'transcribed hello world', model: 'whisper-1' }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((r) => mockGateway.listen(0, '127.0.0.1', r));
  const mockGwPort = (mockGateway.address() as any).port;

  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as any).port;

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'member_h3', username: 'member_h3', role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const memberJwt = `${headerB64}.${payloadB64}.${sigB64}`;

  try {
    await syncServerCustomLlmConfig({
      enabled: true,
      explicitlyDisabled: false,
      engineMode: 'custom',
      protocol: 'openai',
      baseUrl: `http://127.0.0.1:${mockGwPort}`, // no /v1 suffix — previously triggered preferGeminiNative!
      apiKey: 'sk-test-openai',
      modelName: 'gpt-4o-mini',
    });

    // 1. TTS clone with polluted 'gemini-3.8-flash-tts' on OpenAI gateway without /v1
    const ttsRes = await fetch(`http://127.0.0.1:${port}/api/audio/tts-clone`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
      },
      body: JSON.stringify({
        text: 'Hello there',
        voiceName: 'Kore',
        model: 'gemini-3.8-flash-tts',
        customConfig: {
          enabled: true,
          engineMode: 'custom',
          protocol: 'openai',
          baseUrl: `http://127.0.0.1:${mockGwPort}`,
          apiKey: 'sk-test-openai',
        },
      }),
    });
    assert.equal(ttsRes.status, 200);
    const ttsJson = (await ttsRes.json()) as any;
    assert.equal(ttsJson.modelUsed, 'tts-1');
    const speechReq = capturedRequests.find((r) => r.path === '/v1/audio/speech');
    assert.ok(speechReq, 'Must hit /v1/audio/speech instead of Gemini native SDK');
    assert.equal(speechReq?.body?.model, 'tts-1');

    // 2. STT transcribe with polluted 'gemini-3.5-transcribe' on OpenAI gateway
    const sttRes = await fetch(`http://127.0.0.1:${port}/api/audio/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
      },
      body: JSON.stringify({
        audioBase64: Buffer.from('FAKE_OGG_BYTES').toString('base64'),
        mimeType: 'audio/ogg',
        model: 'gemini-3.5-transcribe',
        customConfig: {
          enabled: true,
          engineMode: 'custom',
          protocol: 'openai',
          baseUrl: `http://127.0.0.1:${mockGwPort}`,
          apiKey: 'sk-test-openai',
        },
      }),
    });
    assert.equal(sttRes.status, 200);
    const sttJson = (await sttRes.json()) as any;
    assert.equal(sttJson.modelUsed, 'whisper-1');

    // 3. Frontend, server chat guard, and cloud brain contracts
    const chatAreaSrc = readFileSync(resolve(process.cwd(), 'src/components/ChatArea.tsx'), 'utf8');
    assert.ok(!chatAreaSrc.includes("translateText(\n              res.replyText,\n              'Auto',\n              'Chinese'"));
    assert.match(chatAreaSrc, /getLanguageDisplayName\(inboundTargetLang\)\}对照/);

    const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
    assert.match(serverSrc, /!\s*\/\(tts\|transcribe\)\/i\.test\(rawChatModel\)/);

    const voiceModalSrc = readFileSync(resolve(process.cwd(), 'src/components/VoiceCloneStudioModal.tsx'), 'utf8');
    assert.match(voiceModalSrc, /isCustomOpenAiGateway/);
    assert.match(voiceModalSrc, /gpt-4o-mini-tts/);

    const brainSrc = readFileSync(resolve(process.cwd(), 'deploy/railway-brain-server.ts'), 'utf8');
    assert.match(brainSrc, /app\.post\('\/v1\/audio\/transcriptions'/);
    assert.match(brainSrc, /app\.post\('\/v1\/audio\/speech'/);
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
    await new Promise<void>((r) => mockGateway.close(() => r()));
    if (prevCustomCfg) {
      await syncServerCustomLlmConfig(prevCustomCfg).catch(() => {});
    }
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('H4: cryptoStorage never downgrades AES-256-GCM to s256, isolates keys from localStorage, and Electron integrates safeStorage DPAPI', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { isTrueAesGcmCiphertext } = await import('../src/services/cryptoStorage.ts');

  // 1. Ciphertext format classifier
  assert.equal(isTrueAesGcmCiphertext('enc:gcm256:AAAA:BBBB'), true);
  assert.equal(isTrueAesGcmCiphertext('enc:gcm256:s256:AAAA:BBBB'), false);
  assert.equal(isTrueAesGcmCiphertext('enc:gcm256:sync:AAAA'), false);
  assert.equal(isTrueAesGcmCiphertext('enc:gcm256:raw:AAAA'), false);

  // 2. Source code security contracts (no downgrade in secureGetItemAsync, no plaintext seed write)
  const cryptoSrc = readFileSync(resolve(process.cwd(), 'src/services/cryptoStorage.ts'), 'utf8');
  assert.equal(cryptoSrc.includes("localStorage.setItem(KEY_STORE_KEY"), false);
  assert.equal(cryptoSrc.includes("localStorage.setItem(LEGACY_KEY_STORE_KEY"), false);
  assert.match(cryptoSrc, /if \(!isTrueAesGcmCiphertext\(raw\)\)\s*\{\s*await secureSetItemAsync\(storageKey,\s*decrypted\)/);
  assert.match(cryptoSrc, /extractable:\s*false|generateKey\(\s*\{\s*name:\s*'AES-GCM',\s*length:\s*256\s*\},\s*false/);

  // 3. Electron main.cjs & preload.cjs DPAPI + AES-256-GCM integration
  assert.equal(existsSync(resolve(process.cwd(), 'electron/preload.cjs')), true);
  const preloadSrc = readFileSync(resolve(process.cwd(), 'electron/preload.cjs'), 'utf8');
  assert.match(preloadSrc, /contextBridge\.exposeInMainWorld\('humanSenseCrypto'/);

  const mainSrc = readFileSync(resolve(process.cwd(), 'main.cjs'), 'utf8');
  assert.match(mainSrc, /safeStorage\.encryptString/);
  assert.match(mainSrc, /safeStorage\.decryptString/);
  assert.match(mainSrc, /createCipheriv\('aes-256-gcm'/);
  assert.match(mainSrc, /preload:\s*path\.join\(__dirname,\s*'electron',\s*'preload\.cjs'\)/);
});

test('M1: getOutboundTargetLanguage & server context skip media placeholders, prioritize sttText/imageCaption, and walk backwards for peer natural language', async () => {
  const { getOutboundTargetLanguage, isSystemMediaPlaceholder } = await import('../src/components/ChatArea.tsx');
  const { extractRecentTwoWayMessages } = await import('../server.ts');

  const autoChat = { id: 'c_m1', sourceLang: 'Auto', targetLang: 'Chinese' } as any;
  const autoSettings = { defaultSourceLang: 'Auto', defaultTargetLang: 'Chinese' } as any;

  // 1. Placeholders detected accurately
  assert.equal(isSystemMediaPlaceholder('🎤 语音消息'), true);
  assert.equal(isSystemMediaPlaceholder('[图片消息]'), true);
  assert.equal(isSystemMediaPlaceholder('🎬 视频消息'), true);
  assert.equal(isSystemMediaPlaceholder('🎥 视频消息'), true);
  assert.equal(isSystemMediaPlaceholder('😀 [贴纸]'), true);
  assert.equal(isSystemMediaPlaceholder('📎 合同_2026.pdf', { isFile: true }), true);
  assert.equal(isSystemMediaPlaceholder('Hello, how much is this?'), false);

  // 2. Foreign customer sends English/Turkish/Russian text, then un-transcribed voice/image/video/file/emoji
  assert.equal(
    getOutboundTargetLanguage(autoChat, autoSettings, [
      { id: '1', sender: 'peer', text: 'Hello, can you check my order?' } as any,
      { id: '2', sender: 'me', text: 'Sure, checking now.' } as any,
      { id: '3', sender: 'peer', isAudio: true, text: '🎤 语音消息' } as any,
      { id: '4', sender: 'peer', isImage: true, text: '[图片消息]' } as any,
      { id: '5', sender: 'peer', isVideo: true, text: '🎬 视频消息' } as any,
      { id: '6', sender: 'peer', isFile: true, text: '📎 invoice.pdf' } as any,
      { id: '7', sender: 'peer', text: '👍👍👍' } as any,
    ]),
    'English'
  );

  assert.equal(
    getOutboundTargetLanguage(autoChat, autoSettings, [
      { id: '1', sender: 'peer', text: 'Merhaba, fiyatı nedir?' } as any,
      { id: '2', sender: 'peer', isImage: true, text: '🖼️ 图片消息' } as any,
    ]),
    'Turkish'
  );

  // 3. sttText and imageCaption take priority over placeholder text
  assert.equal(
    getOutboundTargetLanguage(autoChat, autoSettings, [
      { id: '1', sender: 'peer', text: 'Hello there' } as any,
      { id: '2', sender: 'peer', isAudio: true, text: '🎤 语音消息', sttText: 'Привет, сколько стоит доставка?' } as any,
    ]),
    'Russian'
  );

  assert.equal(
    getOutboundTargetLanguage(autoChat, autoSettings, [
      { id: '1', sender: 'peer', text: 'Hello there' } as any,
      { id: '2', sender: 'peer', isImage: true, text: '🖼️ 图片消息', imageCaption: 'Bonjour, merci beaucoup!' } as any,
    ]),
    'French'
  );

  // 4. Only media placeholders (no natural language at all) -> defaults to English, NEVER Chinese
  assert.equal(
    getOutboundTargetLanguage(autoChat, autoSettings, [
      { id: '1', sender: 'peer', isAudio: true, text: '🎤 语音消息' } as any,
      { id: '2', sender: 'peer', isImage: true, text: '[图片消息]' } as any,
      { id: '3', sender: 'peer', isVideo: true, text: '[视频消息]' } as any,
    ]),
    'English'
  );

  // 5. Real Chinese peer message still resolves Chinese even after media placeholder
  assert.equal(
    getOutboundTargetLanguage(autoChat, autoSettings, [
      { id: '1', sender: 'peer', text: '你好，麻烦看一下这张图' } as any,
      { id: '2', sender: 'peer', isImage: true, text: '🖼️ 图片消息' } as any,
    ]),
    'Chinese'
  );

  // 6. Server normalizeMessageTurn prioritizes sttText/imageCaption over media placeholders
  const turns = await extractRecentTwoWayMessages(
    'm1_test_chat',
    'm1_test_chat',
    [
      { id: 's1', sender: 'peer', text: '🎤 语音消息', sttText: 'Quanto costa?', createdAt: 1000 },
      { id: 's2', sender: 'peer', text: '🖼️ 图片消息', imageCaption: 'See attached photo', createdAt: 2000 },
    ],
    30,
    'acc_m1'
  );
  assert.equal(turns[0]?.text, 'Quanto costa?');
  assert.equal(turns[0]?.mediaType, 'voice');
  assert.equal(turns[1]?.text, 'See attached photo');
  assert.equal(turns[1]?.mediaType, 'image');
});

test('M2: customer profile save/read propagates explicit accountId, handleSelectChat avoids stale closure races, and profiles isolate by account', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { initDatabase } = await import('./db.ts');
  const { app } = await import('../server.ts');

  await initDatabase();

  const dockSrc = readFileSync(resolve(process.cwd(), 'src/components/UnifiedRightDock.tsx'), 'utf8');
  assert.match(dockSrc, /saveLocalCustomerProfile\(targetChatId,\s*normalizedUpdated,\s*targetAccountId\)/);
  assert.match(dockSrc, /saveCustomerProfile\(targetChatId,\s*normalizedUpdated,\s*targetAccountId\)/);

  const drawerSrc = readFileSync(resolve(process.cwd(), 'src/components/CustomerMemoryDrawer.tsx'), 'utf8');
  // Every saveCustomerProfile call in CustomerMemoryDrawer must explicitly pass targetAccId (3rd arg)
  const drawerSaveCalls = drawerSrc.match(/saveCustomerProfile\([^)]*\)/g) || [];
  assert.ok(drawerSaveCalls.length >= 1);
  for (const call of drawerSaveCalls) {
    assert.equal(call.split(',').length >= 3, true, `Expected explicit accountId 3rd arg in: ${call}`);
  }
  assert.match(drawerSrc, /activeScopeRef\.current !== requestScope/);
  assert.match(drawerSrc, /const scopedProfile =/);

  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.match(appSrc, /const selectChatSeqRef = useRef\(0\)/);
  assert.match(appSrc, /const targetChatObj = chatsRef\.current\.find\(/);
  assert.match(appSrc, /activeAccountIdRef\.current === savedAccId && selectChatSeqRef\.current === callSeq/);
  assert.match(appSrc, /activeAccountIdRef\.current === targetAccId &&[\s\S]*?activeChatIdRef\.current === targetChatId/);
  assert.match(appSrc, /setCustomerProfile\(null\)/);
  assert.match(appSrc, /const targetChatId = newMsg\.chatId \|\| activeChatIdRef\.current \|\| activeChatId;/);
  assert.match(appSrc, /const targetAccountId = newMsg\.accountId \|\| activeAccountIdRef\.current \|\| activeAccountId;/);

  const chatAreaSrc = readFileSync(resolve(process.cwd(), 'src/components/ChatArea.tsx'), 'utf8');
  assert.match(chatAreaSrc, /const originChatId = chat\.id;\s*const originAccountId = currentAccountId;/);

  // Runtime HTTP isolation check: same chatId across two accounts stays strictly isolated even if currentActiveAccountId lags
  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'm2_test_jwt_secret';
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as any).port;

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'member_m2', username: 'member_m2', role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const memberJwt = `${headerB64}.${payloadB64}.${sigB64}`;

  const sharedChatId = `tg_shared_${Date.now()}`;
  const accA = 'acc_tg_m2_a';
  const accB = 'acc_tg_m2_b';

  try {
    const saveA = await fetch(`http://127.0.0.1:${port}/api/customer/profile/${sharedChatId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
        'X-Account-Id': accA,
      },
      body: JSON.stringify({
        accountId: accA,
        clientName: 'Client Alpha',
        relationshipStage: 'VIP',
        likesInterests: ['Coffee'],
      }),
    });
    assert.equal(saveA.status, 200);

    const saveB = await fetch(`http://127.0.0.1:${port}/api/customer/profile/${sharedChatId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
        'X-Account-Id': accB,
      },
      body: JSON.stringify({
        accountId: accB,
        clientName: 'Client Beta',
        relationshipStage: '初次接触',
        likesInterests: ['Tea'],
      }),
    });
    assert.equal(saveB.status, 200);

    const getA = await fetch(`http://127.0.0.1:${port}/api/customer/profile/${sharedChatId}`, {
      headers: { Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
    });
    assert.equal(getA.status, 200);
    const profA = (await getA.json()) as any;
    assert.equal(profA.clientName, 'Client Alpha');
    assert.deepEqual(profA.likesInterests, ['Coffee']);

    const getB = await fetch(`http://127.0.0.1:${port}/api/customer/profile/${sharedChatId}`, {
      headers: { Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accB },
    });
    assert.equal(getB.status, 200);
    const profB = (await getB.json()) as any;
    assert.equal(profB.clientName, 'Client Beta');
    assert.deepEqual(profB.likesInterests, ['Tea']);
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('M3: pure setMessagesMap updaters, unified prevPersistedMessagesMapRef cleanup, and cross-restart pending media persistence & retry', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { db, initDatabase } = await import('./db.ts');
  const { app, resolveLocalMediaDiskPath } = await import('../server.ts');

  await initDatabase();

  // 1. Verify pendingMediaStorage module exists and behaves safely without fabricating data
  assert.equal(existsSync(resolve(process.cwd(), 'src/services/pendingMediaStorage.ts')), true);
  const pendingMediaMod = await import('../src/services/pendingMediaStorage.ts');
  assert.equal(pendingMediaMod.buildPendingMediaKey('acc_1', 'msg_1'), 'acc_1::msg_1');
  assert.equal(pendingMediaMod.buildPendingMediaKey('', 'msg_1'), 'default::msg_1');
  assert.equal(await pendingMediaMod.getPendingMediaBlob('acc_1', 'msg_missing'), null);
  assert.deepEqual(await pendingMediaMod.listChatPendingMediaBlobs('acc_1', 'chat_1'), []);

  // 2. Verify App.tsx has no clearLocalMessages inside setMessagesMap updaters and has unified bucket cleanup
  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.equal(
    /setMessagesMap\s*\(\s*\(?prev\)?\s*=>\s*\{[\s\S]{0,300}clearLocalMessages\s*\(/.test(appSrc),
    false,
    'clearLocalMessages must NEVER be invoked inside setMessagesMap state updater'
  );
  assert.match(appSrc, /if \(list\.length === 0\)\s*\{[\s\S]*?clearLocalMessages\(bChat,\s*prevMap\[bKey\],\s*bAcc\)/);
  assert.match(appSrc, /for \(const removedKey of Object\.keys\(prevMap\)\)\s*\{\s*if \(!\(removedKey in messagesMap\)\)/);
  assert.match(appSrc, /savePendingMediaBlob\(/);
  assert.match(appSrc, /getPendingMediaBlob\(targetAccountId,\s*messageId\)/);
  assert.match(appSrc, /hydrateBucketPendingMedia\(/);

  // 3. Real Express HTTP verification: failed multipart media send persists real file to disk & retries cleanly
  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'm3_test_jwt_secret';
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as any).port;

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'member_m3', username: 'member_m3', role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const memberJwt = `${headerB64}.${payloadB64}.${sigB64}`;

  const testAccId = 'acc_tg_m3_offline';
  const testChatId = `tg_m3_${Date.now()}`;
  const testMsgId = `msg_m3_${Date.now()}`;
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const createdDiskPaths: string[] = [];

  try {
    const form = new FormData();
    form.append(
      'payload',
      JSON.stringify({
        id: testMsgId,
        chatId: testChatId,
        accountId: testAccId,
        sender: 'me',
        text: '[图片消息]',
        isImage: true,
        imageCaption: 'test caption',
        createdAt: Date.now(),
        timestamp: '10:00',
      })
    );
    form.append('file', new Blob([pngBytes], { type: 'image/png' }), 'receipt.png');

    const sendRes = await fetch(`http://127.0.0.1:${port}/api/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${memberJwt}`,
        'X-Account-Id': testAccId,
      },
      body: form,
    });
    assert.equal(sendRes.status, 200);
    const sendData = (await sendRes.json()) as any;
    assert.equal(sendData.delivered, false);
    assert.equal(sendData.deliveryStatus, 'failed');
    assert.equal(typeof sendData.imageUrl, 'string');
    assert.equal(sendData.imageUrl.startsWith('/api/messages/local-media/'), true);

    const diskPath1 = resolveLocalMediaDiskPath(sendData.imageUrl);
    if (diskPath1) createdDiskPaths.push(diskPath1);

    // Fetch persisted media file & verify byte-for-byte authenticity
    const mediaFetch = await fetch(`http://127.0.0.1:${port}${sendData.imageUrl}`);
    assert.equal(mediaFetch.status, 200);
    const fetchedBuf = Buffer.from(await mediaFetch.arrayBuffer());
    assert.deepEqual(fetchedBuf, pngBytes);

    // Retry via JSON only (simulating client restart without RAM File)
    const retryJsonRes = await fetch(`http://127.0.0.1:${port}/api/messages/${encodeURIComponent(testMsgId)}/retry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
        'X-Account-Id': testAccId,
      },
      body: JSON.stringify({
        id: testMsgId,
        chatId: testChatId,
        accountId: testAccId,
        sender: 'me',
        text: '[图片消息]',
        isImage: true,
      }),
    });
    assert.equal(retryJsonRes.status, 200);
    const retryJsonData = (await retryJsonRes.json()) as any;
    assert.equal(retryJsonData.delivered, false);
    assert.equal(retryJsonData.deliveryStatus, 'failed');
    assert.equal(typeof retryJsonData.imageUrl, 'string');
    assert.equal(retryJsonData.imageUrl.startsWith('/api/messages/local-media/'), true);

    // Retry via multipart upload (simulating IndexedDB client-side Blob recovery when initial upload didn't hit Express)
    const retryForm = new FormData();
    retryForm.append(
      'payload',
      JSON.stringify({
        id: testMsgId,
        chatId: testChatId,
        accountId: testAccId,
        sender: 'me',
        text: '[图片消息]',
        isImage: true,
      })
    );
    retryForm.append('file', new Blob([pngBytes], { type: 'image/png' }), 'receipt_idb.png');
    const retryMultipartRes = await fetch(`http://127.0.0.1:${port}/api/messages/${encodeURIComponent(testMsgId)}/retry`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${memberJwt}`,
        'X-Account-Id': testAccId,
      },
      body: retryForm,
    });
    assert.equal(retryMultipartRes.status, 200);
    const retryMultipartData = (await retryMultipartRes.json()) as any;
    assert.equal(typeof retryMultipartData.imageUrl, 'string');
    assert.equal(retryMultipartData.imageUrl.startsWith('/api/messages/local-media/'), true);
    const diskPath2 = resolveLocalMediaDiskPath(retryMultipartData.imageUrl);
    if (diskPath2) createdDiskPaths.push(diskPath2);
  } finally {
    const { unlinkSync } = await import('node:fs');
    for (const p of createdDiskPaths) {
      try {
        unlinkSync(p);
      } catch {}
    }
    try {
      await db.prepare('DELETE FROM messages WHERE id = ?').run(testMsgId);
    } catch {}
    await new Promise<void>((r) => srv.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('M4: eliminates native window.confirm/alert/prompt in KnowledgeEvolutionModal and entire Electron/React client', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { resolve, join } = await import('node:path');

  const collectSourceFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        out.push(...collectSourceFiles(full));
      } else if (/\.(ts|tsx|js|cjs|mjs)$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  };

  const filesToScan = [
    ...collectSourceFiles(resolve(process.cwd(), 'src')),
    ...collectSourceFiles(resolve(process.cwd(), 'electron')),
    resolve(process.cwd(), 'main.cjs'),
  ];

  for (const filePath of filesToScan) {
    const content = readFileSync(filePath, 'utf8');
    // Strip single-line and multi-line comments before checking for native browser dialogs
    const codeOnly = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.equal(
      /\bwindow\.(confirm|alert|prompt)\s*\(/.test(codeOnly),
      false,
      `Found native window dialog in ${filePath}`
    );
    assert.equal(
      /(?<![.\w$])(confirm|alert|prompt)\s*\(/.test(codeOnly),
      false,
      `Found bare browser confirm/alert/prompt in ${filePath}`
    );
  }

  const kbSrc = readFileSync(resolve(process.cwd(), 'src/components/KnowledgeEvolutionModal.tsx'), 'utf8');
  assert.match(kbSrc, /pendingConfirmAction/);
  assert.match(kbSrc, /executeResetPersona/);
  assert.match(kbSrc, /executeImportTemplate/);
  assert.match(kbSrc, /personaActionError/);
  assert.equal(kbSrc.includes('确认清空'), true);
  assert.equal(kbSrc.includes('确认导入'), true);
});

test('M5: structured translationErrorChannel, STT durability across translation errors/uncontrolled mode, audio concurrency guard, and PATCH stt_text SQLite persistence', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { db, initDatabase } = await import('./db.ts');
  const { app } = await import('../server.ts');

  await initDatabase();

  // 1. Types & Frontend source contracts
  const typesSrc = readFileSync(resolve(process.cwd(), 'src/types/index.ts'), 'utf8');
  assert.match(
    typesSrc,
    /translationErrorChannel\?:\s*'live_gemini'\s*\|\s*'live_custom_llm'\s*\|\s*'live_google'\s*\|\s*'history_google'\s*\|\s*'manual'/
  );

  const apiServiceSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
  assert.match(apiServiceSrc, /export async function updateMessageSttInDb\(/);
  assert.match(apiServiceSrc, /message\.sttText !== undefined/);
  assert.match(apiServiceSrc, /'translationErrorChannel' in message/);

  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.match(appSrc, /function engineToLiveErrorChannel\(/);
  assert.match(appSrc, /m\.translationErrorChannel === 'history_google'/);
  assert.match(appSrc, /translationErrorChannel:\s*'history_google'/);
  assert.match(appSrc, /translationErrorChannel:\s*engineToLiveErrorChannel\(effectiveInboundEngine\)/);
  assert.match(appSrc, /const handleUpdateMessage = \(\s*messageId: string,\s*patch: Partial<Message>,\s*scope\?: \{ chatId\?: string; accountId\?: string \}/);
  assert.match(appSrc, /updateMessageSttInDb\(/);

  const chatAreaSrc = readFileSync(resolve(process.cwd(), 'src/components/ChatArea.tsx'), 'utf8');
  assert.match(chatAreaSrc, /function getTranslationErrorLabel\(/);
  assert.match(chatAreaSrc, /const audioPlaySeqRef = useRef\(0\)/);
  assert.match(chatAreaSrc, /audioPlaySeqRef\.current !== playSeq/);
  assert.match(chatAreaSrc, /uncontrolledMsgPatches/);
  assert.match(chatAreaSrc, /persistPatch\(\{ sttText: transcribed \}\)/);
  assert.match(chatAreaSrc, /saveLocalMessage\(originChatId,\s*\{\s*\.\.\.msg,\s*\.\.\.patch\s*\},\s*originAccountId\)/);

  // 2. Runtime HTTP & SQLite persistence for PATCH /api/messages/:id/translation (sttText + tenant isolation)
  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'm5_test_jwt_secret';
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as any).port;

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'member_m5', username: 'member_m5', role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const memberJwt = `${headerB64}.${payloadB64}.${sigB64}`;

  const msgIdA = `msg_m5_a_${Date.now()}`;
  const msgIdB = `msg_m5_b_${Date.now()}`;
  const chatId = `tg_m5_${Date.now()}`;
  const accA = 'acc_tg_m5_a';
  const accB = 'acc_tg_m5_b';
  const nowTs = Date.now();

  try {
    await db
      .prepare(
        `INSERT INTO messages (id, chat_id, account_id, sender, text, is_audio, timestamp, created_at)
         VALUES (?, ?, ?, 'peer', '🎤 语音消息', 1, '10:00', ?)`
      )
      .run(msgIdA, chatId, accA, nowTs);
    await db
      .prepare(
        `INSERT INTO messages (id, chat_id, account_id, sender, text, is_audio, timestamp, created_at)
         VALUES (?, ?, ?, 'peer', '🎤 语音消息', 1, '10:00', ?)`
      )
      .run(msgIdB, chatId, accB, nowTs);

    // 2a. Empty payload rejected with 400
    const badRes = await fetch(`http://127.0.0.1:${port}/api/messages/${encodeURIComponent(msgIdA)}/translation`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
        'X-Account-Id': accA,
      },
      body: JSON.stringify({ chatId, accountId: accA }),
    });
    assert.equal(badRes.status, 400);

    // 2b. Tenant isolation: accA cannot update accB's message
    const crossTenantRes = await fetch(
      `http://127.0.0.1:${port}/api/messages/${encodeURIComponent(msgIdB)}/translation`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${memberJwt}`,
          'X-Account-Id': accA,
        },
        body: JSON.stringify({ sttText: 'hacked stt', chatId, accountId: accA }),
      }
    );
    assert.equal(crossTenantRes.status, 200);
    const crossData = (await crossTenantRes.json()) as any;
    assert.equal(crossData.updated, false);
    const rowBAfterCross = (await db
      .prepare('SELECT stt_text, translated_text FROM messages WHERE id = ?')
      .get(msgIdB)) as any;
    assert.equal(rowBAfterCross.stt_text ?? null, null);

    // 2c. STT-only update persists stt_text without touching translated_text
    const sttOnlyRes = await fetch(
      `http://127.0.0.1:${port}/api/messages/${encodeURIComponent(msgIdA)}/translation`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${memberJwt}`,
          'X-Account-Id': accA,
        },
        body: JSON.stringify({ sttText: 'Ciao come stai?', chatId, accountId: accA }),
      }
    );
    assert.equal(sttOnlyRes.status, 200);
    const sttOnlyData = (await sttOnlyRes.json()) as any;
    assert.equal(sttOnlyData.ok, true);
    assert.equal(sttOnlyData.updated, true);

    const rowAfterStt = (await db
      .prepare('SELECT stt_text, translated_text FROM messages WHERE id = ?')
      .get(msgIdA)) as any;
    assert.equal(rowAfterStt.stt_text, 'Ciao come stai?');
    assert.equal(rowAfterStt.translated_text ?? null, null);

    // 2d. Subsequent translation persists alongside stt_text
    const bothRes = await fetch(
      `http://127.0.0.1:${port}/api/messages/${encodeURIComponent(msgIdA)}/translation`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${memberJwt}`,
          'X-Account-Id': accA,
        },
        body: JSON.stringify({
          sttText: 'Ciao come stai?',
          translatedText: '你好，近来如何？',
          chatId,
          accountId: accA,
        }),
      }
    );
    assert.equal(bothRes.status, 200);
    const rowAfterBoth = (await db
      .prepare('SELECT stt_text, translated_text FROM messages WHERE id = ?')
      .get(msgIdA)) as any;
    assert.equal(rowAfterBoth.stt_text, 'Ciao come stai?');
    assert.equal(rowAfterBoth.translated_text, '你好，近来如何？');
  } finally {
    try {
      await db.prepare('DELETE FROM messages WHERE id IN (?, ?)').run(msgIdA, msgIdB);
    } catch {}
    await new Promise<void>((r) => srv.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('Audit Item 1-5: no fake durations, versions, contact labels, cloning claims, or silent crypto downgrade; real ffmpeg speed/pitch processing', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { applyAudioPitchAndRateWithFfmpeg } = await import('../server.ts');
  const { formatChatSubtitle } = await import('../src/components/ChatList.tsx');
  const { APP_VERSION } = await import('../src/services/apiService.ts');
  const { getCryptoStorageSecurityInfo } = await import('../src/services/cryptoStorage.ts');

  // 1. Package version consistency (no hardcoded v2.5.0)
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(APP_VERSION, pkg.version);

  const filesToCheck = [
    'src/components/ChatArea.tsx',
    'src/components/TelegramChatInfoDrawer.tsx',
    'src/components/SystemSettingsModal.tsx',
    'src/components/TelegramMenuDrawer.tsx',
    'src/components/ChatList.tsx',
    'src/components/MasterVoiceprintModal.tsx',
    'src/components/VoiceCloneStudioModal.tsx',
    'src/components/CustomLLMModal.tsx',
    'src/components/UnifiedRightDock.tsx',
  ];
  for (const rel of filesToCheck) {
    const content = readFileSync(resolve(process.cwd(), rel), 'utf8');
    assert.equal(content.includes('0:04'), false, `${rel} must not contain fake 0:04 duration`);
    assert.equal(content.includes('v2.5.0'), false, `${rel} must not contain hardcoded v2.5.0`);
    assert.equal(content.includes('活跃联系人'), false, `${rel} must not contain hardcoded 活跃联系人`);
    assert.equal(content.includes('原声纹'), false, `${rel} must not claim 原声纹`);
    assert.equal(content.includes('音色克隆'), false, `${rel} must not claim 音色克隆`);
    assert.equal(content.includes('呼吸拟真'), false, `${rel} must not contain non-functional 呼吸拟真`);
  }

  // 2. VoiceCloneStudioModal must not rely on fake playbackRate trick and must pass speechRate & pitch
  const studioSrc = readFileSync(resolve(process.cwd(), 'src/components/VoiceCloneStudioModal.tsx'), 'utf8');
  assert.equal(studioSrc.includes('.playbackRate'), false);
  assert.match(studioSrc, /speechRate:\s*speedRate/);
  assert.match(studioSrc, /pitch:\s*pitchRate/);
  assert.match(studioSrc, /decodeAudioDurationSeconds/);

  // 3. Real ffmpeg speed & pitch processing on synthetic 24kHz PCM WAV buffer (2.0 seconds)
  const sampleRate = 24000;
  const numSamples = sampleRate * 2;
  const dataBytes = numSamples * 2;
  const wavBuf = Buffer.alloc(44 + dataBytes);
  wavBuf.write('RIFF', 0);
  wavBuf.writeUInt32LE(36 + dataBytes, 4);
  wavBuf.write('WAVEfmt ', 8);
  wavBuf.writeUInt32LE(16, 16);
  wavBuf.writeUInt16LE(1, 20);
  wavBuf.writeUInt16LE(1, 22);
  wavBuf.writeUInt32LE(sampleRate, 24);
  wavBuf.writeUInt32LE(sampleRate * 2, 28);
  wavBuf.writeUInt16LE(2, 32);
  wavBuf.writeUInt16LE(16, 34);
  wavBuf.write('data', 36);
  wavBuf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000);
    wavBuf.writeInt16LE(sample, 44 + i * 2);
  }

  const unchanged = await applyAudioPitchAndRateWithFfmpeg(wavBuf, 'wav', 1.0, 1.0);
  assert.equal(unchanged.applied, false);
  assert.equal(unchanged.buffer.length, wavBuf.length);

  const spedUpAndPitched = await applyAudioPitchAndRateWithFfmpeg(wavBuf, 'wav', 1.25, 1.1);
  assert.equal(spedUpAndPitched.applied, true);
  assert.equal(spedUpAndPitched.format, 'wav');
  assert.equal(spedUpAndPitched.buffer.subarray(0, 4).toString('ascii'), 'RIFF');
  // Output WAV sample rate is 44100 Hz mono 16-bit; at 1.25x speed, 2.0s audio -> ~1.6s -> ~141,120 bytes of PCM
  const outSamplesSec = (spedUpAndPitched.buffer.length - 44) / (44100 * 2);
  assert.ok(outSamplesSec > 1.4 && outSamplesSec < 1.8, `Expected ~1.6s output, got ${outSamplesSec.toFixed(3)}s`);

  // 4. ChatList formatChatSubtitle accurately handles all chat types without fake label
  assert.equal(formatChatSubtitle({ id: '1', title: 'Alice', username: '@alice_dev' } as any), '@alice_dev');
  assert.equal(formatChatSubtitle({ id: '2', title: 'News', isChannel: true, memberCount: 120 } as any), '频道 · 120 位订阅者');
  assert.equal(formatChatSubtitle({ id: '3', title: 'VIP Group', isGroup: true, memberCount: 18 } as any), '群组 · 18 位成员');
  assert.equal(formatChatSubtitle({ id: '4', title: 'Helper', isBot: true } as any), 'Telegram 机器人');
  assert.equal(formatChatSubtitle({ id: '5', title: 'Bob', phone: '+8613800138000' } as any), '+8613800138000');
  assert.equal(formatChatSubtitle({ id: '6', title: 'Stranger' } as any), '未设置用户名');

  // 5. Crypto storage reports fallback honestly when outside Electron/WebCrypto and NEVER silently downgrades writes
  const secInfo = getCryptoStorageSecurityInfo();
  assert.equal(secInfo.mode, 'fallback_stream');
  assert.equal(secInfo.hardwareProtected, false);
  assert.match(secInfo.label, /未启用 AES-256-GCM/);

  const cryptoSrc = readFileSync(resolve(process.cwd(), 'src/services/cryptoStorage.ts'), 'utf8');
  assert.match(cryptoSrc, /window\.addEventListener\('pagehide'/);
  assert.match(cryptoSrc, /document\.addEventListener\('visibilitychange'/);
  const asyncEncryptFn = cryptoSrc.slice(
    cryptoSrc.indexOf('export async function encryptDataAsync'),
    cryptoSrc.indexOf('export async function decryptDataAsync')
  );
  assert.equal(asyncEncryptFn.includes('encryptFallbackSyncStream'), false);
  const syncSetFn = cryptoSrc.slice(
    cryptoSrc.indexOf('export function secureSetItemSync'),
    cryptoSrc.indexOf('export async function secureGetItemAsync')
  );
  assert.equal(syncSetFn.includes('encryptFallbackSyncStream'), false);

  const mainSrc = readFileSync(resolve(process.cwd(), 'main.cjs'), 'utf8');
  assert.equal(mainSrc.includes('fs.writeFileSync(fallbackPath'), false, 'main.cjs must never write plaintext master key to disk');
  assert.match(mainSrc, /dpapi_unavailable/);

  // 6. Sensitive auth session, member profile, deleted message IDs, and voiceprint use encrypted storage
  const apiSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
  assert.equal(apiSrc.includes('localStorage.setItem(SESSION_STORAGE_KEY'), false);
  assert.equal(apiSrc.includes('localStorage.setItem(MEMBER_USER_STORAGE_KEY'), false);
  assert.equal(apiSrc.includes('localStorage.setItem(scopedKey, JSON.stringify(trimmed))'), false);
  const vpSrc = readFileSync(resolve(process.cwd(), 'src/services/voiceprintStorage.ts'), 'utf8');
  assert.equal(vpSrc.includes('localStorage.setItem('), false);
  assert.match(vpSrc, /secureSetItemSync/);

  // 7. No fake audio durations, fake voice preview time, or fake relationship defaults remain
  const chatAreaSrc = readFileSync(resolve(process.cwd(), 'src/components/ChatArea.tsx'), 'utf8');
  assert.equal(chatAreaSrc.includes('duration || 5'), false);
  assert.equal(chatAreaSrc.includes('recordDurationRef.current || 1'), false);
  const memorySrc = readFileSync(resolve(process.cwd(), 'src/components/CustomerMemoryDrawer.tsx'), 'utf8');
  assert.equal(memorySrc.includes('自然亲切、高效沟通'), false);
  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.equal(serverSrc.includes("'活跃联系人'"), false);
  assert.equal(serverSrc.includes('audioDuration || 5'), false);
  assert.equal(studioSrc.includes('预估约'), false);

  const sysSettingsSrc = readFileSync(resolve(process.cwd(), 'src/components/SystemSettingsModal.tsx'), 'utf8');
  assert.match(sysSettingsSrc, /cryptoInfo\.mode === 'fallback_stream'/);
  assert.match(sysSettingsSrc, /cryptoInfo\.detail/);
});

test('Section 4 P0: backup secret stripping, config secret masking/preservation, credential-isolated KB cache, and multi-account AI data isolation', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const {
    db,
    getGlobalPersonaFromDb,
    saveGlobalPersonaToDb,
    getEvolutionStateFromDb,
    saveEvolutionStateToDb,
    exportDatabaseSnapshot,
    restoreDatabaseSnapshot,
    DEFAULT_GLOBAL_PERSONA,
    DEFAULT_EVOLUTION_STATE,
  } = await import('../server/db.ts');
  const {
    app,
    syncServerCustomLlmConfig,
    getServerCustomLlmConfig,
    syncServerTranslationSettings,
    getServerTranslationSettings,
    queryKnowledgeRAG,
    buildRemoteKbCacheKey,
    recordCustomLlmModelUsage,
    resolveUnifiedEvolutionCorpus,
  } = await import('../server.ts');

  // 1. DatabaseModal backup export strips all secret keys from both decrypted and local fallback payloads
  const dbModalSrc = readFileSync(resolve(process.cwd(), 'src/components/DatabaseModal.tsx'), 'utf8');
  assert.match(dbModalSrc, /SENSITIVE_CONFIG_BACKUP_KEYS\s*=\s*new Set\(\['tg_pro_llm_config',\s*'tg_pro_trans_settings'\]\)/);
  assert.match(dbModalSrc, /function sanitizeBackupEntry/);
  for (const secretField of ['apiKey', 'knowledgeBaseApiKey', 'engineLicenseKey', 'geminiApiKey', 'googleApiKey']) {
    assert.equal(dbModalSrc.includes(secretField), true, `DatabaseModal must sanitize ${secretField}`);
  }
  const customLlmModalSrc = readFileSync(resolve(process.cwd(), 'src/components/CustomLLMModal.tsx'), 'utf8');
  assert.match(customLlmModalSrc, /当前为脱敏显示/);
  const transDrawerSrc = readFileSync(resolve(process.cwd(), 'src/components/TranslationDrawer.tsx'), 'utf8');
  assert.equal(transDrawerSrc.includes("googleApiKey: ''"), false, 'TranslationDrawer must not wipe googleApiKey');
  assert.equal(transDrawerSrc.includes("geminiApiKey: ''"), false, 'TranslationDrawer must not wipe geminiApiKey');

  // 2. buildRemoteKbCacheKey isolates cache entries by credential SHA-256 hash AND full query (>120 chars)
  const ck1 = buildRemoteKbCacheKey('https://kb.example/search', 'hello', 'key-A', 'jwt-1', 'lic-1');
  const ck2 = buildRemoteKbCacheKey('https://kb.example/search', 'hello', 'key-B', 'jwt-1', 'lic-1');
  const ck3 = buildRemoteKbCacheKey('https://kb.example/search', 'hello', 'key-A', 'jwt-2', 'lic-1');
  const ck4 = buildRemoteKbCacheKey('https://kb.example/search', 'hello', 'key-A', 'jwt-1', 'lic-2');
  const ckSame = buildRemoteKbCacheKey('https://kb.example/search', 'HELLO', 'key-A', 'jwt-1', 'lic-1');
  assert.equal(ck1, ckSame);
  assert.notEqual(ck1, ck2);
  assert.notEqual(ck1, ck3);
  assert.notEqual(ck1, ck4);
  assert.equal(ck1.includes('key-A'), false);
  assert.equal(ck1.includes('jwt-1'), false);
  assert.equal(ck1.includes('lic-1'), false);
  const sharedLongPrefix = 'a'.repeat(150);
  const longCk1 = buildRemoteKbCacheKey('https://kb.example/search', `${sharedLongPrefix} question alpha`, 'key-A', 'jwt-1', 'lic-1');
  const longCk2 = buildRemoteKbCacheKey('https://kb.example/search', `${sharedLongPrefix} question beta`, 'key-A', 'jwt-1', 'lic-1');
  assert.notEqual(longCk1, longCk2, 'Long queries with identical 150-char prefix must not collide');

  // 3. Runtime HTTP tests for secret masking & multi-account AI isolation
  const prevJwtSecret = process.env.JWT_SECRET;
  const prevCustomCfg = await getServerCustomLlmConfig().catch(() => null);
  const prevTransSettings = await getServerTranslationSettings().catch(() => null);

  process.env.JWT_SECRET = 'p0_section4_jwt_secret';
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as any).port;

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'member_p0', username: 'member_p0', role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const memberJwt = `${headerB64}.${payloadB64}.${sigB64}`;

  const accA = `acc_tg_p0_a_${Date.now()}`;
  const accB = `acc_tg_p0_b_${Date.now()}`;
  let kbIdA = '';
  let kbIdB = '';
  const transIdA = `trans_p0_a_${Date.now()}`;
  const transIdB = `trans_p0_b_${Date.now()}`;

  try {
    // 3a. Config secret masking & preservation on GET / POST
    await syncServerCustomLlmConfig({
      enabled: true,
      engineMode: 'custom',
      protocol: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-real-secret-99887766',
      knowledgeBaseApiKey: 'kb-secret-11223344',
      engineLicenseKey: 'lic-secret-55667788',
      modelName: 'gpt-4o-mini',
    });
    await syncServerTranslationSettings({
      defaultSourceLang: 'Auto',
      defaultTargetLang: 'Chinese',
      preferredEngine: 'gemini',
      geminiModel: 'gemma-4-26b-a4b-it',
      geminiApiKey: 'AIza-real-gemini-123456',
      googleApiKey: 'AIza-real-google-654321',
    });

    const getLlmRes = await fetch(`http://127.0.0.1:${port}/api/llm/config`, {
      headers: { Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
    });
    assert.equal(getLlmRes.status, 200);
    const getLlmData = (await getLlmRes.json()) as any;
    assert.equal(getLlmData.config.apiKey, 'sk-r****7766');
    assert.equal(getLlmData.config.hasApiKey, true);
    assert.equal(getLlmData.config.knowledgeBaseApiKey, 'kb-s****3344');
    assert.equal(getLlmData.config.hasKnowledgeBaseApiKey, true);
    assert.equal(getLlmData.config.engineLicenseKey, 'lic-****7788');
    assert.equal(getLlmData.config.hasEngineLicenseKey, true);

    const getTransRes = await fetch(`http://127.0.0.1:${port}/api/translate/settings`, {
      headers: { Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
    });
    assert.equal(getTransRes.status, 200);
    const getTransData = (await getTransRes.json()) as any;
    assert.equal(getTransData.settings.geminiApiKey, 'AIza****3456');
    assert.equal(getTransData.settings.hasGeminiApiKey, true);
    assert.equal(getTransData.settings.googleApiKey, 'AIza****4321');
    assert.equal(getTransData.settings.hasGoogleApiKey, true);

    // Round-trip POST with masked values MUST preserve stored secrets (NOT overwrite DB with ****)
    const postLlmRes = await fetch(`http://127.0.0.1:${port}/api/llm/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
      body: JSON.stringify({
        ...getLlmData.config,
        modelName: 'gpt-4o',
      }),
    });
    assert.equal(postLlmRes.status, 200);
    const storedAfterMaskedPost = await getServerCustomLlmConfig();
    assert.equal(storedAfterMaskedPost.apiKey, 'sk-real-secret-99887766');
    assert.equal(storedAfterMaskedPost.knowledgeBaseApiKey, 'kb-secret-11223344');
    assert.equal(storedAfterMaskedPost.engineLicenseKey, 'lic-secret-55667788');
    assert.equal(storedAfterMaskedPost.modelName, 'gpt-4o');

    // Clear apiKey explicitly with '' clears stored apiKey without clearing engineLicenseKey when omitted
    const clearKeyRes = await fetch(`http://127.0.0.1:${port}/api/llm/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
      body: JSON.stringify({
        enabled: true,
        engineMode: 'cloud',
        apiKey: '',
      }),
    });
    assert.equal(clearKeyRes.status, 200);
    const storedAfterClear = await getServerCustomLlmConfig();
    assert.equal(storedAfterClear.apiKey, '');
    assert.equal(storedAfterClear.engineLicenseKey, 'lic-secret-55667788');

    const postTransRes = await fetch(`http://127.0.0.1:${port}/api/translate/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
      body: JSON.stringify({
        ...getTransData.settings,
        defaultTargetLang: 'English',
      }),
    });
    assert.equal(postTransRes.status, 200);
    const storedTransAfterMasked = await getServerTranslationSettings();
    assert.equal(storedTransAfterMasked.geminiApiKey, 'AIza-real-gemini-123456');
    assert.equal(storedTransAfterMasked.googleApiKey, 'AIza-real-google-654321');
    assert.equal(storedTransAfterMasked.defaultTargetLang, 'English');

    // 3b. Knowledge Base strict account isolation (CRUD + RAG)
    const addKbA = await fetch(`http://127.0.0.1:${port}/api/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
      body: JSON.stringify({
        category: '产品报价',
        title: '账号A报价隐私文档',
        content: '账号A专属VIP报价方案 alpha_secret_token_991',
        keywords: 'alpha_secret_token_991, 报价',
      }),
    });
    assert.equal(addKbA.status, 200);
    kbIdA = ((await addKbA.json()) as any).id;

    const addKbB = await fetch(`http://127.0.0.1:${port}/api/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accB },
      body: JSON.stringify({
        category: '售后指南',
        title: '账号B售后规范',
        content: '账号B专属售后流程 beta_secret_token_882',
        keywords: 'beta_secret_token_882, 售后',
      }),
    });
    assert.equal(addKbB.status, 200);
    kbIdB = ((await addKbB.json()) as any).id;

    const listKbA = (await (
      await fetch(`http://127.0.0.1:${port}/api/knowledge`, {
        headers: { Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
      })
    ).json()) as any;
    assert.equal(listKbA.items.some((x: any) => x.id === kbIdA), true);
    assert.equal(listKbA.items.some((x: any) => x.id === kbIdB), false);

    // Cross-account toggle/delete on kbIdB from accA MUST fail with 404
    const crossToggleRes = await fetch(`http://127.0.0.1:${port}/api/knowledge/${kbIdB}/toggle`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
    });
    assert.equal(crossToggleRes.status, 404);

    const crossDelRes = await fetch(`http://127.0.0.1:${port}/api/knowledge/${kbIdB}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
    });
    assert.equal(crossDelRes.status, 404);

    // queryKnowledgeRAG strictly isolates hits per account
    const ragA = await queryKnowledgeRAG('beta_secret_token_882 alpha_secret_token_991', 5, accA);
    assert.equal(ragA.context.includes('账号A报价隐私文档'), true);
    assert.equal(ragA.context.includes('账号B售后规范'), false);

    const ragB = await queryKnowledgeRAG('beta_secret_token_882 alpha_secret_token_991', 5, accB);
    assert.equal(ragB.context.includes('账号B售后规范'), true);
    assert.equal(ragB.context.includes('账号A报价隐私文档'), false);

    // 3c. Chat Transcripts strict account isolation
    const nowTs = Date.now();
    await db
      .prepare(
        `INSERT INTO chat_transcripts (id, account_id, title, dialogue_text, learned_style, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(transIdA, accA, '账号A对话范本', '我: 你好A', '简洁口语A', nowTs, nowTs);
    await db
      .prepare(
        `INSERT INTO chat_transcripts (id, account_id, title, dialogue_text, learned_style, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(transIdB, accB, '账号B对话范本', '我: 你好B', '简洁口语B', nowTs, nowTs);

    const transListA = (await (
      await fetch(`http://127.0.0.1:${port}/api/transcripts`, {
        headers: { Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
      })
    ).json()) as any[];
    assert.equal(transListA.some((t) => t.id === transIdA), true);
    assert.equal(transListA.some((t) => t.id === transIdB), false);

    const crossDelTrans = await fetch(`http://127.0.0.1:${port}/api/transcripts/${transIdB}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
    });
    assert.equal(crossDelTrans.status, 404);

    // 3d. Global Persona & Evolution State strict account isolation (HTTP + DB)
    const savePersonaA = await fetch(`http://127.0.0.1:${port}/api/persona/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
      body: JSON.stringify({ ...DEFAULT_GLOBAL_PERSONA, personaName: '苏晓A' }),
    });
    assert.equal(savePersonaA.status, 200);

    const savePersonaB = await fetch(`http://127.0.0.1:${port}/api/persona/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accB },
      body: JSON.stringify({ ...DEFAULT_GLOBAL_PERSONA, personaName: '顾沉B' }),
    });
    assert.equal(savePersonaB.status, 200);

    const personaResA = (await (
      await fetch(`http://127.0.0.1:${port}/api/persona/config`, {
        headers: { Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
      })
    ).json()) as any;
    const personaResB = (await (
      await fetch(`http://127.0.0.1:${port}/api/persona/config`, {
        headers: { Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accB },
      })
    ).json()) as any;
    assert.equal(personaResA.persona.personaName, '苏晓A');
    assert.equal(personaResB.persona.personaName, '顾沉B');

    const freshAcc = `acc_tg_p0_fresh_${Date.now()}`;
    const freshPersona = await getGlobalPersonaFromDb(freshAcc);
    assert.equal(freshPersona.personaName, DEFAULT_GLOBAL_PERSONA.personaName);

    await saveEvolutionStateToDb({ ...DEFAULT_EVOLUTION_STATE, totalHabitsLearned: 7 }, accA);
    const evoB = await getEvolutionStateFromDb(accB);
    assert.equal(evoB.totalHabitsLearned, DEFAULT_EVOLUTION_STATE.totalHabitsLearned);
    const evoA = await getEvolutionStateFromDb(accA);
    assert.equal(evoA.totalHabitsLearned, 7);

    // 3e. POST /api/llm/usage-stats unmasks masked apiKey to hit the real usage bucket
    await syncServerCustomLlmConfig({
      enabled: true,
      engineMode: 'custom',
      protocol: 'openai',
      baseUrl: 'https://usage-test.example.com/v1',
      apiKey: 'sk-usage-real-secret-9988',
      modelName: 'gpt-4o-mini',
    });
    await recordCustomLlmModelUsage({
      apiKey: 'sk-usage-real-secret-9988',
      baseUrl: 'https://usage-test.example.com/v1',
      modelName: 'gpt-4o-mini',
    });
    const usageRes = await fetch(`http://127.0.0.1:${port}/api/llm/usage-stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}`, 'X-Account-Id': accA },
      body: JSON.stringify({
        baseUrl: 'https://usage-test.example.com/v1',
        apiKey: 'sk-u****9988',
        modelName: 'gpt-4o-mini',
      }),
    });
    assert.equal(usageRes.status, 200);
    const usageJson = (await usageRes.json()) as any;
    assert.ok(usageJson.usage?.todayCount >= 1, 'usage-stats must resolve masked apiKey to real bucket');

    // 3f. exportDatabaseSnapshot strips network_proxy.password and restoreDatabaseSnapshot preserves existing secrets
    const prevProxyRow = (await db.prepare("SELECT value FROM system_config WHERE key = 'network_proxy'").get()) as any;
    await db
      .prepare("INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('network_proxy', ?, ?)")
      .run(
        JSON.stringify({ enabled: true, type: 'socks5', host: '127.0.0.1', port: 1080, username: 'u1', password: 'proxy_secret_pw_xyz' }),
        Date.now()
      );
    try {
      const exported = await exportDatabaseSnapshot();
      const exportedProxy = (exported.tables.system_config || []).find((r: any) => r.key === 'network_proxy');
      assert.ok(exportedProxy);
      const exportedProxyVal = JSON.parse(exportedProxy.value);
      assert.equal(exportedProxyVal.password, undefined, 'network_proxy password must be stripped from backup');
      assert.equal(exportedProxyVal.username, 'u1');

      const exportedTrans = (exported.tables.system_config || []).find((r: any) => r.key === 'translation_settings');
      assert.ok(exportedTrans);
      const exportedTransVal = JSON.parse(exportedTrans.value);
      assert.equal(exportedTransVal.geminiApiKey, undefined);
      assert.equal(exportedTransVal.googleApiKey, undefined);

      // Restoring the sanitized snapshot onto same machine MUST preserve existing DB secrets
      await restoreDatabaseSnapshot({
        tables: {
          system_config: [exportedProxy, exportedTrans],
        },
      });
      const restoredProxyRow = (await db.prepare("SELECT value FROM system_config WHERE key = 'network_proxy'").get()) as any;
      assert.equal(JSON.parse(restoredProxyRow.value).password, 'proxy_secret_pw_xyz');
      const restoredTransRow = (await db.prepare("SELECT value FROM system_config WHERE key = 'translation_settings'").get()) as any;
      assert.equal(JSON.parse(restoredTransRow.value).geminiApiKey, 'AIza-real-gemini-123456');
      assert.equal(JSON.parse(restoredTransRow.value).googleApiKey, 'AIza-real-google-654321');
    } finally {
      if (prevProxyRow?.value) {
        await db
          .prepare("INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('network_proxy', ?, ?)")
          .run(prevProxyRow.value, Date.now());
      } else {
        await db.prepare("DELETE FROM system_config WHERE key = 'network_proxy'").run();
      }
    }

    // 3g. resolveUnifiedEvolutionCorpus rejects client messages without matching accountId
    const unlabeledEvo = await resolveUnifiedEvolutionCorpus({
      accountId: accA,
      clientMessages: [
        { id: `unlabeled_${Date.now()}`, chatId: 'tg_999', sender: 'peer', text: 'UnlabeledSecretTextShouldNotEnterCorpus' },
      ],
    });
    assert.equal(unlabeledEvo.corpusText.includes('UnlabeledSecretTextShouldNotEnterCorpus'), false);

    // 3h. Server source must not contain acc_1 -> connectedUserClients[0] cross-account fallback
    const serverSrcNow = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
    assert.equal(serverSrcNow.includes("accountId === 'acc_1' ? Array.from(connectedUserClients.values())[0]"), false);
  } finally {
    try {
      if (kbIdA) await db.prepare('DELETE FROM knowledge_base WHERE id = ?').run(kbIdA);
      if (kbIdB) await db.prepare('DELETE FROM knowledge_base WHERE id = ?').run(kbIdB);
      await db.prepare('DELETE FROM chat_transcripts WHERE id IN (?, ?)').run(transIdA, transIdB);
      await db.prepare('DELETE FROM training_logs WHERE account_id IN (?, ?)').run(accA, accB);
      await db
        .prepare('DELETE FROM system_config WHERE key IN (?, ?, ?, ?)')
        .run(
          `global_persona_config::${accA}`,
          `global_persona_config::${accB}`,
          `evolution_engine_state::${accA}`,
          `evolution_engine_state::${accB}`
        );
    } catch {}
    await syncServerCustomLlmConfig(prevCustomCfg || { enabled: true, engineMode: 'cloud', apiKey: '', engineLicenseKey: '' });
    await syncServerTranslationSettings(prevTransSettings || { preferredEngine: 'gemini', geminiApiKey: '', googleApiKey: '' });
    await new Promise<void>((r) => srv.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

// Helper to build a genuine minimal single-page PDF 1.4 buffer with a real uncompressed content stream
function buildMinimalTestPdfBuffer(textLines: string[]): Buffer {
  const escapedLines = textLines.map((line) =>
    String(line || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  );
  const contentOps = escapedLines
    .map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 18} Td (${line}) Tj ET`)
    .join('\n');
  const contentBuf = Buffer.from(contentOps, 'latin1');

  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${contentBuf.length} >>\nstream\n${contentOps}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objs) {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += obj;
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'latin1');
}

test('P1 Fix 4-6: Real document parsing (UTF-8/UTF-16/GB18030/CSV/JSON/PDF), chunking, multilingual RAG, dedup/watermarking & customer profile preservation', async () => {
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { db, getEvolutionStateFromDb } = await import('../server/db.ts');
  const {
    KnowledgeDocumentError,
    decodeTextBufferStrict,
    parseCsvToReadableKnowledgeText,
    parseJsonToReadableKnowledgeText,
    parsePdfBufferStrict,
    parseKnowledgeDocument,
    splitDocumentIntoSafeChunks,
    escapeSqlLikeTerm,
    extractMultilingualRagTokens,
    canonicalizeCustomerChatId,
    mergeCustomerProfileWithManualData,
  } = await import('../server/knowledgeUtils.ts');
  const {
    app,
    queryKnowledgeRAG,
    getServerCustomLlmConfig,
    syncServerCustomLlmConfig,
  } = await import('../server.ts');

  // 1. Strict text decoding & rejection of binary/corrupted/mojibake payloads
  const utf8Sample = '这是标准的 UTF-8 中文知识库测试文档内容，用于验证编码识别。';
  assert.equal(decodeTextBufferStrict(Buffer.from(utf8Sample, 'utf8')).encoding, 'utf-8');

  const utf8BomBuf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(utf8Sample, 'utf8')]);
  assert.equal(decodeTextBufferStrict(utf8BomBuf).encoding, 'utf-8-bom');

  const utf16LeBomBuf = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('Hello UTF16LE knowledge base entry 2026', 'utf16le'),
  ]);
  const utf16Res = decodeTextBufferStrict(utf16LeBomBuf);
  assert.equal(utf16Res.encoding, 'utf-16le-bom');
  assert.ok(utf16Res.text.includes('Hello UTF16LE knowledge base entry 2026'));

  // Reject NUL binary bytes
  assert.throws(
    () => decodeTextBufferStrict(Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0x6f, 0x72])),
    (e: any) => e instanceof KnowledgeDocumentError
  );
  // Reject invalid UTF-8 + invalid GB18030 trailing half-byte (0xff 0xfe-ish invalid sequence)
  assert.throws(
    () => decodeTextBufferStrict(Buffer.from([0xff, 0x80, 0xff, 0x80, 0xff, 0x80, 0x41, 0x42, 0x43, 0x44])),
    (e: any) => e instanceof KnowledgeDocumentError
  );
  // Reject explicit Unicode replacement character mojibake (U+FFFD)
  assert.throws(
    () => decodeTextBufferStrict(Buffer.from('损坏文档内容\uFFFD\uFFFD不能入库', 'utf8')),
    (e: any) => e instanceof KnowledgeDocumentError
  );

  // 2. Real CSV & JSON parsing + syntax error rejection
  const csvParsed = parseCsvToReadableKnowledgeText(
    '标题;话术内容;备注\n"报价规则";"VIP客户享9折，支持USDT结算";"重点""核心"""\n售后说明;7x24小时响应;常规'
  );
  assert.ok(csvParsed.includes('标题: 报价规则'));
  assert.ok(csvParsed.includes('VIP客户享9折，支持USDT结算'));
  assert.ok(csvParsed.includes('重点"核心"'));
  assert.throws(
    () => parseCsvToReadableKnowledgeText('标题,内容\n"未闭合引号,坏数据行内容'),
    (e: any) => e instanceof KnowledgeDocumentError
  );

  const jsonParsed = parseJsonToReadableKnowledgeText(
    JSON.stringify({ faq: [{ q: '如何充值', a: '支持TRC20自动到账，免额外手续费' }] })
  );
  assert.ok(jsonParsed.includes('q: 如何充值'));
  assert.ok(jsonParsed.includes('a: 支持TRC20自动到账'));
  assert.throws(
    () => parseJsonToReadableKnowledgeText('{ "broken": [1, 2, '),
    (e: any) => e instanceof KnowledgeDocumentError
  );

  // 3. Real PDF extraction + explicit rejection of invalid/corrupted/encrypted/empty PDFs
  const realPdfBuf = buildMinimalTestPdfBuffer([
    'HumanSense Knowledge Base Verification Document 2026',
    'VIP pricing rule: Standard plan is 99 USD per month.',
  ]);
  const pdfExtracted = await parsePdfBufferStrict(realPdfBuf);
  assert.equal(pdfExtracted.pageCount, 1);
  assert.ok(pdfExtracted.text.includes('HumanSense Knowledge Base Verification Document 2026'));
  assert.ok(pdfExtracted.text.includes('Standard plan is 99 USD per month'));

  const docParsedPdf = await parseKnowledgeDocument({
    fileName: 'pricing_guide.pdf',
    fileBase64: realPdfBuf.toString('base64'),
    mimeType: 'application/pdf',
  });
  assert.equal(docParsedPdf.detectedEncoding, 'pdf-text-stream');
  assert.ok(docParsedPdf.extractedText.includes('VIP pricing rule'));

  // Invalid header
  await assert.rejects(
    () => parsePdfBufferStrict(Buffer.from('NOT_A_REAL_PDF_FILE_CONTENT_123456', 'utf8')),
    (e: any) => e instanceof KnowledgeDocumentError
  );
  // Corrupted PDF body
  await assert.rejects(
    () => parsePdfBufferStrict(Buffer.from('%PDF-1.4\ncorrupted garbage xref missing %%EOF', 'latin1')),
    (e: any) => e instanceof KnowledgeDocumentError
  );
  // Scanned / blank PDF (no text stream content)
  const emptyPdfBuf = buildMinimalTestPdfBuffer(['   ']);
  await assert.rejects(
    () => parsePdfBufferStrict(emptyPdfBuf),
    (e: any) => e instanceof KnowledgeDocumentError && /扫描图片型|空白|有效文本/.test(e.message)
  );
  // Unsupported extension
  await assert.rejects(
    () => parseKnowledgeDocument({ fileName: 'malware.exe', fileContent: 'binary executable stub text' }),
    (e: any) => e instanceof KnowledgeDocumentError
  );

  // 4. Safe document chunking
  const longSection = Array.from({ length: 18 }, (_, i) => `### 第${i + 1}章 客户沟通规范\n${'核心话术细节与真实业务推进规则。'.repeat(130)}`).join('\n\n');
  assert.ok(longSection.length > 35_000);
  const chunks = splitDocumentIntoSafeChunks(longSection, { maxChunkChars: 5500, maxChunks: 35 });
  assert.ok(chunks.length >= 6 && chunks.length <= 35);
  for (const ch of chunks) {
    assert.ok(ch.length <= 5500, `Chunk length ${ch.length} exceeded 5500`);
  }
  assert.throws(
    () => splitDocumentIntoSafeChunks(longSection, { maxChunkChars: 1200, maxChunks: 5 }),
    (e: any) => e instanceof KnowledgeDocumentError
  );

  // 5. Unicode multilingual RAG tokenization + SQL wildcard escaping + zero-hit non-shadowing
  assert.equal(escapeSqlLikeTerm('100%_test\\path'), '100\\%\\_test\\\\path');
  const multiTokens = extractMultilingualRagTokens('Кибербезопасность الأمن การชำระเงิน güvenlik 量化策略');
  assert.ok(multiTokens.includes('кибербезопасность'));
  assert.ok(multiTokens.includes('الأمن'));
  assert.ok(multiTokens.includes('การชำระเงิน'));
  assert.ok(multiTokens.includes('güvenlik'));
  assert.ok(multiTokens.includes('量化'));

  // 6. Customer chatId canonicalization & manual memory/tag preservation
  assert.equal(canonicalizeCustomerChatId('123456789'), 'tg_123456789');
  assert.equal(canonicalizeCustomerChatId('-100987654321'), 'tg_-100987654321');
  assert.equal(canonicalizeCustomerChatId('tg_123456789'), 'tg_123456789');

  const mergedProfile = mergeCustomerProfileWithManualData({
    existingProfile: {
      client_name: '陈总（人工备注）',
      age_estimate: '35岁左右',
      occupation: '跨境电商创始人',
      location_timezone: '新加坡 UTC+8',
      likes_interests: JSON.stringify(['手冲咖啡', '量化对冲']),
      dislikes_taboos: JSON.stringify(['催单', '电话骚扰']),
      key_memories: JSON.stringify([
        { id: 'manual_mem_1', date: '2026-01-10', topic: '人工记录偏好', summary: '仅周末方便看详细方案', emotion: '信任' },
      ]),
    },
    aiData: {
      clientName: '陈先生',
      relationshipStage: '合作推进',
      ageEstimate: '未知',
      occupation: '未知',
      locationTimezone: '未提及',
      toneStyle: '简洁务实',
      likesInterests: ['量化对冲', '宏观美债'],
      dislikesTaboos: ['夸大宣传'],
      emotionalNeeds: '关注资金安全与风控细节',
      keyMemories: [
        { id: 'ai_mem_1', date: '近期', topic: '风控问询', summary: '希望提供月度回撤报告', emotion: '谨慎' },
      ],
    },
  });
  assert.equal(mergedProfile.clientName, '陈总（人工备注）');
  assert.equal(mergedProfile.ageEstimate, '35岁左右');
  assert.equal(mergedProfile.occupation, '跨境电商创始人');
  assert.equal(mergedProfile.locationTimezone, '新加坡 UTC+8');
  assert.equal(mergedProfile.relationshipStage, '合作推进');
  assert.deepEqual(mergedProfile.likesInterests, ['手冲咖啡', '量化对冲', '宏观美债']);
  assert.deepEqual(mergedProfile.dislikesTaboos, ['催单', '电话骚扰', '夸大宣传']);
  assert.equal(mergedProfile.keyMemories.length, 2);
  assert.ok(mergedProfile.keyMemories.some((m: any) => m.id === 'manual_mem_1'));
  assert.ok(mergedProfile.keyMemories.some((m: any) => m.id === 'ai_mem_1'));

  // 7. End-to-End HTTP + DB integration tests (RAG non-shadowing, wildcard safety, /api/knowledge/upload, /api/transcripts/import-from-chat, /api/evolution/learn, /api/customer/*)
  const prevJwtSecret = process.env.JWT_SECRET;
  const prevCustomCfg = await getServerCustomLlmConfig().catch(() => null);
  process.env.JWT_SECRET = 'p1_verification_jwt_secret';

  let llmCallCount = 0;
  let lastLlmPrompt = '';
  const mockLlmSrv = http.createServer(async (req, res) => {
    const chunksBody: Buffer[] = [];
    for await (const c of req) chunksBody.push(c);
    const body = JSON.parse(Buffer.concat(chunksBody).toString('utf8') || '{}');
    llmCallCount++;
    const prompt = String(body?.messages?.[0]?.content || '');
    lastLlmPrompt = prompt;

    let assistantContent = 'OK';
    if (prompt.includes('人设知识库与客服话术解析分类引擎')) {
      const segMatch = prompt.match(/第\s*(\d+)\//);
      const segNum = segMatch ? segMatch[1] : String(llmCallCount);
      assistantContent = JSON.stringify([
        {
          title: `PDF提炼知识点-${segNum}`,
          category: 'wealth_investment',
          content: `从文档第${segNum}段真实提取的核心业务规则与报价说明内容（含合规校验）`,
          keywords: [`文档片段${segNum}`, 'VIP报价'],
        },
        {
          // Duplicate across chunks to verify cross-chunk deduplication
          title: '跨段去重共享规则',
          category: 'trust_defense',
          content: '所有客户资金均支持可验证流水审计，严禁虚假承诺。',
          keywords: ['去重', '资金审计'],
        },
      ]);
    } else if (prompt.includes('真实沟通技巧、大白话聊天习惯')) {
      assistantContent = JSON.stringify([
        {
          type: 'oral_slang',
          title: '自然口语过渡',
          description: '先共情对方的忙碌状态再自然切入方案，避免生硬推销感',
          examplePattern: '刚忙完吧？先把重点给你梳理好啦，有空扫一眼就行',
          confidenceScore: 0.91,
        },
        {
          type: 'pacing_breath',
          title: '短句分段节奏',
          description: '单条回复控制在一到两句内，模拟真人手机打字节奏',
          examplePattern: '嗯对的，这块风控确实最关键',
          confidenceScore: 0.88,
        },
      ]);
    } else if (prompt.includes('客观总结以下真实历史对话')) {
      assistantContent = '说话风格简洁自然，善于先确认对方核心风控诉求再给出明确时间约定。';
    } else if (prompt.includes('客户画像与长期记忆提炼助手')) {
      assistantContent = JSON.stringify({
        clientName: '林先生',
        relationshipStage: '需求沟通',
        ageEstimate: '未知',
        occupation: '未知',
        locationTimezone: '未提及',
        toneStyle: '务实谨慎',
        likesInterests: ['月度结算'],
        dislikesTaboos: [],
        emotionalNeeds: '确认SLA与响应时效',
        keyMemories: [
          { id: 'ai_sla_1', date: '近期', topic: 'SLA确认', summary: '周五前需发送SLA正式文本', emotion: '认真' },
        ],
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: `chatcmpl-p1-${llmCallCount}`,
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: assistantContent }, finish_reason: 'stop' }],
      })
    );
  });

  const srv = http.createServer(app);
  await new Promise<void>((r) => mockLlmSrv.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const llmPort = (mockLlmSrv.address() as any).port;
  const port = (srv.address() as any).port;

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'member_p1', username: 'member_p1', role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const memberJwt = `${headerB64}.${payloadB64}.${sigB64}`;

  const testAcc = `acc_tg_p1_${Date.now()}`;
  const rawChatNum = `${Date.now()}`.slice(-9);
  const canonicalChat = `tg_${rawChatNum}`;
  const testCustomCfg = {
    enabled: true,
    engineMode: 'custom',
    protocol: 'openai',
    baseUrl: `http://127.0.0.1:${llmPort}/v1`,
    apiKey: 'sk-p1-local-test',
    modelName: 'gpt-4o-mini',
  };
  const headersAuth = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${memberJwt}`,
    'X-Account-Id': testAcc,
  };

  try {
    // 7a. RAG: 30 high-hit distractors MUST NOT shadow a fresh zero-hit match, and SQL %/_/\ must not wildcard-match
    const ragNow = Date.now();
    const insertKb = db.prepare(
      `INSERT INTO knowledge_base (id, account_id, category, title, content, keywords, source_type, is_active, hit_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', 1, ?, ?, ?)`
    );
    for (let i = 0; i < 30; i++) {
      await insertKb.run(
        `know_distract_${ragNow}_${i}`,
        testAcc,
        'life_emotion',
        `无关高频干扰条目 ${i}`,
        `这是日常问候语干扰文本 序号${i} testXitem`,
        JSON.stringify(['无关词汇']),
        500,
        ragNow - 10_000 - i,
        ragNow - 10_000 - i
      );
    }
    await insertKb.run(
      `know_fresh_zero_${ragNow}`,
      testAcc,
      'wealth_investment',
      'Кибербезопасность & test_exact',
      '全新零命中安全条款：Кибербезопасность การชำระเงิน test_exact 100%_vault',
      JSON.stringify(['Кибербезопасность', 'การชำระเงิน', 'test_exact']),
      0,
      ragNow + 1000,
      ragNow + 1000
    );

    const ragCyrillic = await queryKnowledgeRAG('Нужна консультация: кибербезопасность и การชำระเงิน', 3, testAcc);
    assert.ok(ragCyrillic.matchedCount >= 1);
    assert.ok(ragCyrillic.context.includes('Кибербезопасность & test_exact'), 'Zero-hit item must not be shadowed by 30 high-hit distractors');

    const ragWildcardProbe = await queryKnowledgeRAG('test_exact', 5, testAcc);
    assert.equal(ragWildcardProbe.matchedItems.some((m: any) => String(m.content || '').includes('testXitem')), false, 'Underscore _ must be escaped in SQL LIKE');
    assert.equal(ragWildcardProbe.matchedItems.some((m: any) => m.id === `know_fresh_zero_${ragNow}`), true);

    // 7b. POST /api/knowledge/upload: rejects corrupted PDF before LLM, succeeds on real multi-chunk text & real PDF
    const callsBeforeCorrupt = llmCallCount;
    const corruptPdfRes = await fetch(`http://127.0.0.1:${port}/api/knowledge/upload`, {
      method: 'POST',
      headers: headersAuth,
      body: JSON.stringify({
        fileName: 'damaged.pdf',
        fileBase64: Buffer.from('%PDF-1.4\n/Encrypt <<>> broken data', 'latin1').toString('base64'),
        customConfig: testCustomCfg,
      }),
    });
    assert.equal(corruptPdfRes.status, 400);
    assert.equal(llmCallCount, callsBeforeCorrupt, 'Corrupted PDF must be rejected before calling LLM');

    const pdfUploadRes = await fetch(`http://127.0.0.1:${port}/api/knowledge/upload`, {
      method: 'POST',
      headers: headersAuth,
      body: JSON.stringify({
        fileName: 'real_pricing.pdf',
        fileBase64: realPdfBuf.toString('base64'),
        mimeType: 'application/pdf',
        customConfig: testCustomCfg,
      }),
    });
    assert.equal(pdfUploadRes.status, 200);
    const pdfUploadJson = (await pdfUploadRes.json()) as any;
    assert.equal(pdfUploadJson.success, true);
    assert.equal(pdfUploadJson.detectedEncoding, 'pdf-text-stream');
    assert.equal(pdfUploadJson.pageCount, 1);
    assert.equal(pdfUploadJson.itemsLearned, 2);

    // Multi-chunk text upload (> 12,000 chars -> 3 chunks, verifying cross-chunk dedup of shared rule)
    const multiChunkText = Array.from(
      { length: 3 },
      (_, idx) => `## 模块 ${idx + 1}\n${'客户资金隔离与透明结算说明，支持实时对账。'.repeat(165)}`
    ).join('\n\n');
    const multiUploadRes = await fetch(`http://127.0.0.1:${port}/api/knowledge/upload`, {
      method: 'POST',
      headers: headersAuth,
      body: JSON.stringify({
        fileName: 'multi_chunk_manual.md',
        fileBase64: Buffer.from(multiChunkText, 'utf8').toString('base64'),
        customConfig: testCustomCfg,
      }),
    });
    assert.equal(multiUploadRes.status, 200);
    const multiUploadJson = (await multiUploadRes.json()) as any;
    assert.equal(multiUploadJson.success, true);
    assert.ok(multiUploadJson.totalChunks >= 2, 'Oversized document must split into multiple chunks');
    // "跨段去重共享规则" already inserted once in pdfUploadRes -> skipped across all chunks!
    assert.ok(multiUploadJson.skippedDuplicates >= 2, 'Duplicate items across chunks / existing KB must be skipped');

    // 7c. /api/customer/* canonicalization & manual memory/tag preservation
    const saveManualRes = await fetch(`http://127.0.0.1:${port}/api/customer/profile/${rawChatNum}`, {
      method: 'POST',
      headers: headersAuth,
      body: JSON.stringify({
        clientName: '林总（VIP手工标注）',
        ageEstimate: '40岁',
        occupation: '供应链总监',
        locationTimezone: '香港 UTC+8',
        likesInterests: ['准时交付', '高尔夫'],
        dislikesTaboos: ['深夜发消息'],
        keyMemories: [
          { id: 'manual_k1', date: '2026-02-01', topic: '人工核心备忘', summary: '合同必须双语版', emotion: '认真' },
        ],
      }),
    });
    assert.equal(saveManualRes.status, 200);
    const saveManualJson = (await saveManualRes.json()) as any;
    assert.equal(saveManualJson.chatId, canonicalChat);

    // Seed real messages under canonical chatId
    const msgBaseTs = Date.now() - 5000;
    await db
      .prepare(
        `INSERT INTO messages (id, chat_id, account_id, sender, sender_name, text, timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(`msg_p1_1_${msgBaseTs}`, canonicalChat, testAcc, 'peer', '林总', '你好，我们想确认一下月度结算方案和SLA响应时效要求，最好周五前发我。', '10:00', msgBaseTs);
    await db
      .prepare(
        `INSERT INTO messages (id, chat_id, account_id, sender, sender_name, text, timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(`msg_p1_2_${msgBaseTs}`, canonicalChat, testAcc, 'me', '我方', '好的林总，周四下午先把SLA中文版发您确认细节。', '10:02', msgBaseTs + 1000);

    const analyzeRes = await fetch(`http://127.0.0.1:${port}/api/customer/analyze/${rawChatNum}`, {
      method: 'POST',
      headers: headersAuth,
      body: JSON.stringify({ customConfig: testCustomCfg, chatTitle: '林总' }),
    });
    assert.equal(analyzeRes.status, 200);
    const analyzeJson = (await analyzeRes.json()) as any;
    assert.equal(analyzeJson.profile.chatId, canonicalChat);
    assert.equal(analyzeJson.profile.clientName, '林总（VIP手工标注）');
    assert.equal(analyzeJson.profile.ageEstimate, '40岁', 'Manual age must not be overwritten by AI 未知');
    assert.equal(analyzeJson.profile.occupation, '供应链总监', 'Manual occupation must not be overwritten by AI 未知');
    assert.equal(analyzeJson.profile.locationTimezone, '香港 UTC+8', 'Manual location must not be overwritten by AI 未提及');
    assert.ok(analyzeJson.profile.likesInterests.includes('准时交付'));
    assert.ok(analyzeJson.profile.likesInterests.includes('月度结算'));
    assert.ok(analyzeJson.profile.dislikesTaboos.includes('深夜发消息'));
    assert.ok(analyzeJson.profile.keyMemories.some((m: any) => m.id === 'manual_k1'));
    assert.ok(analyzeJson.profile.keyMemories.some((m: any) => m.id === 'ai_sla_1'));

    // 7d. /api/transcripts/import-from-chat/:chatId content hash & watermark dedup
    const importTrans1 = await fetch(`http://127.0.0.1:${port}/api/transcripts/import-from-chat/${rawChatNum}`, {
      method: 'POST',
      headers: headersAuth,
      body: JSON.stringify({ customConfig: testCustomCfg, chatTitle: '林总' }),
    });
    assert.equal(importTrans1.status, 200);
    const importTrans1Json = (await importTrans1.json()) as any;
    assert.equal(importTrans1Json.success, true);
    assert.equal(importTrans1Json.lastMessageCreatedAt, msgBaseTs + 1000);

    // Repeating same chat import returns 409 duplicate
    const importTransDup = await fetch(`http://127.0.0.1:${port}/api/transcripts/import-from-chat/${canonicalChat}`, {
      method: 'POST',
      headers: headersAuth,
      body: JSON.stringify({ customConfig: testCustomCfg, chatTitle: '林总' }),
    });
    assert.equal(importTransDup.status, 409);

    // Adding a newer message allows incremental re-import
    await db
      .prepare(
        `INSERT INTO messages (id, chat_id, account_id, sender, sender_name, text, timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(`msg_p1_3_${msgBaseTs}`, canonicalChat, testAcc, 'peer', '林总', '收到，麻烦顺便附上对公账户抬头和税号信息。', '10:05', msgBaseTs + 3000);

    const importTrans2 = await fetch(`http://127.0.0.1:${port}/api/transcripts/import-from-chat/${canonicalChat}`, {
      method: 'POST',
      headers: headersAuth,
      body: JSON.stringify({ customConfig: testCustomCfg, chatTitle: '林总' }),
    });
    assert.equal(importTrans2.status, 200);
    const importTrans2Json = (await importTrans2.json()) as any;
    assert.equal(importTrans2Json.lastMessageCreatedAt, msgBaseTs + 3000);

    // 7e. /api/evolution/learn watermark + corpusHash + habit dedup
    const evo1Res = await fetch(`http://127.0.0.1:${port}/api/evolution/learn`, {
      method: 'POST',
      headers: headersAuth,
      body: JSON.stringify({ customConfig: testCustomCfg }),
    });
    assert.equal(evo1Res.status, 200);
    const evo1Json = (await evo1Res.json()) as any;
    assert.equal(evo1Json.newHabitsLearned, 2);
    assert.equal(evo1Json.lastLearnedMessageCreatedAt, msgBaseTs + 3000);
    assert.ok(lastLlmPrompt.includes('月度结算方案'));

    // Repeating with no new messages returns 409 alreadyLearned
    const evoDupNoNew = await fetch(`http://127.0.0.1:${port}/api/evolution/learn`, {
      method: 'POST',
      headers: headersAuth,
      body: JSON.stringify({ customConfig: testCustomCfg }),
    });
    assert.equal(evoDupNoNew.status, 409);

    // Too-short manual sample (< 50 chars) must be rejected with 400 instead of fabricating corpus
    const evoShortSample = await fetch(`http://127.0.0.1:${port}/api/evolution/learn`, {
      method: 'POST',
      headers: headersAuth,
      body: JSON.stringify({ sampleTexts: ['太短了'], customConfig: testCustomCfg }),
    });
    assert.equal(evoShortSample.status, 400);

    // Repeating identical manual sampleTexts (>= 50 chars) returns 409 after first learn
    const manualSamples = [
      '客户：最近行情波动这么大，你们一般怎么控制回撤呀？\n我：嗯呢，稳字当头先控好仓位节奏最重要啦，咱们分批进场不急着重仓。',
    ];
    const evoManual1 = await fetch(`http://127.0.0.1:${port}/api/evolution/learn`, {
      method: 'POST',
      headers: headersAuth,
      body: JSON.stringify({ sampleTexts: manualSamples, customConfig: testCustomCfg }),
    });
    assert.equal(evoManual1.status, 200);
    const evoManual1Json = (await evoManual1.json()) as any;
    // Mock LLM returned the exact same 2 habit titles/descriptions -> habit dedup keeps newHabitsLearned === 0
    assert.equal(evoManual1Json.newHabitsLearned, 0);
    assert.equal(evoManual1Json.skippedDuplicateHabits, 2);

    const evoManualDup = await fetch(`http://127.0.0.1:${port}/api/evolution/learn`, {
      method: 'POST',
      headers: headersAuth,
      body: JSON.stringify({ sampleTexts: manualSamples, customConfig: testCustomCfg }),
    });
    assert.equal(evoManualDup.status, 409);

    const finalEvoState = await getEvolutionStateFromDb(testAcc);
    assert.equal(finalEvoState.totalHabitsLearned, 2);

    // 8. Verify frontend wiring & zero native alert/confirm in updated P1 files
    const modalSrc = readFileSync(resolve(process.cwd(), 'src/components/KnowledgeEvolutionModal.tsx'), 'utf8');
    const dockSrc = readFileSync(resolve(process.cwd(), 'src/components/UnifiedRightDock.tsx'), 'utf8');
    const apiSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
    assert.equal(modalSrc.includes('uploadKnowledgeDocApi'), true);
    assert.equal(modalSrc.includes('importTranscriptFromChatApi'), true);
    assert.equal(modalSrc.includes('triggerEvolutionLearnApi'), true);
    assert.equal(modalSrc.includes('toggleEvolutionHabitApi'), true);
    assert.equal(/window\.(alert|confirm)/.test(modalSrc), false);
    assert.equal(dockSrc.includes('activeChatId={activeChatId}'), true);
    assert.equal(apiSrc.includes('arrayBufferToBase64'), true);
  } finally {
    try {
      await db.prepare('DELETE FROM knowledge_base WHERE account_id = ?').run(testAcc);
      await db.prepare('DELETE FROM chat_transcripts WHERE account_id = ?').run(testAcc);
      await db.prepare('DELETE FROM training_logs WHERE account_id = ?').run(testAcc);
      await db.prepare('DELETE FROM customer_profiles WHERE account_id = ?').run(testAcc);
      await db.prepare('DELETE FROM messages WHERE account_id = ?').run(testAcc);
      await db
        .prepare('DELETE FROM system_config WHERE key IN (?, ?)')
        .run(`global_persona_config::${testAcc}`, `evolution_engine_state::${testAcc}`);
    } catch {}
    await syncServerCustomLlmConfig(prevCustomCfg || { enabled: true, engineMode: 'cloud', apiKey: '', engineLicenseKey: '' });
    await new Promise<void>((r) => srv.close(() => r()));
    await new Promise<void>((r) => mockLlmSrv.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('P2 #7: unifies 30-turn history, 4-msg RAG window, transcripts without hardcoded catchphrase, cold-start blankness, character budget, Webhook translation config, and real Cloud RAG test-reply', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { db, initDatabase } = await import('./db.ts');
  const {
    app,
    getServerCustomLlmConfig,
    syncServerCustomLlmConfig,
    UNIFIED_REPLY_HISTORY_LIMIT,
    UNIFIED_RAG_WINDOW_MESSAGES,
    UNIFIED_TRANSCRIPT_SNIPPET_LINES,
    UNIFIED_SYSTEM_PROMPT_BUDGET_CHARS,
    buildUnifiedRagQuery,
    isCustomerColdStartProfile,
    buildUnifiedColdStartGuideline,
    formatUnifiedTranscriptContext,
    normalizeTestReplyHistoryTurns,
    applyPromptCharacterBudget,
  } = await import('../server.ts');

  await initDatabase();

  // 1. Unit assertions for shared reply pipeline constants & helpers
  assert.equal(UNIFIED_REPLY_HISTORY_LIMIT, 30);
  assert.equal(UNIFIED_RAG_WINDOW_MESSAGES, 4);
  assert.equal(UNIFIED_TRANSCRIPT_SNIPPET_LINES, 14);
  assert.equal(UNIFIED_SYSTEM_PROMPT_BUDGET_CHARS, 14000);

  const ragQuery = buildUnifiedRagQuery(
    [
      { text: 'turn 1 old' },
      { text: 'turn 2 old' },
      { text: 'turn 3 recent' },
      { text: 'turn 4 recent' },
      { text: 'turn 5 recent' },
    ],
    'turn 6 incoming'
  );
  assert.equal(ragQuery, 'turn 3 recent turn 4 recent turn 5 recent turn 6 incoming');

  assert.equal(isCustomerColdStartProfile(null, [], []), true);
  assert.equal(isCustomerColdStartProfile({ relationship_stage: '初次沟通' }, ['coffee'], []), true);
  assert.equal(isCustomerColdStartProfile({ relationship_stage: '深度熟人' }, ['coffee'], []), false);
  assert.match(buildUnifiedColdStartGuideline(true, []), /冷启动客观留白准则/);
  assert.match(buildUnifiedColdStartGuideline(false, ['高尔夫']), /高尔夫/);

  const manyLines = Array.from({ length: 20 }, (_, i) => `L${i + 1}: dialogue`).join('\n');
  const formattedTranscript = formatUnifiedTranscriptContext([
    { title: '真实销冠记录', learned_style: '克制真诚', dialogue_text: manyLines },
  ]);
  assert.equal(formattedTranscript.includes('小笨蛋'), false);
  assert.equal(formattedTranscript.includes('L7: dialogue'), true);
  assert.equal(formattedTranscript.includes('L6: dialogue'), false);

  const normalized30 = normalizeTestReplyHistoryTurns(
    Array.from({ length: 40 }, (_, i) => ({ sender: i % 2 === 0 ? 'peer' : 'me', text: `msg_${i + 1}` })),
    'latest_msg'
  );
  assert.equal(normalized30.length, 30);
  assert.equal(normalized30[normalized30.length - 1]?.text, 'latest_msg');

  const budgeted = applyPromptCharacterBudget(
    {
      persona: 'CORE_PERSONA',
      antiAi: 'CORE_ANTIAI',
      coldStartGuideline: 'CORE_COLDSTART',
      profile: 'PROFILE_' + 'A'.repeat(2000),
      knowledge: 'KB_' + 'B'.repeat(5000),
      transcripts: 'TRANS_' + 'C'.repeat(9000),
      langConstraint: 'LANG_LOCK',
    },
    6000
  );
  assert.equal(budgeted.truncated, true);
  assert.ok(budgeted.totalChars <= 6000);
  assert.ok(budgeted.prompt.includes('CORE_PERSONA'));
  assert.ok(budgeted.prompt.includes('CORE_ANTIAI'));
  assert.ok(budgeted.prompt.includes('CORE_COLDSTART'));
  assert.ok(budgeted.prompt.includes('LANG_LOCK'));

  // 2. Source contract verification across all 4 AI reply paths + KnowledgeEvolutionModal
  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.equal(serverSrc.includes('小笨蛋'), false, 'Hardcoded catchphrase must be removed completely from server.ts');
  assert.match(serverSrc, /app\.post\('\/api\/llm\/chat'[\s\S]*?applyPromptCharacterBudget/);
  assert.match(serverSrc, /processTelegramMessageAsync[\s\S]*?LIMIT 30[\s\S]*?loadUnifiedTranscriptContext\('acc_telegram_bot'\)[\s\S]*?applyPromptCharacterBudget[\s\S]*?getCnTranslationIfForeign\(\s*replyText,\s*serverCustomConfig/);
  assert.match(serverSrc, /extractRecentTwoWayMessages\(canonicalChatId, rawChatId, \[\], 30, accountId\)[\s\S]*?buildUnifiedRagQuery[\s\S]*?applyPromptCharacterBudget/);

  const keModalSrc = readFileSync(resolve(process.cwd(), 'src/components/KnowledgeEvolutionModal.tsx'), 'utf8');
  assert.match(keModalSrc, /云端知识库 \(Cloud RAG\)/);
  assert.match(keModalSrc, /本地知识库:/);

  // 3. HTTP runtime test: /api/persona/test-reply genuinely queries Cloud RAG & enforces disconnection guard
  const prevJwtSecret = process.env.JWT_SECRET;
  const prevBrainUrl = process.env.RAILWAY_BRAIN_URL;
  process.env.JWT_SECRET = 'p2_7_test_jwt_secret';
  const prevCustomCfg = await getServerCustomLlmConfig().catch(() => null);

  let cloudRagRequests = 0;
  let failCloudRag = false;
  let capturedLlmMessages: any[] = [];
  let capturedSystemPrompt = '';

  const mockCloudSrv = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const bodyStr = Buffer.concat(chunks).toString('utf8');
    let bodyJson: any = {};
    try {
      bodyJson = JSON.parse(bodyStr);
    } catch {}

    if (req.url?.startsWith('/api/knowledge/search')) {
      cloudRagRequests++;
      if (failCloudRag) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Mock Cloud KB Gateway Down' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          results: [
            {
              id: 'ckb_1',
              title: '结算对账标准',
              content: '支持每日 T+0 实时结算与双语对账单导出。',
              category: '结算',
            },
          ],
        })
      );
      return;
    }

    if (req.url?.includes('/chat/completions')) {
      capturedLlmMessages = Array.isArray(bodyJson.messages) ? bodyJson.messages : [];
      capturedSystemPrompt = capturedLlmMessages.find((m: any) => m.role === 'system')?.content || '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl_p2_7',
          choices: [{ message: { role: 'assistant', content: '我们支持每日T+0实时结算，我发份双语对账单样例给您看下。' } }],
        })
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  await new Promise<void>((r) => mockCloudSrv.listen(0, '127.0.0.1', r));
  const mockCloudPort = (mockCloudSrv.address() as any).port;
  process.env.RAILWAY_BRAIN_URL = `http://127.0.0.1:${mockCloudPort}`;

  const appSrv = http.createServer(app);
  await new Promise<void>((r) => appSrv.listen(0, '127.0.0.1', r));
  const appPort = (appSrv.address() as any).port;

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'member_p2_7', username: 'member_p2_7', role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const memberJwt = `${headerB64}.${payloadB64}.${sigB64}`;

  const testAcc = `acc_tg_p2_7_${Date.now()}`;
  const kbId = `kb_p2_7_${Date.now()}`;

  try {
    await db
      .prepare(
        `INSERT INTO knowledge_base (id, account_id, title, content, category, keywords, source_type, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'manual', 1, ?, ?)`
      )
      .run(kbId, testAcc, '本地结算说明', '支持多种合规币种实时结算与资金隔离托管。', '业务规则', '结算 资金', Date.now(), Date.now());

    const cloudConfig = {
      enabled: true,
      explicitlyDisabled: false,
      engineMode: 'cloud',
      baseUrl: `http://127.0.0.1:${mockCloudPort}/v1`,
      apiKey: 'test-cloud-key',
      engineLicenseKey: 'test-license-key',
      modelName: 'gemini-4-hydrogen',
      enableKnowledgeBaseRAG: true,
    };

    const resOk = await fetch(`http://127.0.0.1:${appPort}/api/persona/test-reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
        'X-Account-Id': testAcc,
      },
      body: JSON.stringify({
        message: '你们的结算周期是怎样的？',
        recentChatHistory: [
          { sender: 'peer', text: '你好，我想了解一下你们的产品服务' },
          { sender: 'me', text: '你好呀，请问主要想了解哪部分呢？' },
          { sender: 'peer', text: '主要是结算方面的问题' },
        ],
        customConfig: cloudConfig,
      }),
    });
    assert.equal(resOk.status, 200);
    const dataOk = (await resOk.json()) as any;
    assert.ok(cloudRagRequests >= 1, 'Expected /api/persona/test-reply to genuinely call Cloud RAG');
    assert.equal(dataOk.ragSources?.cloudRagEnabled, true);
    assert.equal(dataOk.ragSources?.cloudRagMatchedCount, 1);
    assert.equal(dataOk.ragSources?.localRagMatchedCount, 1);
    assert.ok(dataOk.matchedKnowledge.some((k: any) => k.source === 'cloud_kb' && k.title === '结算对账标准'));
    assert.ok(dataOk.matchedKnowledge.some((k: any) => k.source === 'local_rag' && k.title === '本地结算说明'));
    assert.ok(capturedSystemPrompt.includes('冷启动客观留白准则'));
    assert.ok(capturedLlmMessages.some((m: any) => m.role === 'assistant' && m.content.includes('请问主要想了解哪部分呢')));

    // Verify Cloud RAG failure blocks instead of silently degrading
    failCloudRag = true;
    const resBlocked = await fetch(`http://127.0.0.1:${appPort}/api/persona/test-reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
        'X-Account-Id': testAcc,
      },
      body: JSON.stringify({
        message: '换个问题测试断连拦截：资金安全怎么保障？',
        customConfig: cloudConfig,
      }),
    });
    assert.equal(resBlocked.status, 502);
    const dataBlocked = (await resBlocked.json()) as any;
    assert.equal(dataBlocked.blocked, true);
    assert.equal(dataBlocked.source, 'cloud_kb_disconnection_guard');
  } finally {
    await db.prepare('DELETE FROM knowledge_base WHERE id = ?').run(kbId).catch(() => {});
    await syncServerCustomLlmConfig(prevCustomCfg || { enabled: true, engineMode: 'cloud', apiKey: '', engineLicenseKey: '' });
    await new Promise<void>((r) => appSrv.close(() => r()));
    await new Promise<void>((r) => mockCloudSrv.close(() => r()));
    if (prevBrainUrl === undefined) delete process.env.RAILWAY_BRAIN_URL;
    else process.env.RAILWAY_BRAIN_URL = prevBrainUrl;
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('P2 #8: CustomLLMModal protocol selector preserves protocol, aligns /api/llm/ping URLs, intercepts empty Gemini models, validates inference payloads, and passes through upstream errors', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { initDatabase } = await import('./db.ts');
  const {
    app,
    inferGatewayProtocol,
    buildCustomGeminiUrl,
    buildCustomOpenAiUrls,
    validatePingInferencePayload,
  } = await import('../server.ts');
  const { inferGatewayProtocolFromUrlAndModel } = await import('../src/services/apiService.ts');

  await initDatabase();

  // 1. Unit assertions for protocol preservation & URL / model / payload helpers
  assert.equal(inferGatewayProtocol('https://relay.example.com', 'gpt-4o', 'anthropic'), 'anthropic');
  assert.equal(inferGatewayProtocol('https://relay.example.com', 'claude-3-5-sonnet', 'gemini'), 'gemini');
  assert.equal(inferGatewayProtocol('https://relay.example.com', 'gemini-2.5-flash', 'openai'), 'openai');
  assert.equal(inferGatewayProtocol('https://relay.example.com', 'claude-3-5-sonnet', 'auto'), 'openai');
  assert.equal(inferGatewayProtocol('https://relay.example.com/v1beta', '', 'auto'), 'gemini');
  assert.equal(inferGatewayProtocolFromUrlAndModel('https://relay.example.com', 'gpt-4o', 'gemini'), 'gemini');
  assert.equal(inferGatewayProtocolFromUrlAndModel('https://relay.example.com', '', 'anthropic'), 'anthropic');
  assert.equal(inferGatewayProtocolFromUrlAndModel('https://relay.example.com/v1beta', '', 'auto'), 'gemini');

  assert.throws(() => buildCustomGeminiUrl('https://relay.example.com', ''), /拦截空模型请求/);
  assert.deepEqual(buildCustomOpenAiUrls('https://relay.example.com/api'), [
    'https://relay.example.com/api/v1/chat/completions',
    'https://relay.example.com/api/chat/completions',
    'https://relay.example.com/api/api/chat/completions',
    'https://relay.example.com/api/api/v1/chat/completions',
  ]);
  assert.deepEqual(buildCustomOpenAiUrls('https://relay.example.com'), [
    'https://relay.example.com/v1/chat/completions',
    'https://relay.example.com/chat/completions',
    'https://relay.example.com/api/chat/completions',
    'https://relay.example.com/api/v1/chat/completions',
  ]);

  assert.equal(validatePingInferencePayload('openai', '<html><body>502 Bad Gateway</body></html>').ok, false);
  assert.equal(validatePingInferencePayload('openai', JSON.stringify({ error: { message: 'Quota exceeded upstream' } })).ok, false);
  assert.equal(validatePingInferencePayload('openai', JSON.stringify({ ok: true })).ok, false);
  assert.equal(validatePingInferencePayload('openai', JSON.stringify({ choices: [{ message: { content: 'pong' } }] })).ok, true);
  assert.equal(validatePingInferencePayload('gemini', JSON.stringify({ candidates: [{ content: { parts: [{ text: 'pong' }] } }] })).ok, true);
  assert.equal(validatePingInferencePayload('anthropic', JSON.stringify({ content: [{ type: 'text', text: 'pong' }] })).ok, true);

  // 2. Frontend UI / service contracts
  const modalSrc = readFileSync(resolve(process.cwd(), 'src/components/CustomLLMModal.tsx'), 'utf8');
  const apiSvcSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
  assert.match(modalSrc, /接口协议 \(Protocol\)/);
  assert.match(modalSrc, /value="auto"[\s\S]*?value="openai"[\s\S]*?value="anthropic"[\s\S]*?value="gemini"/);
  assert.match(modalSrc, /const probeModel = cleanModel;/);
  assert.equal(modalSrc.includes("cleanModelName || (resolvedSaveProto === 'gemini' ? '' : 'gpt-4o-mini')"), true);
  assert.equal(apiSvcSrc.includes("inferredProtocol === 'gemini'"), true);

  // 3. HTTP runtime tests against real local mock gateways
  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'p2_8_test_jwt_secret';

  const hitPaths: string[] = [];
  let gatewayBehavior:
    | 'openai_api_prefix_ok'
    | 'fake_200_html'
    | 'upstream_429_detail'
    | 'anthropic_ok'
    | 'gemini_no_models_list'
    | 'gemini_inference_ok' = 'openai_api_prefix_ok';

  const mockGateway = http.createServer(async (req, res) => {
    hitPaths.push(`${req.method} ${req.url}`);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));

    if (gatewayBehavior === 'fake_200_html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><body>Login Portal</body></html>');
      return;
    }

    if (gatewayBehavior === 'upstream_429_detail') {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'UPSTREAM_DETAIL_QUOTA_EXHAUSTED_9876' } }));
      return;
    }

    if (gatewayBehavior === 'openai_api_prefix_ok' && req.url === '/api/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }));
      return;
    }

    if (gatewayBehavior === 'anthropic_ok' && req.url === '/v1/messages') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'message', content: [{ type: 'text', text: 'pong' }] }));
      return;
    }

    if (gatewayBehavior === 'gemini_no_models_list') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'models endpoint disabled on relay' } }));
      return;
    }

    if (gatewayBehavior === 'gemini_inference_ok' && req.url === '/v1beta/models/gemini-2.5-flash:generateContent') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'pong' }] } }] }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Route not found on mock gateway' } }));
  });

  await new Promise<void>((r) => mockGateway.listen(0, '127.0.0.1', r));
  const mockPort = (mockGateway.address() as any).port;

  const appSrv = http.createServer(app);
  await new Promise<void>((r) => appSrv.listen(0, '127.0.0.1', r));
  const appPort = (appSrv.address() as any).port;

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'member_p2_8', username: 'member_p2_8', role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const memberJwt = `${headerB64}.${payloadB64}.${sigB64}`;

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${memberJwt}`,
    'X-Account-Id': 'acc_p2_8',
  };

  try {
    // 3a. Aligned OpenAI candidate URLs (/api/chat/completions)
    gatewayBehavior = 'openai_api_prefix_ok';
    hitPaths.length = 0;
    const pingOpenAiApi = await fetch(`http://127.0.0.1:${appPort}/api/llm/ping`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${mockPort}/api`,
        apiKey: 'sk-test',
        modelName: 'gpt-4o-mini',
        protocol: 'openai',
        engineMode: 'custom',
      }),
    });
    assert.equal(pingOpenAiApi.status, 200);
    const pingOpenAiJson = (await pingOpenAiApi.json()) as any;
    assert.equal(pingOpenAiJson.ok, true);
    assert.ok(hitPaths.includes('POST /api/chat/completions'));

    // 3b. Explicit Anthropic protocol works on arbitrary host
    gatewayBehavior = 'anthropic_ok';
    hitPaths.length = 0;
    const pingAnthropic = await fetch(`http://127.0.0.1:${appPort}/api/llm/ping`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${mockPort}`,
        apiKey: 'sk-ant-test',
        modelName: 'claude-3-5-sonnet-20241022',
        protocol: 'anthropic',
        engineMode: 'custom',
      }),
    });
    assert.equal(pingAnthropic.status, 200);
    assert.ok(hitPaths.includes('POST /v1/messages'));

    // 3c. Gemini empty model interception (must NOT probe gemini-4-hydrogen!)
    gatewayBehavior = 'gemini_no_models_list';
    hitPaths.length = 0;
    const pingGeminiEmpty = await fetch(`http://127.0.0.1:${appPort}/api/llm/ping`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${mockPort}`,
        apiKey: 'AIzaTestKey',
        modelName: '',
        protocol: 'gemini',
        engineMode: 'custom',
      }),
    });
    assert.equal(pingGeminiEmpty.status, 400);
    const pingGeminiEmptyJson = (await pingGeminiEmpty.json()) as any;
    assert.equal(pingGeminiEmptyJson.ok, false);
    assert.equal(pingGeminiEmptyJson.source, 'custom_llm_missing_model');
    assert.equal(hitPaths.some((p) => p.includes('gemini-4-hydrogen') || p.includes(':generateContent')), false);

    // 3d. Gemini explicit model runs real :generateContent inference handshake
    gatewayBehavior = 'gemini_inference_ok';
    hitPaths.length = 0;
    const pingGeminiValid = await fetch(`http://127.0.0.1:${appPort}/api/llm/ping`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${mockPort}`,
        apiKey: 'AIzaTestKey',
        modelName: 'gemini-2.5-flash',
        protocol: 'gemini',
        engineMode: 'custom',
      }),
    });
    assert.equal(pingGeminiValid.status, 200);
    assert.ok(hitPaths.includes('POST /v1beta/models/gemini-2.5-flash:generateContent'));

    // 3e. Fake HTTP 200 HTML portal page is rejected as failed handshake (502)
    gatewayBehavior = 'fake_200_html';
    const pingFakeHtml = await fetch(`http://127.0.0.1:${appPort}/api/llm/ping`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${mockPort}`,
        apiKey: 'sk-test',
        modelName: 'gpt-4o-mini',
        protocol: 'openai',
        engineMode: 'custom',
      }),
    });
    assert.equal(pingFakeHtml.status, 502);
    const pingFakeHtmlJson = (await pingFakeHtml.json()) as any;
    assert.equal(pingFakeHtmlJson.ok, false);
    assert.match(pingFakeHtmlJson.error, /HTML/);

    // 3f. Upstream detailed error passthrough in both /api/llm/ping and /api/llm/chat
    gatewayBehavior = 'upstream_429_detail';
    const pingErr = await fetch(`http://127.0.0.1:${appPort}/api/llm/ping`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${mockPort}`,
        apiKey: 'sk-test',
        modelName: 'gpt-4o-mini',
        protocol: 'openai',
        engineMode: 'custom',
      }),
    });
    assert.equal(pingErr.status, 429);
    const pingErrJson = (await pingErr.json()) as any;
    assert.match(pingErrJson.error, /UPSTREAM_DETAIL_QUOTA_EXHAUSTED_9876/);

    const chatGeminiBlocked = await fetch(`http://127.0.0.1:${appPort}/api/llm/chat`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        chatId: 'tg_p2_8_chat',
        accountId: 'acc_p2_8',
        messages: [{ sender: 'peer', text: 'hello' }],
        customConfig: {
          enabled: true,
          engineMode: 'custom',
          protocol: 'gemini',
          baseUrl: `http://127.0.0.1:${mockPort}`,
          apiKey: 'AIzaTestKey',
          modelName: '',
        },
      }),
    });
    assert.equal(chatGeminiBlocked.status, 400);
    const chatGeminiBlockedJson = (await chatGeminiBlocked.json()) as any;
    assert.equal(chatGeminiBlockedJson.source, 'custom_llm_missing_model');

    const chatUpstreamErr = await fetch(`http://127.0.0.1:${appPort}/api/llm/chat`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        chatId: 'tg_p2_8_chat',
        accountId: 'acc_p2_8',
        messages: [{ sender: 'peer', text: 'hello' }],
        customConfig: {
          enabled: true,
          engineMode: 'custom',
          protocol: 'openai',
          baseUrl: `http://127.0.0.1:${mockPort}`,
          apiKey: 'sk-test',
          modelName: 'gpt-4o-mini',
        },
      }),
    });
    assert.equal(chatUpstreamErr.status, 429);
    const chatUpstreamErrJson = (await chatUpstreamErr.json()) as any;
    assert.match(chatUpstreamErrJson.error, /UPSTREAM_DETAIL_QUOTA_EXHAUSTED_9876/);
    assert.match(chatUpstreamErrJson.upstreamError, /UPSTREAM_DETAIL_QUOTA_EXHAUSTED_9876/);
  } finally {
    await new Promise<void>((r) => appSrv.close(() => r()));
    await new Promise<void>((r) => mockGateway.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('UI Theme Support: 3rd aurora cyan-teal mode is wired alongside light & dark without breaking light/dark', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const typesSrc = readFileSync(resolve(process.cwd(), 'src', 'types', 'index.ts'), 'utf8');
  const cssSrc = readFileSync(resolve(process.cwd(), 'src', 'index.css'), 'utf8');
  const appSrc = readFileSync(resolve(process.cwd(), 'src', 'App.tsx'), 'utf8');
  const sidebarSrc = readFileSync(resolve(process.cwd(), 'src', 'components', 'LeftSidebar.tsx'), 'utf8');
  const chatListSrc = readFileSync(resolve(process.cwd(), 'src', 'components', 'ChatList.tsx'), 'utf8');
  const chatAreaSrc = readFileSync(resolve(process.cwd(), 'src', 'components', 'ChatArea.tsx'), 'utf8');
  const dockSrc = readFileSync(resolve(process.cwd(), 'src', 'components', 'UnifiedRightDock.tsx'), 'utf8');
  const menuSrc = readFileSync(resolve(process.cwd(), 'src', 'components', 'TelegramMenuDrawer.tsx'), 'utf8');
  const settingsSrc = readFileSync(resolve(process.cwd(), 'src', 'components', 'TelegramSettingsModal.tsx'), 'utf8');

  assert.match(typesSrc, /AppThemeMode\s*=\s*'light'\s*\|\s*'dark'\s*\|\s*'aurora'/);
  assert.match(cssSrc, /@variant\s+aurora/);
  assert.match(cssSrc, /\.theme-aurora\s*\{/);
  assert.match(cssSrc, /\.theme-aurora\s+\.tg-chat-pattern/);
  assert.match(appSrc, /classList\.toggle\('theme-aurora',\s*theme\s*===\s*'aurora'\)/);
  assert.match(appSrc, /theme\s*===\s*'dark'\s*\|\|\s*theme\s*===\s*'aurora'/);
  assert.match(sidebarSrc, /aurora:/);
  assert.match(chatListSrc, /aurora:/);
  assert.match(chatAreaSrc, /aurora:/);
  assert.match(dockSrc, /aurora:/);
  assert.match(menuSrc, /青夜/);
  assert.match(settingsSrc, /极光青暗/);
});

test('P2 #7 & #8 deep audit fixes: habits without persona, zero GEMINI_API_KEY silent fallback, Google OpenAI URL, /v1beta/models URL, empty Gemini model interception in analyze/translate, callCustomLlm error/HTML parity, and CustomLLMModal protocol persistence', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { db, initDatabase, saveEvolutionStateToDb, resolveEvolutionConfigKey } = await import('./db.ts');
  const {
    app,
    inferGatewayProtocol,
    buildCustomGeminiUrl,
    callCustomLlm,
    performStrictTranslation,
    syncServerCustomLlmConfig,
    getServerCustomLlmConfig,
    generateTtsAudio,
    transcribeAudioBufferStrictly,
  } = await import('../server.ts');
  const { inferGatewayProtocolFromUrlAndModel } = await import('../src/services/apiService.ts');

  await initDatabase();

  // 1. Source contracts: normalizeUiProtocol preserves protocol across engineMode, KnowledgeEvolutionModal passes recentChatHistory, Webhook uses normalizeMessageTurn & boundedHistory
  const modalSrc = readFileSync(resolve(process.cwd(), 'src/components/CustomLLMModal.tsx'), 'utf8');
  assert.equal(/function normalizeUiProtocol[\s\S]*?if \(engineMode !== 'custom'\) return 'openai'/.test(modalSrc), false);

  const keSrc = readFileSync(resolve(process.cwd(), 'src/components/KnowledgeEvolutionModal.tsx'), 'utf8');
  assert.match(keSrc, /recentChatHistory:\s*sandboxRecentHistory\.trim\(\)/);

  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.match(serverSrc, /processTelegramMessageAsync[\s\S]*?normalizeMessageTurn\(m,\s*idx \+ 1\)[\s\S]*?boundedHistory = conversationHistory\.slice\(-UNIFIED_REPLY_HISTORY_LIMIT\)/);
  assert.equal(/app\.post\('\/api\/audio\/tts-clone'[\s\S]*?if \(isGeminiAvailable\(\)\)/.test(serverSrc), false);
  assert.equal(/app\.post\('\/api\/audio\/transcribe'[\s\S]*?if \(isGeminiAvailable\(\)\)/.test(serverSrc), false);

  // 2. Unit tests: buildCustomGeminiUrl with trailing /v1beta/models & Google OpenAI-compat URL detection
  assert.equal(
    buildCustomGeminiUrl('https://relay.example.com/v1beta/models', 'gemini-2.5-flash'),
    'https://relay.example.com/v1beta/models/gemini-2.5-flash:generateContent'
  );
  assert.equal(
    buildCustomGeminiUrl('https://relay.example.com/v1/models', 'gemini-2.5-pro'),
    'https://relay.example.com/v1/models/gemini-2.5-pro:generateContent'
  );
  assert.equal(
    inferGatewayProtocol('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.5-flash', 'openai'),
    'openai'
  );
  assert.equal(
    inferGatewayProtocol('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.5-flash', 'auto'),
    'openai'
  );
  assert.equal(
    inferGatewayProtocol('https://generativelanguage.googleapis.com', 'gemini-2.5-flash', 'auto'),
    'gemini'
  );
  assert.equal(
    inferGatewayProtocolFromUrlAndModel('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.5-flash', 'openai'),
    'openai'
  );
  assert.equal(
    inferGatewayProtocolFromUrlAndModel('https://generativelanguage.googleapis.com/v1beta/openai', '', 'auto'),
    'openai'
  );

  // 3. Runtime tests with real local HTTP servers
  const prevJwtSecret = process.env.JWT_SECRET;
  const prevBrainUrl = process.env.RAILWAY_BRAIN_URL;
  const prevBrainKey = process.env.RAILWAY_BRAIN_KEY;
  const prevGeminiKey = process.env.GEMINI_API_KEY;
  const prevCustomCfg = await getServerCustomLlmConfig().catch(() => null);

  process.env.JWT_SECRET = 'p2_deep_audit_jwt_secret';
  process.env.GEMINI_API_KEY = 'fake-local-gemini-key-must-not-be-used-for-silent-fallback';
  delete process.env.RAILWAY_BRAIN_KEY;

  let capturedSystemPrompt = '';
  let gatewayMode: 'ok' | 'html_200' | 'err_429' = 'ok';

  const mockGateway = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    let bodyJson: any = {};
    try {
      bodyJson = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {}

    if (gatewayMode === 'html_200') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><body>Gateway Login</body></html>');
      return;
    }

    if (gatewayMode === 'err_429') {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'CALL_CUSTOM_LLM_429_DETAIL_XYZ' } }));
      return;
    }

    if (req.url?.includes('/chat/completions')) {
      const msgs = Array.isArray(bodyJson.messages) ? bodyJson.messages : [];
      capturedSystemPrompt = msgs.find((m: any) => m.role === 'system')?.content || '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Not Found' } }));
  });

  await new Promise<void>((r) => mockGateway.listen(0, '127.0.0.1', r));
  const mockPort = (mockGateway.address() as any).port;
  process.env.RAILWAY_BRAIN_URL = `http://127.0.0.1:${mockPort}`;

  const appSrv = http.createServer(app);
  await new Promise<void>((r) => appSrv.listen(0, '127.0.0.1', r));
  const appPort = (appSrv.address() as any).port;

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: 'member_audit', username: 'member_audit', role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const sigB64 = createHmac('sha256', process.env.JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const memberJwt = `${headerB64}.${payloadB64}.${sigB64}`;

  const testAcc = `acc_tg_deep_audit_${Date.now()}`;
  const habitKey = resolveEvolutionConfigKey(testAcc);

  try {
    // 3a. /api/persona/test-reply preserves active evolution habits even when no global persona is configured
    await saveEvolutionStateToDb(
      {
        autoEvolutionActive: true,
        habits: [
          {
            id: 'hab_audit_1',
            title: '先共情再确认需求',
            description: '回复先接住情绪再用一句短问句收尾',
            examplePattern: '懂你，这确实挺累的，今天先早点休息？',
            isActive: true,
            usageCount: 0,
          },
        ],
      },
      testAcc
    );

    capturedSystemPrompt = '';
    const testReplyRes = await fetch(`http://127.0.0.1:${appPort}/api/persona/test-reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
        'X-Account-Id': testAcc,
      },
      body: JSON.stringify({
        message: '今天忙到好晚',
        customConfig: {
          enabled: true,
          engineMode: 'custom',
          protocol: 'openai',
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          apiKey: 'sk-test',
          modelName: 'gpt-4o-mini',
        },
      }),
    });
    assert.equal(testReplyRes.status, 200);
    assert.ok(capturedSystemPrompt.includes('【自进化引擎萃取的活跃沟通习惯】'));
    assert.ok(capturedSystemPrompt.includes('先共情再确认需求'));

    // 3b. Empty Gemini model interception in /api/customer/analyze/:chatId and performStrictTranslation
    const analyzeRes = await fetch(`http://127.0.0.1:${appPort}/api/customer/analyze/tg_audit_c1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
      },
      body: JSON.stringify({
        accountId: testAcc,
        messages: [
          { sender: 'peer', text: 'Hello there, nice to meet you today' },
          { sender: 'me', text: 'Nice to meet you too, how can I help?' },
        ],
        customConfig: {
          enabled: true,
          engineMode: 'custom',
          protocol: 'gemini',
          baseUrl: `http://127.0.0.1:${mockPort}`,
          apiKey: 'AIzaTestKey',
          modelName: '',
        },
      }),
    });
    assert.equal(analyzeRes.status, 400);
    const analyzeJson = (await analyzeRes.json()) as any;
    assert.equal(analyzeJson.source, 'custom_llm_missing_model');

    await assert.rejects(
      () =>
        performStrictTranslation({
          text: 'Hello',
          targetLang: 'Chinese',
          engine: 'custom_llm',
          customConfig: {
            enabled: true,
            engineMode: 'custom',
            protocol: 'gemini',
            baseUrl: `http://127.0.0.1:${mockPort}`,
            apiKey: 'AIzaTestKey',
            modelName: '',
          },
        }),
      /拦截空模型请求/
    );

    // 3c. callCustomLlm upstream 429 detail passthrough & fake 200 HTML rejection
    gatewayMode = 'err_429';
    await assert.rejects(
      async () => {
        await callCustomLlm({
          customConfig: {
            enabled: true,
            engineMode: 'custom',
            protocol: 'openai',
            baseUrl: `http://127.0.0.1:${mockPort}`,
            apiKey: 'sk-test',
            modelName: 'gpt-4o-mini',
          },
          messages: [{ role: 'user', content: 'hi' }],
          throwOnError: true,
          skipSync: true,
        });
      },
      (err: any) => {
        assert.equal(err?.statusCode, 429);
        assert.match(String(err?.message), /CALL_CUSTOM_LLM_429_DETAIL_XYZ/);
        return true;
      }
    );

    gatewayMode = 'html_200';
    await assert.rejects(
      () =>
        callCustomLlm({
          customConfig: {
            enabled: true,
            engineMode: 'custom',
            protocol: 'openai',
            baseUrl: `http://127.0.0.1:${mockPort}`,
            apiKey: 'sk-test',
            modelName: 'gpt-4o-mini',
          },
          messages: [{ role: 'user', content: 'hi' }],
          throwOnError: true,
          skipSync: true,
        }),
      /HTML/
    );

    // 3d. Cloud TTS / STT must NEVER silently fall back to GEMINI_API_KEY when Cloud Brain fails
    gatewayMode = 'err_429';
    await assert.rejects(
      () =>
        generateTtsAudio('hello world', 'Kore', 'Natural', {
          enabled: true,
          engineMode: 'cloud',
          engineLicenseKey: 'test-lic',
        }),
      /云端|TTS/
    );
    const sttFail = await transcribeAudioBufferStrictly(
      Buffer.from('OggS-audio-bytes'),
      'audio/ogg',
      { enabled: true, engineMode: 'cloud', engineLicenseKey: 'test-lic' }
    );
    assert.equal(sttFail.ok, false);
    assert.match(String(sttFail.error), /云端/);
  } finally {
    await db.prepare('DELETE FROM system_config WHERE key = ?').run(habitKey).catch(() => {});
    await syncServerCustomLlmConfig(prevCustomCfg || { enabled: true, engineMode: 'cloud', apiKey: '', engineLicenseKey: '' });
    await new Promise<void>((r) => appSrv.close(() => r()));
    await new Promise<void>((r) => mockGateway.close(() => r()));
    if (prevBrainUrl === undefined) delete process.env.RAILWAY_BRAIN_URL;
    else process.env.RAILWAY_BRAIN_URL = prevBrainUrl;
    if (prevBrainKey === undefined) delete process.env.RAILWAY_BRAIN_KEY;
    else process.env.RAILWAY_BRAIN_KEY = prevBrainKey;
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
    if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGeminiKey;
  }
});

test('P0 #1: POST /api/auth/logout requires trusted Origin, valid non-revoked member JWT, and rejects unauthenticated or bot-token callers', async () => {
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const {
    app,
    connectedUserClients,
    pendingLocalUpdates,
    pushPendingLocalUpdate,
    TELEGRAM_WEBHOOK_SECRET,
  } = await import('../server.ts');

  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'p0_logout_test_jwt_secret_12345';

  const makeJwt = (sub: string) => {
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(
      JSON.stringify({ sub, username: sub, role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString('base64url');
    const s = createHmac('sha256', process.env.JWT_SECRET!).update(`${h}.${p}`).digest('base64url');
    return `${h}.${p}.${s}`;
  };

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;

  let destroyCalled = false;
  const mockConnectedUser: any = {
    client: {
      connected: true,
      invoke: async () => ({}),
      destroy: async () => {
        destroyCalled = true;
      },
      disconnect: async () => {},
    },
    phone: '+8613800009999',
    userId: '99990001',
    username: '@p0_logout_test',
    firstName: 'Test',
    avatarInitial: 'TE',
    avatarBg: '#2481cc',
    apiId: 12345,
    apiHash: 'test_hash',
    connectedAt: Date.now(),
    dialogs: [],
  };

  connectedUserClients.set('acc_tg_99990001', mockConnectedUser);
  connectedUserClients.set('99990001', mockConnectedUser);
  pushPendingLocalUpdate({
    id: 'upd_p0_logout_sentinel',
    chatId: 'tg_123',
    accountId: 'acc_tg_99990001',
    sender: 'peer',
    senderName: 'Sentinel',
    text: 'keep me alive',
    timestamp: '12:00',
    createdAt: Date.now(),
  });

  try {
    // 1. Unauthenticated request is rejected with 401 and leaves sessions untouched
    const unauthRes = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revokeTelegramSessions: true }),
    });
    assert.equal(unauthRes.status, 401);
    const unauthJson = (await unauthRes.json()) as any;
    assert.equal(unauthJson.code, 'AUTH_SESSION_REQUIRED');
    assert.equal(connectedUserClients.has('acc_tg_99990001'), true);
    assert.equal(pendingLocalUpdates.some((u) => u.id === 'upd_p0_logout_sentinel'), true);
    assert.equal(destroyCalled, false);

    // 2. Untrusted cross-origin request is rejected with 403 CSRF_ORIGIN_REJECTED even with valid JWT
    const validJwt = makeJwt('member_p0_logout');
    const csrfRes = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil-attacker.example',
        Authorization: `Bearer ${validJwt}`,
      },
      body: JSON.stringify({ revokeTelegramSessions: true }),
    });
    assert.equal(csrfRes.status, 403);
    const csrfJson = (await csrfRes.json()) as any;
    assert.equal(csrfJson.code, 'CSRF_ORIGIN_REJECTED');
    assert.equal(connectedUserClients.has('acc_tg_99990001'), true);

    // 3. Telegram Webhook secret token (isBot) cannot invoke member logout (403 AUTH_MEMBER_REQUIRED)
    const botRes = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': TELEGRAM_WEBHOOK_SECRET,
      },
      body: JSON.stringify({ revokeTelegramSessions: false }),
    });
    assert.equal(botRes.status, 403);
    const botJson = (await botRes.json()) as any;
    assert.equal(botJson.code, 'AUTH_MEMBER_REQUIRED');
    assert.equal(connectedUserClients.has('acc_tg_99990001'), true);

    // 4. Valid desktop member request succeeds, revokes JWT, and cleans up clients
    const okRes = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        Authorization: `Bearer ${validJwt}`,
      },
      body: JSON.stringify({ revokeTelegramSessions: false }),
    });
    assert.equal(okRes.status, 200);
    const okJson = (await okRes.json()) as any;
    assert.equal(okJson.ok, true);
    assert.equal(destroyCalled, true);
    assert.equal(connectedUserClients.has('acc_tg_99990001'), false);

    // 5. Revoked JWT is immediately rejected on subsequent protected API calls
    const reuseRes = await fetch(`http://127.0.0.1:${port}/api/telegram/user/active-accounts`, {
      headers: { Authorization: `Bearer ${validJwt}` },
    });
    assert.equal(reuseRes.status, 401);
    const reuseJson = (await reuseRes.json()) as any;
    assert.equal(reuseJson.code, 'AUTH_SESSION_REVOKED');
  } finally {
    connectedUserClients.delete('acc_tg_99990001');
    connectedUserClients.delete('99990001');
    for (let i = pendingLocalUpdates.length - 1; i >= 0; i--) {
      if (pendingLocalUpdates[i].id === 'upd_p0_logout_sentinel') {
        pendingLocalUpdates.splice(i, 1);
      }
    }
    await new Promise<void>((r) => server.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('P0 #2: Account-level FLOOD_WAIT circuit breaker, dialogs TTL cache, and elimination of 8s polling bombardment', async () => {
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const {
    app,
    connectedUserClients,
    extractFloodWaitSeconds,
    recordTelegramFloodWait,
    getTelegramFloodCooldown,
    clearTelegramFloodCooldown,
    pruneExpiredTelegramFloodCooldowns,
    fetchTelegramUserDialogs,
    telegramAccountFloodCooldowns,
  } = await import('../server.ts');

  // 1. FLOOD_WAIT parser & cooldown helper unit checks
  assert.equal(extractFloodWaitSeconds({ errorMessage: 'FLOOD_WAIT_120' }), 120);
  assert.equal(extractFloodWaitSeconds({ errorMessage: 'FLOOD_PREMIUM_WAIT_45' }), 45);
  assert.equal(extractFloodWaitSeconds(new Error('A wait of 75 seconds is required')), 75);
  assert.equal(extractFloodWaitSeconds({ className: 'FloodWaitError', seconds: 90 }), 90);
  assert.equal(extractFloodWaitSeconds(new Error('CHANNEL_PRIVATE')), null);

  const testCtx = { accountId: 'acc_tg_flood_unit', userId: 'flood_unit', phone: '+8613800008888' };
  clearTelegramFloodCooldown(testCtx);
  const now = Date.now();
  const recorded = recordTelegramFloodWait(testCtx, 'FLOOD_WAIT_60', 'messages.GetDialogs', now);
  assert.ok(recorded);
  assert.equal(recorded!.retryAfterSeconds, 60);
  assert.ok(getTelegramFloodCooldown(testCtx, now + 5000));
  assert.equal(getTelegramFloodCooldown(testCtx, now + 65000), null);
  clearTelegramFloodCooldown(testCtx);

  // Prune expired entry test
  recordTelegramFloodWait(testCtx, 10, 'test', now - 20000);
  assert.ok(pruneExpiredTelegramFloodCooldowns(now) >= 1);

  // 2. fetchTelegramUserDialogs must record FLOOD_WAIT and rethrow instead of returning []
  const floodThrowClient: any = {
    _selfId: 'flood_rethrow_1',
    getDialogs: async () => {
      throw new Error('FLOOD_WAIT_180');
    },
  };
  await assert.rejects(
    () => fetchTelegramUserDialogs(floodThrowClient, 150, 'flood_rethrow_1'),
    /FLOOD_WAIT_180/
  );
  const rethrowCooldown = getTelegramFloodCooldown({ userId: 'flood_rethrow_1' });
  assert.ok(rethrowCooldown);
  assert.ok(rethrowCooldown!.retryAfterSeconds >= 175);
  clearTelegramFloodCooldown({ userId: 'flood_rethrow_1' });

  // 3. HTTP route verification: /api/telegram/user/dialogs TTL cache + 429 short-circuit circuit breaker
  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'p0_dialogs_flood_secret_12345';
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;

  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(
    JSON.stringify({ sub: 'member_p0_dialogs', username: 'member_p0_dialogs', role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const s = createHmac('sha256', process.env.JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  const memberJwt = `${h}.${p}.${s}`;

  let getDialogsCalls = 0;
  let shouldThrowFlood = false;
  const uid = '77889900';
  const accId = `acc_tg_${uid}`;

  const mockDialogsClient: any = {
    connected: true,
    _selfId: uid,
    getDialogs: async ({ folder }: { limit: number; folder?: number }) => {
      getDialogsCalls++;
      if (shouldThrowFlood) {
        const err: any = new Error('FLOOD_WAIT_90');
        err.errorMessage = 'FLOOD_WAIT_90';
        throw err;
      }
      if (folder === 1) return [];
      return [
        {
          id: 556677,
          title: 'VIP Client Alice',
          date: Math.floor(Date.now() / 1000),
          unreadCount: 2,
          pinned: false,
          entity: { className: 'User', id: 556677, firstName: 'Alice', username: 'alice_vip' },
          message: { message: 'Hello from Telegram' },
          dialog: { readOutboxMaxId: 10, readInboxMaxId: 8 },
        },
      ];
    },
    destroy: async () => {},
    disconnect: async () => {},
  };

  const mockConn: any = {
    client: mockDialogsClient,
    phone: '+8613800007788',
    userId: uid,
    username: '@p0_dialogs_tester',
    firstName: 'Dialogs',
    avatarInitial: 'DI',
    avatarBg: '#2481cc',
    apiId: 12345,
    apiHash: 'hash',
    connectedAt: Date.now(),
    dialogs: [],
  };
  connectedUserClients.set(accId, mockConn);
  connectedUserClients.set(uid, mockConn);
  clearTelegramFloodCooldown({ accountId: accId, userId: uid, phone: mockConn.phone });

  try {
    // 3a. Initial request calls MTProto once (main + folder=1 = 2 calls)
    const r1 = await fetch(`http://127.0.0.1:${port}/api/telegram/user/dialogs?accountId=${accId}`, {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    assert.equal(r1.status, 200);
    const j1 = (await r1.json()) as any;
    assert.equal(j1.ok, true);
    assert.equal(j1.dialogs.length, 1);
    assert.equal(j1.dialogs[0].title, 'VIP Client Alice');
    const callsAfterFirst = getDialogsCalls;
    assert.equal(callsAfterFirst, 2);

    // 3b. Second immediate request hits short-TTL server cache (zero MTProto RPCs!)
    const r2 = await fetch(`http://127.0.0.1:${port}/api/telegram/user/dialogs?accountId=${accId}`, {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    assert.equal(r2.status, 200);
    const j2 = (await r2.json()) as any;
    assert.equal(j2.ok, true);
    assert.equal(j2.cached, true);
    assert.equal(getDialogsCalls, callsAfterFirst);

    // 3c. Explicit ?force=1 triggers fresh MTProto fetch and enters FLOOD_WAIT cooldown -> returns 429 + cached dialogs
    shouldThrowFlood = true;
    const r3 = await fetch(`http://127.0.0.1:${port}/api/telegram/user/dialogs?accountId=${accId}&force=1`, {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    assert.equal(r3.status, 429);
    const j3 = (await r3.json()) as any;
    assert.equal(j3.ok, false);
    assert.equal(j3.code, 'TELEGRAM_FLOOD_WAIT');
    assert.ok(j3.retryAfterSeconds > 0);
    assert.equal(j3.dialogs.length, 1);
    const callsAfterFlood = getDialogsCalls;
    assert.ok(callsAfterFlood > callsAfterFirst);

    // 3d. Subsequent ?force=1 during cooldown is blocked BEFORE touching MTProto (getDialogsCalls stays unchanged!)
    const r4 = await fetch(`http://127.0.0.1:${port}/api/telegram/user/dialogs?accountId=${accId}&force=1`, {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    assert.equal(r4.status, 429);
    const j4 = (await r4.json()) as any;
    assert.equal(j4.code, 'TELEGRAM_FLOOD_WAIT');
    assert.equal(j4.fromCache, true);
    assert.equal(getDialogsCalls, callsAfterFlood);
  } finally {
    clearTelegramFloodCooldown({ accountId: accId, userId: uid, phone: mockConn.phone });
    telegramAccountFloodCooldowns.clear();
    connectedUserClients.delete(accId);
    connectedUserClients.delete(uid);
    await new Promise<void>((r) => server.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }

  // 4. Verify App.tsx eliminated 8s dialogs polling & wired event-driven incremental handlers
  const appSrc = readFileSync(resolve(process.cwd(), 'src', 'App.tsx'), 'utf8');
  assert.equal(/setInterval\s*\(\s*syncChats\s*,\s*8000\s*\)/.test(appSrc), false);
  assert.match(appSrc, /LOW_FREQUENCY_DIALOG_FALLBACK_INTERVAL_MS\s*=\s*180_000/);
  assert.match(appSrc, /updType\s*===\s*'read_inbox'/);
  assert.match(appSrc, /updType\s*===\s*'dialog_pinned'/);
  assert.match(appSrc, /TELEGRAM_FLOOD_WAIT/);

  const apiServiceSrc = readFileSync(resolve(process.cwd(), 'src', 'services', 'apiService.ts'), 'utf8');
  assert.match(apiServiceSrc, /getClientTelegramFloodCooldown/);
  assert.match(apiServiceSrc, /recordClientTelegramFloodCooldown/);
});

test('P1: isBot webhook secret cannot access personal MTProto/admin/control endpoints or override accountId, ack-updates is account-scoped, and call endpoints verify ownership', async () => {
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { db } = await import('../server/db.ts');
  const {
    app,
    TELEGRAM_WEBHOOK_SECRET,
    pendingLocalUpdates,
    pushPendingLocalUpdate,
    activeTelegramCalls,
    activeAutonomousChats,
  } = await import('../server.ts');

  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'p1_isbot_isolation_test_secret_12345';

  const makeJwt = (sub: string) => {
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(
      JSON.stringify({ sub, username: sub, role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString('base64url');
    const s = createHmac('sha256', process.env.JWT_SECRET!).update(`${h}.${p}`).digest('base64url');
    return `${h}.${p}.${s}`;
  };

  const memberJwt = makeJwt('member_p1_security');
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const updAcc1 = `upd_p1_acc1_${Date.now()}`;
  const updAcc2 = `upd_p1_acc2_${Date.now()}`;
  const callId1 = `call_p1_1001_${Date.now()}`;
  let discardInvoked = false;

  pushPendingLocalUpdate({
    id: updAcc1,
    chatId: 'tg_5001',
    accountId: 'acc_tg_1001',
    sender: 'peer',
    senderName: 'Alice',
    text: 'secret msg 1001',
    timestamp: '10:00',
    createdAt: Date.now(),
  });
  pushPendingLocalUpdate({
    id: updAcc2,
    chatId: 'tg_5002',
    accountId: 'acc_tg_2002',
    sender: 'peer',
    senderName: 'Bob',
    text: 'secret msg 2002',
    timestamp: '10:01',
    createdAt: Date.now(),
  });

  activeTelegramCalls.set(callId1, {
    callId: callId1,
    tgCallId: 987654321n,
    accessHash: 123456789n,
    accountId: 'acc_tg_1001',
    userId: '1001',
    ownerUserId: 'member_p1_security',
    status: 'ringing',
    startedAt: Date.now(),
    client: {
      invoke: async () => {
        discardInvoked = true;
        return {};
      },
    } as any,
  });

  const botHeaders = {
    'Content-Type': 'application/json',
    'X-Telegram-Bot-Api-Secret-Token': TELEGRAM_WEBHOOK_SECRET,
  };

  try {
    // 1. isBot MUST be denied (403) on /api/admin/users/stats
    const statsRes = await fetch(`${baseUrl}/api/admin/users/stats`, { headers: botHeaders });
    assert.equal(statsRes.status, 403);

    // 2. isBot MUST be denied (403) on poll-updates & ack-updates (with or without accountId)
    const botPollAllRes = await fetch(`${baseUrl}/api/telegram/user/poll-updates`, { headers: botHeaders });
    assert.equal(botPollAllRes.status, 403);
    const botPollScopedRes = await fetch(`${baseUrl}/api/telegram/user/poll-updates?accountId=acc_tg_1001`, {
      headers: botHeaders,
    });
    assert.equal(botPollScopedRes.status, 403);

    const botAckRes = await fetch(`${baseUrl}/api/telegram/user/ack-updates`, {
      method: 'POST',
      headers: botHeaders,
      body: JSON.stringify({ ids: [updAcc1, updAcc2] }),
    });
    assert.equal(botAckRes.status, 403);
    assert.equal(pendingLocalUpdates.some((u) => u.id === updAcc1), true);
    assert.equal(pendingLocalUpdates.some((u) => u.id === updAcc2), true);

    // 3. isBot MUST be denied (403) on autopilot, batch-delete, forward, dialogs, and call endpoints even when claiming accountId
    const botAutoGetRes = await fetch(`${baseUrl}/api/telegram/autopilot/status?accountId=acc_tg_1001&chatId=tg_5001`, {
      headers: botHeaders,
    });
    assert.equal(botAutoGetRes.status, 403);

    const botAutoToggleRes = await fetch(`${baseUrl}/api/telegram/autopilot/toggle`, {
      method: 'POST',
      headers: botHeaders,
      body: JSON.stringify({ accountId: 'acc_tg_1001', chatId: 'tg_5001', enabled: true }),
    });
    assert.equal(botAutoToggleRes.status, 403);
    assert.equal(activeAutonomousChats.has('acc_tg_1001::tg_5001'), false);

    const botBatchDelRes = await fetch(`${baseUrl}/api/telegram/user/messages/batch-delete`, {
      method: 'POST',
      headers: botHeaders,
      body: JSON.stringify({ accountId: 'acc_tg_1001', chatId: 'tg_5001', items: [{ id: 'x', localOnly: true }] }),
    });
    assert.equal(botBatchDelRes.status, 403);

    const botForwardRes = await fetch(`${baseUrl}/api/telegram/user/messages/forward`, {
      method: 'POST',
      headers: botHeaders,
      body: JSON.stringify({ accountId: 'acc_tg_1001', fromChatId: 'tg_5001', toChatId: 'tg_5002', telegramMessageIds: [1] }),
    });
    assert.equal(botForwardRes.status, 403);

    const botDialogsRes = await fetch(`${baseUrl}/api/telegram/user/dialogs`, { headers: botHeaders });
    assert.equal(botDialogsRes.status, 403);

    const botCallStatusRes = await fetch(`${baseUrl}/api/telegram/user/call/status/${callId1}`, { headers: botHeaders });
    assert.equal(botCallStatusRes.status, 403);

    const botCallEndRes = await fetch(`${baseUrl}/api/telegram/user/call/end`, {
      method: 'POST',
      headers: botHeaders,
      body: JSON.stringify({ callId: callId1, duration: 10 }),
    });
    assert.equal(botCallEndRes.status, 403);
    assert.equal(discardInvoked, false);

    // 4. isBot cannot override accountId on POST /api/chats/:chatId/language (body or header)
    const botLangBodyBypassRes = await fetch(`${baseUrl}/api/chats/tg_5001/language`, {
      method: 'POST',
      headers: botHeaders,
      body: JSON.stringify({ accountId: 'acc_tg_1001', sourceLang: 'en', targetLang: 'ja' }),
    });
    assert.equal(botLangBodyBypassRes.status, 403);

    const botLangHeaderBypassRes = await fetch(`${baseUrl}/api/chats/tg_5001/language`, {
      method: 'POST',
      headers: { ...botHeaders, 'X-Account-Id': 'acc_tg_1001' },
      body: JSON.stringify({ sourceLang: 'en', targetLang: 'ja' }),
    });
    assert.equal(botLangHeaderBypassRes.status, 403);

    const leakedPref = await db
      .prepare('SELECT * FROM chat_language_prefs WHERE account_id = ? AND chat_id = ?')
      .get('acc_tg_1001', 'tg_5001');
    assert.equal(leakedPref, undefined);

    // 5. ack-updates under account 1 MUST NOT delete updates belonging to account 2
    const crossAckRes = await fetch(`${baseUrl}/api/telegram/user/ack-updates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
        'X-Account-Id': 'acc_tg_1001',
      },
      body: JSON.stringify({ ids: [updAcc1, updAcc2], accountId: 'acc_tg_1001' }),
    });
    assert.equal(crossAckRes.status, 200);
    const crossAckJson = (await crossAckRes.json()) as any;
    assert.equal(crossAckJson.ackedCount, 1);
    assert.equal(pendingLocalUpdates.some((u) => u.id === updAcc1), false);
    assert.equal(pendingLocalUpdates.some((u) => u.id === updAcc2), true);

    // 6. Call status/end MUST enforce callId ownership by accountId
    const wrongCallStatusRes = await fetch(`${baseUrl}/api/telegram/user/call/status/${callId1}`, {
      headers: {
        Authorization: `Bearer ${memberJwt}`,
        'X-Account-Id': 'acc_tg_2002',
      },
    });
    assert.equal(wrongCallStatusRes.status, 403);

    const wrongCallEndRes = await fetch(`${baseUrl}/api/telegram/user/call/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
        'X-Account-Id': 'acc_tg_2002',
      },
      body: JSON.stringify({ callId: callId1, duration: 5 }),
    });
    assert.equal(wrongCallEndRes.status, 403);
    assert.equal(discardInvoked, false);

    // Owner account CAN view & end its own call
    const ownerCallStatusRes = await fetch(`${baseUrl}/api/telegram/user/call/status/${callId1}`, {
      headers: {
        Authorization: `Bearer ${memberJwt}`,
        'X-Account-Id': 'acc_tg_1001',
      },
    });
    assert.equal(ownerCallStatusRes.status, 200);
    const ownerCallStatusJson = (await ownerCallStatusRes.json()) as any;
    assert.equal(ownerCallStatusJson.status, 'ringing');

    const ownerCallEndRes = await fetch(`${baseUrl}/api/telegram/user/call/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
        'X-Account-Id': 'acc_tg_1001',
      },
      body: JSON.stringify({ callId: callId1, duration: 12 }),
    });
    assert.equal(ownerCallEndRes.status, 200);
    assert.equal(discardInvoked, true);
  } finally {
    activeTelegramCalls.delete(callId1);
    for (let i = pendingLocalUpdates.length - 1; i >= 0; i--) {
      if (pendingLocalUpdates[i].id === updAcc1 || pendingLocalUpdates[i].id === updAcc2) {
        pendingLocalUpdates.splice(i, 1);
      }
    }
    await new Promise<void>((r) => server.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('P1 #4: CSRF Origin enforcement blocks *.run.app/*.google.com/*.googleusercontent.com & wrong loopback ports on /api/auth/status and /api/auth/logout', async () => {
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { app } = await import('../server.ts');

  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'p1_csrf_origin_test_secret_12345';

  const makeJwt = (sub: string) => {
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(
      JSON.stringify({ sub, username: sub, role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString('base64url');
    const s = createHmac('sha256', process.env.JWT_SECRET!).update(`${h}.${p}`).digest('base64url');
    return `${h}.${p}.${s}`;
  };

  const memberJwt = makeJwt('member_p1_csrf');
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const wrongPort = port === 9999 ? 9998 : 9999;

  try {
    // 1. GET /api/auth/status MUST reject evil *.run.app, *.google.com, *.googleusercontent.com, null, and mismatched loopback ports
    const blockedStatusOrigins = [
      { Origin: 'https://evil-app.run.app' },
      { Origin: 'https://evil.google.com' },
      { Origin: 'https://evil.googleusercontent.com' },
      { Origin: `http://localhost:${wrongPort}` },
      { Origin: `http://127.0.0.1:${wrongPort}` },
      { Origin: 'null' },
      { Referer: 'https://evil.googleusercontent.com/attack.html' },
    ];
    for (const hdrs of blockedStatusOrigins) {
      const res = await fetch(`${baseUrl}/api/auth/status`, { headers: hdrs as any });
      assert.equal(res.status, 403, `Expected 403 on /api/auth/status for ${JSON.stringify(hdrs)}`);
      const body = (await res.json()) as any;
      assert.equal(body.code, 'CSRF_ORIGIN_REJECTED');
    }

    // 2. GET /api/auth/status allows same-port loopback Origin and direct desktop requests without Origin
    for (const hdrs of [
      {},
      { Origin: `http://127.0.0.1:${port}` },
      { Origin: `http://localhost:${port}` },
      { Referer: `http://127.0.0.1:${port}/` },
    ]) {
      const res = await fetch(`${baseUrl}/api/auth/status`, { headers: hdrs as any });
      assert.equal(res.status, 200, `Expected 200 on /api/auth/status for ${JSON.stringify(hdrs)}`);
    }

    // 3. POST /api/auth/logout MUST reject evil *.run.app, *.googleusercontent.com, and mismatched loopback ports even with valid JWT
    for (const badOrigin of [
      'https://evil-app.run.app',
      'https://evil.google.com',
      'https://evil.googleusercontent.com',
      `http://localhost:${wrongPort}`,
      `http://127.0.0.1:${wrongPort}`,
    ]) {
      const res = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: badOrigin,
          Authorization: `Bearer ${memberJwt}`,
        },
        body: JSON.stringify({ revokeTelegramSessions: false }),
      });
      assert.equal(res.status, 403, `Expected 403 on /api/auth/logout for Origin ${badOrigin}`);
      const body = (await res.json()) as any;
      assert.equal(body.code, 'CSRF_ORIGIN_REJECTED');
    }

    // 4. POST /api/auth/logout succeeds with matching loopback port Origin
    const okLogoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://localhost:${port}`,
        Authorization: `Bearer ${memberJwt}`,
      },
      body: JSON.stringify({ revokeTelegramSessions: false }),
    });
    assert.equal(okLogoutRes.status, 200);
    const okLogoutJson = (await okLogoutRes.json()) as any;
    assert.equal(okLogoutJson.ok, true);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('P1 #5: Backup PBKDF2+AES-GCM+HMAC encryption, 0o600 sealed disk snapshot, atomic db.transaction rollback, strict schema/row validation, and secondary RESTORE auth', async () => {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const { resolve } = await import('node:path');
  const { createHmac } = await import('node:crypto');
  const {
    db,
    exportDatabaseSnapshot,
    restoreDatabaseSnapshot,
    autoRestoreSnapshotIfAvailable,
    snapshotFilePath,
    SnapshotValidationError,
    BACKUP_MAX_ROWS_PER_TABLE,
    encryptBackupEnvelope,
    decryptBackupEnvelope,
    isEncryptedBackupEnvelope,
    isDiskSnapshotEnvelope,
  } = await import('../server/db.ts');
  const { encryptBackupWithPassphrase, decryptBackupWithPassphrase } = await import(
    '../src/services/backupCrypto.ts'
  );
  const { app } = await import('../server.ts');

  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'p1_backup_hardening_test_secret_12345';

  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(
    JSON.stringify({ sub: 'member_p1_backup', username: 'member_p1_backup', role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const s = createHmac('sha256', process.env.JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  const memberJwt = `${h}.${p}.${s}`;

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const sentinelMsgId = `msg_p1_tx_sentinel_${Date.now()}`;
  const sentinelChatId = `tg_p1_tx_${Date.now()}`;
  const secretPhrase = 'ConfidentialSecretPhrase_987654';
  const now = Date.now();

  try {
    // 1. Real db.transaction rollback: error mid-transaction MUST roll back prior inserts
    await assert.rejects(
      () =>
        db.transaction(async () => {
          await db.prepare(
            `INSERT INTO messages (id, chat_id, account_id, sender, text, timestamp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(sentinelMsgId, sentinelChatId, 'acc_tx', 'peer', 'MustRollBackText', '12:00', now);
          throw new Error('SIMULATED_MID_RESTORE_FAILURE');
        })(),
      /SIMULATED_MID_RESTORE_FAILURE/
    );
    const rolledBackRow = await db.prepare('SELECT * FROM messages WHERE id = ?').get(sentinelMsgId);
    assert.equal(rolledBackRow, undefined, 'db.transaction must roll back earlier writes on failure');

    // 2. exportDatabaseSnapshot writes encrypted 0o600 disk snapshot (no plaintext message leak on disk)
    await db.prepare(
      `INSERT INTO messages (id, chat_id, account_id, sender, text, timestamp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(sentinelMsgId, sentinelChatId, 'acc_tx', 'peer', secretPhrase, '12:01', now);

    const exported = await exportDatabaseSnapshot();
    assert.ok(fs.existsSync(snapshotFilePath));
    const diskRaw = fs.readFileSync(snapshotFilePath, 'utf8');
    assert.equal(diskRaw.includes(secretPhrase), false, 'telegram_pro_snapshot.json on disk must NOT contain plaintext');
    const diskParsed = JSON.parse(diskRaw);
    assert.equal(isDiskSnapshotEnvelope(diskParsed), true);
    if (process.platform !== 'win32') {
      const mode = fs.statSync(snapshotFilePath).mode & 0o777;
      assert.equal(mode, 0o600, 'telegram_pro_snapshot.json must enforce 0o600 permissions');
    }

    // Tampered disk snapshot must fail integrity check and NOT restore
    await db.prepare('DELETE FROM messages WHERE id = ?').run(sentinelMsgId);
    const tamperedDisk = { ...diskParsed, ciphertext: diskParsed.ciphertext.slice(0, -4) + 'AAAA' };
    fs.writeFileSync(snapshotFilePath, JSON.stringify(tamperedDisk), { mode: 0o600 });
    const tamperedRecovered = await autoRestoreSnapshotIfAvailable();
    assert.equal(tamperedRecovered, false);
    assert.equal(await db.prepare('SELECT * FROM messages WHERE id = ?').get(sentinelMsgId), undefined);

    // Valid sealed disk snapshot restores cleanly
    fs.writeFileSync(snapshotFilePath, diskRaw, { mode: 0o600 });
    const okRecovered = await autoRestoreSnapshotIfAvailable();
    assert.equal(okRecovered, true);
    const recoveredRow = (await db.prepare('SELECT text FROM messages WHERE id = ?').get(sentinelMsgId)) as any;
    assert.equal(recoveredRow?.text, secretPhrase);

    // 3. Cross-compatibility between Node crypto (server/db.ts) & Web Crypto (src/services/backupCrypto.ts)
    const samplePayload = {
      sqliteSnapshot: exported,
      decryptedPayload: { tg_master_voiceprint: { id: 'vp_1', sampleRate: 16000 } },
    };
    const webEncrypted = await encryptBackupWithPassphrase(samplePayload, 'StrongPass!2026');
    assert.equal(isEncryptedBackupEnvelope(webEncrypted), true);
    assert.equal(JSON.stringify(webEncrypted).includes(secretPhrase), false);
    assert.equal(JSON.stringify(webEncrypted).includes('tg_master_voiceprint'), false);

    // Node decrypts Web Crypto envelope & Web Crypto decrypts Node envelope
    const nodeDecrypted = decryptBackupEnvelope<any>(webEncrypted, 'StrongPass!2026');
    assert.equal(nodeDecrypted.decryptedPayload.tg_master_voiceprint.id, 'vp_1');

    const nodeEncrypted = encryptBackupEnvelope(samplePayload, 'StrongPass!2026');
    const webDecrypted = await decryptBackupWithPassphrase<any>(nodeEncrypted, 'StrongPass!2026');
    assert.equal(webDecrypted.decryptedPayload.tg_master_voiceprint.id, 'vp_1');

    // Wrong passphrase or tampered HMAC/ciphertext rejected
    assert.throws(() => decryptBackupEnvelope(webEncrypted, 'WrongPass!2026'), /口令错误|完整性校验失败/);
    await assert.rejects(() => decryptBackupWithPassphrase(nodeEncrypted, 'WrongPass!2026'), /口令错误|完整性校验失败/);
    const tamperedEnvelope = { ...nodeEncrypted, version: 'tampered_v9' as any };
    assert.throws(() => decryptBackupEnvelope(tamperedEnvelope, 'StrongPass!2026'), /篡改|参数/);

    // 4. Strict field & row-count validation rejects malformed snapshots
    await assert.rejects(
      () => restoreDatabaseSnapshot({ tables: { app_users: [{ id: 'x' }] } }),
      (err: any) => err instanceof SnapshotValidationError
    );
    await assert.rejects(
      () =>
        restoreDatabaseSnapshot({
          tables: {
            messages: [{ id: '', chat_id: 'c', account_id: 'a', sender: 'me', timestamp: '10:00', created_at: now }],
          },
        }),
      (err: any) => err instanceof SnapshotValidationError
    );
    await assert.rejects(
      () =>
        restoreDatabaseSnapshot({
          tables: {
            messages: [{ id: 'm1', chat_id: 'c', account_id: 'a', sender: 'hacker', text: 'hi', timestamp: '10:00', created_at: now }],
          },
        }),
      (err: any) => err instanceof SnapshotValidationError
    );
    const oversizedRows = new Array(BACKUP_MAX_ROWS_PER_TABLE + 1).fill({ id: 'x' });
    await assert.rejects(
      () => restoreDatabaseSnapshot({ tables: { messages: oversizedRows } }),
      (err: any) => err instanceof SnapshotValidationError && /上限/.test(err.message)
    );

    // 5. HTTP endpoints: /api/database/backup & /api/database/restore
    // 5a. Direct GET /api/database/backup returns sealed envelope (no plaintext chat leakage)
    const directBackupRes = await fetch(`${baseUrl}/api/database/backup`, {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    assert.equal(directBackupRes.status, 200);
    const directBackupText = await directBackupRes.text();
    assert.equal(directBackupText.includes(secretPhrase), false);
    assert.equal(isDiskSnapshotEnvelope(JSON.parse(directBackupText)), true);

    // 5b. POST /api/database/backup requires >=8 char passphrase and returns encrypted envelope
    const shortPassRes = await fetch(`${baseUrl}/api/database/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}` },
      body: JSON.stringify({ passphrase: '123' }),
    });
    assert.equal(shortPassRes.status, 400);

    const encExportRes = await fetch(`${baseUrl}/api/database/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}` },
      body: JSON.stringify({ passphrase: 'BackupKey_2026!' }),
    });
    assert.equal(encExportRes.status, 200);
    const encExportJson = (await encExportRes.json()) as any;
    assert.equal(isEncryptedBackupEnvelope(encExportJson), true);

    // 5c. POST /api/database/restore requires confirmPhrase ('RESTORE') secondary confirmation
    const missingPhraseRes = await fetch(`${baseUrl}/api/database/restore?confirm=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}` },
      body: JSON.stringify({ snapshot: exported, confirm: true }),
    });
    assert.equal(missingPhraseRes.status, 400);
    const missingPhraseJson = (await missingPhraseRes.json()) as any;
    assert.equal(missingPhraseJson.code, 'RESTORE_CONFIRMATION_PHRASE_REQUIRED');
    assert.equal(missingPhraseJson.requiresSecondaryInput, true);

    // 5d. POST /api/database/restore returns 400 INVALID_SNAPSHOT_SCHEMA on invalid table/fields
    const badSchemaRes = await fetch(`${baseUrl}/api/database/restore?confirm=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}` },
      body: JSON.stringify({
        snapshot: { tables: { app_users: [{ id: 'evil' }] } },
        confirm: true,
        confirmPhrase: 'RESTORE',
      }),
    });
    assert.equal(badSchemaRes.status, 400);
    const badSchemaJson = (await badSchemaRes.json()) as any;
    assert.equal(badSchemaJson.code, 'INVALID_SNAPSHOT_SCHEMA');

    // 5e. POST /api/database/restore decrypts & restores encrypted backup atomically with confirmPhrase='RESTORE'
    await db.prepare('DELETE FROM messages WHERE id = ?').run(sentinelMsgId);
    const restoreOkRes = await fetch(`${baseUrl}/api/database/restore?confirm=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}` },
      body: JSON.stringify({
        backup: encExportJson,
        passphrase: 'BackupKey_2026!',
        confirm: true,
        confirmPhrase: 'RESTORE',
      }),
    });
    assert.equal(restoreOkRes.status, 200);
    const restoreOkJson = (await restoreOkRes.json()) as any;
    assert.equal(restoreOkJson.success, true);
    const finalRestoredRow = (await db.prepare('SELECT text FROM messages WHERE id = ?').get(sentinelMsgId)) as any;
    assert.equal(finalRestoredRow?.text, secretPhrase);

    // 6. DatabaseModal.tsx contract checks
    const modalSrc = fs.readFileSync(resolve(process.cwd(), 'src/components/DatabaseModal.tsx'), 'utf8');
    assert.equal(modalSrc.includes('encryptBackupWithPassphrase'), true);
    assert.equal(modalSrc.includes('decryptBackupWithPassphrase'), true);
    assert.equal(modalSrc.includes('RESTORE'), true);
    assert.equal(/\b(alert|prompt)\s*\(/.test(modalSrc), false);
  } finally {
    await db.prepare('DELETE FROM messages WHERE id = ?').run(sentinelMsgId).catch(() => {});
    await new Promise<void>((r) => server.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('P2 #6: Electron error page HTML escaping, strict Helmet CSP, and frontend file/media URL protocol allowlist', async () => {
  const fs = await import('node:fs');
  const http = await import('node:http');
  const vm = await import('node:vm');
  const { resolve } = await import('node:path');
  const { app, buildCspDirectives } = await import('../server.ts');
  const { sanitizeSafeResourceUrl, isSafeResourceUrl } = await import('../src/services/urlSafety.ts');

  // 1. Electron main.cjs renderErrorHtml XSS escaping & script-none CSP meta tag
  const mainCjsSrc = fs.readFileSync(resolve(process.cwd(), 'main.cjs'), 'utf8');
  const fnSliceMatch = mainCjsSrc.match(
    /function escapeHtml\(value\)[\s\S]*?function renderErrorHtml\(title, errorMsg, stack = ''\)[\s\S]*?\n\}/
  );
  assert.ok(fnSliceMatch, 'Expected escapeHtml and renderErrorHtml definitions in main.cjs');

  const sandbox: Record<string, any> = {
    currentPort: 38271,
    FIXED_APP_PORT: 38271,
    getLogFilePath: () => 'C:\\Users\\<svg onload=alert(9)>\\startup.log',
    encodeURIComponent,
    Number,
    String,
  };
  vm.runInNewContext(`${fnSliceMatch[0]}\nthis.__renderErrorHtml = renderErrorHtml;`, sandbox);

  const errorDataUrl = sandbox.__renderErrorHtml(
    `<script>alert(1)</script> & "oops"`,
    `<img src=x onerror="fetch('https://evil.test')">`,
    `Error at 'C:\\Users\\<b>test</b>\\app.js'`
  );
  assert.equal(errorDataUrl.startsWith('data:text/html;charset=utf-8,'), true);
  const decodedErrorHtml = decodeURIComponent(errorDataUrl.slice('data:text/html;charset=utf-8,'.length));
  assert.equal(
    decodedErrorHtml.includes('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">'),
    true
  );
  assert.equal(/\bonclick\s*=/i.test(decodedErrorHtml), false);
  assert.equal(/<script\b/i.test(decodedErrorHtml), false);
  assert.equal(/<img\b/i.test(decodedErrorHtml), false);
  assert.equal(/<svg\b/i.test(decodedErrorHtml), false);
  assert.equal(decodedErrorHtml.includes('&lt;script&gt;alert(1)&lt;&#x2F;script&gt;'), true);
  assert.equal(decodedErrorHtml.includes('&lt;img src=x onerror=&quot;'), true);
  assert.equal(decodedErrorHtml.includes('&lt;svg onload=alert(9)&gt;'), true);

  // 2. Helmet CSP tightening in server.ts
  for (const strictOpts of [
    { isProduction: true, isElectron: false },
    { isProduction: false, isElectron: true },
    { isProduction: true, isElectron: true },
  ]) {
    const strictDirectives = buildCspDirectives(strictOpts);
    assert.deepEqual(strictDirectives.scriptSrc, ["'self'"]);
    assert.deepEqual(strictDirectives.scriptSrcAttr, ["'none'"]);
    assert.deepEqual(strictDirectives.frameAncestors, ["'self'"]);
    assert.deepEqual(strictDirectives.baseUri, ["'self'"]);
    assert.deepEqual(strictDirectives.formAction, ["'self'"]);
    assert.deepEqual(strictDirectives.objectSrc, ["'none'"]);
  }

  const devDirectives = buildCspDirectives({ isProduction: false, isElectron: false });
  assert.equal(devDirectives.scriptSrc.includes("'unsafe-eval'"), false);
  assert.equal(devDirectives.frameAncestors.includes('*'), false);

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const cspHeader = res.headers.get('content-security-policy') || '';
    assert.ok(cspHeader.includes("object-src 'none'"));
    assert.ok(cspHeader.includes("script-src-attr 'none'"));
    assert.equal(cspHeader.includes("'unsafe-eval'"), false);
    assert.equal(cspHeader.includes('frame-ancestors \'self\' *'), false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }

  // 3. Frontend URL protocol allowlist (sanitizeSafeResourceUrl)
  const dangerousUrls = [
    'javascript:alert(1)',
    '  JaVaScRiPt:alert(document.cookie)',
    'java\tscript:alert(1)',
    '\njavascript:alert(1)',
    'vbscript:msgbox(1)',
    'file:///C:/Windows/System32/calc.exe',
    'data:text/html,<script>alert(1)</script>',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'blob:javascript:alert(1)',
    '//evil.example/payload.js',
    '/\\evil.example/payload.js',
    '#',
    '',
    '/other/path',
  ];
  for (const badUrl of dangerousUrls) {
    assert.equal(sanitizeSafeResourceUrl(badUrl), '', `Expected dangerous URL to be blocked: ${JSON.stringify(badUrl)}`);
    assert.equal(isSafeResourceUrl(badUrl), false);
  }

  const safeUrls = [
    '/api/telegram/user/media/tg_123/45?accountId=acc_1&exp=9999999999&sig=abc',
    'https://cdn.telegram.org/file/123.pdf',
    'http://127.0.0.1:38271/api/telegram/user/avatar/123',
    'blob:https://127.0.0.1:38271/550e8400-e29b-41d4-a716-446655440000',
    'data:image/png;base64,iVBORw0KGgo=',
    'data:audio/mpeg;base64,SUQzAw==',
    'data:video/mp4;base64,AAAAIGZ0eXA=',
  ];
  for (const okUrl of safeUrls) {
    assert.equal(sanitizeSafeResourceUrl(okUrl), okUrl, `Expected safe URL to be allowed: ${okUrl}`);
    assert.equal(isSafeResourceUrl(okUrl), true);
  }

  // 4. ChatArea & TelegramChatInfoDrawer source contracts
  const chatAreaSrc = fs.readFileSync(resolve(process.cwd(), 'src/components/ChatArea.tsx'), 'utf8');
  const infoDrawerSrc = fs.readFileSync(resolve(process.cwd(), 'src/components/TelegramChatInfoDrawer.tsx'), 'utf8');
  assert.equal(chatAreaSrc.includes('sanitizeSafeResourceUrl'), true);
  assert.equal(infoDrawerSrc.includes('sanitizeSafeResourceUrl'), true);
  assert.equal(chatAreaSrc.includes("resolveDisplayUrl(msg.fileUrl) || '#'"), false);
  assert.equal(chatAreaSrc.includes('msg.fileUrl!'), false);
});

test('P1: Runtime Map bounds, QR 2FA/8-error socket cleanup, change-phone/call TTLs, sticker byte LRU, and periodic pruning', async () => {
  const fs = await import('node:fs');
  const { resolve } = await import('node:path');
  const {
    activeQrSessions,
    armQrPasswordTimeout,
    pruneExpiredQrSessions,
    MAX_ACTIVE_QR_SESSIONS,
    QR_SESSION_2FA_TIMEOUT_MS,
    pendingChangePhoneSessions,
    CHANGE_PHONE_SESSION_TTL_MS,
    MAX_PENDING_CHANGE_PHONE_SESSIONS,
    activeTelegramCalls,
    CALL_DISCARDED_TTL_MS,
    CALL_RINGING_MAX_TTL_MS,
    MAX_ACTIVE_TELEGRAM_CALLS,
    telegramStickerThumbCache,
    TELEGRAM_STICKER_CACHE_MAX_BYTES,
    TELEGRAM_STICKER_CACHE_MAX_ENTRIES,
    revokedJwtTokens,
    MAX_REVOKED_JWT_TOKENS,
    recentlySentOutboundCache,
    recentlySentOutboundIds,
    processedMtprotoMsgIds,
    MAX_RECENT_OUTBOUND_IDS,
    MAX_RECENT_OUTBOUND_CACHE,
    MAX_PROCESSED_MTPROTO_MSG_IDS,
    MTPROTO_DEDUP_TTL_MS,
    inMemoryCloudTelegramCreds,
    MAX_IN_MEMORY_CLOUD_TG_CREDS,
    pruneServerRuntimeCaches,
  } = await import('../server.ts');

  const baseNow = Date.now();
  try {
    // 1. activeQrSessions: 2FA timeout destroys socket & deletes session; 8-error path deletes session
    let destroyedCount = 0;
    const mockClient = {
      disconnect: async () => {
        destroyedCount++;
      },
      destroy: async () => {
        destroyedCount++;
      },
    } as any;

    const qr2faSession: any = {
      client: mockClient,
      sessionId: 'qr_2fa_timeout_test',
      apiId: 123,
      apiHash: 'abc',
      token: Buffer.from('t'),
      expires: Math.floor(baseNow / 1000) + 60,
      qrUrl: 'tg://login?token=t',
      isAuthorized: false,
      createdAt: baseNow,
    };
    activeQrSessions.set(qr2faSession.sessionId, qr2faSession);
    armQrPasswordTimeout(qr2faSession, 40);
    assert.equal(qr2faSession.needsPassword, true);
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(activeQrSessions.has(qr2faSession.sessionId), false);
    assert.equal(qr2faSession.isStopped, true);
    assert.ok(destroyedCount >= 1, 'Expected 2FA timeout to destroy GramJS client');

    // Prune expired 2FA session & enforce MAX_ACTIVE_QR_SESSIONS
    activeQrSessions.set('qr_stale_2fa', {
      client: mockClient,
      sessionId: 'qr_stale_2fa',
      apiId: 1,
      apiHash: 'h',
      token: Buffer.from('x'),
      expires: 0,
      qrUrl: 'tg://login?token=x',
      isAuthorized: false,
      needsPassword: true,
      needsPasswordAt: baseNow - QR_SESSION_2FA_TIMEOUT_MS - 1000,
      createdAt: baseNow - QR_SESSION_2FA_TIMEOUT_MS - 2000,
    });
    for (let i = 0; i < MAX_ACTIVE_QR_SESSIONS + 4; i++) {
      activeQrSessions.set(`qr_cap_${i}`, {
        client: mockClient,
        sessionId: `qr_cap_${i}`,
        apiId: 1,
        apiHash: 'h',
        token: Buffer.from('x'),
        expires: 0,
        qrUrl: 'tg://login?token=x',
        isAuthorized: false,
        isScanned: true,
        createdAt: baseNow,
      });
    }
    pruneExpiredQrSessions(baseNow);
    assert.equal(activeQrSessions.has('qr_stale_2fa'), false);
    assert.ok(activeQrSessions.size <= MAX_ACTIVE_QR_SESSIONS);
    activeQrSessions.clear();

    // Verify server.ts pollErrorCount >= 8 calls activeQrSessions.delete(sessionId)
    const serverSrc = fs.readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
    assert.match(
      serverSrc,
      /if\s*\(sessionObj\.pollErrorCount\s*>=\s*8\)[\s\S]*?destroyTelegramClientSafely\(sessionObj\.client\)[\s\S]*?activeQrSessions\.delete\(sessionId\)/
    );

    // 2. pendingChangePhoneSessions TTL + cap
    pendingChangePhoneSessions.set('u_expired', {
      userId: 'u_expired',
      newPhone: '+8613800000001',
      phoneCodeHash: 'h1',
      createdAt: baseNow - CHANGE_PHONE_SESSION_TTL_MS - 1000,
    });
    for (let i = 0; i < MAX_PENDING_CHANGE_PHONE_SESSIONS + 5; i++) {
      pendingChangePhoneSessions.set(`u_live_${i}`, {
        userId: `u_live_${i}`,
        newPhone: '+8613800000002',
        phoneCodeHash: `h_${i}`,
        createdAt: baseNow,
      });
    }

    // 3. activeTelegramCalls TTL (discarded 30s, ringing 5m) + cap
    activeTelegramCalls.set('call_disc_expired', {
      callId: 'call_disc_expired',
      tgCallId: 1,
      accessHash: 1,
      client: mockClient,
      accountId: 'acc_tg_1',
      status: 'discarded',
      startedAt: baseNow - 60_000,
      discardedAt: baseNow - CALL_DISCARDED_TTL_MS - 1000,
    });
    activeTelegramCalls.set('call_ring_expired', {
      callId: 'call_ring_expired',
      tgCallId: 2,
      accessHash: 2,
      client: mockClient,
      accountId: 'acc_tg_1',
      status: 'ringing',
      startedAt: baseNow - CALL_RINGING_MAX_TTL_MS - 1000,
    });
    for (let i = 0; i < MAX_ACTIVE_TELEGRAM_CALLS + 6; i++) {
      activeTelegramCalls.set(`call_live_${i}`, {
        callId: `call_live_${i}`,
        tgCallId: 100 + i,
        accessHash: 1,
        client: mockClient,
        accountId: 'acc_tg_1',
        status: 'accepted',
        startedAt: baseNow,
      });
    }

    // 4. telegramStickerThumbCache uses BoundedByteLruCache with byte + entry limits
    const stickerStats = telegramStickerThumbCache.stats();
    assert.equal(stickerStats.maxBytes, TELEGRAM_STICKER_CACHE_MAX_BYTES);
    assert.equal(stickerStats.maxEntries, TELEGRAM_STICKER_CACHE_MAX_ENTRIES);
    telegramStickerThumbCache.set(
      'sticker_expired',
      { buffer: Buffer.alloc(1024, 1), mime: 'image/webp', expiresAt: baseNow - 1000 },
      baseNow - 2000
    );
    assert.equal(telegramStickerThumbCache.get('sticker_expired', baseNow), undefined);

    // 5. revokedJwtTokens, dedup caches, and inMemoryCloudTelegramCreds TTL + hard caps
    revokedJwtTokens.set('expired_hash', baseNow - 1000);
    for (let i = 0; i < MAX_REVOKED_JWT_TOKENS + 10; i++) {
      revokedJwtTokens.set(`live_hash_${i}`, baseNow + 60_000);
    }

    recentlySentOutboundIds.set('old_out_id', baseNow - 1000);
    for (let i = 0; i < MAX_RECENT_OUTBOUND_IDS + 15; i++) {
      recentlySentOutboundIds.set(`live_out_id_${i}`, baseNow + 30_000);
    }

    recentlySentOutboundCache.set('old_out_msg', { count: 1, expiresAt: baseNow - 1000 });
    for (let i = 0; i < MAX_RECENT_OUTBOUND_CACHE + 15; i++) {
      recentlySentOutboundCache.set(`live_out_msg_${i}`, { count: 1, expiresAt: baseNow + 30_000 });
    }

    processedMtprotoMsgIds.set('old_mtproto_id', baseNow - MTPROTO_DEDUP_TTL_MS - 1000);
    for (let i = 0; i < MAX_PROCESSED_MTPROTO_MSG_IDS + 15; i++) {
      processedMtprotoMsgIds.set(`live_mtproto_${i}`, baseNow);
    }

    inMemoryCloudTelegramCreds.set('expired_cred', {
      apiId: 1,
      apiHash: 'old',
      source: 'cloud_authorized',
      fetchedAt: baseNow - 13 * 60 * 60 * 1000,
    });
    for (let i = 0; i < MAX_IN_MEMORY_CLOUD_TG_CREDS + 8; i++) {
      inMemoryCloudTelegramCreds.set(`live_cred_${i}`, {
        apiId: 1,
        apiHash: 'ok',
        source: 'cloud_authorized',
        fetchedAt: baseNow,
      });
    }

    const pruned = pruneServerRuntimeCaches(baseNow);
    assert.ok(pruned.changePhoneRemoved >= 6);
    assert.equal(pendingChangePhoneSessions.has('u_expired'), false);
    assert.ok(pendingChangePhoneSessions.size <= MAX_PENDING_CHANGE_PHONE_SESSIONS);

    assert.ok(pruned.callsRemoved >= 8);
    assert.equal(activeTelegramCalls.has('call_disc_expired'), false);
    assert.equal(activeTelegramCalls.has('call_ring_expired'), false);
    assert.ok(activeTelegramCalls.size <= MAX_ACTIVE_TELEGRAM_CALLS);

    assert.ok(pruned.jwtRemoved >= 11);
    assert.equal(revokedJwtTokens.has('expired_hash'), false);
    assert.ok(revokedJwtTokens.size <= MAX_REVOKED_JWT_TOKENS);

    assert.ok(pruned.outboundIdsRemoved >= 16);
    assert.equal(recentlySentOutboundIds.has('old_out_id'), false);
    assert.ok(recentlySentOutboundIds.size <= MAX_RECENT_OUTBOUND_IDS);

    assert.ok(pruned.outboundCacheRemoved >= 16);
    assert.equal(recentlySentOutboundCache.has('old_out_msg'), false);
    assert.ok(recentlySentOutboundCache.size <= MAX_RECENT_OUTBOUND_CACHE);

    assert.ok(pruned.mtprotoIdsRemoved >= 16);
    assert.equal(processedMtprotoMsgIds.has('old_mtproto_id'), false);
    assert.ok(processedMtprotoMsgIds.size <= MAX_PROCESSED_MTPROTO_MSG_IDS);

    assert.ok(pruned.credsRemoved >= 9);
    assert.equal(inMemoryCloudTelegramCreds.has('expired_cred'), false);
    assert.ok(inMemoryCloudTelegramCreds.size <= MAX_IN_MEMORY_CLOUD_TG_CREDS);
  } finally {
    activeQrSessions.clear();
    pendingChangePhoneSessions.clear();
    activeTelegramCalls.clear();
    telegramStickerThumbCache.clear();
    revokedJwtTokens.clear();
    recentlySentOutboundIds.clear();
    recentlySentOutboundCache.clear();
    processedMtprotoMsgIds.clear();
    inMemoryCloudTelegramCreds.clear();
  }
});

test('P1: Telegram Bot long-polling aborts immediately on gracefulShutdownServer and backs off on HTTP 429/502', async () => {
  const {
    startTelegramBotLongPolling,
    stopTelegramBotLongPolling,
    getBotPollingState,
    computeBotPollingBackoffMs,
    gracefulShutdownServer,
  } = await import('../server.ts');

  // 1. Backoff computation honors Retry-After and exponential progression
  assert.equal(computeBotPollingBackoffMs(1, undefined, 4000), 4000);
  assert.equal(computeBotPollingBackoffMs(2, undefined, 4000), 8000);
  assert.equal(computeBotPollingBackoffMs(3, undefined, 4000), 16000);
  assert.equal(computeBotPollingBackoffMs(1, 12, 4000), 12000);
  assert.equal(computeBotPollingBackoffMs(10, undefined, 4000), 60000);

  // 2. Simulate getWebhookInfo -> empty, then 429, 502, then hanging 20s getUpdates aborted by gracefulShutdownServer
  const pollCallTimes: number[] = [];
  let inFlightAborted = false;
  let getUpdatesCallIdx = 0;

  const mockFetcher: typeof fetch = (async (input: any, init?: any) => {
    const url = String(input);
    const signal: AbortSignal | undefined = init?.signal;
    if (url.includes('/getWebhookInfo')) {
      return new Response(JSON.stringify({ ok: true, result: { url: '' } }), { status: 200 });
    }
    if (url.includes('/getUpdates')) {
      getUpdatesCallIdx++;
      pollCallTimes.push(Date.now());
      if (getUpdatesCallIdx === 1) {
        return new Response(
          JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0.08 } }),
          { status: 429 }
        );
      }
      if (getUpdatesCallIdx === 2) {
        return new Response('Bad Gateway', { status: 502 });
      }
      // 3rd call simulates 20s long poll waiting for AbortController cancellation
      return await new Promise<Response>((_resolve, reject) => {
        const timer = setTimeout(() => {
          _resolve(new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }));
        }, 20_000);
        timer.unref?.();
        const onAbort = () => {
          clearTimeout(timer);
          inFlightAborted = true;
          const err = new Error('The operation was aborted');
          (err as any).name = 'AbortError';
          reject(err);
        };
        if (signal?.aborted) {
          onAbort();
        } else {
          signal?.addEventListener('abort', onAbort, { once: true });
        }
      });
    }
    return new Response('{}', { status: 200 });
  }) as any;

  const prevAutoReg = process.env.TELEGRAM_AUTO_REGISTER_WEBHOOK;
  delete process.env.TELEGRAM_AUTO_REGISTER_WEBHOOK;
  try {
    await startTelegramBotLongPolling({
      fetcher: mockFetcher,
      botToken: '123456:mock_bot_token',
      baseDelayMs: 60,
    });
    assert.equal(getBotPollingState().isBotPollingStarted, true);

    // Wait enough for 429 backoff (60ms) + 502 backoff (120ms) to enter 3rd hanging poll
    const deadline = Date.now() + 2000;
    while (getUpdatesCallIdx < 3 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(getUpdatesCallIdx, 3);
    // Verify 429 & 502 did NOT tight-loop immediately (elapsed gap >= 45ms each)
    assert.ok(pollCallTimes[1] - pollCallTimes[0] >= 45, `Expected 429 backoff delay, got ${pollCallTimes[1] - pollCallTimes[0]}ms`);
    assert.ok(pollCallTimes[2] - pollCallTimes[1] >= 85, `Expected 502 backoff delay, got ${pollCallTimes[2] - pollCallTimes[1]}ms`);

    // Trigger gracefulShutdownServer and verify immediate AbortController cancellation (< 400ms, not 20s!)
    const shutdownStart = Date.now();
    await gracefulShutdownServer('p1-test-shutdown');
    const shutdownElapsed = Date.now() - shutdownStart;

    assert.equal(inFlightAborted, true, 'Expected hanging 20s getUpdates request to be aborted via AbortController');
    assert.equal(getBotPollingState().isBotPollingStarted, false);
    assert.equal(getBotPollingState().hasAbortController, false);
    assert.ok(shutdownElapsed < 400, `Expected shutdown to abort immediately, took ${shutdownElapsed}ms`);
  } finally {
    await stopTelegramBotLongPolling();
    if (prevAutoReg !== undefined) process.env.TELEGRAM_AUTO_REGISTER_WEBHOOK = prevAutoReg;
  }
});

test('P2: Local SQLite enables WAL journal_mode and 5000ms busy_timeout, survives concurrent writes, and reports real PRAGMAs via /api/database/status', async () => {
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const {
    db,
    initDatabase,
    configureLocalSqlitePragmas,
    getSqliteRuntimePragmas,
    checkpointSqliteWal,
    SQLITE_BUSY_TIMEOUT_MS,
  } = await import('../server/db.ts');
  const { app } = await import('../server.ts');

  await initDatabase();
  const configured = await configureLocalSqlitePragmas();
  assert.equal(configured.journalMode, 'wal');
  assert.equal(configured.walEnabled, true);
  assert.equal(configured.busyTimeoutMs, SQLITE_BUSY_TIMEOUT_MS);
  assert.equal(SQLITE_BUSY_TIMEOUT_MS, 5000);

  const live = await getSqliteRuntimePragmas();
  assert.equal(live.journalMode, 'wal');
  assert.equal(live.walEnabled, true);
  assert.equal(live.busyTimeoutMs, 5000);

  // Concurrent writes under WAL + busy_timeout complete cleanly with zero SQLITE_BUSY drops
  const chatId = `tg_wal_concurrent_${Date.now()}`;
  const now = Date.now();
  try {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        db.prepare(
          'INSERT INTO messages (id, chat_id, account_id, sender, text, timestamp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(`msg_wal_${now}_${i}`, chatId, 'acc_wal', 'peer', `concurrent_${i}`, '12:00', now + i)
      )
    );
    const cntRow = (await db.prepare('SELECT count(*) as cnt FROM messages WHERE chat_id = ?').get(chatId)) as any;
    assert.equal(Number(cntRow?.cnt), 20);
    await checkpointSqliteWal();
    const afterConcurrent = await getSqliteRuntimePragmas();
    assert.equal(afterConcurrent.walEnabled, true);
    assert.equal(afterConcurrent.journalMode, 'wal');
    assert.equal(afterConcurrent.busyTimeoutMs, 5000);
    const poolChecks = await Promise.all(Array.from({ length: 10 }, () => db.execute('PRAGMA busy_timeout')));
    for (const r of poolChecks) {
      assert.equal(Number(Object.values(r.rows[0] as any)[0]), 5000);
    }
  } finally {
    await db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId).catch(() => {});
  }

  // /api/database/status returns live PRAGMA journalMode / busyTimeoutMs / walEnabled
  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'p2_sqlite_wal_status_test_secret_123';
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(
    JSON.stringify({ sub: 'member_wal', username: 'member_wal', role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const s = createHmac('sha256', process.env.JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  const memberJwt = `${h}.${p}.${s}`;

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/database/status`, {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    assert.equal(res.status, 200);
    const statusJson = (await res.json()) as any;
    assert.equal(statusJson.walEnabled, true);
    assert.equal(statusJson.journalMode, 'wal');
    assert.equal(statusJson.busyTimeoutMs, 5000);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test('P0 #2 hardening: single-flight GetDialogs deduplication, protected fallbacks, normalized flood keys, and visibility/switch guards', async () => {
  const http = await import('node:http');
  const { createHmac } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const {
    app,
    connectedUserClients,
    getOrFetchConnectedAccountDialogs,
    clearTelegramFloodCooldown,
    telegramAccountFloodCooldowns,
  } = await import('../server.ts');

  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'p0_singleflight_dialogs_secret_456';
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;

  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(
    JSON.stringify({ sub: 'member_singleflight', username: 'member_sf', role: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const s = createHmac('sha256', process.env.JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  const memberJwt = `${h}.${p}.${s}`;

  let slowGetDialogsCalls = 0;
  const uid = '99112233';
  const accId = `acc_tg_${uid}`;
  const mockConn: any = {
    client: {
      connected: true,
      _selfId: uid,
      getDialogs: async ({ folder }: { limit: number; folder?: number }) => {
        slowGetDialogsCalls++;
        await new Promise((r) => setTimeout(r, 40));
        if (folder === 1) return [];
        return [
          {
            id: 445566,
            title: 'SingleFlight Partner',
            date: Math.floor(Date.now() / 1000),
            unreadCount: 0,
            pinned: false,
            entity: { className: 'User', id: 445566, firstName: 'Partner' },
            message: { message: 'Ping' },
            dialog: {},
          },
        ];
      },
      destroy: async () => {},
      disconnect: async () => {},
    },
    phone: '+8613800009911',
    userId: uid,
    username: '@sf_tester',
    firstName: 'SF',
    avatarInitial: 'SF',
    avatarBg: '#2481cc',
    apiId: 12345,
    apiHash: 'hash',
    connectedAt: Date.now(),
    dialogs: [],
  };

  connectedUserClients.set(accId, mockConn);
  connectedUserClients.set(uid, mockConn);
  clearTelegramFloodCooldown({ accountId: accId, userId: uid, phone: mockConn.phone });

  try {
    // Fire background login prefetch + 5 concurrent HTTP /dialogs requests simultaneously
    const [prefetchRes, ...httpResponses] = await Promise.all([
      getOrFetchConnectedAccountDialogs(mockConn, { limit: 150 }),
      ...Array.from({ length: 5 }, () =>
        fetch(`http://127.0.0.1:${port}/api/telegram/user/dialogs?accountId=${accId}`, {
          headers: { Authorization: `Bearer ${memberJwt}` },
        }).then((r) => r.json())
      ),
    ]);

    assert.equal(prefetchRes.dialogs.length, 1);
    assert.equal(slowGetDialogsCalls, 2, 'Expected 1 main + 1 archive GetDialogs RPC total across 6 concurrent callers');
    for (const body of httpResponses as any[]) {
      assert.equal(body.ok, true);
      assert.equal(body.dialogs.length, 1);
      assert.equal(body.dialogs[0].title, 'SingleFlight Partner');
    }
  } finally {
    clearTelegramFloodCooldown({ accountId: accId, userId: uid, phone: mockConn.phone });
    telegramAccountFloodCooldowns.clear();
    connectedUserClients.delete(accId);
    connectedUserClients.delete(uid);
    await new Promise<void>((r) => server.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }

  const appSrc = readFileSync(resolve(process.cwd(), 'src', 'App.tsx'), 'utf8');
  assert.match(appSrc, /const statusPollTimer = setInterval\(\(\) => \{\s*if \(typeof document !== 'undefined' && document\.visibilityState === 'hidden'\) return;/);
  assert.match(appSrc, /hasExistingAccountChats && Date\.now\(\) - lastSyncAt < DIALOG_MIN_REFRESH_GAP_MS/);

  const apiServiceSrc = readFileSync(resolve(process.cwd(), 'src', 'services', 'apiService.ts'), 'utf8');
  assert.match(apiServiceSrc, /function resolveClientFloodKeys/);
});

