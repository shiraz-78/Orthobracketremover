'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (defaultName, bytes) => ipcRenderer.invoke('save-file', defaultName, bytes),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  writeInto: (folder, name, bytes) => ipcRenderer.invoke('write-into', folder, name, bytes),
});
