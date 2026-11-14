import crypto from 'node:crypto';
import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';

export class KnowledgeDocumentError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 400, code = 'INVALID_DOCUMENT') {
    super(message);
    this.name = 'KnowledgeDocumentError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ParsedKnowledgeDocument {
  fileName: string;
  extension: string;
  detectedEncoding: string;
  extractedText: string;
  charCount: number;
  pageCount?: number;
}

const SUPPORTED_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '']);
const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.pdf', '']);
const MAX_UPLOAD_RAW_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_EXTRACTED_CHARS = 300_000;

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function normalizeKnowledgeTextForHash(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildKnowledgeItemFingerprint(title: string, content: string): string {
  return sha256Hex(`${normalizeKnowledgeTextForHash(title)}::${normalizeKnowledgeTextForHash(content)}`);
}

function countMeaningfulChars(text: string): number {
  const matches = String(text || '').match(/[\p{L}\p{N}]/gu);
  return matches ? matches.length : 0;
}

export function assertReadableDecodedText(text: string, label = '文档'): void {
  const normalized = String(text || '');
  if (!normalized.trim()) {
    throw new KnowledgeDocumentError(`${label}内容为空，无法提炼有效知识`);
  }

  // Detect Unicode replacement character U+FFFD (mojibake / decoding corruption)
  const replacementCount = (normalized.match(/\uFFFD/g) || []).length;
  if (replacementCount > 0) {
    throw new KnowledgeDocumentError(
      `${label}包含不可识别的乱码字符（检测到 ${replacementCount} 处编码损坏标志），已拒绝入库`
    );
  }

  // Detect control bytes (excluding \t \n \r)
  let controlCount = 0;
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31)) {
      controlCount++;
    }
  }
  const controlRatio = normalized.length > 0 ? controlCount / normalized.length : 0;
  if (controlCount > 12 || controlRatio > 0.01) {
    throw new KnowledgeDocumentError(
      `${label}包含大量二进制控制字符或已损坏（非合法纯文本），已拒绝入库`
    );
  }

  if (countMeaningfulChars(normalized) < 8) {
    throw new KnowledgeDocumentError(`${label}有效文字过少（少于 8 个有效字符），无法提炼知识条目`);
  }
}

function detectBomlessUtf16(buffer: Buffer): 'utf-16le' | 'utf-16be' | null {
  if (buffer.length < 4 || buffer.length % 2 !== 0) return null;
  const sampleLimit = Math.min(buffer.length, 512);
  let evenNulls = 0;
  let oddNulls = 0;
  const pairs = Math.floor(sampleLimit / 2);
  for (let i = 0; i < pairs * 2; i += 2) {
    if (buffer[i] === 0) evenNulls++;
    if (buffer[i + 1] === 0) oddNulls++;
  }
  // ASCII-heavy UTF-16LE has many 0x00 at odd offsets; UTF-16BE has many 0x00 at even offsets
  if (oddNulls >= pairs * 0.3 && evenNulls <= pairs * 0.05) {
    return 'utf-16le';
  }
  if (evenNulls >= pairs * 0.3 && oddNulls <= pairs * 0.05) {
    return 'utf-16be';
  }
  return null;
}

