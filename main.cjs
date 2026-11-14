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
const SPLASH_HTML = `data:text/html;charset=utf-8,` + encodeURIComponent(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>HumanSense</title>
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
  return `data:text/html;charset=utf-8,` + encodeURIComponent(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
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
    button {
      margin-top: 16px;
      background: #2481cc;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
    }
    button:hover { background: #1a6fb0; }
  </style>
</head>
<body>
  <h2>⚠️ ${title}</h2>
  <div class="box">${errorMsg}\n\n${stack}</div>
  <p class="hint">详细日志已保存至: ${getLogFilePath()}</p>
  <button onclick="location.reload()">重新载入</button>
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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    title: 'HumanSense',
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
      mainWindow.setTitle('HumanSense');
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

app.whenReady().then(() => {
  registerCryptoIpcHandlers();
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
