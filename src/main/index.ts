import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  shell,
  screen
} from 'electron'
import { existsSync } from 'fs'
import { SessionService } from './session-service'
import { registerShortcutsWithRetry, unregisterShortcuts } from './shortcuts'
import {
  applyLayout,
  computeWindowBounds,
  createOrbWindow,
  defaultAnchor,
  loadRenderer,
  setOrbAnchor,
  ORB_SIZE,
  type OrbAnchor
} from './window'
import { getDayMarkdownPath, getDefaultLogDir } from './paths'
import {
  isValidDateKey,
  localDateKey,
  PROFILE_SLOTS,
  type Profile,
  type ProfileSlot
} from '../shared/types'
import { listPending } from './store'
import { checkForUpdates } from './updates'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  console.log('WhatWhen is already running — exiting this instance.')
  app.exit(0)
  process.exit(0)
}

let orbWindow: BrowserWindow | null = null
let service: SessionService
let lastMode: string | null = null
let contextMenuOpen = false
let boundsRevealTimer: ReturnType<typeof setTimeout> | null = null
let opacityFadeTimer: ReturnType<typeof setInterval> | null = null
let paintResetTimer: ReturnType<typeof setTimeout> | null = null
let overlayEscapeRegistered = false
/** Timeline inspector is open and needs keyboard for time fields. */
let timelineEditing = false
let lastWheelToggleAt = 0
let pendingPolicyMode: string | null = null

const WM_LBUTTONDOWN = 0x0201
const WM_LBUTTONUP = 0x0202
const WM_LBUTTONDBLCLK = 0x0203
const WM_MOUSEMOVE = 0x0200
const WM_CAPTURECHANGED = 0x0215
const WM_ACTIVATEAPP = 0x001c
const MK_LBUTTON = 0x0001

const IDLE_CLICK_DRAG_PX = 5
const DRAG_POLL_MS = 16
const DRAG_MAX_MS = 10_000
const POST_DRAG_TOGGLE_BLOCK_MS = 300
const WHEEL_TOGGLE_DEBOUNCE_MS = 400

const DEBUG_INPUT = process.env.WHATWHEN_DEBUG_INPUT === '1'
const logInput = (...a: unknown[]): void => {
  if (DEBUG_INPUT) console.log('[orb-input]', ...a)
}

interface OrbDrag {
  startCursor: { x: number; y: number }
  startBounds: Electron.Rectangle
  moved: boolean
  startedAt: number
  poll: ReturnType<typeof setInterval> | null
  rendererSawPointer: boolean
}
let orbDrag: OrbDrag | null = null
let suppressToggleUntil = 0

function getAnchor(): OrbAnchor {
  const s = service.getConfig().settings
  if (s.orbAnchorX != null && s.orbAnchorY != null) {
    const { workArea } = screen.getPrimaryDisplay()
    if (
      s.orbAnchorX < workArea.x ||
      s.orbAnchorY < workArea.y ||
      s.orbAnchorX > workArea.x + workArea.width ||
      s.orbAnchorY > workArea.y + workArea.height
    ) {
      return defaultAnchor(s.marginPx ?? 20)
    }
    return { x: s.orbAnchorX, y: s.orbAnchorY }
  }
  return defaultAnchor(s.marginPx ?? 20)
}

function setOverlayEscape(enabled: boolean): void {
  if (enabled === overlayEscapeRegistered) return

  if (enabled) {
    overlayEscapeRegistered = globalShortcut.register('Escape', () => {
      service.closeUi()
    })
    if (!overlayEscapeRegistered) {
      console.warn('Unable to register Escape while review overlay is open')
    }
  } else {
    globalShortcut.unregister('Escape')
    overlayEscapeRegistered = false
  }
}

/**
 * Drop Windows' white DWM focus strip on transparent frameless HWNDs.
 * Must not call showInactive while the window is hidden — that would undo
 * pushState()'s hide-before-resize guard for Analysis/Timeline transitions.
 */
function reassertTopmost(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.setAlwaysOnTop(true, 'screen-saver')
}

