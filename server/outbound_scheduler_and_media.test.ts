import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Api } from 'telegram';

process.env.NODE_ENV = 'test';
process.env.AIS_TEST_IMPORT = 'true';

import { db, initDatabase } from './db.ts';
import type { ConnectedTelegramUser } from '../server.ts';

let serverMod!: typeof import('../server.ts');

function createTestJwt(secret: string, role: 'master' | 'member' = 'master'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: role === 'master' ? 'usr_master_sched' : 'usr_member_sched',
      id: role === 'master' ? 'usr_master_sched' : 'usr_member_sched',
      userId: role === 'master' ? 'usr_master_sched' : 'usr_member_sched',
      username: role === 'master' ? 'master_sched' : 'member_sched',
      role,
      plan: 'pro',
      vipExpiresAt: Date.now() + 86_400_000,
      exp: nowSec + 3600,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function makeFakeConn(accountId: string, userId: string, opts?: {
  dialogs?: Array<{ id: string; rawId?: string; isGroup?: boolean; isChannel?: boolean }>;
  getMessagesImpl?: (peer: any, params: any) => Promise<any[]>;
  downloadMediaImpl?: (msg: any, params: any) => Promise<Buffer>;
  getEntityImpl?: (peer: any) => Promise<any>;
  sendMessageImpl?: (peer: any, params: any) => Promise<any>;
}): ConnectedTelegramUser {
  const client: any = {
    connected: true,
    _destroyed: false,
    _sender: {
      userDisconnected: false,
      isConnecting: false,
      _connecting: false,
      isReconnecting: false,
      _reconnecting: false,
      _disconnected: false,
      _connection: { _connected: true, isConnected: () => true, disconnect() {} },
    },
    _selfId: userId,
    setLogLevel() {},
    addEventHandler() {},
    async connect() { return true; },
    async isUserAuthorized() { return true; },
    async getMe() { return { id: Number(userId) || 990011 }; },
    async getDialogs() { return []; },
    async getInputEntity(peer: any) { return peer; },
    async getEntity(peer: any) {
      if (opts?.getEntityImpl) return await opts.getEntityImpl(peer);
      return { id: peer, firstName: `Peer_${String(peer)}`, contact: false };
    },
    async getMessages(peer: any, params: any) {
      if (opts?.getMessagesImpl) return await opts.getMessagesImpl(peer, params);
      return [];
    },
    async downloadMedia(msg: any, params: any) {
      if (opts?.downloadMediaImpl) return await opts.downloadMediaImpl(msg, params);
      return Buffer.from('fake-media');
    },
    async sendMessage(peer: any, params: any) {
      if (opts?.sendMessageImpl) return await opts.sendMessageImpl(peer, params);
      return { id: Math.floor(Math.random() * 100000) + 100 };
    },
    async disconnect() { this.connected = false; },
    async destroy() { this.connected = false; this._destroyed = true; },
  };
  return {
    client,
    phone: '+8613900001111',
    userId,
    username: `@sched_${userId}`,
    firstName: 'SchedulerTester',
    avatarInitial: 'ST',
    avatarBg: '#2481cc',
    apiId: 12345,
    apiHash: '0123456789abcdef0123456789abcdef',
    connectedAt: Date.now(),
    proxyFingerprint: 'direct',
    dialogs: (opts?.dialogs || []) as any,
  };
}

function resetRuntimeState() {
  serverMod.clearOutboundSchedulerForTesting();
  serverMod.clearActiveFocusAndSseForTesting();
  serverMod.clearTelegramMediaCachesForTesting();
  serverMod.connectedUserClients.clear();
  serverMod.telegramAccountRuntimeStates.clear();
  serverMod.telegramAccountFloodCooldowns.clear();
  serverMod.recentlyExpiredAccounts.clear();
  serverMod.pendingLocalUpdates.length = 0;
}

before(async () => {
  await initDatabase();
  serverMod = await import('../server.ts');
  resetRuntimeState();
});

beforeEach(async () => {
  resetRuntimeState();
  await serverMod.flushMessageDbWriteQueue({ timeoutMs: 2000 });
  await db
    .prepare(
      `DELETE FROM messages WHERE account_id IN (
        'acc_tg_sched_preempt',
        'acc_tg_media_conc',
        'acc_tg_idemp_sweep',
        'acc_tg_flood_tier',
        'acc_tg_peer_flood',
        'acc_tg_media_limit',
        'acc_tg_sse_diff'
      )`
    )
    .run()
    .catch(() => {});
});

test('Outbound scheduler: private chat preempts throttled group & round-robins multi-group FIFO without blocking Group B', async () => {
  const accId = 'acc_tg_sched_preempt';
  const prevConfig = { ...serverMod.outboundRuntimeConfig };
  serverMod.outboundRuntimeConfig.accountMinGapMinMs = 5;
  serverMod.outboundRuntimeConfig.accountMinGapMaxMs = 5;
  serverMod.outboundRuntimeConfig.crossGroupGapMinMs = 15;
  serverMod.outboundRuntimeConfig.crossGroupGapMaxMs = 15;
  serverMod.outboundRuntimeConfig.sameGroupGapMinMs = 300;
  serverMod.outboundRuntimeConfig.sameGroupGapMaxMs = 300;

  const conn = makeFakeConn(accId, '880011', {
    dialogs: [
      { id: 'tg_-1001111', rawId: '-1001111', isGroup: true },
      { id: 'tg_-1002222', rawId: '-1002222', isGroup: true },
      { id: 'tg_3333', rawId: '3333', isGroup: false },
    ],
  });
  serverMod.connectedUserClients.set(accId, conn);

  const dispatched: Array<{ chatId: string; text: string; at: number }> = [];
  let tgMsgSeq = 1000;

  try {
    const fakeDeliver: typeof serverMod.deliverOutboundTelegramMessage = async (payload) => {
      dispatched.push({
        chatId: String(payload.chatId),
        text: String(payload.text),
        at: Date.now(),
      });
      return {
        delivered: true,
        channel: 'mtproto',
        telegramMessageId: ++tgMsgSeq,
      };
    };

    // Enqueue 2 messages to Group A, 1 message to Group B, then 1 private chat message right after
    const pA1 = serverMod.enqueueOutboundDelivery({
      id: 'sched_a1',
      clientMessageId: 'cm_a1',
      effectiveAccountId: accId,
      payload: { chatId: 'tg_-1001111', sender: 'me', text: 'GroupA-1', clientMessageId: 'cm_a1' },
      deliverFn: fakeDeliver,
    });
    const pA2 = serverMod.enqueueOutboundDelivery({
      id: 'sched_a2',
      clientMessageId: 'cm_a2',
      effectiveAccountId: accId,
      payload: { chatId: 'tg_-1001111', sender: 'me', text: 'GroupA-2', clientMessageId: 'cm_a2' },
      deliverFn: fakeDeliver,
    });
    const pB1 = serverMod.enqueueOutboundDelivery({
      id: 'sched_b1',
      clientMessageId: 'cm_b1',
      effectiveAccountId: accId,
      payload: { chatId: 'tg_-1002222', sender: 'me', text: 'GroupB-1', clientMessageId: 'cm_b1' },
      deliverFn: fakeDeliver,
    });
    const pP1 = serverMod.enqueueOutboundDelivery({
      id: 'sched_p1',
      clientMessageId: 'cm_p1',
      effectiveAccountId: accId,
      payload: { chatId: 'tg_3333', sender: 'me', text: 'Private-1', clientMessageId: 'cm_p1' },
      deliverFn: fakeDeliver,
    });

    await Promise.all([pA1, pA2, pB1, pP1]);

    assert.equal(dispatched.length, 4);
    const idxA1 = dispatched.findIndex((d) => d.text === 'GroupA-1');
    const idxA2 = dispatched.findIndex((d) => d.text === 'GroupA-2');
    const idxB1 = dispatched.findIndex((d) => d.text === 'GroupB-1');
    const idxP1 = dispatched.findIndex((d) => d.text === 'Private-1');

    // Private chat preempts pending Group B and throttled Group A-2
    assert.equal(idxP1, 0, `Private chat should preempt before queued groups, got order: ${dispatched.map((d) => d.text).join(', ')}`);
    // Group B-1 executes before Group A-2 (which waits for Group A's 300ms same-group throttle)
    assert.ok(idxB1 < idxA2, `GroupB-1 (${idxB1}) should dispatch before throttled GroupA-2 (${idxA2})`);
    // Group A preserves FIFO ordering
    assert.ok(idxA1 < idxA2, 'GroupA FIFO order preserved');
    // Same-group interval enforced between A1 and A2
    assert.ok(dispatched[idxA2].at - dispatched[idxA1].at >= 250, 'Same-group throttle interval enforced');
  } finally {
    Object.assign(serverMod.outboundRuntimeConfig, prevConfig);
    await db.prepare(`DELETE FROM messages WHERE account_id = ?`).run(accId).catch(() => {});
  }
});

test('Outbound scheduler: single-concurrency media upload per account serializes image uploads without stalling text', async () => {
  const accId = 'acc_tg_media_conc';
  const prevConfig = { ...serverMod.outboundRuntimeConfig };
  serverMod.outboundRuntimeConfig.accountMinGapMinMs = 1;
  serverMod.outboundRuntimeConfig.accountMinGapMaxMs = 1;
  serverMod.outboundRuntimeConfig.crossGroupGapMinMs = 1;
  serverMod.outboundRuntimeConfig.crossGroupGapMaxMs = 1;
  serverMod.outboundRuntimeConfig.sameGroupGapMinMs = 1;
  serverMod.outboundRuntimeConfig.sameGroupGapMaxMs = 1;

  serverMod.connectedUserClients.set(accId, makeFakeConn(accId, '880012'));
  let activeMediaCount = 0;
  let maxConcurrentMedia = 0;
  const order: string[] = [];

  try {
    const fakeDeliver: typeof serverMod.deliverOutboundTelegramMessage = async (payload) => {
      if (payload.isImage) {
        activeMediaCount += 1;
        maxConcurrentMedia = Math.max(maxConcurrentMedia, activeMediaCount);
        await new Promise((r) => setTimeout(r, 40));
        activeMediaCount -= 1;
      }
      order.push(String(payload.text));
      return { delivered: true, channel: 'mtproto', telegramMessageId: Math.floor(Math.random() * 9000) + 1 };
    };

    const pImg1 = serverMod.enqueueOutboundDelivery({
      id: 'm_img_1',
      effectiveAccountId: accId,
      payload: { chatId: 'tg_4001', sender: 'me', text: 'img-1', isImage: true, imageUrl: 'https://example.com/1.jpg' },
      deliverFn: fakeDeliver,
    });
    const pImg2 = serverMod.enqueueOutboundDelivery({
      id: 'm_img_2',
      effectiveAccountId: accId,
      payload: { chatId: 'tg_4002', sender: 'me', text: 'img-2', isImage: true, imageUrl: 'https://example.com/2.jpg' },
      deliverFn: fakeDeliver,
    });
    const pText = serverMod.enqueueOutboundDelivery({
      id: 'm_txt_1',
      effectiveAccountId: accId,
      payload: { chatId: 'tg_4003', sender: 'me', text: 'text-fast' },
      deliverFn: fakeDeliver,
    });

    await Promise.all([pImg1, pImg2, pText]);
    assert.equal(maxConcurrentMedia, 1, 'Media uploads for the same account must be single-concurrency');
    assert.ok(order.includes('text-fast'));
    assert.equal(order.length, 3);
  } finally {
    Object.assign(serverMod.outboundRuntimeConfig, prevConfig);
    await db.prepare(`DELETE FROM messages WHERE account_id = ?`).run(accId).catch(() => {});
  }
});

test('Outbound idempotency: clientMessageId prevents duplicate sends in scheduler & DB upsert, and startup sweep marks stale pending/retrying as failed', async () => {
  const accId = 'acc_tg_idemp_sweep';
  serverMod.connectedUserClients.set(accId, makeFakeConn(accId, '880013'));
  let sendCount = 0;

  try {
    const fakeDeliver: typeof serverMod.deliverOutboundTelegramMessage = async () => {
      sendCount += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { delivered: true, channel: 'mtproto', telegramMessageId: 556677 };
    };

    const clientMessageId = `cm_dedup_${Date.now()}`;
    const first = await serverMod.enqueueOutboundDelivery({
      id: 'idemp_msg_1',
      clientMessageId,
      effectiveAccountId: accId,
      payload: { chatId: 'tg_5001', sender: 'me', text: 'once only', clientMessageId },
      asyncQueue: true,
      deliverFn: fakeDeliver,
    });
    assert.equal(first.queued, true);
    if (first.queued) assert.equal(first.duplicate, false);

    const second = await serverMod.enqueueOutboundDelivery({
      id: 'idemp_msg_2',
      clientMessageId,
      effectiveAccountId: accId,
      payload: { chatId: 'tg_5001', sender: 'me', text: 'once only', clientMessageId },
      asyncQueue: true,
      deliverFn: fakeDeliver,
    });
    assert.equal(second.queued, true);
    if (second.queued) {
      assert.equal(second.duplicate, true);
      assert.equal(second.id, 'idemp_msg_1');
    }

    // Wait for async queue drain
    await new Promise((r) => setTimeout(r, 120));
    await serverMod.flushMessageDbWriteQueue({ timeoutMs: 2000 });
    assert.equal(sendCount, 1, 'Duplicate clientMessageId must only deliver once');

    const rows = (await db
      .prepare(`SELECT id, delivery_status, telegram_message_id FROM messages WHERE account_id = ? AND client_message_id = ?`)
      .all(accId, clientMessageId)) as any[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].delivery_status, 'delivered');
    assert.equal(Number(rows[0].telegram_message_id), 556677);

    // Startup recovery sweep: insert dangling pending & retrying outbound messages, run initDatabase(), verify converted to failed
    await db
      .prepare(
        `INSERT INTO messages (id, chat_id, account_id, sender, sender_name, text, timestamp, created_at, delivery_status, client_message_id)
         VALUES (?, ?, ?, 'me', '我方', 'stale pending', '10:00', ?, 'pending', ?),
                (?, ?, ?, 'me', '我方', 'stale retrying', '10:01', ?, 'retrying', ?)`
      )
      .run(
        'stale_p_1', 'tg_5001', accId, Date.now(), 'cm_stale_p',
        'stale_r_1', 'tg_5001', accId, Date.now(), 'cm_stale_r'
      );

    await initDatabase();

    const swept = (await db
      .prepare(`SELECT id, delivery_status FROM messages WHERE id IN ('stale_p_1', 'stale_r_1') ORDER BY id`)
      .all()) as any[];
    assert.deepEqual(
      swept.map((r) => ({ id: r.id, delivery_status: r.delivery_status })),
      [
        { id: 'stale_p_1', delivery_status: 'failed' },
        { id: 'stale_r_1', delivery_status: 'failed' },
      ]
    );
  } finally {
    await db.prepare(`DELETE FROM messages WHERE account_id = ?`).run(accId).catch(() => {});
  }
});