export function decodeTextBufferStrict(buffer: Buffer): { text: string; encoding: string } {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new KnowledgeDocumentError('上传文件内容为空，无法解析');
  }
  if (buffer.length > MAX_UPLOAD_RAW_BYTES) {
    throw new KnowledgeDocumentError('上传文件体积超过 20MB 上限，请拆分后再上传');
  }

  // 1. Check explicit BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(3));
      assertReadableDecodedText(decoded);
      return { text: decoded, encoding: 'utf-8-bom' };
    } catch (err: any) {
      if (err instanceof KnowledgeDocumentError) throw err;
      throw new KnowledgeDocumentError('UTF-8 BOM 文件字节序列损坏，已拒绝入库');
    }
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    try {
      const decoded = new TextDecoder('utf-16le', { fatal: true }).decode(buffer.subarray(2));
      assertReadableDecodedText(decoded);
      return { text: decoded, encoding: 'utf-16le-bom' };
    } catch (err: any) {
      if (err instanceof KnowledgeDocumentError) throw err;
      throw new KnowledgeDocumentError('UTF-16LE 文件字节序列损坏，已拒绝入库');
    }
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    try {
      const decoded = new TextDecoder('utf-16be', { fatal: true }).decode(buffer.subarray(2));
      assertReadableDecodedText(decoded);
      return { text: decoded, encoding: 'utf-16be-bom' };
    } catch (err: any) {
      if (err instanceof KnowledgeDocumentError) throw err;
      throw new KnowledgeDocumentError('UTF-16BE 文件字节序列损坏，已拒绝入库');
    }
  }

  // 2. Check BOM-less UTF-16 heuristic
  const bomlessUtf16 = detectBomlessUtf16(buffer);
  if (bomlessUtf16) {
    try {
      const decoded = new TextDecoder(bomlessUtf16, { fatal: true }).decode(buffer);
      assertReadableDecodedText(decoded);
      return { text: decoded, encoding: bomlessUtf16 };
    } catch {
      // Fall through to NUL-byte check
    }
  }

  // 3. Reject binary files containing NUL bytes
  if (buffer.includes(0x00)) {
    throw new KnowledgeDocumentError('检测到二进制空字节（文件可能已损坏或非纯文本文档），已拒绝入库');
  }

  // 4. Try strict UTF-8
  try {
    const utf8Text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    assertReadableDecodedText(utf8Text);
    return { text: utf8Text, encoding: 'utf-8' };
  } catch (err: any) {
    if (err instanceof KnowledgeDocumentError) {
      throw err;
    }
  }

  // 5. Fallback to strict GB18030 (covers GBK / GB2312 Chinese Windows text files)
  try {
    const gbText = new TextDecoder('gb18030', { fatal: true }).decode(buffer);
    assertReadableDecodedText(gbText);
    return { text: gbText, encoding: 'gb18030' };
  } catch (err: any) {
    if (err instanceof KnowledgeDocumentError) {
      throw err;
    }
  }

  throw new KnowledgeDocumentError(
    '无法识别文档字符编码或文件字节已损坏（仅支持 UTF-8 / UTF-16 / GB18030/GBK 编码），已拒绝入库'
  );
}

function detectCsvDelimiter(raw: string): string {
  const firstLine = (raw.split(/\r?\n/).find((l) => l.trim().length > 0) || '').trim();
  const counts = {
    ',': (firstLine.match(/,/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length,
  };
  if (counts['\t'] > counts[','] && counts['\t'] >= counts[';']) return '\t';
  if (counts[';'] > counts[','] && counts[';'] > counts['\t']) return ';';
  return ',';
}

export function parseCsvToReadableKnowledgeText(rawCsv: string): string {
  const cleaned = rawCsv.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const delimiter = detectCsvDelimiter(cleaned);
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        if (currentField.length > 0) {
          throw new KnowledgeDocumentError('CSV 格式损坏：引号位置不合法，已拒绝入库');
        }
        inQuotes = true;
      } else if (ch === delimiter) {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (ch === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some((cell) => cell.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += ch;
      }
    }
  }

  if (inQuotes) {
    throw new KnowledgeDocumentError('CSV 文件损坏：存在未闭合的引号，已拒绝入库');
  }
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) {
    throw new KnowledgeDocumentError('CSV 文件为空，未能提取到任何记录');
  }

  if (rows.length === 1) {
    return rows[0].filter(Boolean).join(' | ');
  }

  const headers = rows[0].map((h, idx) => h || `字段${idx + 1}`);
  const formattedRows: string[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const parts: string[] = [];
    for (let c = 0; c < Math.max(headers.length, row.length); c++) {
      const val = (row[c] || '').trim();
      if (!val) continue;
      const key = headers[c] || `字段${c + 1}`;
      parts.push(`${key}: ${val}`);
    }
    if (parts.length > 0) {
      formattedRows.push(`[记录 ${r}]\n${parts.join('\n')}`);
    }
  }

  if (formattedRows.length === 0) {
    throw new KnowledgeDocumentError('CSV 文件仅有表头、无有效数据行');
  }

  return formattedRows.join('\n\n');
}