function clearTransparentFocus(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.setFocusable(false)
  if (win.isFocused()) {
    try {
      win.blur()
    } catch {
      /* blur can throw on some Electron/Windows builds */
    }
  }
  win.setHasShadow(false)
  win.setBackgroundColor('#00000000')
  reassertTopmost(win)
  if (!win.isVisible()) return
  win.showInactive()
}

/** Paint-only DWM reset — does not demote focus, so typing still works. */
function resetTransparentPaint(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.setHasShadow(false)
  win.setBackgroundColor('#00000000')
}

/** Window must never stay hidden or half-faded. Safe to call at any time. */
function ensureVisible(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (opacityFadeTimer) return // a fade owns the opacity right now
  const repaired = win.getOpacity() < 1 || !win.isVisible()
  if (win.getOpacity() < 1) win.setOpacity(1)
  if (!win.isVisible()) win.showInactive()
  reassertTopmost(win)
  if (repaired) logInput('ensureVisible repair')
}

/** DWM often paints the focus strip a frame after activation. */
function armTransparentPaintReset(win: BrowserWindow): void {
  // Mid-fade resets recomposite the HWND while opacity is climbing — that
  // is the flicker on notes open/close and profile switches. Fade-end
  // applyMousePolicy performs one reset once opacity is back at 1.
  if (opacityFadeTimer) return
  resetTransparentPaint(win)
  if (paintResetTimer) clearTimeout(paintResetTimer)
  paintResetTimer = setTimeout(() => {
    paintResetTimer = null
    if (opacityFadeTimer) return
    resetTransparentPaint(win)
  }, 80)
}

function needsKeyboard(mode: string | null): boolean {
  return (
    mode === 'bubble' ||
    mode === 'settings' ||
    (mode === 'timeline' && timelineEditing)
  )
}

/**
 * Idle is an orb-tight HWND (no empty glass). Wheel/stack keep a larger
 * transparent surface with pass-through on empty glass; the renderer
 * re-enables hit-testing when the cursor is over interactive UI.
 * Focused overlays (bubble/settings, timeline inspector) capture all clicks;
 * analysis/timeline otherwise capture clicks but stay non-focusable.
 */
function applyMousePolicy(mode: string): void {
  if (!orbWindow || orbWindow.isDestroyed()) return
  pendingPolicyMode = null

  if (needsKeyboard(mode)) {
    setOverlayEscape(false)
    orbWindow.setFocusable(true)
    orbWindow.setIgnoreMouseEvents(false)
    if (!orbWindow.isFocused()) orbWindow.focus()
    armTransparentPaintReset(orbWindow)
    reassertTopmost(orbWindow)
    return
  }

  if (mode === 'analysis' || mode === 'timeline') {
    // Focused transparent HWNDs can acquire a persistent white DWM strip.
    // Overlay buttons/hover still work without activating the window.
    setOverlayEscape(true)
    orbWindow.setIgnoreMouseEvents(false)
    clearTransparentFocus(orbWindow)
    reassertTopmost(orbWindow)
    return
  }

  if (mode === 'idle') {
    // Whole window is the orb — always receive input; no pass-through surface.
    setOverlayEscape(false)
    orbWindow.setIgnoreMouseEvents(false)
    clearTransparentFocus(orbWindow)
    reassertTopmost(orbWindow)
    return
  }

  // wheel / stack — large transparent HWND; pass through empty glass
  setOverlayEscape(false)
  orbWindow.setIgnoreMouseEvents(true, { forward: true })
  clearTransparentFocus(orbWindow)
  reassertTopmost(orbWindow)
}

function clearRevealTimers(): void {
  const wasFading = opacityFadeTimer !== null
  if (boundsRevealTimer) clearTimeout(boundsRevealTimer)
  if (opacityFadeTimer) clearInterval(opacityFadeTimer)
  if (paintResetTimer) clearTimeout(paintResetTimer)
  boundsRevealTimer = null
  opacityFadeTimer = null
  paintResetTimer = null
  if (wasFading && orbWindow && !orbWindow.isDestroyed()) {
    orbWindow.setOpacity(1)
  }
}

