const { app, BrowserWindow, Menu, dialog, shell, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

// Set application name and Windows AppUserModelId explicitly
app.setName('HumanSense');
if (process.platform === 'win32' && typeof app.setAppUserModelId === 'function') {
  app.setAppUserModelId('com.lingxicontext.app');
}

function getAppWindowTitle() {
  const rawVer = typeof app.getVersion === 'function' ? String(app.getVersion() || '').trim() : '';
  return rawVer ? `HumanSense v${rawVer}` : 'HumanSense';
}

function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, 'dist', 'app-icon.png'),
    path.join(__dirname, 'public', 'app-icon.png'),
    path.join(__dirname, 'dist', 'assets', 'aistudio', 'image_df23adce.png'),
    path.join(__dirname, 'public', 'assets', 'aistudio', 'image_df23adce.png'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

// 1. Disable hardware acceleration to eliminate Windows GPU driver black screen issues
app.disableHardwareAcceleration();

// 2. Single-instance lock to prevent port collisions from multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

const FIXED_APP_PORT = 38271;
let mainWindow = null;
let currentPort = FIXED_APP_PORT;
let backendChild = null;
let isQuitting = false;

// 2.5 OS-level safeStorage (Windows DPAPI) + AES-256-GCM Master Key Custody
const AES_GCM_PREFIX = 'enc:gcm256:';
let cachedDpapiMasterKey = null;

function getMasterKeyStoragePaths() {
  const dataDir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return {
    dpapiPath: path.join(dataDir, '.hs_master_key.dpapi'),
    fallbackPath: path.join(dataDir, '.hs_master_key.local'),
  };
}

function isSafeStorageReady() {
  try {
    return Boolean(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable());
  } catch {
    return false;
  }
}

function persistMasterKeyBytes(keyBuf) {
  const { dpapiPath, fallbackPath } = getMasterKeyStoragePaths();
  if (!isSafeStorageReady()) {
    return false;
  }
  const sealed = safeStorage.encryptString(keyBuf.toString('base64'));
  fs.writeFileSync(dpapiPath, sealed);
  try {
    if (fs.existsSync(fallbackPath)) fs.unlinkSync(fallbackPath);
  } catch {}
  return true;
}

function getOrCreateMasterKeyBytes() {
  if (!isSafeStorageReady()) {
    cachedDpapiMasterKey = null;
    return null;
  }
  if (cachedDpapiMasterKey && Buffer.isBuffer(cachedDpapiMasterKey) && cachedDpapiMasterKey.length === 32) {
    return cachedDpapiMasterKey;
  }
  const { dpapiPath, fallbackPath } = getMasterKeyStoragePaths();
  if (fs.existsSync(dpapiPath)) {
    try {
      const sealed = fs.readFileSync(dpapiPath);
      const b64 = safeStorage.decryptString(sealed);
      const decoded = Buffer.from(b64, 'base64');
      if (decoded.length === 32) {
        cachedDpapiMasterKey = decoded;
        return cachedDpapiMasterKey;
      }
    } catch (err) {
      writeLog('warn', `Failed to decrypt DPAPI master key: ${err.message}`);
    }
  }
  if (fs.existsSync(fallbackPath)) {
    try {
      const b64 = fs.readFileSync(fallbackPath, 'utf8').trim();
      const decoded = Buffer.from(b64, 'base64');
      if (decoded.length === 32 && persistMasterKeyBytes(decoded)) {
        cachedDpapiMasterKey = decoded;
        return cachedDpapiMasterKey;
      }
    } catch {}
  }
  const fresh = crypto.randomBytes(32);
  if (!persistMasterKeyBytes(fresh)) {
    return null;
  }
  cachedDpapiMasterKey = fresh;
  return cachedDpapiMasterKey;
}

function isAuthorizedCryptoIpcEvent(event) {
  try {
    const url = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
    return url.startsWith(`http://127.0.0.1:${FIXED_APP_PORT}`) || url.startsWith(`http://localhost:${FIXED_APP_PORT}`);
  } catch {
    return false;
  }
}

function registerCryptoIpcHandlers() {
  ipcMain.on('hs-crypto:status', (event) => {
    if (!isAuthorizedCryptoIpcEvent(event)) {
      event.returnValue = { isElectron: true, hardwareProtected: false, storageMode: 'unauthorized' };
      return;
    }
    const hardwareProtected = isSafeStorageReady();
    event.returnValue = {
      isElectron: true,
      hardwareProtected,
      storageMode: hardwareProtected ? 'dpapi_aes_gcm' : 'dpapi_unavailable',
    };
  });

  ipcMain.on('hs-crypto:encrypt-sync', (event, plaintext) => {
    if (!isAuthorizedCryptoIpcEvent(event) || typeof plaintext !== 'string') {
      event.returnValue = null;
      return;
    }
    try {
      const key = getOrCreateMasterKeyBytes();
      if (!key) {
        event.returnValue = null;
        return;
      }
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const payload = Buffer.concat([encrypted, tag]);
      event.returnValue = `${AES_GCM_PREFIX}${iv.toString('base64')}:${payload.toString('base64')}`;
    } catch (err) {
      writeLog('warn', `hs-crypto encrypt-sync error: ${err.message}`);
      event.returnValue = null;
    }
  });

  ipcMain.on('hs-crypto:decrypt-sync', (event, ciphertext) => {
    if (!isAuthorizedCryptoIpcEvent(event) || typeof ciphertext !== 'string') {
      event.returnValue = null;
      return;
    }
    try {
      if (!ciphertext.startsWith(AES_GCM_PREFIX)) {
        event.returnValue = null;
        return;
      }
      const rest = ciphertext.slice(AES_GCM_PREFIX.length);
      const parts = rest.split(':');
      if (parts.length !== 2) {
        event.returnValue = null;
        return;
      }
      const iv = Buffer.from(parts[0], 'base64');
      const combined = Buffer.from(parts[1], 'base64');
      if (iv.length !== 12 || combined.length < 16) {
        event.returnValue = null;
        return;
      }
      const tag = combined.subarray(combined.length - 16);
      const enc = combined.subarray(0, combined.length - 16);
      const key = getOrCreateMasterKeyBytes();
      if (!key) {
        event.returnValue = null;
        return;
      }
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
      event.returnValue = decrypted;
    } catch {
      event.returnValue = null;
    }
  });

  ipcMain.on('hs-crypto:migrate-legacy-seed', (event, legacySeedBase64) => {
    if (!isAuthorizedCryptoIpcEvent(event) || typeof legacySeedBase64 !== 'string' || !isSafeStorageReady()) {
      event.returnValue = false;
      return;
    }
    try {
      const decoded = Buffer.from(legacySeedBase64, 'base64');
      if (decoded.length !== 32) {
        event.returnValue = false;
        return;
      }
      const { dpapiPath, fallbackPath } = getMasterKeyStoragePaths();
      if (!fs.existsSync(dpapiPath) && !fs.existsSync(fallbackPath)) {
        if (persistMasterKeyBytes(decoded)) {
          cachedDpapiMasterKey = decoded;
          event.returnValue = true;
          return;
        }
      }
      event.returnValue = false;
    } catch {
      event.returnValue = false;
    }
  });

  ipcMain.on('hs-crypto:purge-key', (event) => {
    if (!isAuthorizedCryptoIpcEvent(event)) {
      event.returnValue = false;
      return;
    }
    try {
      cachedDpapiMasterKey = null;
      const { dpapiPath, fallbackPath } = getMasterKeyStoragePaths();
      if (fs.existsSync(dpapiPath)) fs.unlinkSync(dpapiPath);
      if (fs.existsSync(fallbackPath)) fs.unlinkSync(fallbackPath);
      event.returnValue = true;
    } catch {
      event.returnValue = false;
    }
  });
}

// 3. Setup persistent file logging in %APPDATA%/HumanSense/logs/main.log
let logFilePath = null;
function getLogFilePath() {
  if (!logFilePath) {
    try {
      const logsDir = path.join(app.getPath('userData'), 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      logFilePath = path.join(logsDir, 'main.log');
    } catch {
      logFilePath = path.join(process.cwd(), 'main.log');
    }
  }
  return logFilePath;
}

function writeLog(level, message, detail = '') {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${detail ? ' ' + detail : ''}\n`;
  try {
    process.stdout.write(line);
    const p = getLogFilePath();
    fs.appendFileSync(p, line, 'utf8');
  } catch {}
}

// 4. Fixed-port enforcement on 38271 (preserves Chromium localStorage origin & AES-encrypted local session store)
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function ensureFixedPortAvailable(port = FIXED_APP_PORT, maxRetries = 12, delayMs = 250) {
  for (let i = 0; i < maxRetries; i++) {
    if (await isPortAvailable(port)) {
      return port;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    `本地固定端口 127.0.0.1:${port} 已被其他程序占用，为防止本地加密凭证与聊天缓存丢失，已阻止切换端口启动。请关闭占用端口 ${port} 的进程后点击「重新载入」或重启客户端。`
  );
}

// 5. Strict health check polling (strictly requires statusCode === 200; fails fast on HTTP 503 fatal DB error)
function waitForHealth200(url, maxRetries = 120, interval = 250) {
  return new Promise((resolve) => {
    let attempts = 0;
    let finished = false;
    const done = (result) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };
    const poll = () => {
      if (finished) return;
      attempts++;
      const req = http.get(url, (res) => {
        let rawBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (rawBody.length < 4096) rawBody += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            writeLog('info', `Server verified ready with HTTP 200 at ${url}`);
            done({ ok: true });
            return;
          }
          if (res.statusCode === 503) {
            let parsedErr = '';
            try {
              const parsed = JSON.parse(rawBody);
              parsedErr = parsed && parsed.error ? String(parsed.error) : '';
            } catch {}
            const fatalMsg = parsedErr || '本地数据库或核心引擎初始化失败 (HTTP 503)';
            writeLog('fatal', `Health check reported fatal 503 error: ${fatalMsg}`);
            done({ ok: false, fatalError: fatalMsg });
            return;
          }
          if (attempts < maxRetries) {
            setTimeout(poll, interval);
          } else {
            writeLog('warn', `Health check failed after ${attempts} attempts with status ${res.statusCode}`);
            done({ ok: false });
          }
        });
      });
      req.setTimeout(2000, () => {
        req.destroy(new Error('health check request timeout'));
      });
      req.on('error', (err) => {
        if (attempts < maxRetries) {
          setTimeout(poll, interval);
        } else {
          writeLog('warn', `Health check network error after ${attempts} attempts: ${err.message}`);
          done({ ok: false });
        }
      });
    };
    poll();
  });
}

// 6. Inline HTML templates for splash screen and visual error reporting
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\//g, '&#x2F;')
    .replace(/`/g, '&#x60;');
}

const SPLASH_HTML = `data:text/html;charset=utf-8,` + encodeURIComponent(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>${escapeHtml(getAppWindowTitle())}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0a111a;
      color: #f5f7fa;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      user-select: none;
    }
    .card {
      text-align: center;
      padding: 36px 48px;
      background: #121d28;
      border: 1px solid #1e3145;
      border-radius: 16px;
      box-shadow: 0 12px 36px rgba(0,0,0,0.45);
      max-width: 460px;
    }
    .spinner {
      width: 42px;
      height: 42px;
      border: 3.5px solid #1e3145;
      border-top-color: #2481cc;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 20px auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 { font-size: 18px; font-weight: 600; color: #f5f7fa; margin-bottom: 8px; }
    p { font-size: 13px; color: #7f93a5; line-height: 1.6; }
    .badge {
      display: inline-block;
      margin-top: 16px;
      font-size: 11px;
      color: #2481cc;
      background: rgba(36,129,204,0.12);
      padding: 4px 12px;
      border-radius: 20px;
      border: 1px solid rgba(36,129,204,0.25);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>HumanSense 客户端启动中</h2>
    <p>正在初始化本地加密通信与数据引擎，请稍候片刻...</p>
    <div class="badge">本地数据与凭据加密引擎已就绪</div>
  </div>
</body>
</html>
`);

function renderErrorHtml(title, errorMsg, stack = '') {
  const safeTitle = escapeHtml(title);
  const safeErrorMsg = escapeHtml(errorMsg);
  const safeStack = escapeHtml(stack);
  const safeLogPath = escapeHtml(getLogFilePath());
  const retryPort = Number.isInteger(currentPort) && currentPort > 0 && currentPort <= 65535 ? currentPort : FIXED_APP_PORT;

  return `data:text/html;charset=utf-8,` + encodeURIComponent(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>启动异常 - HumanSense</title>
  <style>
    body {
      background: #0a111a;
      color: #f5f7fa;
      font-family: Consolas, monospace;
      padding: 30px;
      line-height: 1.5;
    }
    h2 { color: #ff5252; font-size: 20px; margin-bottom: 15px; }
    .box {
      background: #18222d;
      border: 1px solid #ff5252;
      border-radius: 8px;
      padding: 20px;
      white-space: pre-wrap;
      word-break: break-all;
      color: #ffb4b4;
      font-size: 13px;
      max-height: 65vh;
      overflow-y: auto;
    }
    .hint {
      margin-top: 15px;
      font-size: 12px;
      color: #7f93a5;
    }
    .btn {
      display: inline-block;
      margin-top: 16px;
      background: #2481cc;
      color: white;
      text-decoration: none;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
    }
    .btn:hover { background: #1a6fb0; }
  </style>
</head>
<body>
  <h2>⚠️ ${safeTitle}</h2>
  <div class="box">${safeErrorMsg}${safeStack ? `\n\n${safeStack}` : ''}</div>
  <p class="hint">详细日志已保存至: ${safeLogPath}</p>
  <a class="btn" href="http://127.0.0.1:${retryPort}/">重新载入</a>
</body>
</html>
`);
}

// 7. Load backend in main process
async function startBackendServer(port) {
  const appPath = __dirname;
  let scriptPath = path.join(appPath, 'dist', 'server.js');
  const isCompiled = fs.existsSync(scriptPath);
  if (!isCompiled) {
    scriptPath = path.join(appPath, 'server.ts');
  }

  const userDataDir = path.join(app.getPath('userData'), 'data');

  // CRITICAL: NEVER set ELECTRON_RUN_AS_NODE in main process!
  delete process.env.ELECTRON_RUN_AS_NODE;
  process.env.NODE_ENV = 'production';
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  process.env.DATA_DIR = userDataDir;

  writeLog('info', `Starting backend server on 127.0.0.1:${port}`);
  writeLog('info', `Backend script path: ${scriptPath}`);
  writeLog('info', `User data directory: ${userDataDir}`);

  if (isCompiled) {
    // Production: Load precompiled server in main process
    try {
      writeLog('info', `Importing compiled backend: ${pathToFileURL(scriptPath).href}`);
      await import(pathToFileURL(scriptPath).href);
      writeLog('info', 'Compiled backend imported successfully in main process');
    } catch (err) {
      writeLog('fatal', `Failed to import backend server: ${err.message}`, err.stack);
      throw err;
    }
  } else {
    const { spawn } = require('child_process');
    const isWin = process.platform === 'win32';
    const localTsx = path.join(appPath, 'node_modules', '.bin', isWin ? 'tsx.cmd' : 'tsx');
    const hasLocalTsx = fs.existsSync(localTsx);
    const cmd = hasLocalTsx ? localTsx : isWin ? 'npx.cmd' : 'npx';
    const rawArgs = hasLocalTsx ? [scriptPath] : ['tsx', scriptPath];
    const quoteWinArg = (arg) => (/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
    const spawnCmd = isWin ? quoteWinArg(cmd) : cmd;
    const spawnArgs = isWin ? rawArgs.map(quoteWinArg) : rawArgs;

    backendChild = spawn(spawnCmd, spawnArgs, {
      cwd: appPath,
      env: process.env,
      stdio: 'pipe',
      shell: isWin,
      windowsHide: true,
    });
    backendChild.stdout?.on('data', (d) => writeLog('backend', d.toString().trim()));
    backendChild.stderr?.on('data', (d) => writeLog('backend-err', d.toString().trim()));
    backendChild.on('error', (err) => writeLog('error', `Failed to spawn tsx: ${err.message}`));
    backendChild.on('exit', () => {
      backendChild = null;
    });
  }
}

async function createWindow() {
  const windowTitle = getAppWindowTitle();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    title: windowTitle,
    icon: resolveAppIcon(),
    backgroundColor: '#0a111a',
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'electron', 'preload.cjs'),
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.on('page-title-updated', (event, nextTitle) => {
    const expected = getAppWindowTitle();
    if (nextTitle !== expected) {
      event.preventDefault();
      if (!mainWindow.isDestroyed()) mainWindow.setTitle(expected);
    }
  });

  // Show splash immediately
  mainWindow.loadURL(SPLASH_HTML);

  // DevTools Shortcuts (Enabled in dev or when explicitly passed --devtools / LX_ENABLE_DEVTOOLS=1)
  const allowDevTools =
    !app.isPackaged ||
    process.argv.includes('--devtools') ||
    process.env.LX_ENABLE_DEVTOOLS === '1';
  if (allowDevTools) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' || (input.control && input.shift && (input.key === 'I' || input.key === 'i'))) {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  // Track renderer crashes or load failures
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeLog('fatal', `Renderer process gone: ${details.reason} (exitCode: ${details.exitCode})`);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    writeLog('warn', `did-fail-load on ${validatedURL}: [${errorCode}] ${errorDescription}`);
  });

  // Open external links safely in OS default browser instead of empty Electron popups
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(`http://127.0.0.1:${FIXED_APP_PORT}`)) {
      shell.openExternal(url).catch((err) => writeLog('warn', `Failed to open external URL ${url}: ${err.message}`));
    }
    return { action: 'deny' };
  });

  // Ensure fixed port 38271 and start
  try {
    currentPort = await ensureFixedPortAvailable(FIXED_APP_PORT);
    writeLog('info', `Verified fixed port available: ${currentPort}`);

    await startBackendServer(currentPort);

    const healthUrl = `http://127.0.0.1:${currentPort}/api/health`;
    const healthRes = await waitForHealth200(healthUrl, 120, 250);
    const isHealthy = Boolean(healthRes && healthRes.ok);

    // Smoke Test mode (used by CI to verify startup)
    if (process.argv.includes('--smoke-test')) {
      if (isHealthy) {
        writeLog('info', 'SMOKE_TEST_SUCCESS: Backend health check returned 200');
        setTimeout(() => process.exit(0), 200);
        return;
      } else {
        writeLog('fatal', `SMOKE_TEST_FAILED: ${healthRes?.fatalError || 'Backend failed to become healthy'}`);
        setTimeout(() => process.exit(1), 200);
        return;
      }
    }

    if (isHealthy && mainWindow && !mainWindow.isDestroyed()) {
      writeLog('info', `Navigating window to http://127.0.0.1:${currentPort}`);
      mainWindow.setTitle(windowTitle);
      mainWindow.loadURL(`http://127.0.0.1:${currentPort}`);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      const msg = healthRes?.fatalError
        ? `本地数据与服务引擎初始化失败：${healthRes.fatalError}`
        : `后台服务启动超时：未能于 127.0.0.1:${currentPort}/api/health 取得正常状态响应。`;
      writeLog('error', msg);
      mainWindow.loadURL(renderErrorHtml(healthRes?.fatalError ? '本地引擎初始化失败' : '服务启动超时', msg));
      dialog.showErrorBox('HumanSense 启动失败', `${msg}\n请查看日志文件: ${getLogFilePath()}`);
    }
  } catch (err) {
    writeLog('fatal', `Fatal error during startup: ${err.message}`, err.stack);

    if (process.argv.includes('--smoke-test')) {
      app.exit(1);
      return;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(renderErrorHtml('主进程异常崩溃', err.message, err.stack));
    }
    dialog.showErrorBox(
      'HumanSense 致命启动错误',
      `服务启动异常:\n${err.message}\n\n${err.stack || ''}\n\n日志路径:\n${getLogFilePath()}`
    );
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 8. In-App Desktop Auto-Updater (NSIS electron-updater + Windows Portable self-updater)
const updaterRuntime = {
  state: { status: 'idle', mode: 'unsupported', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
  engine: 'none',
  autoUpdater: null,
  cancellationToken: null,
  activeRequest: null,
  downloadedFilePath: null,
  downloadedIntegrity: null,
  initialized: false,
};

function getDesktopUpdaterInfo() {
  const portableExePath = process.env.PORTABLE_EXECUTABLE_FILE ? String(process.env.PORTABLE_EXECUTABLE_FILE).trim() : '';
  const isPortable = Boolean(portableExePath);
  const hasNsisConfig = Boolean(
    app.isPackaged &&
    !isPortable &&
    process.resourcesPath &&
    fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))
  );
  if (!app.isPackaged) {
    return { isElectron: true, supported: false, mode: 'unsupported', engine: 'none', portableExePath: '' };
  }
  if (hasNsisConfig) {
    return { isElectron: true, supported: true, mode: 'nsis', engine: 'electron-updater', portableExePath: '' };
  }
  if (isPortable) {
    return { isElectron: true, supported: true, mode: 'portable', engine: 'direct-download', portableExePath };
  }
  return { isElectron: true, supported: true, mode: 'nsis', engine: 'direct-download', portableExePath: '' };
}