function flattenJsonValue(value: any, prefix = '', depth = 0): string[] {
  if (depth > 16 || value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const s = String(value).trim();
    if (!s) return [];
    return [prefix ? `${prefix}: ${s}` : s];
  }
  if (Array.isArray(value)) {
    const lines: string[] = [];
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const sub = flattenJsonValue(item, '', depth + 1);
        if (sub.length > 0) {
          lines.push(`${prefix ? `${prefix} ` : ''}[条目 ${i + 1}]\n${sub.join('\n')}`);
        }
      } else {
        const sub = flattenJsonValue(item, prefix, depth + 1);
        lines.push(...sub);
      }
    }
    return lines;
  }
  if (typeof value === 'object') {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      const nextKey = prefix ? `${prefix}.${k}` : k;
      lines.push(...flattenJsonValue(v, nextKey, depth + 1));
    }
    return lines;
  }
  return [];
}

export function parseJsonToReadableKnowledgeText(rawJson: string): string {
  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err: any) {
    throw new KnowledgeDocumentError(`JSON 文件语法损坏，无法解析: ${err?.message || '格式错误'}`);
  }
  const lines = flattenJsonValue(parsed);
  const text = lines.join('\n\n').trim();
  if (!text || countMeaningfulChars(text) < 8) {
    throw new KnowledgeDocumentError('JSON 文件中不包含足够的有效文本内容');
  }
  return text;
}

export async function parsePdfBufferStrict(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new KnowledgeDocumentError('PDF 文件内容为空');
  }
  if (buffer.length > MAX_UPLOAD_RAW_BYTES) {
    throw new KnowledgeDocumentError('PDF 文件体积超过 20MB 上限，请拆分后再上传');
  }

  const headSlice = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  if (!headSlice.includes('%PDF-')) {
    throw new KnowledgeDocumentError('无效的 PDF 文件头（文件可能已损坏或并非真实 PDF 文档），已拒绝入库');
  }

  let pdf: any = null;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [String(text || '')];
    const joined = pages
      .map((p) => String(p || '').replace(/\r\n/g, '\n').trim())
      .filter(Boolean)
      .join('\n\n')
      .trim();

    if (!joined || countMeaningfulChars(joined) < 10) {
      throw new KnowledgeDocumentError(
        '未能从 PDF 中提取到有效文本内容（可能是纯扫描图片型 PDF 或空白文档），已拒绝入库'
      );
    }

    assertReadableDecodedText(joined, 'PDF 提取文本');
    return {
      text: joined,
      pageCount: Number(totalPages) || pages.length || 1,
    };
  } catch (err: any) {
    if (err instanceof KnowledgeDocumentError) {
      throw err;
    }
    const rawMsg = String(err?.message || err || '');
    const errName = String(err?.name || '');
    if (/PasswordException/i.test(errName) || /password|encrypted|security handler/i.test(rawMsg)) {
      throw new KnowledgeDocumentError(
        '该 PDF 文档已加密或受密码保护，无法直接提取文本，请解除密码保护后再上传'
      );
    }
    throw new KnowledgeDocumentError(
      `PDF 文件解析失败（文件可能已损坏或格式异常）: ${rawMsg || '未知解析错误'}`
    );
  } finally {
    try {
      if (pdf && typeof pdf.destroy === 'function') {
        await pdf.destroy();
      }
    } catch {}
  }
}