function fadeInWindow(win: BrowserWindow, durationMs = 100, mode?: string): void {
  const snapMode = mode ?? service.snapshot().mode
  const keepFocus = needsKeyboard(snapMode)
  const startedAt = Date.now()
  win.setOpacity(0)

  // Mark the fade before show/focus so paint resets skip until opacity is 1.
  opacityFadeTimer = setInterval(() => {
    if (win.isDestroyed()) {
      clearRevealTimers()
      return
    }
    const progress = Math.min(1, (Date.now() - startedAt) / durationMs)
    win.setOpacity(progress)
    if (progress >= 1) {
      if (opacityFadeTimer) clearInterval(opacityFadeTimer)
      opacityFadeTimer = null
      win.setOpacity(1)
      reassertTopmost(win)
      if (keepFocus) {
        applyMousePolicy(snapMode)
        if (!win.isDestroyed()) win.webContents.send('overlay-revealed')
      } else {
        // Reaffirm inactive after the fade — clicks that closed the overlay
        // can leave a stuck DWM focus strip once opacity returns to 1.
        clearTransparentFocus(win)
      }
    }
  }, 16)

  if (keepFocus) {
    win.setFocusable(true)
    win.show()
    if (!win.isFocused()) win.focus()
    armTransparentPaintReset(win)
  } else {
    clearTransparentFocus(win)
    win.showInactive()
  }
}

/** Modes that keep the orb pinned to the HWND bottom-right. */
function isAnchoredMode(mode: string | null): boolean {
  return (
    mode === 'idle' ||
    mode === 'wheel' ||
    mode === 'stack' ||
    mode === 'bubble' ||
    mode === 'settings'
  )
}

function pushState(): void {
  if (!orbWindow || orbWindow.isDestroyed()) return
  const snap = service.snapshot()
  if (orbDrag) {
    if (snap.mode !== 'idle') {
      endOrbDrag(false)
    } else {
      timelineEditing = false
      orbWindow.webContents.send('state-changed', snap)
      lastMode = snap.mode
      return
    }
  }
  if (snap.mode !== 'timeline') timelineEditing = false
  const orbSize = service.getConfig().settings.orbSize || ORB_SIZE
  const margin = service.getConfig().settings.marginPx
  const anchor = getAnchor()
  const modeChanged = lastMode !== snap.mode
  const wasCentered = lastMode === 'analysis' || lastMode === 'timeline'
  const isCentered = snap.mode === 'analysis' || snap.mode === 'timeline'
  const leavingCenteredOverlay = wasCentered && !isCentered

  const nextBounds = computeWindowBounds(
    snap.mode,
    snap.pending.length,
    orbSize,
    margin,
    anchor
  )
  const cur = orbWindow.getBounds()
  const boundsChanging =
    cur.x !== nextBounds.x ||
    cur.y !== nextBounds.y ||
    cur.width !== nextBounds.width ||
    cur.height !== nextBounds.height

  /*
   * Shrinking anchored UI (wheel/stack → idle): keep the HWND visible and
   * sized large for ~120ms so the orb stays put while chrome fades out in
   * the renderer, then crop bounds without hide(). A full hide() blanks the
   * orb for several frames (see recording 2026-08-12 090204).
   */
  const anchoredShrink =
    lastMode !== null &&
    boundsChanging &&
    isAnchoredMode(lastMode) &&
    isAnchoredMode(snap.mode) &&
    nextBounds.width * nextBounds.height < cur.width * cur.height

  if (anchoredShrink) {
    clearRevealTimers()
    ensureVisible(orbWindow)
    // Pass through empty glass while the large surface is still up.
    orbWindow.setIgnoreMouseEvents(true, { forward: true })
    setOverlayEscape(false)
    pendingPolicyMode = snap.mode
    orbWindow.webContents.send('state-changed', snap)
    lastMode = snap.mode
    const targetWindow = orbWindow
    boundsRevealTimer = setTimeout(() => {
      boundsRevealTimer = null
      if (targetWindow.isDestroyed()) return
      applyLayout(
        targetWindow,
        snap.mode,
        snap.pending.length,
        orbSize,
        margin,
        anchor
      )
      applyMousePolicy(snap.mode)
      if (needsKeyboard(snap.mode) && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('overlay-revealed')
      }
    }, 120)
    return
  }

  /*
   * Growing or crossing centered overlays: hide before setBounds so Windows
   * never flashes the previous surface at the new origin. Reveal with a short
   * fade so the orb returns softly (open path cannot keep the orb on-screen
   * in a single HWND — that would need a second window).
   */
  if (lastMode !== null && boundsChanging) {
    clearRevealTimers()
    orbWindow.setOpacity(1)
    orbWindow.hide()
  }

  applyLayout(
    orbWindow,
    snap.mode,
    snap.pending.length,
    orbSize,
    margin,
    anchor
  )
  // Mode-change mouse policy before state paint so the renderer can then
  // re-enable hit-testing while the cursor is still over the orb.
  // Skip on elapsed-only ticks — resetting ignore every second races clicks.
  if (modeChanged) {
    applyMousePolicy(snap.mode)
  }
  orbWindow.webContents.send('state-changed', snap)
  const shouldReveal = lastMode !== null && boundsChanging
  lastMode = snap.mode

  if (shouldReveal) {
    const targetWindow = orbWindow
    const delayMs = leavingCenteredOverlay ? 500 : 50
    boundsRevealTimer = setTimeout(() => {
      boundsRevealTimer = null
      if (targetWindow.isDestroyed()) return
      fadeInWindow(targetWindow, leavingCenteredOverlay ? 180 : 100, snap.mode)
    }, delayMs)
  }
}

