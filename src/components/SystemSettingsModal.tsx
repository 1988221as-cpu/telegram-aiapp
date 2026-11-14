import React, { useState, useEffect } from 'react';
import {
  Settings,
  X,
  ShieldCheck,
  Database,
  Lock,
  Globe,
  Server
} from 'lucide-react';
import { fetchAuthStatus } from '../services/apiService';

interface SystemSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDatabase?: () => void;
  onOpenTranslation?: () => void;
}

export const SystemSettingsModal: React.FC<SystemSettingsModalProps> = ({
  isOpen,
  onClose,
  onOpenDatabase,
  onOpenTranslation,
}) => {
  const [jwtMode, setJwtMode] = useState<'asymmetric' | 'hs256' | 'unconfigured' | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    fetchAuthStatus()
      .then((status) => {
        if (active && status?.jwtMode) {
          setJwtMode(status.jwtMode);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200 select-none">
      <div className="relative w-full max-w-lg bg-[#0e1621] border border-[#1e2f42] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#f5f7fa] max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#17212b] bg-[#121c27] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#2481cc]/20 border border-[#2481cc]/40 flex items-center justify-center text-[#2ba0ff]">
              <Settings className="w-5 h-5 text-[#2ba0ff]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">工作台系统管理</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#7f93a5] hover:text-white hover:bg-[#1a2838] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Section 1: Zero-DB Security Protocol */}
          <div className="bg-[#121c27] border border-[#1e2f42] rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold text-white">系统安全与加密状态</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-[#0c131c] border border-[#1e2f42]/60">
                <div className="text-[10px] text-[#7f93a5]">会话安全存储</div>
                <div className="text-emerald-400 font-medium mt-0.5 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  <span>AES-256-GCM 硬件加密</span>
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#0c131c] border border-[#1e2f42]/60">
                <div className="text-[10px] text-[#7f93a5]">运行隔离与鉴权</div>
                <div className="text-[#2ba0ff] font-medium mt-0.5 flex items-center gap-1">
                  <Server className="w-3 h-3" />
                  <span>
                    {jwtMode === 'asymmetric'
                      ? 'JWT RS256 非对称公钥验签'
                      : jwtMode === 'hs256'
                        ? 'JWT HS256 对称密钥验签'
                        : jwtMode === 'unconfigured'
                          ? 'JWT 验签密钥未配置'
                          : '正在检测鉴权模式...'}
                  </span>
                </div>
              </div>
            </div>

            {(onOpenDatabase || onOpenTranslation) && (
              <div className="pt-2 border-t border-[#1e2f42] flex items-center justify-between gap-3 flex-wrap">
                {onOpenDatabase && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenDatabase();
                    }}
                    className="flex items-center gap-1.5 text-xs text-[#2ba0ff] hover:underline cursor-pointer"
                  >
                    <Database className="w-3.5 h-3.5" />
                    <span>打开本地数据中心</span>
                  </button>
                )}
                {onOpenTranslation && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenTranslation();
                    }}
                    className="flex items-center gap-1.5 text-xs text-[#2ba0ff] hover:underline cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>双向翻译设置</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#17212b] bg-[#121c27] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-[#55697d]">HumanSense Internal Settings · v2.5.0</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#2481cc] hover:bg-[#1d6fae] text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors"
          >
            完成并关闭
          </button>
        </div>
      </div>
    </div>
  );
};
