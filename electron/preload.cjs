const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('humanSenseCrypto', {
  getStatus: () => ipcRenderer.sendSync('hs-crypto:status'),
  encryptSync: (plaintext) => ipcRenderer.sendSync('hs-crypto:encrypt-sync', plaintext),
  decryptSync: (ciphertext) => ipcRenderer.sendSync('hs-crypto:decrypt-sync', ciphertext),
  migrateLegacySeed: (legacySeedBase64) =>
    ipcRenderer.sendSync('hs-crypto:migrate-legacy-seed', legacySeedBase64),
  purgeMasterKey: () => ipcRenderer.sendSync('hs-crypto:purge-key'),
});
