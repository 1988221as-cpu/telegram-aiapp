import React, { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Smile, Sparkles, Search, X, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { TelegramStickerItem, TelegramStickerPack } from '../types';
import { fetchTelegramStickersApi, searchTelegramStickersApi } from '../services/apiService';

interface TelegramEmojiPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
  onSelectSticker?: (sticker: TelegramStickerItem, packTitle?: string) => void;
  accountId?: string;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

interface EmojiItem {
  char: string;
  name: string;
  keywords: string[];
  category: 'smileys' | 'gestures' | 'hearts' | 'objects';
}

const EMOJI_DATABASE: EmojiItem[] = [
  // Smileys & Emotions
  { char: '😀', name: '大笑', keywords: ['笑', '开心', '高兴', 'grin', 'smile', 'happy'], category: 'smileys' },
  { char: '😃', name: '哈哈', keywords: ['笑', '哈哈', 'happy', 'joy', 'smile'], category: 'smileys' },
  { char: '😄', name: '微笑', keywords: ['微笑', '开心', 'smile', 'pleased'], category: 'smileys' },
  { char: '😁', name: '嘻嘻', keywords: ['嘻嘻', '呲牙', 'grin', 'teeth'], category: 'smileys' },
  { char: '😆', name: '大喜', keywords: ['大笑', '狂喜', 'laugh'], category: 'smileys' },
  { char: '😅', name: '苦笑', keywords: ['苦笑', '流汗', 'sweat', 'awkward'], category: 'smileys' },
  { char: '😂', name: '笑哭', keywords: ['笑哭', '爆笑', 'joy', 'tears', 'lol', 'rofl'], category: 'smileys' },
  { char: '🤣', name: '笑倒', keywords: ['笑翻', '笑死', 'rofl', 'rolling'], category: 'smileys' },
  { char: '😊', name: '羞涩微笑', keywords: ['害羞', '暖心', 'blush', 'warm'], category: 'smileys' },
  { char: '😇', name: '天使光环', keywords: ['天使', '善良', 'angel', 'halo', 'innocent'], category: 'smileys' },
  { char: '🙂', name: '淡定笑', keywords: ['淡淡的笑', '微笑', 'slightly smile'], category: 'smileys' },
  { char: '😉', name: '眨眼', keywords: ['眨眼', '懂的', 'wink'], category: 'smileys' },
  { char: '😌', name: '安心', keywords: ['松了口气', '释怀', 'relieved'], category: 'smileys' },
  { char: '😍', name: '花痴心动', keywords: ['喜欢', '爱', '心动', 'heart eyes', 'love'], category: 'smileys' },
  { char: '🥰', name: '被爱包围', keywords: ['幸福', '爱心', 'adore', 'fond'], category: 'smileys' },
  { char: '😘', name: '飞吻', keywords: ['亲亲', '飞吻', 'kiss', 'love'], category: 'smileys' },
  { char: '😋', name: '馋嘴美味', keywords: ['好吃', '贪吃', 'yum', 'delicious'], category: 'smileys' },
  { char: '😛', name: '吐舌头', keywords: ['调皮', '吐舌', 'tongue', 'playful'], category: 'smileys' },
  { char: '😜', name: '眨眼吐舌', keywords: ['搞怪', '恶作剧', 'wink tongue', 'crazy'], category: 'smileys' },
  { char: '🤪', name: '发疯滑稽', keywords: ['疯癫', '滑稽', 'zany', 'wild'], category: 'smileys' },
  { char: '🤩', name: '眼里放光', keywords: ['追星', '崇拜', 'star struck', 'excited'], category: 'smileys' },
  { char: '🥳', name: '庆祝派对', keywords: ['庆祝', '生日', 'happy', 'party', 'celebrate'], category: 'smileys' },
  { char: '😎', name: '酷炫墨镜', keywords: ['酷', '帅', '装逼', 'cool', 'sunglasses'], category: 'smileys' },
  { char: '🤓', name: '书呆子眼镜', keywords: ['学霸', '极客', 'nerd', 'geek'], category: 'smileys' },
  { char: '🧐', name: '单片镜审视', keywords: ['探究', '怀疑', 'curious', 'monocle'], category: 'smileys' },
  { char: '😏', name: '得意坏笑', keywords: ['坏笑', '得意', 'smirk'], category: 'smileys' },
  { char: '😒', name: '无语斜眼', keywords: ['鄙视', '无语', 'unamused'], category: 'smileys' },
  { char: '😞', name: '失望低头', keywords: ['难过', '失望', 'sad', 'disappointed'], category: 'smileys' },
  { char: '😔', name: '沉思失落', keywords: ['沮丧', '忧郁', 'pensive'], category: 'smileys' },
  { char: '🥺', name: '委屈汪汪', keywords: ['恳求', '可怜', '拜托', 'pleading', 'puppy eyes'], category: 'smileys' },
  { char: '😢', name: '流泪伤心', keywords: ['哭', '眼泪', 'cry', 'tear'], category: 'smileys' },
  { char: '😭', name: '嚎啕大哭', keywords: ['大哭', '痛哭', 'sob', 'crying'], category: 'smileys' },
  { char: '😤', name: '傲慢傲娇', keywords: ['哼', '傲娇', 'triumph', 'huff'], category: 'smileys' },
  { char: '😠', name: '生气愤怒', keywords: ['生气', '发火', 'angry', 'mad'], category: 'smileys' },
  { char: '😡', name: '暴怒涨红', keywords: ['大怒', '气死', 'pouting', 'rage'], category: 'smileys' },
  { char: '🤯', name: '脑洞爆炸', keywords: ['炸裂', '吃惊', 'mind blown', 'shock'], category: 'smileys' },
  { char: '😳', name: '脸红尴尬', keywords: ['不好意思', '吃惊', 'flushed'], category: 'smileys' },
  { char: '🥵', name: '大汗热脸', keywords: ['好热', '发烫', 'hot', 'sweat'], category: 'smileys' },
  { char: '🥶', name: '冷冻结冰', keywords: ['冷', '冻僵', 'cold', 'freezing'], category: 'smileys' },
  { char: '😱', name: '尖叫恐惧', keywords: ['吓死', '救命', 'scream', 'fear'], category: 'smileys' },
  { char: '🤔', name: '思考琢磨', keywords: ['思考', '想一下', 'thinking', 'hmm'], category: 'smileys' },
  { char: '🤫', name: '安静嘘声', keywords: ['小声', '保密', 'shh', 'quiet'], category: 'smileys' },
  { char: '🤭', name: '偷笑掩嘴', keywords: ['捂嘴笑', '暗笑', 'giggle'], category: 'smileys' },
  { char: '😴', name: '呼呼大睡', keywords: ['睡觉', '晚安', 'sleep', 'zzz'], category: 'smileys' },

  // Gestures
  { char: '👍', name: '强力点赞', keywords: ['赞', '好', '顶', 'thumbs up', 'like', 'good', 'ok'], category: 'gestures' },
  { char: '👎', name: '踩点倒彩', keywords: ['差评', '不行', 'thumbs down', 'dislike', 'bad'], category: 'gestures' },
  { char: '👏', name: '鼓掌喝彩', keywords: ['鼓掌', '加油', 'clap', 'applause', 'bravo'], category: 'gestures' },
  { char: '🙌', name: '举双手赞同', keywords: ['欢呼', '庆祝', 'hands up', 'hooray'], category: 'gestures' },
  { char: '👐', name: '摊开双手', keywords: ['拥抱', '坦荡', 'open hands'], category: 'gestures' },
  { char: '🤝', name: '商务握手', keywords: ['握手', '合作', '成交', 'handshake', 'deal', 'partner'], category: 'gestures' },
  { char: '🙏', name: '双手合十祈祷', keywords: ['谢谢', '感谢', '拜托', 'pray', 'thanks', 'please'], category: 'gestures' },
  { char: '✌️', name: '胜利剪刀手', keywords: ['耶', '胜利', 'peace', 'victory'], category: 'gestures' },
  { char: '🤞', name: '祈求好运', keywords: ['保佑', '祝好运', 'crossed fingers', 'luck'], category: 'gestures' },
  { char: '🤟', name: '我爱你手势', keywords: ['爱你', 'rock', 'love you'], category: 'gestures' },
  { char: '🤘', name: '摇滚手势', keywords: ['摇滚', '牛', 'rock on'], category: 'gestures' },
  { char: '👌', name: 'OK好手势', keywords: ['好', '行', '没问题', 'ok hand', 'fine'], category: 'gestures' },
  { char: '🤌', name: '捏指强调', keywords: ['精髓', '意大利手势', 'pinched fingers'], category: 'gestures' },
  { char: '👈', name: '指左', keywords: ['左', 'point left'], category: 'gestures' },
  { char: '👉', name: '指右', keywords: ['右', '看这里', 'point right'], category: 'gestures' },
  { char: '👆', name: '指上', keywords: ['楼上', '看上面', 'point up'], category: 'gestures' },
  { char: '👇', name: '指下', keywords: ['楼下', '看下方', 'point down'], category: 'gestures' },
  { char: '💪', name: '肌肉力量', keywords: ['强', '加油', '力量', 'muscle', 'strong', 'flex'], category: 'gestures' },
  { char: '👋', name: '挥手问候', keywords: ['嗨', '你好', '欢迎', '再见', 'wave', 'hello', 'welcome', 'bye'], category: 'gestures' },
  { char: '🤗', name: '拥抱欢迎', keywords: ['欢迎', '抱抱', '拥抱', '热情', 'welcome', 'hug'], category: 'gestures' },
  { char: '🫡', name: '敬礼遵命', keywords: ['收到', '明白', '遵命', 'salute', 'yes sir'], category: 'gestures' },

  // Hearts & Emotion
  { char: '❤️', name: '经典红心', keywords: ['爱', '红心', '喜欢', 'red heart', 'love'], category: 'hearts' },
  { char: '🧡', name: '橙心温暖', keywords: ['温暖', '橙心', 'orange heart'], category: 'hearts' },
  { char: '💛', name: '黄心阳光', keywords: ['友谊', '黄心', 'yellow heart'], category: 'hearts' },
  { char: '💚', name: '绿心生机', keywords: ['健康', '绿心', 'green heart'], category: 'hearts' },
  { char: '💙', name: '蓝心电报', keywords: ['电报蓝', '忠诚', 'blue heart', 'telegram'], category: 'hearts' },
  { char: '💜', name: '紫心浪漫', keywords: ['浪漫', '紫心', 'purple heart'], category: 'hearts' },
  { char: '🖤', name: '黑心高冷', keywords: ['高冷', '黑心', 'black heart'], category: 'hearts' },
  { char: '🤍', name: '纯白之心', keywords: ['纯洁', '白心', 'white heart'], category: 'hearts' },
  { char: '💔', name: '破碎的心', keywords: ['心碎', '难受', 'broken heart', 'hurt'], category: 'hearts' },
  { char: '💖', name: '闪耀爱心', keywords: ['闪亮', '心动', 'sparkling heart'], category: 'hearts' },
  { char: '💗', name: '怦然心动', keywords: ['心跳', '喜欢', 'growing heart'], category: 'hearts' },
  { char: '💘', name: '丘比特箭', keywords: ['一见钟情', '丘比特', 'heart with arrow'], category: 'hearts' },
  { char: '💝', name: '丝带礼物心', keywords: ['礼物心', '心意', 'heart ribbon'], category: 'hearts' },
  { char: '🔥', name: '炽热火焰', keywords: ['火', '热', '爆', '牛逼', 'fire', 'lit', 'flame', 'hot'], category: 'hearts' },
  { char: '✨', name: '闪烁光芒', keywords: ['闪亮', 'AI', '灵感', 'sparkles', 'magic', 'shine'], category: 'hearts' },
  { char: '🌟', name: '发光金星', keywords: ['星星', '优质', 'glowing star', 'vip'], category: 'hearts' },
  { char: '💫', name: '流星眩晕', keywords: ['眼花', '流星', 'dizzy star'], category: 'hearts' },
  { char: '💥', name: '爆炸撞击', keywords: ['爆炸', '震撼', 'collision', 'boom'], category: 'hearts' },
  { char: '💯', name: '一百分满分', keywords: ['满分', '极好', '100', 'hundred', 'perfect'], category: 'hearts' },

  // Objects & Daily
  { char: '🎉', name: '庆祝礼花', keywords: ['庆祝', '礼炮', '恭喜', 'party', 'popper', 'congrats'], category: 'objects' },
  { char: '🎊', name: '碎纸彩花', keywords: ['狂欢', '开业', 'confetti'], category: 'objects' },
  { char: '🎁', name: '包装礼盒', keywords: ['礼物', '惊喜', 'gift', 'present'], category: 'objects' },
  { char: '🎈', name: '红色气球', keywords: ['气球', '派对', 'balloon'], category: 'objects' },
  { char: '🚀', name: '火箭飞升', keywords: ['起飞', '火箭', '暴涨', 'rocket', 'moon', 'fast'], category: 'objects' },
  { char: '🛸', name: '飞碟未来', keywords: ['科幻', '飞碟', 'ufo', 'alien'], category: 'objects' },
  { char: '💎', name: '璀璨钻石', keywords: ['钻石', '尊贵', '宝石', 'diamond', 'gem', 'luxury'], category: 'objects' },
  { char: '💡', name: '发光灯泡', keywords: ['想法', '主意', '灵感', 'bulb', 'idea'], category: 'objects' },
  { char: '💰', name: '钱袋财富', keywords: ['发财', '金钱', 'money', 'bag', 'rich'], category: 'objects' },
  { char: '💵', name: '美元钞票', keywords: ['美金', '美元', 'dollar', 'cash'], category: 'objects' },
  { char: '🎯', name: '正中靶心', keywords: ['目标', '命中', 'bullseye', 'target', 'goal'], category: 'objects' },
  { char: '🏆', name: '冠军奖杯', keywords: ['第一', '奖杯', 'trophy', 'winner', 'champion'], category: 'objects' },
  { char: '⚡', name: '闪电极速', keywords: ['快', '闪电', '能量', 'zap', 'lightning', 'fast'], category: 'objects' },
  { char: '☕', name: '热热咖啡', keywords: ['下午茶', '咖啡', '歇歇', 'coffee', 'break', 'tea'], category: 'objects' },
  { char: '🥂', name: '碰杯香槟', keywords: ['干杯', '庆祝', 'cheers', 'champagne', 'drink'], category: 'objects' },
  { char: '📢', name: '大声公喇叭', keywords: ['公告', '通知', 'megaphone', 'announcement'], category: 'objects' },
  { char: '📱', name: '智能手机', keywords: ['手机', '联系', 'phone', 'mobile'], category: 'objects' },
  { char: '💻', name: '笔记本电脑', keywords: ['工作', '电脑', 'laptop', 'work'], category: 'objects' },
];

export const TelegramEmojiPicker: React.FC<TelegramEmojiPickerProps> = ({
  isOpen,
  onClose,
  onSelectEmoji,
  onSelectSticker,
  accountId,
  anchorRef,
}) => {
  const [tab, setTab] = useState<'emoji' | 'stickers'>('emoji');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmojiCategory, setSelectedEmojiCategory] = useState<'all' | 'smileys' | 'gestures' | 'hearts' | 'objects'>('all');
  const [stickerPacks, setStickerPacks] = useState<TelegramStickerPack[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string>('all');
  const [isLoadingStickers, setIsLoadingStickers] = useState(false);
  const [stickersError, setStickersError] = useState<string | null>(null);
  const [remoteSearchPacks, setRemoteSearchPacks] = useState<TelegramStickerPack[]>([]);
  const [isSearchingRemote, setIsSearchingRemote] = useState(false);
  const [remoteSearchError, setRemoteSearchError] = useState<string | null>(null);
  const [failedThumbKeys, setFailedThumbKeys] = useState<Set<string>>(new Set());
  const remoteSearchSeqRef = useRef(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopupPos(null);
      return;
    }
    const updatePosition = () => {
      if (typeof window === 'undefined' || !anchorRef?.current) {
        setPopupPos(null);
        return;
      }
      const rect = anchorRef.current.getBoundingClientRect();
      const margin = 12;
      const gap = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const desiredWidth = vw < 640 ? 340 : 380;
      const width = Math.min(desiredWidth, vw - margin * 2);
      const left = Math.max(margin, Math.min(rect.left, vw - width - margin));
      const desiredHeight = 460;
      const spaceAbove = rect.top - gap - margin;
      const spaceBelow = vh - rect.bottom - gap - margin;
      const openAbove = spaceAbove >= 220 || spaceAbove >= spaceBelow;
      const avail = Math.max(180, openAbove ? spaceAbove : spaceBelow);
      const maxHeight = Math.min(desiredHeight, avail);
      const top = openAbove
        ? Math.max(margin, rect.top - gap - maxHeight)
        : Math.min(vh - maxHeight - margin, rect.bottom + gap);
      setPopupPos({ top, left, width, maxHeight });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, anchorRef]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        pickerRef.current &&
        !pickerRef.current.contains(target) &&
        (!anchorRef?.current || !anchorRef.current.contains(target))
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen, onClose, anchorRef]);

  const loadOfficialStickers = useCallback(async () => {
    setIsLoadingStickers(true);
    setStickersError(null);
    const res = await fetchTelegramStickersApi(accountId);
    setIsLoadingStickers(false);
    if (!res.ok) {
      setStickerPacks([]);
      setStickersError(res.error || '无法加载官方贴纸库');
      return;
    }
    setStickerPacks(res.packs);
    if (res.packs.length > 0 && selectedPackId !== 'all' && !res.packs.some((p) => p.id === selectedPackId)) {
      setSelectedPackId('all');
    }
  }, [accountId, selectedPackId]);

  useEffect(() => {
    remoteSearchSeqRef.current += 1;
    setStickerPacks([]);
    setRemoteSearchPacks([]);
    setSelectedPackId('all');
    setFailedThumbKeys(new Set());
    setStickersError(null);
    setRemoteSearchError(null);
    setIsSearchingRemote(false);
  }, [accountId]);

  useEffect(() => {
    if (isOpen && tab === 'stickers' && stickerPacks.length === 0 && !isLoadingStickers) {
      void loadOfficialStickers();
    }
  }, [isOpen, tab, stickerPacks.length, isLoadingStickers, loadOfficialStickers]);

  const runRemoteStickerSearch = useCallback(async (rawQuery: string) => {
    const q = rawQuery.trim();
    if (!q) {
      remoteSearchSeqRef.current += 1;
      setRemoteSearchPacks([]);
      setRemoteSearchError(null);
      setIsSearchingRemote(false);
      return;
    }
    const seq = ++remoteSearchSeqRef.current;
    setIsSearchingRemote(true);
    setRemoteSearchError(null);
    const res = await searchTelegramStickersApi(q, accountId);
    if (seq !== remoteSearchSeqRef.current) return;
    setIsSearchingRemote(false);
    if (!res.ok) {
      setRemoteSearchPacks([]);
      setRemoteSearchError(res.error || '云端贴纸搜索失败');
      return;
    }
    setRemoteSearchPacks(res.packs);
  }, [accountId]);

  useEffect(() => {
    if (!isOpen || tab !== 'stickers') return;
    const q = searchQuery.trim();
    if (!q) {
      remoteSearchSeqRef.current += 1;
      setRemoteSearchPacks([]);
      setRemoteSearchError(null);
      setIsSearchingRemote(false);
      return;
    }
    const timer = window.setTimeout(() => {
      void runRemoteStickerSearch(q);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [isOpen, tab, searchQuery, runRemoteStickerSearch]);

  // Filtered Emojis
  const filteredEmojis = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return EMOJI_DATABASE.filter((item) => {
      if (selectedEmojiCategory !== 'all' && item.category !== selectedEmojiCategory) {
        return false;
      }
      if (!q) return true;
      return (
        item.char.includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.toLowerCase().includes(q))
      );
    });
  }, [searchQuery, selectedEmojiCategory]);

  // Active sticker packs list (default packs + cloud search results when searching)
  const displayStickerPacks = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return stickerPacks;
    const seen = new Set<string>();
    const merged: TelegramStickerPack[] = [];
    for (const p of remoteSearchPacks) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        merged.push(p);
      }
    }
    const lowerQ = q.toLowerCase();
    for (const p of stickerPacks) {
      if (seen.has(p.id)) continue;
      const matchesPack =
        p.title.toLowerCase().includes(lowerQ) ||
        p.shortName.toLowerCase().includes(lowerQ) ||
        p.stickers.some((st) => st.emoji.includes(lowerQ));
      if (matchesPack) {
        seen.add(p.id);
        merged.push(p);
      }
    }
    return merged;
  }, [stickerPacks, remoteSearchPacks, searchQuery]);

  // Filtered Real Official Telegram Stickers
  const filteredStickers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list: Array<{ sticker: TelegramStickerItem; packTitle: string }> = [];
    const seenDocs = new Set<string>();
    const remotePackIds = new Set(remoteSearchPacks.map((p) => p.id));

    for (const pack of displayStickerPacks) {
      if (selectedPackId !== 'all' && pack.id !== selectedPackId) continue;
      const isRemoteResultPack = remotePackIds.has(pack.id);
      for (const st of pack.stickers) {
        const docKey = `${st.setId}_${st.docId}`;
        if (seenDocs.has(docKey)) continue;
        if (
          !q ||
          isRemoteResultPack ||
          st.emoji.includes(q) ||
          pack.title.toLowerCase().includes(q) ||
          pack.shortName.toLowerCase().includes(q)
        ) {
          seenDocs.add(docKey);
          list.push({ sticker: st, packTitle: pack.title });
        }
      }
    }
    return list;
  }, [displayStickerPacks, remoteSearchPacks, selectedPackId, searchQuery]);

  if (!isOpen) return null;

  const pickerEl = (
    <div
      ref={pickerRef}
      style={
        popupPos
          ? {
              top: `${popupPos.top}px`,
              left: `${popupPos.left}px`,
              width: `${popupPos.width}px`,
              maxHeight: `${popupPos.maxHeight}px`,
            }
          : undefined
      }
      className={
        popupPos
          ? 'fixed z-[9990] bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] rounded-2xl shadow-2xl linen:shadow-sm border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150 select-none flex flex-col'
          : 'fixed bottom-16 right-4 z-[9990] w-[340px] sm:w-[380px] bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] rounded-2xl shadow-2xl linen:shadow-sm border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150 select-none flex flex-col max-h-[460px]'
      }
    >
      {/* 1. Top Header: Tabs + Close Button */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5] shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setTab('emoji')}
            className={`px-3 py-1.5 rounded-xl cursor-pointer transition-all flex items-center gap-1.5 ${
              tab === 'emoji'
                ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] linen:bg-[#a86a43] text-white shadow-xs'
                : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e5d9c6]'
            }`}
          >
            <Smile className="w-3.5 h-3.5" />
            <span>表情</span>
            {searchQuery && tab === 'emoji' && (
              <span className="text-[10px] opacity-80 tabular-nums">({filteredEmojis.length})</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setTab('stickers')}
            className={`px-3 py-1.5 rounded-xl cursor-pointer transition-all flex items-center gap-1.5 ${
              tab === 'stickers'
                ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] linen:bg-[#a86a43] text-white shadow-xs'
                : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e5d9c6]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>电报贴纸</span>
            {searchQuery && tab === 'stickers' && (
              <span className="text-[10px] opacity-80 tabular-nums">({filteredStickers.length})</span>
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-[#eef4fb] aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] linen:text-[#6e5c4a] linen:hover:text-[#2b2118] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e5d9c6] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Official Telegram Search Bar */}
      <div className="p-2.5 pb-2 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] shrink-0 bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7]">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] absolute left-3 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (tab === 'stickers') setSelectedPackId('all');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tab === 'stickers' && searchQuery.trim()) {
                e.preventDefault();
                void runRemoteStickerSearch(searchQuery);
              }
            }}
            placeholder={tab === 'emoji' ? '搜索表情 (输入关键词如: 笑, 赞, 爱心, 火...)' : '自由搜索全网电报贴纸 (输入关键词如: cat, love, 猫, 开心 或 Emoji)...'}
            className="w-full bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#efe6d6] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] text-xs pl-8 pr-7 py-1.5 rounded-xl border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] focus:outline-none placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] transition-all"
            autoFocus
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedPackId('all');
              }}
              className="absolute right-2.5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Category Chips Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-2 text-[11px]">
          {tab === 'emoji' ? (
            <>
              <button
                type="button"
                onClick={() => setSelectedEmojiCategory('all')}
                className={`px-2 py-0.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
                  selectedEmojiCategory === 'all'
                    ? 'bg-[#e8f3ff] border border-[#bfdbfe] text-[#0284c7] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4] linen:bg-[#a86a43]/15 linen:border-[#cbbba2] linen:text-[#8c522d] font-semibold'
                    : 'border border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe4d3]'
                }`}
              >
                全部
              </button>
              <button
                type="button"
                onClick={() => setSelectedEmojiCategory('smileys')}
                className={`px-2 py-0.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 ${
                  selectedEmojiCategory === 'smileys'
                    ? 'bg-[#e8f3ff] border border-[#bfdbfe] text-[#0284c7] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4] linen:bg-[#a86a43]/15 linen:border-[#cbbba2] linen:text-[#8c522d] font-semibold'
                    : 'border border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe4d3]'
                }`}
              >
                <span>😀</span> 脸部表情
              </button>
              <button
                type="button"
                onClick={() => setSelectedEmojiCategory('gestures')}
                className={`px-2 py-0.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 ${
                  selectedEmojiCategory === 'gestures'
                    ? 'bg-[#e8f3ff] border border-[#bfdbfe] text-[#0284c7] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4] linen:bg-[#a86a43]/15 linen:border-[#cbbba2] linen:text-[#8c522d] font-semibold'
                    : 'border border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe4d3]'
                }`}
              >
                <span>👍</span> 手势人物
              </button>
              <button
                type="button"
                onClick={() => setSelectedEmojiCategory('hearts')}
                className={`px-2 py-0.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 ${
                  selectedEmojiCategory === 'hearts'
                    ? 'bg-[#e8f3ff] border border-[#bfdbfe] text-[#0284c7] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4] linen:bg-[#a86a43]/15 linen:border-[#cbbba2] linen:text-[#8c522d] font-semibold'
                    : 'border border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe4d3]'
                }`}
              >
                <span>❤️</span> 情感爱心
              </button>
              <button
                type="button"
                onClick={() => setSelectedEmojiCategory('objects')}
                className={`px-2 py-0.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 ${
                  selectedEmojiCategory === 'objects'
                    ? 'bg-[#e8f3ff] border border-[#bfdbfe] text-[#0284c7] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4] linen:bg-[#a86a43]/15 linen:border-[#cbbba2] linen:text-[#8c522d] font-semibold'
                    : 'border border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe4d3]'
                }`}
              >
                <span>🎉</span> 派对物品
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSelectedPackId('all')}
                className={`px-2 py-0.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
                  selectedPackId === 'all'
                    ? 'bg-[#e8f3ff] border border-[#bfdbfe] text-[#0284c7] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4] linen:bg-[#a86a43]/15 linen:border-[#cbbba2] linen:text-[#8c522d] font-semibold'
                    : 'border border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe4d3]'
                }`}
              >
                {searchQuery.trim() ? `搜索结果 (${displayStickerPacks.length})` : `全部贴纸包 (${displayStickerPacks.length})`}
              </button>
              {displayStickerPacks.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setSelectedPackId(pack.id)}
                  className={`px-2 py-0.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer max-w-[120px] truncate ${
                    selectedPackId === pack.id
                      ? 'bg-[#e8f3ff] border border-[#bfdbfe] text-[#0284c7] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4] linen:bg-[#a86a43]/15 linen:border-[#cbbba2] linen:text-[#8c522d] font-semibold'
                      : 'border border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe4d3]'
                  }`}
                  title={pack.title}
                >
                  {pack.stickers[0]?.emoji || '✨'} {pack.title}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* 3. Main Content: Emoji Grid or Sticker Grid */}
      <div className="p-3 overflow-y-auto flex-1 min-h-[220px]">
        {tab === 'emoji' ? (
          filteredEmojis.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
              <Smile className="w-8 h-8 stroke-1 text-[#94a3b8] dark:text-[#4e657e] aurora:text-[#5a7782] linen:text-[#9c8a75] mb-2" />
              <p>未找到与「{searchQuery}」相关的表情</p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-2 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] hover:underline cursor-pointer"
              >
                查看全部表情
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-8 gap-1.5 text-xl text-center">
              {filteredEmojis.map((item, index) => (
                <button
                  key={`${item.char}_${index}`}
                  type="button"
                  onClick={() => onSelectEmoji(item.char)}
                  title={`${item.name} (${item.char})`}
                  className="w-9 h-9 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe4d3] flex items-center justify-center transition-all hover:scale-125 cursor-pointer active:scale-95"
                >
                  <span className="leading-none">{item.char}</span>
                </button>
              ))}
            </div>
          )
        ) : isLoadingStickers || (isSearchingRemote && filteredStickers.length === 0) ? (
          <div className="py-14 flex flex-col items-center justify-center text-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
            <Loader2 className="w-6 h-6 animate-spin text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#a86a43] mb-2" />
            <p>
              {isSearchingRemote
                ? `正在 Telegram 云端搜索「${searchQuery.trim()}」相关贴纸...`
                : '正在从 Telegram 官方云端同步贴纸库...'}
            </p>
          </div>
        ) : stickersError && !searchQuery.trim() ? (
          <div className="py-10 px-4 flex flex-col items-center justify-center text-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
            <AlertCircle className="w-7 h-7 text-amber-600 dark:text-amber-400 aurora:text-amber-400 mb-2" />
            <p className="text-rose-600 dark:text-rose-400 aurora:text-rose-400 font-medium mb-2">{stickersError}</p>
            <button
              type="button"
              onClick={() => void loadOfficialStickers()}
              className="px-3 py-1 rounded-lg bg-[#e8f3ff] border border-[#bfdbfe] text-[#0284c7] hover:bg-[#dbeafe] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] dark:hover:bg-[#2ba0ff]/25 aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4] aurora:hover:bg-[#153944] linen:bg-[#e5d5bf] linen:border-[#c2a889] linen:text-[#7c4522] linen:hover:bg-[#dcc6aa] flex items-center gap-1 cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> 重新加载官方贴纸
            </button>
          </div>
        ) : filteredStickers.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
            <Sparkles className="w-8 h-8 stroke-1 text-[#94a3b8] dark:text-[#4e657e] aurora:text-[#5a7782] linen:text-[#9c8a75] mb-2" />
            <p>
              {remoteSearchError && searchQuery.trim()
                ? remoteSearchError
                : searchQuery.trim()
                  ? `Telegram 全网暂未找到与「${searchQuery}」匹配的贴纸，可尝试换个词或直接输入 Emoji`
                  : '当前 Telegram 账号暂无可用官方贴纸包'}
            </p>
            <button
              type="button"
              onClick={() => {
                if (searchQuery) {
                  setSearchQuery('');
                  setSelectedPackId('all');
                } else {
                  void loadOfficialStickers();
                }
              }}
              className="mt-2 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] hover:underline cursor-pointer"
            >
              {searchQuery ? '返回热门与已安装贴纸' : '刷新官方贴纸包'}
            </button>
          </div>
        ) : (
          <>
            {isSearchingRemote && searchQuery.trim() && (
              <div className="mb-2 px-2.5 py-1 rounded-lg bg-[#e8f3ff]/80 dark:bg-[#2ba0ff]/10 aurora:bg-[#112d36]/80 linen:bg-[#efe4d3] text-[11px] text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                <span>正在同步 Telegram 官方全网贴纸结果...</span>
              </div>
            )}
            <div className="grid grid-cols-4 gap-2">
            {filteredStickers.map(({ sticker, packTitle }) => {
              const thumbKey = `${sticker.setId}_${sticker.docId}`;
              const isThumbFailed = failedThumbKeys.has(thumbKey);
              return (
              <button
                key={thumbKey}
                type="button"
                title={`${sticker.emoji} · ${packTitle}`}
                onClick={() => {
                  onSelectSticker?.(sticker, packTitle);
                  onClose();
                }}
                className="flex flex-col items-center justify-center p-1.5 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe4d3] transition-all hover:scale-105 cursor-pointer group border border-transparent hover:border-[#2481cc]/25 dark:hover:border-[#2ba0ff]/30 aurora:hover:border-[#2dd4bf]/30 linen:hover:border-[#cbbba2]"
              >
                <div className="w-16 h-16 rounded-lg overflow-hidden relative flex items-center justify-center bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]">
                  {!isThumbFailed && sticker.thumbUrl ? (
                    <img
                      src={sticker.thumbUrl}
                      alt={sticker.emoji}
                      loading="lazy"
                      onError={() => {
                        setFailedThumbKeys((prev) => {
                          if (prev.has(thumbKey)) return prev;
                          const next = new Set(prev);
                          next.add(thumbKey);
                          return next;
                        });
                      }}
                      className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-200"
                    />
                  ) : (
                    <span className="text-3xl leading-none select-none">{sticker.emoji || '✨'}</span>
                  )}
                  <span className="absolute bottom-0.5 right-0.5 text-xs bg-black/55 text-white rounded-full px-1 leading-tight">
                    {sticker.emoji}
                  </span>
                </div>
              </button>
              );
            })}
            </div>
          </>
        )}
      </div>

      {/* 4. Footer Note */}
      <div className="px-3 py-1.5 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5] flex items-center justify-between text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
        <span>Telegram 官方云端表情与贴纸库</span>
        <span>
          {tab === 'emoji'
            ? `共 ${EMOJI_DATABASE.length} 个原生表情`
            : isSearchingRemote
              ? '正在云端搜索...'
              : `${displayStickerPacks.length} 套贴纸包 · ${filteredStickers.length} 张贴纸`}
        </span>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(pickerEl, document.body) : pickerEl;
};
