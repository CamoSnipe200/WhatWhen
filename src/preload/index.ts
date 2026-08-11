import { contextBridge, ipcRenderer } from 'electron'
import type { Profile, ProfileSlot, UiSnapshot, AppConfig } from '../shared/types'

const api = {
  getState: (): Promise<UiSnapshot> => ipcRenderer.invoke('get-state'),
  switchProfile: (slot: ProfileSlot): Promise<UiSnapshot> =>
    ipcRenderer.invoke('switch-profile', slot),
  stop: (): Promise<UiSnapshot> => ipcRenderer.invoke('stop'),
  toggleWheel: (): Promise<UiSnapshot> => ipcRenderer.invoke('toggle-wheel'),
  toggleStack: (): Promise<UiSnapshot> => ipcRenderer.invoke('toggle-stack'),
  openStack: (): Promise<UiSnapshot> => ipcRenderer.invoke('open-stack'),
  openSettings: (): Promise<UiSnapshot> => ipcRenderer.invoke('open-settings'),
  openBubble: (sessionId: string): Promise<UiSnapshot> =>
    ipcRenderer.invoke('open-bubble', sessionId),
  saveNotes: (sessionId: string, notes: string): Promise<UiSnapshot> =>
    ipcRenderer.invoke('save-notes', sessionId, notes),
  bubbleEscape: (notes?: string): Promise<UiSnapshot> =>
    ipcRenderer.invoke('bubble-escape', notes),
  dismissBubble: (notes: string): Promise<UiSnapshot> =>
    ipcRenderer.invoke('dismiss-bubble', notes),
  stackEscape: (): Promise<UiSnapshot> => ipcRenderer.invoke('stack-escape'),
  closeUi: (): Promise<UiSnapshot> => ipcRenderer.invoke('close-ui'),
  updateProfiles: (profiles: Profile[]): Promise<UiSnapshot> =>
    ipcRenderer.invoke('update-profiles', profiles),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),
  setSettings: (partial: Record<string, unknown>): Promise<AppConfig> =>
    ipcRenderer.invoke('set-settings', partial),
  openTodayLog: (): Promise<void> => ipcRenderer.invoke('open-today-log'),
  openLogFolder: (): Promise<void> => ipcRenderer.invoke('open-log-folder'),
  showContextMenu: (): Promise<void> => ipcRenderer.invoke('show-context-menu'),
  setIgnoreMouse: (ignore: boolean): void => {
    ipcRenderer.send('set-ignore-mouse', ignore)
  },
  onStateChanged: (cb: (snap: UiSnapshot) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, snap: UiSnapshot): void => cb(snap)
    ipcRenderer.on('state-changed', handler)
    return () => ipcRenderer.removeListener('state-changed', handler)
  }
}

contextBridge.exposeInMainWorld('whatwhen', api)

export type WhatWhenApi = typeof api
