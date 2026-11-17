/**
 * 灵犀语境 (LingXi Context) Railway 私有云端智能训练与话术大脑服务端模板
 *
 * 部署架构说明：
 * 1. 本服务部署在您的私有 Railway 容器中，仅通过本地软件的 server.ts 后端代理转发访问，
 *    客户端前端代码及打包产物中绝不暴露本服务的真实域名。
 * 2. 鉴权机制（双轨支持）：
 *    - 方式 A：校验客户端转发的会员 RS256 JWT (Authorization: Bearer <token>)，自动校验卡密未过期。
 *    - 方式 B：校验独立企业分发密钥 (X-Engine-Key: lx-sk-...)，方便您按租户独立控制调用配额与禁用。
 * 3. 核心能力：
 *    - /v1/chat/completions：在服务端安全注入您私有训练的高情商大白话、真人聊天节奏与沟通技巧指令，
 *      客户端本地只传“人设资料 + 客户记忆 + 最近上下文”，绝不在客户端暴露您的核心话术体系。
 *    - /api/knowledge/search：从云端私有知识库检索高转化口语范本。
 *    - /api/v1/training/feedback：收集脱敏后的“操作员最终采纳发送回复”，用于云端训练库持续蒸馏微调。
 *
 * 所需 Railway 环境变量：
 * - PORT (默认 3000)
 * - UPSTREAM_LLM_BASE_URL (例如 https://api.openai.com/v1 或您的基座模型网关)
 * - UPSTREAM_LLM_API_KEY
 * - UPSTREAM_LLM_MODEL (例如 gpt-4o-mini)
 * - ENGINE_LICENSE_KEYS (逗号分隔的独立客户端授权密钥，例如 lx-sk-alpha001,lx-sk-vip002)
 * - JWT_PUBLIC_KEY (可选；默认使用下方内置公钥，与 Cloudflare Worker 私钥配对)
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import busboy from 'busboy';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(express.json({ limit: '4mb' }));

const PORT = Number(process.env.PORT || 3000);

function stripCloudThinkingTags(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw
    .replace(/<(?:thought|think)\b[^>]*>[\s\S]*?<\/(?:thought|think)\s*>/gi, '')
    .replace(/<(?:thought|think)\b[^>]*>[\s\S]*$/gi, '');
  if (/<\/(?:thought|think)\s*>/i.test(cleaned)) {
    cleaned = cleaned.replace(/^[\s\S]*?<\/(?:thought|think)\s*>/i, '');
  }
  return cleaned.trim();
}

const DEFAULT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0s5gFU5TfCr7mbuuC/96
EJJnEbuAC5Vw4+vqrXZrvvmiUZAAlULHV5kP6OFEJI3wXOGKAV5cqGezcYFT/P3m
I2mBLGqc0JHjCQZALb/GGluyCc1cmOiKbWDHgwFCd3fuCao0oborg7lzhg/Zy962
zKLUy9eFI5vyAwbYDbXiCNGbnJX6qeoZDJ6HyKC2kt1AOGj3UpNElh73dUnjsNlv
8ryJLqfq9IR6Xej8TDj2lxibCW3uUDCtb8UPQToweiHphflSc6v9ppNXM3l0rfZI
EYvpYe7IaRgd6AZJOMapvz7dY8ZoiqdgqUr33NxliQdDaUYakRDna+Fz+pt2cwgh
UwIDAQAB
-----END PUBLIC KEY-----`;

const JWT_PUBLIC_KEY = (process.env.JWT_PUBLIC_KEY || DEFAULT_PUBLIC_KEY).replace(/\\n/g, '\n');

const VALID_ENGINE_KEYS = new Set(
  String(process.env.ENGINE_LICENSE_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
);

// 云端私有真人聊天技巧核心 System Directives (仅存于 Railway 服务端，绝不下发到客户端)
const CLOUD_ORAL_SYSTEM_DIRECTIVES = `
[云端私有语料与真人聊天拟真底层引擎]
1. 极简手机打字质感：像真人在手机 Telegram 私聊，单次回复控制在 1-2 句口语短句，绝对禁止写成客服报告或“1. 2. 3.”分点长文。
2. 情绪共鸣优先：对方倾诉疲惫或分享生活时，先给一句有温度的接梗安抚（如“抱抱”、“辛苦啦”），再顺着话题自然延伸，不要急于推销。
3. 自然口语呼吸感：适当使用“哈哈”、“害”、“其实”、“嗯呐”、“对呀”、“好滴”等生活口语词，避免“请问有什么可以帮您”、“综上所述”等 AI 机械腔。
4. 循序渐进节奏：结合客户传入的当前关系阶段与人设档案，严守禁止词红线，润物细无声地推进信任。
`.trim();

// 云端私有话术语料样本库 (基础预设 + 运行期跨租户持续习得的真实聊天技巧)
const CLOUD_PLAYBOOK_ITEMS = [
  {
    id: 'cloud_kb_1',
    title: '真人共情接梗话术（疲惫/加班场景）',
    keywords: ['累', '加班', '烦', '压力', '辛苦', '疲惫'],
    content: '先别聊正事：用生活口吻接一句“刚忙完呀？快去喝口温水歇会儿，别把自己逼太紧了”，给足情绪呼吸感。',
  },
  {
    id: 'cloud_kb_2',
    title: '自然破冰与城市日常拉近',
    keywords: ['你好', '城市', '哪里', '干嘛', '周末', '在吗'],
    content: '顺手分享一个生活画面感细节（比如刚手冲完咖啡或散步回来），再轻量反问对方当地天气或近况，避免查户口式连续提问。',
  },
  {
    id: 'cloud_kb_3',
    title: '怀疑试探与安全感化解',
    keywords: ['套路', '骗', '真假', '靠谱', '认真', '信任'],
    content: '绝不急着自证或长篇辩解：用松弛坦荡的口吻回应“哈哈有防备心很正常呀，网上本来就杂，慢慢了解处得来就处，不强求的”。',
  },
];

interface LearnedSkillRecord {
  id: string;
  type: string;
  title: string;
  description: string;
  examplePattern: string;
  stage?: string;
  confidenceScore?: number;
  learnedAt: number;
}

const LEARNED_SKILLS_PATH = path.join(process.cwd(), 'learned_skills.jsonl');
const FEEDBACK_LOG_PATH = path.join(process.cwd(), 'training_feedback.jsonl');
const learnedSkillsCache: LearnedSkillRecord[] = [];
const feedbackSnippetsCache: Array<{ stage: string; personaRole: string; snippet: string; peerCue?: string }> = [];

function loadPersistedTrainingMemory() {
  try {
    if (fs.existsSync(LEARNED_SKILLS_PATH)) {
      const lines = fs.readFileSync(LEARNED_SKILLS_PATH, 'utf8').split('\n').filter(Boolean);
      const seen = new Set<string>();
      for (const line of lines.slice(-100)) {
        try {
          const parsed = JSON.parse(line) as LearnedSkillRecord;
          const key = `${parsed.title}::${parsed.examplePattern}`.trim();
          if (parsed.title && !seen.has(key)) {
            seen.add(key);
            learnedSkillsCache.push(parsed);
          }
        } catch {}
      }
    }
  } catch {}
  try {
    if (fs.existsSync(FEEDBACK_LOG_PATH)) {
      const lines = fs.readFileSync(FEEDBACK_LOG_PATH, 'utf8').split('\n').filter(Boolean);
      for (const line of lines.slice(-30)) {
        try {
          const parsed = JSON.parse(line);
          if (parsed?.snippet) {
            feedbackSnippetsCache.push({
              stage: String(parsed.stage || 'general'),
              personaRole: String(parsed.personaRole || ''),
              snippet: String(parsed.snippet),
              peerCue: parsed.peerCue ? String(parsed.peerCue) : undefined,
            });
          }
        } catch {}
      }
    }
  } catch {}
}

loadPersistedTrainingMemory();

function appendLearnedSkills(patterns: any[]): number {
  const seen = new Set(learnedSkillsCache.map((s) => `${s.title}::${s.examplePattern}`.trim()));
  let added = 0;
  for (const p of patterns) {
    const title = String(p?.title || '').trim();
    const description = String(p?.description || '').trim();
    const examplePattern = String(p?.examplePattern || p?.snippet || '').trim();
    if (!title && !description && !examplePattern) continue;
    const dedupeKey = `${title}::${examplePattern}`.trim();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const record: LearnedSkillRecord = {
      id: String(p?.id || `skill_${Date.now()}_${added}`),
      type: String(p?.type || 'chat_skill'),
      title: title || '实战对话技巧',
      description,
      examplePattern,
      stage: p?.stage ? String(p.stage) : undefined,
      confidenceScore: typeof p?.confidenceScore === 'number' ? p.confidenceScore : undefined,
      learnedAt: Number(p?.learnedAt || Date.now()),
    };
    learnedSkillsCache.push(record);
    if (learnedSkillsCache.length > 100) {
      learnedSkillsCache.shift();
    }
    try {
      fs.appendFileSync(LEARNED_SKILLS_PATH, JSON.stringify(record) + '\n', 'utf8');
    } catch {}
    added++;
  }
  return added;
}

function buildDynamicCloudSystemDirectives(): string {
  const sections: string[] = [CLOUD_ORAL_SYSTEM_DIRECTIVES];

  if (learnedSkillsCache.length > 0) {
    const recentSkills = learnedSkillsCache
      .slice(-12)
      .reverse()
      .map(
        (s) =>
          `- [${s.title}]: ${s.description || '实战沟通范式'}${s.examplePattern ? `（示例：“${s.examplePattern.slice(0, 180)}”）` : ''}`
      )
      .join('\n');
    sections.push(`\n【云端自进化持续习得的真人聊天技巧与风格库（全员实战蒸馏）】：\n${recentSkills}`);
  }

  if (feedbackSnippetsCache.length > 0) {
    const recentAdopted = feedbackSnippetsCache
      .slice(-5)
      .reverse()
      .map((f) => `- (${f.stage}) 真实采纳回复: “${f.snippet.slice(0, 140)}”`)
      .join('\n');
    sections.push(`\n【近期高转化真人采纳示范】：\n${recentAdopted}`);
  }

  return sections.join('\n');
}

function verifyRs256Jwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header?.alg !== 'RS256') return null;

    const ok = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${h}.${p}`),
      JWT_PUBLIC_KEY,
      Buffer.from(sig, 'base64url')
    );
    if (!ok) return null;

    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp <= nowSec) return null;
    if (typeof payload.vipExpiresAt === 'number' && payload.vipExpiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireCloudAuth(req: Request, res: Response, next: NextFunction) {
  const engineKey = String(req.headers['x-engine-key'] || '').trim();
  const authHeader = String(req.headers['authorization'] || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (engineKey && VALID_ENGINE_KEYS.has(engineKey)) {
    (req as any).cloudTenant = { mode: 'license_key', keyPrefix: engineKey.slice(0, 12) };
    return next();
  }

  if (bearer) {
    // 兼容部分客户端直接以 Bearer 形式传 lx-sk-... 或传 RS256 会员 JWT
    if (VALID_ENGINE_KEYS.has(bearer)) {
      (req as any).cloudTenant = { mode: 'license_key', keyPrefix: bearer.slice(0, 12) };
      return next();
    }
    const jwtUser = verifyRs256Jwt(bearer);
    if (jwtUser) {
      (req as any).cloudTenant = { mode: 'member_jwt', username: jwtUser.username, plan: jwtUser.plan };
      return next();
    }
  }

  return res.status(401).json({
    ok: false,
    error: 'Unauthorized: 需要有效的会员 RS256 令牌或 lx-sk- 引擎授权密钥',
  });
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'lingxi-cloud-engine',
    learnedSkillsCount: learnedSkillsCache.length,
    feedbackCount: feedbackSnippetsCache.length,
  });
});

app.post('/api/knowledge/search', requireCloudAuth, (req: Request, res: Response) => {
  const query = String(req.body?.query || '').toLowerCase();
  const topK = Math.min(Math.max(Number(req.body?.topK) || 3, 1), 8);

  const dynamicItems = learnedSkillsCache.map((s) => ({
    id: s.id,
    title: s.title,
    keywords: [s.type, s.title, s.description].filter(Boolean),
    content: `${s.description}${s.examplePattern ? ` 示例：“${s.examplePattern}”` : ''}`,
  }));

  const combined = [...dynamicItems.reverse(), ...CLOUD_PLAYBOOK_ITEMS];
  const scored = combined
    .map((item) => {
      let score = 0;
      for (const kw of item.keywords) {
        const cleanKw = String(kw).toLowerCase();
        if (cleanKw && (query.includes(cleanKw) || cleanKw.includes(query))) {
          score += 2;
        }
      }
      return { ...item, score };
    })
    .filter((i) => i.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const items = scored.length > 0 ? scored : combined.slice(0, Math.min(2, topK));
  res.json({ ok: true, items });
});

app.post('/api/v1/evolution/sync', requireCloudAuth, (req: Request, res: Response) => {
  const patterns = Array.isArray(req.body?.patterns) ? req.body.patterns : [];
  if (patterns.length === 0) {
    return res.status(400).json({ ok: false, error: 'patterns array is required' });
  }

  const learnedCount = appendLearnedSkills(patterns);
  res.json({
    ok: true,
    learnedCount,
    totalSkills: learnedSkillsCache.length,
  });
});

app.post('/api/v1/training/feedback', requireCloudAuth, (req: Request, res: Response) => {
  const snippet = String(req.body?.snippet || '').trim();
  const peerCue = String(req.body?.peerCue || '').trim();
  const stage = String(req.body?.stage || 'general').trim();
  const personaRole = String(req.body?.personaRole || '').trim();

  if (!snippet) {
    return res.status(400).json({ ok: false, error: 'snippet is required' });
  }

  const record = {
    ts: new Date().toISOString(),
    tenant: (req as any).cloudTenant,
    stage,
    personaRole,
    peerCue: peerCue.slice(0, 200),
    snippet: snippet.slice(0, 500),
  };

  feedbackSnippetsCache.push({
    stage,
    personaRole,
    snippet: record.snippet,
    peerCue: record.peerCue || undefined,
  });
  if (feedbackSnippetsCache.length > 40) {
    feedbackSnippetsCache.shift();
  }

  if (stage.startsWith('evolution_') || stage.startsWith('transcript_style')) {
    appendLearnedSkills([
      {
        type: stage,
        title: peerCue || personaRole || '实战对话技巧',
        description: snippet,
        examplePattern: snippet,
        stage,
      },
    ]);
  }

  try {
    fs.appendFileSync(FEEDBACK_LOG_PATH, JSON.stringify(record) + '\n', 'utf8');
  } catch {}

  res.json({ ok: true, stored: true, totalSkills: learnedSkillsCache.length });
});

function buildSafeUpstreamChatBody(
  rawBody: unknown,
  upstreamModel: string,
  mergedMessages: any[]
): Record<string, any> {
  const src =
    rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? (rawBody as Record<string, any>)
      : {};
  const payload: Record<string, any> = {
    model: upstreamModel,
    messages: mergedMessages,
    stream: false,
  };
  const allowedOptionalKeys = [
    'temperature',
    'max_tokens',
    'top_p',
    'presence_penalty',
    'frequency_penalty',
    'stop',
    'seed',
    'n',
    'response_format',
    'user',
  ] as const;
  for (const key of allowedOptionalKeys) {
    if (src[key] !== undefined) {
      payload[key] = src[key];
    }
  }
  if (payload.max_tokens === undefined && src.maxOutputTokens !== undefined) {
    payload.max_tokens = src.maxOutputTokens;
  }
  return payload;
}

app.post('/v1/chat/completions', requireCloudAuth, async (req: Request, res: Response) => {
  const upstreamBase = String(process.env.UPSTREAM_LLM_BASE_URL || '').replace(/\/+$/, '');
  const upstreamKey = String(process.env.UPSTREAM_LLM_API_KEY || '').trim();
  const geminiApiKey = String(process.env.GEMINI_API_KEY || '').trim();
  const isTranslationTask = req.body?.purpose === 'translation';
  const requestedModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  const contextPayload = req.body?.contextPayload;

  // Validate structured contextPayload if supplied by client 9-step pipeline
  if (!isTranslationTask && contextPayload !== undefined) {
    if (
      !contextPayload ||
      typeof contextPayload !== 'object' ||
      !String(contextPayload.customerId || '').trim() ||
      !Array.isArray(contextPayload.recentMessages) ||
      contextPayload.recentMessages.length === 0 ||
      contextPayload.recentMessages.length > 30
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid contextPayload: customerId and 1..30 recentMessages are required',
      });
    }
  }

  const upstreamModel =
    isTranslationTask && requestedModel
      ? requestedModel
      : String(process.env.UPSTREAM_LLM_MODEL || requestedModel || (geminiApiKey ? 'gemini-4-hydrogen' : 'gpt-4o-mini')).trim();

  const incomingMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const mergedMessages = isTranslationTask
    ? incomingMessages
    : [
        { role: 'system', content: buildDynamicCloudSystemDirectives() },
        ...incomingMessages,
      ];

  // Option A: Native Gemini execution via @google/genai when GEMINI_API_KEY is configured (and no OpenAI upstream proxy overrides it)
  const isNativeGeminiOrGemmaModel =
    upstreamModel.startsWith('gemini-') || (isTranslationTask && upstreamModel.startsWith('gemma-'));
  const shouldUseNativeGemini = Boolean(geminiApiKey) && (!upstreamBase || !upstreamKey || isNativeGeminiOrGemmaModel);
  if (shouldUseNativeGemini) {
    try {
      const ai = new GoogleGenAI({
        apiKey: geminiApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      const systemTexts = mergedMessages
        .filter((m: any) => m?.role === 'system' && m?.content)
        .map((m: any) => String(m.content))
        .join('\n\n');
      const dialogueTurns = mergedMessages
        .filter((m: any) => m?.role !== 'system')
        .map((m: any) => ({
          role: m?.role === 'assistant' || m?.role === 'model' ? 'model' : 'user',
          parts: [{ text: String(m?.content || m?.text || '') }],
        }))
        .filter((t: any) => t.parts[0].text.trim().length > 0);

      const geminiModel = isNativeGeminiOrGemmaModel ? upstreamModel : 'gemini-4-hydrogen';
      const isGemmaModel = geminiModel.startsWith('gemma-');

      const rawTemp = req.body?.temperature;
      const parsedTemp = typeof rawTemp === 'number' ? rawTemp : Number(rawTemp);
      const validTemp =
        rawTemp !== undefined && rawTemp !== null && rawTemp !== '' && Number.isFinite(parsedTemp)
          ? Math.min(Math.max(parsedTemp, 0), 2)
          : undefined;

      const rawMaxTokens = req.body?.max_tokens ?? req.body?.maxOutputTokens;
      const parsedMaxTokens = typeof rawMaxTokens === 'number' ? rawMaxTokens : Number(rawMaxTokens);
      const validMaxTokens =
        rawMaxTokens !== undefined &&
        rawMaxTokens !== null &&
        rawMaxTokens !== '' &&
        Number.isFinite(parsedMaxTokens) &&
        parsedMaxTokens > 0
          ? Math.floor(parsedMaxTokens)
          : undefined;

      let effectiveTurns =
        dialogueTurns.length > 0 ? dialogueTurns : [{ role: 'user', parts: [{ text: '你好' }] }];
      if (isGemmaModel && systemTexts) {
        if (effectiveTurns[0]?.role === 'user') {
          const firstText = String(effectiveTurns[0]?.parts?.[0]?.text || '');
          effectiveTurns = [
            { role: 'user', parts: [{ text: `${systemTexts}\n\n${firstText}`.trim() }] },
            ...effectiveTurns.slice(1),
          ];
        } else {
          effectiveTurns = [
            { role: 'user', parts: [{ text: systemTexts }] },
            ...effectiveTurns,
          ];
        }
      }

      const geminiConfig: Record<string, any> = {};
      if (systemTexts && !isGemmaModel) {
        geminiConfig.systemInstruction = systemTexts;
      }
      if (validTemp !== undefined) {
        geminiConfig.temperature = validTemp;
      }
      if (validMaxTokens !== undefined) {
        geminiConfig.maxOutputTokens = validMaxTokens;
      }

      const geminiRes = await ai.models.generateContent({
        model: geminiModel,
        contents: effectiveTurns,
        config: Object.keys(geminiConfig).length > 0 ? geminiConfig : undefined,
      });

      const candidateParts = (geminiRes as any)?.candidates?.[0]?.content?.parts;
      const nonThoughtText = Array.isArray(candidateParts)
        ? candidateParts
            .filter((p: any) => !p?.thought && typeof p?.text === 'string')
            .map((p: any) => p.text)
            .join('')
        : '';
      const replyText = stripCloudThinkingTags(nonThoughtText || geminiRes.text || '');
      if (!replyText) {
        return res.status(502).json({ ok: false, error: `Gemini(${geminiModel}) returned empty content` });
      }
      return res.json({
        id: `chatcmpl_${Date.now()}`,
        object: 'chat.completion',
        model: geminiModel,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: replyText },
            finish_reason: 'stop',
          },
        ],
      });
    } catch (err: any) {
      return res.status(502).json({ ok: false, error: err?.message || 'Cloud Gemini execution error' });
    }
  }

  // Option B: Upstream OpenAI-compatible gateway proxy
  if (!upstreamBase || !upstreamKey) {
    return res.status(503).json({
      ok: false,
      error: 'Cloud engine upstream LLM not configured (GEMINI_API_KEY or UPSTREAM_LLM_BASE_URL / UPSTREAM_LLM_API_KEY)',
    });
  }

  try {
    const upstreamPayload = buildSafeUpstreamChatBody(req.body, upstreamModel, mergedMessages);
    const upstreamRes = await fetch(`${upstreamBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upstreamKey}`,
      },
      body: JSON.stringify(upstreamPayload),
    });

    const contentType = String(upstreamRes.headers.get('content-type') || '').toLowerCase();
    const rawText = await upstreamRes.text();
    if (contentType.includes('text/event-stream')) {
      return res.status(502).json({
        ok: false,
        error: 'Upstream LLM gateway returned SSE stream despite stream=false',
      });
    }

    let data: any;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      const status = upstreamRes.ok ? 502 : upstreamRes.status;
      return res.status(status).json({
        ok: false,
        error: `Upstream LLM gateway returned non-JSON response (HTTP ${upstreamRes.status})`,
      });
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(upstreamRes.ok ? 502 : upstreamRes.status).json({
        ok: false,
        error: `Upstream LLM gateway returned empty or invalid JSON payload (HTTP ${upstreamRes.status})`,
      });
    }

    if (Array.isArray(data.choices)) {
      for (const ch of data.choices) {
        if (typeof ch?.message?.content === 'string') {
          ch.message.content = stripCloudThinkingTags(ch.message.content);
        }
      }
    }
    return res.status(upstreamRes.status).json(data);
  } catch (err: any) {
    return res.status(502).json({ ok: false, error: err?.message || 'Upstream LLM gateway error' });
  }
});

app.post('/v1/audio/transcriptions', requireCloudAuth, async (req: Request, res: Response) => {
  const upstreamBase = String(process.env.UPSTREAM_LLM_BASE_URL || '').replace(/\/+$/, '');
  const upstreamKey = String(process.env.UPSTREAM_LLM_API_KEY || '').trim();
  const geminiApiKey = String(process.env.GEMINI_API_KEY || '').trim();

  let audioBuffer: Buffer | null = null;
  let audioMime = 'audio/ogg';
  let fileName = 'audio.ogg';
  let requestedModel = '';

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    try {
      const parsed = await new Promise<{ buf: Buffer; mime: string; name: string; model: string }>((resolve, reject) => {
        const bb = busboy({ headers: req.headers, limits: { fileSize: 25 * 1024 * 1024 } });
        const chunks: Buffer[] = [];
        let mime = 'audio/ogg';
        let name = 'audio.ogg';
        let model = '';
        let fileSeen = false;

        bb.on('field', (fieldName, val) => {
          if (fieldName === 'model' && typeof val === 'string') {
            model = val.trim();
          }
        });
        bb.on('file', (_fieldName, file, info) => {
          fileSeen = true;
          mime = info?.mimeType || 'audio/ogg';
          name = info?.filename || 'audio.ogg';
          file.on('data', (chunk: Buffer) => chunks.push(chunk));
        });
        bb.on('error', reject);
        bb.on('finish', () => {
          if (!fileSeen || chunks.length === 0) {
            return reject(new Error('Audio file is required'));
          }
          resolve({ buf: Buffer.concat(chunks), mime, name, model });
        });
        req.pipe(bb);
      });
      audioBuffer = parsed.buf;
      audioMime = parsed.mime;
      fileName = parsed.name;
      requestedModel = parsed.model;
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err?.message || 'Invalid multipart audio payload' });
    }
  } else {
    const rawB64 = String(req.body?.audioBase64 || '').trim();
    if (!rawB64) {
      return res.status(400).json({ ok: false, error: 'Audio file or audioBase64 is required' });
    }
    const cleanB64 = rawB64.replace(/^data:[^;]+;base64,/, '');
    audioBuffer = Buffer.from(cleanB64, 'base64');
    audioMime = String(req.body?.mimeType || 'audio/ogg');
    requestedModel = String(req.body?.model || '').trim();
  }

  if (!audioBuffer || audioBuffer.length === 0) {
    return res.status(400).json({ ok: false, error: 'Audio payload is empty' });
  }

  const isGeminiStt = !upstreamBase || !upstreamKey || (geminiApiKey && requestedModel.startsWith('gemini-'));
  if (geminiApiKey && isGeminiStt) {
    try {
      const ai = new GoogleGenAI({
        apiKey: geminiApiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const sttModel =
        requestedModel && requestedModel.startsWith('gemini-')
          ? requestedModel
          : String(process.env.GEMINI_STT_MODEL || 'gemini-2.5-flash').trim();
      const geminiRes = await ai.models.generateContent({
        model: sttModel,
        contents: {
          parts: [
            { inlineData: { mimeType: audioMime, data: audioBuffer.toString('base64') } },
            { text: 'Transcribe this voice message accurately into text verbatim.' },
          ],
        },
      });
      const text = geminiRes.text?.trim() || '';
      if (!text) {
        return res.status(502).json({ ok: false, error: `Gemini(${sttModel}) returned empty transcription` });
      }
      return res.json({ text, model: sttModel });
    } catch (err: any) {
      return res.status(502).json({ ok: false, error: err?.message || 'Cloud STT error' });
    }
  }

  if (!upstreamBase || !upstreamKey) {
    return res.status(503).json({
      ok: false,
      error: 'Cloud STT not configured (GEMINI_API_KEY or UPSTREAM_LLM_BASE_URL / UPSTREAM_LLM_API_KEY)',
    });
  }

  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audioBuffer)], { type: audioMime }), fileName);
    const openAiSttModel =
      requestedModel && !/^gemini-/i.test(requestedModel)
        ? requestedModel
        : String(process.env.UPSTREAM_STT_MODEL || 'whisper-1').trim();
    form.append('model', openAiSttModel);
    const encodedForm = new Response(form);
    const formBuf = Buffer.from(await encodedForm.arrayBuffer());
    const upstreamRes = await fetch(`${upstreamBase}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': encodedForm.headers.get('content-type') || 'multipart/form-data',
        Authorization: `Bearer ${upstreamKey}`,
      },
      body: formBuf,
    });
    const data = await upstreamRes.json().catch(() => ({}));
    return res.status(upstreamRes.status).json(data);
  } catch (err: any) {
    return res.status(502).json({ ok: false, error: err?.message || 'Upstream STT gateway error' });
  }
});

app.post('/v1/audio/speech', requireCloudAuth, async (req: Request, res: Response) => {
  const upstreamBase = String(process.env.UPSTREAM_LLM_BASE_URL || '').replace(/\/+$/, '');
  const upstreamKey = String(process.env.UPSTREAM_LLM_API_KEY || '').trim();
  const geminiApiKey = String(process.env.GEMINI_API_KEY || '').trim();

  const input = String(req.body?.input || '').trim();
  if (!input) {
    return res.status(400).json({ ok: false, error: 'input text is required' });
  }
  const requestedModel = String(req.body?.model || '').trim();
  const geminiVoice = String(req.body?.gemini_voice || 'Kore').trim();
  const openAiVoice = String(req.body?.voice || 'nova').trim();
  const toneStyle = String(req.body?.tone_style || '').trim();
  const responseFormat = String(req.body?.response_format || 'mp3').trim();

  const shouldUseGeminiTts = Boolean(geminiApiKey) && (!upstreamBase || !upstreamKey || requestedModel.startsWith('gemini-'));
  if (shouldUseGeminiTts) {
    try {
      const ai = new GoogleGenAI({
        apiKey: geminiApiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const ttsModel =
        requestedModel && requestedModel.startsWith('gemini-')
          ? requestedModel
          : String(process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts').trim();
      const response = await ai.models.generateContent({
        model: ttsModel,
        contents: [{ role: 'user', parts: [{ text: input }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice } } },
          systemInstruction: toneStyle
            ? `Please speak in an authentic, natural voice with tone and style: ${toneStyle}`
            : undefined,
        },
      });
      const audioPart = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      const base64Audio = audioPart?.data;
      if (!base64Audio) {
        return res.status(502).json({ ok: false, error: `Gemini(${ttsModel}) returned empty audio` });
      }
      const mimeType = audioPart?.mimeType || 'audio/wav';
      return res.json({
        audio: `data:${mimeType};base64,${base64Audio}`,
        model: ttsModel,
      });
    } catch (err: any) {
      return res.status(502).json({ ok: false, error: err?.message || 'Cloud TTS error' });
    }
  }

  if (!upstreamBase || !upstreamKey) {
    return res.status(503).json({
      ok: false,
      error: 'Cloud TTS not configured (GEMINI_API_KEY or UPSTREAM_LLM_BASE_URL / UPSTREAM_LLM_API_KEY)',
    });
  }

  try {
    const openAiTtsModel =
      requestedModel && !/^gemini-/i.test(requestedModel)
        ? requestedModel
        : String(process.env.UPSTREAM_TTS_MODEL || 'tts-1').trim();
    const upstreamRes = await fetch(`${upstreamBase}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upstreamKey}`,
      },
      body: JSON.stringify({
        model: openAiTtsModel,
        input,
        voice: openAiVoice,
        response_format: responseFormat,
      }),
    });
    if (!upstreamRes.ok) {
      const errTxt = await upstreamRes.text().catch(() => '');
      return res.status(upstreamRes.status).json({ ok: false, error: errTxt || `Upstream HTTP ${upstreamRes.status}` });
    }
    const contentType = upstreamRes.headers.get('content-type') || 'audio/mpeg';
    if (contentType.includes('application/json')) {
      const json = await upstreamRes.json().catch(() => ({}));
      return res.status(200).json(json);
    }
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    return res.status(200).send(buf);
  } catch (err: any) {
    return res.status(502).json({ ok: false, error: err?.message || 'Upstream TTS gateway error' });
  }
});

app.listen(PORT, () => {
  console.log(`[LingXi Cloud Engine] listening on port ${PORT}`);
});
