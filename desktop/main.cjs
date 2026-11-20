const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let window;
let server;

if (process.env.YINGXING_DESKTOP_DATA_DIR) {
  const directory = path.resolve(process.env.YINGXING_DESKTOP_DATA_DIR);
  fs.mkdirSync(directory, { recursive: true });
  app.setPath('userData', directory);
} else {
  const previousData = ['yingxing-notes', '萤星笔记']
    .map((name) => path.join(app.getPath('appData'), name))
    .find((directory) => fs.existsSync(directory));
  if (previousData) app.setPath('userData', previousData);
}

function launchServer(requestedPort, portFile) {
  return new Promise((resolve, reject) => {
    const entry = path.join(app.getAppPath(), 'server', 'index.js');
    const child = spawn(process.execPath, [entry], {
      cwd: app.isPackaged ? path.dirname(app.getAppPath()) : app.getAppPath(),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(requestedPort),
        YINGXING_DATA_DIR: path.join(app.getPath('userData'), 'data'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    server = child;

    let settled = false;
    let output = '';
    const timer = setTimeout(() => finish(new Error('本机服务启动超时')), 20000);
    function finish(error, url) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        if (!child.killed) child.kill();
        reject(error);
      }
      else resolve(url);
    }
    child.stdout.on('data', (chunk) => {
      output = (output + chunk.toString()).slice(-1000);
      const port = Number(output.match(/Yingxing API listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1]);
      if (port) {
        try {
          fs.writeFileSync(portFile, String(port));
          finish(null, `http://127.0.0.1:${port}/`);
        } catch (error) { finish(error); }
      }
    });
    child.stderr.on('data', () => {});
    child.once('error', (error) => finish(error));
    child.once('exit', () => finish(new Error('本机服务未能启动')));
  });
}

async function startServer() {
  const portFile = path.join(app.getPath('userData'), 'desktop-port.txt');
  let port = 0;
  try {
    const saved = Number(fs.readFileSync(portFile, 'utf8'));
    if (Number.isInteger(saved) && saved >= 1024 && saved <= 65535) port = saved;
  } catch { /* First launch has no saved port. */ }
  try { return await launchServer(port, portFile); }
  catch (error) {
    if (port) return launchServer(0, portFile);
    throw error;
  }
}

async function createWindow() {
  const url = await startServer();
  window = new BrowserWindow({
    width: 1300,
    height: 850,
    minWidth: 320,
    minHeight: 500,
    show: false,
    backgroundColor: '#f4f7f7',
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('https://')) shell.openExternal(target);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  await window.loadURL(url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(createWindow).catch(() => {
    dialog.showErrorBox('源笔记无法启动', '本机服务启动失败。请重新安装，或检查应用数据目录是否可写。');
    app.quit();
  });
  app.on('before-quit', () => {
    if (server && !server.killed) server.kill();
  });
  app.on('window-all-closed', () => app.quit());
}
