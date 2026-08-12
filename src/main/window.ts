import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import type { UiMode } from '../shared/types'

export const ORB_SIZE = 52
export const STACK_DOT = 34
export const STACK_GAP = 10
export const MAX_STACK = 7
export const BUBBLE_W = 280
export const BUBBLE_H = 168
export const WHEEL_W = 320
export const WHEEL_H = 300
export const SETTINGS_W = 320
export const SETTINGS_H = 420
export const OVERLAY_W = 760
export const OVERLAY_H = 440
export const MARGIN = 16

export interface OrbAnchor {
  x: number
  y: number
}

/**
 * Idle and wheel share the same HWND size. Resizing a bottom-right-anchored
 * transparent window on Windows briefly applies the new (x,y) with the old
 * size (or vice versa), which flashes a ghost copy of the UI up/left of the
 * orb. Keep bounds stable and toggle content + mouse pass-through instead.
 *
 * Stack / bubble / settings / overlays still use their own sizes.
 */
export function computeLayout(
  mode: UiMode,
  pendingCount: number,
  orbSize = ORB_SIZE
): { width: number; height: number } {
  if (mode === 'idle' || mode === 'wheel') {
    return { width: WHEEL_W, height: WHEEL_H }
  }
  if (mode === 'stack') {
    const n = Math.min(Math.max(pendingCount, 1), MAX_STACK)
    const stackH = n * (STACK_DOT + STACK_GAP) + 12
    return {
      width: Math.max(orbSize + 28, 80),
      height: orbSize + stackH + 24
    }
  }
  if (mode === 'settings') {
    return { width: SETTINGS_W + 16, height: SETTINGS_H + orbSize + 24 }
  }
  if (mode === 'analysis' || mode === 'timeline') {
    return { width: OVERLAY_W, height: OVERLAY_H }
  }
  return {
    width: Math.max(BUBBLE_W + 16, orbSize + 24),
    height: orbSize + BUBBLE_H + 28
  }
}

export function defaultAnchor(margin = MARGIN): OrbAnchor {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: Math.round(workArea.x + workArea.width - margin),
    y: Math.round(workArea.y + workArea.height - margin)
  }
}

/** Clamp anchor so a given window size stays mostly on-screen */
export function clampAnchor(
  anchor: OrbAnchor,
  width: number,
  height: number,
  margin = MARGIN
): OrbAnchor {
  const { workArea } = screen.getPrimaryDisplay()
  const minX = workArea.x + margin + width
  const maxX = workArea.x + workArea.width - margin
  const minY = workArea.y + margin + height
  const maxY = workArea.y + workArea.height - margin
  return {
    x: Math.round(Math.min(maxX, Math.max(minX, anchor.x))),
    y: Math.round(Math.min(maxY, Math.max(minY, anchor.y)))
  }
}

export function createOrbWindow(): BrowserWindow {
  const { width, height } = computeLayout('idle', 0)
  const win = new BrowserWindow({
    width,
    height,
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
    // Not focusable while idle/wheel — avoids Windows drawing a white focus slab
    focusable: false,
    roundedCorners: false,
    thickFrame: false,
    title: '',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  win.setTitle('')
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setHasShadow(false)
  win.setBackgroundColor('#00000000')
  win.setFocusable(false)

  win.once('ready-to-show', () => {
    win.setTitle('')
    const anchor = defaultAnchor()
    applyLayout(win, 'idle', 0, ORB_SIZE, MARGIN, anchor)
    win.showInactive()
  })

  win.on('page-title-updated', (e) => {
    e.preventDefault()
    win.setTitle('')
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

/**
 * Place window so its bottom-right corner sits on the orb anchor.
 * Analysis / timeline overlays are centered on the display instead.
 */
export function applyLayout(
  win: BrowserWindow,
  mode: UiMode,
  pendingCount: number,
  orbSize = ORB_SIZE,
  margin = MARGIN,
  anchor: OrbAnchor | null = null
): void {
  const { width, height } = computeLayout(mode, pendingCount, orbSize)
  let x: number
  let y: number

  if (mode === 'analysis' || mode === 'timeline') {
    const { workArea } = screen.getPrimaryDisplay()
    x = Math.round(workArea.x + (workArea.width - width) / 2)
    y = Math.round(workArea.y + (workArea.height - height) / 2)
  } else {
    const resolved = clampAnchor(
      anchor ?? defaultAnchor(margin),
      width,
      height,
      margin
    )
    x = resolved.x - width
    y = resolved.y - height
  }

  const cur = win.getBounds()
  if (
    cur.x === x &&
    cur.y === y &&
    cur.width === width &&
    cur.height === height
  ) {
    win.setTitle('')
    return
  }

  win.setBounds({ x, y, width, height })
  win.setBackgroundColor('#00000000')
  win.setHasShadow(false)
  win.setTitle('')
}

/** Move idle/orb window keeping size; returns new bottom-right anchor */
export function moveWindowBy(
  win: BrowserWindow,
  dx: number,
  dy: number,
  margin = MARGIN
): OrbAnchor {
  const b = win.getBounds()
  const next = clampAnchor(
    { x: b.x + b.width + dx, y: b.y + b.height + dy },
    b.width,
    b.height,
    margin
  )
  win.setBounds({
    x: next.x - b.width,
    y: next.y - b.height,
    width: b.width,
    height: b.height
  })
  return next
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