function broadcastUpdaterState(patch) {
  updaterRuntime.state = { ...updaterRuntime.state, ...patch };
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('hs-updater:state', updaterRuntime.state);
    }
  } catch {}
}

function getConfiguredUpdateRepo() {
  try {
    const pkgPath = path.join(__dirname, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const pub = Array.isArray(pkg?.build?.publish) ? pkg.build.publish[0] : pkg?.build?.publish;
      if (pub?.owner && pub?.repo) {
        return `${String(pub.owner).trim()}/${String(pub.repo).trim()}`;
      }
    }
  } catch {}
  return '1988221as-cpu/telegram-aiapp';
}

function isAllowedUpdateDownloadUrl(rawUrl, options = {}) {
  try {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
    const u = new URL(rawUrl.trim());
    if (u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    if (options.isRedirect) {
      return (
        host === 'github.com' ||
        host === 'objects.githubusercontent.com' ||
        host === 'release-assets.githubusercontent.com' ||
        host === 'github-releases.githubusercontent.com' ||
        host.endsWith('.githubusercontent.com')
      );
    }
    if (host !== 'github.com') return false;
    const expectedRepo = (options.expectedRepo || getConfiguredUpdateRepo()).toLowerCase();
    const normalizedPath = u.pathname.toLowerCase();
    return normalizedPath.startsWith(`/${expectedRepo}/releases/`);
  } catch {
    return false;
  }
}

function deriveLatestYmlUrlFromDownloadUrl(downloadUrl, explicitLatestYmlUrl) {
  if (explicitLatestYmlUrl && isAllowedUpdateDownloadUrl(explicitLatestYmlUrl)) {
    try {
      const explicitUrl = new URL(explicitLatestYmlUrl.trim());
      if (/\/latest\.yml$/i.test(explicitUrl.pathname)) {
        return explicitUrl.toString();
      }
    } catch {}
  }
  const u = new URL(downloadUrl.trim());
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length >= 6 && parts[2] === 'releases' && parts[3] === 'download') {
    return `${u.origin}/${parts[0]}/${parts[1]}/releases/download/${parts[4]}/latest.yml`;
  }
  if (parts.length >= 5 && parts[2] === 'releases' && parts[3] === 'latest' && parts[4] === 'download') {
    return `${u.origin}/${parts[0]}/${parts[1]}/releases/latest/download/latest.yml`;
  }
  return '';
}

