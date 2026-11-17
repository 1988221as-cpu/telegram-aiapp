import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { Api } from 'telegram';

process.env.NODE_ENV = 'test';
process.env.AIS_TEST_IMPORT = 'true';

before(async () => {
  const { initDatabase } = await import('./db.ts');
  await initDatabase();
});

const VALID_OGG_HEADER_BYTES = Buffer.from([
  0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x20,
  0x30, 0x40, 0x01, 0x04, 0x4f, 0x70, 0x75, 0x73,
]);

test('Outbound Media Security: local path allowlist, symlink escape, traversal, .env & SQLite DB blocks', async () => {
  const {
    OUTBOUND_MEDIA_DIR,
    resolveAllowedOutboundDiskPath,
    resolveLocalMediaDiskPath,
    readMediaBufferStrict,
    resolveOutboundMediaSource,
    convertAudioToOggOpus,
  } = await import('../server.ts');
  const { dbPath } = await import('./db.ts');

  fs.mkdirSync(OUTBOUND_MEDIA_DIR, { recursive: true });

  const outsideTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-sec-outside-'));
  const outsideSecretPath = path.join(outsideTmpDir, 'secret.txt');
  fs.writeFileSync(outsideSecretPath, 'TOP_SECRET_VALUE', 'utf8');

  const symlinkName = `sec_symlink_${Date.now()}.txt`;
  const symlinkInsidePath = path.join(OUTBOUND_MEDIA_DIR, symlinkName);

  const validFileName = `sec_valid_${Date.now()}.bin`;
  const validInsidePath = path.join(OUTBOUND_MEDIA_DIR, validFileName);
  fs.writeFileSync(validInsidePath, Buffer.from('valid-media-bytes'));

  let symlinkCreated = false;
  try {
    fs.symlinkSync(outsideSecretPath, symlinkInsidePath);
    symlinkCreated = true;

    // 1. Legitimate file inside OUTBOUND_MEDIA_DIR succeeds
    const allowedValid = resolveAllowedOutboundDiskPath(validInsidePath);
    assert.ok(allowedValid);
    assert.equal(allowedValid, fs.realpathSync(validInsidePath));

    const allowedFromUrl = resolveLocalMediaDiskPath(`/api/messages/local-media/${validFileName}`);
    assert.equal(allowedFromUrl, fs.realpathSync(validInsidePath));

    // 2. Arbitrary absolute paths blocked
    assert.equal(resolveAllowedOutboundDiskPath('/etc/passwd'), null);
    assert.equal(resolveAllowedOutboundDiskPath('C:\\Windows\\win.ini'), null);
    assert.equal(resolveAllowedOutboundDiskPath('file:///etc/passwd'), null);
    assert.equal(resolveAllowedOutboundDiskPath(outsideSecretPath), null);

    // 3. .env and SQLite DB files blocked (both generic and actual dbPath)
    assert.equal(resolveAllowedOutboundDiskPath('.env'), null);
    assert.equal(resolveAllowedOutboundDiskPath('.env.example'), null);
    assert.equal(resolveAllowedOutboundDiskPath(path.resolve('.env')), null);
    assert.equal(resolveAllowedOutboundDiskPath('data/lingxi.db'), null);
    assert.equal(resolveAllowedOutboundDiskPath('data/telegram_pro.db'), null);
    assert.equal(resolveAllowedOutboundDiskPath(dbPath), null);

    // 4. Path traversal blocked
    assert.equal(resolveAllowedOutboundDiskPath(path.join(OUTBOUND_MEDIA_DIR, '..', '..', '.env')), null);
    assert.equal(resolveLocalMediaDiskPath('/api/messages/local-media/..%2F..%2F.env'), null);
    assert.equal(resolveLocalMediaDiskPath('/api/messages/local-media/../../etc/passwd'), null);

    // 5. Symlink escape inside OUTBOUND_MEDIA_DIR blocked everywhere
    assert.equal(resolveAllowedOutboundDiskPath(symlinkInsidePath), null);
    assert.equal(resolveLocalMediaDiskPath(`/api/messages/local-media/${symlinkName}`), null);

    await assert.rejects(() => readMediaBufferStrict('/etc/passwd', '图片'));
    await assert.rejects(() => readMediaBufferStrict('.env', '文件'));
    await assert.rejects(() => readMediaBufferStrict(path.resolve('.env.example'), '文件'));
    await assert.rejects(() => readMediaBufferStrict('data/lingxi.db', '文件'));
    await assert.rejects(() => readMediaBufferStrict(dbPath, '文件'));
    await assert.rejects(() => readMediaBufferStrict(`/api/messages/local-media/${symlinkName}`, '文件'));
    await assert.rejects(() => resolveOutboundMediaSource('/etc/passwd', '/etc/passwd', '图片'));
    await assert.rejects(() => resolveOutboundMediaSource('', symlinkInsidePath, '文件'));
    await assert.rejects(() => convertAudioToOggOpus('/etc/passwd'));
    await assert.rejects(() => convertAudioToOggOpus(symlinkInsidePath));

    // 6. Controlled OUTBOUND_MEDIA_DIR media reads normally
    const src = await resolveOutboundMediaSource(`/api/messages/local-media/${validFileName}`, undefined, '文件');
    assert.equal(src.diskPath, fs.realpathSync(validInsidePath));
    assert.equal(src.size, 'valid-media-bytes'.length);
    const readBuf = await readMediaBufferStrict(`/api/messages/local-media/${validFileName}`, '文件');
    assert.equal(readBuf.toString('utf8'), 'valid-media-bytes');
  } finally {
    if (symlinkCreated && fs.existsSync(symlinkInsidePath)) {
      fs.unlinkSync(symlinkInsidePath);
    }
    if (fs.existsSync(validInsidePath)) {
      fs.unlinkSync(validInsidePath);
    }
    fs.rmSync(outsideTmpDir, { recursive: true, force: true });
  }
});

