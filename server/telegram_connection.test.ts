import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

process.env.NODE_ENV = 'test';
process.env.AIS_TEST_IMPORT = 'true';

import type { ConnectedTelegramUser } from '../server.ts';
import {
  normalizeTelegramPhoneClient,
  resolveTelegramAccountIdentity,
  evaluateTelegramAccountUiState,
  TRANSIENT_DISCONNECT_GRACE_MS,
} from '../src/services/telegramConnectionStatus.ts';
import { db, initDatabase } from './db.ts';

let app!: typeof import('../server.ts')['app'];
let connectedUserClients!: typeof import('../server.ts')['connectedUserClients'];
let telegramAccountRuntimeStates!: typeof import('../server.ts')['telegramAccountRuntimeStates'];
let telegramAccountFloodCooldowns!: typeof import('../server.ts')['telegramAccountFloodCooldowns'];
let recentlyExpiredAccounts!: typeof import('../server.ts')['recentlyExpiredAccounts'];
let resolveTelegramAccountRuntimeKey!: typeof import('../server.ts')['resolveTelegramAccountRuntimeKey'];
let getOrCreateTelegramAccountRuntimeState!: typeof import('../server.ts')['getOrCreateTelegramAccountRuntimeState'];
let getTelegramProxyFingerprint!: typeof import('../server.ts')['getTelegramProxyFingerprint'];
let getTelegramAccountConnectionSnapshot!: typeof import('../server.ts')['getTelegramAccountConnectionSnapshot'];
let withTelegramTimeout!: typeof import('../server.ts')['withTelegramTimeout'];
let probeTelegramTransportEndpoint!: typeof import('../server.ts')['probeTelegramTransportEndpoint'];
let destroyTelegramClientSafely!: typeof import('../server.ts')['destroyTelegramClientSafely'];
let markTelegramSessionExpired!: typeof import('../server.ts')['markTelegramSessionExpired'];
let restoreTelegramUserSessionsOnStartup!: typeof import('../server.ts')['restoreTelegramUserSessionsOnStartup'];
let triggerProxyChangeRecovery!: typeof import('../server.ts')['triggerProxyChangeRecovery'];
let runTelegramConnectionWatchdogCycle!: typeof import('../server.ts')['runTelegramConnectionWatchdogCycle'];
let handleSystemResumeWakeup!: typeof import('../server.ts')['handleSystemResumeWakeup'];
let clearTelegramFloodCooldown!: typeof import('../server.ts')['clearTelegramFloodCooldown'];
let getTelegramFloodCooldown!: typeof import('../server.ts')['getTelegramFloodCooldown'];
let encryptSensitiveData!: typeof import('../server.ts')['encryptSensitiveData'];
let saveSystemProxyConfigToDb!: typeof import('../server.ts')['saveSystemProxyConfigToDb'];
let loadSystemProxyConfigFromDb!: typeof import('../server.ts')['loadSystemProxyConfigFromDb'];