function parseLatestYmlAssets(ymlText) {
  const text = String(ymlText || '');
  const stripQuotes = (v) => String(v || '').trim().replace(/^['"]|['"]$/g, '');
  const versionMatch = text.match(/^version:\s*(.+)$/m);
  const topPathMatch = text.match(/^path:\s*(.+)$/m);
  const topShaMatch = text.match(/^sha512:\s*(.+)$/m);
  const files = [];

  const lines = text.split(/\r?\n/);
  let inFiles = false;
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (/^files:\s*$/.test(line)) {
      inFiles = true;
      continue;
    }
    if (inFiles && /^[A-Za-z0-9_-]+:\s*/.test(line)) {
      if (current && current.url) files.push(current);
      current = null;
      inFiles = false;
      continue;
    }
    if (!inFiles) continue;
    const itemUrl = line.match(/^\s*-\s*url:\s*(.+)$/);
    if (itemUrl) {
      if (current && current.url) files.push(current);
      current = { url: stripQuotes(itemUrl[1]), sha512: '', size: 0 };
      continue;
    }
    if (!current) continue;
    const shaMatch = line.match(/^\s+sha512:\s*(.+)$/);
    if (shaMatch) current.sha512 = stripQuotes(shaMatch[1]);
    const sizeMatch = line.match(/^\s+size:\s*(\d+)\s*$/);
    if (sizeMatch) current.size = Number(sizeMatch[1]) || 0;
  }
  if (current && current.url) files.push(current);

  if (topPathMatch && topShaMatch) {
    const topUrl = stripQuotes(topPathMatch[1]);
    const topSha = stripQuotes(topShaMatch[1]);
    if (!files.some((f) => f.url.toLowerCase() === topUrl.toLowerCase())) {
      files.push({ url: topUrl, sha512: topSha, size: 0 });
    }
  }
  return { version: versionMatch ? stripQuotes(versionMatch[1]) : '', files };
}

function findExpectedAssetIntegrity(ymlMeta, candidateNames) {
  const safeDecode = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const names = (candidateNames || [])
    .map((n) => safeDecode(String(n || '').trim()).toLowerCase())
    .filter(Boolean);
  for (const entry of ymlMeta?.files || []) {
    const entryName = safeDecode(path.posix.basename(String(entry.url || '').trim())).toLowerCase();
    if (!entryName || !names.includes(entryName)) continue;
    const decoded = Buffer.from(String(entry.sha512 || '').trim(), 'base64');
    if (decoded.length === 64) {
      return { url: entry.url, sha512: String(entry.sha512).trim(), size: Number(entry.size || 0) };
    }
  }
  return null;
}

function downloadTextWithAllowedRedirects(targetUrl, maxBytes = 1024 * 1024) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    let redirects = 0;
    const runReq = (urlStr, isRedirect = false) => {
      if (!isAllowedUpdateDownloadUrl(urlStr, { isRedirect })) {
        return reject(new Error('latest.yml 地址不在受信任的 GitHub 仓库范围内'));
      }
      const req = https.get(
        urlStr,
        { headers: { 'User-Agent': 'HumanSense-Updater', Accept: 'text/yaml,text/plain,*/*' } },
        (res) => {
          const status = Number(res.statusCode || 0);
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (redirects >= 6) return reject(new Error('latest.yml 重定向次数过多'));
            redirects += 1;
            return runReq(new URL(res.headers.location, urlStr).toString(), true);
          }
          if (status < 200 || status >= 300) {
            res.resume();
            return reject(new Error(`拉取 latest.yml 元数据失败 (HTTP ${status})`));
          }
          const chunks = [];
          let total = 0;
          res.on('data', (chunk) => {
            total += chunk.length;
            if (total > maxBytes) {
              res.destroy();
              return reject(new Error('latest.yml 元数据体积超出安全限制'));
            }
            chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        }
      );
      req.setTimeout(15000, () => req.destroy(new Error('拉取 latest.yml 元数据超时')));
      req.on('error', reject);
    };
    runReq(targetUrl, false);
  });
}

