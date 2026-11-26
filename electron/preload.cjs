const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('humanSenseCrypto', {
  getStatus: () => ipcRenderer.sendSync('hs-crypto:status'),
  encryptSync: (plaintext) => ipcRenderer.sendSync('hs-crypto:encrypt-sync', plaintext),
  decryptSync: (ciphertext) => ipcRenderer.sendSync('hs-crypto:decrypt-sync', ciphertext),
  encryptAsync: (plaintext) => ipcRenderer.invoke('hs-crypto:encrypt-async', plaintext),
  decryptAsync: (ciphertext) => ipcRenderer.invoke('hs-crypto:decrypt-async', ciphertext),
  migrateLegacySeed: (legacySeedBase64) =>
    ipcRenderer.sendSync('hs-crypto:migrate-legacy-seed', legacySeedBase64),
  purgeMasterKey: () => ipcRenderer.sendSync('hs-crypto:purge-key'),
});

contextBridge.exposeInMainWorld('humanSenseUpdater', {
  getInfo: () => ipcRenderer.invoke('hs-updater:get-info'),
  getState: () => ipcRenderer.invoke('hs-updater:get-state'),
  startDownload: (payload) => ipcRenderer.invoke('hs-updater:download', payload),
  cancelDownload: () => ipcRenderer.invoke('hs-updater:cancel'),
  installNow: () => ipcRenderer.invoke('hs-updater:install'),
  onStateChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('hs-updater:state', listener);
    return () => ipcRenderer.removeListener('hs-updater:state', listener);
  },
});

contextBridge.exposeInMainWorld('humanSenseAiWindow', {
  isAvailable: true,
  open: (options) => ipcRenderer.invoke('hs-ai-window:open', options || {}),
  dockBack: () => ipcRenderer.invoke('hs-ai-window:dock-back'),
  close: () => ipcRenderer.invoke('hs-ai-window:close'),
  focus: () => ipcRenderer.invoke('hs-ai-window:focus'),
  minimize: () => ipcRenderer.invoke('hs-ai-window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('hs-ai-window:toggle-maximize'),
  setAlwaysOnTop: (alwaysOnTop) =>
    ipcRenderer.invoke('hs-ai-window:set-always-on-top', Boolean(alwaysOnTop)),
  getState: () => ipcRenderer.invoke('hs-ai-window:get-state'),
  onStateChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('hs-ai-window:state', listener);
    return () => ipcRenderer.removeListener('hs-ai-window:state', listener);
  },
});
