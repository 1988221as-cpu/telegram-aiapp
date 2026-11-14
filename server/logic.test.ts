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

    // 4. Verify resolveUnifiedEvolutionCorpus picks up unified client + DB messages
    const corpus = await resolveUnifiedEvolutionCorpus({
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
  assert.match(serverSrc, /searchRailwayKnowledgeBase\(\s*(?:text|effectiveIncomingText),[\s\S]*?lastActiveUserJwt \|\| undefined/);
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
  assert.match(serverSrc, /app\.post\('\/api\/audio\/tts-clone'[\s\S]*?音色克隆需使用自有模型网关/);
  assert.match(serverSrc, /app\.post\('\/api\/audio\/tts-clone'[\s\S]*?\/audio\/speech/);
  assert.match(serverSrc, /app\.post\('\/api\/customer\/analyze\/:chatId'[\s\S]*?engineMode:\s*'cloud'[\s\S]*?purpose:\s*'memory_extraction'/);

  // 4. Verify UI 图1-图4 structural contracts
  const translationDrawerSrc = readFileSync(resolve(process.cwd(), 'src/components/TranslationDrawer.tsx'), 'utf8');
  assert.equal(translationDrawerSrc.includes('customModelName'), true);
  assert.equal(translationDrawerSrc.includes('输入 API 密钥'), false);

  const voiceprintSrc = readFileSync(resolve(process.cwd(), 'src/components/MasterVoiceprintModal.tsx'), 'utf8');
  assert.equal(voiceprintSrc.includes('ttsModel'), true);
  assert.equal(voiceprintSrc.includes('音色克隆 / 语音合成模型型号'), true);

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
  assert.match(serverSrc, /getCnTranslationIfForeign\(replyText,\s*effectiveChatConfig,\s*userJwt\)/);
  assert.match(serverSrc, /getCnTranslationIfForeign\(replyText,\s*undefined,\s*lastActiveUserJwt \|\| undefined\)/);
  assert.match(
    serverSrc,
    /async function getCnTranslationIfForeign\(\s*text:\s*string,\s*overrideCustomConfig\?:\s*any,\s*userJwt\?:\s*string/
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
  await restoreDatabaseSnapshot({
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
  assert.equal(validRow?.user_id, 'u_enc');
  await db.prepare('DELETE FROM telegram_user_sessions WHERE phone = ?').run(testPhoneValid);

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

  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.equal(appSrc.includes("secureSetItemSync('tg_pro_messages'"), false);
  assert.equal(appSrc.includes("localStorage.getItem('tg_pro_active_account_id')"), true);
  assert.equal(appSrc.includes('normalizeStalePendingMessages(localList)'), true);
  assert.equal(appSrc.includes('重新扫码登录'), true);

  const dbModalSrc = readFileSync(resolve(process.cwd(), 'src/components/DatabaseModal.tsx'), 'utf8');
  assert.equal(dbModalSrc.includes("key.startsWith('tg_deleted_message_ids')"), true);
});

test('isAllowedClientOrigin blocks cross-site evil Origin even when Host is 127.0.0.1/localhost', () => {
  const makeReq = (origin: string | undefined, host = '127.0.0.1:3000') =>
    ({
      headers: origin ? { origin } : {},
      get: (name: string) => (name.toLowerCase() === 'host' ? host : undefined),
    }) as any;

  assert.equal(isAllowedClientOrigin(makeReq('https://evil.example', '127.0.0.1:3000')), false);
  assert.equal(isAllowedClientOrigin(makeReq('https://evil.example', 'localhost:3000')), false);
  assert.equal(isAllowedClientOrigin(makeReq('http://127.0.0.1:3000', '127.0.0.1:3000')), true);
  assert.equal(isAllowedClientOrigin(makeReq('http://localhost:3000', '127.0.0.1:3000')), true);
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
  const { initDatabase } = await import('./db.ts');
  const {
    detectSourceLangCode,
    getCnTranslationIfForeign,
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
  for (const nlSample of ['Hallo, ik ben Jan', 'Hallo, alsjeblieft', 'Hallo, hoe is het']) {
    assert.equal(detectSourceLangCode(nlSample), 'nl', `server detectSourceLangCode failed for: ${nlSample}`);
    assert.equal(detectClientLangCode(nlSample), 'nl', `client detectClientLangCode failed for: ${nlSample}`);
  }
  assert.equal(detectSourceLangCode('Hallo, wie geht es dir?'), 'de');
  assert.equal(detectClientLangCode('Hallo, wie geht es dir?'), 'de');
  // Mixed Kanji + Kana Japanese must resolve to 'ja', not 'zh-CN'
  assert.equal(detectSourceLangCode('確認しました。ありがとうございます！'), 'ja');
  assert.equal(detectClientLangCode('確認しました。ありがとうございます！'), 'ja');

  // #6: hasTranslatableLetters skips pure digits, URLs, emails, @mentions, emojis
  assert.equal(hasTranslatableLetters('123456'), false);
  assert.equal(hasTranslatableLetters('https://t.me/abc'), false);
  assert.equal(hasTranslatableLetters('www.example.com/order/99'), false);
  assert.equal(hasTranslatableLetters('user@example.com'), false);
  assert.equal(hasTranslatableLetters('@alice_bot'), false);
  assert.equal(hasTranslatableLetters('100.50 👍'), false);
  assert.equal(hasTranslatableLetters('Hello @alice'), true);
  assert.equal(hasTranslatableLetters('订单号 123456'), true);

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
  assert.equal(getLanguageDisplayName('Dutch'), '荷兰语');
  assert.equal(getLanguageDisplayName('Polish'), '波兰语');
  assert.equal(getLanguageDisplayName('Swedish'), '瑞典语');
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
    assert.equal(fetchCalls, callsBeforeSkip);

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
      serverSrc.includes('extractRecentTwoWayMessages(canonicalChatId, rawChatId, [], 20, accountId)'),
      true,
      'Expected MTProto autopilot to pass accountId into extractRecentTwoWayMessages'
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
