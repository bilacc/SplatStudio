const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splatStudio', {
  selectInputs: (mode) => ipcRenderer.invoke('splatstudio:select-inputs', mode),
  selectSplatFile: () => ipcRenderer.invoke('splatstudio:select-splat-file'),
});
