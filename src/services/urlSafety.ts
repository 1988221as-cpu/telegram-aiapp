/**
 * URL 安全协议白名单校验（P2 安全加固）
 * 仅允许：
 *  - 本地服务端相对 API 路径：/api/...（禁止 // 协议相对路径）
 *  - 标准 HTTP / HTTPS 链接：http://... / https://...
 *  - 浏览器内存对象链接：blob:...
 *  - 安全的音视频与光栅图片 Data URI：data:image/*（显式排除 svg+xml）、data:audio/*、data:video/*
 * 明确拒绝 javascript:、vbscript:、file:、data:text/html、data:image/svg+xml、控制字符绕过等危险 URI。
 */

const SAFE_DATA_URI_RE =
  /^data:(?:image\/(?!svg\+xml\b)[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)(?:;[a-z0-9=+.-]+)*,/i;

export function sanitizeSafeResourceUrl(rawUrl?: string | null): string {
  if (typeof rawUrl !== 'string') return '';
  // Strip ASCII control characters (tabs, newlines, NUL) before scheme checks to block bypasses like "java\tscript:"
  const cleaned = rawUrl.replace(/[\u0000-\u001F\u007F]+/g, '').trim();
  if (!cleaned || cleaned === '#') return '';

  // Block protocol-relative URLs (//evil.com) and backslash tricks (/\/evil.com)
  if (cleaned.startsWith('//') || cleaned.startsWith('/\\') || cleaned.startsWith('\\')) {
    return '';
  }

  // 1. Allow only internal /api/... endpoints
  if (cleaned === '/api' || cleaned.startsWith('/api/')) {
    try {
      const parsed = new URL(cleaned, 'http://localhost');
      if (parsed.origin === 'http://localhost' && parsed.pathname.startsWith('/api')) {
        return cleaned;
      }
    } catch {
      return '';
    }
    return '';
  }

  // 2. Allow safe raster image / audio / video data URIs (explicitly disallow SVG & HTML)
  if (/^data:/i.test(cleaned)) {
    return SAFE_DATA_URI_RE.test(cleaned) ? cleaned : '';
  }

  // 3. Allow browser blob: URIs backed by http(s) or opaque null origin
  if (/^blob:/i.test(cleaned)) {
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol !== 'blob:') return '';
      const inner = cleaned.slice(5);
      if (/^(?:https?:\/\/|null\/)/i.test(inner)) {
        return cleaned;
      }
      return '';
    } catch {
      return '';
    }
  }

  // 4. Allow strictly parsed http: / https: URLs
  if (/^https?:/i.test(cleaned)) {
    try {
      const parsed = new URL(cleaned);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname) {
        return cleaned;
      }
      return '';
    } catch {
      return '';
    }
  }

  // Reject javascript:, vbscript:, file:, ftp:, arbitrary relative paths, etc.
  return '';
}

export function isSafeResourceUrl(rawUrl?: string | null): boolean {
  return sanitizeSafeResourceUrl(rawUrl).length > 0;
}