test('FLOOD_WAIT tiered policy: <= threshold auto-waits and delivers, > threshold pauses in DB and supports HTTP resume / discard', async () => {
  const accId = 'acc_tg_flood_tier';
  const prevConfig = { ...serverMod.outboundRuntimeConfig };
  serverMod.outboundRuntimeConfig.floodWaitAutoWaitMaxSec = 2;
  serverMod.outboundRuntimeConfig.outboundMaxQueueAgeSec = 10;
  serverMod.outboundRuntimeConfig.accountMinGapMinMs = 1;
  serverMod.outboundRuntimeConfig.accountMinGapMaxMs = 1;

  const conn = makeFakeConn(accId, '880014');
  serverMod.connectedUserClients.set(accId, conn);

  const prevSecret = process.env.JWT_SECRET;
  const secret = 'test_secret_flood_tier_12345';
  process.env.JWT_SECRET = secret;
  const jwt = createTestJwt(secret, 'master');
  const srv = http.createServer(serverMod.app);
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  const { port } = srv.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Case 1: Short FLOOD_WAIT (1s <= 2s threshold) auto-waits and succeeds on retry
    let shortAttempts = 0;
    const shortDeliver: typeof serverMod.deliverOutboundTelegramMessage = async () => {
      shortAttempts += 1;
      if (shortAttempts === 1) {
        return {
          delivered: false,
          channel: 'mtproto',
          floodWait: true,
          retryAfterSeconds: 1,
          floodWaitUntil: Date.now() + 120, // short mock timer so test finishes quickly
          error: 'FLOOD_WAIT_1',
        };
      }
      return { delivered: true, channel: 'mtproto', telegramMessageId: 9010 };
    };

    const shortRes = await serverMod.enqueueOutboundDelivery({
      id: 'flood_short_1',
      clientMessageId: 'cm_flood_short',
      effectiveAccountId: accId,
      payload: { chatId: 'tg_6001', sender: 'me', text: 'auto wait me', clientMessageId: 'cm_flood_short' },
      asyncQueue: true,
      deliverFn: shortDeliver,
    });
    assert.equal(shortRes.queued, true);

    await new Promise((r) => setTimeout(r, 320));
    await serverMod.flushMessageDbWriteQueue({ timeoutMs: 2000 });
    assert.equal(shortAttempts, 2, 'Short FLOOD_WAIT should automatically re-dispatch after wait');
    const shortRow = (await db.prepare(`SELECT delivery_status, telegram_message_id FROM messages WHERE id = 'flood_short_1'`).get()) as any;
    assert.equal(shortRow?.delivery_status, 'delivered');
    assert.equal(Number(shortRow?.telegram_message_id), 9010);

    // Case 2: Long FLOOD_WAIT (5s > 2s threshold) pauses message in DB & exposes HTTP resume + discard
    const longDeliver: typeof serverMod.deliverOutboundTelegramMessage = async () => ({
      delivered: false,
      channel: 'mtproto',
      floodWait: true,
      retryAfterSeconds: 5,
      floodWaitUntil: Date.now() + 5000,
      error: 'FLOOD_WAIT_5',
    });

    await serverMod.enqueueOutboundDelivery({
      id: 'flood_long_1',
      clientMessageId: 'cm_flood_long_1',
      effectiveAccountId: accId,
      payload: { chatId: 'tg_6001', sender: 'me', text: 'pause me', clientMessageId: 'cm_flood_long_1' },
      asyncQueue: true,
      deliverFn: longDeliver,
    });
    await new Promise((r) => setTimeout(r, 120));
    await serverMod.flushMessageDbWriteQueue({ timeoutMs: 2000 });

    const pausedRow = (await db.prepare(`SELECT delivery_status, queue_pause_reason FROM messages WHERE id = 'flood_long_1'`).get()) as any;
    assert.equal(pausedRow?.delivery_status, 'paused');
    assert.ok(String(pausedRow?.queue_pause_reason || '').includes('超过 2s 阈值'));

    // Reset account floodWaitUntil for HTTP resume test and mock conn.client.sendMessage
    serverMod.clearOutboundSchedulerForTesting();
    (conn.client as any).sendMessage = async () => ({ id: 9099 });

    const resumeResp = await fetch(`${baseUrl}/api/messages/flood_long_1/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ accountId: accId, asyncQueue: false }),
    });
    assert.equal(resumeResp.status, 200);
    const resumeJson: any = await resumeResp.json();
    assert.equal(resumeJson.delivered, true);
    assert.equal(resumeJson.telegramMessageId, 9099);

    // Case 3: Discard paused message deletes it from DB
    await db
      .prepare(
        `INSERT INTO messages (id, chat_id, account_id, sender, sender_name, text, timestamp, created_at, delivery_status, queue_pause_reason)
         VALUES ('flood_discard_1', 'tg_6001', ?, 'me', '我方', 'discard me', '10:02', ?, 'paused', 'manual wait')`
      )
      .run(accId, Date.now());

    const discardResp = await fetch(`${baseUrl}/api/messages/flood_discard_1/discard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ accountId: accId }),
    });
    assert.equal(discardResp.status, 200);
    const discardJson: any = await discardResp.json();
    assert.equal(discardJson.success, true);
    assert.equal(discardJson.discarded, true);
    const afterDiscard = await db.prepare(`SELECT id FROM messages WHERE id = 'flood_discard_1'`).get();
    assert.equal(afterDiscard, undefined);
  } finally {
    Object.assign(serverMod.outboundRuntimeConfig, prevConfig);
    await db.prepare(`DELETE FROM messages WHERE account_id = ?`).run(accId).catch(() => {});
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
    (srv as any).closeAllConnections?.();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
});