function requestToggleWheel(): void {
  const now = Date.now()
  if (now < suppressToggleUntil) {
    logInput('toggle suppression')
    return
  }
  if (now - lastWheelToggleAt < WHEEL_TOGGLE_DEBOUNCE_MS) return
  lastWheelToggleAt = now
  service.toggleWheel()
  pushState()
}

function cursorIsOnOrb(): boolean {
  if (!orbWindow || orbWindow.isDestroyed()) return false
  const p = screen.getCursorScreenPoint()
  const b = orbWindow.getBounds()
  const s = service.getConfig().settings.orbSize || ORB_SIZE
  const cx = b.x + b.width - 2 - s / 2
  const cy = b.y + b.height - 2 - s / 2
  return Math.hypot(p.x - cx, p.y - cy) <= s / 2 + 3
}

function pollOrbDrag(): void {
  if (!orbDrag || !orbWindow || orbWindow.isDestroyed()) {
    endOrbDrag(false)
    return
  }
  if (Date.now() - orbDrag.startedAt > DRAG_MAX_MS) {
    endOrbDrag(false)
    return
  }
  const p = screen.getCursorScreenPoint()
  const dx = p.x - orbDrag.startCursor.x
  const dy = p.y - orbDrag.startCursor.y
  if (!orbDrag.moved) {
    if (Math.hypot(dx, dy) < IDLE_CLICK_DRAG_PX) return
    orbDrag.moved = true
  }
  const target: OrbAnchor = {
    x: orbDrag.startBounds.x + orbDrag.startBounds.width + dx,
    y: orbDrag.startBounds.y + orbDrag.startBounds.height + dy
  }
  const margin = service.getConfig().settings.marginPx
  setOrbAnchor(orbWindow, target, margin)
}

function beginOrbDrag(fromRenderer: boolean): void {
  if (!orbWindow || orbWindow.isDestroyed()) return
  if (service.snapshot().mode !== 'idle') return
  if (orbDrag) {
    orbDrag.rendererSawPointer ||= fromRenderer
    return
  }
  logInput('beginOrbDrag', fromRenderer ? 'renderer' : 'native')
  orbDrag = {
    startCursor: screen.getCursorScreenPoint(),
    startBounds: orbWindow.getBounds(),
    moved: false,
    startedAt: Date.now(),
    poll: setInterval(pollOrbDrag, DRAG_POLL_MS),
    rendererSawPointer: fromRenderer
  }
}

