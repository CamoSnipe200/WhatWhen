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
  moveWindowBy,
  ORB_SIZE,
  type OrbAnchor
} from './window'
import { getDayMarkdownPath, getDefaultLogDir } from './paths'
import {
  localDateKey,
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
let overlayEscapeRegistered = false

function getAnchor(): OrbAnchor {
  const s = service.getConfig().settings
  if (s.orbAnchorX != null && s.orbAnchorY != null) {
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
function clearTransparentFocus(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.setFocusable(false)
  try {
    win.blur()
  } catch {
    /* blur can throw on some Electron/Windows builds */
  }
  win.setHasShadow(false)
  win.setBackgroundColor('#00000000')
  if (!win.isVisible()) return
  win.showInactive()
}

/**
 * Idle is an orb-tight HWND (no empty glass). Wheel/stack keep a larger
 * transparent surface with pass-through on empty glass; the renderer
 * re-enables hit-testing when the cursor is over interactive UI.
 * Focused overlays (bubble/settings) capture all clicks; analysis/timeline
 * capture clicks but stay non-focusable.
 */
function applyMousePolicy(mode: string): void {
  if (!orbWindow || orbWindow.isDestroyed()) return

  if (mode === 'bubble' || mode === 'settings') {
    setOverlayEscape(false)
    orbWindow.setFocusable(true)
    orbWindow.setIgnoreMouseEvents(false)
    orbWindow.focus()
    return
  }

  if (mode === 'analysis' || mode === 'timeline') {
    // Focused transparent HWNDs can acquire a persistent white DWM strip.
    // Overlay buttons/hover still work without activating the window.
    setOverlayEscape(true)
    orbWindow.setIgnoreMouseEvents(false)
    clearTransparentFocus(orbWindow)
    return
  }

  if (mode === 'idle') {
    // Whole window is the orb — always receive input; no pass-through surface.
    setOverlayEscape(false)
    orbWindow.setIgnoreMouseEvents(false)
    clearTransparentFocus(orbWindow)
    return
  }

  // wheel / stack — large transparent HWND; pass through empty glass
  setOverlayEscape(false)
  orbWindow.setIgnoreMouseEvents(true, { forward: true })
  clearTransparentFocus(orbWindow)
}

function clearRevealTimers(): void {
  if (boundsRevealTimer) clearTimeout(boundsRevealTimer)
  if (opacityFadeTimer) clearInterval(opacityFadeTimer)
  boundsRevealTimer = null
  opacityFadeTimer = null
}

function fadeInWindow(win: BrowserWindow, durationMs = 100): void {
  const startedAt = Date.now()
  win.setOpacity(0)
  clearTransparentFocus(win)
  win.showInactive()

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
      // Reaffirm inactive after the fade — clicks that closed the overlay
      // can leave a stuck DWM focus strip once opacity returns to 1.
      clearTransparentFocus(win)
    }
  }, 16)
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
    // Pass through empty glass while the large surface is still up.
    orbWindow.setIgnoreMouseEvents(true, { forward: true })
    setOverlayEscape(false)
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
      clearTransparentFocus(targetWindow)
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
      fadeInWindow(targetWindow, leavingCenteredOverlay ? 180 : 100)
    }, delayMs)
  }
}

function createWindow(): void {
  orbWindow = createOrbWindow()
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
}

function setupIpc(): void {
  ipcMain.handle('get-state', () => service.snapshot())

  ipcMain.handle('switch-profile', (_e, slot: ProfileSlot) => {
    service.switchProfile(slot)
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

  ipcMain.handle('toggle-wheel', () => {
    service.toggleWheel()
    pushState()
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

  ipcMain.handle('get-config', () => service.getConfig())

  ipcMain.handle('set-settings', (_e, partial: Record<string, unknown>) => {
    service.updateSettings(partial as Parameters<typeof service.updateSettings>[0])
    if (typeof partial.autostart === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: partial.autostart })
    }
    pushState()
    return service.getConfig()
  })

  ipcMain.handle('drag-orb', (_e, dx: number, dy: number) => {
    if (!orbWindow || orbWindow.isDestroyed()) return getAnchor()
    const mode = service.snapshot().mode
    // Only drag while idle (tight orb window)
    if (mode !== 'idle') return getAnchor()
    const margin = service.getConfig().settings.marginPx
    const next = moveWindowBy(orbWindow, dx, dy, margin)
    return next
  })

  ipcMain.handle('end-orb-drag', (_e, anchor: OrbAnchor) => {
    if (!anchor || typeof anchor.x !== 'number' || typeof anchor.y !== 'number') {
      return service.getConfig()
    }
    service.updateSettings({ orbAnchorX: anchor.x, orbAnchorY: anchor.y })
    pushState()
    return service.getConfig()
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
      { type: 'separator' },
      {
        label: 'Stop timer',
        enabled: hasActive,
        click: () => {
          service.stop()
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
          void registerShortcutsWithRetry(service, () => pushState()).then(() =>
            pushState()
          )
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

  const ok = await registerShortcutsWithRetry(service, () => pushState())
  if (!ok) {
    console.warn(
      'Some global shortcuts failed. Close other WhatWhen instances or free the hotkeys.'
    )
  }
  pushState()

  service.onChange(() => {
    // Always apply native bounds/visibility before renderer state. Sending the
    // snapshot directly here lets Windows paint the old transparent contents
    // at the new origin for a frame during centered-overlay transitions.
    pushState()
  })

  screen.on('display-metrics-changed', () => pushState())

  app.on('browser-window-focus', () => {
    if (!service.hotkeysOk) {
      void registerShortcutsWithRetry(service, () => pushState(), 2, 200)
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
