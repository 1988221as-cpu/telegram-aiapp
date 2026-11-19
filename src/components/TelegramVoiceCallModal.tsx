import React, { useState, useEffect, useRef } from 'react';
import { PhoneOff, Shield, AlertCircle, Info } from 'lucide-react';
import { Chat } from '../types';
import {
  startTelegramVoiceCallApi,
  getTelegramVoiceCallStatusApi,
  endTelegramVoiceCallApi,
} from '../services/apiService';

interface TelegramVoiceCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  chat?: Chat | null;
  currentAccountId?: string;
  contactName?: string;
  avatarBg?: string;
  avatarInitial?: string;
  onCallEnded?: (durationSeconds: number, outcome: 'ended' | 'missed') => void;
}

export const TelegramVoiceCallModal: React.FC<TelegramVoiceCallModalProps> = ({
  isOpen,
  onClose,
  chat,
  currentAccountId,
  contactName,
  avatarBg,
  avatarInitial,
  onCallEnded,
}) => {
  const [callStatus, setCallStatus] = useState<'calling' | 'ringing' | 'connected' | 'ended'>('calling');
  const [duration, setDuration] = useState(0);
  const [statusNotice, setStatusNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const timerRef = useRef<any>(null);
  const pollRef = useRef<any>(null);
  const callIdRef = useRef<string>('');
  const durationRef = useRef<number>(0);
  const reportedEndRef = useRef<boolean>(false);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    if (!isOpen) {
      setCallStatus('calling');
      setDuration(0);
      setStatusNotice('');
      setErrorMsg('');
      callIdRef.current = '';
      reportedEndRef.current = false;
      clearInterval(timerRef.current);
      clearInterval(pollRef.current);
      return;
    }

    let cancelled = false;

    (async () => {
      const startRes = await startTelegramVoiceCallApi({
        accountId: currentAccountId,
        chatId: chat?.id,
        username: chat?.username,
      });

      if (cancelled) return;

      if (!startRes.ok || !startRes.callId) {
        setCallStatus('ended');
        setErrorMsg(startRes.error || '未能发起 Telegram 云端语音呼叫');
        return;
      }

      callIdRef.current = startRes.callId;
      setCallStatus('ringing');

      pollRef.current = setInterval(async () => {
        if (!callIdRef.current || cancelled) return;
        const st = await getTelegramVoiceCallStatusApi(callIdRef.current, currentAccountId);
        if (cancelled) return;
        if (st.status === 'accepted') {
          setCallStatus((prev) => {
            if (prev !== 'connected') {
              clearInterval(timerRef.current);
              timerRef.current = setInterval(() => {
                setDuration((d) => d + 1);
              }, 1000);
            }
            return 'connected';
          });
          setStatusNotice('Telegram 云端呼叫信令已接通（桌面端暂不传输实时通话音频，请发送语音条或使用手机端 Telegram 通话）');
        } else if (st.status === 'discarded' || st.status === 'failed') {
          clearInterval(timerRef.current);
          clearInterval(pollRef.current);
          setCallStatus('ended');
          setStatusNotice(st.endedReason || '对方已挂断或未接听');
          if (!reportedEndRef.current) {
            reportedEndRef.current = true;
            onCallEnded?.(durationRef.current, durationRef.current > 0 ? 'ended' : 'missed');
          }
          setTimeout(() => {
            if (!cancelled) onClose();
          }, 1400);
        }
      }, 1200);
    })();

    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
      clearInterval(pollRef.current);
      if (callIdRef.current) {
        void endTelegramVoiceCallApi(callIdRef.current, durationRef.current, currentAccountId);
        callIdRef.current = '';
      }
      if (!reportedEndRef.current) {
        reportedEndRef.current = true;
        onCallEnded?.(durationRef.current, durationRef.current > 0 ? 'ended' : 'missed');
      }
    };
  }, [isOpen, currentAccountId, chat?.id, chat?.username]);

  const handleEndCall = async () => {
    clearInterval(timerRef.current);
    clearInterval(pollRef.current);
    setCallStatus('ended');
    if (callIdRef.current) {
      const activeId = callIdRef.current;
      callIdRef.current = '';
      await endTelegramVoiceCallApi(activeId, durationRef.current, currentAccountId);
    }
    if (!reportedEndRef.current) {
      reportedEndRef.current = true;
      onCallEnded?.(durationRef.current, durationRef.current > 0 ? 'ended' : 'missed');
    }
    setTimeout(() => {
      onClose();
    }, 500);
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isOpen || (!chat && !contactName)) return null;

  const displayName = chat?.title || contactName || 'Telegram 用户';
  const displayAvatarBg = chat?.avatarBg || avatarBg || '#2481cc';
  const displayAvatarInitial = chat?.avatarInitial || avatarInitial || displayName.slice(0, 2).toUpperCase();
  const displayAvatarUrl = chat?.avatarUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-md animate-in fade-in duration-200 select-none">
      <div className="relative w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#f8fafc] to-white dark:from-[#101c2d] dark:to-[#09111c] aurora:from-[#10222b] linen:from-[#efe6d6] aurora:to-[#081116] linen:to-[#f8f2e7] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] p-6 shadow-2xl linen:shadow-sm border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] flex flex-col items-center">
        {/* Top Signaling Indicator */}
        <div className="flex items-center gap-1.5 text-[11px] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] font-medium mb-6">
          <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>Telegram 云端呼叫信令</span>
        </div>

        {/* Contact Avatar */}
        <div className="relative my-4">
          <div
            className="w-28 h-28 rounded-full overflow-hidden flex items-center justify-center text-3xl font-bold text-white shadow-2xl border-4 border-white dark:border-white/15 aurora:border-[#2dd4bf]/25 linen:border-[#e7dccb] relative z-10"
            style={{ backgroundColor: displayAvatarBg }}
          >
            {displayAvatarUrl ? (
              <img src={displayAvatarUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <span>{displayAvatarInitial}</span>
            )}
          </div>
          {(callStatus === 'calling' || callStatus === 'ringing') && (
            <div className="absolute -inset-2 rounded-full border-2 border-emerald-500/45 dark:border-emerald-400/40 animate-pulse pointer-events-none" />
          )}
        </div>

        {/* Contact Name & Status */}
        <h3 className="text-xl font-bold text-center mt-3 truncate max-w-[240px] text-[#0f172a] dark:text-white aurora:text-[#ecf6f8] linen:text-[#2b2118]">
          {displayName}
        </h3>
        <p className="text-sm font-medium mt-1 text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] tabular-nums text-center">
          {callStatus === 'calling' && '正在连接 Telegram 云端呼叫信令...'}
          {callStatus === 'ringing' && '对方客户端正在响铃（等待接听）...'}
          {callStatus === 'connected' && `信令已接通 ${formatDuration(duration)}`}
          {callStatus === 'ended' && (errorMsg ? '呼叫未能建立' : statusNotice || '通话信令已结束')}
        </p>

        {errorMsg && (
          <div className="mt-3 px-3 py-2 rounded-xl bg-rose-500/12 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2 text-left w-full">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {!errorMsg && (
          <div className="mt-3 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-200/90 text-[11px] flex items-start gap-2 text-left w-full leading-relaxed">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-300" />
            <span>
              {statusNotice || '桌面端仅支持发起与挂断 Telegram 呼叫信令，暂不支持实时通话音频传输；如需语音沟通，请发送语音条或使用手机端 Telegram。'}
            </span>
          </div>
        )}

        {/* Action Controls (Real Hang-up only — no fake mute/speaker controls) */}
        <div className="flex items-center justify-center mt-6">
          <button
            onClick={handleEndCall}
            className="w-16 h-16 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-lg transition-transform hover:scale-105 cursor-pointer"
            title="挂断呼叫"
          >
            <PhoneOff className="w-7 h-7" />
          </button>
        </div>
      </div>
    </div>
  );
};