function endOrbDrag(fromRelease: boolean): void {
  const d = orbDrag
  if (d?.poll) clearInterval(d.poll)
  orbDrag = null
  if (!d) return
  logInput('endOrbDrag', { moved: d.moved, fromRelease })
  if (!orbWindow || orbWindow.isDestroyed()) return
  if (d.moved) {
    const b = orbWindow.getBounds()
    const anchor = { x: b.x + b.width, y: b.y + b.height }
    service.updateSettings({ orbAnchorX: anchor.x, orbAnchorY: anchor.y })
    suppressToggleUntil = Date.now() + POST_DRAG_TOGGLE_BLOCK_MS
    logInput('toggle suppression', POST_DRAG_TOGGLE_BLOCK_MS)
  } else if (fromRelease && !d.rendererSawPointer && cursorIsOnOrb()) {
    requestToggleWheel()
  }
}

function recoverUi(): void {
  if (!orbWindow || orbWindow.isDestroyed()) return
  endOrbDrag(false)
  clearRevealTimers()
  orbWindow.setOpacity(1)
  const mode = service.snapshot().mode
  applyMousePolicy(mode)
  ensureVisible(orbWindow)
  pushState()
}

function createWindow(): void {
  const s = service.getConfig().settings
  orbWindow = createOrbWindow({
    orbSize: s.orbSize || ORB_SIZE,
    margin: s.marginPx,
    anchor: getAnchor()
  })
  loadRenderer(orbWindow)
  orbWindow.setIgnoreMouseEvents(false)
  orbWindow.setTitle('')

  orbWindow.webContents.on('did-finish-load', () => {
    orbWindow?.setTitle('')
    void orbWindow?.webContents.executeJavaScript(`
      document.title = '';
      document.querySelectorAll('[title]').forEach((el) => el.removeAttribute('title'));
    `)
    // Apply saved anchor after load
    pushState()
  })

  orbWindow.webContents.on('page-title-updated', (e) => {
    e.preventDefault()
    orbWindow?.setTitle('')
  })

  // DWM can paint the white strip when focus arrives from a click rather
  // than from applyMousePolicy (e.g. selecting a timeline bar).
  orbWindow.on('focus', () => {
    if (!orbWindow || orbWindow.isDestroyed()) return
    armTransparentPaintReset(orbWindow)
  })

  // Losing focus dismisses keyboard overlays; also helps context-menu cleanup
  orbWindow.on('blur', () => {
    if (contextMenuOpen) return
    if (!orbWindow || orbWindow.isDestroyed()) return
    const mode = service.snapshot().mode
    if (mode === 'analysis' || mode === 'timeline' || mode === 'settings') {
      // Don't auto-close analysis on blur — user may alt-tab briefly
      return
    }
  })

  orbWindow.on('closed', () => {
    orbWindow = null
  })

  /*
   * Windows + focusable:false + transparent: Chromium often swallows the
   * first left-clicks until the HWND has been focused (e.g. via the
   * context menu). The native WM_LBUTTON* still arrive, so idle clicks
   * are handled here. Debounced with the renderer path to avoid a double
   * toggle once Chromium starts receiving clicks too.
   */
  const wpNum = (buf: unknown): number => {
    if (!Buffer.isBuffer(buf)) return 0
    if (buf.length >= 8) return Number(buf.readBigUInt64LE(0))
    if (buf.length >= 4) return buf.readUInt32LE(0)
    return 0
  }

  orbWindow.hookWindowMessage(WM_LBUTTONDOWN, () => beginOrbDrag(false))
  orbWindow.hookWindowMessage(WM_LBUTTONDBLCLK, () => beginOrbDrag(false))
  orbWindow.hookWindowMessage(WM_LBUTTONUP, () => endOrbDrag(true))
  orbWindow.hookWindowMessage(WM_MOUSEMOVE, (wParam) => {
    if (!orbDrag) return
    if ((wpNum(wParam) & MK_LBUTTON) === 0) endOrbDrag(true)
  })
  orbWindow.hookWindowMessage(WM_CAPTURECHANGED, () => endOrbDrag(false))
  orbWindow.hookWindowMessage(WM_ACTIVATEAPP, () => endOrbDrag(false))
}