function verifyFileSha512(filePath, expectedBase64Sha512, expectedSize = 0) {
  return new Promise((resolve, reject) => {
    try {
      const expectedBuf = Buffer.from(String(expectedBase64Sha512 || '').trim(), 'base64');
      if (expectedBuf.length !== 64) {
        return reject(new Error('更新元数据 SHA-512 摘要格式无效'));
      }
      const stat = fs.statSync(filePath);
      if (expectedSize > 0 && stat.size !== expectedSize) {
        return reject(new Error(`安装包大小校验失败 (期望 ${expectedSize} 字节，实际 ${stat.size} 字节)`));
      }
      const hash = crypto.createHash('sha512');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', (err) => reject(err));
      stream.on('end', () => {
        const actualBuf = hash.digest();
        if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
          return reject(new Error('安装包 SHA-512 完整性校验失败，文件可能已损坏或被篡改'));
        }
        resolve({ sha512: actualBuf.toString('base64'), size: stat.size });
      });
    } catch (err) {
      reject(err);
    }
  });
}

function verifyWindowsAuthenticodeSignature(filePath, currentExePath) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      return reject(new Error('仅支持在 Windows 平台执行 Authenticode 数字签名验证'));
    }
    const { execFile } = require('child_process');
    const psScript = [
      '$ErrorActionPreference = "Stop";',
      '$target = Get-AuthenticodeSignature -LiteralPath $env:HS_VERIFY_TARGET_EXE;',
      '$cur = $null;',
      'if ($env:HS_VERIFY_CURRENT_EXE -and (Test-Path -LiteralPath $env:HS_VERIFY_CURRENT_EXE)) { $cur = Get-AuthenticodeSignature -LiteralPath $env:HS_VERIFY_CURRENT_EXE; }',
      '$out = @{',
      '  targetStatus = [string]$target.Status;',
      '  targetThumbprint = if ($target.SignerCertificate) { [string]$target.SignerCertificate.Thumbprint } else { "" };',
      '  targetSubject = if ($target.SignerCertificate) { [string]$target.SignerCertificate.Subject } else { "" };',
      '  currentStatus = if ($cur) { [string]$cur.Status } else { "" };',
      '  currentThumbprint = if ($cur -and $cur.SignerCertificate) { [string]$cur.SignerCertificate.Thumbprint } else { "" };',
      '};',
      '$out | ConvertTo-Json -Compress',
    ].join(' ');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      {
        timeout: 15000,
        windowsHide: true,
        env: {
          ...process.env,
          HS_VERIFY_TARGET_EXE: filePath,
          HS_VERIFY_CURRENT_EXE: currentExePath || '',
        },
      },
      (err, stdout) => {
        if (err) {
          return reject(new Error(`Authenticode 数字签名验证调用失败: ${err.message}`));
        }
        let parsed;
        try {
          parsed = JSON.parse(String(stdout || '').replace(/^\uFEFF/, '').trim());
        } catch {
          return reject(new Error('Authenticode 数字签名验证输出解析失败'));
        }
        if (parsed.targetStatus === 'NotSigned') {
          if (parsed.currentStatus === 'NotSigned') {
            return resolve(parsed);
          }
          return reject(
            new Error(
              parsed.currentStatus === 'Valid'
                ? '当前主程序已受数字签名保护，已拒绝降级安装未签名的更新包'
                : `无法确认当前主程序签名状态 (${parsed.currentStatus || 'Unknown'})，已拒绝未签名更新包`
            )
          );
        }
        if (parsed.targetStatus !== 'Valid' || !parsed.targetThumbprint) {
          return reject(new Error(`安装包 Authenticode 数字签名异常或不受信任 (${parsed.targetStatus || 'Unknown'})`));
        }
        if (parsed.currentStatus === 'Valid' && parsed.currentThumbprint && parsed.targetThumbprint !== parsed.currentThumbprint) {
          return reject(new Error('安装包数字签名证书指纹与当前受信任主程序不一致，已拒绝更新'));
        }
        resolve(parsed);
      }
    );
  });
}

