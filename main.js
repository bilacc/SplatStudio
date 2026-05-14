import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { startServer } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let localServer;

function getBinDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, 'bin');
}

function toInputItem(filePath) {
  const stats = fsSafeStat(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    kind: stats?.isDirectory() ? 'folder' : 'file',
    size: stats?.isFile() ? stats.size : undefined,
  };
}

function fsSafeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

ipcMain.handle('splatstudio:select-inputs', async (_event, mode = 'files') => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: mode === 'folder' ? 'Select a frame folder' : 'Select images or a video',
    properties: mode === 'folder'
      ? ['openDirectory', 'multiSelections']
      : ['openFile', 'multiSelections'],
    filters: mode === 'folder'
      ? []
      : [
          { name: 'Images and Videos', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'tif', 'tiff', 'webp', 'mp4', 'mov', 'avi', 'mkv', 'm4v', 'webm'] },
          { name: 'All Files', extensions: ['*'] },
        ],
  });

  if (result.canceled) return [];
  return result.filePaths.map(toInputItem);
});

app.whenReady().then(async () => {
  const binDir = getBinDir();

  localServer = await startServer({
    host: '127.0.0.1',
    port: 3000,
    isPackaged: app.isPackaged,
    binDir,
    appDataDir: app.getPath('userData'),
    staticDir: path.join(__dirname, 'dist'),
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 680,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(localServer.url);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (localServer) {
    await localServer.close();
    localServer = null;
  }
});