export async function parseKnowledgeDocument(params: {
  fileName?: string;
  fileBase64?: string;
  fileBuffer?: Buffer;
  fileContent?: string;
  mimeType?: string;
}): Promise<ParsedKnowledgeDocument> {
  const fileName = String(params.fileName || 'uploaded_doc.txt').trim() || 'uploaded_doc.txt';
  const ext = path.extname(fileName).toLowerCase();
  const mime = String(params.mimeType || '').toLowerCase();

  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new KnowledgeDocumentError(
      `不支持的文件格式 (${ext || '未知'})，目前仅支持 .txt / .md / .csv / .json / .pdf 文档`
    );
  }

  let rawBuffer: Buffer | null = null;
  if (Buffer.isBuffer(params.fileBuffer)) {
    rawBuffer = params.fileBuffer;
  } else if (typeof params.fileBase64 === 'string' && params.fileBase64.trim().length > 0) {
    const cleanedB64 = params.fileBase64
      .trim()
      .replace(/^data:[^;]+;base64,/i, '')
      .replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleanedB64) || cleanedB64.length % 4 !== 0) {
      throw new KnowledgeDocumentError('Base64 文件载荷格式损坏，无法解码');
    }
    rawBuffer = Buffer.from(cleanedB64, 'base64');
  }

  const isPdf = ext === '.pdf' || mime === 'application/pdf';
  if (isPdf) {
    if (!rawBuffer) {
      if (typeof params.fileContent === 'string' && params.fileContent.includes('%PDF-')) {
        throw new KnowledgeDocumentError(
          'PDF 文档必须以原始二进制/Base64 格式上传，严禁将 PDF 二进制源码作为纯文本提交'
        );
      }
      throw new KnowledgeDocumentError('PDF 上传缺少原始文件字节数据，请重新选择 PDF 文件上传');
    }
    const pdfRes = await parsePdfBufferStrict(rawBuffer);
    if (pdfRes.text.length > MAX_EXTRACTED_CHARS) {
      throw new KnowledgeDocumentError(
        `PDF 提取文本总长度达 ${pdfRes.text.length} 字符，超过单次安全提炼上限 (${MAX_EXTRACTED_CHARS} 字符)，请拆分章节后上传`
      );
    }
    return {
      fileName,
      extension: '.pdf',
      detectedEncoding: 'pdf-text-stream',
      extractedText: pdfRes.text,
      charCount: pdfRes.text.length,
      pageCount: pdfRes.pageCount,
    };
  }

  if (!SUPPORTED_TEXT_EXTENSIONS.has(ext)) {
    throw new KnowledgeDocumentError(
      `不支持的文档扩展名 (${ext})，仅支持 .txt / .md / .csv / .json / .pdf`
    );
  }

  let decodedText = '';
  let detectedEncoding = 'utf-8';
  if (rawBuffer) {
    const decoded = decodeTextBufferStrict(rawBuffer);
    decodedText = decoded.text;
    detectedEncoding = decoded.encoding;
  } else if (typeof params.fileContent === 'string') {
    if (params.fileContent.trimStart().startsWith('%PDF-')) {
      throw new KnowledgeDocumentError('检测到原始 PDF 二进制头，请以标准文件上传方式解析 PDF');
    }
    assertReadableDecodedText(params.fileContent, '文档');
    decodedText = params.fileContent;
    detectedEncoding = 'utf-8-string';
  } else {
    throw new KnowledgeDocumentError('文件内容不能为空');
  }

  const normalizedLineEndings = decodedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  let finalText = normalizedLineEndings;

  if (ext === '.json' || mime === 'application/json') {
    finalText = parseJsonToReadableKnowledgeText(normalizedLineEndings);
  } else if (ext === '.csv' || mime === 'text/csv') {
    finalText = parseCsvToReadableKnowledgeText(normalizedLineEndings);
  } else {
    assertReadableDecodedText(finalText, '文本文档');
  }

  if (finalText.length > MAX_EXTRACTED_CHARS) {
    throw new KnowledgeDocumentError(
      `文档提取文本长度为 ${finalText.length} 字符，超过单次安全提炼上限 (${MAX_EXTRACTED_CHARS} 字符)，请拆分后再上传`
    );
  }

  return {
    fileName,
    extension: ext || '.txt',
    detectedEncoding,
    extractedText: finalText,
    charCount: finalText.length,
  };
}