function createTestJwt(secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'usr_tg_conn_test',
      id: 'usr_tg_conn_test',
      userId: 'usr_tg_conn_test',
      username: 'tg_resilience_tester',
      role: 'member',
      plan: 'pro',
      vipExpiresAt: Date.now() + 86_400_000,
      exp: nowSec + 3600,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function makeFakeGramJsClient(opts?: {
  initiallyConnected?: boolean;
  connectImpl?: () => Promise<boolean | void>;
  isUserAuthorizedImpl?: () => Promise<boolean>;
  getMeImpl?: () => Promise<any>;
  onDestroy?: () => void;
  onReconnect?: () => void;
}) {
  const senderConn = {
    _connected: Boolean(opts?.initiallyConnected),
    isConnected() {
      return this._connected;
    },
    disconnectCalled: 0,
    disconnect() {
      this.disconnectCalled += 1;
      this._connected = false;
    },
  };
  const sender = {
    userDisconnected: false,
    isConnecting: false,
    _connecting: false,
    isReconnecting: false,
    _reconnecting: false,
    _disconnected: !opts?.initiallyConnected,
    _autoReconnect: true,
    _retries: 3,
    _reconnectRetries: 3,
    _connection: senderConn,
    reconnectCalled: 0,
    reconnect() {
      this.reconnectCalled += 1;
      opts?.onReconnect?.();
    },
    async _reconnect() {
      this.userDisconnected = false;
      senderConn._connected = true;
    },
  };
  const client: any = {
    connected: Boolean(opts?.initiallyConnected),
    _destroyed: false,
    _sender: sender,
    connectCalls: 0,
    destroyCalls: 0,
    setLogLevel() {},
    addEventHandler() {},
    async connect() {
      this.connectCalls += 1;
      sender.isConnecting = true;
      try {
        const res = opts?.connectImpl ? await opts.connectImpl() : true;
        if (res === false) {
          this.connected = false;
          senderConn._connected = false;
          return false;
        }
        if (!sender.userDisconnected && !this._destroyed) {
          this.connected = true;
          senderConn._connected = true;
          sender._disconnected = false;
        }
        return true;
      } finally {
        sender.isConnecting = false;
      }
    },
    async isUserAuthorized() {
      return opts?.isUserAuthorizedImpl ? await opts.isUserAuthorizedImpl() : true;
    },
    async getMe() {
      if (opts?.getMeImpl) return await opts.getMeImpl();
      return { id: 900001 };
    },
    async getDialogs() {
      return [];
    },
    async disconnect() {
      this.connected = false;
      senderConn.disconnect();
    },
    async destroy() {
      this.destroyCalls += 1;
      this._destroyed = true;
      this.connected = false;
      senderConn.disconnect();
      opts?.onDestroy?.();
    },
  };
  return client;
}

function resetInMemoryTelegramState() {
  connectedUserClients.clear();
  telegramAccountRuntimeStates.clear();
  telegramAccountFloodCooldowns.clear();
  recentlyExpiredAccounts.clear();
}

before(async () => {
  await initDatabase();
  const srv = await import('../server.ts');
  app = srv.app;
  connectedUserClients = srv.connectedUserClients;
  telegramAccountRuntimeStates = srv.telegramAccountRuntimeStates;
  telegramAccountFloodCooldowns = srv.telegramAccountFloodCooldowns;
  recentlyExpiredAccounts = srv.recentlyExpiredAccounts;
  resolveTelegramAccountRuntimeKey = srv.resolveTelegramAccountRuntimeKey;
  getOrCreateTelegramAccountRuntimeState = srv.getOrCreateTelegramAccountRuntimeState;
  getTelegramProxyFingerprint = srv.getTelegramProxyFingerprint;
  getTelegramAccountConnectionSnapshot = srv.getTelegramAccountConnectionSnapshot;
  withTelegramTimeout = srv.withTelegramTimeout;
  probeTelegramTransportEndpoint = srv.probeTelegramTransportEndpoint;
  destroyTelegramClientSafely = srv.destroyTelegramClientSafely;
  markTelegramSessionExpired = srv.markTelegramSessionExpired;
  restoreTelegramUserSessionsOnStartup = srv.restoreTelegramUserSessionsOnStartup;
  triggerProxyChangeRecovery = srv.triggerProxyChangeRecovery;
  runTelegramConnectionWatchdogCycle = srv.runTelegramConnectionWatchdogCycle;
  handleSystemResumeWakeup = srv.handleSystemResumeWakeup;
  clearTelegramFloodCooldown = srv.clearTelegramFloodCooldown;
  getTelegramFloodCooldown = srv.getTelegramFloodCooldown;
  encryptSensitiveData = srv.encryptSensitiveData;
  saveSystemProxyConfigToDb = srv.saveSystemProxyConfigToDb;
  loadSystemProxyConfigFromDb = srv.loadSystemProxyConfigFromDb;
});

test('Identity resolution parity: backend resolveTelegramAccountRuntimeKey and frontend resolveTelegramAccountIdentity cover all ID/phone combinations', () => {
  // ID-1: acc_tg_<id>
  assert.equal(resolveTelegramAccountRuntimeKey({ accountId: 'acc_tg_123456' }), 'uid:123456');
  assert.deepEqual(resolveTelegramAccountIdentity({ id: 'acc_tg_123456' }), {
    isPersonalTelegram: true,
    runtimeKey: 'uid:123456',
    userId: '123456',
    scopedAccountId: 'acc_tg_123456',
    canonicalAccountId: 'acc_tg_123456',
  });

  // ID-2: tg_<id>
  assert.equal(resolveTelegramAccountRuntimeKey({ accountId: 'tg_123456' }), 'uid:123456');
  assert.equal(resolveTelegramAccountIdentity({ id: 'tg_123456' }).runtimeKey, 'uid:123456');
  assert.equal(resolveTelegramAccountIdentity({ id: 'tg_123456' }).scopedAccountId, 'acc_tg_123456');

  // ID-3: numeric userId
  assert.equal(resolveTelegramAccountRuntimeKey({ accountId: '123456' }), 'uid:123456');
  assert.equal(resolveTelegramAccountIdentity({ id: '123456' }).runtimeKey, 'uid:123456');
  assert.equal(resolveTelegramAccountIdentity({ id: '123456' }).scopedAccountId, 'acc_tg_123456');

  // ID-4: + international phone
  assert.equal(
    resolveTelegramAccountRuntimeKey({ accountId: '+86 138-0013-8000' }),
    'phone:+8613800138000'
  );
  assert.deepEqual(resolveTelegramAccountIdentity({ id: '+86 138-0013-8000' }), {
    isPersonalTelegram: true,
    runtimeKey: 'phone:+8613800138000',
    phone: '+8613800138000',
    scopedAccountId: '+8613800138000',
    canonicalAccountId: '+8613800138000',
  });

  // ID-5: 00 international phone
  assert.equal(
    resolveTelegramAccountRuntimeKey({ accountId: '008613800138000' }),
    'phone:+8613800138000'
  );
  assert.equal(
    resolveTelegramAccountIdentity({ id: '008613800138000' }).runtimeKey,
    'phone:+8613800138000'
  );
  assert.equal(
    resolveTelegramAccountIdentity({ id: '008613800138000' }).scopedAccountId,
    '+8613800138000'
  );

  // ID-6: internal non-Telegram ID + phone field (internal ID must NEVER overwrite real phone)
  assert.equal(
    resolveTelegramAccountRuntimeKey({ accountId: 'acc_local_custom_1', phone: '+86 13800138000' }),
    'phone:+8613800138000'
  );
  assert.deepEqual(
    resolveTelegramAccountIdentity({ id: 'acc_local_custom_1', phone: '+86 13800138000' }),
    {
      isPersonalTelegram: true,
      runtimeKey: 'phone:+8613800138000',
      phone: '+8613800138000',
      scopedAccountId: '+8613800138000',
      canonicalAccountId: '+8613800138000',
    }
  );

  // ID-7: Bot account ignored
  assert.equal(resolveTelegramAccountIdentity({ id: 'acc_telegram_bot' }).isPersonalTelegram, false);
  assert.equal(normalizeTelegramPhoneClient('0086 139-1234-5678'), '+8613912345678');
});

test('Real timeout, AbortSignal cancellation, loopback TCP/SOCKS socket cleanup, and destroyTelegramClientSafely idempotency', async () => {
  // 1. withTelegramTimeout runs onTimeout once and triggers AbortSignal cleanly
  let timeoutCleanupCalls = 0;
  let signalAborted = false;
  await assert.rejects(
    withTelegramTimeout(
      ({ signal }) => {
        signal.addEventListener('abort', () => {
          signalAborted = true;
        });
        return new Promise<string>(() => {
          // Intentionally never settles
        });
      },
      60,
      'timed out test',
      {
        onTimeout: () => {
          timeoutCleanupCalls += 1;
        },
      }
    ),
    /timed out test/
  );
  assert.equal(timeoutCleanupCalls, 1);
  assert.equal(signalAborted, true);

  // External AbortSignal invokes onAbort preferentially over onTimeout
  let abortCalls = 0;
  let timeoutFallbackCalls = 0;
  const extAc = new AbortController();
  setTimeout(() => extAc.abort(), 30);
  await assert.rejects(
    withTelegramTimeout(
      () => new Promise<void>(() => {}),
      5000,
      'should abort first',
      {
        signal: extAc.signal,
        onAbort: () => {
          abortCalls += 1;
        },
        onTimeout: () => {
          timeoutFallbackCalls += 1;
        },
      }
    ),
    /操作已取消/
  );
  assert.equal(abortCalls, 1);
  assert.equal(timeoutFallbackCalls, 0);

  // 2. Real loopback TCP blackhole server: probeTelegramTransportEndpoint destroys socket without FD leak
  const acceptedSockets: net.Socket[] = [];
  const blackholeServer = net.createServer((sock) => {
    acceptedSockets.push(sock);
    // Drain SOCKS greeting bytes without replying so Node processes peer FIN when probe destroys socket
    sock.resume();
  });
  await new Promise<void>((resolve) => blackholeServer.listen(0, '127.0.0.1', resolve));
  const blackholePort = (blackholeServer.address() as AddressInfo).port;
  try {
    await assert.rejects(
      probeTelegramTransportEndpoint({
        proxy: { ip: '127.0.0.1', port: blackholePort, socksType: 5 },
        targetHost: '127.0.0.1',
        targetPort: blackholePort,
        connectTimeoutMs: 400,
        handshakeTimeoutMs: 120,
      })
    );
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(
      acceptedSockets.every((s) => s.destroyed || !s.writable),
      'Blackhole accepted socket should see peer disconnect after probe timeout'
    );
  } finally {
    acceptedSockets.forEach((s) => s.destroy());
    await new Promise<void>((resolve) => blackholeServer.close(() => resolve()));
  }

  // 3. Closed loopback port triggers ECONNREFUSED -> TelegramNetworkError('proxy_timeout')
  const unusedServer = net.createServer();
  await new Promise<void>((resolve) => unusedServer.listen(0, '127.0.0.1', resolve));
  const closedPort = (unusedServer.address() as AddressInfo).port;
  await new Promise<void>((resolve) => unusedServer.close(() => resolve()));

  await assert.rejects(
    probeTelegramTransportEndpoint({
      proxy: { ip: '127.0.0.1', port: closedPort, socksType: 5 },
      connectTimeoutMs: 500,
      handshakeTimeoutMs: 500,
    }),
    (err: any) => err?.category === 'proxy_timeout'
  );

  // 4. destroyTelegramClientSafely shares single _tgProDestroyPromise across concurrent callers
  let resolveDestroy!: () => void;
  let destroyCount = 0;
  const slowDestroyClient = makeFakeGramJsClient({ initiallyConnected: true });
  slowDestroyClient.destroy = () => {
    destroyCount += 1;
    slowDestroyClient._destroyed = true;
    slowDestroyClient.connected = false;
    return new Promise<void>((res) => {
      resolveDestroy = res;
    });
  };
  const p1 = destroyTelegramClientSafely(slowDestroyClient);
  const p2 = destroyTelegramClientSafely(slowDestroyClient);
  assert.equal(slowDestroyClient._sender.userDisconnected, true);
  assert.equal(slowDestroyClient._sender._connection.disconnectCalled, 1);
  assert.equal(destroyCount, 1);
  resolveDestroy();
  await Promise.all([p1, p2]);
  assert.equal(destroyCount, 1);
});

test('Real SQLite markTelegramSessionExpired enforces 3-step uniqueness validation and never bulk-clears mismatched accounts', async () => {
  resetInMemoryTelegramState();
  const suffix = Date.now().toString().slice(-6);
  const phoneA = `+1888111${suffix}`;
  const uidA = `98111${suffix}`;
  const phoneB = `+1888222${suffix}`;
  const uidB = `98222${suffix}`;

  try {
    await db
      .prepare(
        `INSERT OR REPLACE INTO telegram_user_sessions (phone, session_string, user_id, username, first_name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(phoneA, 'enc:gcm:secretA', uidA, 'userA', 'Alice', Date.now(), Date.now());
    await db
      .prepare(
        `INSERT OR REPLACE INTO telegram_user_sessions (phone, session_string, user_id, username, first_name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(phoneB, 'enc:gcm:secretB', uidB, 'userB', 'Bob', Date.now(), Date.now());

    // Conflict scenario: userId belongs to A while phone belongs to B -> MUST abort DB clear for both rows!
    await markTelegramSessionExpired({
      accountId: `acc_tg_${uidA}`,
      userId: uidA,
      phone: phoneB,
      reason: 'CONFLICT_CHECK',
    });

    const checkA = (await db
      .prepare('SELECT is_active, session_string FROM telegram_user_sessions WHERE phone = ?')
      .get(phoneA)) as any;
    const checkB = (await db
      .prepare('SELECT is_active, session_string FROM telegram_user_sessions WHERE phone = ?')
      .get(phoneB)) as any;
    assert.equal(Number(checkA?.is_active), 1);
    assert.equal(checkA?.session_string, 'enc:gcm:secretA');
    assert.equal(Number(checkB?.is_active), 1);
    assert.equal(checkB?.session_string, 'enc:gcm:secretB');

    // Matching single-account expiration clears strictly phoneA, leaving phoneB intact
    await markTelegramSessionExpired({
      accountId: `acc_tg_${uidA}`,
      userId: uidA,
      phone: phoneA,
      reason: 'AUTH_KEY_UNREGISTERED',
    });

    const afterA = (await db
      .prepare('SELECT is_active, session_string, expired_reason FROM telegram_user_sessions WHERE phone = ?')
      .get(phoneA)) as any;
    const afterB = (await db
      .prepare('SELECT is_active, session_string FROM telegram_user_sessions WHERE phone = ?')
      .get(phoneB)) as any;
    assert.equal(Number(afterA?.is_active), 0);
    assert.equal(afterA?.session_string, '');
    assert.equal(afterA?.expired_reason, 'AUTH_KEY_UNREGISTERED');
    assert.equal(Number(afterB?.is_active), 1);
    assert.equal(afterB?.session_string, 'enc:gcm:secretB');
  } finally {
    await db.prepare('DELETE FROM telegram_user_sessions WHERE phone IN (?, ?)').run(phoneA, phoneB);
    resetInMemoryTelegramState();
  }
});

test('Mocked GramJS lifecycle: MC-1 concurrent coverage, MC-2 stale generation isolation, 406 pre-disconnect + zombie purge, and FLOOD_WAIT non-double-counting', async () => {
  resetInMemoryTelegramState();
  const suffix = Date.now().toString().slice(-6);
  const phoneA = `+1999111${suffix}`;
  const uidA = `960001${suffix}`;
  const phoneB = `+1999222${suffix}`;
  const uidB = `960002${suffix}`;
  const prevEnvId = process.env.TELEGRAM_API_ID;
  const prevEnvHash = process.env.TELEGRAM_API_HASH;
  process.env.TELEGRAM_API_ID = '123456';
  process.env.TELEGRAM_API_HASH = '0123456789abcdef0123456789abcdef';

  try {
    await db
      .prepare(
        `INSERT OR REPLACE INTO telegram_user_sessions (phone, session_string, user_id, username, first_name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(phoneA, encryptSensitiveData('1BQANOTEuTEST_SESSION_A'), uidA, 'accA', 'AccA', Date.now(), Date.now());
    await db
      .prepare(
        `INSERT OR REPLACE INTO telegram_user_sessions (phone, session_string, user_id, username, first_name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(phoneB, encryptSensitiveData('1BQANOTEuTEST_SESSION_B'), uidB, 'accB', 'AccB', Date.now(), Date.now());

    // 1) MC-1: concurrent restoreTelegramUserSessionsOnStartup with disjoint targetAccountKeys must recover BOTH
    const pA = restoreTelegramUserSessionsOnStartup(undefined, {
      targetAccountKeys: [`uid:${uidA}`],
      deps: {
        getProxyConfig: () => undefined,
        resolveCredentials: async () => ({ ok: true, apiId: 123456, apiHash: '0123456789abcdef0123456789abcdef', source: 'env' }),
        attachListener: () => {},
        createClient: () =>
          makeFakeGramJsClient({
            connectImpl: async () => {
              await new Promise((r) => setTimeout(r, 80));
              return true;
            },
          }),
      },
    });
    const pB = restoreTelegramUserSessionsOnStartup(undefined, {
      targetAccountKeys: [`uid:${uidB}`],
      deps: {
        getProxyConfig: () => undefined,
        resolveCredentials: async () => ({ ok: true, apiId: 123456, apiHash: '0123456789abcdef0123456789abcdef', source: 'env' }),
        attachListener: () => {},
        createClient: () => makeFakeGramJsClient(),
      },
    });
    await Promise.all([pA, pB]);
    assert.ok(connectedUserClients.get(uidA)?.client.connected, 'Account A should be connected');
    assert.ok(connectedUserClients.get(uidB)?.client.connected, 'Account B should be connected');

    // 2) 406 prevention + Zombie purge: when oldClient is active and candidate fails during proxy/force switch
    const oldClientA = connectedUserClients.get(uidA)!.client as any;
    let oldDisconnectedBeforeCandidateDial = false;
    const failedCandidate = makeFakeGramJsClient({
      connectImpl: async () => {
        oldDisconnectedBeforeCandidateDial =
          oldClientA._sender.userDisconnected === true && oldClientA.connected === false;
        throw new Error('TIMEOUT');
      },
    });
    const failedSwitchCount = await restoreTelegramUserSessionsOnStartup(undefined, {
      forceReconnect: true,
      targetAccountKeys: [`uid:${uidA}`],
      reason: 'proxy_changed',
      deps: {
        getProxyConfig: () => ({ ip: '127.0.0.1', port: 7890, socksType: 5 }),
        probeProxy: async () => {},
        resolveCredentials: async () => ({ ok: true, apiId: 123456, apiHash: '0123456789abcdef0123456789abcdef', source: 'env' }),
        attachListener: () => {},
        createClient: () => failedCandidate,
      },
    });
    assert.equal(failedSwitchCount, 0);
    assert.equal(
      oldDisconnectedBeforeCandidateDial,
      true,
      'Old transport MUST be disconnected before dialing candidateClient to prevent 406 AUTH_KEY_DUPLICATED'
    );
    assert.equal(
      connectedUserClients.get(uidA),
      undefined,
      'Failed replacement MUST purge disconnected zombie client from connectedUserClients'
    );
    assert.equal(
      connectedUserClients.get(uidB)?.client.connected,
      true,
      'Account B failure isolation: Account B stays untouched & online'
    );
    const dbRowAAfterFail = (await db
      .prepare('SELECT is_active FROM telegram_user_sessions WHERE phone = ?')
      .get(phoneA)) as any;
    assert.equal(Number(dbRowAAfterFail?.is_active), 1, 'SQLite active session preserved for watchdog recovery');

    // 3) MC-2: Timed-out / superseded generation G1 must never overwrite G2 or bump G2 retryCount
    const g1Client = makeFakeGramJsClient({
      connectImpl: async () => {
        await new Promise((r) => setTimeout(r, 150));
        return true;
      },
    });
    const g2Client = makeFakeGramJsClient();
    const g1Promise = restoreTelegramUserSessionsOnStartup(undefined, {
      targetAccountKeys: [`uid:${uidA}`],
      deps: {
        connectTimeoutMs: 40,
        getProxyConfig: () => undefined,
        resolveCredentials: async () => ({ ok: true, apiId: 123456, apiHash: '0123456789abcdef0123456789abcdef', source: 'env' }),
        attachListener: () => {},
        createClient: () => g1Client,
      },
    });
    await new Promise((r) => setTimeout(r, 55));
    const g2Count = await restoreTelegramUserSessionsOnStartup(undefined, {
      forceReconnect: true,
      targetAccountKeys: [`uid:${uidA}`],
      deps: {
        getProxyConfig: () => undefined,
        resolveCredentials: async () => ({ ok: true, apiId: 123456, apiHash: '0123456789abcdef0123456789abcdef', source: 'env' }),
        attachListener: () => {},
        createClient: () => g2Client,
      },
    });
    await g1Promise;
    assert.equal(g2Count, 1);
    assert.equal(connectedUserClients.get(uidA)?.client, g2Client);
    assert.equal(g1Client.destroyCalls, 1, 'G1 orphan destroyed cleanly');
    const rtA = getOrCreateTelegramAccountRuntimeState({ userId: uidA, phone: phoneA });
    assert.equal(rtA.retryCount, 0);
    assert.equal(rtA.lastError, null);

    // 4) FLOOD_WAIT in Step 1c in-place reconnect: no fallback to Step 2, no retryCount++ double penalty, Watchdog bypassBackoff respects cooldown
    const idleClientA = connectedUserClients.get(uidA)!.client as any;
    idleClientA.connected = false;
    idleClientA._sender._connection._connected = false;
    idleClientA.connect = async () => {
      throw new Error('FLOOD_WAIT_120');
    };
    let step2Created = 0;
    const prevProxyFp = connectedUserClients.get(uidA)!.proxyFingerprint;
    assert.equal(prevProxyFp, 'direct');

    const beforeRetryCount = rtA.retryCount;
    const floodRes = await restoreTelegramUserSessionsOnStartup(undefined, {
      targetAccountKeys: [`uid:${uidA}`],
      reason: 'watchdog',
      deps: {
        getProxyConfig: () => undefined,
        resolveCredentials: async () => ({ ok: true, apiId: 123456, apiHash: '0123456789abcdef0123456789abcdef', source: 'env' }),
        attachListener: () => {},
        createClient: () => {
          step2Created += 1;
          return makeFakeGramJsClient();
        },
      },
    });
    assert.equal(floodRes, 0);
    assert.equal(step2Created, 0, 'Step 1c FLOOD_WAIT must NOT fall back into Step 2 candidate client creation');
    assert.equal(rtA.retryCount, beforeRetryCount, 'FLOOD_WAIT must NOT increment retryCount');
    const activeFlood = getTelegramFloodCooldown({ userId: uidA, phone: phoneA, accountId: `acc_tg_${uidA}` });
    assert.ok(activeFlood && activeFlood.retryAfterSeconds >= 100);
    assert.ok(rtA.nextRetryAt >= activeFlood.floodWaitUntil);

    // Even with bypassBackoff: true, Watchdog MUST respect official FLOOD_WAIT cooldown
    const watchdogRes = await runTelegramConnectionWatchdogCycle({ bypassBackoff: true, reason: 'power_resume' });
    assert.equal(watchdogRes, 0);
    clearTelegramFloodCooldown({ userId: uidA, phone: phoneA, accountId: `acc_tg_${uidA}` });

    // 5) Step 1c partial connect (connect() connects socket, then isUserAuthorized() throws TIMEOUT) -> Step 2a MUST re-inspect & disconnect before dialing candidateClient
    const halfConnectedA = connectedUserClients.get(uidA)!.client as any;
    halfConnectedA.connected = false;
    halfConnectedA._sender.userDisconnected = false;
    halfConnectedA._sender._disconnected = true;
    halfConnectedA._sender._connection._connected = false;
    halfConnectedA.connect = async () => {
      halfConnectedA.connected = true;
      halfConnectedA._sender._disconnected = false;
      halfConnectedA._sender._connection._connected = true;
      return true;
    };
    halfConnectedA.isUserAuthorized = async () => {
      throw new Error('TIMEOUT');
    };
    let oldHushedBeforeDialAfterHalfStep1c = false;
    const candidateAfterHalf = makeFakeGramJsClient({
      connectImpl: async () => {
        oldHushedBeforeDialAfterHalfStep1c =
          halfConnectedA._sender.userDisconnected === true && halfConnectedA.connected === false;
        return true;
      },
    });
    const halfStepCount = await restoreTelegramUserSessionsOnStartup(undefined, {
      targetAccountKeys: [`uid:${uidA}`],
      reason: 'watchdog',
      deps: {
        getProxyConfig: () => undefined,
        resolveCredentials: async () => ({ ok: true, apiId: 123456, apiHash: '0123456789abcdef0123456789abcdef', source: 'env' }),
        attachListener: () => {},
        createClient: () => candidateAfterHalf,
      },
    });
    assert.equal(halfStepCount, 1);
    assert.equal(
      oldHushedBeforeDialAfterHalfStep1c,
      true,
      'Step 2a MUST re-inspect client state after Step 1c partial connect to prevent 406 dual socket'
    );
  } finally {
    await db.prepare('DELETE FROM telegram_user_sessions WHERE phone IN (?, ?)').run(phoneA, phoneB);
    resetInMemoryTelegramState();
    if (prevEnvId === undefined) delete process.env.TELEGRAM_API_ID;
    else process.env.TELEGRAM_API_ID = prevEnvId;
    if (prevEnvHash === undefined) delete process.env.TELEGRAM_API_HASH;
    else process.env.TELEGRAM_API_HASH = prevEnvHash;
  }
});

test('Real Express HTTP endpoints: /api/telegram/user/status (phone-only & per-account phase), /api/telegram/user/reconnect (ID-8), /api/auth/proxy + triggerProxyChangeRecovery, and /api/internal/system-resume', async () => {
  resetInMemoryTelegramState();
  const suffix = Date.now().toString().slice(-6);
  const phone1 = `+86139111${suffix}`;
  const uid1 = `950001${suffix}`;
  const phone2 = `+86139222${suffix}`; // phone-only persisted session (no user_id yet)

  const prevSecret = process.env.JWT_SECRET;
  const prevEnvId = process.env.TELEGRAM_API_ID;
  const prevEnvHash = process.env.TELEGRAM_API_HASH;
  const testSecret = 'test_secret_tg_resilience_123456';
  process.env.JWT_SECRET = testSecret;
  process.env.TELEGRAM_API_ID = '123456';
  process.env.TELEGRAM_API_HASH = '0123456789abcdef0123456789abcdef';
  const jwt = createTestJwt(testSecret);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const prevProxyRow = (await db.prepare("SELECT value FROM system_config WHERE key = 'network_proxy'").get()) as any;

  try {
    await saveSystemProxyConfigToDb({ enabled: false, type: 'socks5', host: '', port: 7890 });
    await db
      .prepare(
        `INSERT OR REPLACE INTO telegram_user_sessions (phone, session_string, user_id, username, first_name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(phone1, encryptSensitiveData('1BQANOTEuTEST_HTTP_1'), uid1, 'httpUser1', 'Http1', Date.now(), Date.now());
    await db
      .prepare(
        `INSERT OR REPLACE INTO telegram_user_sessions (phone, session_string, user_id, username, first_name, is_active, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, 1, ?, ?)`
      )
      .run(phone2, encryptSensitiveData('1BQANOTEuTEST_HTTP_2'), 'phoneOnly2', 'Phone2', Date.now() - 1000, Date.now() - 1000);

    // Put Account 1 online WITH matching 'direct' proxyFingerprint
    let client1 = makeFakeGramJsClient({ initiallyConnected: true });
    const conn1: ConnectedTelegramUser = {
      client: client1,
      phone: phone1,
      userId: uid1,
      username: '@httpUser1',
      firstName: 'Http1',
      avatarInitial: 'H1',
      avatarBg: '#2481cc',
      apiId: 123456,
      apiHash: 'abc',
      connectedAt: Date.now(),
      proxyFingerprint: 'direct',
      dialogs: [],
    };
    connectedUserClients.set(uid1, conn1);
    connectedUserClients.set(`acc_tg_${uid1}`, conn1);
    connectedUserClients.set(phone1, conn1);

    // 1) GET /api/telegram/user/status accurately separates online Account 1 vs offline phone-only Account 2 (no 'acc_tg_null' or 'acc_tg_')
    const statusRes = await fetch(`${baseUrl}/api/telegram/user/status`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    assert.equal(statusRes.status, 200);
    const statusJson: any = await statusRes.json();
    assert.equal(statusJson.ok, true);
    const acc1Row = statusJson.activeUsers.find((u: any) => u.id === `acc_tg_${uid1}`);
    const acc2Row = statusJson.activeUsers.find((u: any) => u.id === phone2);
    assert.ok(acc1Row);
    assert.equal(acc1Row.status, 'online');
    assert.equal(acc1Row.isConnected, true);
    assert.ok(acc2Row, 'Phone-only DB row should use clean phone ID instead of acc_tg_');
    assert.equal(acc2Row.status, 'offline');
    assert.equal(acc2Row.isConnected, false);

    // 2) triggerProxyChangeRecovery:
    // - Account 1 has matching 'direct' proxy -> NOT targeted!
    // - Account 2 is offline -> targeted!
    const plan1 = await triggerProxyChangeRecovery();
    assert.equal(plan1.triggered, true);
    assert.equal(plan1.targetKeys.includes(`uid:${uid1}`), false, 'Healthy account with matching proxy must be skipped');
    assert.equal(plan1.targetKeys.includes(`phone:${phone2}`), true, 'Offline account must be targeted');

    // Wait briefly for inFlightProxyRecovery background promise to clear
    await new Promise((r) => setTimeout(r, 80));

    // If conn1 loses proxyFingerprint (unknown), triggerProxyChangeRecovery MUST include it for safety verification
    delete conn1.proxyFingerprint;
    const planUnknownProxy = await triggerProxyChangeRecovery();
    assert.equal(
      planUnknownProxy.targetKeys.includes(`uid:${uid1}`),
      true,
      'Missing proxyFingerprint must be treated as unknown and verified/recovered'
    );
    await new Promise((r) => setTimeout(r, 120));

    // Attach a fresh online client1 after background proxy-recovery destroyed the prior one while probing dummy DB StringSession
    client1 = makeFakeGramJsClient({ initiallyConnected: true });
    conn1.client = client1;
    conn1.proxyFingerprint = 'direct';
    connectedUserClients.set(uid1, conn1);
    connectedUserClients.set(`acc_tg_${uid1}`, conn1);
    connectedUserClients.set(phone1, conn1);

    // 3) ID-8: POST /api/telegram/user/reconnect with phone matches DB row that already has user_id
    const rt1 = getOrCreateTelegramAccountRuntimeState({ userId: uid1, phone: phone1 });
    rt1.nextRetryAt = Date.now() + 60_000;
    const reconHttpRes = await fetch(`${baseUrl}/api/telegram/user/reconnect`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accountId: phone1 }),
    });
    const reconHttpJson: any = await reconHttpRes.json();
    assert.equal(reconHttpRes.status, 200);
    assert.equal(reconHttpJson.ok, true);
    assert.equal(rt1.nextRetryAt, 0, 'Manual reconnect by phone should clear backoff even when runtime is uid-keyed');

    // 4) POST /api/auth/proxy & /api/system/proxy validate input & persist config via HTTP
    const proxyHttpRes = await fetch(`${baseUrl}/api/system/proxy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: false, type: 'socks5', host: '127.0.0.1', port: 7890 }),
    });
    assert.equal(proxyHttpRes.status, 200);
    const proxyHttpJson: any = await proxyHttpRes.json();
    assert.equal(proxyHttpJson.ok, true);

    // 5) Real HTTP loopback call to /api/internal/system-resume:
    // Simulate getMe() ECONNRESET on connected client1 -> triggers sender.reconnect()
    client1.getMe = async () => {
      throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    };
    const resumeHttpRes = await fetch(`${baseUrl}/api/internal/system-resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'win_sleep_resume_test' }),
    });
    assert.equal(resumeHttpRes.status, 200);
    assert.equal(client1._sender.reconnectCalled, 1, 'Half-open ECONNRESET after wake should trigger sender.reconnect()');

    // Cross-origin browser CSRF attempt to /api/internal/system-resume MUST be rejected with 403
    const evilOriginResume = await fetch(`${baseUrl}/api/internal/system-resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example.com',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: JSON.stringify({ source: 'csrf_test' }),
    });
    assert.equal(evilOriginResume.status, 403);

    // Simulate getMe() returning FLOOD_WAIT_90 on wake -> must record FLOOD_WAIT and NOT call sender.reconnect()
    client1.connected = true;
    client1._sender.userDisconnected = false;
    client1._sender._connection._connected = true;
    client1.getMe = async () => {
      throw new Error('FLOOD_WAIT_90');
    };
    await handleSystemResumeWakeup('win_wake_flood_test');
    assert.equal(
      client1._sender.reconnectCalled,
      1,
      'FLOOD_WAIT during wake getMe() probe must NOT force additional sender.reconnect()'
    );
    const wakeFlood = getTelegramFloodCooldown({ userId: uid1, phone: phone1, accountId: `acc_tg_${uid1}` });
    assert.ok(wakeFlood && wakeFlood.retryAfterSeconds >= 80);
    clearTelegramFloodCooldown({ userId: uid1, phone: phone1, accountId: `acc_tg_${uid1}` });

    // If conn1 holds a stale proxyFingerprint when wake probe fails, must hush userDisconnected instead of calling sender.reconnect() with old proxy
    conn1.proxyFingerprint = 'stale_proxy_fp';
    client1.connected = true;
    client1._sender.userDisconnected = false;
    client1._sender._connection._connected = true;
    client1.getMe = async () => {
      throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    };
    await handleSystemResumeWakeup('win_wake_stale_proxy_test');
    assert.equal(
      client1._sender.reconnectCalled,
      1,
      'Wake probe failure with changed proxy must NOT call native sender.reconnect() on old proxy'
    );
    assert.equal(client1._sender.userDisconnected, true);
    conn1.proxyFingerprint = 'direct';

    // Simulate getMe() returning AUTH_KEY_UNREGISTERED -> marks ONLY account 1 expired, keeps phone2 active!
    client1.connected = true;
    client1._sender.userDisconnected = false;
    client1._sender._connection._connected = true;
    client1.getMe = async () => {
      throw new Error('AUTH_KEY_UNREGISTERED');
    };
    const resumeExpiredRes = await handleSystemResumeWakeup('win_wake_expired_test');
    assert.equal(typeof resumeExpiredRes, 'number');
    const row1After = (await db
      .prepare('SELECT is_active, expired_reason FROM telegram_user_sessions WHERE phone = ?')
      .get(phone1)) as any;
    const row2After = (await db
      .prepare('SELECT is_active, session_string FROM telegram_user_sessions WHERE phone = ?')
      .get(phone2)) as any;
    assert.equal(Number(row1After?.is_active), 0);
    assert.ok(String(row1After?.expired_reason || '').length > 0);
    assert.equal(Number(row2After?.is_active), 1, 'Unrelated account 2 must stay untouched on resume expiry of account 1');
  } finally {
    await db.prepare('DELETE FROM telegram_user_sessions WHERE phone IN (?, ?)').run(phone1, phone2);
    if (prevProxyRow?.value) {
      await db
        .prepare("INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('network_proxy', ?, ?)")
        .run(prevProxyRow.value, Date.now());
      await loadSystemProxyConfigFromDb();
    } else {
      await db.prepare("DELETE FROM system_config WHERE key = 'network_proxy'").run();
      await loadSystemProxyConfigFromDb();
    }
    resetInMemoryTelegramState();
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
    if (prevEnvId === undefined) delete process.env.TELEGRAM_API_ID;
    else process.env.TELEGRAM_API_ID = prevEnvId;
    if (prevEnvHash === undefined) delete process.env.TELEGRAM_API_HASH;
    else process.env.TELEGRAM_API_HASH = prevEnvHash;
  }
});

test('Frontend UI connection phase evaluator: transient 9s grace period hides brief reconnect banner then surfaces after grace', () => {
  const t0 = 1_000_000;
  // Within grace window: uiStatus='away', shouldShowBanner=false
  const withinGrace = evaluateTelegramAccountUiState({
    phase: 'reconnecting',
    transientSince: t0,
    now: t0 + 2500,
  });
  assert.equal(withinGrace.uiStatus, 'away');
  assert.equal(withinGrace.shouldShowBanner, false);
  assert.equal(withinGrace.nextGraceCheckInMs, TRANSIENT_DISCONNECT_GRACE_MS - 2500);

  // After grace expires: banner surfaces cleanly
  const pastGrace = evaluateTelegramAccountUiState({
    phase: 'reconnecting',
    transientSince: t0,
    now: t0 + TRANSIENT_DISCONNECT_GRACE_MS + 100,
  });
  assert.equal(pastGrace.uiStatus, 'away');
  assert.equal(pastGrace.shouldShowBanner, true);
  assert.equal(pastGrace.nextGraceCheckInMs, null);

  // Explicit offline surfaces immediately regardless of transient timer
  const explicitOffline = evaluateTelegramAccountUiState({
    phase: 'offline',
    offlineReason: '代理端口 7890 连接超时',
    transientSince: t0,
    now: t0 + 500,
  });
  assert.equal(explicitOffline.uiStatus, 'offline');
  assert.equal(explicitOffline.shouldShowBanner, true);
  assert.equal(explicitOffline.displayReason, '代理端口 7890 连接超时');

  // Online hides banner immediately
  const backOnline = evaluateTelegramAccountUiState({
    phase: 'online',
    transientSince: t0,
    now: t0 + 12000,
  });
  assert.equal(backOnline.uiStatus, 'online');
  assert.equal(backOnline.shouldShowBanner, false);
  assert.equal(getTelegramProxyFingerprint(undefined), 'direct');
});

test('Regression: queued _reconnect() stays silenced after destroy/Step 2a, /api/internal/system-resume blocks x-real-ip & coalesces concurrent wake, and user_id=NULL row reconnects via acc_tg_<uid> + phone', async () => {
  resetInMemoryTelegramState();
  const suffix = Date.now().toString().slice(-6);
  const phone = `+86139333${suffix}`;
  const uid = `940003${suffix}`;
  const legacyPhone = `+86139444${suffix}`;
  const staleUid = `940004${suffix}`;

  const prevSecret = process.env.JWT_SECRET;
  const prevEnvId = process.env.TELEGRAM_API_ID;
  const prevEnvHash = process.env.TELEGRAM_API_HASH;
  const testSecret = 'test_secret_tg_regression_123456';
  process.env.JWT_SECRET = testSecret;
  process.env.TELEGRAM_API_ID = '123456';
  process.env.TELEGRAM_API_HASH = '0123456789abcdef0123456789abcdef';
  const jwt = createTestJwt(testSecret);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1) Queued _reconnect() must NOT revive socket after destroyTelegramClientSafely
    const clientDestroyTest = makeFakeGramJsClient({ initiallyConnected: true });
    await destroyTelegramClientSafely(clientDestroyTest);
    await clientDestroyTest._sender._reconnect();
    clientDestroyTest._sender.reconnect();
    assert.equal(clientDestroyTest._sender.userDisconnected, true);
    assert.equal(clientDestroyTest._sender._autoReconnect, false);
    assert.equal(clientDestroyTest._sender._retries, 0);
    assert.equal(clientDestroyTest._sender._reconnectRetries, 0);
    assert.equal(clientDestroyTest._sender._connection._connected, false);
    assert.equal(clientDestroyTest._sender.reconnectCalled, 0);

    // 2) Queued _reconnect() on oldClient must NOT revive socket during Step 2a replacement
    await db
      .prepare(
        `INSERT OR REPLACE INTO telegram_user_sessions (phone, session_string, user_id, username, first_name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(phone, encryptSensitiveData('1BQANOTEuTEST_REG_1'), uid, 'regUser', 'Reg', Date.now(), Date.now());

    const oldStep2aClient = makeFakeGramJsClient({ initiallyConnected: true });
    oldStep2aClient._sender.isReconnecting = true;
    const oldConn: ConnectedTelegramUser = {
      client: oldStep2aClient,
      phone,
      userId: uid,
      username: '@regUser',
      firstName: 'Reg',
      avatarInitial: 'RG',
      avatarBg: '#2481cc',
      apiId: 123456,
      apiHash: 'abc',
      connectedAt: Date.now(),
      proxyFingerprint: 'direct',
      dialogs: [],
    };
    connectedUserClients.set(uid, oldConn);
    connectedUserClients.set(`acc_tg_${uid}`, oldConn);
    connectedUserClients.set(phone, oldConn);

    const newCandidateClient = makeFakeGramJsClient({
      connectImpl: async () => {
        await oldStep2aClient._sender._reconnect();
        oldStep2aClient._sender.reconnect();
        return true;
      },
    });
    const step2aRestored = await restoreTelegramUserSessionsOnStartup(undefined, {
      forceReconnect: true,
      targetAccountKeys: [`uid:${uid}`],
      reason: 'manual_reconnect',
      deps: {
        getProxyConfig: () => undefined,
        resolveCredentials: async () => ({
          ok: true,
          apiId: 123456,
          apiHash: '0123456789abcdef0123456789abcdef',
          source: 'env',
        }),
        attachListener: () => {},
        createClient: () => newCandidateClient,
      },
    });
    assert.equal(step2aRestored, 1);
    assert.equal(oldStep2aClient._sender.userDisconnected, true);
    assert.equal(oldStep2aClient._sender._autoReconnect, false);
    assert.equal(oldStep2aClient._sender._connection._connected, false);
    assert.equal(oldStep2aClient._sender.reconnectCalled, 0);

    // 3) /api/internal/system-resume MUST reject x-real-ip forwarding header with 403
    const forwardedResumeRes = await fetch(`${baseUrl}/api/internal/system-resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-real-ip': '203.0.113.10',
      },
      body: JSON.stringify({ source: 'proxy_header_test' }),
    });
    assert.equal(forwardedResumeRes.status, 403);

    // 4) Concurrent handleSystemResumeWakeup calls MUST coalesce via single-flight lock (only 1 getMe probe)
    let getMeCalls = 0;
    newCandidateClient.getMe = async () => {
      getMeCalls += 1;
      await new Promise((r) => setTimeout(r, 40));
      return { id: Number(uid) };
    };
    await Promise.all([
      handleSystemResumeWakeup('concurrent_wake_1'),
      handleSystemResumeWakeup('concurrent_wake_2'),
    ]);
    assert.equal(getMeCalls, 1, 'Concurrent wake calls must coalesce into a single getMe() probe');

    // 5) Legacy DB row with user_id=NULL MUST match when POST /api/telegram/user/reconnect receives acc_tg_<uid> + phone
    await db
      .prepare(
        `INSERT OR REPLACE INTO telegram_user_sessions (phone, session_string, user_id, username, first_name, is_active, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, 1, ?, ?)`
      )
      .run(legacyPhone, encryptSensitiveData('1BQANOTEuTEST_REG_LEGACY'), 'legacyNullUid', 'Legacy', Date.now() - 2000, Date.now() - 2000);

    const legacyRt = getOrCreateTelegramAccountRuntimeState({ phone: legacyPhone });
    legacyRt.nextRetryAt = Date.now() + 60_000;
    const legacyReconRes = await fetch(`${baseUrl}/api/telegram/user/reconnect`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accountId: `acc_tg_${staleUid}`,
        phone: legacyPhone,
      }),
    });
    assert.equal(legacyReconRes.status, 502);
    const legacyReconJson: any = await legacyReconRes.json();
    assert.equal(legacyReconJson.ok, false);
    assert.ok(
      Boolean(legacyReconJson.error) && (legacyRt.lastError !== null || legacyRt.offlineReason !== null),
      'Legacy user_id=NULL row must be matched by phone targetAccountKey and enter restore flow instead of being skipped by filteredRows'
    );

    legacyRt.nextRetryAt = 0;
    const legacyFakeClient = makeFakeGramJsClient();
    const legacyDirectRestored = await restoreTelegramUserSessionsOnStartup(undefined, {
      targetAccountKeys: [`uid:${staleUid}`, `phone:${legacyPhone}`],
      reason: 'manual_reconnect',
      deps: {
        getProxyConfig: () => undefined,
        resolveCredentials: async () => ({
          ok: true,
          apiId: 123456,
          apiHash: '0123456789abcdef0123456789abcdef',
          source: 'env',
        }),
        attachListener: () => {},
        createClient: () => legacyFakeClient,
      },
    });
    assert.equal(legacyDirectRestored, 1, 'Legacy user_id=NULL DB row must restore when targeted with uid + phone keys');
  } finally {
    await db.prepare('DELETE FROM telegram_user_sessions WHERE phone IN (?, ?)').run(phone, legacyPhone);
    resetInMemoryTelegramState();
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
    if (prevEnvId === undefined) delete process.env.TELEGRAM_API_ID;
    else process.env.TELEGRAM_API_ID = prevEnvId;
    if (prevEnvHash === undefined) delete process.env.TELEGRAM_API_HASH;
    else process.env.TELEGRAM_API_HASH = prevEnvHash;
  }
});
