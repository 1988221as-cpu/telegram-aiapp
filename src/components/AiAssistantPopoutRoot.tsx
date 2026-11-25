import React, { useEffect, useState } from 'react';
import { AiAssistantModal } from './AiAssistantModal';
import {
  applyAppearanceToDocument,
  loadStoredAppearance,
} from '../services/appearanceConfig';
import { initSessionHandshake } from '../services/apiService';
import {
  getDesktopAiWindowBridge,
  loadAiAssistantSnapshot,
  requestAiAssistantSync,
  subscribeAiAssistantSync,
} from '../services/aiAssistantSync';
import { AppThemeMode, ChatAppearanceSettings } from '../types';

function resolveInitialAppearance(): ChatAppearanceSettings {
  const snap = loadAiAssistantSnapshot();
  if (snap?.appearance) {
    return snap.appearance;
  }
  const savedTheme = typeof window !== 'undefined' ? localStorage.getItem('tg_pro_theme') : null;
  const fallbackTheme: AppThemeMode =
    savedTheme === 'dark' || savedTheme === 'aurora' || savedTheme === 'light' || savedTheme === 'linen'
      ? savedTheme
      : 'linen';
  return loadStoredAppearance(fallbackTheme);
}

export const AiAssistantPopoutRoot: React.FC = () => {
  const [appearance, setAppearance] = useState<ChatAppearanceSettings>(() => resolveInitialAppearance());
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [contextMeta, setContextMeta] = useState(() => {
    const snap = loadAiAssistantSnapshot();
    return {
      engineLicenseKey: snap?.engineLicenseKey,
      activeChatTitle: snap?.activeChatTitle,
      operatorAvatarUrl: snap?.operatorAvatarUrl,
      operatorInitial: snap?.operatorInitial || '我',
    };
  });

  useEffect(() => {
    const theme = appearance.baseTheme;
    document.documentElement.classList.toggle('dark', theme === 'dark' || theme === 'aurora');
    document.documentElement.classList.toggle('theme-aurora', theme === 'aurora');
    document.documentElement.classList.toggle('theme-linen', theme === 'linen');
    applyAppearanceToDocument(appearance);
  }, [appearance]);

  useEffect(() => {
    let active = true;
    void initSessionHandshake()
      .catch(() => {})
      .finally(() => {
        if (active) setIsSessionReady(true);
      });
    requestAiAssistantSync();
    const unsub = subscribeAiAssistantSync((remote) => {
      if (remote.appearance) {
        setAppearance(remote.appearance);
      }
      if (
        'engineLicenseKey' in remote ||
        'activeChatTitle' in remote ||
        'operatorAvatarUrl' in remote ||
        'operatorInitial' in remote
      ) {
        setContextMeta((prev) => ({
          engineLicenseKey:
            'engineLicenseKey' in remote ? remote.engineLicenseKey : prev.engineLicenseKey,
          activeChatTitle:
            'activeChatTitle' in remote ? remote.activeChatTitle : prev.activeChatTitle,
          operatorAvatarUrl:
            'operatorAvatarUrl' in remote ? remote.operatorAvatarUrl : prev.operatorAvatarUrl,
          operatorInitial:
            'operatorInitial' in remote ? remote.operatorInitial || '我' : prev.operatorInitial,
        }));
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  const handleClose = () => {
    const bridge = getDesktopAiWindowBridge();
    if (bridge) {
      void bridge.close();
    } else {
      window.close();
    }
  };

  return (
    <AiAssistantModal
      isOpen={true}
      hostMode="popout"
      sessionReady={isSessionReady}
      onClose={handleClose}
      engineLicenseKey={contextMeta.engineLicenseKey}
      activeChatTitle={contextMeta.activeChatTitle}
      operatorAvatarUrl={contextMeta.operatorAvatarUrl}
      operatorInitial={contextMeta.operatorInitial}
      appearance={appearance}
    />
  );
};
