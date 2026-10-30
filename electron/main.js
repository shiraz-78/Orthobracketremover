'use strict';
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: 'Virtual Debond',
    backgroundColor: '#eef0ec',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  return win;
}

// Save dialog + write, called from the page through the preload bridge.
ipcMain.handle('save-file', async (event, defaultName, bytes) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save STL', defaultPath: defaultName,
    filters: [{ name: 'STL mesh', extensions: ['stl'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  await fs.writeFile(filePath, Buffer.from(bytes));
  return { path: filePath };
});

// Pick a folder once, then write several files into it (batch "Save all").
ipcMain.handle('choose-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Save results to…', properties: ['openDirectory', 'createDirectory'] });
  if (canceled || !filePaths.length) return { canceled: true };
  return { path: filePaths[0] };
});
ipcMain.handle('write-into', async (event, folder, name, bytes) => {
  const target = path.join(folder, path.basename(name));
  await fs.writeFile(target, Buffer.from(bytes));
  return { path: target };
});

app.whenReady().then(() => {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ role: isMac ? 'close' : 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