function setupIpc(): void {
  ipcMain.handle('get-state', () => service.snapshot())

  ipcMain.handle('switch-profile', (_e, slot: ProfileSlot) => {
    service.switchProfile(slot)
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('shift-pick-profile', (_e, slot: ProfileSlot) => {
    if (!PROFILE_SLOTS.includes(slot)) return service.snapshot()
    service.shiftPickProfile(slot)
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('insert-segment', () => {
    service.insertSegment()
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('stop', () => {
    service.stop()
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('discard-active', () => {
    service.discardActive()
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('toggle-wheel', () => {
    requestToggleWheel()
    return service.snapshot()
  })

  ipcMain.handle('toggle-stack', () => {
    // kept for compat — maps to pending stack open/close
    if (service.snapshot().mode === 'stack') service.stackEscape()
    else service.openStack()
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('open-stack', () => {
    service.openStack()
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('open-settings', () => {
    service.openSettings()
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('open-analysis', () => {
    service.openAnalysis()
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('open-timeline', () => {
    service.openTimeline()
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('open-bubble', (_e, sessionId: string) => {
    service.openBubble(sessionId)
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('save-notes', (_e, sessionId: string, notes: string) => {
    service.saveNotes(sessionId, notes)
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('bubble-escape', (_e, notes?: string) => {
    if (typeof notes === 'string' && notes.trim()) {
      service.dismissBubbleWithNotes(notes)
    } else {
      service.bubbleEscape()
    }
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('dismiss-bubble', (_e, notes: string) => {
    service.dismissBubbleWithNotes(notes ?? '')
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('stack-escape', () => {
    service.stackEscape()
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('close-ui', () => {
    service.closeUi()
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('update-profiles', (_e, profiles: Profile[]) => {
    service.updateProfiles(profiles)
    pushState()
    return service.snapshot()
  })

  ipcMain.handle(
    'retire-profile',
    (_e, slot: ProfileSlot, name: string, color: string, outline?: boolean) => {
    if (!PROFILE_SLOTS.includes(slot)) return service.snapshot()
    service.retireProfile(
      slot,
      typeof name === 'string' ? name : '',
      color,
      typeof outline === 'boolean' ? outline : undefined
    )
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('update-session-times', (_e, id: string, startIso: string, endIso: string | null) => {
    service.updateSessionTimes(id, startIso, endIso)
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('reassign-session', (_e, id: string, slot: ProfileSlot) => {
    service.reassignSession(id, slot)
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('share-session', (_e, id: string, slot: ProfileSlot | null) => {
    if (slot != null && !PROFILE_SLOTS.includes(slot)) return service.snapshot()
    service.shareSession(id, slot)
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('split-session', (_e, id: string, atIso: string) => {
    service.splitSession(id, atIso)
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('set-timeline-editing', (_e, editing: boolean) => {
    timelineEditing = !!editing
    const mode = service.snapshot().mode
    if (mode === 'timeline') {
      applyMousePolicy(mode)
      if (timelineEditing && orbWindow && !orbWindow.isDestroyed()) {
        armTransparentPaintReset(orbWindow)
      }
    }
  })

  ipcMain.handle('get-config', () => service.getConfig())

  ipcMain.handle('set-settings', (_e, partial: Record<string, unknown>) => {
    service.updateSettings(partial as Parameters<typeof service.updateSettings>[0])
    if (typeof partial.autostart === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: partial.autostart })
    }
    pushState()
    return service.getConfig()
  })

  ipcMain.on('orb-pointer-down', () => beginOrbDrag(true))
  ipcMain.on('orb-pointer-up', () => endOrbDrag(true))
  ipcMain.handle('recover-ui', () => recoverUi())

  ipcMain.handle('set-view-range', (_e, start: string, end: string) => {
    if (!isValidDateKey(start) || !isValidDateKey(end)) return service.snapshot()
    service.setViewRange(start, end)
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('set-timeline-day', (_e, dateKey: string) => {
    if (!isValidDateKey(dateKey)) return service.snapshot()
    service.setTimelineDay(dateKey)
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('reset-view-today', () => {
    service.resetViewToToday()
    pushState()
    return service.snapshot()
  })

  ipcMain.handle('list-log-dates', () => service.listAvailableDates())

  ipcMain.handle('open-day-log', async (_e, dateKey: string) => {
    if (!isValidDateKey(dateKey)) return
    const logDir = service.getConfig().settings.logDir || getDefaultLogDir()
    const md = getDayMarkdownPath(logDir, dateKey)
    if (!existsSync(md)) return
    await shell.openPath(md)
  })

  ipcMain.handle('open-today-log', async () => {
    const logDir = service.getConfig().settings.logDir || getDefaultLogDir()
    const md = getDayMarkdownPath(logDir, localDateKey())
    if (!existsSync(md)) return
    await shell.openPath(md)
  })

  ipcMain.handle('open-log-folder', async () => {
    const logDir = service.getConfig().settings.logDir || getDefaultLogDir()
    await shell.openPath(logDir)
  })

  ipcMain.handle('show-context-menu', () => {
    if (!orbWindow || orbWindow.isDestroyed()) return

    const snap = service.snapshot()
    const hasActive = !!(snap.activeSession && !snap.activeSession.endIso)
    const pendingCount = listPending(service.getConfig().settings.logDir).length
    const logExists = snap.todayLogExists

    // Focusable so Escape / click-outside dismiss the native menu reliably
    orbWindow.setFocusable(true)
    orbWindow.focus()
    contextMenuOpen = true

    const restoreFocus = (): void => {
      contextMenuOpen = false
      if (!orbWindow || orbWindow.isDestroyed()) return
      // Menu required focus; demote even when the UI mode did not change.
      applyMousePolicy(service.snapshot().mode)
    }

    const menu = Menu.buildFromTemplate([
      {
        label: "Open today's log",
        enabled: logExists,
        click: () => {
          const logDir = service.getConfig().settings.logDir || getDefaultLogDir()
          const md = getDayMarkdownPath(logDir, localDateKey())
          if (existsSync(md)) shell.openPath(md)
        }
      },
      {
        label: 'Open log folder',
        click: () => {
          shell.openPath(service.getConfig().settings.logDir || getDefaultLogDir())
        }
      },
      { type: 'separator' },
      {
        label: 'Analysis',
        click: () => {
          service.openAnalysis()
          pushState()
        }
      },
      {
        label: 'Timeline',
        click: () => {
          service.openTimeline()
          pushState()
        }
      },
      { type: 'separator' },
      {
        label:
          pendingCount > 0
            ? `Pending notes (${pendingCount})`
            : 'Pending notes',
        enabled: pendingCount > 0,
        click: () => {
          service.openStack()
          pushState()
        }
      },
      {
        label: 'Add comment / segment',
        enabled: hasActive,
        click: () => {
          service.insertSegment()
          pushState()
        }
      },
      {
        label: 'Edit profiles…',
        click: () => {
          service.openSettings()
          pushState()
        }
      },
      {
        label: 'Tips',
        submenu: [
          { label: 'Drag the orb to move it', enabled: false },
          { label: 'Click the orb to open / close the wheel', enabled: false },
          { label: 'Click a number to start or switch profiles', enabled: false },
          { label: 'Slots 10–12 sit on the outer ring (no hotkey)', enabled: false },
          { label: 'Click × to stop and keep the segment (asks for notes)', enabled: false },
          { label: 'Hold × for ~0.7 s to stop and discard the segment', enabled: false },
          { label: 'Badge = pending notes · click it to review', enabled: false },
          { label: 'In a note: Enter saves · Esc keeps it pending', enabled: false },
          { label: 'Analysis: hover a slice or bar for its notes · click to keep them open', enabled: false },
          { label: 'Shift-click a color to start and keep the wheel open', enabled: false },
          { label: 'Shift-click a second color to split the running segment 50/50', enabled: false },
          { label: 'Shift-click a third color to end that split, note it, and start a new 50/50', enabled: false },
          { label: 'Timeline: click a bar to edit times, reassign, half-with, or split', enabled: false },
          {
            label:
              'Hotkeys: Ctrl+Shift+Alt+1–9 switch · ` stops · N adds a comment · 0 recovers the orb',
            enabled: false
          }
        ]
      },
      { type: 'separator' },
      {
        label: 'Stop timer',
        enabled: hasActive,
        click: () => {
          service.stop()
          pushState()
        }
      },
      {
        label: 'Stop timer & discard segment',
        enabled: hasActive,
        click: () => {
          service.discardActive()
          pushState()
        }
      },
      { type: 'separator' },
      {
        label: service.hotkeysOk ? 'Hotkeys: OK' : 'Hotkeys: FAILED',
        enabled: false
      },
      {
        label: 'Re-register hotkeys',
        click: () => {
          void registerShortcutsWithRetry(
            service,
            () => pushState(),
            4,
            400,
            recoverUi
          ).then(() => pushState())
        }
      },
      {
        label: `Check for updates… (v${app.getVersion()})`,
        click: () => {
          void checkForUpdates(orbWindow).finally(() => {
            if (!orbWindow || orbWindow.isDestroyed()) return
            applyMousePolicy(service.snapshot().mode)
          })
        }
      },
      { type: 'separator' },
      {
        label: 'Quit WhatWhen',
        click: () => app.quit()
      }
    ])

    menu.popup({
      window: orbWindow,
      callback: restoreFocus
    })
  })

  ipcMain.on('set-ignore-mouse', (_e, ignore: boolean) => {
    if (!orbWindow || orbWindow.isDestroyed()) return
    const mode = service?.snapshot()?.mode ?? 'idle'
    // Idle is orb-tight; focused overlays never pass through.
    if (
      mode === 'idle' ||
      mode === 'bubble' ||
      mode === 'settings' ||
      mode === 'analysis' ||
      mode === 'timeline'
    ) {
      orbWindow.setIgnoreMouseEvents(false)
      return
    }
    // wheel / stack — large transparent HWND; pass through empty glass
    if (ignore) {
      orbWindow.setIgnoreMouseEvents(true, { forward: true })
    } else {
      orbWindow.setIgnoreMouseEvents(false)
    }
  })

}

app.on('second-instance', () => {
  if (orbWindow) {
    if (orbWindow.isMinimized()) orbWindow.restore()
    orbWindow.show()
    orbWindow.focus()
  }
})

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.whatwhen.app')
  }

  service = new SessionService()
  setupIpc()
  createWindow()

  const ok = await registerShortcutsWithRetry(
    service,
    () => pushState(),
    4,
    400,
    recoverUi
  )
  if (!ok) {
    console.warn(
      'Some global shortcuts failed. Close other WhatWhen instances or free the hotkeys.'
    )
  }
  pushState()

  setInterval(() => {
    if (!orbWindow || orbWindow.isDestroyed()) return
    if (orbDrag) {
      if (Date.now() - orbDrag.startedAt > DRAG_MAX_MS) endOrbDrag(false)
      return
    }
    if (boundsRevealTimer || opacityFadeTimer) return
    ensureVisible(orbWindow)
    if (pendingPolicyMode) {
      const m = pendingPolicyMode
      pendingPolicyMode = null
      applyMousePolicy(m)
    }
  }, 2000)

  service.onChange(() => {
    // Always apply native bounds/visibility before renderer state. Sending the
    // snapshot directly here lets Windows paint the old transparent contents
    // at the new origin for a frame during centered-overlay transitions.
    pushState()
  })

  screen.on('display-metrics-changed', () => {
    if (orbWindow && !orbWindow.isDestroyed()) reassertTopmost(orbWindow)
    pushState()
  })

  app.on('browser-window-focus', () => {
    if (!service.hotkeysOk) {
      void registerShortcutsWithRetry(service, () => pushState(), 2, 200, recoverUi)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  unregisterShortcuts()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
