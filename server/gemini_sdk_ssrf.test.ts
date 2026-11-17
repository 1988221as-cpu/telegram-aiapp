import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

process.env.NODE_ENV = 'test';
process.env.AIS_TEST_IMPORT = 'true';

before(async () => {
  const { initDatabase } = await import('./db.ts');
  await initDatabase();
});

function createSignedMemberJwt(secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'user_ssrf_test',
      id: 'user_ssrf_test',
      userId: 'user_ssrf_test',
      username: 'ssrf_tester',
      role: 'member',
      plan: 'pro',
      exp: nowSec + 3600,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

test('safeSsrfFetch hardens protocol, credentials, ports, IPv4/IPv6, mixed DNS A/AAAA, DNS Rebinding, redirects & SOCKS5', async () => {
  const {
    safeSsrfFetch,
    validateSafeSsrfTargetUrl,
    safeSsrfFetchForSdk,
  } = await import('../server.ts');

  // 1. Illegal protocols, credentials, blocked ports, non-canonical numeric hostnames
  for (const badUrl of [
    'file:///etc/passwd',
    'file://localhost/etc/passwd',
    'ftp://example.com/file.bin',
    'gopher://127.0.0.1:6379/_INFO',
    'https://user:pass@generativelanguage.googleapis.com/v1beta',
    'https://api.example.com:0/v1beta',
    'https://api.example.com:22/v1beta',
    'https://api.example.com:3306/v1beta',
    'https://api.example.com:6379/v1beta',
    'https://api.example.com:27017/v1beta',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/v1beta',
    'http://172.16.0.10/v1beta',
    'http://192.168.1.20/v1beta',
    'http://127.0.0.2/v1beta',
    'http://0.0.0.0/v1beta',
    'http://sub.localhost/v1beta',
    'http://[fe80::1]/v1beta',
    'http://[fc00::1]/v1beta',
    'http://[::ffff:127.0.0.1]/v1beta',
    'http://[::ffff:169.254.169.254]/v1beta',
    'http://0x7f000001/v1beta',
    'http://2130706433/v1beta',
    'http://0177.0.0.1/v1beta',
    'http://127.1/v1beta',
  ]) {
    await assert.rejects(
      () => safeSsrfFetch(badUrl),
      /SSRF 安全拦截/,
      `Expected SSRF block for ${badUrl}`
    );
  }

  // 2. Production HTTPS enforcement for remote hosts while keeping localhost Ollama / LM Studio HTTP allowed
  await assert.rejects(
    () =>
      validateSafeSsrfTargetUrl('http://custom-gateway.example.com/v1beta', {
        isProductionOverride: true,
        dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
      }),
    /SSRF 安全拦截.*https:\/\//
  );
  for (const localOk of [
    'http://127.0.0.1:11434/v1',
    'http://localhost:1234/v1',
    'http://[::1]:11434/v1',
  ]) {
    const res = await validateSafeSsrfTargetUrl(localOk, { isProductionOverride: true });
    assert.equal(res.isLocalAiEndpoint, true);
  }

  // 3. Mixed DNS A + AAAA resolution (any private/link-local/loopback record must reject)
  await assert.rejects(
    () =>
      safeSsrfFetch('https://mixed-dns.example.com/v1beta/models', {}, {
        dnsLookup: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: 'fe80::1', family: 6 },
        ],
      }),
    /SSRF 安全拦截.*fe80::1/
  );
  await assert.rejects(
    () =>
      safeSsrfFetch('https://mixed-v6-loopback.example.com/v1beta/models', {}, {
        dnsLookup: async () => [
          { address: '2001:4860:4860::8888', family: 6 },
          { address: '::1', family: 6 },
        ],
      }),
    /SSRF 安全拦截.*::1/
  );

  // 4. DNS Rebinding protection: verify pinned IP is bound on actual socket request and DNS is NOT re-queried
  let dnsCalls = 0;
  let capturedLookupResult: Array<{ address: string; family: number }> = [];
  let capturedHostHeader = '';
  let capturedServername = '';

  const localGateway = http.createServer((req, res) => {
    capturedHostHeader = String(req.headers.host || '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url: req.url }));
  });
  await new Promise<void>((resolve) => localGateway.listen(0, '127.0.0.1', resolve));
  const localPort = (localGateway.address() as AddressInfo).port;

  try {
    const pinnedRes = await safeSsrfFetch(
      `http://rebind-test.example.com:${localPort}/v1beta/models`,
      { method: 'GET', headers: { 'x-test': '1' } },
      {
        isProductionOverride: false,
        dnsLookup: async () => {
          dnsCalls += 1;
          // 1st resolution returns vetted public IP; even if attacker flipped DNS on a 2nd call, 2nd call must never happen!
          return dnsCalls === 1
            ? [{ address: '93.184.216.34', family: 4 }]
            : [{ address: '169.254.169.254', family: 4 }];
        },
        requestImpl: ((opts: any, cb: any) => {
          assert.equal(typeof opts.lookup, 'function', 'Pinned lookup function must be passed to http.request');
          opts.lookup('rebind-test.example.com', { all: true }, (_err: any, list: any) => {
            capturedLookupResult = list;
          });
          capturedServername = String(opts.servername || '');
          // Route TCP connection to our local test server only AFTER inspecting the pinned lookup output
          return http.request(
            {
              host: '127.0.0.1',
              port: localPort,
              path: opts.path,
              method: opts.method,
              headers: opts.headers,
              agent: false,
            },
            cb
          );
        }) as any,
      }
    );
    assert.equal(pinnedRes.status, 200);
    assert.equal(dnsCalls, 1, 'DNS must be resolved exactly once per hop');
    assert.deepEqual(capturedLookupResult, [{ address: '93.184.216.34', family: 4 }]);
    assert.equal(capturedHostHeader, `rebind-test.example.com:${localPort}`);
    assert.equal(capturedServername, '');

    // 5. Redirect re-validation (must block redirects to localhost/metadata/private IP, and re-validate safe redirects)
    const redirectServer = http.createServer((req, res) => {
      if (req.url === '/to-metadata') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      }
      if (req.url === '/to-localhost') {
        res.writeHead(302, { Location: `http://127.0.0.1:${localPort}/secret` });
        res.end();
        return;
      }
      if (req.url === '/to-cross-origin') {
        res.writeHead(302, { Location: `http://other-public.example.com:${localPort}/final` });
        res.end();
        return;
      }
      if (req.url === '/final') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ redirectedAuth: req.headers.authorization || null }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => redirectServer.listen(0, '127.0.0.1', resolve));
    const redirPort = (redirectServer.address() as AddressInfo).port;

    const redirectHook = (opts: any, cb: any) =>
      http.request(
        {
          host: '127.0.0.1',
          port: redirPort,
          path: opts.path,
          method: opts.method,
          headers: opts.headers,
          agent: false,
        },
        cb
      );

    try {
      await assert.rejects(
        () =>
          safeSsrfFetch(`http://public-redir.example.com:${redirPort}/to-metadata`, {}, {
            isProductionOverride: false,
            dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
            requestImpl: redirectHook as any,
          }),
        /SSRF 安全拦截/
      );

      await assert.rejects(
        () =>
          safeSsrfFetch(`http://public-redir.example.com:${redirPort}/to-localhost`, {}, {
            isProductionOverride: false,
            dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
            requestImpl: redirectHook as any,
          }),
        /SSRF 安全拦截/
      );

      const safeRedirectRes = await safeSsrfFetch(
        `http://public-redir.example.com:${redirPort}/to-cross-origin`,
        { headers: { Authorization: 'Bearer secret-token' } },
        {
          isProductionOverride: false,
          dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
          requestImpl: redirectHook as any,
        }
      );
      assert.equal(safeRedirectRes.status, 200);
      const safeRedirJson: any = await safeRedirectRes.json();
      assert.equal(safeRedirJson.redirectedAuth, null, 'Cross-origin redirect must strip Authorization header');
    } finally {
      redirectServer.closeAllConnections?.();
      await new Promise<void>((r) => redirectServer.close(() => r()));
    }

    // 6. SOCKS5 proxy hardening: IPv6 bracket handling, DNS failure rejection, private IP blocking, pinned IP destination
    const prevProxy = process.env.TG_SOCKS_PROXY;
    process.env.TG_SOCKS_PROXY = 'socks5://127.0.0.1:10808';
    let socksDialCalls = 0;
    try {
      const socksSpy = async () => {
        socksDialCalls += 1;
        throw new Error('Should not dial SOCKS5 for blocked targets');
      };

      await assert.rejects(
        () => safeSsrfFetch('http://[fe80::1]/v1beta', {}, { isProductionOverride: false, socksConnectImpl: socksSpy as any }),
        /SSRF 安全拦截/
      );
      await assert.rejects(
        () => safeSsrfFetch('http://169.254.169.254/latest/meta-data/', {}, { isProductionOverride: false, socksConnectImpl: socksSpy as any }),
        /SSRF 安全拦截/
      );
      await assert.rejects(
        () =>
          safeSsrfFetch(
            'https://unresolvable-socks5.invalid/v1beta',
            {},
            {
              dnsLookup: async () => {
                throw new Error('ENOTFOUND');
              },
              socksConnectImpl: socksSpy as any,
            }
          ),
        /SSRF 安全拦截.*域名无法解析/
      );
      assert.equal(socksDialCalls, 0, 'SOCKS5 must never dial blocked IPv6/metadata/unresolvable targets');

      // Valid remote target through SOCKS5 must pass pinned IP (not unpinned domain) to SocksClient.createConnection
      let socksDestHost = '';
      const validSocksRes = await safeSsrfFetch(
        `http://socks-valid.example.com:${localPort}/v1beta/models`,
        {},
        {
          isProductionOverride: false,
          dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
          socksConnectImpl: (async (opts: any) => {
            socksDestHost = opts.destination.host;
            const netMod = await import('node:net');
            const socket = netMod.default.createConnection({ host: '127.0.0.1', port: localPort });
            await new Promise<void>((res, rej) => {
              socket.once('connect', res);
              socket.once('error', rej);
            });
            return { socket } as any;
          }) as any,
        }
      );
      assert.equal(validSocksRes.status, 200);
      assert.equal(socksDestHost, '93.184.216.34');
    } finally {
      if (prevProxy === undefined) delete process.env.TG_SOCKS_PROXY;
      else process.env.TG_SOCKS_PROXY = prevProxy;
    }

    // 7. safeSsrfFetchForSdk supports string, URL, and Request (with method, headers, body, signal)
    const reqObj = new globalThis.Request(`http://127.0.0.1:${localPort}/sdk-req`, {
      method: 'POST',
      headers: { 'x-sdk-hdr': 'ok' },
      body: JSON.stringify({ hello: 'world' }),
    });
    const rStr = await safeSsrfFetchForSdk(`http://127.0.0.1:${localPort}/sdk-str`);
    const rUrl = await safeSsrfFetchForSdk(new URL(`http://127.0.0.1:${localPort}/sdk-url`));
    const rReq = await safeSsrfFetchForSdk(reqObj);
    assert.equal(rStr.status, 200);
    assert.equal(rUrl.status, 200);
    assert.equal(rReq.status, 200);
  } finally {
    localGateway.closeAllConnections?.();
    await new Promise<void>((r) => localGateway.close(() => r()));
  }
});

