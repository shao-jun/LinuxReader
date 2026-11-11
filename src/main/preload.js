'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('linuxreader', {
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (e) { return file.path || ''; }
  },
  state: () => ipcRenderer.invoke('app:state'),
  info: () => ipcRenderer.invoke('app:info'),
  loadDoc: (name) => ipcRenderer.invoke('doc:load', name),
  saveDoc: (name, data) => ipcRenderer.invoke('doc:save', name, data),

  meta: (id) => ipcRenderer.invoke('book:meta', id),
  saveMeta: (id, meta) => ipcRenderer.invoke('book:meta-save', id, meta),
  annotations: (id) => ipcRenderer.invoke('book:annotations', id),
  saveAnnotations: (id, data) => ipcRenderer.invoke('book:annotations-save', id, data),
  ensureSrc: (id) => ipcRenderer.invoke('book:ensure-src', id),
  removeBook: (id) => ipcRenderer.invoke('book:remove', id),
  importDialog: () => ipcRenderer.invoke('book:import-dialog'),
  importPaths: (paths) => ipcRenderer.invoke('book:import-paths', paths),

  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  syncTest: (cfg) => ipcRenderer.invoke('sync:test', cfg),
  syncRun: (cfg) => ipcRenderer.invoke('sync:run', cfg),
  onSyncProgress: (cb) => ipcRenderer.on('sync:progress', (e, p) => cb(p)),

  ttsSpeak: (text, rate) => ipcRenderer.invoke('tts:speak', text, rate),
  ttsStop: () => ipcRenderer.invoke('tts:stop'),

  win: (action) => ipcRenderer.invoke('win:action', action),
  winState: () => ipcRenderer.invoke('win:state'),
  openDataDir: () => ipcRenderer.invoke('shell:data-dir'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  revealBook: (id) => ipcRenderer.invoke('app:reveal-book', id),

  onBookImported: (cb) => ipcRenderer.on('book:imported', (e, r) => cb(r)),
  onOpenExternal: (cb) => ipcRenderer.on('book:open-external', (e, p) => cb(p)),
  onImportFailed: (cb) => ipcRenderer.on('book:import-failed', (e, m) => cb(m)),
  onWinState: (cb) => ipcRenderer.on('win:state', (e, s) => cb(s)),
  onImportProgress: (cb) => ipcRenderer.on('import:progress', (e, p) => cb(p))
});
