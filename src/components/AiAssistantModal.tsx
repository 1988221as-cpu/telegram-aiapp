import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot,
  Minus,
  Square,
  Copy as CopyIcon,
  Check,
  X,
  ImagePlus,
  SendHorizontal,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Trash2,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Maximize2,
  RotateCcw,
  PanelRight,
} from 'lucide-react';
import {
  AiQaLocalChatItem,
  AiQaMatchedKnowledge,
  AiQaTurnMessage,
  WorkflowPlaybookItem,
} from '../types';
import {
  askAiQaAssistantApi,
  fetchAiQaWorkflowPlaybookApi,
} from '../services/apiService';

interface AiAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  restoreSignal?: number;
  onMinimizedChange?: (minimized: boolean) => void;
  engineLicenseKey?: string;
  activeChatTitle?: string;
  operatorAvatarUrl?: string;
  operatorInitial?: string;
}

type LayoutMode = 'standalone' | 'floating' | 'fullscreen';

const MAX_IMAGES = 6;
const PLAYBOOK_CACHE_STORAGE_KEY = 'hs_ai_qa_workflow_playbook_cache';
const WINDOW_SIZE_STORAGE_KEY = 'hs_ai_qa_window_size_v1';

const DEFAULT_WIDTH = 450;
const DEFAULT_HEIGHT = 680;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 460;

interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadSavedSize(): { width: number; height: number } {
  try {
    const raw = localStorage.getItem(WINDOW_SIZE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const w = Number(parsed?.width);
      const h = Number(parsed?.height);
      if (Number.isFinite(w) && Number.isFinite(h)) {
        return {
          width: Math.max(MIN_WIDTH, w),
          height: Math.max(MIN_HEIGHT, h),
        };
      }
    }
  } catch {}
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
}

function clampRectToViewport(rect: WindowRect): WindowRect {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const maxW = Math.max(MIN_WIDTH, vw - 24);
  const maxH = Math.max(MIN_HEIGHT, vh - 24);
  const width = Math.min(maxW, Math.max(MIN_WIDTH, rect.width));
  const height = Math.min(maxH, Math.max(MIN_HEIGHT, rect.height));
  const x = Math.min(Math.max(8, rect.x), Math.max(8, vw - width - 8));
  const y = Math.min(Math.max(8, rect.y), Math.max(8, vh - height - 8));
  return { x, y, width, height };
}

async function fileOrBlobToDataUrl(blob: Blob): Promise<string> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });

  // If reasonably small (< 2.5MB), keep original Data URL (preserves crisp screenshot text)
  if (blob.size <= 2.5 * 1024 * 1024 && rawDataUrl.startsWith('data:image/')) {
    return rawDataUrl;
  }

  // Otherwise gently downscale while keeping screenshot text crisp
  return await new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 2048;
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.max(1, Math.round(w * ratio));
        h = Math.max(1, Math.round(h * ratio));
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawDataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/png');
      if (compressed.length > 3.5 * 1024 * 1024) {
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } else {
        resolve(compressed);
      }
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function dataUrlToPngBlob(src: string): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 1;
        canvas.height = img.naturalHeight || img.height || 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法创建画布上下文'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('导出 PNG 图片失败'));
          }
        }, 'image/png');
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('加载图片失败'));
    img.src = src;
  });
}

async function copyImageToClipboard(src: string): Promise<boolean> {
  if (!src || typeof navigator === 'undefined' || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    return false;
  }
  try {
    // Pass Promise<Blob> directly inside ClipboardItem to preserve user-activation gesture
    const pngPromise = dataUrlToPngBlob(src);
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': pngPromise,
      }),
    ]);
    return true;
  } catch {
    try {
      const pngBlob = await dataUrlToPngBlob(src);
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': pngBlob,
        }),
      ]);
      return true;
    } catch {
      return false;
    }
  }
}

