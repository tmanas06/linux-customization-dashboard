const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

let win = null;
let prevCpuSample = null;
let lastCpuUsage = null;

const configFile = () => path.join(app.getPath('userData'), 'dashboard-config.json');

const userDataDir = path.join(app.getPath('appData'), 'linux-dashboard');
const legacyDataDir = path.join(app.getPath('appData'), 'Linux Dashboard');
try {
  if (
    !fs.existsSync(path.join(userDataDir, 'dashboard-config.json')) &&
    fs.existsSync(path.join(legacyDataDir, 'dashboard-config.json'))
  ) {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.copyFileSync(
      path.join(legacyDataDir, 'dashboard-config.json'),
      path.join(userDataDir, 'dashboard-config.json')
    );
    console.log('Migrated dashboard config from legacy location');
  }
} catch {}
app.setPath('userData', userDataDir);

function sampleCpu() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const key of Object.keys(cpu.times)) total += cpu.times[key];
    idle += cpu.times.idle;
  }
  if (prevCpuSample) {
    const dt = total - prevCpuSample.total;
    const di = idle - prevCpuSample.idle;
    lastCpuUsage = dt > 0 ? Math.max(0, Math.min(100, (1 - di / dt) * 100)) : 0;
    lastCpuUsage = Math.round(lastCpuUsage * 10) / 10;
  }
  prevCpuSample = { idle, total };
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 850,
    minWidth: 720,
    minHeight: 520,
    transparent: true,
    title: 'Dashboard',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (process.env.DASH_SHOT) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.DASH_SHOT, img.toPNG());
          console.log('SHOT_SAVED');
        } catch (e) {
          console.error('SHOT_FAILED:', e.message);
        }
        app.exit(0);
      }, 3000);
    });
  }
}

function readConfig() {
  try {
    const raw = fs.readFileSync(configFile(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeConfig(data) {
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return true;
}

ipcMain.handle('config:load', () => readConfig());

ipcMain.handle('config:save', (_e, data) => {
  if (!data || typeof data !== 'object') return false;
  return writeConfig(data);
});

ipcMain.handle('stats:get', () => {
  return {
    cpuUsage: lastCpuUsage,
    memTotal: os.totalmem(),
    memFree: os.freemem(),
    uptime: os.uptime(),
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`
  };
});

function gsettingsGet(schema, key) {
  try {
    return execSync(`gsettings get ${schema} ${key}`).toString().trim().replace(/^'|'$/g, '');
  } catch {
    return '';
  }
}

function uriToPath(uri) {
  if (!uri) return '';
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice(7)) : uri;
}

ipcMain.handle('wallpaper:get', () => {
  for (const key of ['picture-uri', 'picture-uri-dark']) {
    try {
      const p = uriToPath(gsettingsGet('org.gnome.desktop.background', key));
      if (!p || !fs.existsSync(p)) continue;
      const ext = path.extname(p).slice(1).toLowerCase();
      const mime = ext === 'png' ? 'image/png'
        : ext === 'webp' ? 'image/webp'
          : ext === 'bmp' ? 'image/bmp'
            : 'image/jpeg';
      const b64 = fs.readFileSync(p).toString('base64');
      return { dataUrl: `data:${mime};base64,${b64}`, file: p };
    } catch {}
  }
  return null;
});

ipcMain.handle('app:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.handle('win:minimize', () => {
  if (win) win.minimize();
  return true;
});

ipcMain.handle('win:maximize', () => {
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});

ipcMain.handle('win:close', () => {
  if (win) win.close();
  return true;
});

const SIDEBAR_DIRS = [
  { key: 'home', name: 'Home' },
  { key: 'documents', name: 'Documents' },
  { key: 'downloads', name: 'Downloads' },
  { key: 'music', name: 'Music' },
  { key: 'pictures', name: 'Pictures' },
  { key: 'videos', name: 'Videos' }
];

ipcMain.handle('sys:dirs', () => {
  const home = os.homedir();
  const out = [];
  for (const d of SIDEBAR_DIRS) {
    const p = d.key === 'home' ? home : path.join(home, d.name);
    try {
      if (fs.existsSync(p)) out.push({ key: d.key, name: d.name, path: p });
    } catch {}
  }
  return out;
});

ipcMain.handle('fs:openPath', (_e, p) => {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
  const allowed = [os.homedir(), '/media', '/mnt', '/run/media'];
  if (!allowed.some((root) => (p === root || p.startsWith(root + path.sep)))) return false;
  shell.openPath(p);
  return true;
});

app.whenReady().then(async () => {
  sampleCpu();
  setInterval(sampleCpu, 1000);
  createWindow();
  try { await win.webContents.session.clearCache(); } catch {}
});

app.on('window-all-closed', () => app.quit());

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