export function splitDocumentIntoSafeChunks(
  text: string,
  options?: { maxChunkChars?: number; maxChunks?: number }
): string[] {
  const clean = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!clean) return [];

  const maxChunkChars = Math.max(800, Math.min(12000, options?.maxChunkChars ?? 5500));
  const maxChunks = Math.max(1, Math.min(60, options?.maxChunks ?? 35));

  if (clean.length <= maxChunkChars) {
    return [clean];
  }

  // Split first by double newlines or Markdown headings, keeping delimiters meaningful
  const blocks = clean.split(/\n{2,}|(?=\n#{1,4}\s+)/g).map((b) => b.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const pushOversizedBlock = (block: string) => {
    const lines = block.split('\n');
    let lineAcc = '';
    for (const line of lines) {
      const candidate = lineAcc ? `${lineAcc}\n${line}` : line;
      if (candidate.length <= maxChunkChars) {
        lineAcc = candidate;
      } else {
        if (lineAcc.trim()) {
          chunks.push(lineAcc.trim());
          lineAcc = '';
        }
        if (line.length <= maxChunkChars) {
          lineAcc = line;
        } else {
          // Sentence-boundary split, falling back to fixed window only for giant unbroken lines
          const sentences = line.split(/(?<=[。！？.!?])\s*/g).filter(Boolean);
          let sentAcc = '';
          for (const sent of sentences) {
            if (sent.length > maxChunkChars) {
              if (sentAcc.trim()) {
                chunks.push(sentAcc.trim());
                sentAcc = '';
              }
              for (let offset = 0; offset < sent.length; offset += maxChunkChars) {
                chunks.push(sent.slice(offset, offset + maxChunkChars).trim());
              }
            } else if ((sentAcc ? `${sentAcc} ${sent}` : sent).length <= maxChunkChars) {
              sentAcc = sentAcc ? `${sentAcc} ${sent}` : sent;
            } else {
              if (sentAcc.trim()) chunks.push(sentAcc.trim());
              sentAcc = sent;
            }
          }
          if (sentAcc.trim()) {
            lineAcc = sentAcc.trim();
          }
        }
      }
    }
    if (lineAcc.trim()) {
      chunks.push(lineAcc.trim());
    }
  };

  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= maxChunkChars) {
      current = candidate;
    } else {
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }
      if (block.length <= maxChunkChars) {
        current = block;
      } else {
        pushOversizedBlock(block);
      }
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  if (chunks.length > maxChunks) {
    throw new KnowledgeDocumentError(
      `文档切片数量 (${chunks.length} 段) 超过单次安全提炼上限 (${maxChunks} 段)，请按章节拆分为多个文档上传`
    );
  }

  return chunks;
}

export function escapeSqlLikeTerm(term: string): string {
  return String(term || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

const RAG_STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'you', 'with', 'from', 'this', 'that', 'have', 'has', 'was', 'were',
  'will', 'would', 'could', 'should', 'can', 'not', 'but', 'what', 'when', 'where', 'which', 'who',
  'how', 'why', 'your', 'our', 'their', 'they', 'them', 'she', 'her', 'his', 'him', 'its', 'just',
  'about', 'into', 'than', 'then', 'very', 'more', 'also',
  'что', 'как', 'это', 'для', 'или', 'при', 'без', 'все', 'она', 'они', 'вас', 'вам',
  '今天', '一直', '去吗', '还去', '是在', '想喝', '这个', '那个', '什么', '可以',
  '没有', '怎么', '我们', '你们', '他们', '现在', '明天', '昨天', '知道', '觉得',
  '一下', '好的', '好的呀', '哈哈', '一个', '还是', '怎么会',
]);

