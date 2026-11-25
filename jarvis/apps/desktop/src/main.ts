/**
 * JARVIS — aplicación de escritorio (Electron).
 * Arranca el núcleo dentro del proceso principal, sirve la interfaz desde él y abre
 * una ventana segura (aislada, sin Node, sin navegación externa). Vive en la bandeja.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, safeStorage, session, shell, Notification } from 'electron';
import { loadConfig, startJarvis, type RunningJarvis } from '@jarvis/core';
import { SafeStorageMasterKey } from './master-key';

const USER = { kind: 'user', id: 'owner' } as const;
const SHORTCUT = 'CommandOrControl+Alt+J';

function secureStorageAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // En Linux sin llavero, Electron usa un modo de texto plano: no cuenta como protegido.
  const backend = (safeStorage as unknown as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.();
  return backend !== 'basic_text';
}

let running: RunningJarvis | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const resourcesWeb = () => (app.isPackaged ? path.join(process.resourcesPath, 'web') : path.resolve(__dirname, '../../web/dist'));
const iconPath = () => (app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.resolve(__dirname, '../build/icon.png'));

async function startCore(): Promise<RunningJarvis> {
  const dataDir = path.join(app.getPath('userData'), 'data');
  const webDir = resourcesWeb();
  if (!fs.existsSync(path.join(webDir, 'index.html'))) throw new Error(`No se encuentra la interfaz en ${webDir}. Ejecuta «npm run build» en apps/desktop.`);
  const masterKey = secureStorageAvailable() ? new SafeStorageMasterKey(path.join(dataDir, 'vault.key.enc'), safeStorage) : undefined;
  const base = { JARVIS_DATA_DIR: dataDir, JARVIS_WEB_DIR: webDir, JARVIS_LOG_LEVEL: process.env.JARVIS_LOG_LEVEL ?? 'warn', JARVIS_HOST: '127.0.0.1' };
  try {
    return await startJarvis(loadConfig({ ...base, JARVIS_PORT: process.env.JARVIS_PORT ?? '7777' }), { masterKey, ephemeralToken: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    // Puerto ocupado (p. ej. núcleo independiente abierto): usar uno libre.
    return startJarvis(loadConfig({ ...base, JARVIS_PORT: '0' }), { masterKey, ephemeralToken: true });
  }
}

function sameOrigin(url: string): boolean {
  return !!running && (url === running.url || url.startsWith(`${running.url}/`));
}

function createWindow() {
  if (!running) return;
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'JARVIS',
    backgroundColor: '#050A14',
    show: false,
    autoHideMenuBar: true,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  // Solo se navega dentro de JARVIS; los enlaces externos se abren en el navegador.
  win.webContents.on('will-navigate', (e, url) => {
    if (sameOrigin(url)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
    if (Notification.isSupported() && !trayNoticeShown) {
      trayNoticeShown = true;
      new Notification({ title: 'JARVIS sigue activo', body: `Está en la bandeja del sistema. ${SHORTCUT.replace('CommandOrControl', 'Ctrl')} lo muestra.` }).show();
    }
  });
  void win.loadURL(running.url);
}
let trayNoticeShown = false;

function showWindow() {
  if (!win) createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function buildTray() {
  const image = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip('JARVIS');
  const refresh = () => {
    const lockdown = running?.jarvis.permissions.isLockdown() ?? false;
    tray!.setContextMenu(Menu.buildFromTemplate([
      { label: 'Mostrar JARVIS', click: showWindow },
      { type: 'separator' },
      {
        label: lockdown ? 'Desactivar modo emergencia' : 'Activar modo emergencia',
        click: () => {
          running?.jarvis.permissions.setLockdown(USER, !lockdown);
          if (!lockdown) running?.jarvis.ai.engine.stopAll();
          refresh();
        },
      },
      {
        label: 'Iniciar con Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
      },
      { type: 'separator' },
      { label: 'Salir', click: () => { quitting = true; app.quit(); } },
    ]));
  };
  refresh();
  running?.jarvis.bus.on('emergency.changed', refresh);
  tray.on('click', showWindow);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  // El token del núcleo se entrega solo a la ventana de JARVIS (mismo origen).
  ipcMain.on('jarvis:bootstrap', (e) => {
    const url = e.senderFrame?.url ?? '';
    e.returnValue = sameOrigin(url) && running ? { token: running.token, version: app.getVersion(), platform: process.platform } : null;
  });

  app.whenReady().then(async () => {
    try {
      running = await startCore();
    } catch (err) {
      const { dialog } = await import('electron');
      dialog.showErrorBox('JARVIS no pudo arrancar', err instanceof Error ? err.message : String(err));
      app.exit(1);
      return;
    }
    // Micrófono solo para la propia interfaz; el resto de permisos, denegados.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => cb(permission === 'media' && sameOrigin(details.requestingUrl)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => permission === 'media' && sameOrigin(origin + '/'));

    buildTray();
    globalShortcut.register(SHORTCUT, () => (win?.isVisible() && win.isFocused() ? win.hide() : showWindow()));
    if (!process.argv.includes('--hidden')) createWindow();
  });

  app.on('window-all-closed', () => { /* sigue en la bandeja */ });
  app.on('before-quit', (e) => {
    quitting = true;
    if (!running) return;
    e.preventDefault();
    const r = running;
    running = null;
    globalShortcut.unregisterAll();
    void r.close().finally(() => app.quit());
  });
}