function downloadUpdateFileWithProgress(downloadUrl, destFilePath, onProgress) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    let settled = false;
    let redirects = 0;
    const tmpPath = `${destFilePath}.tmp`;
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}

    const finishError = (err) => {
      if (settled) return;
      settled = true;
      updaterRuntime.activeRequest = null;
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {}
      reject(err);
    };

    const startRequest = (targetUrl, isRedirect = false) => {
      if (!isAllowedUpdateDownloadUrl(targetUrl, { isRedirect })) {
        finishError(new Error('更新下载地址不在受信任的 GitHub HTTPS 域名范围内'));
        return;
      }
      const req = https.get(
        targetUrl,
        {
          headers: {
            'User-Agent': 'HumanSense-Updater',
            Accept: 'application/octet-stream,*/*',
          },
        },
        (res) => {
          const status = Number(res.statusCode || 0);
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (redirects >= 6) {
              finishError(new Error('下载重定向次数过多'));
              return;
            }
            redirects += 1;
            const nextUrl = new URL(res.headers.location, targetUrl).toString();
            startRequest(nextUrl, true);
            return;
          }
          if (status < 200 || status >= 300) {
            res.resume();
            finishError(new Error(`下载失败 (HTTP ${status})`));
            return;
          }
          const total = Number(res.headers['content-length'] || 0) || 0;
          let transferred = 0;
          let lastEmitAt = 0;
          let lastSampleAt = Date.now();
          let lastSampleBytes = 0;
          let bytesPerSecond = 0;
          const fileStream = fs.createWriteStream(tmpPath);

          res.on('data', (chunk) => {
            transferred += chunk.length;
            const now = Date.now();
            if (now - lastSampleAt >= 500) {
              const dt = (now - lastSampleAt) / 1000;
              bytesPerSecond = dt > 0 ? Math.round((transferred - lastSampleBytes) / dt) : 0;
              lastSampleAt = now;
              lastSampleBytes = transferred;
            }
            if (now - lastEmitAt >= 150 || (total > 0 && transferred >= total)) {
              lastEmitAt = now;
              const percent = total > 0 ? Math.min(100, Number(((transferred / total) * 100).toFixed(1))) : 0;
              onProgress({ percent, transferred, total, bytesPerSecond });
            }
          });

          res.on('error', (err) => {
            fileStream.destroy();
            finishError(err);
          });

          fileStream.on('error', (err) => {
            res.destroy();
            finishError(err);
          });

          fileStream.on('finish', () => {
            fileStream.close(() => {
              if (settled) return;
              try {
                if (fs.existsSync(destFilePath)) fs.unlinkSync(destFilePath);
                fs.renameSync(tmpPath, destFilePath);
                settled = true;
                updaterRuntime.activeRequest = null;
                resolve({ filePath: destFilePath, total: total || transferred });
              } catch (renameErr) {
                finishError(renameErr);
              }
            });
          });

          res.pipe(fileStream);
        }
      );

      req.setTimeout(30000, () => {
        req.destroy(new Error('下载更新包超时，请检查网络连接后重试'));
      });
      req.on('error', (err) => {
        finishError(err);
      });
      updaterRuntime.activeRequest = req;
    };

    startRequest(downloadUrl);
  });
}

