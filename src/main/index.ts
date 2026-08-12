import { app, BrowserWindow, ipcMain, Menu, shell, screen } from 'electron'
import { existsSync } from 'fs'
import { SessionService } from './session-service'
import { registerShortcutsWithRetry, unregisterShortcuts } from './shortcuts'
import {
  applyLayout,
  createOrbWindow,
  defaultAnchor,
  loadRenderer,
  moveWindowBy,
  ORB_SIZE,
  type OrbAnchor
} from './window'
import { getDayMarkdownPath, getDefaultLogDir } from './paths'
import { localDateKey, type Profile, type ProfileSlot } from '../shared/types'
import { listPending } from './store'

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

function getAnchor(): OrbAnchor {
  const s = service.getConfig().settings
  if (s.orbAnchorX != null && s.orbAnchorY != null) {
    return { x: s.orbAnchorX, y: s.orbAnchorY }
  }
  return defaultAnchor(s.marginPx ?? 20)
}

/**
 * Idle/wheel/stack share a large transparent HWND (idle≈wheel size to avoid
 * resize flicker). Empty glass uses pass-through; the renderer re-enables
 * hit-testing when the cursor is over the orb or other interactive UI.
 * Focused overlays (bubble/settings/analysis/timeline) capture all clicks.
 */
function applyMousePolicy(mode: string): void {
  if (!orbWindow || orbWindow.isDestroyed()) return

  if (
    mode === 'bubble' ||
    mode === 'settings' ||
    mode === 'analysis' ||
    mode === 'timeline'
  ) {
    orbWindow.setFocusable(true)
    orbWindow.setIgnoreMouseEvents(false)
    orbWindow.focus()
    return
  }

  // idle / wheel / stack — not keyboard-focused; pass through empty glass
  orbWindow.setFocusable(false)
  orbWindow.setIgnoreMouseEvents(true, { forward: true })
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
  const crossingCenteredBoundary = lastMode !== null && wasCentered !== isCentered

  /*
   * Centered overlays and the anchored orb cannot share stable bounds in one
   * BrowserWindow. Hide the HWND before moving/resizing it so Windows never
   * exposes the previous overlay at the new bottom-right origin.
   */
  if (crossingCenteredBoundary) {
    if (boundsRevealTimer) clearTimeout(boundsRevealTimer)
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
  lastMode = snap.mode

  if (crossingCenteredBoundary) {
    const targetWindow = orbWindow
    const showFocused = isCentered
    boundsRevealTimer = setTimeout(() => {
      if (!targetWindow.isDestroyed()) {
        if (showFocused) {
          targetWindow.show()
          targetWindow.focus()
        } else {
          targetWindow.showInactive()
        }
      }
      boundsRevealTimer = null
    }, 50)
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
    // Focused overlays — never pass-through
    if (
      mode === 'bubble' ||
      mode === 'settings' ||
      mode === 'analysis' ||
      mode === 'timeline'
    ) {
      orbWindow.setIgnoreMouseEvents(false)
      return
    }
    // idle / wheel / stack — large transparent HWND; pass through empty glass
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
    if (orbWindow && !orbWindow.isDestroyed()) {
      orbWindow.webContents.send('state-changed', service.snapshot())
    }
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
