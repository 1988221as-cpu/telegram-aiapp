import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

process.env.NODE_ENV = 'test';
process.env.AIS_TEST_IMPORT = 'true';

import { db, initDatabase } from './db.ts';
import type { ConnectedTelegramUser } from '../server.ts';
import {
  clearCryptoStorageCache,
  flushPendingCryptoWritesWithResult,
  getCryptoStorageEpoch,
  secureSetItemSyncWithResult,
  secureGetItemSync,
} from '../src/services/cryptoStorage.ts';
import {
  flushLocalMessagesPersist,
  getLocalMessages,
  purgeAllLocalChatData,
  recordDeletedMessageIds,
  saveLocalMessage,
  setLocalMessages,
} from '../src/services/apiService.ts';

let serverMod!: typeof import('../server.ts');

function createTestJwt(secret: string, role: 'master' | 'member' = 'member'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: role === 'master' ? 'usr_master_resilience' : 'usr_member_resilience',
      id: role === 'master' ? 'usr_master_resilience' : 'usr_member_resilience',
      userId: role === 'master' ? 'usr_master_resilience' : 'usr_member_resilience',
      username: role === 'master' ? 'master_tester' : 'member_tester',
      role,
      plan: 'pro',
      vipExpiresAt: Date.now() + 86_400_000,
      exp: nowSec + 3600,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function makeFakeClient(opts?: {
  initiallyConnected?: boolean;
  isReconnecting?: boolean;
  transportConnected?: boolean;
  downloadProfilePhotoImpl?: (peer: any) => Promise<any>;
  getEntityImpl?: (peer: any) => Promise<any>;
  getMeImpl?: () => Promise<any>;
  connectImpl?: () => Promise<boolean | void>;
  getMessagesImpl?: (peer: any, params: any) => Promise<any[]>;
}) {
  const senderConn = {
    _connected: opts?.transportConnected ?? Boolean(opts?.initiallyConnected),
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
    isReconnecting: Boolean(opts?.isReconnecting),
    _reconnecting: Boolean(opts?.isReconnecting),
    _disconnected: !opts?.initiallyConnected,
    _connection: senderConn,
    reconnect() {},
  };
  const handlers: Array<{ fn: (e: any) => any; builder: any }> = [];
  const client: any = {
    connected: Boolean(opts?.initiallyConnected),
    _destroyed: false,
    _sender: sender,
    _selfId: '991100',
    handlers,
    destroyCalls: 0,
    setLogLevel() {},
    addEventHandler(fn: any, builder: any) {
      handlers.push({ fn, builder });
    },
    async connect() {
      const ok = opts?.connectImpl ? await opts.connectImpl() : true;
      if (ok === false) {
        this.connected = false;
        senderConn._connected = false;
        return false;
      }
      this.connected = true;
      senderConn._connected = true;
      sender._disconnected = false;
      return true;
    },
    async isUserAuthorized() {
      return true;
    },
    async getMe() {
      if (opts?.getMeImpl) return await opts.getMeImpl();
      return { id: 991100 };
    },
    async getDialogs() {
      return [];
    },
    async getEntity(peer: any) {
      if (opts?.getEntityImpl) return await opts.getEntityImpl(peer);
      return { id: peer, firstName: `Peer_${String(peer)}` };
    },
    async downloadProfilePhoto(peer: any) {
      if (opts?.downloadProfilePhotoImpl) return await opts.downloadProfilePhotoImpl(peer);
      return Buffer.from('fake-jpeg');
    },
    async getMessages(peer: any, params: any) {
      if (opts?.getMessagesImpl) return await opts.getMessagesImpl(peer, params);
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
    },
  };
  return client;
}

function resetServerRuntimeMaps() {
  serverMod.connectedUserClients.clear();
  serverMod.telegramAccountRuntimeStates.clear();
  serverMod.telegramAccountFloodCooldowns.clear();
  serverMod.recentlyExpiredAccounts.clear();
  serverMod.clearMessageDeleteBarriersForTesting();
  serverMod.clearAvatarCachesForTesting();
  serverMod.clearTelegramSenderCacheForTesting();
}

before(async () => {
  await initDatabase();
  serverMod = await import('../server.ts');
  resetServerRuntimeMaps();
});

beforeEach(async () => {
  resetServerRuntimeMaps();
  await serverMod.flushMessageDbWriteQueue({ timeoutMs: 2000 });
});

after(async () => {
  resetServerRuntimeMaps();
  await serverMod.flushMessageDbWriteQueue({ timeoutMs: 2000 });
  await db.prepare("DELETE FROM messages WHERE account_id LIKE 'acc_tg_res_%'").run();
  await db.prepare("DELETE FROM telegram_user_sessions WHERE user_id LIKE 'res_%' OR phone LIKE '+861399900%'").run();
});

test('Frontend Crypto + Batched LocalMessages: DPAPI readback rejects fake success, batch reduces 50->1 IPC write, strict ID dedup, and purge epoch aborts stale flush', async () => {
  const prevWindow = (globalThis as any).window;
  const prevLocalStorage = (globalThis as any).localStorage;
  const store = new Map<string, string>();
  let failSetItemKey: string | null = null;
  let encryptSyncCalls = 0;

  const mockLocalStorage = {
    get length() {
      return store.size;
    },
    key(idx: number) {
      return Array.from(store.keys())[idx] ?? null;
    },
    getItem(k: string) {
      return store.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (failSetItemKey && k === failSetItemKey) {
        // Simulate silent write rejection where old ciphertext stays intact
        return;
      }
      store.set(k, String(v));
    },
    removeItem(k: string) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
  };

  const mockBridge = {
    getStatus: () => ({ isElectron: true, hardwareProtected: true, storageMode: 'dpapi_aes_gcm' }),
    encryptSync: (plaintext: string) => {
      encryptSyncCalls += 1;
      const b64 = Buffer.from(plaintext, 'utf8').toString('base64');
      return `enc:gcm256:iv${encryptSyncCalls}:${b64}`;
    },
    decryptSync: (cipher: string) => {
      if (!cipher.startsWith('enc:gcm256:')) return null;
      const parts = cipher.split(':');
      if (parts.length !== 4) return null;
      return Buffer.from(parts[3], 'base64').toString('utf8');
    },
    migrateLegacySeed: () => true,
    purgeMasterKey: () => true,
  };

  try {
    (globalThis as any).localStorage = mockLocalStorage;
    (globalThis as any).window = {
      humanSenseCrypto: mockBridge,
      addEventListener() {},
    };
    clearCryptoStorageCache();

    // 1. Fake-success prevention: seed OLD valid ciphertext, then block localStorage overwrite
    const fakeTestKey = 'tg_desktop_msgs_acc_tg_res_fe_tg_1001';
    store.set(fakeTestKey, 'enc:gcm256:staleIv:stalePayload');
    failSetItemKey = fakeTestKey;
    const rejectedWrite = secureSetItemSyncWithResult(fakeTestKey, [{ id: 'm_new', text: 'must not appear committed' }]);
    assert.equal(rejectedWrite.ok, false, 'Must detect readback mismatch even when stale enc:gcm256 exists');
    const flushAfterFail = await flushPendingCryptoWritesWithResult([fakeTestKey]);
    assert.equal(flushAfterFail.ok, false);
    assert.ok(flushAfterFail.failedKeys.includes(fakeTestKey));
    failSetItemKey = null;
    // Recover fakeTestKey once transient IPC failure clears so failedAsyncWriteKeys resets cleanly
    const recoveredWrite = secureSetItemSyncWithResult(fakeTestKey, [{ id: 'm_recovered', text: 'ok' }]);
    assert.equal(recoveredWrite.ok, true);

    // 2. Batch reduction: 50 rapid saveLocalMessage updates -> 1 single encrypted IPC write upon flush
    encryptSyncCalls = 0;
    const batchChat = 'tg_2002';
    setLocalMessages(batchChat, [], 'acc_tg_res_fe');
    for (let i = 1; i <= 50; i++) {
      saveLocalMessage(
        batchChat,
        {
          id: `msg_batch_${i}`,
          telegramMessageId: 5000 + i,
          sender: 'peer',
          senderName: 'Alice',
          // Same text within 2 minutes: strict ID matching MUST preserve every distinct tgMsgId!
          text: 'duplicate text group message',
          timestamp: '12:00',
          createdAt: 1_700_000_000_000 + i * 100,
        } as any,
        'acc_tg_res_fe'
      );
    }
    assert.equal(encryptSyncCalls, 0, 'Rapid saves should stay queued in dirty bucket before flush');
    const flushBatchRes = await flushLocalMessagesPersist();
    assert.equal(flushBatchRes.ok, true);
    assert.equal(encryptSyncCalls, 1, '50 dirty updates to same bucket should coalesce into 1 DPAPI encryptSync call');
    const persisted = getLocalMessages(batchChat, 'acc_tg_res_fe');
    assert.equal(persisted.length, 50, 'Strict ID dedup must not collapse distinct group messages with identical text');

    // 3. Cross-chat tombstone attribution + purgeAllLocalChatData epoch race safety
    recordDeletedMessageIds(['msg_tg_9001'], 'acc_tg_res_fe', 'tg_3003');
    recordDeletedMessageIds(['msg_tg_9001'], 'acc_tg_res_fe', 'tg_4004');
    const tombFlush = await flushLocalMessagesPersist();
    assert.equal(tombFlush.ok, true);
    const storedDeleted = secureGetItemSync<string[]>('tg_deleted_message_ids_acc_tg_res_fe') || [];
    assert.ok(storedDeleted.includes('tg_3003::msg_tg_9001'));
    assert.ok(storedDeleted.includes('tg_4004::msg_tg_9001'));

    // Schedule another dirty bucket, then purge BEFORE flush completes -> zero resurrection
    setLocalMessages('tg_5005', [{ id: 'm_resurrect', sender: 'me', text: 'should be gone', timestamp: '12:01', createdAt: Date.now() } as any], 'acc_tg_res_fe');
    const epochBeforePurge = getCryptoStorageEpoch();
    purgeAllLocalChatData();
    assert.ok(getCryptoStorageEpoch() > epochBeforePurge);
    const postPurgeFlush = await flushLocalMessagesPersist();
    assert.equal(postPurgeFlush.ok, true, 'Dirty buckets cleared on purge so nothing remains to resurrect');
    assert.equal(store.get('tg_desktop_msgs_acc_tg_res_fe_tg_5005') ?? null, null);
    assert.equal(secureGetItemSync('tg_desktop_msgs_acc_tg_res_fe_tg_5005'), null);
  } finally {
    clearCryptoStorageCache();
    (globalThis as any).window = prevWindow;
    (globalThis as any).localStorage = prevLocalStorage;
  }
});

test('MessageDbWriteQueue: causal Edit->Delete order, LOW history resurrection barrier, SQLITE_BUSY retry + fault isolation, query flush, and LOW shedding backpressure', async () => {
  const accountId = 'acc_tg_res_q1';
  const chatId = 'tg_-100555666777';
  await db.prepare('DELETE FROM messages WHERE account_id = ?').run(accountId);

  const snapshotAt = Date.now() - 5000;
  // Seed initial row via HIGH priority real-time insert
  const pInsert = serverMod.upsertSyncedMessageToDb(
    {
      id: 'rt_msg_101',
      telegramMessageId: 101,
      chatId,
      accountId,
      sender: 'peer',
      senderName: 'Bob',
      text: 'v1',
      timestamp: '10:00',
      createdAt: snapshotAt - 1000,
    },
    chatId,
    accountId,
    { priority: 'HIGH', source: 'realtime_new_message' }
  );

  // Enqueue Edit (NORMAL) then Delete (HIGH) for tgMsgId=101, followed by stale LOW snapshot for tgMsgId=101
  const execTrace: string[] = [];
  const pEdit = serverMod.enqueueMessageDbWrite({
    priority: 'NORMAL',
    kind: 'edit',
    accountId,
    chatId,
    tgMsgIds: [101],
    exec: async () => {
      execTrace.push('edit_101');
      await db.prepare('UPDATE messages SET text = ?, is_edited = 1 WHERE account_id = ? AND telegram_message_id = ?').run('v2', accountId, 101);
    },
  });
  const pDelete = serverMod.enqueueMessageDbWrite({
    priority: 'HIGH',
    kind: 'delete_channel',
    accountId,
    chatId,
    tgMsgIds: [101],
    exec: async () => {
      execTrace.push('delete_101');
      await db.prepare('DELETE FROM messages WHERE account_id = ? AND chat_id = ? AND telegram_message_id = ?').run(accountId, chatId, 101);
    },
  });
  const pStaleSync = serverMod.upsertSyncedMessageToDb(
    {
      id: 'sync_msg_101',
      telegramMessageId: 101,
      chatId,
      accountId,
      sender: 'peer',
      senderName: 'Bob',
      text: 'stale resurrection',
      timestamp: '10:00',
      createdAt: snapshotAt,
    },
    chatId,
    accountId,
    { priority: 'LOW', snapshotTakenAt: snapshotAt, source: 'history_sync' }
  );

  const [insRes, , , staleRes] = await Promise.all([pInsert, pEdit, pDelete, pStaleSync]);
  assert.equal(insRes, true);
  assert.equal(staleRes, false, 'Stale LOW history sync must be suppressed by delete barrier');
  assert.deepEqual(execTrace, ['edit_101', 'delete_101'], 'Causal order Edit->Delete must hold even with mixed priority');

  // Test row fault isolation in a dedicated batch: one failing write does NOT drop healthy sibling row 102
  const pFault = serverMod
    .enqueueMessageDbWrite({
      priority: 'HIGH',
      kind: 'upsert',
      accountId,
      chatId,
      tgMsgIds: [999],
      exec: async () => {
        throw new Error('forced single row validation failure');
      },
    })
    .catch((e) => e);
  const pSibling = serverMod.upsertSyncedMessageToDb(
    {
      id: 'rt_msg_102',
      telegramMessageId: 102,
      chatId,
      accountId,
      sender: 'peer',
      senderName: 'Carol',
      text: 'survivor sibling',
      timestamp: '10:01',
      createdAt: Date.now(),
    },
    chatId,
    accountId,
    { priority: 'HIGH', source: 'realtime_new_message' }
  );

  const [faultRes, sibRes] = await Promise.all([pFault, pSibling]);
  assert.ok(faultRes instanceof Error);
  assert.equal(sibRes, true, 'Row fault isolation must preserve healthy sibling commit');

  // Verify SQLITE_BUSY 3x retry succeeds cleanly
  let busyAttempts = 0;
  const busyRes = await serverMod.enqueueMessageDbWrite({
    priority: 'NORMAL',
    kind: 'edit',
    accountId,
    chatId,
    tgMsgIds: [102],
    exec: async () => {
      busyAttempts += 1;
      if (busyAttempts < 2) {
        const busyErr: any = new Error('SQLITE_BUSY: database is locked');
        busyErr.code = 'SQLITE_BUSY';
        throw busyErr;
      }
      await db.prepare('UPDATE messages SET text = ? WHERE id = ?').run('busy recovered', 'rt_msg_102');
      return 'ok_after_retry';
    },
  });
  assert.equal(busyRes, 'ok_after_retry');
  assert.equal(busyAttempts, 2);

  // Verify fallback query flushes pending writes and sees only 102 (not resurrected 101)
  const fallback = await serverMod.querySqlitePaginatedMessagesFallback(chatId, accountId, { limit: 20 });
  assert.equal(fallback.messages.length, 1);
  assert.equal(fallback.messages[0].telegramMessageId, 102);
  assert.equal(fallback.messages[0].text, 'busy recovered');

  // Backpressure: hold active flush slot briefly while saturating >2000 LOW items, verify HIGH still commits and LOW is shed cleanly
  let releaseBpBlocker: () => void = () => {};
  const bpBlocker = serverMod.enqueueMessageDbWrite({
    priority: 'HIGH',
    kind: 'upsert',
    accountId: `${accountId}_bp`,
    chatId,
    tgMsgIds: [999000],
    exec: () => new Promise<string>((resolve) => {
      releaseBpBlocker = () => resolve('blocker_done');
    }),
  });
  await new Promise((r) => setTimeout(r, 10));

  const backpressurePromises: Array<Promise<any>> = [];
  for (let i = 0; i < 2015; i++) {
    backpressurePromises.push(
      serverMod.enqueueMessageDbWrite({
        priority: 'LOW',
        kind: 'upsert',
        accountId: `${accountId}_bp`,
        chatId,
        tgMsgIds: [2000 + i],
        exec: async () => true,
      })
    );
  }
  const highSurvivorPromise = serverMod.enqueueMessageDbWrite({
    priority: 'HIGH',
    kind: 'upsert',
    accountId: `${accountId}_bp`,
    chatId,
    tgMsgIds: [999001],
    exec: async () => 'high_kept',
  });
  releaseBpBlocker();
  const [bpBlockerRes, highSurvivors] = await Promise.all([bpBlocker, highSurvivorPromise]);
  assert.equal(bpBlockerRes, 'blocker_done');
  assert.equal(highSurvivors, 'high_kept');
  await Promise.allSettled(backpressurePromises);
  assert.ok(serverMod.getMessageDbWriteQueueStats().droppedLowTotal > 0, 'Overflowing queue must shed LOW tasks cleanly');
});

test('SenderInfo LRU + Single-Flight + Concurrency Cap + Short Error TTL + Raw Invalidation', async () => {
  serverMod.clearTelegramSenderCacheForTesting();
  let getSenderCalls = 0;
  let shouldFail = false;

  const makeMsg = (uid: string) => ({
    fromId: { userId: uid },
    async getSender() {
      getSenderCalls += 1;
      await new Promise((r) => setTimeout(r, 25));
      if (shouldFail) throw new Error('TEMP_TIMEOUT');
      return { id: uid, firstName: 'Group', lastName: `Member_${uid}` };
    },
  });

  // 10 concurrent calls for same sender -> 1 RPC via single-flight
  const batch = await Promise.all(
    Array.from({ length: 10 }, () => serverMod.resolveTelegramMessageSenderInfo(makeMsg('77001'), false, 'acc_tg_res_sender'))
  );
  assert.equal(getSenderCalls, 1);
  for (const item of batch) {
    assert.equal(item.senderName, 'Group Member_77001');
  }

  // Subsequent call hits global LRU without RPC
  const hit = await serverMod.resolveTelegramMessageSenderInfo(makeMsg('77001'), false, 'acc_tg_res_sender');
  assert.equal(hit.senderName, 'Group Member_77001');
  assert.equal(getSenderCalls, 1);

  // Invalidate cache -> forces fresh RPC
  serverMod.invalidateTelegramSenderCache('acc_tg_res_sender', '77001');
  shouldFail = true;
  const fallback = await serverMod.resolveTelegramMessageSenderInfo(makeMsg('77001'), false, 'acc_tg_res_sender');
  assert.equal(getSenderCalls, 2);
  assert.equal(fallback.senderId, '77001');
  assert.equal(fallback.senderName, '');

  // Immediate retry hits 15s short fallback cache
  await serverMod.resolveTelegramMessageSenderInfo(makeMsg('77001'), false, 'acc_tg_res_sender');
  assert.equal(getSenderCalls, 2);

  // Explicit invalidation (e.g. UpdateUser) clears short fallback cache immediately
  shouldFail = false;
  serverMod.invalidateTelegramSenderCache('acc_tg_res_sender', '77001');
  const recovered = await serverMod.resolveTelegramMessageSenderInfo(makeMsg('77001'), false, 'acc_tg_res_sender');
  assert.equal(getSenderCalls, 3);
  assert.equal(recovered.senderName, 'Group Member_77001');
});

test('Avatar Endpoint: 4-tier error differentiation, concurrency=2, queue=32 503 Retry-After, and client abort cleanup', async () => {
  const prevSecret = process.env.JWT_SECRET;
  const testSecret = 'resilience_avatar_test_secret_hs256!';
  process.env.JWT_SECRET = testSecret;
  const srv = http.createServer(serverMod.app);
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  const { port } = srv.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const jwt = createTestJwt(testSecret);

  let mode: 'no_photo' | 'flood_wait' | 'timeout' | 'rpc_error' | 'slow_ok' = 'no_photo';
  let activeDownloads = 0;
  let peakActiveDownloads = 0;
  const slowGate: { release: () => void } = { release: () => {} };
  let slowGatePromise: Promise<void> = Promise.resolve();
  let rpcCalls = 0;

  const fakeClient = makeFakeClient({
    initiallyConnected: true,
    async getEntityImpl(peer: any) {
      return { id: peer };
    },
    async downloadProfilePhotoImpl() {
      rpcCalls += 1;
      activeDownloads += 1;
      peakActiveDownloads = Math.max(peakActiveDownloads, activeDownloads);
      try {
        if (mode === 'no_photo') return Buffer.alloc(0);
        if (mode === 'flood_wait') {
          const e: any = new Error('FLOOD_WAIT_42');
          e.seconds = 42;
          throw e;
        }
        if (mode === 'timeout') {
          throw new Error('Request timeout after 8000ms');
        }
        if (mode === 'rpc_error') {
          throw new Error('INTERNAL_RPC_500');
        }
        await slowGatePromise;
        return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      } finally {
        activeDownloads -= 1;
      }
    },
  });

  const accId = 'acc_tg_991100';
  const connObj: ConnectedTelegramUser = {
    client: fakeClient,
    phone: '+8613999000100',
    userId: '991100',
    username: '@avatar_tester',
    firstName: 'Avatar',
    avatarInitial: 'AV',
    avatarBg: '#2481cc',
    apiId: 12345,
    apiHash: '0123456789abcdef0123456789abcdef',
    connectedAt: Date.now(),
    proxyFingerprint: 'direct',
    dialogs: [],
  };
  serverMod.connectedUserClients.set(accId, connObj);
  serverMod.connectedUserClients.set('991100', connObj);

  try {
    const signUrl = (peer: string) =>
      `${baseUrl}${serverMod.signTelegramResourceUrl(`/api/telegram/user/avatar/${peer}`, accId)}`;

    // 1. no_photo -> 404 + cached 5m (second fetch does NOT hit downloadProfilePhoto)
    mode = 'no_photo';
    const r404a = await fetch(signUrl('10001'), { headers: { Authorization: `Bearer ${jwt}` } });
    assert.equal(r404a.status, 404);
    const negEntry = serverMod.getAvatarNegativeCacheEntry(`${accId}:10001`);
    assert.equal(negEntry?.reason, 'no_photo');
    const callsAfterFirst404 = rpcCalls;
    const r404b = await fetch(signUrl('10001'), { headers: { Authorization: `Bearer ${jwt}` } });
    assert.equal(r404b.status, 404);
    assert.equal(rpcCalls, callsAfterFirst404, 'no_photo negative cache must short-circuit second request');

    // 2. FLOOD_WAIT -> 429 Retry-After, ZERO negative cache
    mode = 'flood_wait';
    const r429 = await fetch(signUrl('10002'), { headers: { Authorization: `Bearer ${jwt}` } });
    assert.equal(r429.status, 429);
    assert.equal(r429.headers.get('retry-after'), '42');
    assert.equal(serverMod.getAvatarNegativeCacheEntry(`${accId}:10002`), null);
    serverMod.clearTelegramFloodCooldown({ accountId: accId, userId: '991100', phone: '+8613999000100' });

    // 3. timeout -> 503, ZERO negative cache (retryable right away)
    mode = 'timeout';
    const rTimeout = await fetch(signUrl('10003'), { headers: { Authorization: `Bearer ${jwt}` } });
    assert.equal(rTimeout.status, 503);
    assert.equal(serverMod.getAvatarNegativeCacheEntry(`${accId}:10003`), null);

    // 4. rpc_error -> 503 + short rpc_error negative cache
    mode = 'rpc_error';
    const rRpc = await fetch(signUrl('10004'), { headers: { Authorization: `Bearer ${jwt}` } });
    assert.equal(rRpc.status, 503);
    assert.equal(serverMod.getAvatarNegativeCacheEntry(`${accId}:10004`)?.reason, 'rpc_error');

    // 5. Burst > 34 unique peers: concurrency <= 2, >32 queued rejected with 503 Retry-After: 3, aborted client doesn't linger
    mode = 'slow_ok';
    slowGatePromise = new Promise<void>((res) => {
      slowGate.release = res;
    });
    const abortCtrl = new AbortController();
    const burstReqs: Array<Promise<Response>> = [];
    for (let i = 0; i < 38; i++) {
      const peer = String(20000 + i);
      const signal = i === 10 ? abortCtrl.signal : undefined;
      burstReqs.push(
        fetch(signUrl(peer), { headers: { Authorization: `Bearer ${jwt}` }, signal }).catch(
          () => new Response(null, { status: 499 })
        )
      );
    }
    await new Promise((r) => setTimeout(r, 80));
    abortCtrl.abort();
    await new Promise((r) => setTimeout(r, 30));
    slowGate.release();
    const responses = await Promise.all(burstReqs);
    assert.ok(peakActiveDownloads <= 2, `Peak concurrent avatar downloads ${peakActiveDownloads} exceeded 2`);
    const status503 = responses.filter((r) => r.status === 503);
    assert.ok(status503.length >= 3, 'Queue overflow (>32 waiters) must fail fast with 503');
    assert.equal(status503[0].headers.get('retry-after'), '3');
    assert.ok(responses.some((r) => r.status === 200), 'In-slot avatar requests must succeed with 200');
  } finally {
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
    (srv as any).closeAllConnections?.();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
});

test('TelegramRpcScheduler: P0 preempts queued P2 while capping P2 concurrency at 2', async () => {
  const accountScope = 'acc_tg_res_rpc_prio';
  const order: string[] = [];
  let releaseBlockers: (() => void)[] = [];

  // Occupy all 4 slots (2 P1 + 2 P2)
  const blockers: Array<Promise<void>> = [];
  for (let i = 0; i < 4; i++) {
    const prio = i < 2 ? 'P1' : 'P2';
    blockers.push(
      serverMod.scheduleTelegramRpc(accountScope, prio, `blocker_${i}`, () => {
        return new Promise<void>((resolve) => {
          releaseBlockers.push(resolve);
        });
      })
    );
  }
  await new Promise((r) => setTimeout(r, 15));

  // Queue P2 tasks, then P0 sendMessage
  const p2Queued = [0, 1].map((idx) =>
    serverMod.scheduleTelegramRpc(accountScope, 'P2', `queued_p2_${idx}`, async () => {
      order.push(`P2_${idx}`);
    })
  );
  const p0Queued = serverMod.scheduleTelegramRpc(accountScope, 'P0', 'urgent_send', async () => {
    order.push('P0_sendMessage');
  });

  // Release blockers -> P0 must run BEFORE any queued P2
  for (const r of releaseBlockers) r();
  await Promise.all([...blockers, p0Queued, ...p2Queued]);
  assert.equal(order[0], 'P0_sendMessage', `Expected P0 first, got ${order.join(',')}`);
});

test('Watchdog + Real Local TCP Proxy Recovery: 35s warn+probe only (no isReconnecting mutation), >=60s confirmed zombie generation swap, and real socket drop/restart reconnect', async () => {
  const uid = '992200';
  const phone = '+8613999000200';
  const accountId = `acc_tg_${uid}`;
  const encryptedSess = serverMod.encryptSensitiveData('dummy-session-data-for-test');

  const nowTs = Date.now();
  await db
    .prepare(
      `INSERT OR REPLACE INTO telegram_user_sessions (phone, session_string, user_id, username, first_name, is_active, expired_reason, created_at, updated_at)
       VALUES (?, ?, ?, 'zombie_tester', 'Zombie', 1, NULL, ?, ?)`
    )
    .run(phone, encryptedSess, uid, nowTs, nowTs);

  // 1. Stuck reconnecting client at 35s -> suspect warning + health probe ONLY, NEVER sets isReconnecting = false or destroys
  const stuckClient = makeFakeClient({
    initiallyConnected: false,
    isReconnecting: true,
    transportConnected: false,
  });
  stuckClient._tgProGenerationId = 1;
  const rt = serverMod.getOrCreateTelegramAccountRuntimeState({ userId: uid, phone, accountId });
  rt.generationId = 1;
  rt.reconnectingSinceAt = 100_000;
  rt.lastHealthProbeAt = 0;

  const connEntry: ConnectedTelegramUser = {
    client: stuckClient,
    phone,
    userId: uid,
    username: '@zombie_tester',
    firstName: 'Zombie',
    avatarInitial: 'ZB',
    avatarBg: '#2481cc',
    apiId: 12345,
    apiHash: '0123456789abcdef0123456789abcdef',
    connectedAt: 90_000,
    proxyFingerprint: 'direct',
    dialogs: [],
  };
  serverMod.connectedUserClients.set(uid, connEntry);
  serverMod.connectedUserClients.set(accountId, connEntry);
  serverMod.connectedUserClients.set(phone, connEntry);

  let restoreCalls = 0;
  let lastRestoreOpts: any = null;
  let clock = 136_000; // 36s reconnecting

  const res36s = await serverMod.runTelegramConnectionWatchdogCycle({
    deps: {
      now: () => clock,
      probeClientHealth: async () => {
        throw new Error('SOCKET_DEAD');
      },
      restoreSessions: async (_token: any, opts: any) => {
        if (!Array.isArray(opts?.targetAccountKeys) || !opts.targetAccountKeys.includes(rt.accountKey)) {
          return 0;
        }
        restoreCalls += 1;
        lastRestoreOpts = opts;
        return 1;
      },
    },
  });
  assert.equal(res36s, 0);
  assert.equal(restoreCalls, 0, '35s threshold must ONLY warn & probe, NEVER force destroy');
  assert.equal(stuckClient._sender.isReconnecting, true, 'Must NEVER force sender.isReconnecting = false');
  assert.equal(rt.reconnectProbeFailures, 1);
  assert.ok(rt.suspectedStuckWarningAt !== null);

  // 2. Advance past 60s + 15s probe cooldown -> 2nd failed probe + !transportConnected -> Confirmed Zombie recovery!
  clock = 165_000; // 65s reconnecting
  const res65s = await serverMod.runTelegramConnectionWatchdogCycle({
    deps: {
      now: () => clock,
      probeClientHealth: async () => {
        throw new Error('SOCKET_DEAD');
      },
      restoreSessions: async (_token: any, opts: any) => {
        if (!Array.isArray(opts?.targetAccountKeys) || !opts.targetAccountKeys.includes(rt.accountKey)) {
          return 0;
        }
        restoreCalls += 1;
        lastRestoreOpts = opts;
        return 1;
      },
    },
  });
  assert.equal(res65s, 1);
  assert.equal(restoreCalls, 1);
  assert.equal(lastRestoreOpts?.forceReconnect, true);
  assert.equal(lastRestoreOpts?.reason, 'watchdog_zombie_recovery');
  assert.equal(stuckClient._sender.isReconnecting, true, 'Must NEVER force mutate old sender.isReconnecting');

  // 3. Real restore with generation swap + stale listener discard
  let freshClientRef: any = null;
  const realRestoreCount = await serverMod.restoreTelegramUserSessionsOnStartup(undefined, {
    forceReconnect: true,
    targetAccountKeys: [rt.accountKey],
    reason: 'watchdog_zombie_recovery',
    deps: {
      getProxyConfig: () => undefined,
      resolveCredentials: async () => ({
        ok: true,
        apiId: 12345,
        apiHash: '0123456789abcdef0123456789abcdef',
        source: 'env' as const,
      }),
      createClient: () => {
        freshClientRef = makeFakeClient({ initiallyConnected: false, transportConnected: false });
        return freshClientRef;
      },
    },
  });
  assert.equal(realRestoreCount, 1);
  assert.ok(rt.generationId > 1);
  assert.equal(freshClientRef._tgProGenerationId, rt.generationId);
  assert.equal(stuckClient.destroyCalls, 1, 'Old zombie client must be safely destroyed during switchover');
  assert.equal(
    serverMod.isTelegramClientGenerationCurrent(stuckClient, { userId: uid, phone, accountId }),
    false,
    'Stale generation listener must immediately discard events'
  );
  assert.equal(
    serverMod.isTelegramClientGenerationCurrent(freshClientRef, { userId: uid, phone, accountId }),
    true
  );

  // 4. Real local TCP/SOCKS5 proxy disconnect & restart recovery test
  // Start a minimal SOCKS5 TCP server on 127.0.0.1:0 that handles method negotiation + CONNECT OK
  const createSocks5ProxyServer = () =>
    net.createServer((socket) => {
      let step = 0;
      socket.on('data', (chunk) => {
        if (step === 0 && chunk[0] === 0x05) {
          step = 1;
          socket.write(Buffer.from([0x05, 0x00])); // No auth
        } else if (step === 1 && chunk[0] === 0x05 && chunk[1] === 0x01) {
          step = 2;
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 80])); // Succeeded
        }
      });
    });

  let proxySrv = createSocks5ProxyServer();
  await new Promise<void>((res) => proxySrv.listen(0, '127.0.0.1', () => res()));
  const proxyPort = (proxySrv.address() as AddressInfo).port;
  const proxyCfg = { ip: '127.0.0.1', port: proxyPort, socksType: 5 as const };

  try {
    // Proxy online -> transport probe succeeds and restore connects cleanly
    let onlineClientRef: any = null;
    const onlineOk = await serverMod.restoreTelegramUserSessionsOnStartup(undefined, {
      forceReconnect: true,
      targetAccountKeys: [rt.accountKey],
      reason: 'proxy_online_test',
      deps: {
        getProxyConfig: () => proxyCfg,
        resolveCredentials: async () => ({
          ok: true,
          apiId: 12345,
          apiHash: '0123456789abcdef0123456789abcdef',
          source: 'env' as const,
        }),
        createClient: () => {
          onlineClientRef = makeFakeClient({ initiallyConnected: false });
          return onlineClientRef;
        },
      },
    });
    assert.equal(onlineOk, 1);

    // Stop proxy server (simulates proxy restart / network drop) -> active socket drops & restore fails safely
    await onlineClientRef.disconnect();
    (proxySrv as any).closeAllConnections?.();
    await new Promise<void>((res) => proxySrv.close(() => res()));
    const dropOk = await serverMod.restoreTelegramUserSessionsOnStartup(undefined, {
      forceReconnect: true,
      targetAccountKeys: [rt.accountKey],
      reason: 'proxy_dropped_test',
      deps: {
        getProxyConfig: () => proxyCfg,
        resolveCredentials: async () => ({
          ok: true,
          apiId: 12345,
          apiHash: '0123456789abcdef0123456789abcdef',
          source: 'env' as const,
        }),
        createClient: () => makeFakeClient({ initiallyConnected: false }),
      },
    });
    assert.equal(dropOk, 0);
    assert.equal(rt.lastErrorCategory, 'proxy_timeout');

    // Bring proxy server back up on SAME port -> Watchdog/restore recovers automatically
    proxySrv = createSocks5ProxyServer();
    await new Promise<void>((res) => proxySrv.listen(proxyPort, '127.0.0.1', () => res()));
    rt.nextRetryAt = 0;
    const recoveredOk = await serverMod.restoreTelegramUserSessionsOnStartup(undefined, {
      forceReconnect: false,
      targetAccountKeys: [rt.accountKey],
      reason: 'proxy_restarted_test',
      deps: {
        getProxyConfig: () => proxyCfg,
        resolveCredentials: async () => ({
          ok: true,
          apiId: 12345,
          apiHash: '0123456789abcdef0123456789abcdef',
          source: 'env' as const,
        }),
        createClient: () => makeFakeClient({ initiallyConnected: false }),
      },
    });
    assert.equal(recoveredOk, 1);
    assert.equal(rt.lastError, null);
    assert.equal(rt.proxyFingerprint, serverMod.getTelegramProxyFingerprint(proxyCfg));
  } finally {
    (proxySrv as any).closeAllConnections?.();
    await new Promise<void>((res) => proxySrv.close(() => res())).catch(() => {});
  }
});

