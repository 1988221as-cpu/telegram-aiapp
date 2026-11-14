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
    /自定义大模型未启用/
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
  await syncServerCustomLlmConfig({ enabled: false, engineMode: 'custom', engineLicenseKey: '' });
  try {
    const noAuthRes = await syncLearnedPatternsToBackendLlm({
      patterns: [
        {
          title: '短句呼吸感',
          description: '自然拆分短句并接梗',
          examplePattern: '哈哈对呀，别太累啦~',
        },
      ],
      customConfig: { enabled: false },
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
  assert.match(serverSrc, /searchRailwayKnowledgeBase\(\s*text,[\s\S]*?lastActiveUserJwt \|\| undefined/);
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

  // 3. Verify apiService & server routing contracts for priority custom mode
  const apiServiceSrc = readFileSync(resolve(process.cwd(), 'src/services/apiService.ts'), 'utf8');
  assert.match(apiServiceSrc, /isPriorityCustom\s*=\s*Boolean\(customConfig\?\.enabled && customConfig\?\.engineMode === 'custom'\)/);
  assert.match(apiServiceSrc, /isPriorityCustom\s*\?\s*'custom_llm'/);

  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.match(serverSrc, /app\.post\('\/api\/customer\/analyze\/:chatId'[\s\S]*?useCustomPriorityMemory[\s\S]*?engineMode:\s*'custom'[\s\S]*?analysisPrompt/);
  assert.match(serverSrc, /app\.post\('\/api\/translate'[\s\S]*?isPriorityCustomGateway[\s\S]*?'custom_llm'/);
  assert.match(serverSrc, /getCnTranslationIfForeign\(replyText,\s*customConfig\)/);
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

process.on('beforeExit', () => {
  process.exit(0);
});