function ensureAutoUpdaterInitialized() {
  if (updaterRuntime.autoUpdater) return updaterRuntime.autoUpdater;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = {
    info: (m) => writeLog('updater', String(m)),
    warn: (m) => writeLog('updater-warn', String(m)),
    error: (m) => writeLog('updater-err', String(m)),
    debug: () => {},
  };
  autoUpdater.on('checking-for-update', () => {
    broadcastUpdaterState({ status: 'checking', error: undefined });
  });
  autoUpdater.on('update-available', (info) => {
    broadcastUpdaterState({
      status: updaterRuntime.state.status === 'downloading' ? 'downloading' : 'available',
      version: info?.version || updaterRuntime.state.version,
      error: undefined,
    });
  });
  autoUpdater.on('update-not-available', () => {
    if (updaterRuntime.state.status === 'checking') {
      broadcastUpdaterState({ status: 'idle', error: undefined });
    }
  });
  autoUpdater.on('download-progress', (prog) => {
    broadcastUpdaterState({
      status: 'downloading',
      percent: typeof prog?.percent === 'number' ? Math.min(100, Number(prog.percent.toFixed(1))) : 0,
      transferred: Number(prog?.transferred || 0),
      total: Number(prog?.total || 0),
      bytesPerSecond: Number(prog?.bytesPerSecond || 0),
      error: undefined,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    broadcastUpdaterState({
      status: 'downloaded',
      version: info?.version || updaterRuntime.state.version,
      percent: 100,
      error: undefined,
    });
  });
  autoUpdater.on('error', (err) => {
    const msg = err?.message || '自动更新过程中发生错误';
    if (/cancelled/i.test(msg)) return;
    writeLog('updater-err', msg);
    broadcastUpdaterState({ status: 'error', error: msg });
  });
  updaterRuntime.autoUpdater = autoUpdater;
  return autoUpdater;
}

function registerUpdaterIpcHandlers() {
  if (updaterRuntime.initialized) return;
  updaterRuntime.initialized = true;
  const info = getDesktopUpdaterInfo();
  updaterRuntime.engine = info.engine;
  updaterRuntime.state = {
    ...updaterRuntime.state,
    mode: info.mode,
  };

  ipcMain.handle('hs-updater:get-info', (event) => {
    if (!isAuthorizedCryptoIpcEvent(event)) {
      return { isElectron: true, supported: false, mode: 'unsupported', engine: 'none' };
    }
    const current = getDesktopUpdaterInfo();
    return {
      isElectron: current.isElectron,
      supported: current.supported,
      mode: current.mode,
      engine: current.engine,
    };
  });

  ipcMain.handle('hs-updater:get-state', (event) => {
    if (!isAuthorizedCryptoIpcEvent(event)) {
      return { status: 'idle', mode: 'unsupported' };
    }
    return updaterRuntime.state;
  });

  ipcMain.handle('hs-updater:download', async (event, payload) => {
    if (!isAuthorizedCryptoIpcEvent(event)) {
      return { ok: false, error: '未授权的更新请求' };
    }
    const currentInfo = getDesktopUpdaterInfo();
    if (!currentInfo.supported) {
      return { ok: false, error: '当前非打包桌面客户端，请使用浏览器下载更新包' };
    }
    if (updaterRuntime.state.status === 'downloading' || updaterRuntime.state.status === 'installing') {
      return { ok: true, state: updaterRuntime.state };
    }
    if (updaterRuntime.state.status === 'downloaded') {
      return { ok: true, state: updaterRuntime.state };
    }

    const targetVersion = typeof payload?.version === 'string' ? payload.version.trim() : undefined;

    if (currentInfo.engine === 'electron-updater') {
      try {
        const autoUpdater = ensureAutoUpdaterInitialized();
        const { CancellationToken } = require('electron-updater');
        broadcastUpdaterState({
          status: 'checking',
          mode: currentInfo.mode,
          version: targetVersion,
          percent: 0,
          transferred: 0,
          total: 0,
          bytesPerSecond: 0,
          error: undefined,
        });
        const checkRes = await autoUpdater.checkForUpdates();
        if (!checkRes || !checkRes.updateInfo) {
          throw new Error('未在 GitHub Releases 检测到更新元数据 (latest.yml)');
        }
        const token = new CancellationToken();
        updaterRuntime.cancellationToken = token;
        broadcastUpdaterState({
          status: 'downloading',
          mode: currentInfo.mode,
          version: checkRes.updateInfo.version || targetVersion,
          percent: 0,
          error: undefined,
        });
        await autoUpdater.downloadUpdate(token);
        updaterRuntime.cancellationToken = null;
        return { ok: true, state: updaterRuntime.state };
      } catch (err) {
        updaterRuntime.cancellationToken = null;
        const msg = err?.message || '自动更新下载失败';
        if (/cancelled/i.test(msg)) {
          broadcastUpdaterState({ status: 'idle', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, error: undefined });
          return { ok: false, cancelled: true };
        }
        writeLog('updater-err', `electron-updater download failed: ${msg}`);
        broadcastUpdaterState({ status: 'error', error: msg });
        return { ok: false, error: msg };
      }
    }

    // Portable or direct-download fallback engine
    const downloadUrl =
      currentInfo.mode === 'portable'
        ? payload?.portableDownloadUrl || payload?.downloadUrl
        : payload?.installerDownloadUrl || payload?.downloadUrl;
    if (!isAllowedUpdateDownloadUrl(downloadUrl)) {
      const msg = '未获取到有效的受信任 GitHub 仓库安装包下载地址';
      broadcastUpdaterState({ status: 'error', error: msg });
      return { ok: false, error: msg };
    }
    const latestYmlUrl = deriveLatestYmlUrlFromDownloadUrl(downloadUrl, payload?.latestYmlUrl);
    if (!latestYmlUrl || !isAllowedUpdateDownloadUrl(latestYmlUrl)) {
      const msg = '未获取到有效的受信任 latest.yml 更新校验元数据地址';
      broadcastUpdaterState({ status: 'error', error: msg });
      return { ok: false, error: msg };
    }

    try {
      const updatesDir = path.join(app.getPath('userData'), 'pending-updates');
      fs.mkdirSync(updatesDir, { recursive: true });
      const rawName = String(
        (currentInfo.mode === 'portable' ? payload?.portableAssetName : payload?.installerAssetName) ||
        payload?.assetName ||
        `HumanSense-${targetVersion || 'latest'}.exe`
      ).replace(/[^A-Za-z0-9._-]/g, '_');
      const safeFileName = rawName.toLowerCase().endsWith('.exe') ? rawName : `${rawName}.exe`;
      const destPath = path.join(updatesDir, safeFileName);

      updaterRuntime.downloadedFilePath = null;
      updaterRuntime.downloadedIntegrity = null;
      broadcastUpdaterState({
        status: 'checking',
        mode: currentInfo.mode,
        version: targetVersion,
        percent: 0,
        transferred: 0,
        total: 0,
        bytesPerSecond: 0,
        error: undefined,
      });

      const ymlText = await downloadTextWithAllowedRedirects(latestYmlUrl);
      const ymlMeta = parseLatestYmlAssets(ymlText);
      const urlAssetName = path.posix.basename(new URL(downloadUrl).pathname);
      const expectedIntegrity = findExpectedAssetIntegrity(ymlMeta, [
        currentInfo.mode === 'portable' ? payload?.portableAssetName : payload?.installerAssetName,
        payload?.assetName,
        urlAssetName,
        safeFileName,
      ]);
      if (!expectedIntegrity) {
        throw new Error(`latest.yml 中缺少目标安装包 (${urlAssetName}) 的有效 SHA-512 校验摘要，已拒绝更新`);
      }

      broadcastUpdaterState({
        status: 'downloading',
        mode: currentInfo.mode,
        version: targetVersion,
        percent: 0,
        transferred: 0,
        total: expectedIntegrity.size || 0,
        bytesPerSecond: 0,
        error: undefined,
      });

      const dlResult = await downloadUpdateFileWithProgress(downloadUrl, destPath, (prog) => {
        broadcastUpdaterState({
          status: 'downloading',
          percent: prog.percent,
          transferred: prog.transferred,
          total: prog.total,
          bytesPerSecond: prog.bytesPerSecond,
          error: undefined,
        });
      });

      try {
        await verifyFileSha512(dlResult.filePath, expectedIntegrity.sha512, expectedIntegrity.size);
        await verifyWindowsAuthenticodeSignature(
          dlResult.filePath,
          currentInfo.portableExePath || process.execPath
        );
      } catch (verifyErr) {
        try {
          if (fs.existsSync(dlResult.filePath)) fs.unlinkSync(dlResult.filePath);
        } catch {}
        throw verifyErr;
      }

      updaterRuntime.downloadedFilePath = dlResult.filePath;
      updaterRuntime.downloadedIntegrity = expectedIntegrity;
      broadcastUpdaterState({
        status: 'downloaded',
        percent: 100,
        transferred: dlResult.total,
        total: dlResult.total,
        bytesPerSecond: 0,
        error: undefined,
      });
      return { ok: true, state: updaterRuntime.state };
    } catch (err) {
      const msg = err?.message || '下载更新包失败';
      if (/aborted|cancelled|destroy/i.test(msg) && updaterRuntime.state.status === 'idle') {
        return { ok: false, cancelled: true };
      }
      writeLog('updater-err', `direct download failed: ${msg}`);
      broadcastUpdaterState({ status: 'error', error: msg });
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('hs-updater:cancel', (event) => {
    if (!isAuthorizedCryptoIpcEvent(event)) return { ok: false };
    try {
      if (updaterRuntime.cancellationToken) {
        updaterRuntime.cancellationToken.cancel();
        updaterRuntime.cancellationToken = null;
      }
      if (updaterRuntime.activeRequest) {
        const req = updaterRuntime.activeRequest;
        updaterRuntime.activeRequest = null;
        broadcastUpdaterState({ status: 'idle', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, error: undefined });
        req.destroy(new Error('cancelled'));
      } else {
        broadcastUpdaterState({ status: 'idle', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, error: undefined });
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('hs-updater:install', async (event) => {
    if (!isAuthorizedCryptoIpcEvent(event)) {
      return { ok: false, error: '未授权的安装请求' };
    }
    if (updaterRuntime.state.status === 'installing') {
      return { ok: true };
    }
    if (updaterRuntime.state.status !== 'downloaded') {
      return { ok: false, error: '更新包尚未下载完成' };
    }

    const currentInfo = getDesktopUpdaterInfo();
    broadcastUpdaterState({ status: 'installing', error: undefined });

    try {
      isQuitting = true;
      await cleanupBackendResources();

      if (currentInfo.engine === 'electron-updater' && updaterRuntime.autoUpdater) {
        writeLog('info', 'Triggering electron-updater quitAndInstall(false, true)...');
        setImmediate(() => {
          try {
            updaterRuntime.autoUpdater.quitAndInstall(false, true);
          } catch (e) {
            writeLog('error', `quitAndInstall failed: ${e.message}`);
            app.exit(1);
          }
        });
        return { ok: true };
      }

      const downloadedPath = updaterRuntime.downloadedFilePath;
      const expectedIntegrity = updaterRuntime.downloadedIntegrity;
      if (!downloadedPath || !fs.existsSync(downloadedPath) || !expectedIntegrity?.sha512) {
        isQuitting = false;
        const msg = '更新安装包文件不存在或缺少完整性摘要，请重新下载';
        broadcastUpdaterState({ status: 'error', error: msg });
        return { ok: false, error: msg };
      }

      try {
        await verifyFileSha512(downloadedPath, expectedIntegrity.sha512, expectedIntegrity.size);
        await verifyWindowsAuthenticodeSignature(
          downloadedPath,
          currentInfo.portableExePath || process.execPath
        );
      } catch (reverifyErr) {
        isQuitting = false;
        try {
          if (fs.existsSync(downloadedPath)) fs.unlinkSync(downloadedPath);
        } catch {}
        updaterRuntime.downloadedFilePath = null;
        updaterRuntime.downloadedIntegrity = null;
        const msg = reverifyErr?.message || '安装前安装包完整性或数字签名复验失败';
        broadcastUpdaterState({ status: 'error', error: msg });
        return { ok: false, error: msg };
      }

      const { spawn } = require('child_process');
      if (process.platform === 'win32' && currentInfo.mode === 'portable' && currentInfo.portableExePath) {
        const os = require('os');
        const scriptPath = path.join(os.tmpdir(), `hs_portable_swap_${Date.now()}.cmd`);
        const swapFailMarker = path.join(app.getPath('userData'), 'logs', 'portable_swap_failed.txt');
        try {
          if (fs.existsSync(swapFailMarker)) fs.unlinkSync(swapFailMarker);
        } catch {}
        const cmdBody = [
          '@echo off',
          'chcp 65001 >nul',
          'setlocal',
          'set /a tries=0',
          ':waitloop',
          'set /a tries+=1',
          'timeout /t 1 /nobreak >nul',
          'copy /y "%HS_SRC_EXE%" "%HS_DST_EXE%.new" >nul 2>&1',
          'if errorlevel 1 (',
          '  if %tries% lss 30 goto waitloop',
          '  echo Portable swap copy failed after 30s: "%HS_SRC_EXE%" -> "%HS_DST_EXE%" > "%HS_SWAP_FAIL_MARKER%"',
          '  start "" "%HS_SRC_EXE%"',
          '  goto cleanup',
          ')',
          'move /y "%HS_DST_EXE%.new" "%HS_DST_EXE%" >nul 2>&1',
          'if errorlevel 1 (',
          '  if %tries% lss 30 goto waitloop',
          '  del /f /q "%HS_DST_EXE%.new" >nul 2>&1',
          '  echo Portable swap move failed after 30s: "%HS_SRC_EXE%" -> "%HS_DST_EXE%" > "%HS_SWAP_FAIL_MARKER%"',
          '  start "" "%HS_SRC_EXE%"',
          '  goto cleanup',
          ')',
          'del /f /q "%HS_SRC_EXE%" >nul 2>&1',
          'start "" "%HS_DST_EXE%"',
          ':cleanup',
          'del /f /q "%~f0" >nul 2>&1',
        ].join('\r\n');
        fs.writeFileSync(scriptPath, cmdBody, 'utf8');
        const child = spawn('cmd.exe', ['/d', '/c', scriptPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: {
            ...process.env,
            HS_SRC_EXE: downloadedPath,
            HS_DST_EXE: currentInfo.portableExePath,
            HS_SWAP_FAIL_MARKER: swapFailMarker,
          },
        });
        child.unref();
        writeLog('info', `Scheduled portable self-update swap -> ${currentInfo.portableExePath}`);
        setTimeout(() => app.exit(0), 150);
        return { ok: true };
      }

      // Direct-download NSIS installer fallback
      const child = spawn(downloadedPath, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      setTimeout(() => app.exit(0), 150);
      return { ok: true };
    } catch (err) {
      isQuitting = false;
      const msg = err?.message || '启动更新安装失败';
      writeLog('updater-err', `installNow failed: ${msg}`);
      broadcastUpdaterState({ status: 'error', error: msg });
      return { ok: false, error: msg };
    }
  });
}

app.whenReady().then(() => {
  registerCryptoIpcHandlers();
  registerUpdaterIpcHandlers();
  try {
    const swapFailMarker = path.join(app.getPath('userData'), 'logs', 'portable_swap_failed.txt');
    if (fs.existsSync(swapFailMarker)) {
      const detail = fs.readFileSync(swapFailMarker, 'utf8').trim();
      fs.unlinkSync(swapFailMarker);
      writeLog('warn', `Detected previous portable update swap failure: ${detail}`);
      setTimeout(() => {
        dialog.showMessageBox({
          type: 'warning',
          title: '便携版自动覆盖提示',
          message: '新版本已启动，但未能自动替换原位置的旧版程序文件',
          detail: `${detail}\n\n原因通常是原目录缺少写入权限（如 Program Files）或被杀毒软件锁定。请手动删除旧版 .exe 并将软件放到有读写权限的目录（如桌面或非系统盘），否则下次从原快捷方式启动仍会打开旧版本。`,
        }).catch(() => {});
      }, 1500);
    }
  } catch {}
  return createWindow();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

async function cleanupBackendResources() {
  try {
    if (typeof globalThis.__humansenseGracefulShutdown === 'function') {
      writeLog('info', 'Running in-process backend graceful shutdown...');
      await Promise.race([
        globalThis.__humansenseGracefulShutdown('electron-before-quit'),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    }
  } catch (err) {
    writeLog('warn', `Error during graceful backend shutdown: ${err.message}`);
  }

  if (backendChild && !backendChild.killed && backendChild.pid) {
    try {
      writeLog('info', `Terminating spawned backend child pid=${backendChild.pid}`);
      if (process.platform === 'win32') {
        const { execFileSync } = require('child_process');
        execFileSync('taskkill', ['/pid', String(backendChild.pid), '/t', '/f'], { stdio: 'ignore' });
      } else {
        backendChild.kill('SIGTERM');
      }
    } catch (err) {
      writeLog('warn', `Failed to kill backendChild: ${err.message}`);
    }
    backendChild = null;
  }
}

app.on('before-quit', async (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  await cleanupBackendResources();
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
