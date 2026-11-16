'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  regenToken: () => ipcRenderer.invoke('token:regen'),
  testAction: (action) => ipcRenderer.invoke('action:test', action),
  pickFile: () => ipcRenderer.invoke('dialog:pickFile'),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  importConfig: () => ipcRenderer.invoke('config:import'),
  setIp: (ip) => ipcRenderer.invoke('net:setIp', ip),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  openPhone: () => ipcRenderer.invoke('phone:open'),
  exportProfile: (d) => ipcRenderer.invoke('profile:export', d),
  importProfile: () => ipcRenderer.invoke('profile:import'),
  mousePos: () => ipcRenderer.invoke('mouse:pos'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  getLog: () => ipcRenderer.invoke('log:get'),
  onLog: (cb) => ipcRenderer.on('log', (_e, e) => cb(e)),
  obsScenes: () => ipcRenderer.invoke('obs:scenes'),
  onConfig: (cb) => ipcRenderer.on('config', (_e, c) => cb(c)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  onPressed: (cb) => ipcRenderer.on('pressed', (_e, p) => cb(p)),
  onToast: (cb) => ipcRenderer.on('toast', (_e, m) => cb(m)),
});