test('PEER_FLOOD hard circuit breaker: stops non-contact private DMs immediately without auto-retry while allowing known contacts/groups', async () => {
  const accId = 'acc_tg_peer_flood';
  const conn = makeFakeConn(accId, '880015', {
    dialogs: [{ id: 'tg_-1007777', rawId: '-1007777', isGroup: true }],
    async getEntityImpl(peer: any) {
      if (String(peer) === '777001') {
        return { id: 777001, contact: false }; // stranger
      }
      return { id: peer, contact: true };
    },
    async sendMessageImpl(peer: any) {
      if (String(peer) === '777001') {
        const err: any = new Error('PEER_FLOOD');
        err.errorMessage = 'PEER_FLOOD';
        throw err;
      }
      return { id: 8881 };
    },
  });
  serverMod.connectedUserClients.set(accId, conn);

  try {
    // 1. Trigger PEER_FLOOD when sending to stranger 777001
    const first = await serverMod.deliverOutboundTelegramMessage(
      { chatId: 'tg_777001', sender: 'me', text: 'hi stranger' },
      accId,
      'pf_1'
    );
    assert.equal(first.delivered, false);
    assert.equal(first.peerFlood, true);

    // 2. Subsequent send to stranger is immediately blocked by circuit breaker without calling MTProto sendMessage
    let rpcCalledOnBlocked = false;
    (conn.client as any).sendMessage = async () => {
      rpcCalledOnBlocked = true;
      return { id: 9999 };
    };
    const second = await serverMod.deliverOutboundTelegramMessage(
      { chatId: 'tg_777001', sender: 'me', text: 'hi again' },
      accId,
      'pf_2'
    );
    assert.equal(second.delivered, false);
    assert.equal(second.peerFlood, true);
    assert.equal(rpcCalledOnBlocked, false, 'Circuit breaker must reject stranger DM before MTProto sendMessage');

    // 3. Known group message is still allowed under PEER_FLOOD
    const groupRes = await serverMod.deliverOutboundTelegramMessage(
      { chatId: 'tg_-1007777', sender: 'me', text: 'hello known group' },
      accId,
      'pf_grp'
    );
    assert.equal(groupRes.delivered, true);
    assert.equal(rpcCalledOnBlocked, true);
  } finally {
    await db.prepare(`DELETE FROM messages WHERE account_id = ?`).run(accId).catch(() => {});
  }
});

