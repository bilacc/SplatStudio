import { app, BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let serverProcess;

app.on('ready', () => {
  const isPackaged = app.isPackaged;
  const serverPath = path.join(__dirname, 'server.ts');
  
  const binDir = isPackaged 
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, 'bin');

  const env = { 
    ...process.env, 
    NODE_ENV: isPackaged ? 'production' : 'development',
    BIN_DIR: binDir
  };
  
  if (isPackaged) {
    serverProcess = spawn('node', ['--experimental-strip-types', serverPath], { cwd: __dirname, env });
  } else {
    serverProcess = spawn('npx', ['tsx', serverPath], { cwd: __dirname, env });
  }
  
  serverProcess.stdout.on('data', (data) => console.log(`[Server]: ${data}`));
  serverProcess.stderr.on('data', (data) => console.error(`[Server Error]: ${data}`));

  setTimeout(() => {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    mainWindow.loadURL('http://localhost:3000');
  }, 3000); // Wait for express/vite to start
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});
