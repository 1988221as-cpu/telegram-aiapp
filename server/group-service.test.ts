import test from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, db } from './db';
import {
  extractTelegramGroupServiceFields,
  normalizeStoredMessageRecord,
  upsertSyncedMessageToDb,
} from '../server';

test('extractTelegramGroupServiceFields parses join, invite, link, request, leave, and kick events', () => {
  const selfJoin = extractTelegramGroupServiceFields({
    fromId: { userId: 101 },
    sender: { id: 101, firstName: 'Alice', lastName: 'Chen' },
    action: { className: 'MessageActionChatAddUser', users: [101] },
  });
  assert.ok(selfJoin);
  assert.equal(selfJoin.systemEventType, 'join');
  assert.equal(selfJoin.text, '👤 Alice Chen 加入了群组');

  const resolvedMap = new Map<string, string>([
    ['201', 'Bob'],
    ['202', 'Carol'],
  ]);
  const inviteJoin = extractTelegramGroupServiceFields(
    {
      fromId: { userId: 201 },
      action: { className: 'MessageActionChatAddUser', users: [202] },
    },
    resolvedMap
  );
  assert.ok(inviteJoin);
  assert.equal(inviteJoin.systemEventType, 'join');
  assert.equal(inviteJoin.text, '👤 Bob 邀请 Carol 加入了群组');

  const linkJoin = extractTelegramGroupServiceFields({
    fromId: { userId: 301 },
    sender: { id: 301, username: 'david_k' },
    action: { className: 'MessageActionChatJoinedByLink', inviterId: 1 },
  });
  assert.ok(linkJoin);
  assert.equal(linkJoin.systemEventType, 'join');
  assert.equal(linkJoin.text, '👤 @david_k 通过邀请链接加入了群组');

  const reqJoin = extractTelegramGroupServiceFields({
    fromId: { userId: 302 },
    sender: { id: 302, firstName: 'Eve' },
    action: { className: 'MessageActionChatJoinedByRequest' },
  });
  assert.ok(reqJoin);
  assert.equal(reqJoin.systemEventType, 'join');
  assert.equal(reqJoin.text, '👤 Eve 经管理员批准加入了群组');

  const selfLeave = extractTelegramGroupServiceFields({
    fromId: { userId: 401 },
    sender: { id: 401, firstName: 'Frank' },
    action: { className: 'MessageActionChatDeleteUser', userId: 401 },
  });
  assert.ok(selfLeave);
  assert.equal(selfLeave.systemEventType, 'leave');
  assert.equal(selfLeave.text, '🚪 Frank 退出了群组');

  const adminKick = extractTelegramGroupServiceFields(
    {
      fromId: { userId: 201 },
      action: { className: 'MessageActionChatDeleteUser', userId: 202 },
    },
    resolvedMap
  );
  assert.ok(adminKick);
  assert.equal(adminKick.systemEventType, 'leave');
  assert.equal(adminKick.text, '🚪 Bob 将 Carol 移出了群组');
});

test('SQLite persistence preserves sender=system and system_event_type across upsertSyncedMessageToDb', async () => {
  await initDatabase();

  const chatId = `tg_-100999888_${Date.now()}`;
  const accountId = 'acc_tg_test_group_svc';

  const joinMsg = normalizeStoredMessageRecord({
    id: `msg_sys_join_${Date.now()}`,
    chatId,
    accountId,
    sender: 'system',
    systemEventType: 'join',
    text: '👤 Alice 加入了群组',
    timestamp: '12:00',
    createdAt: Date.now(),
    telegramMessageId: 5001,
  });
  assert.ok(joinMsg);
  assert.equal(joinMsg.sender, 'system');
  assert.equal(joinMsg.systemEventType, 'join');

  const leaveMsg = normalizeStoredMessageRecord({
    id: `msg_sys_leave_${Date.now()}`,
    chatId,
    accountId,
    sender: 'system',
    systemEventType: 'leave',
    text: '🚪 Bob 退出了群组',
    timestamp: '12:01',
    createdAt: Date.now() + 1000,
    telegramMessageId: 5002,
  });
  assert.ok(leaveMsg);
  assert.equal(leaveMsg.sender, 'system');
  assert.equal(leaveMsg.systemEventType, 'leave');

  assert.equal(await upsertSyncedMessageToDb(joinMsg, chatId, accountId), true);
  assert.equal(await upsertSyncedMessageToDb(leaveMsg, chatId, accountId), true);

  const rows = (await db
    .prepare('SELECT id, sender, system_event_type, text FROM messages WHERE chat_id = ? ORDER BY created_at ASC')
    .all(chatId)) as any[];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sender, 'system');
  assert.equal(rows[0].system_event_type, 'join');
  assert.equal(rows[0].text, '👤 Alice 加入了群组');
  assert.equal(rows[1].sender, 'system');
  assert.equal(rows[1].system_event_type, 'leave');
  assert.equal(rows[1].text, '🚪 Bob 退出了群组');

  // Cleanup test rows
  await db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
});