test('Media PhotoSize thumbnail extraction, 512MB LRU disk cache eviction, and max-2 per-account 503 Retry-After', async () => {
  // 1. extractTelegramMediaMeta picks 'm' or 'x' PhotoSize for photo.sizes when wantThumb=true, skipping PhotoPathSize/PhotoSizeEmpty
  const mockPhotoMsg: any = {
    photo: true,
    media: {
      className: 'MessageMediaPhoto',
      photo: {
        sizes: [
          { className: 'PhotoPathSize', type: 'j', bytes: Buffer.from([1, 2]) },
          { className: 'PhotoSizeEmpty', type: 's' },
          { className: 'PhotoSize', type: 'm', size: 12000 },
          { className: 'PhotoSize', type: 'x', size: 48000 },
          { className: 'PhotoSizeProgressive', type: 'y', sizes: [20000, 95000] },
        ],
      },
    },
  };

  const thumbMeta = serverMod.extractTelegramMediaMeta(mockPhotoMsg, 501, true);
  assert.ok(thumbMeta.bestThumb, 'Should select a PhotoSize thumbnail when wantThumb=true');
  assert.equal(thumbMeta.bestThumb.type, 'm');
  assert.equal(thumbMeta.knownSize, 12000);
  assert.equal(thumbMeta.mime, 'image/jpeg');

  const fullMeta = serverMod.extractTelegramMediaMeta(mockPhotoMsg, 501, false);
  assert.equal(fullMeta.bestThumb, null);
  assert.equal(fullMeta.knownSize, 95000);

  // 2. Bounded disk cache LRU (mtime) eviction
  serverMod.clearTelegramMediaCachesForTesting();
  const prevMax = serverMod.outboundRuntimeConfig.mediaDiskCacheMaxBytes;
  serverMod.outboundRuntimeConfig.mediaDiskCacheMaxBytes = 1500;
  try {
    const k1 = 'test_media_evict_1';
    const k2 = 'test_media_evict_2';
    serverMod.writeTelegramMediaToDiskCache(k1, { buffer: Buffer.alloc(900, 1), mime: 'image/jpeg', fileName: '1.jpg' });
    await new Promise((r) => setTimeout(r, 25));
    serverMod.writeTelegramMediaToDiskCache(k2, { buffer: Buffer.alloc(900, 2), mime: 'image/jpeg', fileName: '2.jpg' });

    const r1 = serverMod.readTelegramMediaFromDiskCache(k1);
    const r2 = serverMod.readTelegramMediaFromDiskCache(k2);
    assert.equal(r1, null, 'Oldest cached item should be evicted when total > limit');
    assert.ok(r2 && r2.buffer.length === 900, 'Newest cached item should remain');
  } finally {
    serverMod.outboundRuntimeConfig.mediaDiskCacheMaxBytes = prevMax;
    serverMod.clearTelegramMediaCachesForTesting();
  }

  // 3. HTTP GET /api/telegram/user/media/:chatId/:msgId enforces max-2 concurrency per account with 503 + Retry-After + single-flight dedup
  const accId = 'acc_tg_media_limit';
  let releaseDownloads!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseDownloads = resolve;
  });
  let downloadCalls = 0;

  const conn = makeFakeConn(accId, '880016', {
    async getMessagesImpl(_peer, params) {
      const id = Array.isArray(params?.ids) ? params.ids[0] : 1;
      return [{ id, ...mockPhotoMsg }];
    },
    async downloadMediaImpl(msg) {
      downloadCalls += 1;
      await gate;
      return Buffer.from(`photo-${msg.id}`);
    },
  });
  serverMod.connectedUserClients.set(accId, conn);

  const srv = http.createServer(serverMod.app);
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  const { port } = srv.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const u1 = serverMod.signTelegramResourceUrl('/api/telegram/user/media/tg_9001/101', accId) + '&thumb=1';
    const u2 = serverMod.signTelegramResourceUrl('/api/telegram/user/media/tg_9001/102', accId) + '&thumb=1';
    const u3 = serverMod.signTelegramResourceUrl('/api/telegram/user/media/tg_9001/103', accId) + '&thumb=1';

    // Start 2 distinct downloads + 1 duplicate single-flight of 101 simultaneously
    const p1 = fetch(`${baseUrl}${u1}`);
    const p1Dup = fetch(`${baseUrl}${u1}`);
    const p2 = fetch(`${baseUrl}${u2}`);

    // Wait briefly until both slots are active
    await new Promise((r) => setTimeout(r, 50));

    // 3rd distinct media must immediately get 503 + Retry-After
    const p3Res = await fetch(`${baseUrl}${u3}`);
    assert.equal(p3Res.status, 503, 'Exceeding max 2 concurrent downloads per account should return 503');
    assert.equal(p3Res.headers.get('retry-after'), '2');

    releaseDownloads();
    const [r1, r1Dup, r2] = await Promise.all([p1, p1Dup, p2]);
    assert.equal(r1.status, 200);
    assert.equal(r1Dup.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(downloadCalls, 2, 'Single-flight dedup must share the in-flight download for msg 101');
  } finally {
    serverMod.clearTelegramMediaCachesForTesting();
    (srv as any).closeAllConnections?.();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
});