test('Outbound Media Security: IPv4/IPv6 SSRF, cloud metadata, DNS rebinding, redirects, timeout & byte limits', async () => {
  const {
    isPrivateOrReservedIp,
    validateOutboundMediaRemoteUrl,
    safeOutboundMediaFetch,
    readMediaBufferStrict,
  } = await import('../server.ts');

  // 1. IPv4 private / reserved / loopback / metadata / non-canonical
  for (const blocked of [
    '127.0.0.1',
    '127.0.0.2',
    'localhost',
    'api.localhost',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '100.64.0.1',
    '169.254.169.254',
    '0.0.0.0',
    '224.0.0.1',
    '240.0.0.1',
    '012.0.0.1',
    '0x7f000001',
    '2130706433',
  ]) {
    assert.equal(isPrivateOrReservedIp(blocked), true, `Expected IPv4/host to be blocked: ${blocked}`);
  }

  // 2. IPv6 loopback / ULA / link-local / mapped IPv4 / NAT64 / 6to4 / doc
  for (const blocked6 of [
    '::1',
    '[::1]',
    '::',
    'fc00::1',
    'fd12:3456:789a::1',
    'fe80::1',
    'fe80::1%eth0',
    'fec0::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:10.0.0.1',
    '::127.0.0.1',
    '64:ff9b::127.0.0.1',
    '2002:7f00:0001::1',
    '2001:db8::1',
  ]) {
    assert.equal(isPrivateOrReservedIp(blocked6), true, `Expected IPv6 to be blocked: ${blocked6}`);
  }

  // 3. Public IPv4 & IPv6 allowed
  for (const allowed of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateOrReservedIp(allowed), false, `Expected public IP to be allowed: ${allowed}`);
  }

  // 4. URL-level SSRF & non-http(s) / credentials / numeric bypass checks
  for (const badUrl of [
    'http://127.0.0.1:8080/a.jpg',
    'HTTP://127.0.0.1:8080/a.jpg',
    'http://localhost:3000/api/health',
    'http://localhost./api/health',
    'http://sub.localhost./api/health',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/internal.png',
    'http://192.168.1.10/secret.pdf',
    'http://172.16.5.4/secret.mp4',
    'http://[::1]/secret.jpg',
    'http://[::ffff:127.0.0.1]/secret.jpg',
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://[fe80::1]/internal',
    'http://[fc00::1]/internal',
    'http://2130706433/secret',
    'http://0x7f000001/secret',
    'http://0177.0.0.1/secret',
    'https://user:pass@93.184.216.34/a.jpg',
    'file:///etc/passwd',
  ]) {
    await assert.rejects(
      () => validateOutboundMediaRemoteUrl(badUrl),
      /SSRF 安全拦截/,
      `Expected URL to be blocked: ${badUrl}`
    );
  }

  // Uppercase DATA: URL handled cleanly by readMediaBufferStrict
  const upperDataBuf = await readMediaBufferStrict(
    `DATA:image/png;base64,${Buffer.from('PNG_UPPER').toString('base64')}`,
    '图片'
  );
  assert.equal(upperDataBuf.toString('utf8'), 'PNG_UPPER');

  // 5. Real local HTTP server tests: zero hits for SSRF URLs + redirect + maxBytes + timeout + DNS Rebinding
  let targetHitCount = 0;
  const targetServer = http.createServer((req, res) => {
    targetHitCount += 1;
    if (req.url === '/redirect-metadata') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    if (req.url === '/too-large') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.write(Buffer.alloc(2048, 0x41));
      res.end();
      return;
    }
    if (req.url === '/slow') {
      // Intentionally hang until client timeout aborts
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.from('PNG_OK_BODY'));
  });

  await new Promise<void>((resolve) => targetServer.listen(0, '127.0.0.1', resolve));
  const targetPort = (targetServer.address() as any).port;

  // Test-only transport adapter forwarding a pinned-IP-checked request to our local target server
  // while invoking options.lookup to prove pinned IP is passed and DNS is not re-queried.
  const makeLocalForwardRequestImpl = (
    capturedLookups: Array<{ address: string; family: number }>,
    capturedReqOpts?: Array<{ hostname?: string; servername?: string }>
  ) => {
    return (reqOpts: any, cb?: (res: http.IncomingMessage) => void) => {
      if (capturedReqOpts) {
        capturedReqOpts.push({ hostname: reqOpts.hostname, servername: reqOpts.servername });
      }
      if (typeof reqOpts.lookup === 'function') {
        reqOpts.lookup(reqOpts.hostname, {}, (_err: any, address: string, family: number) => {
          capturedLookups.push({ address, family });
        });
      }
      return http.request(
        {
          hostname: '127.0.0.1',
          port: targetPort,
          path: reqOpts.path,
          method: reqOpts.method,
          headers: reqOpts.headers,
        },
        cb
      );
    };
  };

  try {
    // 5a. Real loopback / metadata / IPv6 requests never hit socket (targetHitCount stays 0)
    await assert.rejects(() => readMediaBufferStrict(`http://127.0.0.1:${targetPort}/ok`, '图片'));
    await assert.rejects(() => readMediaBufferStrict(`http://localhost:${targetPort}/ok`, '图片'));
    await assert.rejects(() => readMediaBufferStrict(`http://[::1]:${targetPort}/ok`, '图片'));
    await assert.rejects(() => readMediaBufferStrict(`http://[::ffff:127.0.0.1]:${targetPort}/ok`, '图片'));
    await assert.rejects(() => readMediaBufferStrict('http://169.254.169.254/latest/meta-data/', '图片'));
    assert.equal(targetHitCount, 0, 'SSRF attempts must be blocked before opening TCP connection');

    // 5b. Mixed DNS answer containing a private IP is rejected immediately
    await assert.rejects(
      () =>
        safeOutboundMediaFetch('http://mixed-rebind.example.test/ok', {
          dnsLookup: async () => [
            { address: '93.184.216.34', family: 4 },
            { address: '127.0.0.1', family: 4 },
          ],
          requestImpl: makeLocalForwardRequestImpl([]),
        }),
      /SSRF 安全拦截/
    );
    assert.equal(targetHitCount, 0);

    // 5c. DNS Rebinding simulation: resolver changes from public IP on call #1 to 127.0.0.1 on call #2
    let dnsCalls = 0;
    const pinnedLookups: Array<{ address: string; family: number }> = [];
    const rebindingDns = async () => {
      dnsCalls += 1;
      if (dnsCalls === 1) {
        return [{ address: '93.184.216.34', family: 4 }];
      }
      return [{ address: '127.0.0.1', family: 4 }];
    };
    const fetched = await safeOutboundMediaFetch('http://rebind.example.test/ok', {
      dnsLookup: rebindingDns,
      requestImpl: makeLocalForwardRequestImpl(pinnedLookups),
    });
    assert.equal(fetched.toString('utf8'), 'PNG_OK_BODY');
    assert.equal(dnsCalls, 1, 'DNS lookup must happen exactly once (pinned IP prevents rebinding)');
    assert.deepEqual(pinnedLookups, [{ address: '93.184.216.34', family: 4 }]);

    // 5d. HTTP 302 redirect to cloud metadata is rejected immediately
    await assert.rejects(
      () =>
        safeOutboundMediaFetch('http://redirect.example.test/redirect-metadata', {
          dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
          requestImpl: makeLocalForwardRequestImpl([]),
        }),
      /HTTP 重定向/
    );

    // 5e. MaxBytes streaming cap aborts oversized media
    await assert.rejects(
      () =>
        safeOutboundMediaFetch('http://large.example.test/too-large', {
          maxBytes: 512,
          dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
          requestImpl: makeLocalForwardRequestImpl([]),
        }),
      /体积超过最大限制/
    );

    // 5f. Timeout aborts hanging HTTP response
    await assert.rejects(
      () =>
        safeOutboundMediaFetch('http://slow.example.test/slow', {
          timeoutMs: 500,
          dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
          requestImpl: makeLocalForwardRequestImpl([]),
        }),
      /超时/
    );

    // 5g. Public IPv6 literal & HTTPS uppercase scheme omit invalid IP servername and strip [] brackets
    const capturedReqOpts: Array<{ hostname?: string; servername?: string }> = [];
    const capturedIpv6Lookups: Array<{ address: string; family: number }> = [];
    const ipv6Fetch = await safeOutboundMediaFetch('HTTPS://[2001:4860:4860::8888]/ok', {
      requestImpl: makeLocalForwardRequestImpl(capturedIpv6Lookups, capturedReqOpts),
    });
    assert.equal(ipv6Fetch.toString('utf8'), 'PNG_OK_BODY');
    assert.deepEqual(capturedReqOpts[0], { hostname: '2001:4860:4860::8888', servername: undefined });
    assert.deepEqual(capturedIpv6Lookups[0], { address: '2001:4860:4860::8888', family: 6 });
  } finally {
    targetServer.closeAllConnections?.();
    await new Promise<void>((resolve) => targetServer.close(() => resolve()));
  }
});