test('All 4 Gemini SDK custom baseUrl paths enforce safeSsrfFetch & preserve local/custom/official compatibility', async () => {
  const {
    app,
    createGeminiClient,
    createCustomGeminiClient,
    generateTtsAudio,
    transcribeAudioBufferStrictly,
  } = await import('../server.ts');

  const prevJwtSecret = process.env.JWT_SECRET;
  const jwtSecret = 'test_gemini_sdk_ssrf_secret_32bytes_min';
  process.env.JWT_SECRET = jwtSecret;
  const jwt = createSignedMemberJwt(jwtSecret);

  // Canary server simulates a forbidden internal service; must receive ZERO requests during SSRF attempts
  let canaryHits = 0;
  const canaryServer = http.createServer((_req, res) => {
    canaryHits += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ leaked: true }));
  });

  // Real local mock Gemini gateway on 127.0.0.1 (represents local desktop AI / Ollama / custom gateway)
  const receivedPaths: string[] = [];
  const receivedHeaders: Array<Record<string, any>> = [];
  const mockGeminiServer = http.createServer(async (req, res) => {
    receivedPaths.push(String(req.url || ''));
    receivedHeaders.push(req.headers);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const isTts = bodyText.includes('AUDIO') || String(req.url || '').includes('tts');
    if (isTts) {
      const dummyWav = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ').toString('base64');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ inlineData: { mimeType: 'audio/wav', data: dummyWav } }],
              },
            },
          ],
        })
      );
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Verified Gemini Gateway Transcript' }],
            },
          },
        ],
      })
    );
  });

  const appServer = http.createServer(app);
  await new Promise<void>((r) => canaryServer.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => mockGeminiServer.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));

  const geminiPort = (mockGeminiServer.address() as AddressInfo).port;
  const appBase = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;

  try {
    // A. Official Gemini client factory remains intact and constructs valid GoogleGenAI instance
    const officialClient = createGeminiClient('AIzaTestOfficialKey123');
    assert.ok(officialClient);
    assert.equal(typeof officialClient.models.generateContent, 'function');

    // B. createCustomGeminiClient blocks private IPs, metadata, file://, DNS resolving to internal IP, and unpinned rebinds
    for (const ssrfBase of [
      'http://169.254.169.254/v1beta',
      'http://10.0.0.1/v1beta',
      'http://192.168.1.1/v1',
      'http://[fe80::1]/v1beta',
      'http://[::ffff:169.254.169.254]/v1beta',
      'file:///etc/passwd',
      'https://user:pass@generativelanguage.googleapis.com/v1beta',
    ]) {
      await assert.rejects(
        () => createCustomGeminiClient({ baseUrl: ssrfBase, apiKey: 'k' }),
        /SSRF 安全拦截/,
        `createCustomGeminiClient must block ${ssrfBase}`
      );
    }

    await assert.rejects(
      () =>
        createCustomGeminiClient({
          baseUrl: 'https://dns-evil.example.com/v1beta',
          apiKey: 'k',
          _hooks: {
            dnsLookup: async () => [{ address: '169.254.169.254', family: 4 }],
          },
        }),
      /SSRF 安全拦截/
    );

    // C. Real network round-trip through GoogleGenAI + safeSsrfFetchForSdk against a custom gateway (simulated public DNS -> local socket)
    let customDnsCalls = 0;
    const customPublicClient = await createCustomGeminiClient({
      baseUrl: `http://custom-gemini.example.com:${geminiPort}/v1beta`,
      apiKey: 'sk-custom-gemini',
      _hooks: {
        isProductionOverride: false,
        dnsLookup: async () => {
          customDnsCalls += 1;
          return [{ address: '93.184.216.34', family: 4 }];
        },
        requestImpl: ((opts: any, cb: any) => {
          let pinned = '';
          opts.lookup('custom-gemini.example.com', (_e: any, addr: string) => {
            pinned = addr;
          });
          assert.equal(pinned, '93.184.216.34');
          return http.request(
            {
              host: '127.0.0.1',
              port: geminiPort,
              path: opts.path,
              method: opts.method,
              headers: opts.headers,
              agent: false,
            },
            cb
          );
        }) as any,
      },
    });
    const sdkResp = await customPublicClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'Ping' }] }],
    });
    assert.equal(sdkResp.text?.trim(), 'Verified Gemini Gateway Transcript');
    assert.ok(customDnsCalls >= 1);

    // D. All 4 production call paths block SSRF (169.254.169.254, 10.0.0.1, [fe80::1], file://)
    const ssrfTargets = [
      'http://169.254.169.254/v1beta',
      'http://10.0.0.8/v1beta',
      'http://[fe80::1]/v1beta',
      'file:///etc/passwd',
    ];
    const dummyAudioB64 = Buffer.from('OggS-test-audio-payload').toString('base64');

    for (const badBase of ssrfTargets) {
      // Path 1: POST /api/audio/transcribe
      const r1 = await fetch(`${appBase}/api/audio/transcribe`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audioBase64: `data:audio/ogg;base64,${dummyAudioB64}`,
          mimeType: 'audio/ogg',
          model: 'gemini-2.5-flash',
          customConfig: {
            enabled: true,
            explicitlyDisabled: false,
            engineMode: 'custom',
            protocol: 'gemini',
            baseUrl: badBase,
            apiKey: 'sk-test',
            modelName: 'gemini-2.5-flash',
          },
        }),
      });
      assert.ok(r1.status >= 400, `Path 1 (/api/audio/transcribe) must reject ${badBase}`);
      const j1: any = await r1.json();
      assert.match(String(j1.error || ''), /SSRF 安全拦截|无效/);

      // Path 2: POST /api/audio/tts-clone (invokeGeminiNativeTts)
      const r2 = await fetch(`${appBase}/api/audio/tts-clone`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Hello SSRF check',
          voiceName: 'Kore',
          model: 'gemini-3.8-flash-tts',
          customConfig: {
            enabled: true,
            explicitlyDisabled: false,
            engineMode: 'custom',
            protocol: 'gemini',
            baseUrl: badBase,
            apiKey: 'sk-test',
            modelName: 'gemini-3.8-flash-tts',
          },
        }),
      });
      assert.ok(r2.status >= 400, `Path 2 (/api/audio/tts-clone) must reject ${badBase}`);
      const j2: any = await r2.json();
      assert.match(String(j2.error || j2.message || ''), /SSRF 安全拦截|无效/);

      // Path 3: generateTtsAudio -> tryGeminiNativeCustomTts
      await assert.rejects(
        () =>
          generateTtsAudio('Hello SSRF', 'Kore', 'Warm', {
            enabled: true,
            explicitlyDisabled: false,
            engineMode: 'custom',
            protocol: 'gemini',
            baseUrl: badBase,
            apiKey: 'sk-test',
            modelName: 'gemini-3.8-flash-tts',
          }),
        /SSRF 安全拦截|无效/
      );

      // Path 4: transcribeAudioBufferStrictly
      const r4 = await transcribeAudioBufferStrictly(
        Buffer.from('OggS-test-audio-payload'),
        'audio/ogg',
        {
          enabled: true,
          explicitlyDisabled: false,
          engineMode: 'custom',
          protocol: 'gemini',
          baseUrl: badBase,
          apiKey: 'sk-test',
          modelName: 'gemini-2.5-flash',
        },
        'gemini-2.5-flash'
      );
      assert.equal(r4.ok, false);
      assert.match(String(r4.error || ''), /SSRF 安全拦截|无效/);
    }
    assert.equal(canaryHits, 0, 'Canary internal server must never be reached');

    // E. Positive end-to-end regression on ALL 4 Gemini SDK paths via real localhost HTTP gateway
    const localGatewayBase = `http://127.0.0.1:${geminiPort}/v1beta`;
    receivedPaths.length = 0;

    // Path 1 positive: POST /api/audio/transcribe
    const ok1 = await fetch(`${appBase}/api/audio/transcribe`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audioBase64: `data:audio/ogg;base64,${dummyAudioB64}`,
        mimeType: 'audio/ogg',
        model: 'gemini-2.5-flash',
        customConfig: {
          enabled: true,
          explicitlyDisabled: false,
          engineMode: 'custom',
          protocol: 'gemini',
          baseUrl: localGatewayBase,
          apiKey: 'sk-local-gemini',
          modelName: 'gemini-2.5-flash',
        },
      }),
    });
    assert.equal(ok1.status, 200);
    const ok1Json: any = await ok1.json();
    assert.equal(ok1Json.text, 'Verified Gemini Gateway Transcript');

    // Path 2 positive: POST /api/audio/tts-clone
    const ok2 = await fetch(`${appBase}/api/audio/tts-clone`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Hello local Gemini TTS',
        voiceName: 'Kore',
        model: 'gemini-3.8-flash-tts',
        customConfig: {
          enabled: true,
          explicitlyDisabled: false,
          engineMode: 'custom',
          protocol: 'gemini',
          baseUrl: localGatewayBase,
          apiKey: 'sk-local-gemini',
          modelName: 'gemini-3.8-flash-tts',
        },
      }),
    });
    assert.equal(ok2.status, 200);
    const ok2Json: any = await ok2.json();
    assert.ok(String(ok2Json.audioUrl || '').startsWith('data:audio/wav;base64,'));
    assert.equal(ok2Json.modelUsed, 'gemini-3.8-flash-tts');

    // Path 3 positive: generateTtsAudio
    const ok3 = await generateTtsAudio('Auto voice reply', 'Kore', 'Warm', {
      enabled: true,
      explicitlyDisabled: false,
      engineMode: 'custom',
      protocol: 'gemini',
      baseUrl: localGatewayBase,
      apiKey: 'sk-local-gemini',
      modelName: 'gemini-3.8-flash-tts',
    });
    assert.ok(ok3.audioUrl.startsWith('data:audio/wav;base64,'));

    // Path 4 positive: transcribeAudioBufferStrictly
    const ok4 = await transcribeAudioBufferStrictly(
      Buffer.from('OggS-test-audio-payload'),
      'audio/ogg',
      {
        enabled: true,
        explicitlyDisabled: false,
        engineMode: 'custom',
        protocol: 'gemini',
        baseUrl: localGatewayBase,
        apiKey: 'sk-local-gemini',
        modelName: 'gemini-2.5-flash',
      },
      'gemini-2.5-flash'
    );
    assert.equal(ok4.ok, true);
    assert.equal(ok4.text, 'Verified Gemini Gateway Transcript');

    assert.equal(
      receivedPaths.filter((p) => p.includes(':generateContent')).length,
      4,
      'All 4 custom Gemini SDK paths must hit real :generateContent endpoint via safeSsrfFetchForSdk'
    );
    assert.ok(
      receivedHeaders.every((h) => String(h['user-agent'] || '').includes('aistudio-build')),
      'All SDK calls must preserve User-Agent header'
    );
  } finally {
    canaryServer.closeAllConnections?.();
    mockGeminiServer.closeAllConnections?.();
    appServer.closeAllConnections?.();
    await new Promise<void>((r) => canaryServer.close(() => r()));
    await new Promise<void>((r) => mockGeminiServer.close(() => r()));
    await new Promise<void>((r) => appServer.close(() => r()));
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});
