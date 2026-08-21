import { contextBridge, ipcRenderer } from 'electron'
import type { Profile, ProfileSlot, UiSnapshot, AppConfig } from '../shared/types'

const api = {
  getState: (): Promise<UiSnapshot> => ipcRenderer.invoke('get-state'),
  switchProfile: (slot: ProfileSlot): Promise<UiSnapshot> =>
    ipcRenderer.invoke('switch-profile', slot),
  insertSegment: (): Promise<UiSnapshot> => ipcRenderer.invoke('insert-segment'),
  stop: (): Promise<UiSnapshot> => ipcRenderer.invoke('stop'),
  discardActive: (): Promise<UiSnapshot> => ipcRenderer.invoke('discard-active'),
  toggleWheel: (): Promise<UiSnapshot> => ipcRenderer.invoke('toggle-wheel'),
  toggleStack: (): Promise<UiSnapshot> => ipcRenderer.invoke('toggle-stack'),
  openStack: (): Promise<UiSnapshot> => ipcRenderer.invoke('open-stack'),
  openSettings: (): Promise<UiSnapshot> => ipcRenderer.invoke('open-settings'),
  openAnalysis: (): Promise<UiSnapshot> => ipcRenderer.invoke('open-analysis'),
  openTimeline: (): Promise<UiSnapshot> => ipcRenderer.invoke('open-timeline'),
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
  updateSessionTimes: (
    id: string,
    startIso: string,
    endIso: string | null
  ): Promise<UiSnapshot> =>
    ipcRenderer.invoke('update-session-times', id, startIso, endIso),
  reassignSession: (id: string, slot: ProfileSlot): Promise<UiSnapshot> =>
    ipcRenderer.invoke('reassign-session', id, slot),
  splitSession: (id: string, atIso: string): Promise<UiSnapshot> =>
    ipcRenderer.invoke('split-session', id, atIso),
  setTimelineEditing: (editing: boolean): Promise<void> =>
    ipcRenderer.invoke('set-timeline-editing', editing),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),
  setSettings: (partial: Record<string, unknown>): Promise<AppConfig> =>
    ipcRenderer.invoke('set-settings', partial),
  orbPointerDown: (): void => ipcRenderer.send('orb-pointer-down'),
  orbPointerUp: (): void => ipcRenderer.send('orb-pointer-up'),
  recoverUi: (): Promise<void> => ipcRenderer.invoke('recover-ui'),
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
  },
  onOverlayRevealed: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('overlay-revealed', handler)
    return () => ipcRenderer.removeListener('overlay-revealed', handler)
  }
}

contextBridge.exposeInMainWorld('whatwhen', api)

export type WhatWhenApi = typeof api