test('Outbound Media Security & Compatibility: Bot/MTProto HTTP integration, forged _localDiskPath, and normal media flows', async () => {
  const {
    app,
    OUTBOUND_MEDIA_DIR,
    connectedUserClients,
    applyUploadedMediaToMessagePayload,
    sanitizeOutboundMessageClientPayload,
    deliverOutboundTelegramMessage,
    sendTelegramPhoto,
    sendTelegramVideo,
    sendTelegramDocument,
    sendTelegramVoice,
  } = await import('../server.ts');
  const { db, dbPath } = await import('./db.ts');

  fs.mkdirSync(OUTBOUND_MEDIA_DIR, { recursive: true });

  // 1. Unit check: forged _localDiskPath & tampering in applyUploadedMediaToMessagePayload
  const cleanClient = sanitizeOutboundMessageClientPayload({
    chatId: 'tg_999',
    sender: 'me',
    isImage: true,
    imageUrl: 'https://example.com/a.jpg',
    _localDiskPath: '/etc/passwd',
    extraDangerousField: 'evil',
  });
  assert.equal('_localDiskPath' in cleanClient, false);
  assert.equal('extraDangerousField' in cleanClient, false);

  const untrustedDiskApply = applyUploadedMediaToMessagePayload(
    { chatId: 'tg_999', isImage: true, _localDiskPath: '/etc/passwd' },
    { diskPath: '/etc/passwd', diskFileName: 'passwd', originalName: 'passwd', mimeType: 'text/plain', size: 100 },
    'acc_tg_sec_test'
  );
  assert.equal('_localDiskPath' in untrustedDiskApply.payload, false);
  assert.equal(untrustedDiskApply.mediaUrl, undefined);

  // Setup Express + JWT + mock MTProto client + intercepted Bot fetch + SSRF canary server
  const prevJwtSecret = process.env.JWT_SECRET;
  const prevBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const testSecret = `sec_test_jwt_${Date.now()}`;
  process.env.JWT_SECRET = testSecret;
  process.env.TELEGRAM_BOT_TOKEN = '123456:TEST_BOT_TOKEN_FOR_SECURITY_REGRESSION';

  const signJwt = (payload: object) => {
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', testSecret).update(`${h}.${p}`).digest('base64url');
    return `${h}.${p}.${sig}`;
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const mtprotoAccId = `acc_tg_sec_${Date.now()}`;
  const mtprotoUserId = `sec_${Date.now()}`;
  const mtprotoJwt = signJwt({ sub: 'sec_tester', username: 'sec_tester', role: 'member', accountId: mtprotoAccId, exp });
  const botJwt = signJwt({ sub: 'bot_tester', username: 'bot_tester', role: 'member', accountId: 'acc_telegram_bot', exp });

  let ssrfCanaryHits = 0;
  const canaryServer = http.createServer((_req, res) => {
    ssrfCanaryHits += 1;
    res.writeHead(200);
    res.end('SECRET_CANARY');
  });
  await new Promise<void>((r) => canaryServer.listen(0, '127.0.0.1', r));
  const canaryPort = (canaryServer.address() as any).port;

  const sentMtprotoCalls: Array<{ peer: any; opts: any }> = [];
  const mockMtprotoClient: any = {
    getInputEntity: async () => new Api.InputPeerSelf(),
    sendFile: async (peer: any, opts: any) => {
      sentMtprotoCalls.push({ peer, opts });
      return { id: 9000 + sentMtprotoCalls.length, date: Math.floor(Date.now() / 1000) };
    },
    sendMessage: async () => ({ id: 8888, date: Math.floor(Date.now() / 1000) }),
    invoke: async () => ({ dialogs: [], messages: [] }),
  };

  connectedUserClients.set(mtprotoAccId, {
    userId: mtprotoUserId,
    phone: '+10000009999',
    client: mockMtprotoClient,
    status: 'connected',
    connectedAt: Date.now(),
    dialogs: [],
  } as any);

  const botApiCalls: Array<{ url: string; method: string; bodyType: string }> = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const urlStr = typeof input === 'string' ? input : String(input?.url || '');
    if (urlStr.startsWith('https://api.telegram.org/')) {
      botApiCalls.push({
        url: urlStr,
        method: String(init?.method || 'GET'),
        bodyType: init?.body instanceof FormData ? 'FormData' : typeof init?.body,
      });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7700 + botApiCalls.length } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return origFetch(input, init);
  }) as any;

  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const appBase = `http://127.0.0.1:${(srv.address() as any).port}`;

  const createdMsgIds: string[] = [];
  const createdDiskFiles: string[] = [];
  const outsideTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-http-sym-'));
  const outsideTarget = path.join(outsideTmp, 'host-secret.txt');
  fs.writeFileSync(outsideTarget, 'HOST_SECRET', 'utf8');
  const httpSymlinkName = `http_sym_${Date.now()}.txt`;
  const httpSymlinkPath = path.join(OUTBOUND_MEDIA_DIR, httpSymlinkName);
  fs.symlinkSync(outsideTarget, httpSymlinkPath);

  try {
    // 2. Direct deliverOutboundTelegramMessage forged _localDiskPath -> blocked
    const directSpoof = await deliverOutboundTelegramMessage(
      {
        chatId: 'tg_123456',
        sender: 'me',
        isImage: true,
        _localDiskPath: '/etc/passwd',
      },
      mtprotoAccId,
      `msg_direct_spoof_${Date.now()}`
    );
    assert.equal(directSpoof.delivered, false);
    assert.equal(sentMtprotoCalls.length, 0);

    // 3. MTProto HTTP attack payloads blocked (arbitrary paths, .env, DB, SSRF, spoofed _localDiskPath)
    const mtprotoAttacks = [
      { isImage: true, imageUrl: '/etc/passwd', label: 'abs-image' },
      { isFile: true, fileUrl: '.env', fileName: '.env', label: 'dotenv-file' },
      { isFile: true, fileUrl: dbPath, fileName: path.basename(dbPath), label: 'sqlite-db' },
      { isAudio: true, audioUrl: `http://127.0.0.1:${canaryPort}/audio.ogg`, label: 'ipv4-loopback' },
      { isImage: true, imageUrl: 'http://169.254.169.254/latest/meta-data/', label: 'cloud-metadata' },
      { isVideo: true, videoUrl: `http://[::1]:${canaryPort}/v.mp4`, label: 'ipv6-loopback' },
      { isImage: true, imageUrl: `http://[::ffff:127.0.0.1]:${canaryPort}/i.png`, label: 'ipv4-mapped-v6' },
      { isImage: true, _localDiskPath: '/etc/passwd', label: 'forged-localDiskPath' },
    ];
    for (const atk of mtprotoAttacks) {
      const id = `msg_atk_mt_${atk.label}_${Date.now()}`;
      createdMsgIds.push(id);
      const res = await origFetch(`${appBase}/api/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mtprotoJwt}`,
          'Content-Type': 'application/json',
          'X-Account-Id': mtprotoAccId,
        },
        body: JSON.stringify({ id, chatId: 'tg_123456', sender: 'me', ...atk }),
      });
      const data: any = await res.json();
      assert.equal(data.delivered, false, `MTProto attack must fail: ${atk.label}`);
    }
    assert.equal(sentMtprotoCalls.length, 0, 'MTProto sendFile must never be called for blocked attacks');
    assert.equal(ssrfCanaryHits, 0, 'SSRF canary server must receive 0 hits from MTProto channel');

    // 4. Bot channel attack payloads blocked
    const botAttacks = [
      { isImage: true, imageUrl: '/etc/passwd', label: 'bot-abs-image' },
      { isFile: true, fileUrl: '.env', fileName: '.env', label: 'bot-dotenv' },
      { isAudio: true, audioUrl: 'http://169.254.169.254/latest/meta-data/', label: 'bot-metadata' },
      { isVideo: true, videoUrl: `http://127.0.0.1:${canaryPort}/v.mp4`, label: 'bot-loopback' },
      { isImage: true, imageUrl: 'http://[::ffff:10.0.0.1]/secret.jpg', label: 'bot-ipv6-private' },
      { isImage: true, _localDiskPath: '/etc/passwd', label: 'bot-forged-localDiskPath' },
    ];
    for (const atk of botAttacks) {
      const id = `msg_atk_bot_${atk.label}_${Date.now()}`;
      createdMsgIds.push(id);
      const res = await origFetch(`${appBase}/api/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botJwt}`,
          'Content-Type': 'application/json',
          'X-Account-Id': 'acc_telegram_bot',
        },
        body: JSON.stringify({ id, chatId: 'tg_123456', accountId: 'acc_telegram_bot', sender: 'me', ...atk }),
      });
      const data: any = await res.json();
      assert.equal(data.delivered, false, `Bot attack must fail: ${atk.label}`);
    }
    assert.equal(botApiCalls.length, 0, 'Bot Telegram API must never be called for blocked attacks');
    assert.equal(ssrfCanaryHits, 0);

    // 5. /api/telegram/send-voice blocks local paths & SSRF URLs
    for (const badAudio of [
      '/etc/passwd',
      '.env',
      '../../.env',
      'http://169.254.169.254/latest/meta-data/',
      `http://127.0.0.1:${canaryPort}/voice.ogg`,
      'http://[::1]/voice.ogg',
    ]) {
      const res = await origFetch(`${appBase}/api/telegram/send-voice`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${botJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: 'tg_123456', audioUrl: badAudio }),
      });
      assert.equal(res.status, 400, `/api/telegram/send-voice must return 400 for ${badAudio}`);
    }
    assert.equal(botApiCalls.length, 0);
    assert.equal(ssrfCanaryHits, 0);

    // 6. Retry endpoint blocks forged _localDiskPath / malicious DB row
    const evilDbId = `msg_evil_db_${Date.now()}`;
    createdMsgIds.push(evilDbId);
    await db
      .prepare(
        `INSERT INTO messages (id, chat_id, account_id, sender, text, is_file, file_name, file_url, timestamp, created_at, delivery_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(evilDbId, 'tg_123456', mtprotoAccId, 'me', '[文件] .env', 1, '.env', path.resolve('.env'), '12:00', Date.now(), 'failed');
    const evilRetryRes = await origFetch(`${appBase}/api/messages/${encodeURIComponent(evilDbId)}/retry`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mtprotoJwt}`,
        'Content-Type': 'application/json',
        'X-Account-Id': mtprotoAccId,
      },
      body: JSON.stringify({}),
    });
    const evilRetryJson: any = await evilRetryRes.json();
    assert.equal(evilRetryJson.delivered, false);
    assert.equal(sentMtprotoCalls.length, 0);

    // 6b. Retry endpoint with forged _localDiskPath in JSON body -> ignored/blocked
    const forgedRetryId = `msg_forged_retry_${Date.now()}`;
    createdMsgIds.push(forgedRetryId);
    const forgedRetryRes = await origFetch(`${appBase}/api/messages/${encodeURIComponent(forgedRetryId)}/retry`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mtprotoJwt}`,
        'Content-Type': 'application/json',
        'X-Account-Id': mtprotoAccId,
      },
      body: JSON.stringify({
        id: forgedRetryId,
        chatId: 'tg_123456',
        accountId: mtprotoAccId,
        sender: 'me',
        isImage: true,
        _localDiskPath: '/etc/passwd',
      }),
    });
    const forgedRetryJson: any = await forgedRetryRes.json();
    assert.equal(forgedRetryJson.delivered, false);
    assert.equal(sentMtprotoCalls.length, 0);

    // 6c. Multipart POST /api/messages with forged _localDiskPath in payload JSON (no file) -> ignored/blocked
    const forgedMpId = `msg_forged_mp_${Date.now()}`;
    createdMsgIds.push(forgedMpId);
    const forgedMpForm = new FormData();
    forgedMpForm.append(
      'payload',
      JSON.stringify({
        id: forgedMpId,
        chatId: 'tg_123456',
        sender: 'me',
        isImage: true,
        _localDiskPath: '/etc/passwd',
      })
    );
    const forgedMpRes = await origFetch(`${appBase}/api/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mtprotoJwt}`, 'X-Account-Id': mtprotoAccId },
      body: forgedMpForm,
    });
    const forgedMpJson: any = await forgedMpRes.json();
    assert.equal(forgedMpJson.delivered, false);
    assert.equal(sentMtprotoCalls.length, 0);

    // 6d. Direct Bot sender defense-in-depth checks (bypassing deliverOutboundTelegramMessage)
    assert.equal(await sendTelegramPhoto('tg_123456', '/etc/passwd'), null);
    assert.equal(await sendTelegramPhoto('tg_123456', '.env'), null);
    assert.equal(await sendTelegramPhoto('tg_123456', 'http://169.254.169.254/latest/meta-data/'), null);
    assert.equal(await sendTelegramVideo('tg_123456', '/etc/passwd'), null);
    assert.equal(await sendTelegramVideo('tg_123456', `http://127.0.0.1:${canaryPort}/v.mp4`), null);
    assert.equal(await sendTelegramDocument('tg_123456', 'data/telegram_pro.db', 'db.sqlite'), null);
    assert.equal(await sendTelegramDocument('tg_123456', 'http://[::1]/secret.txt', 'secret.txt'), null);
    assert.equal(await sendTelegramVoice('tg_123456', '/etc/passwd'), null);
    assert.equal(await sendTelegramVoice('tg_123456', 'http://[::ffff:127.0.0.1]/v.ogg'), null);
    assert.equal(botApiCalls.length, 0);
    assert.equal(ssrfCanaryHits, 0);

    // 7. GET /api/messages/local-media rejects symlink & traversal
    const symGetRes = await origFetch(`${appBase}/api/messages/local-media/${encodeURIComponent(httpSymlinkName)}`, {
      headers: { Authorization: `Bearer ${mtprotoJwt}` },
    });
    assert.equal(symGetRes.status, 404);

    // 8. Normal media sending compatibility regression tests (Image, Video, Audio, Document)
    const uploadAndSend = async (opts: {
      jwt: string;
      accountId: string;
      payload: Record<string, any>;
      fileBytes: Buffer;
      fileName: string;
      mime: string;
    }) => {
      const form = new FormData();
      form.append('payload', JSON.stringify(opts.payload));
      form.append('file', new Blob([new Uint8Array(opts.fileBytes)], { type: opts.mime }), opts.fileName);
      const res = await origFetch(`${appBase}/api/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.jwt}`,
          'X-Account-Id': opts.accountId,
        },
        body: form,
      });
      return res.json() as Promise<any>;
    };

    // 8a. MTProto Photo upload + local-media GET + Range GET
    const imgId = `msg_ok_img_${Date.now()}`;
    createdMsgIds.push(imgId);
    const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const imgRes = await uploadAndSend({
      jwt: mtprotoJwt,
      accountId: mtprotoAccId,
      payload: { id: imgId, chatId: 'tg_123456', sender: 'me', isImage: true, text: 'hello photo' },
      fileBytes: pngBytes,
      fileName: 'sample.png',
      mime: 'image/png',
    });
    assert.equal(imgRes.delivered, true, `Expected MTProto image delivery true, got error: ${imgRes.error}`);
    assert.equal(imgRes.channel, 'mtproto');
    assert.ok(imgRes.imageUrl.startsWith('/api/messages/local-media/'));
    const imgFileKey = decodeURIComponent(imgRes.imageUrl.split('/api/messages/local-media/')[1].split('?')[0]);
    createdDiskFiles.push(path.join(OUTBOUND_MEDIA_DIR, imgFileKey));

    const getMediaRes = await origFetch(`${appBase}${imgRes.imageUrl}`, {
      headers: { Authorization: `Bearer ${mtprotoJwt}` },
    });
    assert.equal(getMediaRes.status, 200);
    assert.deepEqual(Buffer.from(await getMediaRes.arrayBuffer()), pngBytes);

    const rangeMediaRes = await origFetch(`${appBase}${imgRes.imageUrl}`, {
      headers: { Authorization: `Bearer ${mtprotoJwt}`, Range: 'bytes=0-3' },
    });
    assert.equal(rangeMediaRes.status, 206);
    assert.deepEqual(Buffer.from(await rangeMediaRes.arrayBuffer()), pngBytes.subarray(0, 4));

    // 8b. MTProto Video upload
    const vidId = `msg_ok_vid_${Date.now()}`;
    createdMsgIds.push(vidId);
    const mp4Bytes = Buffer.from('FAKE_MP4_STREAM_CONTENT');
    const vidRes = await uploadAndSend({
      jwt: mtprotoJwt,
      accountId: mtprotoAccId,
      payload: { id: vidId, chatId: 'tg_123456', sender: 'me', isVideo: true, videoDuration: 5 },
      fileBytes: mp4Bytes,
      fileName: 'clip.mp4',
      mime: 'video/mp4',
    });
    assert.equal(vidRes.delivered, true);
    assert.ok(vidRes.videoUrl.startsWith('/api/messages/local-media/'));
    createdDiskFiles.push(
      path.join(OUTBOUND_MEDIA_DIR, decodeURIComponent(vidRes.videoUrl.split('/api/messages/local-media/')[1].split('?')[0]))
    );

    // 8c. MTProto Voice upload (valid OggS header -> bypasses ffmpeg safely)
    const audId = `msg_ok_aud_${Date.now()}`;
    createdMsgIds.push(audId);
    const audRes = await uploadAndSend({
      jwt: mtprotoJwt,
      accountId: mtprotoAccId,
      payload: { id: audId, chatId: 'tg_123456', sender: 'me', isAudio: true, audioDuration: 2 },
      fileBytes: VALID_OGG_HEADER_BYTES,
      fileName: 'voice.ogg',
      mime: 'audio/ogg',
    });
    assert.equal(audRes.delivered, true);
    assert.ok(audRes.audioUrl.startsWith('/api/messages/local-media/'));
    createdDiskFiles.push(
      path.join(OUTBOUND_MEDIA_DIR, decodeURIComponent(audRes.audioUrl.split('/api/messages/local-media/')[1].split('?')[0]))
    );

    // 8d. MTProto Document upload + DB-backed retry
    const docId = `msg_ok_doc_${Date.now()}`;
    createdMsgIds.push(docId);
    const docBytes = Buffer.from('Quarterly report PDF content');
    const docRes = await uploadAndSend({
      jwt: mtprotoJwt,
      accountId: mtprotoAccId,
      payload: { id: docId, chatId: 'tg_123456', sender: 'me', isFile: true, fileName: 'report.pdf' },
      fileBytes: docBytes,
      fileName: 'report.pdf',
      mime: 'application/pdf',
    });
    assert.equal(docRes.delivered, true);
    assert.ok(docRes.fileUrl.startsWith('/api/messages/local-media/'));
    createdDiskFiles.push(
      path.join(OUTBOUND_MEDIA_DIR, decodeURIComponent(docRes.fileUrl.split('/api/messages/local-media/')[1].split('?')[0]))
    );

    const callsBeforeRetry = sentMtprotoCalls.length;
    const retryValidRes = await origFetch(`${appBase}/api/messages/${encodeURIComponent(docId)}/retry`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mtprotoJwt}`,
        'Content-Type': 'application/json',
        'X-Account-Id': mtprotoAccId,
      },
      body: JSON.stringify({}),
    });
    const retryValidJson: any = await retryValidRes.json();
    assert.equal(retryValidJson.delivered, true);
    assert.equal(sentMtprotoCalls.length, callsBeforeRetry + 1);

    // 8e. Bot channel normal photo, video, voice & document + /api/telegram/send-voice with controlled local-media
    for (const botCase of [
      { payload: { id: `msg_bot_img_${Date.now()}`, chatId: 'tg_123456', accountId: 'acc_telegram_bot', sender: 'me', isImage: true }, bytes: pngBytes, name: 'b.png', mime: 'image/png', urlField: 'imageUrl', expectedEndpoint: '/sendPhoto' },
      { payload: { id: `msg_bot_vid_${Date.now()}`, chatId: 'tg_123456', accountId: 'acc_telegram_bot', sender: 'me', isVideo: true, videoDuration: 3 }, bytes: mp4Bytes, name: 'b.mp4', mime: 'video/mp4', urlField: 'videoUrl', expectedEndpoint: '/sendVideo' },
      { payload: { id: `msg_bot_aud_${Date.now()}`, chatId: 'tg_123456', accountId: 'acc_telegram_bot', sender: 'me', isAudio: true, audioDuration: 2 }, bytes: VALID_OGG_HEADER_BYTES, name: 'b.ogg', mime: 'audio/ogg', urlField: 'audioUrl', expectedEndpoint: '/sendVoice' },
      { payload: { id: `msg_bot_doc_${Date.now()}`, chatId: 'tg_123456', accountId: 'acc_telegram_bot', sender: 'me', isFile: true, fileName: 'b.pdf' }, bytes: docBytes, name: 'b.pdf', mime: 'application/pdf', urlField: 'fileUrl', expectedEndpoint: '/sendDocument' },
    ]) {
      createdMsgIds.push(botCase.payload.id);
      const r = await uploadAndSend({
        jwt: botJwt,
        accountId: 'acc_telegram_bot',
        payload: botCase.payload,
        fileBytes: botCase.bytes,
        fileName: botCase.name,
        mime: botCase.mime,
      });
      assert.equal(r.delivered, true);
      assert.equal(r.channel, 'bot');
      assert.ok(botApiCalls.some((c) => c.url.endsWith(botCase.expectedEndpoint)));
      const savedUrl = r[botCase.urlField];
      if (typeof savedUrl === 'string' && savedUrl.includes('/api/messages/local-media/')) {
        createdDiskFiles.push(
          path.join(OUTBOUND_MEDIA_DIR, decodeURIComponent(savedUrl.split('/api/messages/local-media/')[1].split('?')[0]))
        );
      }
    }

    const sendVoiceOkRes = await origFetch(`${appBase}/api/telegram/send-voice`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${botJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: 'tg_123456',
        audioUrl: audRes.audioUrl,
        duration: 2,
      }),
    });
    assert.equal(sendVoiceOkRes.status, 200);
    const sendVoiceOkJson: any = await sendVoiceOkRes.json();
    assert.equal(sendVoiceOkJson.ok, true);

    // 8f. Normal data:image/png;base64,... sending compatibility (MTProto + Bot)
    const dataImgMtId = `msg_data_mt_${Date.now()}`;
    const dataImgBotId = `msg_data_bot_${Date.now()}`;
    createdMsgIds.push(dataImgMtId, dataImgBotId);
    const dataUrlImg = `data:image/png;base64,${pngBytes.toString('base64')}`;
    const dataMtRes = await origFetch(`${appBase}/api/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mtprotoJwt}`, 'Content-Type': 'application/json', 'X-Account-Id': mtprotoAccId },
      body: JSON.stringify({ id: dataImgMtId, chatId: 'tg_123456', sender: 'me', isImage: true, imageUrl: dataUrlImg }),
    });
    assert.equal(((await dataMtRes.json()) as any).delivered, true);
    const dataBotRes = await origFetch(`${appBase}/api/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${botJwt}`, 'Content-Type': 'application/json', 'X-Account-Id': 'acc_telegram_bot' },
      body: JSON.stringify({ id: dataImgBotId, chatId: 'tg_123456', accountId: 'acc_telegram_bot', sender: 'me', isImage: true, imageUrl: dataUrlImg }),
    });
    assert.equal(((await dataBotRes.json()) as any).delivered, true);
  } finally {
    globalThis.fetch = origFetch;
    connectedUserClients.delete(mtprotoAccId);
    if (createdMsgIds.length > 0) {
      const placeholders = createdMsgIds.map(() => '?').join(',');
      await db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...createdMsgIds).catch(() => {});
    }
    for (const f of createdDiskFiles) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch {}
      }
    }
    if (fs.existsSync(httpSymlinkPath)) {
      try { fs.unlinkSync(httpSymlinkPath); } catch {}
    }
    fs.rmSync(outsideTmp, { recursive: true, force: true });
    srv.closeAllConnections?.();
    canaryServer.closeAllConnections?.();
    await new Promise<void>((r) => srv.close(() => r()));
    await new Promise<void>((r) => canaryServer.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
    if (prevBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevBotToken;
  }
});
