import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import type { UiMode } from '../shared/types'

export const ORB_SIZE = 52
export const STACK_DOT = 34
export const STACK_GAP = 10
export const MAX_STACK = 7
export const BUBBLE_W = 280
export const BUBBLE_H = 168
/** Room for dual-radius 6-dot fan above/left of the orb */
export const WHEEL_W = 320
export const WHEEL_H = 300
export const SETTINGS_W = 320
export const SETTINGS_H = 420
export const MARGIN = 16

/**
 * Window is bottom-right anchored. Expands for wheel / stack / bubble / settings.
 */
export function computeLayout(
  mode: UiMode,
  pendingCount: number,
  orbSize = ORB_SIZE
): { width: number; height: number } {
  const pad = 4
  if (mode === 'idle') {
    return { width: orbSize + pad * 2, height: orbSize + pad * 2 }
  }
  if (mode === 'wheel') {
    return { width: WHEEL_W, height: WHEEL_H }
  }
  if (mode === 'stack') {
    const n = Math.min(Math.max(pendingCount, 1), MAX_STACK)
    const stackH = n * (STACK_DOT + STACK_GAP) + 12
    return {
      width: Math.max(orbSize + 24, 72),
      height: orbSize + stackH + 20
    }
  }
  if (mode === 'settings') {
    return { width: SETTINGS_W + 16, height: SETTINGS_H + orbSize + 24 }
  }
  // bubble
  return {
    width: Math.max(BUBBLE_W + 16, orbSize + 24),
    height: orbSize + BUBBLE_H + 28
  }
}

export function createOrbWindow(): BrowserWindow {
  const size = ORB_SIZE + 8
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    roundedCorners: false,
    thickFrame: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setHasShadow(false)

  win.once('ready-to-show', () => {
    positionBottomRight(win, size, size)
    win.showInactive()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

export function positionBottomRight(
  win: BrowserWindow,
  width: number,
  height: number,
  margin = MARGIN
): void {
  const display = screen.getPrimaryDisplay()
  const { workArea } = display
  const x = Math.round(workArea.x + workArea.width - width - margin)
  const y = Math.round(workArea.y + workArea.height - height - margin)
  win.setBounds({ x, y, width, height })
}

export function applyLayout(
  win: BrowserWindow,
  mode: UiMode,
  pendingCount: number,
  orbSize = ORB_SIZE,
  margin = MARGIN
): void {
  const { width, height } = computeLayout(mode, pendingCount, orbSize)
  positionBottomRight(win, width, height, margin)
  win.setHasShadow(false)
}

export function loadRenderer(win: BrowserWindow): void {
  const devUrl =
    process.env.ELECTRON_RENDERER_URL || process.env.ELECTRON_VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