test('GET /api/system/performance-metrics enforces master auth, redacts PII/tokens in lastError, and exposes RPC/EventLoop sampling metadata', async () => {
  const prevSecret = process.env.JWT_SECRET;
  const testSecret = 'resilience_metrics_test_secret_hs256!';
  process.env.JWT_SECRET = testSecret;
  const srv = http.createServer(serverMod.app);
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  const { port } = srv.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const memberJwt = createTestJwt(testSecret, 'member');
  const masterJwt = createTestJwt(testSecret, 'master');

  // Trigger a wrapped RPC failure containing phone/JWT/bot-token/32-hex hash to verify real end-to-end redaction in rpc.lastError
  await serverMod
    .withTelegramTimeout(
      Promise.reject(
        new Error(
          'Auth failed for +8613800138000 token Bearer eyJhbGciOiJIUzI1NiJ9.abcdef.ghijkl key bot123456789:AAHSecretToken1234567890 apiHash 0123456789abcdef0123456789abcdef'
        )
      ),
      2000,
      'telemetry_redaction_test'
    )
    .catch(() => {});

  try {
    // Unauthenticated rejected with 401
    const unauthRes = await fetch(`${baseUrl}/api/system/performance-metrics`);
    assert.equal(unauthRes.status, 401);

    // Non-master (Bot webhook credential) forbidden with 403
    const nonMasterRes = await fetch(`${baseUrl}/api/system/performance-metrics`, {
      headers: { 'x-telegram-bot-api-secret-token': serverMod.TELEGRAM_WEBHOOK_SECRET },
    });
    assert.equal(nonMasterRes.status, 403);

    // Master succeeds with redacted error & explicit sampling flags
    const masterRes = await fetch(`${baseUrl}/api/system/performance-metrics`, {
      headers: { Authorization: `Bearer ${masterJwt}` },
    });
    assert.equal(masterRes.status, 200);
    const body: any = await masterRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.rpc?.scope, 'withTelegramTimeout_wrapped_only');
    assert.equal(typeof body.eventLoop?.sampled, 'boolean');
    assert.equal(typeof body.cpu?.sampled, 'boolean');
    assert.ok(body.queues?.telegramRpcScheduler);
    assert.ok(body.queues?.messageDbWriteQueue);
    assert.ok(body.queues?.avatarLimiter);
    assert.ok(body.queues?.senderInfoCache);
    assert.ok(body.rpc?.lastError, 'Wrapped RPC failure should populate rpc.lastError');
    assert.ok(!String(body.rpc.lastError).includes('13800138000'), 'Phone number must be redacted');
    assert.ok(!String(body.rpc.lastError).includes('eyJhbGciOiJIUzI1NiJ9'), 'JWT must be redacted');
    assert.ok(!String(body.rpc.lastError).includes('AAHSecretToken1234567890'), 'Bot token must be redacted');
    assert.ok(!String(body.rpc.lastError).includes('0123456789abcdef0123456789abcdef'), '32-hex hash must be redacted');
  } finally {
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
    (srv as any).closeAllConnections?.();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
});
