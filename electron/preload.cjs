const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('humanSenseCrypto', {
  getStatus: () => ipcRenderer.sendSync('hs-crypto:status'),
  encryptSync: (plaintext) => ipcRenderer.sendSync('hs-crypto:encrypt-sync', plaintext),
  decryptSync: (ciphertext) => ipcRenderer.sendSync('hs-crypto:decrypt-sync', ciphertext),
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