/** Lightweight safe Markdown-like renderer for QA replies (no raw HTML injection) */
const FormattedAnswerBody: React.FC<{
  text: string;
  onCopyCode: (code: string, blockId: string) => void;
  copiedKey: string | null;
  msgId: string;
}> = ({ text, onCopyCode, copiedKey, msgId }) => {
  const segments = React.useMemo(() => {
    const parts: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = [];
    const regex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'code', lang: match[1] || '', content: match[2].replace(/\n$/, '') });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.slice(lastIndex) });
    }
    return parts;
  }, [text]);

  const renderInline = (line: string, lineKey: string) => {
    // Split inline `code` and **bold**
    const tokens = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return tokens.map((tok, idx) => {
      if (tok.startsWith('`') && tok.endsWith('`') && tok.length >= 2) {
        return (
          <code
            key={`${lineKey}-${idx}`}
            className="px-1.5 py-0.5 mx-0.5 rounded text-[12px] font-mono bg-black/[0.06] dark:bg-white/10 aurora:bg-white/10 linen:bg-[#eadfce] text-[#0f172a] dark:text-[#e2ebf5] aurora:text-[#ecf6f8] linen:text-[#3d2d20] break-all"
          >
            {tok.slice(1, -1)}
          </code>
        );
      }
      if (tok.startsWith('**') && tok.endsWith('**') && tok.length >= 4) {
        return (
          <strong key={`${lineKey}-${idx}`} className="font-semibold">
            {tok.slice(2, -2)}
          </strong>
        );
      }
      return <React.Fragment key={`${lineKey}-${idx}`}>{tok}</React.Fragment>;
    });
  };

  return (
    <div className="space-y-2 text-[13px] leading-relaxed select-text cursor-text break-words">
      {segments.map((seg, sIdx) => {
        if (seg.type === 'code') {
          const blockId = `${msgId}-code-${sIdx}`;
          const isCopied = copiedKey === blockId;
          return (
            <div
              key={blockId}
              className="rounded-xl overflow-hidden border border-[#cbd5e1]/80 dark:border-[#1e3148] aurora:border-[#1e3843] linen:border-[#d3c4ad] bg-[#f8fafc] dark:bg-[#060c14] aurora:bg-[#071117] linen:bg-[#efe6d7]"
            >
              <div className="px-2.5 py-1 flex items-center justify-between border-b border-[#e2e8f0] dark:border-[#18283c] aurora:border-[#182e38] linen:border-[#dccdb6] text-[10.5px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] select-none">
                <span className="font-mono uppercase">{seg.lang || 'code'}</span>
                <button
                  type="button"
                  onClick={() => onCopyCode(seg.content, blockId)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-white/10 linen:hover:bg-[#e3d5be] cursor-pointer transition-colors"
                >
                  {isCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <CopyIcon className="w-3 h-3" />}
                  <span>{isCopied ? '已复制' : '复制'}</span>
                </button>
              </div>
              <pre className="p-2.5 overflow-x-auto text-[12px] font-mono leading-snug text-[#0f172a] dark:text-[#e2ebf5] aurora:text-[#ecf6f8] linen:text-[#2b2118] select-text">
                <code>{seg.content}</code>
              </pre>
            </div>
          );
        }

        const lines = seg.content.split('\n');
        return (
          <div key={`txt-${sIdx}`} className="space-y-1">
            {lines.map((rawLine, lIdx) => {
              const trimmed = rawLine.trim();
              if (!trimmed) {
                return <div key={`sp-${lIdx}`} className="h-1" />;
              }
              const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
              if (headingMatch) {
                return (
                  <div key={`h-${lIdx}`} className="font-semibold text-[13.5px] pt-1">
                    {renderInline(headingMatch[2], `h-${sIdx}-${lIdx}`)}
                  </div>
                );
              }
              const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
              if (bulletMatch) {
                return (
                  <div key={`li-${lIdx}`} className="flex items-start gap-1.5 pl-1">
                    <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-current opacity-60 shrink-0" />
                    <div className="flex-1 min-w-0">{renderInline(bulletMatch[1], `li-${sIdx}-${lIdx}`)}</div>
                  </div>
                );
              }
              const orderedMatch = trimmed.match(/^(\d+[.)])\s+(.+)$/);
              if (orderedMatch) {
                return (
                  <div key={`ol-${lIdx}`} className="flex items-start gap-1.5 pl-0.5">
                    <span className="font-semibold opacity-80 shrink-0 tabular-nums">{orderedMatch[1]}</span>
                    <div className="flex-1 min-w-0">{renderInline(orderedMatch[2], `ol-${sIdx}-${lIdx}`)}</div>
                  </div>
                );
              }
              return (
                <div key={`p-${lIdx}`}>{renderInline(rawLine, `p-${sIdx}-${lIdx}`)}</div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

export const AiAssistantModal: React.FC<AiAssistantModalProps> = ({
  isOpen,
  onClose,
  restoreSignal = 0,
  onMinimizedChange,
  engineLicenseKey,
  activeChatTitle,
  operatorAvatarUrl,
  operatorInitial = '我',
}) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('standalone');
  const [preFullscreenMode, setPreFullscreenMode] = useState<'standalone' | 'floating'>('standalone');
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const pointerDownOnBackdropRef = useRef(false);

  const [rect, setRect] = useState<WindowRect>(() => {
    const saved = loadSavedSize();
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const initialH = Math.max(saved.height, Math.min(vh - 32, 760));
    return clampRectToViewport({
      x: vw - saved.width - 16,
      y: Math.max(16, Math.round((vh - initialH) / 2)),
      width: saved.width,
      height: initialH,
    });
  });

  const [messages, setMessages] = useState<AiQaLocalChatItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [activeContextText, setActiveContextText] = useState<string>('');
  const [activeContextLabel, setActiveContextLabel] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const [playbookItems, setPlaybookItems] = useState<WorkflowPlaybookItem[]>(() => {
    try {
      const raw = localStorage.getItem(PLAYBOOK_CACHE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const [isLoadingPlaybook, setIsLoadingPlaybook] = useState(false);
  const [playbookError, setPlaybookError] = useState<string | null>(null);
  const [selectedPlaybookDay, setSelectedPlaybookDay] = useState<WorkflowPlaybookItem | null>(null);

  const [expandedKbByMsg, setExpandedKbByMsg] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const panelRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const isFullscreen = layoutMode === 'fullscreen';
  const isFloating = layoutMode === 'floating';
  const isStandalone = layoutMode === 'standalone';

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 2400);
  }, []);

  const markCopied = useCallback((key: string, label = '已复制') => {
    setCopiedKey(key);
    showToast(label);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedKey(null), 1800);
  }, [showToast]);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [operatorAvatarUrl]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      dragCleanupRef.current?.();
      abortControllerRef.current?.abort();
    };
  }, []);

  // Re-clamp floating rect if viewport resizes
  useEffect(() => {
    const onResize = () => {
      setRect((prev) => clampRectToViewport(prev));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Reset minimized state when reopened cleanly
  useEffect(() => {
    if (isOpen) {
      setIsMinimized(false);
    }
  }, [isOpen]);

  // Restore & focus textarea when triggered from LeftSidebar while minimized
  useEffect(() => {
    if (isOpen && restoreSignal > 0) {
      setIsMinimized(false);
      const rafId = window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(rafId);
    }
  }, [isOpen, restoreSignal]);

  // Notify parent whenever minimized state changes
  useEffect(() => {
    onMinimizedChange?.(isOpen && isMinimized);
  }, [isOpen, isMinimized, onMinimizedChange]);

  useEffect(() => {
    if (!isOpen || isMinimized) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lightboxImage) {
        e.preventDefault();
        e.stopPropagation();
        setLightboxImage(null);
        return;
      }
      if (selectedPlaybookDay) {
        e.preventDefault();
        e.stopPropagation();
        setSelectedPlaybookDay(null);
        return;
      }
      if (isStandalone || isFullscreen) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, isMinimized, isStandalone, isFullscreen, lightboxImage, selectedPlaybookDay, onClose]);

  // Fetch 1-7 day workflow playbook whenever modal opens (zero AI token cost)
  const loadPlaybook = useCallback(async (forceRefresh = false) => {
    if (isLoadingPlaybook && !forceRefresh) return;
    setIsLoadingPlaybook(true);
    setPlaybookError(null);
    const res = await fetchAiQaWorkflowPlaybookApi(engineLicenseKey);
    setIsLoadingPlaybook(false);
    if (res.ok && res.items.length > 0) {
      setPlaybookItems(res.items);
      try {
        localStorage.setItem(PLAYBOOK_CACHE_STORAGE_KEY, JSON.stringify(res.items));
      } catch {}
    } else if (!res.ok) {
      setPlaybookError(res.error || '暂时无法同步 1-7 天流程指引');
    }
  }, [engineLicenseKey, isLoadingPlaybook]);

  useEffect(() => {
    if (isOpen) {
      void loadPlaybook(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Auto-scroll messages
  useEffect(() => {
    if (!isOpen || isMinimized) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending, isOpen, isMinimized]);

  // Auto-resize composer textarea height with content and panel width
  const syncTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!inputText) {
      el.style.height = 'auto';
      el.style.overflowY = 'hidden';
      return;
    }
    el.style.height = 'auto';
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const maxHeight = Math.min(280, Math.max(140, Math.round(vh * 0.38)));
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [inputText]);

  useEffect(() => {
    if (!isOpen || isMinimized) return;
    syncTextareaHeight();
    const rafId = requestAnimationFrame(syncTextareaHeight);
    return () => cancelAnimationFrame(rafId);
  }, [syncTextareaHeight, isOpen, isMinimized, layoutMode, rect.width]);

  // Handle adding image files / blobs (max 6)
  const addImageBlobs = useCallback(async (blobs: Blob[], source: 'paste' | 'other' = 'other') => {
    const imageBlobs = blobs.filter((b) => b.type.startsWith('image/'));
    if (imageBlobs.length === 0) return;

    const remainingSlots = MAX_IMAGES - pendingImages.length;
    if (remainingSlots <= 0) {
      showToast(`最多支持同时附带 ${MAX_IMAGES} 张图片`);
      return;
    }

    const targets = imageBlobs.slice(0, remainingSlots);
    const converted: string[] = [];
    for (const blob of targets) {
      try {
        const dataUrl = await fileOrBlobToDataUrl(blob);
        if (dataUrl) converted.push(dataUrl);
      } catch {}
    }
    if (converted.length > 0) {
      setPendingImages((prev) => [...prev, ...converted].slice(0, MAX_IMAGES));
      if (imageBlobs.length > remainingSlots) {
        showToast(`已达到 ${MAX_IMAGES} 张上限，部分图片未添加`);
      } else if (source === 'paste') {
        showToast(`已粘贴 ${converted.length} 张图片`);
      }
    }
  }, [pendingImages.length, showToast]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageBlobs: Blob[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageBlobs.push(file);
        }
      }
      if (imageBlobs.length > 0) {
        // Keep text paste intact if text also exists, only prevent image garbage paste
        if (!e.clipboardData.getData('text/plain')) {
          e.preventDefault();
        }
        void addImageBlobs(imageBlobs, 'paste');
      }
    },
    [addImageBlobs]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0) {
        void addImageBlobs(files);
      }
    },
    [addImageBlobs]
  );

  const handleCopyText = async (text: string, key: string) => {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      markCopied(key, '文字已复制到剪贴板');
    } else {
      showToast('复制失败，请手动选中文本复制');
    }
  };

  const handleCopyImage = async (src: string, key: string) => {
    const ok = await copyImageToClipboard(src);
    if (ok) {
      markCopied(key, '图片已复制到剪贴板，可直接 Ctrl+V 粘贴');
    } else {
      showToast('当前环境不支持直接复制图片，请右键图片另存或复制');
    }
  };

  // Drag titlebar: if standalone, dragging > 16px detaches into in-app floating window; if floating, moves freely
  const handleStartDragWindow = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isFullscreen) return;
    if ((e.target as HTMLElement).closest('button, input, textarea')) return;
    e.preventDefault();
    dragCleanupRef.current?.();
    const startX = e.clientX;
    const startY = e.clientY;
    const panelBox = panelRef.current?.getBoundingClientRect();
    let detachedFromStandalone = false;
    let startRect = { ...rectRef.current };

    if (isStandalone && panelBox) {
      startRect = clampRectToViewport({
        x: panelBox.left,
        y: Math.max(12, panelBox.top),
        width: Math.max(MIN_WIDTH, Math.min(560, Math.round(panelBox.width))),
        height: Math.min(rectRef.current.height, Math.max(MIN_HEIGHT, Math.round(panelBox.height - 24))),
      });
    }

    const onMove = (mv: MouseEvent) => {
      const dx = mv.clientX - startX;
      const dy = mv.clientY - startY;

      if (isStandalone && !detachedFromStandalone) {
        if (Math.hypot(dx, dy) < 16) return;
        detachedFromStandalone = true;
        setLayoutMode('floating');
        setPreFullscreenMode('floating');
      }

      setRect(
        clampRectToViewport({
          ...startRect,
          x: startRect.x + dx,
          y: startRect.y + dy,
        })
      );
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    };

    const onUp = () => {
      cleanup();
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Drag any edge/corner to resize floating window
  type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
  const handleStartResize = (dir: ResizeDir) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isFloating) return;
    e.preventDefault();
    e.stopPropagation();
    dragCleanupRef.current?.();
    const startX = e.clientX;
    const startY = e.clientY;
    const startRect = { ...rectRef.current };

    const onMove = (mv: MouseEvent) => {
      const dx = mv.clientX - startX;
      const dy = mv.clientY - startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const maxW = Math.max(MIN_WIDTH, vw - 16);
      const maxH = Math.max(MIN_HEIGHT, vh - 16);

      let nextX = startRect.x;
      let nextY = startRect.y;
      let nextW = startRect.width;
      let nextH = startRect.height;

      if (dir.includes('e')) {
        nextW = Math.min(maxW - nextX, Math.max(MIN_WIDTH, startRect.width + dx));
      }
      if (dir.includes('s')) {
        nextH = Math.min(maxH - nextY, Math.max(MIN_HEIGHT, startRect.height + dy));
      }
      if (dir.includes('w')) {
        const proposedW = Math.min(maxW, Math.max(MIN_WIDTH, startRect.width - dx));
        const actualDx = startRect.width - proposedW;
        const proposedX = Math.max(8, startRect.x + actualDx);
        nextW = startRect.x + startRect.width - proposedX;
        nextX = proposedX;
      }
      if (dir.includes('n')) {
        const proposedH = Math.min(maxH, Math.max(MIN_HEIGHT, startRect.height - dy));
        const actualDy = startRect.height - proposedH;
        const proposedY = Math.max(8, startRect.y + actualDy);
        nextH = startRect.y + startRect.height - proposedY;
        nextY = proposedY;
      }

      const clamped = clampRectToViewport({
        x: nextX,
        y: nextY,
        width: nextW,
        height: nextH,
      });
      setRect(clamped);
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    };

    const onUp = () => {
      cleanup();
      try {
        localStorage.setItem(
          WINDOW_SIZE_STORAGE_KEY,
          JSON.stringify({
            width: rectRef.current.width,
            height: rectRef.current.height,
          })
        );
      } catch {}
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleToggleFullscreen = () => {
    if (isFullscreen) {
      setLayoutMode(preFullscreenMode);
    } else {
      setPreFullscreenMode(isFloating ? 'floating' : 'standalone');
      setLayoutMode('fullscreen');
    }
  };

  const handleSendQuestion = async () => {
    if (isSending) return;
    const cleanText = inputText.trim();
    const imagesToSend = [...pendingImages];
    if (!cleanText && imagesToSend.length === 0) return;

    const userMsg: AiQaLocalChatItem = {
      id: `qa_u_${Date.now()}`,
      role: 'user',
      text: cleanText,
      images: imagesToSend,
      createdAt: Date.now(),
    };

    // Build multi-turn messages history from prior turns (before this question)
    // Only retain images from the single most recent historical image turn (and skip oversized blobs) to prevent multi-MB payload bloat on follow-up questions
    const recentHistorySlice = messages.filter((m) => !m.isError).slice(-8);
    let lastHistoryImageIdx = -1;
    for (let idx = recentHistorySlice.length - 1; idx >= 0; idx--) {
      const m = recentHistorySlice[idx];
      if (m.role === 'user' && m.images && m.images.length > 0) {
        lastHistoryImageIdx = idx;
        break;
      }
    }
    const historyTurns: AiQaTurnMessage[] = recentHistorySlice.map((m, idx) => {
      if (m.role === 'user' && m.images && m.images.length > 0) {
        if (idx === lastHistoryImageIdx) {
          const parts: Array<
            | { type: 'text'; text: string }
            | { type: 'image_url'; image_url: { url: string } }
          > = [];
          if (m.text) {
            parts.push({ type: 'text', text: m.text });
          }
          let attachedCount = 0;
          for (const imgUrl of m.images.slice(0, 2)) {
            if (typeof imgUrl === 'string' && imgUrl.length <= 900_000) {
              parts.push({ type: 'image_url', image_url: { url: imgUrl } });
              attachedCount++;
            }
          }
          if (attachedCount > 0) {
            return { role: 'user', content: parts };
          }
        }
        return {
          role: 'user',
          content: m.text ? `${m.text}\n（历史附图已省略）` : '（历史图片提问）',
        };
      }
      return {
        role: m.role,
        content: m.text || '（图片提问）',
      };
    });

    const mergedContext = [
      activeChatTitle ? `当前右侧主窗口选中会话：${activeChatTitle}` : '',
      activeContextText ? activeContextText : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setPendingImages([]);
    setIsSending(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await askAiQaAssistantApi(
        {
          question: cleanText || undefined,
          images: imagesToSend.length > 0 ? imagesToSend : undefined,
          context: mergedContext || undefined,
          messages: historyTurns.length > 0 ? historyTurns : undefined,
          top_k: 6,
          language: '',
          temperature: 0.4,
        },
        {
          engineLicenseKey,
          signal: controller.signal,
        }
      );

      if (!res.ok || !res.data) {
        const is503 =
          res.statusCode === 503 ||
          res.code === 'service_unavailable' ||
          res.error === 'service_unavailable';
        const is401 = res.statusCode === 401;

        const errText = is503
          ? '智能问答服务当前未配置可用密钥 (503 service_unavailable)。\n请前往后台控制台「秘钥管理与用量统计 -> 智能问答密钥 (QA)」配置可用密钥。\n（提示：下方 1-7 天流程快捷按键无需密钥，可随时点击查看。）'
          : is401
          ? '当前登录态或引擎授权已失效 (401)，请刷新授权或重新登录后重试。'
          : res.error || 'AI 助手请求失败，请稍后重试。';

        setMessages((prev) => [
          ...prev,
          {
            id: `qa_e_${Date.now()}`,
            role: 'assistant',
            text: errText,
            createdAt: Date.now(),
            isError: true,
            errorCode: is503 ? '503' : is401 ? '401' : String(res.statusCode || 'ERR'),
          },
        ]);
        return;
      }

      const payload = res.data;
      setMessages((prev) => [
        ...prev,
        {
          id: `qa_a_${Date.now()}`,
          role: 'assistant',
          text: payload.answer || '（未返回文本内容）',
          createdAt: Date.now(),
          model: payload.model,
          knowledgeUsed: Boolean(payload.knowledgeUsed),
          matchedCount: payload.matchedCount ?? payload.matchedKnowledge?.length ?? 0,
          matchedKnowledge: Array.isArray(payload.matchedKnowledge) ? payload.matchedKnowledge : [],
        },
      ]);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMessages((prev) => [
          ...prev,
          {
            id: `qa_e_${Date.now()}`,
            role: 'assistant',
            text: err?.message || '网络连接异常，请检查网络或代理设置后重试。',
            createdAt: Date.now(),
            isError: true,
          },
        ]);
      }
    } finally {
      setIsSending(false);
      abortControllerRef.current = null;
    }
  };

  const handleUsePlaybookDayForQuestion = (item: WorkflowPlaybookItem) => {
    const labelText = `第${item.day}天 · ${item.label}`;
    setActiveContextLabel(labelText);
    setActiveContextText(`【参考流程：${labelText} - ${item.title}】\n${item.content}`);
    setSelectedPlaybookDay(null);
    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 30);
    showToast(`已将「${labelText}」设为当前提问背景`);
  };

  if (!isOpen) return null;

  // Minimized floating capsule restore button
  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-1 rounded-full pl-2 pr-1.5 py-1.5 shadow-lg border bg-white/95 dark:bg-[#0b1523]/95 aurora:bg-[#0c1a21]/95 linen:bg-[#f6efe2]/95 border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#1f3b46] linen:border-[#cbbba2] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] backdrop-blur-md transition-all duration-150">
        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-2 pr-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 hover:opacity-85 transition-opacity"
          title="恢复 AI助手 窗口"
        >
          <span className="w-6 h-6 rounded-full bg-[#e8f3ff] dark:bg-[#132942] aurora:bg-[#112e37] linen:bg-[#a86a43]/15 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] flex items-center justify-center shrink-0">
            {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
          </span>
          <span>AI助手</span>
          {messages.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono tabular-nums bg-black/[0.06] dark:bg-white/10 aurora:bg-white/10 linen:bg-[#e5d8c2]">
              {messages.length}
            </span>
          )}
        </button>
        <div className="w-px h-3.5 bg-black/10 dark:bg-white/10 aurora:bg-white/10 linen:bg-[#cbbba2]" />
        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          title="还原窗口"
          className="p-1.5 rounded-full text-[#475569] dark:text-[#9cb2c9] aurora:text-[#9cbdc8] linen:text-[#5c4b3b] hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-white/10 linen:hover:bg-[#e5d8c2] transition-colors cursor-pointer shrink-0"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="关闭 AI助手"
          className="p-1.5 rounded-full text-[#475569] dark:text-[#9cb2c9] aurora:text-[#9cbdc8] linen:text-[#5c4b3b] hover:bg-rose-500/15 hover:text-rose-500 transition-colors cursor-pointer shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const displayDays: WorkflowPlaybookItem[] =
    playbookItems.length > 0
      ? playbookItems
      : [1, 2, 3, 4, 5, 6, 7].map((d) => ({
          day: d,
          label: '流程',
          title: `第${d}天流程指引`,
          content: playbookError
            ? `暂未加载到第${d}天云端流程（${playbookError}），请点击右侧刷新按钮重试。`
            : `正在加载第${d}天流程内容...`,
        }));

  const containerStyle: React.CSSProperties = isFullscreen
    ? { top: 10, left: 10, right: 10, bottom: 10, width: 'auto', height: 'auto' }
    : isFloating
    ? {
        top: rect.y,
        left: rect.x,
        width: rect.width,
        height: rect.height,
      }
    : {};

  const containerClassName = isStandalone
    ? `w-full max-w-4xl h-[88vh] max-h-[840px] rounded-2xl flex flex-col overflow-hidden border shadow-2xl linen:shadow-sm bg-[#f8fafc] dark:bg-[#09111b] aurora:bg-[#0b151c] linen:bg-[#f6efe2] border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#1d3944] linen:border-[#cbbba2] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] animate-in zoom-in-95 fade-in duration-150 ${
        isDragOver ? 'ring-2 ring-[#2481cc] dark:ring-[#2ba0ff] aurora:ring-[#2dd4bf] linen:ring-[#a86a43]' : ''
      }`
    : `fixed z-[55] flex flex-col rounded-2xl overflow-hidden border shadow-2xl linen:shadow-xl transition-[box-shadow] bg-[#f8fafc] dark:bg-[#09111b] aurora:bg-[#0b151c] linen:bg-[#f6efe2] border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#1d3944] linen:border-[#cbbba2] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] ${
        isDragOver ? 'ring-2 ring-[#2481cc] dark:ring-[#2ba0ff] aurora:ring-[#2dd4bf] linen:ring-[#a86a43]' : ''
      }`;

  const panelNode = (
      <aside
        ref={panelRef}
        role={isStandalone || isFullscreen ? 'dialog' : 'region'}
        aria-modal={isStandalone || isFullscreen ? true : undefined}
        aria-label="AI助手"
        style={containerStyle}
        onClick={(e) => e.stopPropagation()}
        onPaste={handlePaste}
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer?.types?.includes('Files')) {
            setIsDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
          }
        }}
        onDrop={handleDrop}
        className={containerClassName}
      >
        {/* 8-Direction Resize Handles in Floating Mode */}
        {isFloating && (
          <>
            <div onMouseDown={handleStartResize('w')} className="absolute left-0 top-2 bottom-2 w-1.5 cursor-ew-resize z-20" />
            <div onMouseDown={handleStartResize('e')} className="absolute right-0 top-2 bottom-2 w-1.5 cursor-ew-resize z-20" />
            <div onMouseDown={handleStartResize('n')} className="absolute top-0 left-2 right-2 h-1.5 cursor-ns-resize z-20" />
            <div onMouseDown={handleStartResize('s')} className="absolute bottom-0 left-2 right-2 h-1.5 cursor-ns-resize z-20" />
            <div onMouseDown={handleStartResize('nw')} className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize z-30" />
            <div onMouseDown={handleStartResize('ne')} className="absolute top-0 right-0 w-3 h-3 cursor-nesw-resize z-30" />
            <div onMouseDown={handleStartResize('sw')} className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize z-30" />
            <div onMouseDown={handleStartResize('se')} className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize z-30" />
          </>
        )}

        {/* Top Header Bar (Standalone / Drag to Float / Minimize / Fullscreen / Close) */}
        <header
          onMouseDown={handleStartDragWindow}
          title={isStandalone ? '独立工作台（按住拖拽可转为自由悬浮窗）' : isFloating ? '按住拖拽移动位置' : undefined}
          className={`px-4 py-3 flex items-center justify-between gap-2 border-b border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-white/90 dark:bg-[#0d1725]/95 aurora:bg-[#0e1b22]/95 linen:bg-[#f1e7d6]/95 shrink-0 select-none ${
            isFullscreen ? 'cursor-default' : 'cursor-move'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#e8f3ff] dark:bg-[#2ba0ff]/15 aurora:bg-[#112d36] linen:bg-[#a86a43]/15 border border-[#bfdbfe] dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/35 linen:border-[#cbbba2] flex items-center justify-center text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <h2 className="text-[15px] font-semibold tracking-tight truncate">AI助手</h2>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  abortControllerRef.current?.abort();
                  setMessages([]);
                  setExpandedKbByMsg({});
                }}
                title="清空当前对话"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-white/10 linen:hover:bg-[#e5d8c2] transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            {isFloating && (
              <button
                type="button"
                onClick={() => {
                  setLayoutMode('standalone');
                  setPreFullscreenMode('standalone');
                }}
                title="恢复居中独立工作台"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#475569] dark:text-[#9cb2c9] aurora:text-[#9cbdc8] linen:text-[#5c4b3b] hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-white/10 linen:hover:bg-[#e5d8c2] transition-colors cursor-pointer"
              >
                <PanelRight className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsMinimized(true)}
              title="缩小"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#475569] dark:text-[#9cb2c9] aurora:text-[#9cbdc8] linen:text-[#5c4b3b] hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-white/10 linen:hover:bg-[#e5d8c2] transition-colors cursor-pointer"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleToggleFullscreen}
              title={isFullscreen ? '还原窗口大小' : '全屏'}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#475569] dark:text-[#9cb2c9] aurora:text-[#9cbdc8] linen:text-[#5c4b3b] hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-white/10 linen:hover:bg-[#e5d8c2] transition-colors cursor-pointer"
            >
              {isFullscreen ? <RotateCcw className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              title="关闭"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#475569] dark:text-[#9cb2c9] aurora:text-[#9cbdc8] linen:text-[#5c4b3b] hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Main Chat Message Area */}
        <div className="relative flex-1 min-h-0 overflow-y-auto px-3.5 py-3 space-y-3.5 bg-[#f4f7fb] dark:bg-[#060c14] aurora:bg-[#081116] linen:bg-[#f2eadc]">
          {isDragOver && (
            <div className="sticky top-0 z-10 rounded-xl border-2 border-dashed border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] linen:border-[#a86a43] bg-white/90 dark:bg-[#0d1725]/90 aurora:bg-[#0f1f27]/90 linen:bg-[#faf5ec]/95 p-4 text-center text-xs font-medium">
              松开即可将截图添加到 AI助手（最多 {MAX_IMAGES} 张）
            </div>
          )}

          {messages.length === 0 && (
            <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center px-4 py-6">
              <div className="w-11 h-11 rounded-2xl bg-[#e8f3ff] dark:bg-[#132840] aurora:bg-[#112d36] linen:bg-[#e9decb] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] flex items-center justify-center mb-3 shadow-xs">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="text-sm font-semibold mb-1">智能业务与图文排障助手</div>
              <p className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] leading-relaxed max-w-[320px]">
                可输入业务/话术/产品/排障问题，或直接 <span className="font-semibold">Ctrl+V 粘贴截图</span>、拖拽或上传最多 6 张图片进行分析；下方可随时直查 1-7 天标准流程。
              </p>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex items-start justify-end gap-2">
                  <div className="max-w-[84%] flex flex-col items-end gap-1.5">
                    <div className="rounded-2xl rounded-tr-sm px-3 py-2.5 border bg-[#e8f3ff] dark:bg-[#163457] aurora:bg-[#11373e] linen:bg-[#e7dac5] border-[#bfdbfe] dark:border-[#255285] aurora:border-[#1c525c] linen:border-[#d2c1a8] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] shadow-xs">
                      {msg.images && msg.images.length > 0 && (
                        <div
                          className={`grid gap-1.5 ${
                            msg.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                          } ${msg.text ? 'mb-2' : ''}`}
                        >
                          {msg.images.map((imgSrc, idx) => {
                            const imgKey = `${msg.id}-img-${idx}`;
                            const isImgCopied = copiedKey === imgKey;
                            return (
                              <div
                                key={imgKey}
                                className="relative group rounded-lg overflow-hidden border border-black/10 dark:border-white/10 aurora:border-white/10 linen:border-[#cbbba2] bg-black/5"
                              >
                                <img
                                  src={imgSrc}
                                  alt={`提问截图 ${idx + 1}`}
                                  onClick={() => setLightboxImage(imgSrc)}
                                  className="max-h-40 w-full object-cover cursor-zoom-in"
                                />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleCopyImage(imgSrc, imgKey);
                                  }}
                                  title="一键复制图片"
                                  className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/65 hover:bg-black/80 text-white text-[10px] font-medium flex items-center gap-1 opacity-90 group-hover:opacity-100 transition-opacity cursor-pointer shadow-xs"
                                >
                                  {isImgCopied ? (
                                    <>
                                      <Check className="w-2.5 h-2.5 text-emerald-400" />
                                      <span>已复制</span>
                                    </>
                                  ) : (
                                    <>
                                      <CopyIcon className="w-2.5 h-2.5" />
                                      <span>复制图片</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {msg.text && (
                        <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words select-text cursor-text">
                          {msg.text}
                        </div>
                      )}
                    </div>
                    {msg.text && (
                      <button
                        type="button"
                        onClick={() => void handleCopyText(msg.text, `${msg.id}-txt`)}
                        className="inline-flex items-center gap-1 text-[10.5px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-white linen:hover:text-[#2b2118] cursor-pointer px-1"
                      >
                        {copiedKey === `${msg.id}-txt` ? (
                          <Check className="w-3 h-3 text-emerald-500" />
                        ) : (
                          <CopyIcon className="w-3 h-3" />
                        )}
                        <span>{copiedKey === `${msg.id}-txt` ? '已复制' : '复制'}</span>
                      </button>
                    )}
                  </div>

                  {/* Operator Avatar */}
                  <div className="w-7 h-7 rounded-full shrink-0 overflow-hidden bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#14b8a6] linen:bg-[#8c522d] text-white text-[11px] font-semibold flex items-center justify-center shadow-xs">
                    {operatorAvatarUrl && !avatarLoadFailed ? (
                      <img
                        src={operatorAvatarUrl}
                        alt="我"
                        onError={() => setAvatarLoadFailed(true)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span>{operatorInitial}</span>
                    )}
                  </div>
                </div>
              );
            }

            // Assistant Bubble + Knowledge Citation Accordion
            const kbList: AiQaMatchedKnowledge[] = msg.matchedKnowledge || [];
            const hasKb = Boolean(msg.knowledgeUsed && kbList.length > 0);
            const isKbExpanded = Boolean(expandedKbByMsg[msg.id]);

            return (
              <div key={msg.id} className="space-y-2">
                {/* Knowledge Source Strip (matching reference screenshot pill) */}
                {!msg.isError && (
                  hasKb ? (
                    <div className="rounded-xl border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#1d3944] linen:border-[#d3c4ad] bg-[#eef2f6] dark:bg-[#0e1928] aurora:bg-[#0e1d24] linen:bg-[#eadcc5] overflow-hidden">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedKbByMsg((prev) => ({
                            ...prev,
                            [msg.id]: !prev[msg.id],
                          }))
                        }
                        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-xs font-medium text-[#334155] dark:text-[#cbd5e1] aurora:text-[#cbe7ec] linen:text-[#4e3b2b] hover:bg-black/[0.03] dark:hover:bg-white/[0.04] aurora:hover:bg-white/[0.05] linen:hover:bg-[#e1d1b8] cursor-pointer"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <BookOpen className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#9c623c] shrink-0" />
                          <span className="truncate">
                            已参考知识库 ({msg.matchedCount || kbList.length} 条)
                          </span>
                        </span>
                        {isKbExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5 shrink-0 opacity-75" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-75" />
                        )}
                      </button>

                      {isKbExpanded && (
                        <div className="px-3 pb-2.5 pt-1 space-y-2 border-t border-[#e2e8f0] dark:border-[#192b40] aurora:border-[#19303a] linen:border-[#dacbb4] bg-white/60 dark:bg-[#0a1320]/70 aurora:bg-[#0b161c]/70 linen:bg-[#f5ede0]/80">
                          {kbList.map((kb, kbIdx) => (
                            <div
                              key={`${kb.id}-${kbIdx}`}
                              className="p-2 rounded-lg border border-[#e2e8f0] dark:border-[#1a2c42] aurora:border-[#1a333d] linen:border-[#ded0ba] bg-white dark:bg-[#0e1928] aurora:bg-[#101e26] linen:bg-[#faf5ec] text-xs select-text"
                            >
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] truncate">
                                  {kb.title || `知识条目 #${kbIdx + 1}`}
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {kb.category && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-black/5 dark:bg-white/10 aurora:bg-white/10 linen:bg-[#eadcc5] text-[#475569] dark:text-[#9cb2c9] aurora:text-[#8eb2bd] linen:text-[#5c4b3b]">
                                      {kb.category}
                                    </span>
                                  )}
                                  {typeof kb.finalScore === 'number' && (
                                    <span className="text-[10px] font-mono opacity-70">
                                      {kb.finalScore.toFixed(2)}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {kb.contentPreview && (
                                <p className="text-[11px] text-[#475569] dark:text-[#9cb2c9] aurora:text-[#8eb2bd] linen:text-[#5c4b3b] line-clamp-3 leading-relaxed">
                                  {kb.contentPreview}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="px-3 py-1.5 rounded-xl border border-dashed border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#1d3944] linen:border-[#d3c4ad] text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 shrink-0 opacity-75" />
                      <span>知识库暂无直接收录，以下为 AI 综合解答</span>
                    </div>
                  )
                )}

                <div className="flex items-start gap-2">
                  <div className="w-7 h-7 rounded-lg shrink-0 bg-[#e8f3ff] dark:bg-[#132942] aurora:bg-[#112d36] linen:bg-[#dfd0b8] border border-[#bfdbfe] dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/35 linen:border-[#cbbba2] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] flex items-center justify-center mt-0.5">
                    {msg.isError ? (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    ) : (
                      <Bot className="w-4 h-4" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div
                      className={`rounded-2xl rounded-tl-sm px-3.5 py-2.5 border shadow-xs ${
                        msg.isError
                          ? 'bg-rose-50 dark:bg-rose-950/50 aurora:bg-rose-950/50 linen:bg-[#f4dfda] border-rose-200 dark:border-rose-800/60 aurora:border-rose-800/60 linen:border-[#d4a59a] text-rose-800 dark:text-rose-200 aurora:text-rose-200 linen:text-[#7a2e22]'
                          : 'bg-white dark:bg-[#0e1928] aurora:bg-[#0f1d24] linen:bg-[#faf5ec] border-[#e2e8f0] dark:border-[#1a2c42] aurora:border-[#1a333d] linen:border-[#ded0ba]'
                      }`}
                    >
                      <FormattedAnswerBody
                        text={msg.text}
                        msgId={msg.id}
                        copiedKey={copiedKey}
                        onCopyCode={(code, blockId) => void handleCopyText(code, blockId)}
                      />

                      <div className="mt-2 pt-1.5 border-t border-black/[0.05] dark:border-white/[0.06] aurora:border-white/[0.06] linen:border-[#e6dac6] flex items-center justify-between gap-2 text-[10.5px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] select-none">
                        <span className="truncate font-mono">
                          {msg.model ? msg.model : msg.isError ? `状态 ${msg.errorCode || '异常'}` : 'AI 解答'}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopyText(msg.text, `${msg.id}-full`)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-white/10 linen:hover:bg-[#eadcc5] text-[#334155] dark:text-[#cbd5e1] aurora:text-[#cbe7ec] linen:text-[#4e3b2b] font-medium cursor-pointer transition-colors"
                        >
                          {copiedKey === `${msg.id}-full` ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-500" />
                              <span>已复制回复</span>
                            </>
                          ) : (
                            <>
                              <CopyIcon className="w-3 h-3" />
                              <span>复制回答</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {isSending && (
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 rounded-lg shrink-0 bg-[#e8f3ff] dark:bg-[#132942] aurora:bg-[#112d36] linen:bg-[#dfd0b8] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
              <div className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 border bg-white dark:bg-[#0e1928] aurora:bg-[#0f1d24] linen:bg-[#faf5ec] border-[#e2e8f0] dark:border-[#1a2c42] aurora:border-[#1a333d] linen:border-[#ded0ba] text-xs text-[#64748b] dark:text-[#8ea4ba] aurora:text-[#8eb2bd] linen:text-[#6e5c4a] flex items-center gap-2">
                <span>正在检索知识库并分析解答...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />

          {/* Playbook Day Detail Card Overlay (Zero AI Key Cost) */}
          {selectedPlaybookDay && (
            <div className="sticky bottom-1 z-20 rounded-2xl border shadow-xl p-3.5 bg-white/98 dark:bg-[#0d1827]/98 aurora:bg-[#0e1c23]/98 linen:bg-[#fcf7ee]/98 border-[#cbd5e1] dark:border-[#243b57] aurora:border-[#20424e] linen:border-[#cbbba2] backdrop-blur-md">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#e8f3ff] dark:bg-[#132942] aurora:bg-[#112d36] linen:bg-[#eadcc5] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] mb-1">
                    第{selectedPlaybookDay.day}天 · {selectedPlaybookDay.label}
                  </div>
                  <h3 className="text-[13.5px] font-semibold leading-snug select-text">
                    {selectedPlaybookDay.title}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPlaybookDay(null)}
                  title="关闭详情"
                  className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-white/10 linen:hover:bg-[#eadcc5] cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {selectedPlaybookDay.keywords && selectedPlaybookDay.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {selectedPlaybookDay.keywords.map((kw, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 rounded text-[10px] bg-black/[0.04] dark:bg-white/[0.07] aurora:bg-white/[0.07] linen:bg-[#efe4d1] text-[#475569] dark:text-[#9cb2c9] aurora:text-[#8eb2bd] linen:text-[#5c4b3b]"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              )}

              <div className="max-h-48 overflow-y-auto rounded-xl p-2.5 border border-[#e2e8f0] dark:border-[#18293d] aurora:border-[#18303a] linen:border-[#dfd2bc] bg-[#f8fafc] dark:bg-[#070e17] aurora:bg-[#081217] linen:bg-[#f4ece0] text-[12.5px] leading-relaxed whitespace-pre-wrap select-text cursor-text">
                {selectedPlaybookDay.content || '暂无内容'}
              </div>

              <div className="mt-2.5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void handleCopyText(
                      `${selectedPlaybookDay.title}\n\n${selectedPlaybookDay.content}`,
                      `pb-copy-${selectedPlaybookDay.day}`
                    )
                  }
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[#cbd5e1] dark:border-[#243b57] aurora:border-[#20424e] linen:border-[#cbbba2] hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-white/10 linen:hover:bg-[#eadcc5] flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  {copiedKey === `pb-copy-${selectedPlaybookDay.day}` ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <CopyIcon className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedKey === `pb-copy-${selectedPlaybookDay.day}` ? '已复制' : '复制内容'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleUsePlaybookDayForQuestion(selectedPlaybookDay)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#2481cc] hover:bg-[#1e6fb0] dark:bg-[#2ba0ff] dark:hover:bg-[#1d8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#935a36] text-white flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>基于这天向 AI 提问</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Input Composer Box (with Image Preview, Paste/Drag/Upload, Send) */}
        <div className="px-3 pt-2.5 pb-2 border-t border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-white/95 dark:bg-[#0b1523]/95 aurora:bg-[#0c1920]/95 linen:bg-[#f5ede0]/95 shrink-0">
          {/* Attached Context Pill (from Playbook day) */}
          {activeContextLabel && (
            <div className="mb-2 px-2.5 py-1 rounded-lg border border-[#bfdbfe] dark:border-[#255285] aurora:border-[#1c525c] linen:border-[#d2c1a8] bg-[#e8f3ff] dark:bg-[#12263e] aurora:bg-[#102d34] linen:bg-[#eadcc5] flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate font-medium">
                已关联背景：{activeContextLabel}
              </span>
              <button
                type="button"
                onClick={() => {
                  setActiveContextLabel('');
                  setActiveContextText('');
                }}
                title="移除背景"
                className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 aurora:hover:bg-white/10 linen:hover:bg-[#dccbb0] cursor-pointer shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Composer Card */}
          <div className="rounded-xl border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#1e3843] linen:border-[#cbbba2] bg-[#f8fafc] dark:bg-[#070e17] aurora:bg-[#081217] linen:bg-[#faf5ec] p-2.5">
            {/* Pending Images Preview Bar */}
            {pendingImages.length > 0 && (
              <div className="mb-2 pb-2 border-b border-[#e2e8f0] dark:border-[#172638] aurora:border-[#182e38] linen:border-[#e6dac6] flex items-start justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  {pendingImages.map((src, idx) => {
                    const prevKey = `pending-img-${idx}`;
                    return (
                      <div
                        key={prevKey}
                        className="relative group w-20 h-14 rounded-lg overflow-hidden border border-[#cbd5e1] dark:border-[#253c56] aurora:border-[#20424e] linen:border-[#cbbba2] bg-black/5 shrink-0"
                      >
                        <img
                          src={src}
                          alt={`待发送图片 ${idx + 1}`}
                          onClick={() => setLightboxImage(src)}
                          className="w-full h-full object-cover cursor-zoom-in"
                        />
                        <button
                          type="button"
                          onClick={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))}
                          title="移除图片"
                          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 hover:bg-rose-600 text-white flex items-center justify-center cursor-pointer"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCopyImage(src, prevKey);
                          }}
                          title="复制图片"
                          className="absolute bottom-0.5 left-0.5 px-1 py-0.5 rounded bg-black/65 hover:bg-black/85 text-white text-[9px] flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        >
                          {copiedKey === prevKey ? (
                            <Check className="w-2.5 h-2.5 text-emerald-400" />
                          ) : (
                            <CopyIcon className="w-2.5 h-2.5" />
                          )}
                          <span>复制</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setPendingImages([])}
                  title="清空已选图片"
                  className="p-1 rounded-md text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-white/10 linen:hover:bg-[#e5d8c2] cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <textarea
              ref={textareaRef}
              rows={2}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void handleSendQuestion();
                }
              }}
              placeholder="输入业务、话术、产品或排障问题，支持 Ctrl+V 粘贴截图..."
              className="block w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-[#94a3b8] dark:placeholder:text-[#5c748c] aurora:placeholder:text-[#5d7b87] linen:placeholder:text-[#9c8974] select-text"
            />

            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) {
                      void addImageBlobs(files);
                    }
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={pendingImages.length >= MAX_IMAGES}
                  title="上传图片或截图（最多6张，也支持 Ctrl+V 粘贴或拖拽）"
                  className="px-2.5 py-1.5 rounded-lg border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#1e3843] linen:border-[#cbbba2] bg-white dark:bg-[#0e1928] aurora:bg-[#0f1d24] linen:bg-[#f5ede0] hover:bg-black/[0.03] dark:hover:bg-white/[0.06] aurora:hover:bg-white/[0.06] linen:hover:bg-[#efe4d1] text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-45 transition-colors"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>上传图片{pendingImages.length > 0 ? ` (${pendingImages.length}/${MAX_IMAGES})` : ''}</span>
                </button>
              </div>

              <button
                type="button"
                disabled={isSending || (!inputText.trim() && pendingImages.length === 0)}
                onClick={() => void handleSendQuestion()}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#2481cc] hover:bg-[#1e6fb0] dark:bg-[#2ba0ff] dark:hover:bg-[#1d8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#935a36] text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed transition-colors shadow-xs"
              >
                {isSending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <SendHorizontal className="w-3.5 h-3.5" />
                )}
                <span>{isSending ? '思考中' : '发送'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Bottom 1-7 Day Workflow Playbook Shortcut Bar (Zero AI Token Cost, Strictly Below Chat Input) */}
        <div className="px-3 py-2 border-t border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-[#f1f5f9]/95 dark:bg-[#08101a]/95 aurora:bg-[#0a151b]/95 linen:bg-[#efe5d5]/95 shrink-0">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[10.5px] font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
              1-7天标准流程直查（点击直接查看，不消耗模型密钥）
            </span>
            <button
              type="button"
              onClick={() => void loadPlaybook(true)}
              disabled={isLoadingPlaybook}
              title="刷新 1-7 天流程数据"
              className="p-0.5 rounded text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] cursor-pointer disabled:opacity-40"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingPlaybook ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {displayDays.slice(0, 7).map((item) => {
              const isSelected = selectedPlaybookDay?.day === item.day;
              return (
                <button
                  key={item.day}
                  type="button"
                  onClick={() =>
                    setSelectedPlaybookDay((prev) => (prev?.day === item.day ? null : item))
                  }
                  title={item.title}
                  className={`px-1.5 py-1.5 rounded-lg text-[11px] font-medium truncate border transition-all cursor-pointer text-center ${
                    isSelected
                      ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] linen:bg-[#a86a43] text-white border-transparent shadow-xs'
                      : 'bg-white dark:bg-[#0e1928] aurora:bg-[#0f1d24] linen:bg-[#faf5ec] border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#1e3843] linen:border-[#d3c4ad] text-[#334155] dark:text-[#cbd5e1] aurora:text-[#cbe7ec] linen:text-[#4e3b2b] hover:border-[#2481cc]/60 dark:hover:border-[#2ba0ff]/60 aurora:hover:border-[#2dd4bf]/60 linen:hover:border-[#a86a43]'
                  }`}
                >
                  第{item.day}天 · {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Non-blocking Toast */}
        {toastMsg && (
          <div className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-full bg-black/80 text-white text-[11px] font-medium shadow-lg whitespace-nowrap">
            {toastMsg}
          </div>
        )}
      </aside>
  );

  return (
    <>
      {isStandalone ? (
        <div
          onMouseDown={(e) => {
            pointerDownOnBackdropRef.current = e.target === e.currentTarget;
          }}
          onMouseUp={(e) => {
            if (e.target !== e.currentTarget) pointerDownOnBackdropRef.current = false;
          }}
          onClick={(e) => {
            const shouldClose = pointerDownOnBackdropRef.current && e.target === e.currentTarget;
            pointerDownOnBackdropRef.current = false;
            if (shouldClose) onClose();
          }}
          className="fixed inset-0 z-[55] flex items-center justify-center p-3 sm:p-6 bg-black/55 backdrop-blur-sm animate-in fade-in duration-150"
        >
          {panelNode}
        </div>
      ) : (
        <>
          {isFullscreen && (
            <div
              onClick={onClose}
              className="fixed inset-0 z-[54] bg-black/55 backdrop-blur-sm animate-in fade-in duration-150"
              aria-hidden="true"
            />
          )}
          {panelNode}
        </>
      )}

      {/* Lightbox Image Viewer with One-Click Copy Image */}
      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-xs flex flex-col items-center justify-center p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-[90vw] max-h-[85vh] flex flex-col items-center gap-3"
          >
            <img
              src={lightboxImage}
              alt="截图大图"
              className="max-w-full max-h-[75vh] rounded-xl shadow-2xl border border-white/15 object-contain bg-black/20"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyImage(lightboxImage, 'lightbox-img')}
                className="px-3.5 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1e6fb0] dark:bg-[#2ba0ff] dark:hover:bg-[#1d8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#935a36] text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                {copiedKey === 'lightbox-img' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-300" />
                ) : (
                  <CopyIcon className="w-3.5 h-3.5" />
                )}
                <span>{copiedKey === 'lightbox-img' ? '已复制图片' : '一键复制图片'}</span>
              </button>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="px-3.5 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>关闭预览</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
