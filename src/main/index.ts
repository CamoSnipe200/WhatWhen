import { app, BrowserWindow, ipcMain, Menu, shell, screen } from 'electron'
import { existsSync } from 'fs'
import { SessionService } from './session-service'
import { registerShortcutsWithRetry, unregisterShortcuts } from './shortcuts'
import {
  applyLayout,
  createOrbWindow,
  loadRenderer,
  ORB_SIZE
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

function pushState(): void {
  if (!orbWindow || orbWindow.isDestroyed()) return
  const snap = service.snapshot()
  applyLayout(
    orbWindow,
    snap.mode,
    snap.pending.length,
    service.getConfig().settings.orbSize || ORB_SIZE,
    service.getConfig().settings.marginPx
  )
  orbWindow.webContents.send('state-changed', snap)

  if (snap.mode === 'idle') {
    orbWindow.setIgnoreMouseEvents(true, { forward: true })
  } else {
    orbWindow.setIgnoreMouseEvents(false)
    if (snap.mode === 'bubble' || snap.mode === 'settings') {
      orbWindow.focus()
    }
  }
}

function createWindow(): void {
  orbWindow = createOrbWindow()
  loadRenderer(orbWindow)
  orbWindow.setIgnoreMouseEvents(true, { forward: true })

  orbWindow.webContents.on('did-finish-load', () => {
    pushState()
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
    if (typeof notes === 'string') {
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
    const snap = service.snapshot()
    const hasActive = !!(snap.activeSession && !snap.activeSession.endIso)
    const pendingCount = listPending(service.getConfig().settings.logDir).length
    const logExists = snap.todayLogExists

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
    menu.popup({ window: orbWindow ?? undefined })
  })

  ipcMain.on('set-ignore-mouse', (_e, ignore: boolean) => {
    if (!orbWindow || orbWindow.isDestroyed()) return
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