export function extractMultilingualRagTokens(queryText: string, maxTerms = 16): string[] {
  const clean = String(queryText || '').trim().toLocaleLowerCase();
  if (!clean) return [];

  const primaryTokens = new Set<string>();
  const subgramTokens = new Set<string>();

  // 1. General Unicode word tokens first (Russian, Arabic, Turkish, Vietnamese, Spanish, English, snake_case IDs, numbers, etc.)
  const wordMatches = clean.match(/[\p{L}\p{N}_](?:[\p{L}\p{N}_'’-]{0,29}[\p{L}\p{N}_])?/gu) || [];
  for (const w of wordMatches) {
    if (w.length < 2) continue;
    // Defer pure Han/Hangul strings to CJK segmentation below
    if (/^[\p{Script=Han}\p{Script=Hangul}]+$/u.test(w)) continue;
    if (RAG_STOP_WORDS.has(w)) continue;
    primaryTokens.add(w);
  }

  // 2. Japanese Kana words (>= 2 chars)
  const kanaRuns = clean.match(/[\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu) || [];
  for (const k of kanaRuns) {
    primaryTokens.add(k);
  }

  // 3. Space-free scripts (Thai/Lao/Khmer/Myanmar): full run in primary, capped windows in subgrams
  const thaiLikeRuns =
    clean.match(/[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]{2,}/gu) || [];
  for (const seg of thaiLikeRuns) {
    primaryTokens.add(seg);
    if (seg.length >= 6) {
      let addedForSeg = 0;
      for (let len = 4; len >= 3 && addedForSeg < 6; len--) {
        for (let i = 0; i <= seg.length - len && addedForSeg < 6 && subgramTokens.size < 24; i++) {
          subgramTokens.add(seg.substring(i, i + len));
          addedForSeg++;
        }
      }
    }
  }

  // 4. CJK (Han + Hangul) runs: short full runs in primary, 2-3 char n-grams in subgrams
  const cjkRuns = clean.match(/[\p{Script=Han}\p{Script=Hangul}]{2,}/gu) || [];
  for (const seg of cjkRuns) {
    if (seg.length <= 6 && !RAG_STOP_WORDS.has(seg)) {
      primaryTokens.add(seg);
    }
    let addedForSeg = 0;
    for (let len = 2; len <= Math.min(3, seg.length) && addedForSeg < 8; len++) {
      for (let i = 0; i <= seg.length - len && addedForSeg < 8 && subgramTokens.size < 28; i++) {
        const gram = seg.substring(i, i + len);
        if (!RAG_STOP_WORDS.has(gram)) {
          subgramTokens.add(gram);
          addedForSeg++;
        }
      }
    }
  }

  const ordered = new Set<string>();
  for (const t of primaryTokens) {
    if (t.length >= 2 && !RAG_STOP_WORDS.has(t)) ordered.add(t);
  }
  for (const t of subgramTokens) {
    if (t.length >= 2 && !RAG_STOP_WORDS.has(t)) ordered.add(t);
  }

  return Array.from(ordered).slice(0, maxTerms);
}

export function canonicalizeCustomerChatId(chatId?: string | number | null): string {
  const raw = String(chatId ?? '').trim();
  if (!raw) return '';
  if (/^-?\d+$/.test(raw)) return `tg_${raw}`;
  if (/^tg_-?\d+$/.test(raw)) return raw;
  return raw;
}

const CUSTOMER_PLACEHOLDER_VALUES = new Set([
  '',
  '-',
  '未知',
  '未提及',
  '待分析',
  '待确认',
  '待沟通分析',
  '暂无对话数据',
  '暂无足够对话记录',
  '暂无记录（待真实沟通后提炼）',
  '待进一步沟通交流',
  '尚未沟通',
  '初次接触',
  '新联系人',
  '联系人',
  '客户',
  'VIP客户',
]);

function isPlaceholderProfileValue(val?: string | null): boolean {
  const s = String(val ?? '').trim();
  return !s || CUSTOMER_PLACEHOLDER_VALUES.has(s);
}

function mergeUniqueStringTags(existingList: any[], incomingList: any[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of [...(Array.isArray(existingList) ? existingList : []), ...(Array.isArray(incomingList) ? incomingList : [])]) {
    const val = String(raw ?? '').trim();
    if (!val) continue;
    const key = val.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(val);
  }
  return result;
}

function mergeKeyMemories(existingMemories: any[], incomingMemories: any[]): any[] {
  const byId = new Map<string, any>();
  const seenSignatures = new Set<string>();
  const result: any[] = [];

  const pushItem = (raw: any) => {
    if (!raw || typeof raw !== 'object') return;
    const topic = String(raw.topic || '').trim();
    const summary = String(raw.summary || '').trim();
    if (!topic && !summary) return;
    const id = String(raw.id || '').trim();
    const sig = `${topic.toLocaleLowerCase()}::${summary.toLocaleLowerCase()}`;

    if (id && byId.has(id)) return;
    if (seenSignatures.has(sig)) return;

    const normalized = {
      id: id || `mem_${sha256Hex(sig).slice(0, 12)}`,
      date: String(raw.date || '近期').trim(),
      topic: topic || '客户记忆',
      summary,
      emotion: String(raw.emotion || '日常交流').trim(),
    };
    if (normalized.id) byId.set(normalized.id, normalized);
    seenSignatures.add(sig);
    result.push(normalized);
  };

  // Put existing manual/saved memories first so user-curated entries are always preserved
  for (const m of Array.isArray(existingMemories) ? existingMemories : []) {
    pushItem(m);
  }
  for (const m of Array.isArray(incomingMemories) ? incomingMemories : []) {
    pushItem(m);
  }

  return result;
}

export function mergeCustomerProfileWithManualData(params: {
  existingProfile?: any;
  aiData?: Record<string, any> | null;
  fallbackName?: string;
  preserveOnSparse?: boolean;
}): {
  clientName: string;
  relationshipStage: string;
  ageEstimate: string;
  occupation: string;
  locationTimezone: string;
  toneStyle: string;
  likesInterests: string[];
  dislikesTaboos: string[];
  emotionalNeeds: string;
  keyMemories: any[];
} {
  const existing = params.existingProfile || null;
  const ai = params.aiData || {};
  const preserveOnSparse = Boolean(params.preserveOnSparse);

  const safeParseArr = (raw: any): any[] => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string' || !raw.trim()) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const pickScalar = (existingVal: any, aiVal: any, defaultVal: string): string => {
    const ext = String(existingVal ?? '').trim();
    const next = String(aiVal ?? '').trim();
    if (preserveOnSparse) {
      if (!isPlaceholderProfileValue(ext)) return ext;
      return next || ext || defaultVal;
    }
    // In full AI extraction: prefer AI if informative, otherwise keep existing informative value
    if (!isPlaceholderProfileValue(next)) return next;
    if (!isPlaceholderProfileValue(ext)) return ext;
    return next || ext || defaultVal;
  };

  const existingClientName = String(existing?.client_name ?? existing?.clientName ?? '').trim();
  const aiClientName = String(ai.clientName ?? '').trim();
  const resolvedClientName = preserveOnSparse
    ? !isPlaceholderProfileValue(existingClientName)
      ? existingClientName
      : aiClientName || params.fallbackName || '联系人'
    : !isPlaceholderProfileValue(existingClientName)
    ? existingClientName
    : !isPlaceholderProfileValue(aiClientName)
    ? aiClientName
    : params.fallbackName || existingClientName || aiClientName || '客户';

  return {
    clientName: resolvedClientName,
    relationshipStage: pickScalar(
      existing?.relationship_stage ?? existing?.relationshipStage,
      ai.relationshipStage,
      '初次接触'
    ),
    ageEstimate: pickScalar(existing?.age_estimate ?? existing?.ageEstimate, ai.ageEstimate, '未知'),
    occupation: pickScalar(existing?.occupation, ai.occupation, '未知'),
    locationTimezone: pickScalar(
      existing?.location_timezone ?? existing?.locationTimezone,
      ai.locationTimezone,
      '未提及'
    ),
    toneStyle: pickScalar(existing?.tone_style ?? existing?.toneStyle, ai.toneStyle, ''),
    likesInterests: mergeUniqueStringTags(
      safeParseArr(existing?.likes_interests ?? existing?.likesInterests),
      safeParseArr(ai.likesInterests)
    ),
    dislikesTaboos: mergeUniqueStringTags(
      safeParseArr(existing?.dislikes_taboos ?? existing?.dislikesTaboos),
      safeParseArr(ai.dislikesTaboos)
    ),
    emotionalNeeds: pickScalar(
      existing?.emotional_needs ?? existing?.emotionalNeeds,
      ai.emotionalNeeds,
      '待进一步沟通交流'
    ),
    keyMemories: mergeKeyMemories(
      safeParseArr(existing?.key_memories ?? existing?.keyMemories),
      safeParseArr(ai.keyMemories)
    ),
  };
}