test('Differentiated SSE wakeup: private & focused group wake immediately while background groups batch once', async () => {
  const accId = 'acc_tg_sse_diff';
  const prevConfig = { ...serverMod.outboundRuntimeConfig };
  serverMod.outboundRuntimeConfig.bgGroupBatchMinMs = 80;
  serverMod.outboundRuntimeConfig.bgGroupBatchMaxMs = 80;

  const conn = makeFakeConn(accId, '880017', {
    dialogs: [
      { id: 'tg_-1008001', rawId: '-1008001', isGroup: true }, // focused group
      { id: 'tg_-1008002', rawId: '-1008002', isGroup: true }, // background group A
      { id: 'tg_-1008003', rawId: '-1008003', isGroup: true }, // background group B
      { id: 'tg_7001', rawId: '7001', isGroup: false },        // private chat
    ],
  });
  serverMod.connectedUserClients.set(accId, conn);

  const prevSecret = process.env.JWT_SECRET;
  const secret = 'test_secret_sse_diff_12345';
  process.env.JWT_SECRET = secret;
  const jwt = createTestJwt(secret, 'master');
  const srv = http.createServer(serverMod.app);
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  const { port } = srv.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const abortCtrl = new AbortController();
  const events: Array<{ event: string; data: any; at: number }> = [];

  try {
    // Sync focus chat to group -1008001 via HTTP
    const focusRes = await fetch(`${baseUrl}/api/telegram/user/focus-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ accountId: accId, chatId: 'tg_-1008001' }),
    });
    assert.equal(focusRes.status, 200);
    assert.equal(serverMod.getActiveFocusChat(accId), 'tg_-1008001');

    // Subscribe to SSE updates-stream
    const sseRes = await fetch(`${baseUrl}/api/telegram/user/updates-stream?accountId=${encodeURIComponent(accId)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: abortCtrl.signal,
    });
    assert.equal(sseRes.status, 200);
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const pumpPromise = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';
          for (const frame of frames) {
            const evLine = frame.split('\n').find((l) => l.startsWith('event: '));
            const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
            if (evLine && dataLine) {
              events.push({
                event: evLine.slice(7).trim(),
                data: JSON.parse(dataLine.slice(6)),
                at: Date.now(),
              });
            }
          }
        }
      } catch {}
    })();

    // Wait for initial 'connected' event
    await new Promise((r) => setTimeout(r, 30));

    // Push 1 private chat message & 1 active focused group message -> immediate wakeups
    const t0 = Date.now();
    serverMod.pushPendingLocalUpdate({
      id: 'upd_priv_1',
      type: 'message',
      chatId: 'tg_7001',
      accountId: accId,
      sender: 'peer',
      senderName: 'Alice',
      text: 'hi',
      timestamp: '10:00',
      createdAt: t0,
    });
    serverMod.pushPendingLocalUpdate({
      id: 'upd_focus_grp_1',
      type: 'message',
      chatId: 'tg_-1008001',
      accountId: accId,
      sender: 'peer',
      senderName: 'Bob',
      text: 'active group',
      timestamp: '10:00',
      createdAt: t0,
    });

    // Push 3 background group messages across 2 background groups -> coalesced into ONE batch_group wakeup
    serverMod.pushPendingLocalUpdate({
      id: 'upd_bg_1',
      type: 'message',
      chatId: 'tg_-1008002',
      accountId: accId,
      sender: 'peer',
      senderName: 'Spam1',
      text: 'bg1',
      timestamp: '10:00',
      createdAt: t0,
    });
    serverMod.pushPendingLocalUpdate({
      id: 'upd_bg_2',
      type: 'message',
      chatId: 'tg_-1008002',
      accountId: accId,
      sender: 'peer',
      senderName: 'Spam2',
      text: 'bg2',
      timestamp: '10:00',
      createdAt: t0,
    });
    serverMod.pushPendingLocalUpdate({
      id: 'upd_bg_3',
      type: 'message',
      chatId: 'tg_-1008003',
      accountId: accId,
      sender: 'peer',
      senderName: 'Spam3',
      text: 'bg3',
      timestamp: '10:00',
      createdAt: t0,
    });

    await new Promise((r) => setTimeout(r, 150));
    abortCtrl.abort();
    await pumpPromise;

    const wakeups = events.filter((e) => e.event === 'wakeup');
    const immediatePriv = wakeups.find((w) => w.data.mode === 'immediate' && w.data.chatId === 'tg_7001');
    const immediateFocus = wakeups.find((w) => w.data.mode === 'immediate' && w.data.chatId === 'tg_-1008001');
    const batchGroups = wakeups.filter((w) => w.data.mode === 'batch_group');

    assert.ok(immediatePriv, 'Private chat should trigger immediate SSE wakeup');
    assert.ok(immediateFocus, 'Focused group should trigger immediate SSE wakeup');
    assert.equal(batchGroups.length, 1, '3 background group messages should coalesce into 1 batch_group wakeup');
    assert.deepEqual(batchGroups[0].data.chatIds.sort(), ['tg_-1008002', 'tg_-1008003']);
  } finally {
    abortCtrl.abort();
    serverMod.clearActiveFocusAndSseForTesting();
    Object.assign(serverMod.outboundRuntimeConfig, prevConfig);
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
    (srv as any).closeAllConnections?.();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
});
