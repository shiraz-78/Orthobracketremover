'use strict';
// The page talks to the desktop shell only through this small, fixed API.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // native save dialog / folder picker / write into the chosen folder
  saveFile: (defaultName, bytes) => ipcRenderer.invoke('save-file', defaultName, bytes),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  writeInto: (folder, name, bytes) => ipcRenderer.invoke('write-into', folder, name, bytes),
  // menu commands and files opened from outside the page
  onCommand: (cb) => ipcRenderer.on('vd:command', (_e, cmd) => cb(cmd)),
  onOpenFiles: (cb) => ipcRenderer.on('vd:open-files', (_e, payload) => cb(payload)),
  // page state the shell needs: ready for files, and whether there is unexported work
  ready: () => ipcRenderer.send('vd:ready'),
  setDirty: (d) => ipcRenderer.send('vd:dirty', !!d),
  wantSample: process.argv.includes('--vd-sample'),
  platform: process.platform,
});
