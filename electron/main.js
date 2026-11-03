'use strict';
// Virtual Debond desktop shell.
// The whole app lives in index.html; this process gives it a window, native menus and file dialogs,
// serves it from its own app:// origin (so it works offline and keeps its batch storage), opens STL
// files passed on the command line or dropped on the dock icon, and asks before closing on unexported work.
const { app, BrowserWindow, dialog, ipcMain, Menu, shell, protocol, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const ROOT = path.join(__dirname, '..');
const GITHUB = 'https://github.com/shiraz-78/Orthobracketremover';
const isMac = process.platform === 'darwin';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// ---------------------------------------------------------------- small persisted settings
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { bounds: null, maximized: false, lastDir: null };
function loadSettings() { try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch (_) {} }
function saveSettings() { try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (_) {} }
function rememberDir(p) { if (p) { settings.lastDir = fs.statSync(p).isDirectory() ? p : path.dirname(p); saveSettings(); } }

// ---------------------------------------------------------------- app:// protocol
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
  "img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'";

function prepareIndex(html) {
  // offline: local fonts instead of Google Fonts; a CSP for the desktop origin
  html = html.replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/i, '<link rel="stylesheet" href="vendor/fonts/fonts.css">');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${meta}`) : meta + html;
}

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      let body = await fsp.readFile(file);
      if (rel === 'index.html') body = Buffer.from(prepareIndex(body.toString('utf8')), 'utf8');
      return new Response(body, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch (_) {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------------------------------------------------------------- window
let win = null, rendererReady = false, dirty = false, forceClose = false;
const pendingOpen = [];   // files to open once the page is ready

function visibleBounds(b) {
  if (!b) return null;
  const area = screen.getDisplayMatching(b).workArea;
  const overlaps = b.x < area.x + area.width - 80 && b.x + b.width > area.x + 80 && b.y < area.y + area.height - 80 && b.y + b.height > area.y;
  return overlaps ? b : null;
}

function createWindow() {
  const b = visibleBounds(settings.bounds);
  win = new BrowserWindow({
    width: b ? b.width : 1440, height: b ? b.height : 900, x: b ? b.x : undefined, y: b ? b.y : undefined,
    minWidth: 980, minHeight: 640, show: false, title: 'Virtual Debond', backgroundColor: '#eef0ec',
    icon: process.platform === 'linux' ? path.join(ROOT, 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
      additionalArguments: process.env.VD_SAMPLE ? ['--vd-sample'] : [],
    },
  });
  if (settings.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://bundle/index.html');

  // keep the app inside its window: links open in the browser, nothing navigates away
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  // a reloaded page starts clean: no files can be delivered until it says it is ready, and nothing is unexported
  win.webContents.on('did-start-loading', () => { rendererReady = false; dirty = false; });

  const keepBounds = () => { if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) settings.bounds = win.getBounds(); };
  win.on('resize', keepBounds); win.on('move', keepBounds);
  win.on('close', async (e) => {
    settings.maximized = win.isMaximized(); saveSettings();
    if (!dirty || forceClose) return;
    e.preventDefault();
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Export…', 'Close without exporting', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true,
      message: 'The scan in the editor has changes that have not been exported.',
      detail: 'Batch results are kept automatically. The scan open in the editor is not.',
    });
    if (response === 0) send('export');
    else if (response === 1) { forceClose = true; win.close(); }
  });
  win.on('closed', () => { win = null; });
}

function send(cmd) { if (win) win.webContents.send('vd:command', cmd); }

// ---------------------------------------------------------------- opening files
async function readStls(paths) {
  const out = [];
  for (const p of paths) {
    try { const bytes = await fsp.readFile(p); out.push({ name: path.basename(p), bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) }); }
    catch (err) { dialog.showErrorBox('Could not open file', `${p}\n\n${err.message}`); }
  }
  return out;
}
async function openPaths(kind, paths) {
  paths = paths.filter((p) => /\.stl$/i.test(p));
  if (!paths.length) return;
  if (!win || !rendererReady) { pendingOpen.push({ kind, paths }); return; }
  const files = await readStls(paths);
  if (files.length) { rememberDir(paths[0]); win.webContents.send('vd:open-files', { kind, files }); }
  if (win.isMinimized()) win.restore();
  win.focus();
}
async function openDialog(kind) {
  if (!win) return;
  const titles = { post: 'Open post-ortho scan', pre: 'Open pre-ortho scan', batch: 'Add scans to the batch (up to six)' };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: titles[kind], defaultPath: settings.lastDir || app.getPath('documents'),
    properties: kind === 'batch' ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [{ name: 'STL mesh', extensions: ['stl'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (!canceled) openPaths(kind, filePaths);
}
const stlArgs = (argv) => argv.slice(1).filter((a) => !a.startsWith('-') && /\.stl$/i.test(a) && fs.existsSync(a));

// ---------------------------------------------------------------- IPC from the page
ipcMain.on('vd:ready', () => {
  rendererReady = true;
  const queued = pendingOpen.splice(0);
  for (const q of queued) openPaths(q.kind, q.paths);
});
ipcMain.on('vd:dirty', (_e, d) => { dirty = !!d; if (win) win.setDocumentEdited && win.setDocumentEdited(dirty); });

ipcMain.handle('save-file', async (event, defaultName, bytes) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(w, {
    title: 'Export STL', defaultPath: path.join(settings.lastDir || app.getPath('documents'), defaultName),
    filters: [{ name: 'STL mesh', extensions: ['stl'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  await fsp.writeFile(filePath, Buffer.from(bytes));
  rememberDir(filePath);
  return { path: filePath };
});
ipcMain.handle('choose-folder', async (event) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(w, { title: 'Save results to…', defaultPath: settings.lastDir || app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] });
  if (canceled || !filePaths.length) return { canceled: true };
  rememberDir(filePaths[0]);
  return { path: filePaths[0] };
});
ipcMain.handle('write-into', async (_event, folder, name, bytes) => {
  const target = path.join(folder, path.basename(name));
  await fsp.writeFile(target, Buffer.from(bytes));
  return { path: target };
});

// ---------------------------------------------------------------- menu
function buildMenu() {
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [
      { label: 'Open Post-ortho Scan…', accelerator: 'CmdOrCtrl+O', click: () => openDialog('post') },
      { label: 'Open Pre-ortho Scan…', accelerator: 'CmdOrCtrl+Shift+O', click: () => openDialog('pre') },
      { label: 'Add Scans to Batch…', accelerator: 'CmdOrCtrl+Shift+B', click: () => openDialog('batch') },
      { type: 'separator' },
      { label: 'Export STL…', accelerator: 'CmdOrCtrl+S', click: () => send('export') },
      { type: 'separator' },
      { label: 'Load Sample Scans', click: () => send('sample') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' },
    ] },
    { label: 'Edit', submenu: [
      // the page handles these keys itself (and leaves them to text boxes); the menu shows them and handles clicks
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: () => send('undo') },
      { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', registerAccelerator: false, click: () => send('redo') },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'Scan', submenu: [
      { label: 'Remove Brackets', accelerator: 'CmdOrCtrl+Enter', click: () => send('remove') },
      { label: 'Show Batch Panel', accelerator: 'CmdOrCtrl+B', click: () => send('batch') },
    ] },
    { label: 'View', submenu: [
      { label: 'Fit Scan', accelerator: 'CmdOrCtrl+Shift+F', click: () => send('fit') },
      { label: 'Front', click: () => send('view-front') },
      { label: 'Occlusal', click: () => send('view-occlusal') },
      { label: 'Left', click: () => send('view-left') },
      { label: 'Right', click: () => send('view-right') },
      { type: 'separator' },
      { role: 'zoomIn', label: 'Larger Interface' }, { role: 'zoomOut', label: 'Smaller Interface' }, { role: 'resetZoom', label: 'Actual Size' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { role: 'reload', accelerator: '' }, { role: 'toggleDevTools' },
    ] },
    { label: 'Help', submenu: [
      { label: 'Project Page', click: () => shell.openExternal(GITHUB) },
      { label: 'Report a Problem', click: () => shell.openExternal(GITHUB + '/issues') },
      ...(isMac ? [] : [{ type: 'separator' }, { label: 'About Virtual Debond', click: () => dialog.showMessageBox(win, {
        type: 'info', title: 'About Virtual Debond', message: `Virtual Debond ${app.getVersion()}`, noLink: true,
        detail: 'Removes orthodontic brackets and cement from intraoral scans and rebuilds the enamel underneath.\n\n' + GITHUB,
      }) }]),
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// automated tests drive the real file-opening and menu paths through this hook (never set in normal use)
if (process.env.VD_TEST) global.__vd = { openPaths, send };

// ---------------------------------------------------------------- lifecycle
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    openPaths('post', stlArgs(argv));
  });
  app.on('open-file', (e, p) => { e.preventDefault(); openPaths('post', [p]); });   // macOS: file dropped on the dock icon

  app.whenReady().then(() => {
    loadSettings();
    app.setAboutPanelOptions && app.setAboutPanelOptions({ applicationName: 'Virtual Debond', applicationVersion: app.getVersion(), website: GITHUB });
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    registerAppProtocol();
    buildMenu();
    createWindow();
    const initial = stlArgs(process.argv.slice(app.isPackaged ? 0 : 1));
    if (initial.length) openPaths('post', initial.slice(0, 1));
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
